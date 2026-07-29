#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  normalizeMessageAggregatorConfig,
  parseNewsNowPayload,
  parseRssXml
} from "./message-aggregator.mjs";
import {
  applyLatestReviewCandidate,
  createPostTradeReviewState,
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  maybeRunPostTradeReview,
  normalizePostTradeReviewConfig,
  normalizePostTradeReviewState,
  rollbackPostTradeReviewWeights
} from "./post-trade-review.mjs";
import {
  appendTradeHistoryRecords,
  compactArchivedTrade,
  deleteTradeHistoryRecords,
  loadTradeHistoryRecords,
  queryTradeHistory,
  tradeHistoryStats
} from "./trade-history-store.mjs";
import { closePaperPosition } from "./paper-position-settlement.mjs";
import {
  createFactorLibraryStatus,
  normalizeFactorLibraryConfig,
  normalizeFactorLibraryStatus,
  publicFactorLibrary,
  updateFactorLibraryConfig
} from "./factor-library.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.resolve(ROOT_DIR, "public");
const RUNTIME_DIR = path.resolve(
  process.env.SIGNAL_RUNTIME_DIR || path.resolve(ROOT_DIR, ".runtime", "event-signal-monitor")
);
const ACCOUNT_CONFIG_PATH = path.join(RUNTIME_DIR, "account.json");
const ACCOUNT_STATE_PATH = path.join(RUNTIME_DIR, "paper-account.json");
const ACCOUNT_LOCK_PATH = path.join(RUNTIME_DIR, "account.lock");
const TRANSLATION_CACHE_PATH = path.join(RUNTIME_DIR, "translation-cache.json");
const WHALE_CREDENTIALS_PATH = path.join(RUNTIME_DIR, "whale-alert-credentials.json");
const WHALE_STATUS_PATH = path.join(RUNTIME_DIR, "whale-alert-status.json");
const MESSAGE_AGGREGATOR_CONFIG_PATH = path.join(RUNTIME_DIR, "message-aggregator-config.json");
const MESSAGE_AGGREGATOR_STATUS_PATH = path.join(RUNTIME_DIR, "message-aggregator-status.json");
const DEMO_POSITION_PREVIEW_PATH = path.join(RUNTIME_DIR, "demo-position-preview.json");
const FACTOR_LIBRARY_CONFIG_PATH = path.join(RUNTIME_DIR, "factor-library-config.json");
const FACTOR_LIBRARY_STATUS_PATH = path.join(RUNTIME_DIR, "factor-library-status.json");
const MONITOR_SUPERVISOR_PATH = path.join(__dirname, "supervise-event-signal-service.mjs");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const PORT = Number(process.env.SIGNAL_DASHBOARD_PORT || 8788);
const SERVICE_STALE_SECONDS = Math.max(3, Number(process.env.SIGNAL_SERVICE_STALE_SECONDS || 5));
const AUTO_START_MONITOR_SERVICE = process.env.SIGNAL_DASHBOARD_AUTO_START_SERVICE !== "false";
const SERVICE_ENSURE_INTERVAL_MS = Math.max(
  1_000,
  Number(process.env.SIGNAL_SERVICE_ENSURE_INTERVAL_MS || 5_000)
);
const MODEL_TRADE_HISTORY_LIMIT = 20_000;
const DEFAULT_FUTURES_TAKER_FEE_RATE = 0.0005;
const DEFAULT_SPOT_TAKER_FEE_RATE = 0.001;
const DEFAULT_SLIPPAGE_RATE = 0.0003;
const DEFAULT_FUNDING_INTERVAL_HOURS = 8;
const DEFAULT_ACCOUNT_CONFIG = {
  initialCapital: 10_000,
  quoteCurrency: "USDT",
  marketType: "futures",
  maxLeverage: 3,
  riskProfile: "conservative",
  updatedAt: null
};
const translationCache = new Map(
  Object.entries(readJson(TRANSLATION_CACHE_PATH, {})).filter(
    ([source, translated]) => typeof source === "string" && typeof translated === "string"
  )
);
const translationRequests = new Map();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const reportCache = new Map();

function readCachedReport(filePath, fallback = null) {
  try {
    const stat = fs.statSync(filePath);
    const cached = reportCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.bytes === stat.size) {
      return cached.value;
    }
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    reportCache.set(filePath, { mtimeMs: stat.mtimeMs, bytes: stat.size, value });
    return value;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore temporary-file cleanup failures.
    }
  }
}

function readDotEnvValue(name) {
  try {
    const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0 || trimmed.slice(0, separator).trim() !== name) continue;
      return trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // The dashboard can run without a local .env file.
  }
  return "";
}

function normalizeWhaleAlertApiKey(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function readWhaleAlertApiKey() {
  const credentials = readJson(WHALE_CREDENTIALS_PATH, null);
  const storedKey = normalizeWhaleAlertApiKey(credentials?.apiKey);
  return (
    storedKey ||
    normalizeWhaleAlertApiKey(process.env.WHALE_ALERT_API_KEY) ||
    normalizeWhaleAlertApiKey(readDotEnvValue("WHALE_ALERT_API_KEY"))
  );
}

function maskApiKey(apiKey) {
  if (!apiKey) return "";
  const suffix = apiKey.slice(-4);
  return `••••••••${suffix}`;
}

function classifyWhaleAlertError(error) {
  const message = String(error instanceof Error ? error.message : error || "");
  if (/timeout|aborted|AbortError/i.test(message)) {
    return { errorCode: "timeout", error: "连接 Whale Alert 超时，请检查网络后重试。" };
  }
  if (/\b401\b|\b403\b|invalid api|unauthorized|forbidden|authentication/i.test(message)) {
    return { errorCode: "invalid_key", error: "API Key 无效、已过期或当前套餐无权访问该接口。" };
  }
  if (/\b429\b|rate limit|too many requests|usage limit/i.test(message)) {
    return { errorCode: "rate_limited", error: "Whale Alert 请求频率或套餐额度已受限。" };
  }
  if (/transactions array/i.test(message)) {
    return { errorCode: "invalid_response", error: "Whale Alert 返回结构异常，未发现交易消息列表。" };
  }
  return {
    errorCode: "connection_failed",
    error: `Whale Alert 连接失败：${message.replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]").slice(0, 240) || "未知错误"}`
  };
}

async function validateWhaleAlertApiKey(apiKey) {
  const normalizedKey = normalizeWhaleAlertApiKey(apiKey);
  if (normalizedKey.length < 12 || normalizedKey.length > 256) {
    const error = new Error("API Key 格式不正确。");
    error.code = "invalid_format";
    throw error;
  }
  const endpoint = new URL("https://api.whale-alert.io/v1/transactions");
  endpoint.searchParams.set("api_key", normalizedKey);
  endpoint.searchParams.set("min_value", "5000000");
  endpoint.searchParams.set("start", String(Math.floor((Date.now() - 60 * 60 * 1000) / 1000)));
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "event-signal-monitor/0.6" },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`HTTP ${response.status}: Whale Alert 返回了非 JSON 数据。`);
  }
  if (!response.ok || (payload?.result && payload.result !== "success")) {
    throw new Error(`HTTP ${response.status}: ${String(payload?.message || payload?.result || response.statusText)}`);
  }
  if (!Array.isArray(payload?.transactions)) {
    throw new Error("Whale Alert response does not contain a transactions array");
  }
  return {
    configured: true,
    connected: true,
    maskedKey: maskApiKey(normalizedKey),
    messageCount: payload.transactions.length,
    checkedAt: new Date().toISOString(),
    errorCode: null,
    error: null
  };
}

function saveWhaleAlertCredentials(apiKey) {
  writeJson(WHALE_CREDENTIALS_PATH, {
    apiKey: normalizeWhaleAlertApiKey(apiKey),
    updatedAt: new Date().toISOString()
  });
  try {
    fs.chmodSync(WHALE_CREDENTIALS_PATH, 0o600);
  } catch {
    // Windows ACLs are not represented fully by POSIX mode bits.
  }
}

function publicWhaleAlertStatus() {
  const apiKey = readWhaleAlertApiKey();
  const savedStatus = readJson(WHALE_STATUS_PATH, null);
  return {
    configured: Boolean(apiKey),
    connected: Boolean(apiKey && savedStatus?.connected),
    maskedKey: apiKey ? maskApiKey(apiKey) : "",
    messageCount: safeNumber(savedStatus?.messageCount),
    checkedAt: savedStatus?.checkedAt || null,
    errorCode: savedStatus?.errorCode || null,
    error: savedStatus?.error || null
  };
}

function readMessageAggregatorConfig() {
  const saved = readJson(MESSAGE_AGGREGATOR_CONFIG_PATH, null);
  const environmentConfig = {
    enabled: process.env.MESSAGE_AGGREGATOR_ENABLED || readDotEnvValue("MESSAGE_AGGREGATOR_ENABLED"),
    filterKeywords: process.env.MESSAGE_FILTER_KEYWORDS || readDotEnvValue("MESSAGE_FILTER_KEYWORDS"),
    maxItemsPerSource:
      process.env.MESSAGE_MAX_ITEMS_PER_SOURCE || readDotEnvValue("MESSAGE_MAX_ITEMS_PER_SOURCE")
  };
  return normalizeMessageAggregatorConfig(saved || environmentConfig);
}

function publicMessageAggregatorStatus() {
  const config = readMessageAggregatorConfig();
  const savedStatus = readJson(MESSAGE_AGGREGATOR_STATUS_PATH, null);
  const configured = config.rssFeeds.length + config.trendSources.length > 0;
  return {
    configured,
    enabled: config.enabled,
    connected: Boolean(config.enabled && savedStatus?.connected),
    degraded: Boolean(savedStatus?.degraded),
    messageCount: safeNumber(savedStatus?.messageCount),
    checkedAt: savedStatus?.checkedAt || null,
    errorCode: savedStatus?.errorCode || null,
    error: savedStatus?.error || null,
    sources: Array.isArray(savedStatus?.sources) ? savedStatus.sources : [],
    config: {
      enabled: config.enabled,
      filterKeywords: config.filterKeywords,
      maxItemsPerSource: config.maxItemsPerSource,
      builtInSources: [...config.rssFeeds, ...config.trendSources],
      rssFeeds: config.rssFeeds,
      trendSources: config.trendSources
    }
  };
}

async function validateMessageAggregatorConfig(input) {
  const config = normalizeMessageAggregatorConfig(input);
  const jobs = [
    ...config.rssFeeds.map((feed) => ({
      type: "rss",
      name: feed.name,
      url: feed.url,
      run: async () => {
        const response = await fetch(feed.url, {
          headers: {
            "User-Agent": "event-signal-monitor/0.8",
            Accept: "application/rss+xml,application/atom+xml,text/xml,text/plain,*/*"
          },
          signal: AbortSignal.timeout(15_000)
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return parseRssXml(await response.text(), feed, config);
      }
    })),
    ...config.trendSources.map((source) => ({
      type: "trend",
      name: source.name,
      url: source.url,
      run: async () => {
        const response = await fetch(source.url, {
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: "https://newsnow.busiyi.world/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return parseNewsNowPayload(await response.json(), source, config);
      }
    }))
  ];
  if (!jobs.length) {
    const error = new Error("内置消息来源清单为空。");
    error.code = "not_configured";
    throw error;
  }
  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const sources = settled.map((result, index) => ({
    type: jobs[index].type,
    name: jobs[index].name,
    url: jobs[index].url,
    connected: result.status === "fulfilled",
    messageCount: result.status === "fulfilled" ? result.value.length : 0,
    error:
      result.status === "rejected"
        ? String(result.reason instanceof Error ? result.reason.message : result.reason).slice(0, 240)
        : null
  }));
  const connectedCount = sources.filter((source) => source.connected).length;
  const status = {
    configured: true,
    enabled: config.enabled,
    connected: connectedCount > 0,
    degraded: connectedCount > 0 && connectedCount < sources.length,
    messageCount: sources.reduce((sum, source) => sum + source.messageCount, 0),
    checkedAt: new Date().toISOString(),
    sources,
    errorCode: connectedCount ? null : "all_sources_failed",
    error: connectedCount ? null : "所有已配置聚合源均连接失败。"
  };
  return { config, status };
}

function saveMessageAggregatorConfig(config, status) {
  writeJson(MESSAGE_AGGREGATOR_CONFIG_PATH, {
    enabled: config.enabled,
    filterKeywords: config.filterKeywords,
    maxItemsPerSource: config.maxItemsPerSource,
    updatedAt: new Date().toISOString()
  });
  writeJson(MESSAGE_AGGREGATOR_STATUS_PATH, status);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTranslationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 480);
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(value);
}

async function translateToChinese(value) {
  const source = normalizeTranslationText(value);
  if (!source || containsChinese(source)) return source;
  if (translationCache.has(source)) return translationCache.get(source);
  if (translationRequests.has(source)) return translationRequests.get(source);

  const request = (async () => {
    const endpoint = new URL("https://api.mymemory.translated.net/get");
    endpoint.searchParams.set("q", source);
    endpoint.searchParams.set("langpair", "en|zh-CN");
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "event-signal-monitor/0.1" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`translation_http_${response.status}`);
    const payload = await response.json();
    const translated = normalizeTranslationText(payload?.responseData?.translatedText);
    if (
      payload?.responseStatus !== 200 ||
      !translated ||
      /^MYMEMORY WARNING/i.test(translated)
    ) {
      throw new Error(String(payload?.responseDetails || "translation_unavailable"));
    }
    translationCache.set(source, translated);
    return translated;
  })().finally(() => translationRequests.delete(source));

  translationRequests.set(source, request);
  return request;
}

async function translateBatch(values, cachedOnly = false) {
  const texts = [...new Set(values.map(normalizeTranslationText).filter(Boolean))].slice(0, 80);
  const translations = {};
  const failures = [];
  const pendingTexts = [];

  for (const text of texts) {
    if (containsChinese(text)) {
      translations[text] = text;
    } else if (translationCache.has(text)) {
      translations[text] = translationCache.get(text);
    } else {
      pendingTexts.push(text);
    }
  }
  if (cachedOnly || !pendingTexts.length) {
    return { translations, failures, pending: pendingTexts };
  }

  let cursor = 0;

  async function worker() {
    while (cursor < pendingTexts.length) {
      const text = pendingTexts[cursor];
      cursor += 1;
      try {
        translations[text] = await translateToChinese(text);
      } catch (error) {
        failures.push({
          text,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, pendingTexts.length) }, () => worker()));
  if (Object.keys(translations).length) {
    writeJson(TRANSLATION_CACHE_PATH, Object.fromEntries(translationCache));
  }
  return { translations, failures, pending: [] };
}

function normalizeAccountConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const marketType = raw.marketType === "spot" ? "spot" : "futures";
  const riskProfile = raw.riskProfile === "aggressive" ? "aggressive" : "conservative";
  const initialCapital = clamp(safeNumber(raw.initialCapital, DEFAULT_ACCOUNT_CONFIG.initialCapital), 100, 1_000_000_000);
  const maxLeverage = marketType === "spot" ? 1 : clamp(Math.floor(safeNumber(raw.maxLeverage, DEFAULT_ACCOUNT_CONFIG.maxLeverage)), 1, 125);
  const defaultFeeRate =
    marketType === "spot" ? DEFAULT_SPOT_TAKER_FEE_RATE : DEFAULT_FUTURES_TAKER_FEE_RATE;
  return {
    initialCapital,
    quoteCurrency: String(raw.quoteCurrency || DEFAULT_ACCOUNT_CONFIG.quoteCurrency).toUpperCase(),
    marketType,
    maxLeverage,
    riskProfile,
    takerFeeRate: clamp(safeNumber(raw.takerFeeRate, defaultFeeRate), 0, 0.01),
    slippageRate: clamp(safeNumber(raw.slippageRate, DEFAULT_SLIPPAGE_RATE), 0, 0.02),
    fundingIntervalHours: clamp(
      safeNumber(raw.fundingIntervalHours, DEFAULT_FUNDING_INTERVAL_HOURS),
      1,
      24
    ),
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

function sameAccountConfig(left, right) {
  const a = normalizeAccountConfig(left);
  const b = normalizeAccountConfig(right);
  return (
    a.initialCapital === b.initialCapital &&
    a.quoteCurrency === b.quoteCurrency &&
    a.marketType === b.marketType &&
    a.maxLeverage === b.maxLeverage &&
    a.riskProfile === b.riskProfile &&
    a.takerFeeRate === b.takerFeeRate &&
    a.slippageRate === b.slippageRate &&
    a.fundingIntervalHours === b.fundingIntervalHours
  );
}

function hasAccountConfigInput(value) {
  if (!value || typeof value !== "object") return false;
  return [
    "initialCapital",
    "quoteCurrency",
    "marketType",
    "maxLeverage",
    "riskProfile",
    "takerFeeRate",
    "slippageRate",
    "fundingIntervalHours"
  ].some(
    (key) => Object.hasOwn(value, key)
  );
}

function createPaperAccount(config, now = new Date().toISOString()) {
  const normalized = normalizeAccountConfig(config);
  const account = {
    version: "dashboard",
    sessionId: randomUUID(),
    isActive: false,
    startedAt: null,
    stoppedAt: null,
    createdAt: now,
    updatedAt: now,
    configSnapshot: normalized,
    startingCapital: normalized.initialCapital,
    realizedPnl: 0,
    unrealizedPnl: 0,
    tradingFees: 0,
    slippageCost: 0,
    fundingPnl: 0,
    equity: normalized.initialCapital,
    marginUsed: 0,
    availableEquity: normalized.initialCapital,
    positions: {},
    tradeHistory: [],
    tradeHistorySchemaVersion: 2,
    lifetimeClosedTrades: 0,
    lifetimeWinningTrades: 0,
    postTradeReviewConfig: normalizePostTradeReviewConfig(),
    postTradeReview: createPostTradeReviewState(DEFAULT_DIRECTION_MODEL_WEIGHTS, null),
    equityCurve: [
      { time: now, equity: normalized.initialCapital, returnPct: 0, realizedPnl: 0, unrealizedPnl: 0 }
    ],
    summary: {
      startTime: null,
      endTime: now,
      startingCapital: normalized.initialCapital,
      latestEquity: normalized.initialCapital,
      finalReturnPct: 0,
      maxReturnPct: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      openPositions: 0,
      realizedPnl: 0,
     …5582 tokens truncated…lizedPnl;
  account.availableEquity = Math.max(0, account.equity - account.marginUsed);
  account.updatedAt = now;
  const equityPoint = {
    time: now,
    equity: account.equity,
    returnPct: account.startingCapital > 0 ? account.equity / account.startingCapital - 1 : 0,
    realizedPnl: safeNumber(account.realizedPnl),
    unrealizedPnl: account.unrealizedPnl
  };
  account.equityCurve = [...(account.equityCurve || []), equityPoint].slice(-5_000);
  const closedTrades = Math.max(safeNumber(account.lifetimeClosedTrades), (account.tradeHistory || []).length);
  const wins = Math.min(closedTrades, safeNumber(account.lifetimeWinningTrades));
  account.summary = {
    ...(account.summary || {}),
    endTime: now,
    latestEquity: account.equity,
    finalReturnPct: equityPoint.returnPct,
    closedTrades,
    wins,
    losses: closedTrades - wins,
    winRate: closedTrades ? wins / closedTrades : 0,
    openPositions: remaining.length,
    realizedPnl: safeNumber(account.realizedPnl),
    unrealizedPnl: account.unrealizedPnl,
    tradingFees: safeNumber(account.tradingFees),
    slippageCost: safeNumber(account.slippageCost),
    fundingPnl: safeNumber(account.fundingPnl),
    marginUsed: account.marginUsed,
    availableEquity: account.availableEquity
  };
  account.lastRun = {
    generatedAt: now,
    openedPositions: [],
    closedPositions: closed,
    manualCloseAll: true
  };
  const { result: reviewResult } = runDashboardArchivedReview(account, now);
  account.lastRun.postTradeReview = reviewResult.review;
  return { closed, failed };
}

function sendStatic(response, requestPath) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/factors" && request.method === "GET") {
    const status = normalizeFactorLibraryStatus(
      readJson(FACTOR_LIBRARY_STATUS_PATH, createFactorLibraryStatus())
    );
    const config = normalizeFactorLibraryConfig(
      readJson(FACTOR_LIBRARY_CONFIG_PATH, {}),
      status.minedFactors
    );
    sendJson(response, publicFactorLibrary(config, status));
    return;
  }
  if (url.pathname === "/api/factors/config" && request.method === "POST") {
    try {
      const patch = await readRequestJson(request);
      const status = normalizeFactorLibraryStatus(
        readJson(FACTOR_LIBRARY_STATUS_PATH, createFactorLibraryStatus())
      );
      const current = normalizeFactorLibraryConfig(
        readJson(FACTOR_LIBRARY_CONFIG_PATH, {}),
        status.minedFactors
      );
      const config = updateFactorLibraryConfig(current, patch, status.minedFactors);
      writeJson(FACTOR_LIBRARY_CONFIG_PATH, config);
      sendJson(response, publicFactorLibrary(config, status));
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }
  if (url.pathname === "/api/report") {
    const layer = url.searchParams.get("layer") || "latest";
    const filePath = reportPath(layer);
    const report = readCachedReport(filePath, null);
    if (!report) {
      sendJson(response, { error: "report_not_found", filePath }, 404);
      return;
    }
    sendJson(response, report);
    return;
  }
  if (url.pathname === "/api/page-data") {
    const view = String(url.searchParams.get("view") || "overview");
    const data = pageData(view);
    if (!data) {
      sendJson(response, { error: "report_not_found" }, 404);
      return;
    }
    sendJson(response, data);
    return;
  }
  if (url.pathname === "/api/translate" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const texts = Array.isArray(body?.texts) ? body.texts : [];
      const result = await translateBatch(texts, body?.cachedOnly === true);
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }
  if (url.pathname === "/api/message-aggregator/status" && request.method === "GET") {
    try {
      sendJson(response, publicMessageAggregatorStatus());
    } catch (error) {
      sendJson(
        response,
        {
          configured: false,
          enabled: false,
          connected: false,
          degraded: false,
          messageCount: 0,
          checkedAt: null,
          sources: [],
          config: null,
          errorCode: "invalid_configuration",
          error: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
    return;
  }
  if (url.pathname === "/api/message-aggregator/config" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const { config, status } = await validateMessageAggregatorConfig(body);
      if (!status.connected) {
        sendJson(response, { ...status, config }, 400);
        return;
      }
      saveMessageAggregatorConfig(config, status);
      sendJson(response, {
        ...status,
        config: {
          enabled: config.enabled,
          filterKeywords: config.filterKeywords,
          maxItemsPerSource: config.maxItemsPerSource,
          builtInSources: [...config.rssFeeds, ...config.trendSources],
          rssFeeds: config.rssFeeds,
          trendSources: config.trendSources
        }
      });
    } catch (error) {
      sendJson(
        response,
        {
          configured: false,
          enabled: false,
          connected: false,
          degraded: false,
          messageCount: 0,
          checkedAt: new Date().toISOString(),
          sources: [],
          errorCode: error?.code || "invalid_configuration",
          error: error instanceof Error ? error.message : String(error)
        },
        400
      );
    }
    return;
  }
  if (url.pathname === "/api/whale-alert/status" && request.method === "GET") {
    const current = publicWhaleAlertStatus();
    const stale =
      !current.checkedAt ||
      Date.now() - new Date(current.checkedAt).getTime() > 5 * 60 * 1000;
    if (current.configured && (!current.connected || stale)) {
      try {
        const verified = await validateWhaleAlertApiKey(readWhaleAlertApiKey());
        writeJson(WHALE_STATUS_PATH, verified);
        sendJson(response, verified);
      } catch (error) {
        const failure =
          error?.code === "invalid_format"
            ? { errorCode: "invalid_format", error: error.message }
            : classifyWhaleAlertError(error);
        const status = {
          ...current,
          connected: false,
          messageCount: 0,
          checkedAt: new Date().toISOString(),
          ...failure
        };
        writeJson(WHALE_STATUS_PATH, status);
        sendJson(response, status);
      }
      return;
    }
    sendJson(response, current);
    return;
  }
  if (url.pathname === "/api/whale-alert/connect" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const apiKey = normalizeWhaleAlertApiKey(body?.apiKey);
      const verified = await validateWhaleAlertApiKey(apiKey);
      saveWhaleAlertCredentials(apiKey);
      writeJson(WHALE_STATUS_PATH, verified);
      sendJson(response, verified);
    } catch (error) {
      const failure =
        error?.code === "invalid_format"
          ? { errorCode: "invalid_format", error: error.message }
          : classifyWhaleAlertError(error);
      sendJson(
        response,
        {
          configured: Boolean(readWhaleAlertApiKey()),
          connected: false,
          maskedKey: "",
          messageCount: 0,
          checkedAt: new Date().toISOString(),
          ...failure
        },
        400
      );
    }
    return;
  }
  if (url.pathname === "/api/account" && request.method === "GET") {
    sendJson(response, readAccountBundle());
    return;
  }
  if (url.pathname === "/api/post-trade-review" && request.method === "GET") {
    const { account } = readAccountBundle();
    sendJson(response, publicPostTradeReview(account, tradeHistoryStats(RUNTIME_DIR)));
    return;
  }
  if (url.pathname === "/api/trade-history" && request.method === "GET") {
    try {
      const result = await withAccountLock(() => {
        const { account } = readAccountBundle();
        appendTradeHistoryRecords(RUNTIME_DIR, account.tradeHistory);
        return queryTradeHistory(RUNTIME_DIR, {
          page: url.searchParams.get("page"),
          pageSize: url.searchParams.get("pageSize")
        });
      });
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/trade-history/delete" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const result = await withAccountLock(() => {
        const { account } = readAccountBundle();
        appendTradeHistoryRecords(RUNTIME_DIR, account.tradeHistory);
        const deletion = deleteTradeHistoryRecords(RUNTIME_DIR, body.ids);
        const deletedIds = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
        account.tradeHistory = (account.tradeHistory || []).filter(
          (trade) => !deletedIds.has(String(trade.id))
        );
        account.exitDecisionHistory = (account.exitDecisionHistory || []).filter(
          (event) => !deletedIds.has(String(event.positionId))
        );
        account.capitalRotationHistory = (account.capitalRotationHistory || []).filter(
          (event) => !deletedIds.has(String(event.positionId))
        );
        if (account.postTradeReview) {
          account.postTradeReview.reviewedTradeCount = Math.min(
            safeNumber(account.postTradeReview.reviewedTradeCount),
            safeNumber(deletion.totalRecords)
          );
        }
        account.updatedAt = new Date().toISOString();
        writeJson(ACCOUNT_STATE_PATH, account);
        return deletion;
      });
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/post-trade-review/config" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const result = await withAccountLock(() => {
        const { account } = readAccountBundle();
        account.postTradeReviewConfig = normalizePostTradeReviewConfig({
          ...account.postTradeReviewConfig,
          ...body
        });
        const { result: reviewResult } = runDashboardArchivedReview(account);
        account.updatedAt = new Date().toISOString();
        writeJson(ACCOUNT_STATE_PATH, account);
        return {
          config: account.postTradeReviewConfig,
          triggeredReview: Boolean(reviewResult.review)
        };
      });
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/post-trade-review/apply" && request.method === "POST") {
    try {
      const result = await withAccountLock(() => {
        const { account } = readAccountBundle();
        applyLatestReviewCandidate(account, DEFAULT_DIRECTION_MODEL_WEIGHTS);
        account.updatedAt = new Date().toISOString();
        writeJson(ACCOUNT_STATE_PATH, account);
        return {
          config: account.postTradeReviewConfig,
          weightVersion: account.postTradeReview?.weightVersion || 1,
          exitWeightVersion: account.postTradeReview?.exitWeightVersion || 1
        };
      });
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/post-trade-review/rollback" && request.method === "POST") {
    try {
      const result = await withAccountLock(() => {
        const { account } = readAccountBundle();
        rollbackPostTradeReviewWeights(account, DEFAULT_DIRECTION_MODEL_WEIGHTS);
        account.updatedAt = new Date().toISOString();
        writeJson(ACCOUNT_STATE_PATH, account);
        return {
          config: account.postTradeReviewConfig,
          weightVersion: account.postTradeReview?.weightVersion || 1,
          exitWeightVersion: account.postTradeReview?.exitWeightVersion || 1
        };
      });
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/account" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const { config, account } = await withAccountLock(() => {
        const config = normalizeAccountConfig({ ...body, updatedAt: new Date().toISOString() });
        const account = createPaperAccount(config);
        writeJson(ACCOUNT_CONFIG_PATH, config);
        writeJson(ACCOUNT_STATE_PATH, account);
        return { config, account };
      });
      sendJson(response, { config, account });
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }
  if (url.pathname === "/api/account/reset" && request.method === "POST") {
    try {
      const { config, account } = await withAccountLock(() => {
        const { config } = readAccountBundle();
        const account = createPaperAccount(config);
        writeJson(ACCOUNT_STATE_PATH, account);
        return { config, account };
      });
      sendJson(response, { config, account });
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/account/start" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const { config, account } = await withAccountLock(() => {
        const current = readAccountBundle();
        const now = new Date().toISOString();
        const requestedConfig = hasAccountConfigInput(body)
          ? normalizeAccountConfig({ ...current.config, ...body, updatedAt: now })
          : current.config;
        const configChanged = !sameAccountConfig(current.config, requestedConfig);
        const config = configChanged ? requestedConfig : current.config;
        const account = configChanged ? createPaperAccount(config, now) : current.account;

        if (configChanged) {
          writeJson(ACCOUNT_CONFIG_PATH, config);
        }
        if (!account.isActive) {
          const startsNewSession = !account.startedAt;
          if (startsNewSession) account.sessionId = randomUUID();
          account.isActive = true;
          account.startedAt = account.startedAt || now;
          account.stoppedAt = null;
          account.updatedAt = now;
          if (startsNewSession) {
            account.equityCurve = [
              {
                time: now,
                equity: account.equity,
                returnPct: account.startingCapital > 0 ? account.equity / account.startingCapital - 1 : 0,
                realizedPnl: account.realizedPnl,
                unrealizedPnl: account.unrealizedPnl
              }
            ];
            account.summary = {
              ...(account.summary || {}),
              startTime: now,
              endTime: now,
              startingCapital: account.startingCapital,
              latestEquity: account.equity,
              finalReturnPct: account.startingCapital > 0 ? account.equity / account.startingCapital - 1 : 0,
              maxReturnPct: account.startingCapital > 0 ? account.equity / account.startingCapital - 1 : 0,
              maxDrawdownPct: 0,
              sharpeRatio: 0,
              closedTrades: Array.isArray(account.tradeHistory) ? account.tradeHistory.length : 0,
              openPositions: Object.keys(account.positions || {}).length
            };
            account.lastRun = {
              generatedAt: now,
              openedPositions: [],
              closedPositions: []
            };
          }
        }
        account.configSnapshot = config;
        writeJson(ACCOUNT_STATE_PATH, account);
        return { config, account };
      });
      sendJson(response, { config, account });
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/account/stop" && request.method === "POST") {
    try {
      const { config, account } = await withAccountLock(() => {
        const current = readAccountBundle();
        const now = new Date().toISOString();
        current.account.isActive = false;
        current.account.stoppedAt = now;
        current.account.updatedAt = now;
        writeJson(ACCOUNT_STATE_PATH, current.account);
        return current;
      });
      sendJson(response, { config, account });
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (url.pathname === "/api/account/close-all" && request.method === "POST") {
    try {
      const result = await withAccountLock(() => {
        const { config, account } = readAccountBundle();
        if (!Object.keys(account.positions || {}).length) {
          const error = new Error("当前没有可平仓的模拟仓位。");
          error.code = "NO_OPEN_POSITIONS";
          throw error;
        }
        const settlement = closeAllPaperPositions(account);
        writeJson(ACCOUNT_STATE_PATH, account);
        return {
          config,
          account,
          closeResult: {
            closedCount: settlement.closed.length,
            failedCount: settlement.failed.length,
            failed: settlement.failed
          }
        };
      });
      sendJson(response, result);
    } catch (error) {
      sendJson(
        response,
        { error: error instanceof Error ? error.message : String(error), errorCode: error?.code || "CLOSE_ALL_FAILED" },
        error?.code === "NO_OPEN_POSITIONS" ? 409 : 500
      );
    }
    return;
  }
  if (url.pathname === "/api/account/summary") {
    const { config, account } = readAccountBundle();
    sendJson(response, { config, summary: account.summary || null, account: compactAccountForSummary(account) });
    return;
  }
  if (url.pathname === "/api/log") {
    const requestedBytes = Number(url.searchParams.get("bytes") || 80_000);
    const maxBytes = Math.max(1_024, Math.min(Number.isFinite(requestedBytes) ? requestedBytes : 80_000, 500_000));
    sendJson(
      response,
      readLogChunk(path.join(RUNTIME_DIR, "fast-loop.log"), url.searchParams.get("cursor"), maxBytes)
    );
    return;
  }
  if (url.pathname === "/api/status") {
    sendJson(response, loopStatus());
    return;
  }
  sendStatic(response, url.pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard: http://127.0.0.1:${PORT}`);
  ensureMonitorSupervisor();
});

const serviceEnsureTimer = setInterval(ensureMonitorSupervisor, SERVICE_ENSURE_INTERVAL_MS);
serviceEnsureTimer.unref();
server.once("close", () => clearInterval(serviceEnsureTimer));

