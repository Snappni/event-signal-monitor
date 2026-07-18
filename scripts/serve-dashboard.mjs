#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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
const ENV_PATH = path.join(ROOT_DIR, ".env");
const PORT = Number(process.env.SIGNAL_DASHBOARD_PORT || 8788);
const LOOP_INTERVAL_SECONDS = Math.max(1, Number(process.env.SIGNAL_LOOP_INTERVAL_SECONDS || 10));
const LOOP_STALE_SECONDS = Math.max(
  LOOP_INTERVAL_SECONDS * 4,
  Number(process.env.SIGNAL_LOOP_STALE_SECONDS || 60)
);
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
  ".txt": "text/plain; charset=utf-8"
};

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  const maxLeverage = marketType === "spot" ? 1 : clamp(safeNumber(raw.maxLeverage, DEFAULT_ACCOUNT_CONFIG.maxLeverage), 1, 125);
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
  return ["initialCapital", "quoteCurrency", "marketType", "maxLeverage", "riskProfile"].some(
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
      unrealizedPnl: 0,
      tradingFees: 0,
      slippageCost: 0,
      fundingPnl: 0,
      marginUsed: 0,
      availableEquity: normalized.initialCapital,
      formula:
        "净权益=本金+已实现现金流(含手续费与资金费)+按不利滑点和平仓手续费估算的未实现盈亏；收益率=净权益/本金-1。"
    }
  };
  account.postTradeReview.sessionId = account.sessionId;
  return account;
}

function readAccountBundle() {
  const rawConfig = readJson(ACCOUNT_CONFIG_PATH, DEFAULT_ACCOUNT_CONFIG);
  const config = normalizeAccountConfig(rawConfig);
  if (!rawConfig || rawConfig.riskProfile !== config.riskProfile) {
    writeJson(ACCOUNT_CONFIG_PATH, config);
  }
  let account = readJson(ACCOUNT_STATE_PATH, null);
  if (!account) {
    account = createPaperAccount(config);
    writeJson(ACCOUNT_CONFIG_PATH, config);
    writeJson(ACCOUNT_STATE_PATH, account);
  } else {
    if (typeof account.isActive !== "boolean") account.isActive = true;
    if (!Object.hasOwn(account, "startedAt")) {
      account.startedAt = account.isActive ? account.createdAt : null;
    }
    account.tradingFees = safeNumber(account.tradingFees);
    account.slippageCost = safeNumber(account.slippageCost);
    account.fundingPnl = safeNumber(account.fundingPnl);
    account.configSnapshot = config;
    account.positions = account.positions || {};
    for (const position of Object.values(account.positions)) {
      position.riskProfile =
        position.riskProfile === "aggressive" ? "aggressive" : config.riskProfile;
    }
    account.tradeHistory = Array.isArray(account.tradeHistory) ? account.tradeHistory : [];
    account.lifetimeClosedTrades = Math.max(
      account.tradeHistory.length,
      Math.round(safeNumber(account.lifetimeClosedTrades, account.tradeHistory.length))
    );
    const retainedWinningTrades = account.tradeHistory.filter(
      (trade) => safeNumber(trade.realizedPnl) > 0
    ).length;
    account.lifetimeWinningTrades = Math.max(
      retainedWinningTrades,
      Math.round(safeNumber(account.lifetimeWinningTrades, retainedWinningTrades))
    );
    account.postTradeReviewConfig = normalizePostTradeReviewConfig(account.postTradeReviewConfig);
    account.postTradeReview = normalizePostTradeReviewState(
      account.postTradeReview,
      DEFAULT_DIRECTION_MODEL_WEIGHTS,
      account.sessionId
    );
    for (const position of account.tradeHistory) {
      position.riskProfile =
        position.riskProfile === "aggressive" ? "aggressive" : config.riskProfile;
    }
  }
  return { config, account };
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function withAccountLock(callback) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const startedAt = Date.now();
  while (true) {
    let fd;
    try {
      fd = fs.openSync(ACCOUNT_LOCK_PATH, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      try {
        return await callback();
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close failure during cleanup.
        }
        try {
          fs.unlinkSync(ACCOUNT_LOCK_PATH);
        } catch {
          // A stale-lock cleanup may already have removed it.
        }
      }
    } catch (error) {
      if (fd) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close failure after acquisition error.
        }
      }
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = JSON.parse(fs.readFileSync(ACCOUNT_LOCK_PATH, "utf8"));
        const ownerPid = Number(lock?.pid);
        if (Number.isInteger(ownerPid) && ownerPid > 0 && !isProcessRunning(ownerPid)) {
          fs.unlinkSync(ACCOUNT_LOCK_PATH);
          continue;
        }
      } catch {
        // Fall through to age-based stale-lock cleanup.
      }
      try {
        const stat = fs.statSync(ACCOUNT_LOCK_PATH);
        if (Date.now() - stat.mtimeMs > 60_000) {
          fs.unlinkSync(ACCOUNT_LOCK_PATH);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - startedAt > 10_000) {
        throw new Error("账户正在更新，请稍后重试。");
      }
      await sleep(100);
    }
  }
}

function reportPath(layer) {
  return path.join(RUNTIME_DIR, "latest-report.json");
}

function readTail(filePath, maxBytes = 80_000) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function sendJson(response, value, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function loopStatus(latestReportOverride = null) {
  const fastPidPath = path.join(RUNTIME_DIR, "fast-loop.pid");
  const fastPid = Number(fs.existsSync(fastPidPath) ? fs.readFileSync(fastPidPath, "utf8").trim() : 0);
  const pidRunning = isProcessRunning(fastPid);
  const latestReport = latestReportOverride || readJson(path.join(RUNTIME_DIR, "latest-report.json"), null);
  const reportGeneratedAt = latestReport?.generatedAt || null;
  const reportTimestamp = Date.parse(reportGeneratedAt || "");
  const reportAgeMs = Number.isFinite(reportTimestamp) ? Math.max(0, Date.now() - reportTimestamp) : null;
  const reportFresh = reportAgeMs !== null && reportAgeMs <= LOOP_STALE_SECONDS * 1000;
  return {
    generatedAt: new Date().toISOString(),
    loopMode: "unified-high-frequency",
    loopPid: fastPid || null,
    loopRunning: pidRunning || reportFresh,
    loopBackend: pidRunning ? "process-pid" : reportFresh ? "report-heartbeat" : "none",
    loopIntervalSeconds: LOOP_INTERVAL_SECONDS,
    loopLastReportAt: reportGeneratedAt,
    loopReportAgeSeconds: reportAgeMs === null ? null : Math.round(reportAgeMs / 1000),
    loopStaleAfterSeconds: LOOP_STALE_SECONDS,
    runtimeDir: RUNTIME_DIR
  };
}

function reportHeader(report) {
  return {
    version: report?.version || null,
    generatedAt: report?.generatedAt || null,
    mode: report?.mode || "paper-alert-only",
    layer: report?.layer || "unified-high-frequency",
    sourceCounts: report?.sourceCounts || {},
    uiCounts: {
      actionable: Array.isArray(report?.actionableSignals) ? report.actionableSignals.length : 0,
      watch: Array.isArray(report?.watchlist) ? report.watchlist.length : 0,
      messages: Array.isArray(report?.messageFeed) ? report.messageFeed.length : 0,
      models: Array.isArray(report?.modelCalculations) ? report.modelCalculations.length : 0
    }
  };
}

function compactRelatedEvents(events) {
  return (Array.isArray(events) ? events : []).slice(0, 2).map((event) => ({
    title: event?.title || event?.text || ""
  }));
}

function compactPositionForDashboard(position) {
  const keep = [
    "id", "symbol", "side", "openedAt", "closedAt", "candidateMode", "riskProfile", "leverage",
    "currentPrice", "entry", "signalEntryPrice", "exitReferencePrice", "exitPrice", "takeProfit", "stopLoss",
    "winRate", "expectancyPct", "eventImpactScore", "unrealizedPnl", "netPnl", "unrealizedReturnPct",
    "realizedPnl", "realizedReturnPct", "closeReason", "quantity", "modelSuggestedLeverage", "notional",
    "marginRequired", "entryFee", "estimatedExitFee", "estimatedExitSlippageCost", "fundingPnl",
    "fundingSettlements", "exitFee", "entrySlippageCost", "exitSlippageCost", "exitEvaluation",
    "exitConfirmationCount"
  ];
  const result = Object.fromEntries(keep.map((key) => [key, position?.[key]]));
  result.relatedEvents = compactRelatedEvents(position?.relatedEvents);
  return result;
}

function compactAccountForDashboard(account) {
  const positions = Object.fromEntries(
    Object.entries(account?.positions || {}).map(([id, position]) => [id, compactPositionForDashboard(position)])
  );
  return {
    sessionId: account?.sessionId || null,
    isActive: account?.isActive === true,
    startedAt: account?.startedAt || null,
    createdAt: account?.createdAt || null,
    updatedAt: account?.updatedAt || null,
    startingCapital: safeNumber(account?.startingCapital),
    realizedPnl: safeNumber(account?.realizedPnl),
    unrealizedPnl: safeNumber(account?.unrealizedPnl),
    tradingFees: safeNumber(account?.tradingFees),
    slippageCost: safeNumber(account?.slippageCost),
    fundingPnl: safeNumber(account?.fundingPnl),
    equity: safeNumber(account?.equity),
    marginUsed: safeNumber(account?.marginUsed),
    availableEquity: safeNumber(account?.availableEquity),
    positions,
    tradeHistory: (Array.isArray(account?.tradeHistory) ? account.tradeHistory : []).map(compactPositionForDashboard),
    summary: account?.summary || null
  };
}

function pageData(view) {
  const report = readJson(reportPath("latest"), null);
  if (!report) return null;
  const header = reportHeader(report);
  if (view === "signals") {
    return {
      report: {
        ...header,
        actionableSignals: report.actionableSignals || [],
        activeSignals: report.activeSignals || [],
        closedSignals: report.closedSignals || [],
        watchlist: report.watchlist || []
      },
      status: loopStatus(report)
    };
  }
  if (view === "messages") {
    return {
      report: {
        ...header,
        warnings: report.warnings || [],
        messageFeed: report.messageFeed || []
      },
      messageAggregator: publicMessageAggregatorStatus()
    };
  }
  if (view === "models") {
    return {
      report: {
        ...header,
        modelCalculations: report.modelCalculations || []
      }
    };
  }
  if (view === "logs") {
    return {
      report: header,
      status: loopStatus(report),
      log: { text: readTail(path.join(RUNTIME_DIR, "fast-loop.log"), 80_000) }
    };
  }
  const { config, account } = readAccountBundle();
  return {
    report: header,
    status: loopStatus(report),
    account: { config, account: compactAccountForDashboard(account) }
  };
}

function compactAccountForSummary(account) {
  return {
    updatedAt: account?.updatedAt || null,
    equity: safeNumber(account?.equity),
    equityCurve: (Array.isArray(account?.equityCurve) ? account.equityCurve : []).map((point) => ({
      time: point?.time,
      equity: safeNumber(point?.equity),
      returnPct: safeNumber(point?.returnPct)
    })),
    tradeHistory: (Array.isArray(account?.tradeHistory) ? account.tradeHistory : []).map((trade) => ({
      id: trade?.id || null,
      symbol: trade?.symbol || null,
      side: trade?.side || null,
      closedAt: trade?.closedAt || null,
      closeReason: trade?.closeReason || null,
      realizedPnl: safeNumber(trade?.realizedPnl),
      winRate: safeNumber(trade?.winRate),
      expectancyPct: safeNumber(trade?.expectancyPct)
    }))
  };
}

function publicPostTradeReview(account) {
  const review = account?.postTradeReview || {};
  const latest = review.latestReview || null;
  const trades = (Array.isArray(latest?.trades) ? latest.trades : []).slice(-20).map((trade) => ({
    symbol: trade?.symbol || null,
    side: trade?.side || null,
    openedAt: trade?.openedAt || null,
    closedAt: trade?.closedAt || null,
    closeReason: trade?.closeReason || null,
    realizedPnl: safeNumber(trade?.realizedPnl),
    classification: trade?.classification || null,
    entry: safeNumber(trade?.entry),
    exitPrice: safeNumber(trade?.exitPrice),
    takeProfit: safeNumber(trade?.takeProfit),
    stopLoss: safeNumber(trade?.stopLoss),
    decision: trade?.decision || null,
    factorContributions: trade?.factorContributions || [],
    exitDecision: trade?.exitDecision || null,
    exitCounterfactual: trade?.exitCounterfactual || null
  }));
  return {
    config: account?.postTradeReviewConfig,
    review: {
      ...review,
      latestReview: latest ? { ...latest, trades } : null
    },
    closedTrades: Math.max(
      Array.isArray(account?.tradeHistory) ? account.tradeHistory.length : 0,
      safeNumber(account?.lifetimeClosedTrades)
    )
  };
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
  if (url.pathname === "/api/report") {
    const layer = url.searchParams.get("layer") || "latest";
    const filePath = reportPath(layer);
    const report = readJson(filePath, null);
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
    sendJson(response, publicPostTradeReview(account));
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
        const reviewResult = maybeRunPostTradeReview(account, DEFAULT_DIRECTION_MODEL_WEIGHTS);
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
          account.sessionId = randomUUID();
          account.isActive = true;
          account.startedAt = now;
          account.updatedAt = now;
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
  if (url.pathname === "/api/account/summary") {
    const { config, account } = readAccountBundle();
    sendJson(response, { config, summary: account.summary || null, account: compactAccountForSummary(account) });
    return;
  }
  if (url.pathname === "/api/log") {
    const maxBytes = Math.min(Number(url.searchParams.get("bytes") || 80_000), 500_000);
    sendJson(response, {
      text: readTail(path.join(RUNTIME_DIR, "fast-loop.log"), maxBytes)
    });
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
});
