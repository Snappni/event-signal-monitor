#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  normalizeMessageAggregatorConfig,
  parseNewsNowPayload,
  parseRssXml
} from "./message-aggregator.mjs";
import {
  analyzeEventFreshness,
  clusterMessageItems,
  inferSourceTier,
  sourceWeightForTier,
  updateTrendHistory
} from "./news-intelligence.mjs";
import {
  buildPolymarketPriceSentiment,
  extractBinaryMarketProbabilities,
  isRoutineExchangeProductAnnouncement,
  updatePredictionMarketTracking
} from "./event-source-rules.mjs";
import {
  createPostTradeReviewState,
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  maybeRunPostTradeReview,
  normalizeDirectionWeights,
  normalizePostTradeReviewConfig,
  normalizePostTradeReviewState
} from "./post-trade-review.mjs";
import {
  ADAPTIVE_GATE_BOUNDS,
  evaluateAdaptiveEntryGate
} from "./adaptive-entry-gate.mjs";
import {
  DEFAULT_EXIT_MODEL_WEIGHTS,
  evaluateAdaptivePositionExit,
  normalizeExitWeights
} from "./adaptive-position-exit.mjs";
import { appendCompactHistory } from "./compact-history.mjs";

const RUNTIME_DIR = path.resolve(
  process.env.SIGNAL_RUNTIME_DIR || path.resolve(".runtime", "event-signal-monitor")
);
const STATE_PATH = path.resolve(RUNTIME_DIR, "state.json");
const REPORT_PATH = path.resolve(RUNTIME_DIR, "latest-report.json");
const HISTORY_PATH = path.resolve(RUNTIME_DIR, "history.jsonl");
const ACCOUNT_CONFIG_PATH = path.resolve(RUNTIME_DIR, "account.json");
const ACCOUNT_STATE_PATH = path.resolve(RUNTIME_DIR, "paper-account.json");
const WHALE_CREDENTIALS_PATH = path.resolve(RUNTIME_DIR, "whale-alert-credentials.json");
const WHALE_STATUS_PATH = path.resolve(RUNTIME_DIR, "whale-alert-status.json");
const MESSAGE_AGGREGATOR_CONFIG_PATH = path.resolve(RUNTIME_DIR, "message-aggregator-config.json");
const MESSAGE_AGGREGATOR_STATUS_PATH = path.resolve(RUNTIME_DIR, "message-aggregator-status.json");
const RUNTIME_LOG_PATH = path.resolve(RUNTIME_DIR, "fast-loop.log");
const execFileAsync = promisify(execFile);
loadDotEnv(path.resolve(".env"));

const MONITOR_VERSION = "0.15.0";
const RUN_LAYER = "unified-high-frequency";
const LAYER_REPORT_PATH = REPORT_PATH;
const LOCK_PATH = path.resolve(RUNTIME_DIR, "run.lock");
const ACCOUNT_LOCK_PATH = path.resolve(RUNTIME_DIR, "account.lock");
const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TRXUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "DOTUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "INJUSDT",
  "SUIUSDT"
];

const SYMBOLS = (process.env.SIGNAL_MONITOR_SYMBOLS || DEFAULT_SYMBOLS.join(","))
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);

const SYMBOL_ALIASES = {
  BTCUSDT: ["BTC", "BITCOIN", "WBTC"],
  ETHUSDT: ["ETH", "ETHEREUM", "STETH"],
  SOLUSDT: ["SOL", "SOLANA"],
  BNBUSDT: ["BNB", "BINANCE COIN", "BINANCE"],
  XRPUSDT: ["XRP", "RIPPLE"],
  DOGEUSDT: ["DOGE", "DOGECOIN"],
  ADAUSDT: ["ADA", "CARDANO"],
  AVAXUSDT: ["AVAX", "AVALANCHE"],
  LINKUSDT: ["LINK", "CHAINLINK"],
  TRXUSDT: ["TRX", "TRON"],
  LTCUSDT: ["LTC", "LITECOIN"],
  BCHUSDT: ["BCH", "BITCOIN CASH"],
  DOTUSDT: ["DOT", "POLKADOT"],
  NEARUSDT: ["NEAR"],
  APTUSDT: ["APT", "APTOS"],
  ARBUSDT: ["ARB", "ARBITRUM"],
  OPUSDT: ["OP", "OPTIMISM"],
  INJUSDT: ["INJ", "INJECTIVE"],
  SUIUSDT: ["SUI"],
  TONUSDT: ["TON", "TONCOIN"]
};

const CRYPTO_QUERY =
  "(bitcoin OR ethereum OR crypto OR cryptocurrency OR stablecoin OR Binance OR OKX OR ETF OR blockchain)";

const BASE_MODEL_WEIGHTS = {
  eventImpact: 0.26,
  trend: 0.12,
  momentum: 0.08,
  volatilityRegime: 0.07,
  funding: 0.04,
  openInterest: 0.04,
  liquidity: 0.04,
  gbm: 0.1,
  garch: 0.08,
  hiddenMarkov: 0.1,
  markowitz: 0.07,
  poisson: 0.04,
  bayesian: 0.08
};
const DIRECTION_MODEL_WEIGHTS = { ...DEFAULT_DIRECTION_MODEL_WEIGHTS };
const GARCH_CONFIDENCE_WEIGHT = 0.35;
const MARKOWITZ_SIZING_WEIGHT = 0.4;
const BAYESIAN_POSTERIOR_WEIGHT = 0.3;

const FETCH_IMPL = (process.env.SIGNAL_MONITOR_FETCH_IMPL || "auto")
  .trim()
  .toLowerCase();
const REQUEST_TIMEOUT_MS = toPositiveInt(process.env.SIGNAL_MONITOR_TIMEOUT_MS, 8_000);
const MARKET_CONCURRENCY = toPositiveInt(process.env.SIGNAL_MONITOR_MARKET_CONCURRENCY, 6);
const SOURCE_REFRESH_MS = {
  aggregator: toPositiveInt(process.env.SIGNAL_AGGREGATOR_REFRESH_MS, 30_000),
  gdelt: toPositiveInt(process.env.SIGNAL_GDELT_REFRESH_MS, 60_000),
  polymarket: toPositiveInt(process.env.SIGNAL_POLYMARKET_REFRESH_MS, 10_000),
  announcements: toPositiveInt(process.env.SIGNAL_ANNOUNCEMENT_REFRESH_MS, 60_000),
  whale: toPositiveInt(process.env.SIGNAL_WHALE_REFRESH_MS, 15_000)
};
const GDELT_ENABLED = process.env.SIGNAL_MONITOR_GDELT_ENABLED !== "false";
const WHALE_ALERT_ENABLED = process.env.WHALE_ALERT_ENABLED !== "false";
const OPEN_SIGNAL_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const MIN_HIGH_EXPECTANCY_R = 0.25;
const MIN_EV_PCT = 0;
const DEFAULT_FUTURES_TAKER_FEE_RATE = 0.0005;
const DEFAULT_SPOT_TAKER_FEE_RATE = 0.001;
const DEFAULT_SLIPPAGE_RATE = 0.0003;
const DEFAULT_FUNDING_INTERVAL_HOURS = 8;
const MIN_COMBINED_DIRECTION = 0.25;
const LOCK_WAIT_MS = toPositiveInt(process.env.SIGNAL_MONITOR_LOCK_WAIT_MS, 240_000);
const LOCK_STALE_MS = toPositiveInt(process.env.SIGNAL_MONITOR_LOCK_STALE_MS, 900_000);
const DEFAULT_ACCOUNT_CONFIG = {
  initialCapital: 10_000,
  quoteCurrency: "USDT",
  marketType: "futures",
  maxLeverage: 3,
  riskProfile: "conservative",
  updatedAt: null
};

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
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

async function acquireFileLock(filePath, waitMs, staleMs) {
  ensureRuntimeDir();
  const startedAt = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(filePath, "wx");
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, layer: RUN_LAYER, createdAt: new Date().toISOString() }),
        "utf8"
      );
      return () => {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close failures during process shutdown.
        }
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Another process may have already cleaned a stale lock.
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const ownerPid = Number(lock?.pid);
        if (Number.isInteger(ownerPid) && ownerPid > 0 && !isProcessRunning(ownerPid)) {
          fs.unlinkSync(filePath);
          continue;
        }
      } catch {
        // Fall through to age-based stale-lock cleanup.
      }
      try {
        const stat = fs.statSync(filePath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.unlinkSync(filePath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - startedAt > waitMs) {
        throw new Error(`Timed out waiting for lock: ${filePath}`);
      }
      await sleep(100);
    }
  }
}

function acquireRuntimeLock() {
  return acquireFileLock(LOCK_PATH, LOCK_WAIT_MS, LOCK_STALE_MS);
}

function acquireAccountLock() {
  return acquireFileLock(ACCOUNT_LOCK_PATH, 10_000, 60_000);
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
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

function appendRuntimeLog(message) {
  ensureRuntimeDir();
  fs.appendFileSync(RUNTIME_LOG_PATH, `${message}\n`, "utf8");
  try {
    const maxBytes = 5 * 1024 * 1024;
    const stat = fs.statSync(RUNTIME_LOG_PATH);
    if (stat.size > maxBytes) {
      const keepBytes = 2 * 1024 * 1024;
      const content = fs.readFileSync(RUNTIME_LOG_PATH);
      fs.writeFileSync(RUNTIME_LOG_PATH, content.subarray(Math.max(0, content.length - keepBytes)), "utf8");
    }
  } catch {
    // Logging must not stop the monitor.
  }
}

function createInitialState() {
  return {
    version: MONITOR_VERSION,
    updatedAt: null,
    modelWeights: { ...BASE_MODEL_WEIGHTS },
    openInterest: {},
    polymarket: {},
    newsTrends: {},
    sourceCache: {},
    activeSignals: {},
    closedSignals: [],
    calibration: {
      samples: 0,
      wins: 0,
      losses: 0,
      avgPredictedWinRate: 0,
      avgRealizedR: 0
    }
  };
}

async function fetchCachedSource(state, key, ttlMs, fetcher) {
  state.sourceCache = state.sourceCache && typeof state.sourceCache === "object" ? state.sourceCache : {};
  const cached = state.sourceCache[key];
  const cachedAt = Date.parse(cached?.fetchedAt || "");
  if (cached && Number.isFinite(cachedAt) && Date.now() - cachedAt < ttlMs) {
    return { value: cached.value, cached: true, fetchedAt: cached.fetchedAt, ttlMs };
  }
  const value = await fetcher();
  const failed = value?.sourceFailure || (Array.isArray(value?.sourceFailures) && value.sourceFailures.length > 0 && !value.items?.length);
  const fetchedAt = new Date().toISOString();
  if (failed && cached) {
    const refreshFailure = value?.sourceFailure || value.sourceFailures.join("；");
    return { value: cached.value, cached: true, stale: true, fetchedAt: cached.fetchedAt, attemptedAt: fetchedAt, refreshFailure, ttlMs };
  }
  if (!failed) state.sourceCache[key] = { fetchedAt, value };
  return { value, cached: false, stale: false, fetchedAt, ttlMs };
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
    updatedAt: raw.updatedAt || null
  };
}

function readAccountConfig() {
  const rawConfig = readJsonIfExists(ACCOUNT_CONFIG_PATH, DEFAULT_ACCOUNT_CONFIG);
  const config = normalizeAccountConfig(rawConfig);
  if (!rawConfig || rawConfig.riskProfile !== config.riskProfile) {
    writeJson(ACCOUNT_CONFIG_PATH, config);
  }
  return config;
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

function createPaperAccount(accountConfig, now = new Date().toISOString()) {
  const config = normalizeAccountConfig(accountConfig);
  const account = {
    version: MONITOR_VERSION,
    sessionId: randomUUID(),
    isActive: false,
    startedAt: null,
    createdAt: now,
    updatedAt: now,
    configSnapshot: config,
    startingCapital: config.initialCapital,
    realizedPnl: 0,
    unrealizedPnl: 0,
    tradingFees: 0,
    slippageCost: 0,
    fundingPnl: 0,
    equity: config.initialCapital,
    marginUsed: 0,
    availableEquity: config.initialCapital,
    positions: {},
    tradeHistory: [],
    lifetimeClosedTrades: 0,
    lifetimeWinningTrades: 0,
    postTradeReviewConfig: normalizePostTradeReviewConfig(),
    postTradeReview: createPostTradeReviewState(DIRECTION_MODEL_WEIGHTS, null),
    equityCurve: [
      {
        time: now,
        equity: config.initialCapital,
        returnPct: 0,
        realizedPnl: 0,
        unrealizedPnl: 0
      }
    ],
    summary: null
  };
  account.postTradeReview.sessionId = account.sessionId;
  account.summary = buildPaperAccountSummary(account);
  return account;
}

function readPaperAccount(accountConfig) {
  const config = normalizeAccountConfig(accountConfig);
  const account = readJsonIfExists(ACCOUNT_STATE_PATH, null);
  if (!account || !sameAccountConfig(account.configSnapshot, config)) {
    return createPaperAccount(config);
  }
  account.configSnapshot = config;
  account.positions = account.positions || {};
  account.sessionId = account.sessionId || account.createdAt || randomUUID();
  if (typeof account.isActive !== "boolean") account.isActive = true;
  if (!Object.hasOwn(account, "startedAt")) {
    account.startedAt = account.isActive ? account.createdAt : null;
  }
  account.tradingFees = safeNumber(account.tradingFees);
  account.slippageCost = safeNumber(account.slippageCost);
  account.fundingPnl = safeNumber(account.fundingPnl);
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
    DIRECTION_MODEL_WEIGHTS,
    account.sessionId
  );
  for (const position of account.tradeHistory) {
    position.riskProfile =
      position.riskProfile === "aggressive" ? "aggressive" : config.riskProfile;
  }
  for (const position of Object.values(account.positions)) {
    position.accountMarketType = position.accountMarketType || config.marketType;
    position.signalEntryPrice = safeNumber(position.signalEntryPrice, position.entry);
    position.entryFee = safeNumber(position.entryFee);
    position.entrySlippageCost = safeNumber(position.entrySlippageCost);
    position.exitFee = safeNumber(position.exitFee);
    position.exitSlippageCost = safeNumber(position.exitSlippageCost);
    position.fundingPnl = safeNumber(position.fundingPnl);
    position.fundingSettlements = safeNumber(position.fundingSettlements);
    position.feeRate = safeNumber(position.feeRate, config.takerFeeRate);
    position.slippageRate = safeNumber(position.slippageRate, config.slippageRate);
    position.fundingIntervalHours = safeNumber(
      position.fundingIntervalHours,
      config.fundingIntervalHours
    );
    if (!position.nextFundingAt && config.marketType === "futures") {
      position.nextFundingAt = nextFundingSettlement(Date.now(), position.fundingIntervalHours);
    }
  }
  account.tradeHistory = Array.isArray(account.tradeHistory) ? account.tradeHistory : [];
  account.equityCurve = Array.isArray(account.equityCurve) && account.equityCurve.length
    ? account.equityCurve
    : createPaperAccount(accountConfig).equityCurve;
  account.summary = buildPaperAccountSummary(account);
  return account;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function ema(values, period) {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
  }
  return current;
}

function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }
  return mean(trueRanges.slice(-period));
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  const deltas = [];
  for (let index = 1; index < values.length; index += 1) {
    deltas.push(values[index] - values[index - 1]);
  }
  const recent = deltas.slice(-period);
  const avgGain = mean(recent.map((value) => Math.max(value, 0)));
  const avgLoss = mean(recent.map((value) => Math.max(-value, 0)));
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function gaussianDensity(value, center, deviation) {
  const sigma = Math.max(Math.abs(deviation), 1e-9);
  const z = (value - center) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function calculateLogReturns(values) {
  const returns = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = safeNumber(values[index - 1]);
    const current = safeNumber(values[index]);
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  return returns;
}

function analyzeGeometricBrownianMotion(returns, horizonSteps = 4) {
  const sample = returns.slice(-96);
  const meanLogReturn = mean(sample);
  const sigma = std(sample);
  const horizonLogMean = meanLogReturn * horizonSteps;
  const horizonVolatility = sigma * Math.sqrt(horizonSteps);
  const expectedReturn = Math.exp(horizonLogMean + 0.5 * sigma * sigma * horizonSteps) - 1;
  const probabilityUp = sigma > 0 ? normalCdf(horizonLogMean / Math.max(horizonVolatility, 1e-9)) : 0.5;
  const probabilitySignal = (probabilityUp - 0.5) * 2;
  const expectedReturnSignal =
    horizonVolatility > 0 ? clamp(expectedReturn / Math.max(horizonVolatility * 1.5, 1e-9), -1, 1) : 0;
  const signal = clamp(probabilitySignal * 0.7 + expectedReturnSignal * 0.3, -1, 1);
  return {
    horizonSteps,
    observations: sample.length,
    meanLogReturn,
    sigma,
    expectedReturn,
    probabilityUp,
    signal,
    formula:
      "GBM: ln(S[t+h]/S[t]) ~ N(m*h, sigma^2*h); E[S[t+h]/S[t]-1] = exp(m*h + 0.5*sigma^2*h)-1"
  };
}

function estimateGarch11(returns) {
  const sample = returns.slice(-96);
  const sampleVariance = Math.max(std(sample) ** 2, 1e-12);
  const alphaGrid = [0.05, 0.08, 0.12, 0.16];
  const betaGrid = [0.72, 0.8, 0.86, 0.9, 0.93];
  let best = null;

  for (const alpha of alphaGrid) {
    for (const beta of betaGrid) {
      if (alpha + beta >= 0.985) continue;
      const omega = sampleVariance * (1 - alpha - beta);
      let variance = sampleVariance;
      let logLikelihood = 0;
      for (const value of sample) {
        variance = Math.max(omega + alpha * value * value + beta * variance, 1e-12);
        logLikelihood += -0.5 * (Math.log(2 * Math.PI) + Math.log(variance) + (value * value) / variance);
      }
      if (!best || logLikelihood > best.logLikelihood) {
        best = { alpha, beta, omega, variance, logLikelihood };
      }
    }
  }

  const fallback = {
    alpha: 0.08,
    beta: 0.9,
    omega: sampleVariance * 0.02,
    variance: sampleVariance,
    logLikelihood: 0
  };
  const parameters = best || fallback;
  const latestReturn = safeNumber(sample.at(-1));
  const forecastVariance = Math.max(
    parameters.omega + parameters.alpha * latestReturn * latestReturn + parameters.beta * parameters.variance,
    1e-12
  );
  const forecastVolatility = Math.sqrt(forecastVariance);
  const baselineVolatility = Math.sqrt(sampleVariance);
  const volatilityRatio = baselineVolatility > 0 ? forecastVolatility / baselineVolatility : 1;
  const stabilityScore = clamp(1.25 - volatilityRatio * 0.35, 0, 1);
  const confidenceMultiplier =
    1 - GARCH_CONFIDENCE_WEIGHT + GARCH_CONFIDENCE_WEIGHT * stabilityScore;
  return {
    observations: sample.length,
    alpha: parameters.alpha,
    beta: parameters.beta,
    omega: parameters.omega,
    persistence: parameters.alpha + parameters.beta,
    forecastVariance,
    forecastVolatility,
    volatilityRatio,
    stabilityScore,
    confidenceMultiplier,
    formula:
      "GARCH(1,1): sigma[t+1]^2 = omega + alpha*epsilon[t]^2 + beta*sigma[t]^2; final signal magnitude *= 0.65 + 0.35*stability"
  };
}

function analyzeHiddenMarkovRegime(returns) {
  const sample = returns.slice(-96);
  const sigma = Math.max(std(sample), 1e-6);
  const states = [
    { name: "bull", mean: sigma * 0.35, deviation: sigma * 0.9 },
    { name: "bear", mean: -sigma * 0.35, deviation: sigma * 0.9 },
    { name: "range", mean: 0, deviation: sigma * 0.55 }
  ];
  const transition = [
    [0.92, 0.03, 0.05],
    [0.03, 0.92, 0.05],
    [0.08, 0.08, 0.84]
  ];
  let probabilities = [1 / 3, 1 / 3, 1 / 3];

  for (const value of sample) {
    const predicted = states.map((_, nextState) =>
      probabilities.reduce(
        (sum, probability, previousState) => sum + probability * transition[previousState][nextState],
        0
      )
    );
    const filtered = states.map(
      (state, index) => predicted[index] * gaussianDensity(value, state.mean, state.deviation)
    );
    const total = filtered.reduce((sum, value) => sum + value, 0);
    probabilities =
      total > 0 ? filtered.map((value) => value / total) : [1 / 3, 1 / 3, 1 / 3];
  }

  const regimeIndex = probabilities.indexOf(Math.max(...probabilities));
  return {
    observations: sample.length,
    regime: states[regimeIndex].name,
    bullProbability: probabilities[0],
    bearProbability: probabilities[1],
    rangeProbability: probabilities[2],
    confidence: probabilities[regimeIndex],
    signal: clamp(probabilities[0] - probabilities[1], -1, 1),
    transition,
    formula:
      "HMM filter: P(z[t]|r[1:t]) proportional to Normal(r[t]|mu[z],sigma[z]) * sum(P(z[t]|z[t-1])*P(z[t-1]|r[1:t-1]))"
  };
}

function poissonProbability(k, lambda) {
  const count = Math.max(0, Math.floor(safeNumber(k)));
  const rate = Math.max(1e-9, safeNumber(lambda, 1e-9));
  let probability = Math.exp(-rate);
  for (let index = 1; index <= count; index += 1) {
    probability *= rate / index;
  }
  return probability;
}

function poissonCdf(k, lambda) {
  const count = Math.max(0, Math.floor(safeNumber(k)));
  let total = 0;
  for (let index = 0; index <= count; index += 1) {
    total += poissonProbability(index, lambda);
  }
  return clamp(total, 0, 1);
}

function poissonTailProbability(k, lambda) {
  const count = Math.max(0, Math.floor(safeNumber(k)));
  if (count <= 0) return 1;
  return clamp(1 - poissonCdf(count - 1, lambda), 0, 1);
}

function analyzePoissonEventArrival(eventAggregate, eventScoreNorm, highImpactEvent) {
  const observedEvents = Math.max(
    0,
    Math.floor(safeNumber(eventAggregate.eventCount, eventAggregate.events?.length || 0))
  );
  const baselineLambda = clamp(
    0.25 + eventScoreNorm * 1.65 + (highImpactEvent ? 0.35 : 0),
    0.05,
    4
  );
  const tailProbability = observedEvents > 0 ? poissonTailProbability(observedEvents, baselineLambda) : 1;
  const eventClusterScore =
    observedEvents > 0
      ? clamp((observedEvents - baselineLambda) / Math.sqrt(baselineLambda + 1e-9), -3, 3)
      : 0;
  const burstSurprise = observedEvents > 0 ? clamp(1 - tailProbability, 0, 1) : 0;
  const directionalIntensity = burstSurprise * Math.abs(safeNumber(eventAggregate.direction));
  return {
    observedEvents,
    baselineLambda,
    tailProbability,
    burstSurprise,
    eventClusterScore,
    directionalIntensity,
    formula:
      "Poisson: P(N>=k)=1-CDF(k-1;lambda). k=observed relevant events, lambda=baseline event arrival rate. Low tail probability means event clustering is unusual."
  };
}

function bayesianWinRateUpdate({
  priorWinRate,
  combinedDirection,
  eventScoreNorm,
  alignment,
  volatilityRegimeScore,
  advancedModelQualityBoost,
  poisson,
  roundTripExecutionCostPct,
  riskPct
}) {
  const prior = clamp(priorWinRate, 0.35, 0.86);
  const eventAgreement =
    alignment > 0
      ? eventScoreNorm * (0.55 + poisson.burstSurprise * 0.45)
      : alignment < 0
        ? -eventScoreNorm * (0.65 + poisson.burstSurprise * 0.35)
        : 0;
  const costToRisk = riskPct > 0 ? roundTripExecutionCostPct / riskPct : 0;
  const winEvidence =
    Math.abs(combinedDirection) * 0.75 +
    Math.max(0, eventAgreement) * 0.5 +
    Math.max(0, advancedModelQualityBoost) * 7 +
    Math.max(0, volatilityRegimeScore) * 0.35;
  const lossEvidence =
    Math.max(0, -eventAgreement) * 0.6 +
    Math.max(0, -volatilityRegimeScore) * 0.4 +
    clamp(costToRisk, 0, 2) * 0.28;
  const likelihoodWin = clamp(Math.exp(winEvidence), 0.35, 2.8);
  const likelihoodLoss = clamp(Math.exp(lossEvidence), 0.35, 2.8);
  const numerator = prior * likelihoodWin;
  const denominator = numerator + (1 - prior) * likelihoodLoss;
  const posteriorWinRate = denominator > 0 ? numerator / denominator : prior;
  return {
    priorWinRate: prior,
    eventAgreement,
    costToRisk,
    likelihoodWin,
    likelihoodLoss,
    posteriorWinRate: clamp(posteriorWinRate, 0.35, 0.86),
    adjustment: clamp(posteriorWinRate - prior, -0.08, 0.08),
    formula:
      "Bayes: P(win|evidence)=P(win)*L(evidence|win)/(P(win)*L(evidence|win)+(1-P(win))*L(evidence|loss)). Evidence includes direction strength, event agreement, Poisson event burst, volatility regime and execution cost."
  };
}

function parseBinanceKline(row) {
  return {
    time: safeNumber(row[0]),
    open: safeNumber(row[1]),
    high: safeNumber(row[2]),
    low: safeNumber(row[3]),
    close: safeNumber(row[4]),
    volume: safeNumber(row[5])
  };
}

function parseOkxCandle(row) {
  return {
    time: safeNumber(row[0]),
    open: safeNumber(row[1]),
    high: safeNumber(row[2]),
    low: safeNumber(row[3]),
    close: safeNumber(row[4]),
    volume: safeNumber(row[5])
  };
}

async function fetchJson(url, options = {}) {
  if (FETCH_IMPL === "powershell") {
    return fetchJsonWithPowerShell(url, options);
  }
  if (FETCH_IMPL === "node") {
    return fetchJsonWithNode(url, options);
  }
  try {
    return await fetchJsonWithNode(url, options);
  } catch (nodeError) {
    try {
      return await fetchJsonWithPowerShell(url, options);
    } catch (powerShellError) {
      const nodeMessage = nodeError instanceof Error ? nodeError.message : String(nodeError);
      const powerShellMessage = powerShellError instanceof Error ? powerShellError.message : String(powerShellError);
      throw new Error(`Node fetch failed: ${nodeMessage}; PowerShell fetch failed: ${powerShellMessage}`);
    }
  }
}

async function fetchText(url, options = {}) {
  if (FETCH_IMPL === "powershell") {
    return fetchTextWithPowerShell(url, options);
  }
  if (FETCH_IMPL === "node") {
    return fetchTextWithNode(url, options);
  }
  try {
    return await fetchTextWithNode(url, options);
  } catch (nodeError) {
    try {
      return await fetchTextWithPowerShell(url, options);
    } catch (powerShellError) {
      const nodeMessage = nodeError instanceof Error ? nodeError.message : String(nodeError);
      const powerShellMessage = powerShellError instanceof Error ? powerShellError.message : String(powerShellError);
      throw new Error(`Node fetch failed: ${nodeMessage}; PowerShell fetch failed: ${powerShellMessage}`);
    }
  }
}

async function fetchTextWithNode(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 event-signal-monitor/0.8",
        Accept: options.accept || "application/rss+xml,application/atom+xml,text/xml,text/plain,*/*",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithPowerShell(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutSec = Math.max(2, Math.ceil(timeoutMs / 1000));
  const command = [
    "$ProgressPreference='SilentlyContinue';",
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);",
    "$url=$env:SIGNAL_MONITOR_REQUEST_URL;",
    "$timeoutSec=[int]$env:SIGNAL_MONITOR_REQUEST_TIMEOUT_SEC;",
    "$accept=$env:SIGNAL_MONITOR_REQUEST_ACCEPT;",
    "$headers=@{'User-Agent'='Mozilla/5.0 event-signal-monitor/0.8';'Accept'=$accept};",
    "$response=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec -Headers $headers;",
    "[Console]::Write($response.Content)"
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      timeout: timeoutMs + 6_000,
      windowsHide: true,
      env: {
        ...process.env,
        SIGNAL_MONITOR_REQUEST_URL: url,
        SIGNAL_MONITOR_REQUEST_TIMEOUT_SEC: String(timeoutSec),
        SIGNAL_MONITOR_REQUEST_ACCEPT:
          options.accept || "application/rss+xml,application/atom+xml,text/xml,text/plain,*/*"
      },
      maxBuffer: 8 * 1024 * 1024
    }
  );
  return stdout;
}

async function fetchJsonWithNode(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 event-signal-monitor/0.2",
        Accept: "application/json,text/plain,*/*",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithPowerShell(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutSec = Math.max(2, Math.ceil(timeoutMs / 1000));
  const command = [
    "$ProgressPreference='SilentlyContinue';",
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);",
    "$url=$env:SIGNAL_MONITOR_REQUEST_URL;",
    "$timeoutSec=[int]$env:SIGNAL_MONITOR_REQUEST_TIMEOUT_SEC;",
    "$headers=@{'User-Agent'='Mozilla/5.0 event-signal-monitor/0.4';'Accept'='application/json,text/plain,*/*'};",
    "$response=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec -Headers $headers;",
    "[Console]::Write($response.Content)"
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      timeout: timeoutMs + 6_000,
      windowsHide: true,
      env: {
        ...process.env,
        SIGNAL_MONITOR_REQUEST_URL: url,
        SIGNAL_MONITOR_REQUEST_TIMEOUT_SEC: String(timeoutSec)
      },
      maxBuffer: 8 * 1024 * 1024
    }
  );
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`JSON parse failed: ${message}; body=${stdout.slice(0, 180)}`);
  }
}

async function fetchWithFallback(label, fetcher, fallback) {
  try {
    return await fetcher();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallback,
      sourceFailure: `${localizeSourceLabel(label)}：${localizeErrorMessage(message)}`
    };
  }
}

function localizeSourceLabel(label) {
  if (/ market data$/i.test(label)) return label.replace(/ market data$/i, " 行情数据");
  if (/ funding$/i.test(label)) return label.replace(/ funding$/i, " 资金费率");
  if (/ open interest$/i.test(label)) return label.replace(/ open interest$/i, " OI");
  const sourceMap = {
    "Binance announcements": "Binance 公告",
    "OKX announcements": "OKX 公告",
    GDELT: "GDELT 新闻",
    "Message aggregator": "消息聚合器",
    Polymarket: "Polymarket 盘口",
    WhaleAlert: "WhaleAlert 巨鲸监控"
  };
  return sourceMap[label] || label;
}

function localizeErrorMessage(message) {
  const whaleApiKey = readWhaleAlertApiKey();
  const text = String(message || "")
    .replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]")
    .replace(new RegExp(escapeRegExp(whaleApiKey || "__NO_KEY__"), "g"), "[REDACTED]");
  const parts = [];
  if (/429|Too Many Requests/i.test(text)) parts.push("接口限流");
  if (/aborted|AbortError/i.test(text)) parts.push("请求超时或被中止");
  if (/fetch failed/i.test(text)) parts.push("网络请求失败");
  if (/empty response/i.test(text)) parts.push("接口返回为空");
  if (/unavailable/i.test(text)) parts.push("数据源不可用");
  if (!parts.length) parts.push(text || "未知错误");
  return [...new Set(parts)].join("；");
}

function readWhaleAlertApiKey() {
  const credentials = readJsonIfExists(WHALE_CREDENTIALS_PATH, null);
  const storedKey = typeof credentials?.apiKey === "string" ? credentials.apiKey.trim() : "";
  return storedKey || String(process.env.WHALE_ALERT_API_KEY || "").trim();
}

function writeWhaleAlertStatus(value) {
  writeJson(WHALE_STATUS_PATH, {
    provider: "Whale Alert",
    ...value,
    updatedAt: new Date().toISOString()
  });
}

function readMessageAggregatorConfig() {
  const saved = readJsonIfExists(MESSAGE_AGGREGATOR_CONFIG_PATH, null);
  const environmentConfig = {
    enabled: process.env.MESSAGE_AGGREGATOR_ENABLED,
    filterKeywords: process.env.MESSAGE_FILTER_KEYWORDS,
    maxItemsPerSource: process.env.MESSAGE_MAX_ITEMS_PER_SOURCE
  };
  try {
    return normalizeMessageAggregatorConfig(saved || environmentConfig);
  } catch (error) {
    return {
      ...normalizeMessageAggregatorConfig({ enabled: false }),
      configurationError: error instanceof Error ? error.message : String(error)
    };
  }
}

function writeMessageAggregatorStatus(value) {
  writeJson(MESSAGE_AGGREGATOR_STATUS_PATH, {
    provider: "Message Aggregator",
    ...value,
    updatedAt: new Date().toISOString()
  });
}

async function firstSuccessful(label, fetchers) {
  const reasons = [];
  for (const fetcher of fetchers) {
    try {
      const value = await fetcher();
      if (Array.isArray(value) && value.length) return value;
      reasons.push("empty response");
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`${label} unavailable: ${reasons.join(" | ") || "empty response"}`);
}

async function firstSuccessfulNumber(label, fetchers) {
  const reasons = [];
  for (const fetcher of fetchers) {
    try {
      const value = Number(await fetcher());
      if (Number.isFinite(value)) return value;
      reasons.push("empty response");
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`${label} unavailable: ${reasons.join(" | ") || "empty response"}`);
}

async function fetchBinanceKlines(symbol, interval, limit) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const rows = await fetchJson(url);
  return rows.map(parseBinanceKline).filter((candle) => candle.close > 0);
}

async function fetchOkxKlines(symbol, interval, limit) {
  const instId = symbol.replace("USDT", "-USDT-SWAP");
  const okxInterval = interval === "1h" ? "1H" : interval;
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${okxInterval}&limit=${limit}`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map(parseOkxCandle).reverse().filter((candle) => candle.close > 0);
}

async function fetchCandles(symbol, interval, limit) {
  return firstSuccessful(`${symbol} ${interval} candles`, [
    () => fetchOkxKlines(symbol, interval, limit),
    () => fetchBinanceKlines(symbol, interval, limit)
  ]);
}

async function fetchBinanceOpenInterest(symbol) {
  const data = await fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
  return safeNumber(data?.openInterest);
}

async function fetchBinanceFunding(symbol) {
  const data = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
  return safeNumber(data?.lastFundingRate);
}

async function fetchOkxOpenInterest(symbol) {
  const instId = symbol.replace("USDT", "-USDT-SWAP");
  const data = await fetchJson(
    `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`
  );
  return Number(data?.data?.[0]?.oi);
}

async function fetchOkxFunding(symbol) {
  const instId = symbol.replace("USDT", "-USDT-SWAP");
  const data = await fetchJson(
    `https://www.okx.com/api/v5/public/funding-rate-history?instId=${instId}&limit=1`
  );
  return Number(data?.data?.[0]?.fundingRate);
}

async function fetchOpenInterest(symbol) {
  return firstSuccessfulNumber(`${symbol} open interest`, [
    () => fetchOkxOpenInterest(symbol),
    () => fetchBinanceOpenInterest(symbol)
  ]);
}

async function fetchFunding(symbol) {
  return firstSuccessfulNumber(`${symbol} funding`, [
    () => fetchOkxFunding(symbol),
    () => fetchBinanceFunding(symbol)
  ]);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const numeric = Number(value);
    const milliseconds = numeric > 0 && numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const compact = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/i);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function flattenArticleLikeObjects(value, source, maxItems = 30) {
  const items = [];
  const seen = new Set();

  function visit(node) {
    if (!node || items.length >= maxItems) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;

    const maybeTitle = node.title || node.name || node.question || node.heading;
    if (typeof maybeTitle === "string" && maybeTitle.trim().length > 5) {
      const text = normalizeText(
        [
          maybeTitle,
          node.subtitle,
          node.summary,
          node.description,
          node.slug,
          node.publishedDate,
          node.createTime,
          node.date
        ]
          .filter(Boolean)
          .join(" ")
      );
      const url = node.url || node.link || node.articleUrl || node.shareLink || node.sourceUrl || "";
      const key = `${source}:${text}:${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          source,
          title: normalizeText(maybeTitle),
          text,
          url: typeof url === "string" ? url : "",
          occurredAt: normalizeSourceTimestamp(
            node.publishedDate || node.publishedAt || node.createTime || node.releaseDate || node.updatedAt || node.date
          ),
          raw: node
        });
      }
    }

    for (const nested of Object.values(node)) {
      if (typeof nested === "object") visit(nested);
    }
  }

  visit(value);
  return items;
}

async function fetchGdeltNews() {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
    CRYPTO_QUERY
  )}&mode=ArtList&format=json&maxrecords=25&sort=hybridrel`;
  const data = await fetchJson(url);
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  return articles.map((article) => ({
    source: "GDELT",
    title: normalizeText(article.title),
    text: normalizeText([article.title, article.seendate, article.domain].filter(Boolean).join(" ")),
    url: article.url || "",
    occurredAt: normalizeSourceTimestamp(article.seendate),
    raw: article
  }));
}

async function fetchPolymarketMarkets(state) {
  const url =
    "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=10";
  const data = await fetchJson(url, { timeoutMs: Math.max(20_000, REQUEST_TIMEOUT_MS) });
  const rows = Array.isArray(data)
    ? [...data]
        .sort(
          (left, right) =>
            safeNumber(right?.volume24hr, safeNumber(right?.volume)) -
            safeNumber(left?.volume24hr, safeNumber(left?.volume))
        )
        .flatMap((event) => (Array.isArray(event?.markets) ? event.markets : []))
    : [];
  const discovered = rows.slice(0, 30);
  const discoveredIds = new Set(
    discovered.map((market) => String(market.id || market.conditionId || market.slug || market.question))
  );
  const trackedIds = Object.entries(state.polymarket || {})
    .filter(([id, record]) => id && record?.closed !== true && record?.status !== "closed" && !discoveredIds.has(id))
    .map(([id]) => id);
  const trackedRows = await mapWithConcurrency(trackedIds, 6, async (id) => {
    try {
      const market = await fetchJson(`https://gamma-api.polymarket.com/markets/${encodeURIComponent(id)}`, {
        timeoutMs: 8_000
      });
      return market && typeof market === "object" && !Array.isArray(market) ? market : null;
    } catch {
      return null;
    }
  });
  const combined = new Map();
  for (const market of [...discovered, ...trackedRows.filter(Boolean)]) {
    const id = String(market.id || market.conditionId || market.slug || market.question || "");
    if (id) combined.set(id, market);
  }
  const receivedAt = new Date().toISOString();

  return [...combined.values()].map((market) => {
      const marketId = String(market.id || market.conditionId || market.slug || market.question);
      const previous = state.polymarket?.[marketId] || {};
      const prices = parseMaybeJsonArray(market.outcomePrices);
      const yesPrice = prices.length ? safeNumber(prices[0], null) : safeNumber(market.lastTradePrice, null);
      const previousYesPrice = previous.yesPrice ?? null;
      const priceDelta =
        typeof yesPrice === "number" && typeof previousYesPrice === "number" ? yesPrice - previousYesPrice : 0;
      const sentiment = buildPolymarketPriceSentiment(market, previous);
      const binary = extractBinaryMarketProbabilities(market);
      const volume = safeNumber(market.volume, safeNumber(market.volume24hr));
      const liquidity = safeNumber(market.liquidity);
      const outcomeProbabilities = binary?.probabilities || [];
      const outcomeLabels = binary?.labels || [];
      return {
        source: "Polymarket",
        type: "prediction",
        provider: "Polymarket",
        id: marketId,
        title: normalizeText(market.question || market.title || market.slug),
        text: normalizeText(
          [
            market.question,
            market.title,
            market.slug,
            `volume=${market.volume || market.volume24hr || ""}`,
            `liquidity=${market.liquidity || ""}`,
            `yes=${yesPrice ?? ""}`,
            `delta=${priceDelta.toFixed(4)}`,
            sentiment ? `bull=${sentiment.bullProbability.toFixed(4)}` : "",
            sentiment ? `bear=${sentiment.bearProbability.toFixed(4)}` : "",
            Number.isFinite(sentiment?.bullBearRatio) ? `bullBearRatio=${sentiment.bullBearRatio.toFixed(4)}` : "",
            sentiment ? `bullDelta=${sentiment.bullProbabilityDelta.toFixed(4)}` : ""
          ].join(" ")
        ),
        url: market.slug ? `https://polymarket.com/market/${market.slug}` : "",
        receivedAt,
        yesPrice,
        priceDelta,
        yesProbability: sentiment?.yesProbability ?? null,
        noProbability: sentiment?.noProbability ?? null,
        outcomeLabels,
        outcomeProbabilities,
        outcomeRatio: binary?.ratio ?? null,
        volume,
        liquidity,
        volumeDelta: Number.isFinite(Number(previous.volume)) ? volume - Number(previous.volume) : 0,
        liquidityDelta: Number.isFinite(Number(previous.liquidity)) ? liquidity - Number(previous.liquidity) : 0,
        symbol: sentiment?.symbol || null,
        isPricePrediction: Boolean(sentiment),
        yesProbability: sentiment?.yesProbability ?? null,
        noProbability: sentiment?.noProbability ?? null,
        bullProbability: sentiment?.bullProbability ?? null,
        bearProbability: sentiment?.bearProbability ?? null,
        bullBearRatio: sentiment?.bullBearRatio ?? null,
        bullProbabilityDelta: sentiment?.bullProbabilityDelta ?? null,
        sentimentDirection: sentiment?.direction ?? null,
        sentimentImpact: sentiment?.sentimentImpact ?? null,
        monitoringStatus: market.closed === true ? "closed" : "tracking",
        monitoringStartedAt: previous.firstSeenAt || receivedAt,
        monitoringObservations: Math.max(0, safeNumber(previous.observations)) + 1,
        marketActive: market.active !== false,
        marketClosed: market.closed === true,
        marketEndDate: normalizeSourceTimestamp(market.endDate),
        marketSlug: market.slug || null,
        metrics: sentiment
          ? {
              symbol: sentiment.symbol,
              orientation: sentiment.orientation,
              yesProbability: roundNumber(sentiment.yesProbability),
              noProbability: roundNumber(sentiment.noProbability),
              bullProbability: roundNumber(sentiment.bullProbability),
              bearProbability: roundNumber(sentiment.bearProbability),
              bullBearRatio: roundNumber(sentiment.bullBearRatio),
              bullProbabilityDelta: roundNumber(sentiment.bullProbabilityDelta),
              volume: roundNumber(volume),
              liquidity: roundNumber(liquidity),
              volumeDelta: roundNumber(Number.isFinite(Number(previous.volume)) ? volume - Number(previous.volume) : 0),
              liquidityDelta: roundNumber(
                Number.isFinite(Number(previous.liquidity)) ? liquidity - Number(previous.liquidity) : 0
              ),
              monitoringStatus: market.closed === true ? "closed" : "tracking",
              monitoringObservations: Math.max(0, safeNumber(previous.observations)) + 1,
              monitoringStartedAt: previous.firstSeenAt || receivedAt,
              marketEndDate: normalizeSourceTimestamp(market.endDate)
            }
          : {
              outcomeLabels,
              outcomeProbabilities: outcomeProbabilities.map((value) => roundNumber(value)),
              outcomeRatio: roundNumber(binary?.ratio),
              volume: roundNumber(volume),
              liquidity: roundNumber(liquidity),
              volumeDelta: roundNumber(Number.isFinite(Number(previous.volume)) ? volume - Number(previous.volume) : 0),
              liquidityDelta: roundNumber(
                Number.isFinite(Number(previous.liquidity)) ? liquidity - Number(previous.liquidity) : 0
              ),
              monitoringStatus: market.closed === true ? "closed" : "tracking",
              monitoringObservations: Math.max(0, safeNumber(previous.observations)) + 1,
              monitoringStartedAt: previous.firstSeenAt || receivedAt,
              marketEndDate: normalizeSourceTimestamp(market.endDate)
            },
        raw: market
      };
    });
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchBinanceAnnouncements() {
  const endpoints = [
    "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=20",
    "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=30"
  ];
  const items = [];
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint);
      items.push(...flattenArticleLikeObjects(data, "Binance"));
      if (items.length) break;
    } catch {
      // Try next endpoint.
    }
  }
  return items.filter((item) => !isRoutineExchangeProductAnnouncement(item)).slice(0, 30);
}

async function fetchOkxAnnouncements() {
  const endpoints = [
    "https://www.okx.com/help/hc/api/internal/recentlyPublished?locale=en_US&category=announcements&page=1&limit=20",
    "https://www.okx.com/help/hc/api/internal/recentlyPublished?locale=zh_CN&category=announcements&page=1&limit=20"
  ];
  const items = [];
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint);
      items.push(...flattenArticleLikeObjects(data, "OKX"));
      if (items.length) break;
    } catch {
      // Try next endpoint.
    }
  }
  return items.filter((item) => !isRoutineExchangeProductAnnouncement(item)).slice(0, 30);
}

function deduplicateMessageItems(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  return items.filter((item) => {
    const sourceKey = normalizeText(item.source || item.provider).toLocaleLowerCase();
    const url = normalizeText(item.url).toLocaleLowerCase();
    const title = normalizeText(item.title).toLocaleLowerCase();
    const urlKey = url ? `${sourceKey}:${url}` : "";
    const titleKey = title ? `${sourceKey}:${title}` : "";
    if ((!urlKey && !titleKey) || (urlKey && seenUrls.has(urlKey)) || (titleKey && seenTitles.has(titleKey))) return false;
    if (urlKey) seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);
    return true;
  });
}

async function fetchMessageAggregator() {
  const config = readMessageAggregatorConfig();
  const configured = config.rssFeeds.length + config.trendSources.length > 0;
  if (!config.enabled || !configured || config.configurationError) {
    const error = config.configurationError || null;
    writeMessageAggregatorStatus({
      configured,
      enabled: config.enabled,
      connected: false,
      degraded: false,
      messageCount: 0,
      checkedAt: new Date().toISOString(),
      sources: [],
      errorCode: error ? "invalid_configuration" : null,
      error
    });
    return { items: [], sourceFailures: error ? [`消息聚合器：${error}`] : [] };
  }

  const jobs = [
    ...config.rssFeeds.map((feed) => ({
      type: "rss",
      name: feed.name,
      url: feed.url,
      run: async () => parseRssXml(await fetchText(feed.url), feed, config)
    })),
    ...config.trendSources.map((source) => ({
      type: "trend",
      name: source.name,
      url: source.url,
      run: async () => {
        const payload = await fetchJson(source.url, {
          timeoutMs: 8_000,
          headers: {
            Referer: "https://newsnow.busiyi.world/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
          }
        });
        return parseNewsNowPayload(payload, source, config);
      }
    }))
  ];
  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const startedAt = Date.now();
      const rows = await job.run();
      const fetchLatencyMs = Date.now() - startedAt;
      return {
        fetchLatencyMs,
        rows: rows.map((item) => ({
          ...item,
          metrics: { ...(item.metrics || {}), fetchLatencyMs }
        }))
      };
    })
  );
  const items = [];
  const sources = [];
  const sourceFailures = [];
  settled.forEach((result, index) => {
    const job = jobs[index];
    if (result.status === "fulfilled") {
      items.push(...result.value.rows);
      sources.push({
        type: job.type,
        name: job.name,
        url: job.url,
        connected: true,
        messageCount: result.value.rows.length,
        latencyMs: result.value.fetchLatencyMs,
        error: null
      });
      return;
    }
    const error = localizeErrorMessage(result.reason instanceof Error ? result.reason.message : String(result.reason));
    sources.push({ type: job.type, name: job.name, url: job.url, connected: false, messageCount: 0, latencyMs: null, error });
    sourceFailures.push(`消息聚合器 ${job.name}：${error}`);
  });
  const deduplicatedItems = deduplicateMessageItems(items);
  const connectedCount = sources.filter((source) => source.connected).length;
  writeMessageAggregatorStatus({
    configured: true,
    enabled: true,
    connected: connectedCount > 0,
    degraded: connectedCount > 0 && connectedCount < sources.length,
    messageCount: deduplicatedItems.length,
    checkedAt: new Date().toISOString(),
    sources,
    errorCode: connectedCount ? null : "all_sources_failed",
    error: connectedCount ? null : "所有已配置聚合源均连接失败。"
  });
  return { items: deduplicatedItems, sourceFailures };
}

async function fetchWhaleAlertIfConfigured() {
  const apiKey = readWhaleAlertApiKey();
  if (!WHALE_ALERT_ENABLED || !apiKey) {
    writeWhaleAlertStatus({
      configured: Boolean(apiKey),
      connected: false,
      messageCount: 0,
      errorCode: WHALE_ALERT_ENABLED ? "not_configured" : "disabled",
      error: WHALE_ALERT_ENABLED ? "未配置 Whale Alert API Key。" : "Whale Alert 已由聚合消息源替代。"
    });
    return {
      items: [],
      warning: null
    };
  }
  try {
    const start = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    const url = `https://api.whale-alert.io/v1/transactions?api_key=${encodeURIComponent(
      apiKey
    )}&min_value=5000000&start=${start}`;
    const data = await fetchJson(url);
    if (data?.result && data.result !== "success") {
      throw new Error(String(data?.message || data?.result));
    }
    if (!Array.isArray(data?.transactions)) {
      throw new Error("Whale Alert response does not contain a transactions array");
    }
    const transactions = data.transactions;
    writeWhaleAlertStatus({
      configured: true,
      connected: true,
      messageCount: transactions.length,
      checkedAt: new Date().toISOString(),
      errorCode: null,
      error: null
    });
    return {
      items: transactions.slice(0, 30).map((tx) => ({
        source: "WhaleAlert",
        title: `${tx.symbol || tx.blockchain || "crypto"} whale transfer ${tx.amount_usd || ""} USD`,
        text: normalizeText(JSON.stringify(tx).slice(0, 500)),
        url: tx.transaction?.hash ? String(tx.transaction.hash) : "",
        occurredAt: normalizeSourceTimestamp(tx.timestamp),
        raw: tx
      })),
      warning: null
    };
  } catch (error) {
    writeWhaleAlertStatus({
      configured: true,
      connected: false,
      messageCount: 0,
      checkedAt: new Date().toISOString(),
      errorCode: "request_failed",
      error: localizeErrorMessage(error instanceof Error ? error.message : String(error))
    });
    throw error;
  }
}

function classifyEvent(item) {
  const text = `${item.title || ""} ${item.text || ""}`.toUpperCase();
  const bullTerms = [
    "APPROVE",
    "APPROVAL",
    "ETF INFLOW",
    "INFLOW",
    "LISTING",
    "RATE CUT",
    "DOVISH",
    "ADOPTION",
    "BUY",
    "ACCUMULATION",
    "RESERVE",
    "PARTNERSHIP",
    "LAUNCH",
    "REOPEN",
    "批准",
    "通过",
    "流入",
    "上线",
    "降息",
    "采用",
    "增持",
    "储备",
    "合作",
    "推出"
  ];
  const bearTerms = [
    "HACK",
    "EXPLOIT",
    "LAWSUIT",
    "BAN",
    "REJECT",
    "REJECTION",
    "DELIST",
    "OUTFLOW",
    "RATE HIKE",
    "HAWKISH",
    "DEPEG",
    "INSOLV",
    "BANKRUPT",
    "FREEZE",
    "OUTAGE",
    "SELL",
    "SEC CHARG",
    "黑客",
    "攻击",
    "漏洞",
    "诉讼",
    "禁止",
    "拒绝",
    "下架",
    "流出",
    "加息",
    "脱锚",
    "破产",
    "冻结",
    "宕机",
    "制裁"
  ];
  const highImpactTerms = [
    "ETF",
    "SEC",
    "FED",
    "FOMC",
    "CPI",
    "PCE",
    "RATE",
    "BINANCE",
    "OKX",
    "TETHER",
    "USDT",
    "USDC",
    "STABLECOIN",
    "HACK",
    "EXPLOIT",
    "DELIST",
    "APPROVAL",
    "REJECTION",
    "POLYMARKET",
    "LIQUIDATION",
    "比特币",
    "以太坊",
    "加密货币",
    "稳定币",
    "美联储",
    "央行",
    "利率",
    "降息",
    "加息",
    "通胀",
    "关税",
    "制裁",
    "战争",
    "冲突",
    "监管",
    "黑客",
    "攻击",
    "下架",
    "批准",
    "拒绝"
  ];

  const bull = bullTerms.filter((term) => text.includes(term)).length;
  const bear = bearTerms.filter((term) => text.includes(term)).length;
  const highImpact = highImpactTerms.filter((term) => text.includes(term)).length;
  const sourceTier = Number(item.sourceTier) || inferSourceTier(item);
  const sourceWeight =
    Number(item.sourceQualityWeight) ||
    (item.source === "Polymarket"
      ? 1.05
      : item.source === "WhaleAlert"
        ? 1.1
        : sourceWeightForTier(sourceTier));
  const corroborationCount = Math.max(1, safeNumber(item.corroborationCount, 1));
  const corroborationMultiplier = Math.min(1.24, 1 + (corroborationCount - 1) * 0.08);
  const trendScore = clamp(safeNumber(item.trendScore), 0, 1);
  const freshness = analyzeEventFreshness(item);

  const matchedSymbols = SYMBOLS.filter((symbol) => {
    const aliases = SYMBOL_ALIASES[symbol] || [symbol.replace("USDT", "")];
    return aliases.some((alias) => new RegExp(`(^|[^A-Z0-9])${escapeRegExp(alias)}([^A-Z0-9]|$)`).test(text));
  });

  const marketWide =
    /CRYPTO|CRYPTOCURRENCY|BITCOIN|BTC|ETHEREUM|ETH|BINANCE|OKX|STABLECOIN|USDT|USDC|ETF|FED|FOMC|CPI|PCE|比特币|以太坊|加密货币|数字货币|虚拟货币|稳定币|美联储|央行|利率|降息|加息|通胀|关税|制裁|战争|冲突/.test(
      text
    );
  const directionRaw = bull - bear;
  const direction = item.source === "Polymarket"
    ? Number.isFinite(item.sentimentDirection)
      ? item.sentimentDirection
      : 0
    : directionRaw > 0
      ? 1
      : directionRaw < 0
        ? -1
        : 0;
  const termImpactScore = clamp(
    (18 + highImpact * 12 + Math.abs(directionRaw) * 10) * sourceWeight * corroborationMultiplier +
      trendScore * 10,
    0,
    100
  );
  const rawImpactScore = Math.max(termImpactScore, safeNumber(item.sentimentImpact));
  const impactScore = clamp(rawImpactScore * freshness.freshnessWeight, 0, 100);

  return {
    ...item,
    matchedSymbols,
    marketWide,
    direction,
    rawImpactScore,
    impactScore,
    freshness,
    reasons: {
      bullTerms: bull,
      bearTerms: bear,
      highImpactTerms: highImpact,
      sourceTier,
      sourceWeight,
      corroborationCount,
      corroborationMultiplier,
      trendScore,
      freshnessLevel: freshness.level,
      freshnessWeight: freshness.freshnessWeight,
      ageMinutes: freshness.ageMinutes,
      predictionSentiment: Boolean(item.isPricePrediction)
    }
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aggregateEventsBySymbol(classifiedEvents) {
  const result = Object.fromEntries(
    SYMBOLS.map((symbol) => [symbol, { score: 0, directionScore: 0, eventCount: 0, events: [] }])
  );

  for (const event of classifiedEvents) {
    const targetSymbols = event.matchedSymbols.length
      ? event.matchedSymbols
      : event.marketWide
        ? SYMBOLS.slice(0, 6)
        : [];
    for (const symbol of targetSymbols) {
      if (!result[symbol]) continue;
      const relevance = event.matchedSymbols.includes(symbol) ? 1 : 0.45;
      result[symbol].score += event.impactScore * relevance;
      result[symbol].directionScore += event.direction * event.impactScore * relevance;
      result[symbol].eventCount += relevance;
      result[symbol].events.push(event);
    }
  }

  for (const value of Object.values(result)) {
    value.score = clamp(value.score, 0, 100);
    value.eventCount = roundNumber(value.eventCount, 3);
    value.direction = value.score > 0 ? clamp(value.directionScore / Math.max(value.score, 1), -1, 1) : 0;
    value.events = value.events
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 5)
      .map((event) => ({
        source: event.source,
        title: event.title,
        url: event.url,
        direction: event.direction,
        impactScore: Math.round(event.impactScore)
      }));
  }

  return result;
}

function analyzeMarket(
  symbol,
  candles15m,
  candles1h,
  fundingRate,
  openInterest,
  previousOpenInterest,
  directionWeightsValue = DIRECTION_MODEL_WEIGHTS
) {
  const directionWeights = normalizeDirectionWeights(directionWeightsValue, DIRECTION_MODEL_WEIGHTS);
  const closes15m = candles15m.map((candle) => candle.close);
  const closes1h = candles1h.map((candle) => candle.close);
  const latest = closes15m.at(-1) || closes1h.at(-1) || 0;
  const atrValue = atr(candles15m);
  const atrPct = latest > 0 ? atrValue / latest : 0;
  const ema20 = ema(closes15m.slice(-80), 20);
  const ema50 = ema(closes15m.slice(-120), 50);
  const ema1h20 = ema(closes1h.slice(-80), 20);
  const ema1h50 = ema(closes1h.slice(-120), 50);
  const returns = calculateLogReturns(closes15m);

  const realizedVol = std(returns.slice(-48)) * Math.sqrt(96);
  const shortVol = std(returns.slice(-12)) * Math.sqrt(96);
  const volatilityExpansion = realizedVol > 0 ? shortVol / realizedVol : 1;
  const roc15m = closes15m.length >= 5 ? latest / closes15m.at(-5) - 1 : 0;
  const roc1h = closes1h.length >= 5 ? latest / closes1h.at(-5) - 1 : 0;
  const rsi14 = rsi(closes15m);
  const oiChange =
    previousOpenInterest && previousOpenInterest.value > 0
      ? openInterest / previousOpenInterest.value - 1
      : 0;

  const trendSignal = clamp(((ema20 - ema50) / Math.max(latest * Math.max(atrPct, 0.004), 1e-9)) * 0.5, -1, 1);
  const htfTrendSignal = clamp(((ema1h20 - ema1h50) / Math.max(latest * Math.max(atrPct, 0.004), 1e-9)) * 0.35, -1, 1);
  const momentumSignal = clamp((roc15m + roc1h * 0.8) / Math.max(atrPct * 3, 0.006), -1, 1);
  const rsiSignal = rsi14 > 72 ? -0.35 : rsi14 < 28 ? 0.35 : 0;
  const fundingSignal = clamp(-fundingRate / 0.001, -0.4, 0.4);
  const oiSignal = clamp(oiChange / 0.06, -0.35, 0.35);
  const volatilityRegimeScore = volatilityExpansion > 1.6 ? -0.15 : volatilityExpansion < 0.65 ? -0.05 : 0.1;
  const gbm = analyzeGeometricBrownianMotion(returns);
  const garch = estimateGarch11(returns);
  const hiddenMarkov = analyzeHiddenMarkovRegime(returns);
  const directionalSignal = clamp(
    trendSignal * directionWeights.trend +
      htfTrendSignal * directionWeights.higherTimeframeTrend +
      momentumSignal * directionWeights.momentum +
      rsiSignal * directionWeights.rsi +
      fundingSignal * directionWeights.funding +
      oiSignal * directionWeights.openInterest +
      gbm.signal * directionWeights.geometricBrownianMotion +
      hiddenMarkov.signal * directionWeights.hiddenMarkovModel,
    -1,
    1
  );
  const mathSignal = clamp(directionalSignal * garch.confidenceMultiplier, -1, 1);
  const regime =
    hiddenMarkov.confidence >= 0.55
      ? `hmm_${hiddenMarkov.regime}`
      : Math.abs(trendSignal + htfTrendSignal) > 0.8
      ? "trend"
      : volatilityExpansion > 1.6
        ? "high_volatility"
        : Math.abs(momentumSignal) < 0.25
          ? "range"
          : "transition";

  return {
    symbol,
    latest,
    atrPct,
    realizedVol,
    shortVol,
    volatilityExpansion,
    fundingRate,
    openInterest,
    oiChange,
    rsi14,
    trendSignal,
    htfTrendSignal,
    momentumSignal,
    fundingSignal,
    oiSignal,
    volatilityRegimeScore,
    gbm,
    garch,
    hiddenMarkov,
    directionalSignal,
    mathSignal,
    regime,
    returns15m: returns.slice(-96),
    mathBreakdown: {
      formula:
        "directionalSignal = sum(directionFactor*currentReviewWeight); mathSignal = directionalSignal*(0.65 + 0.35*GARCH_stability)",
      decisionWeights: {
        ...directionWeights,
        garchConfidenceWeight: GARCH_CONFIDENCE_WEIGHT,
        markowitzSizingWeight: MARKOWITZ_SIZING_WEIGHT
      },
      inputs: {
        latest,
        ema20,
        ema50,
        ema1h20,
        ema1h50,
        atrPct,
        roc15m,
        roc1h,
        rsi14,
        fundingRate,
        openInterest,
        oiChange,
        realizedVol,
        shortVol,
        volatilityExpansion
      },
      components: {
        trendSignal,
        htfTrendSignal,
        momentumSignal,
        rsiSignal,
        fundingSignal,
        oiSignal,
        volatilityRegimeScore,
        gbmSignal: gbm.signal,
        garchStabilityScore: garch.stabilityScore,
        hiddenMarkovSignal: hiddenMarkov.signal,
        directionalSignal
      },
      weightedTerms: {
        trend: trendSignal * directionWeights.trend,
        htfTrend: htfTrendSignal * directionWeights.higherTimeframeTrend,
        momentum: momentumSignal * directionWeights.momentum,
        rsi: rsiSignal * directionWeights.rsi,
        funding: fundingSignal * directionWeights.funding,
        openInterest: oiSignal * directionWeights.openInterest,
        geometricBrownianMotion: gbm.signal * directionWeights.geometricBrownianMotion,
        hiddenMarkovModel: hiddenMarkov.signal * directionWeights.hiddenMarkovModel
      },
      models: { gbm, garch, hiddenMarkov },
      result: mathSignal,
      regimeRule:
        "Prefer HMM bull/bear/range when posterior confidence >= 55%; otherwise fall back to trend/high-volatility/range/transition rules."
    }
  };
}

function buildCandidate(
  market,
  eventAggregate,
  modelWeights,
  accountConfig,
  weightVersion = 1,
  calibration = {}
) {
  if (!market.latest || !Number.isFinite(market.latest)) return null;

  const normalizedAccountConfig = normalizeAccountConfig(accountConfig);
  const eventScoreNorm = clamp(eventAggregate.score / 100, 0, 1);
  const hasEventContext = eventAggregate.score > 0 && Array.isArray(eventAggregate.events) && eventAggregate.events.length > 0;
  const highImpactEvent = hasEventContext && eventAggregate.score >= 70 && Math.abs(eventAggregate.direction) >= 0.2;
  const eventDirection = eventAggregate.direction;
  const mathDirection = market.mathSignal;
  const candidateMode = hasEventContext ? (highImpactEvent ? "event_impact" : "event_math") : "math_only";
  const eventWeight = hasEventContext ? (highImpactEvent ? 0.62 : eventScoreNorm > 0.25 ? 0.42 : 0.18) : 0;
  const mathWeight = 1 - eventWeight;
  const combinedDirection = clamp(eventDirection * eventWeight + mathDirection * mathWeight, -1, 1);
  if (Math.abs(combinedDirection) < MIN_COMBINED_DIRECTION) return null;

  const side = combinedDirection > 0 ? "long" : "short";
  const alignment =
    eventScoreNorm > 0
      ? Math.sign(eventDirection || combinedDirection) === Math.sign(mathDirection || combinedDirection)
        ? 1
        : -0.35
      : 0;
  const factors = {
    eventImpact: eventScoreNorm,
    trend: Math.abs(market.trendSignal),
    momentum: Math.abs(market.momentumSignal),
    volatilityRegime: Math.max(market.volatilityRegimeScore, -0.1),
    funding: Math.abs(market.fundingSignal),
    openInterest: Math.abs(market.oiSignal),
    liquidity: 0.5,
    gbm: Math.abs(market.gbm.signal),
    garch: market.garch.stabilityScore,
    hiddenMarkov: Math.abs(market.hiddenMarkov.signal) * market.hiddenMarkov.confidence,
    markowitz: 0.5,
    poisson: 0.5,
    bayesian: 0.5
  };
  const modelCalibrationBoost = estimateCalibrationBoost(modelWeights, factors);
  const advancedModelQualityBoost = clamp(
    (market.hiddenMarkov.confidence - 1 / 3) * 0.035 +
      (market.garch.stabilityScore - 0.5) * 0.025 +
      Math.abs(market.gbm.signal) * 0.01,
    -0.02,
    0.035
  );
  const baseWinRate = clamp(
    0.5 +
      Math.abs(combinedDirection) * 0.18 +
      eventScoreNorm * 0.08 +
      alignment * 0.04 +
      market.volatilityRegimeScore * 0.05 +
      (candidateMode === "math_only" ? -0.02 : 0) +
      advancedModelQualityBoost +
      modelCalibrationBoost,
    0.35,
    0.86
  );
  const garchRiskFloor = market.garch.forecastVolatility * Math.sqrt(4) * 1.25;
  const riskPct = clamp(
    Math.max(market.atrPct * (highImpactEvent ? 2.4 : 1.9), garchRiskFloor, 0.006),
    0.006,
    0.09
  );
  const rewardRiskRatio = highImpactEvent ? 1.85 : Math.abs(market.mathSignal) > 0.65 ? 1.65 : 1.45;
  const rewardPct = riskPct * rewardRiskRatio;
  const roundTripExecutionCostPct =
    2 * (normalizedAccountConfig.takerFeeRate + normalizedAccountConfig.slippageRate);
  const poisson = analyzePoissonEventArrival(eventAggregate, eventScoreNorm, highImpactEvent);
  const bayesian = bayesianWinRateUpdate({
    priorWinRate: baseWinRate,
    combinedDirection,
    eventScoreNorm,
    alignment,
    volatilityRegimeScore: market.volatilityRegimeScore,
    advancedModelQualityBoost,
    poisson,
    roundTripExecutionCostPct,
    riskPct
  });
  const winRate = clamp(
    baseWinRate * (1 - BAYESIAN_POSTERIOR_WEIGHT) +
      bayesian.posteriorWinRate * BAYESIAN_POSTERIOR_WEIGHT,
    0.35,
    0.86
  );
  factors.poisson = poisson.directionalIntensity;
  factors.bayesian = Math.abs(bayesian.adjustment) / 0.08;
  const expectancyPct = winRate * rewardPct - (1 - winRate) * riskPct - roundTripExecutionCostPct;
  const expectancyR = riskPct > 0 ? expectancyPct / riskPct : 0;
  const gateResult = evaluateAdaptiveEntryGate({
    riskProfile: normalizedAccountConfig.riskProfile,
    expectancyPct,
    winRate,
    riskPct,
    rewardRiskRatio,
    roundTripExecutionCostPct,
    regime: market.regime,
    volatilityExpansion: Math.max(market.volatilityExpansion, market.garch.volatilityRatio),
    alignment,
    candidateMode,
    combinedDirection,
    calibration
  });
  const expectancyClass = expectancyR >= MIN_HIGH_EXPECTANCY_R ? "high" : "normal";
  const { passesGate } = gateResult;
  const entry = market.latest;
  const stopLoss = side === "long" ? entry * (1 - riskPct) : entry * (1 + riskPct);
  const takeProfit = side === "long" ? entry * (1 + rewardPct) : entry * (1 - rewardPct);
  const kelly = clamp((rewardRiskRatio * winRate - (1 - winRate)) / rewardRiskRatio, 0, 0.35);
  const fractionalKelly = kelly * 0.2;
  const maxRiskPct = highImpactEvent ? 0.008 : 0.005;
  const positionRiskPct = clamp(Math.min(fractionalKelly, maxRiskPct), 0, maxRiskPct);
  const accountControl = buildAccountControl({
    accountConfig,
    side,
    entry,
    riskPct,
    positionRiskPct,
    winRate,
    expectancyR,
    combinedDirection,
    volatilityExpansion: Math.max(market.volatilityExpansion, market.garch.volatilityRatio)
  });
  const accountAllowsSignal = accountControl.allowed;
  const finalStatus = passesGate && accountAllowsSignal ? "passed" : accountAllowsSignal ? "watch" : "blocked";

  return {
    id: `${market.symbol}-${Date.now()}-${side}`,
    symbol: market.symbol,
    side,
    status: finalStatus,
    candidateMode,
    entry,
    takeProfit,
    stopLoss,
    winRate,
    expectancyPct,
    expectancyR,
    expectancyClass,
    adaptiveWinRateThreshold: gateResult.adaptiveWinRateThreshold,
    breakEvenWinRate: gateResult.breakEvenWinRate,
    rewardRiskRatio,
    riskPct,
    positionRiskPct,
    leverageHint: accountControl.appliedLeverage,
    accountControl,
    highImpactEvent,
    eventImpactScore: Math.round(eventAggregate.score),
    combinedDirection,
    mathSignal: market.mathSignal,
    eventDirection,
    regime: market.regime,
    factors,
    factorSnapshot: {
      capturedAt: new Date().toISOString(),
      modelVersion: MONITOR_VERSION,
      weightVersion,
      regime: market.regime,
      directionSignals: {
        trend: market.trendSignal,
        higherTimeframeTrend: market.htfTrendSignal,
        momentum: market.momentumSignal,
        rsi: market.mathBreakdown?.components?.rsiSignal || 0,
        funding: market.fundingSignal,
        openInterest: market.oiSignal,
        geometricBrownianMotion: market.gbm.signal,
        hiddenMarkovModel: market.hiddenMarkov.signal
      },
      directionWeights: {
        trend: market.mathBreakdown?.decisionWeights?.trend,
        higherTimeframeTrend: market.mathBreakdown?.decisionWeights?.higherTimeframeTrend,
        momentum: market.mathBreakdown?.decisionWeights?.momentum,
        rsi: market.mathBreakdown?.decisionWeights?.rsi,
        funding: market.mathBreakdown?.decisionWeights?.funding,
        openInterest: market.mathBreakdown?.decisionWeights?.openInterest,
        geometricBrownianMotion: market.mathBreakdown?.decisionWeights?.geometricBrownianMotion,
        hiddenMarkovModel: market.mathBreakdown?.decisionWeights?.hiddenMarkovModel
      },
      weightedTerms: { ...(market.mathBreakdown?.weightedTerms || {}) },
      qualityFactors: { ...factors },
      qualityWeights: { ...modelWeights },
      eventContext: {
        score: eventAggregate.score,
        direction: eventDirection,
        eventWeight,
        mathWeight,
        alignment,
        eventCount: Array.isArray(eventAggregate.events) ? eventAggregate.events.length : 0
      },
      marketInputs: { ...(market.mathBreakdown?.inputs || {}) }
    },
    calculation: {
      direction: {
        formula: "combinedDirection = eventDirection*eventWeight + mathSignal*mathWeight",
        candidateMode,
        hasEventContext,
        eventDirection,
        mathDirection,
        eventWeight,
        mathWeight,
        combinedDirection
      },
      winRate: {
        formula:
          "baseP = clamp(0.50 + abs(combinedDirection)*0.18 + eventScoreNorm*0.08 + alignment*0.04 + volatilityRegimeScore*0.05 + mathOnlyPenalty + advancedModelQualityBoost + calibrationBoost, 0.35, 0.86); P(win)=0.70*baseP + 0.30*BayesianPosterior",
        eventScoreNorm,
        alignment,
        volatilityRegimeScore: market.volatilityRegimeScore,
        mathOnlyPenalty: candidateMode === "math_only" ? -0.02 : 0,
        advancedModelQualityBoost,
        calibrationBoost: modelCalibrationBoost,
        baseWinRate,
        bayesianPosteriorWeight: BAYESIAN_POSTERIOR_WEIGHT,
        result: winRate
      },
      poisson,
      bayesian,
      riskReward: {
        formula:
          "riskPct = clamp(max(ATR%*eventMultiplier, GARCH_forecastVol*sqrt(4)*1.25, 0.006), 0.006, 0.09); rewardPct = riskPct*rewardRiskRatio",
        atrPct: market.atrPct,
        garchRiskFloor,
        eventMultiplier: highImpactEvent ? 2.4 : 1.9,
        riskPct,
        rewardRiskRatio,
        rewardPct,
        entry,
        takeProfit,
        stopLoss
      },
      expectancy: {
        formula:
          "EV% = P(win)*rewardPct - (1-P(win))*riskPct - 2*(takerFeeRate + slippageRate); funding is settled separately if a funding timestamp is crossed",
        takerFeeRate: normalizedAccountConfig.takerFeeRate,
        slippageRate: normalizedAccountConfig.slippageRate,
        roundTripExecutionCostPct,
        expectancyPct,
        expectancyR
      },
      gate: {
        formula:
          "Pass if EV% > 0 and P(win) >= clamp(breakEvenWinRate + adaptive uncertainty/risk margins, profile safety bounds)",
        riskProfile: gateResult.riskProfile,
        minCombinedDirection: MIN_COMBINED_DIRECTION,
        adaptiveWinRateThreshold: gateResult.adaptiveWinRateThreshold,
        breakEvenWinRate: gateResult.breakEvenWinRate,
        executionCostR: gateResult.executionCostR,
        uncertaintyMargin: gateResult.uncertaintyMargin,
        bounds: gateResult.bounds,
        components: gateResult.components,
        context: gateResult.context,
        minHighExpectancyR: MIN_HIGH_EXPECTANCY_R,
        minEvPct: MIN_EV_PCT,
        passesGate
      },
      sizing: {
        formula:
          "fractionalKelly = 0.2 * clamp((rewardRiskRatio*P(win) - (1-P(win))) / rewardRiskRatio, 0, 0.35); appliedLeverage = min(modelSuggestedLeverage, accountMaxLeverage)",
        kelly,
        fractionalKelly,
        maxRiskPct,
        positionRiskPct,
        accountControl
      },
      advancedModels: {
        formula:
          "GBM and HMM contribute to direction; GARCH scales confidence and supplies a volatility-based stop floor; Poisson measures event clustering; Bayesian update calibrates win probability; Markowitz is applied after all candidates are formed.",
        gbm: market.gbm,
        garch: market.garch,
        hiddenMarkov: market.hiddenMarkov,
        poisson,
        bayesian,
        weights: {
          ...Object.fromEntries(
            Object.entries(market.mathBreakdown?.decisionWeights || {}).filter(
              ([key]) => !["garchConfidenceWeight", "markowitzSizingWeight"].includes(key)
            )
          ),
          garchConfidenceWeight: GARCH_CONFIDENCE_WEIGHT,
          markowitzSizingWeight: MARKOWITZ_SIZING_WEIGHT,
          bayesianPosteriorWeight: BAYESIAN_POSTERIOR_WEIGHT
        }
      }
    },
    reasons: [
      candidateMode === "math_only"
        ? "no-message math-only path"
        : highImpactEvent
          ? "high-impact event path"
          : "normal event/math composite path",
      `mathSignal=${market.mathSignal.toFixed(2)}`,
      `GBM=${market.gbm.signal.toFixed(2)}`,
      `HMM=${market.hiddenMarkov.regime}:${market.hiddenMarkov.confidence.toFixed(2)}`,
      `GARCHvolRatio=${market.garch.volatilityRatio.toFixed(2)}`,
      `PoissonTail=${poisson.tailProbability.toFixed(2)}`,
      `BayesP=${(bayesian.posteriorWinRate * 100).toFixed(1)}%`,
      `eventImpact=${Math.round(eventAggregate.score)}`,
      `regime=${market.regime}`,
      `adaptiveGate=${(gateResult.adaptiveWinRateThreshold * 100).toFixed(1)}%`,
      `EV=${(expectancyPct * 100).toFixed(2)}%`
    ],
    relatedEvents: eventAggregate.events
  };
}

function estimateCalibrationBoost(modelWeights, factors) {
  let weighted = 0;
  let total = 0;
  for (const [name, value] of Object.entries(factors)) {
    const weight = safeNumber(modelWeights[name], BASE_MODEL_WEIGHTS[name] || 0);
    weighted += weight * safeNumber(value);
    total += Math.abs(weight);
  }
  return total ? clamp((weighted / total - 0.45) * 0.06, -0.04, 0.04) : 0;
}

function covariance(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 2) return 0;
  const leftValues = left.slice(-length);
  const rightValues = right.slice(-length);
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  return mean(
    leftValues.map((value, index) => (value - leftMean) * (rightValues[index] - rightMean))
  );
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function normalizeCappedWeights(values, maxWeight) {
  const count = values.length;
  if (!count) return [];
  const scores = values.map((value) => Math.max(0, safeNumber(value)));
  if (scores.every((value) => value === 0)) scores.fill(1);
  const weights = new Array(count).fill(0);
  let active = scores.map((_, index) => index);
  let remaining = 1;

  while (active.length) {
    const scoreTotal = active.reduce((sum, index) => sum + scores[index], 0);
    const proposed = active.map((index) => ({
      index,
      weight: remaining * (scoreTotal > 0 ? scores[index] / scoreTotal : 1 / active.length)
    }));
    const overCap = proposed.filter((item) => item.weight > maxWeight + 1e-12);
    if (!overCap.length) {
      for (const item of proposed) weights[item.index] = item.weight;
      break;
    }
    for (const item of overCap) {
      weights[item.index] = maxWeight;
      remaining -= maxWeight;
    }
    const capped = new Set(overCap.map((item) => item.index));
    active = active.filter((index) => !capped.has(index));
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : weights;
}

function applyMarkowitzSizing(candidates, marketBySymbol, accountConfig) {
  if (!candidates.length) {
    return {
      candidates,
      portfolio: {
        method: "regularized_tangency",
        weights: {},
        expectedReturn: 0,
        volatility: 0,
        formula: "No candidates; Markowitz allocation not applied."
      }
    };
  }

  const strategyReturns = candidates.map((candidate) => {
    const direction = candidate.side === "long" ? 1 : -1;
    return (marketBySymbol[candidate.symbol]?.returns15m || []).map((value) => value * direction);
  });
  const expectedReturns = candidates.map((candidate) => {
    const market = marketBySymbol[candidate.symbol];
    const direction = candidate.side === "long" ? 1 : -1;
    const gbmReturn = safeNumber(market?.gbm?.expectedReturn) * direction;
    return Math.max(1e-6, safeNumber(candidate.expectancyPct) * 0.6 + gbmReturn * 0.4);
  });
  const covarianceMatrix = candidates.map((_, leftIndex) =>
    candidates.map((__, rightIndex) => covariance(strategyReturns[leftIndex], strategyReturns[rightIndex]))
  );
  const averageVariance = Math.max(
    mean(covarianceMatrix.map((row, index) => Math.max(row[index], 1e-12))),
    1e-12
  );
  const regularization = averageVariance * 0.2;
  const regularizedCovariance = covarianceMatrix.map((row, leftIndex) =>
    row.map((value, rightIndex) =>
      leftIndex === rightIndex ? value + regularization : value * 0.8
    )
  );
  const rawSolution = solveLinearSystem(regularizedCovariance, expectedReturns);
  const fallbackScores = candidates.map((_, index) => {
    const volatility = Math.sqrt(Math.max(regularizedCovariance[index][index], 1e-12));
    return expectedReturns[index] / volatility;
  });
  const positiveSolution =
    rawSolution && rawSolution.some((value) => value > 0)
      ? rawSolution.map((value) => Math.max(0, value))
      : fallbackScores;
  const maxWeight = Math.max(0.35, 1 / candidates.length);
  const weights = normalizeCappedWeights(positiveSolution, maxWeight);
  const equalWeight = 1 / candidates.length;

  const adjustedCandidates = candidates.map((candidate, index) => {
    const markowitzWeight = weights[index];
    const relativeWeight = markowitzWeight / equalWeight;
    const allocationMultiplier = clamp(
      1 - MARKOWITZ_SIZING_WEIGHT + MARKOWITZ_SIZING_WEIGHT * relativeWeight,
      0.35,
      1.35
    );
    const originalRiskPct = candidate.positionRiskPct;
    const riskCap = candidate.highImpactEvent ? 0.008 : 0.005;
    const adjustedPositionRiskPct = clamp(originalRiskPct * allocationMultiplier, 0, riskCap);
    const market = marketBySymbol[candidate.symbol];
    const accountControl = buildAccountControl({
      accountConfig,
      side: candidate.side,
      entry: candidate.entry,
      riskPct: candidate.riskPct,
      positionRiskPct: adjustedPositionRiskPct,
      winRate: candidate.winRate,
      expectancyR: candidate.expectancyR,
      combinedDirection: candidate.combinedDirection,
      volatilityExpansion: Math.max(
        safeNumber(market?.volatilityExpansion, 1),
        safeNumber(market?.garch?.volatilityRatio, 1)
      )
    });
    const markowitz = {
      weight: markowitzWeight,
      equalWeight,
      relativeWeight,
      allocationMultiplier,
      originalPositionRiskPct: originalRiskPct,
      adjustedPositionRiskPct,
      expectedReturn: expectedReturns[index],
      variance: regularizedCovariance[index][index],
      formula:
        "w proportional to max((Sigma + ridge*I)^-1 * expectedReturn, 0); positionRisk = baseRisk*(0.60 + 0.40*w/equalWeight), capped by hard risk limit"
    };
    return {
      ...candidate,
      positionRiskPct: adjustedPositionRiskPct,
      accountControl,
      markowitz,
      factors: {
        ...candidate.factors,
        markowitz: clamp(relativeWeight / 2, 0, 1)
      },
      calculation: {
        ...candidate.calculation,
        sizing: {
          ...candidate.calculation.sizing,
          positionRiskPct: adjustedPositionRiskPct,
          accountControl
        },
        markowitz
      },
      reasons: [...candidate.reasons, `MarkowitzWeight=${markowitzWeight.toFixed(3)}`]
    };
  });

  const portfolioExpectedReturn = weights.reduce(
    (sum, weight, index) => sum + weight * expectedReturns[index],
    0
  );
  let portfolioVariance = 0;
  for (let left = 0; left < weights.length; left += 1) {
    for (let right = 0; right < weights.length; right += 1) {
      portfolioVariance += weights[left] * weights[right] * regularizedCovariance[left][right];
    }
  }
  return {
    candidates: adjustedCandidates,
    portfolio: {
      method: "regularized_tangency",
      sizingWeight: MARKOWITZ_SIZING_WEIGHT,
      regularization,
      weights: Object.fromEntries(
        adjustedCandidates.map((candidate) => [candidate.symbol, candidate.markowitz.weight])
      ),
      expectedReturn: portfolioExpectedReturn,
      volatility: Math.sqrt(Math.max(portfolioVariance, 0)),
      formula:
        "Markowitz: maximize expectedReturn^T*w / sqrt(w^T*Sigma*w), approximated by regularized tangency weights w proportional to positive((Sigma+ridge*I)^-1*mu)."
    }
  };
}

function buildAccountControl({
  accountConfig,
  side,
  entry,
  riskPct,
  positionRiskPct,
  winRate,
  expectancyR,
  combinedDirection,
  volatilityExpansion
}) {
  const config = normalizeAccountConfig(accountConfig);
  const isFutures = config.marketType === "futures";
  const allowed = isFutures || side === "long";
  const blockReason = allowed ? null : "现货账户不允许执行做空信号。";
  const confidenceLeverage = 1 + Math.max(0, winRate - 0.5) * 10 + Math.max(0, expectancyR) * 1.5;
  const directionLeverage = 1 + Math.max(0, Math.abs(combinedDirection) - MIN_COMBINED_DIRECTION) * 2;
  const volatilityPenalty = volatilityExpansion > 1.6 ? 0.65 : volatilityExpansion > 1.2 ? 0.82 : 1;
  const conservativeSuggestedLeverage = isFutures
    ? clamp(roundNumber((confidenceLeverage + directionLeverage) * 0.5 * volatilityPenalty, 2), 1, 125)
    : 1;
  const profileLeverageMultiplier = isFutures && config.riskProfile === "aggressive" ? 2 : 1;
  const modelSuggestedLeverage = isFutures
    ? clamp(roundNumber(conservativeSuggestedLeverage * profileLeverageMultiplier, 2), 1, 125)
    : 1;
  const maxLeverage = isFutures ? config.maxLeverage : 1;
  const appliedLeverage = allowed ? clamp(Math.min(modelSuggestedLeverage, maxLeverage), 1, maxLeverage) : 0;
  const leverageCapped = allowed && modelSuggestedLeverage > maxLeverage;
  const targetRiskAmount = allowed ? config.initialCapital * positionRiskPct : 0;
  const riskBasedNotional = allowed && riskPct > 0 ? targetRiskAmount / riskPct : 0;
  const maxNotionalByLeverage = allowed
    ? isFutures
      ? config.initialCapital * appliedLeverage
      : config.initialCapital
    : 0;
  const notional = Math.max(0, Math.min(riskBasedNotional, maxNotionalByLeverage));
  const marginRequired = isFutures && appliedLeverage > 0 ? notional / appliedLeverage : notional;
  const quantity = entry > 0 ? notional / entry : 0;
  const maxLossAmount = notional * riskPct;
  const actualAccountRiskPct = config.initialCapital > 0 ? maxLossAmount / config.initialCapital : 0;
  return {
    allowed,
    blockReason,
    accountMarketType: config.marketType,
    riskProfile: config.riskProfile,
    costModelVersion: 1,
    initialCapital: config.initialCapital,
    quoteCurrency: config.quoteCurrency,
    maxLeverage,
    conservativeSuggestedLeverage,
    profileLeverageMultiplier,
    modelSuggestedLeverage,
    appliedLeverage,
    leverageCapped,
    aggressiveLeverageLimitedByCap:
      config.riskProfile === "aggressive" &&
      appliedLeverage < conservativeSuggestedLeverage * profileLeverageMultiplier,
    targetRiskPct: positionRiskPct,
    actualAccountRiskPct,
    targetRiskAmount,
    maxLossAmount,
    notional,
    marginRequired,
    quantity,
    formula:
      "conservativeLeverage = f(winRate, expectancyR, directionStrength, volatilityPenalty); profileMultiplier = aggressive ? 2 : 1; modelSuggestedLeverage = conservativeLeverage*profileMultiplier; appliedLeverage = min(modelSuggestedLeverage, maxLeverage); notional = min(targetRiskAmount/riskPct, capital*appliedLeverage)"
  };
}

function nextFundingSettlement(timestamp, intervalHours = DEFAULT_FUNDING_INTERVAL_HOURS) {
  const time = new Date(timestamp || Date.now()).getTime();
  if (!Number.isFinite(time)) return null;
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  return new Date((Math.floor(time / intervalMs) + 1) * intervalMs).toISOString();
}

function adverseExecutionPrice(referencePrice, side, action, slippageRate) {
  const isBuy = (action === "entry" && side === "long") || (action === "exit" && side === "short");
  return referencePrice * (isBuy ? 1 + slippageRate : 1 - slippageRate);
}

function positionGrossPnl(position, exitPrice) {
  if (!position || !exitPrice || !position.entry || !position.quantity) return 0;
  const priceDifference =
    position.side === "long" ? exitPrice - position.entry : position.entry - exitPrice;
  return priceDifference * position.quantity;
}

function accruePaperFunding(account, position, market, now) {
  if (position.accountMarketType !== "futures" || !position.nextFundingAt) return;
  const nowMs = new Date(now).getTime();
  let nextMs = new Date(position.nextFundingAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextMs)) return;
  const intervalHours = safeNumber(position.fundingIntervalHours, DEFAULT_FUNDING_INTERVAL_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  let settlements = 0;
  while (nowMs >= nextMs && settlements < 24) {
    const fundingRate = safeNumber(market?.fundingRate, position.lastFundingRate || 0);
    const settlementPrice = safeNumber(market?.latest, position.currentPrice || position.entry);
    const settlementNotional = Math.abs(position.quantity * settlementPrice);
    const fundingPayment =
      position.side === "long" ? -settlementNotional * fundingRate : settlementNotional * fundingRate;
    position.fundingPnl = safeNumber(position.fundingPnl) + fundingPayment;
    position.fundingSettlements = safeNumber(position.fundingSettlements) + 1;
    position.lastFundingRate = fundingRate;
    position.lastFundingAt = new Date(nextMs).toISOString();
    account.fundingPnl = safeNumber(account.fundingPnl) + fundingPayment;
    account.realizedPnl = safeNumber(account.realizedPnl) + fundingPayment;
    nextMs += intervalMs;
    settlements += 1;
  }
  position.nextFundingAt = new Date(nextMs).toISOString();
}

function markPaperPositions(account, marketBySymbol, now = new Date().toISOString()) {
  let unrealizedPnl = 0;
  let marginUsed = 0;
  for (const position of Object.values(account.positions || {})) {
    const market = marketBySymbol[position.symbol];
    const currentPrice = market?.latest || position.currentPrice || position.entry;
    accruePaperFunding(account, position, market, now);
    const estimatedExitPrice = adverseExecutionPrice(
      currentPrice,
      position.side,
      "exit",
      safeNumber(position.slippageRate)
    );
    const grossPnl = positionGrossPnl(position, estimatedExitPrice);
    const estimatedExitNotional = Math.abs(position.quantity * estimatedExitPrice);
    const estimatedExitFee = estimatedExitNotional * safeNumber(position.feeRate);
    const pnl = grossPnl - estimatedExitFee;
    position.currentPrice = currentPrice;
    position.estimatedExitPrice = estimatedExitPrice;
    position.grossUnrealizedPnl = grossPnl;
    position.estimatedExitFee = estimatedExitFee;
    position.estimatedExitSlippageCost = Math.abs(estimatedExitPrice - currentPrice) * position.quantity;
    position.unrealizedPnl = pnl;
    position.netPnl =
      grossPnl -
      safeNumber(position.entryFee) -
      estimatedExitFee +
      safeNumber(position.fundingPnl);
    position.unrealizedReturnPct =
      position.marginRequired > 0 ? position.netPnl / position.marginRequired : 0;
    position.priceReturnPct =
      position.side === "long" ? currentPrice / position.entry - 1 : (position.entry - currentPrice) / position.entry;
    position.maxFavorableExcursionPct = Math.max(
      safeNumber(position.maxFavorableExcursionPct),
      position.priceReturnPct
    );
    position.maxAdverseExcursionPct = Math.min(
      safeNumber(position.maxAdverseExcursionPct),
      position.priceReturnPct
    );
    const observations = Array.isArray(position.holdingObservations) ? position.holdingObservations : [];
    const lastObservation = observations.at(-1);
    const observationGapMs = lastObservation
      ? new Date(now).getTime() - new Date(lastObservation.time).getTime()
      : Number.POSITIVE_INFINITY;
    if (!lastObservation || observationGapMs >= 15 * 60 * 1000) {
      observations.push({
        time: now,
        price: currentPrice,
        priceReturnPct: position.priceReturnPct,
        netPnl: position.netPnl,
        fundingRate: safeNumber(market?.fundingRate),
        openInterest: safeNumber(market?.openInterest)
      });
    }
    position.holdingObservations = observations.slice(-288);
    marginUsed += position.marginRequired || 0;
    unrealizedPnl += pnl;
  }
  account.unrealizedPnl = unrealizedPnl;
  account.marginUsed = marginUsed;
  account.equity = account.startingCapital + safeNumber(account.realizedPnl) + unrealizedPnl;
  account.availableEquity = Math.max(0, account.equity - marginUsed);
}

function closePaperPosition(account, positionId, price, reason, now) {
  const position = account.positions[positionId];
  if (!position) return null;
  const exitPrice = adverseExecutionPrice(
    price,
    position.side,
    "exit",
    safeNumber(position.slippageRate)
  );
  const exitNotional = Math.abs(position.quantity * exitPrice);
  const exitFee = exitNotional * safeNumber(position.feeRate);
  const exitSlippageCost = Math.abs(exitPrice - price) * position.quantity;
  const grossTradingPnl = positionGrossPnl(position, exitPrice);
  const closeSettlementPnl = grossTradingPnl - exitFee;
  const realizedPnl =
    grossTradingPnl -
    safeNumber(position.entryFee) -
    exitFee +
    safeNumber(position.fundingPnl);
  const closed = {
    ...position,
    status: "closed",
    exitReferencePrice: price,
    exitPrice,
    exitFee,
    exitSlippageCost,
    grossTradingPnl,
    closedAt: now,
    closeReason: reason,
    exitFactorSnapshot: position.exitEvaluation
      ? {
          version: position.exitEvaluation.version,
          evaluatedAt: position.exitEvaluation.evaluatedAt,
          signals: position.exitEvaluation.signals,
          weights: position.exitEvaluation.weights,
          exitScore: position.exitEvaluation.exitScore,
          threshold: position.exitEvaluation.threshold,
          diagnostics: position.exitEvaluation.diagnostics
        }
      : null,
    realizedPnl,
    realizedReturnPct: position.marginRequired > 0 ? realizedPnl / position.marginRequired : 0,
    accountReturnPct: account.startingCapital > 0 ? realizedPnl / account.startingCapital : 0
  };
  if (["ADAPTIVE_EXIT", "MAX_HOLDING_TIME"].includes(reason) && position.exitEvaluation) {
    const horizonHours = safeNumber(position.exitEvaluation.counterfactualHorizonHours, 4);
    closed.exitCounterfactual = {
      status: "pending",
      horizonHours,
      dueAt: new Date(new Date(now).getTime() + horizonHours * 3_600_000).toISOString(),
      evaluatedAt: null,
      referenceExitPrice: exitPrice,
      counterfactualPrice: null,
      counterfactualReturnPct: null,
      avoidedReturnPct: null,
      beneficial: null
    };
  }
  account.realizedPnl = safeNumber(account.realizedPnl) + closeSettlementPnl;
  account.tradingFees = safeNumber(account.tradingFees) + exitFee;
  account.slippageCost = safeNumber(account.slippageCost) + exitSlippageCost;
  account.lifetimeClosedTrades = Math.max(
    safeNumber(account.lifetimeClosedTrades),
    Array.isArray(account.tradeHistory) ? account.tradeHistory.length : 0
  ) + 1;
  if (realizedPnl > 0) {
    account.lifetimeWinningTrades = Math.max(
      safeNumber(account.lifetimeWinningTrades),
      (account.tradeHistory || []).filter((trade) => safeNumber(trade.realizedPnl) > 0).length
    ) + 1;
  }
  delete account.positions[positionId];
  account.tradeHistory = [...(account.tradeHistory || []), closed].slice(-500);
  return closed;
}

function closeTriggeredPaperPositions(account, marketBySymbol, candidatesBySymbol, now) {
  const closed = [];
  const exitWeights = normalizeExitWeights(
    account.postTradeReview?.currentExitWeights,
    DEFAULT_EXIT_MODEL_WEIGHTS
  );
  for (const [positionId, position] of Object.entries(account.positions || {})) {
    const market = marketBySymbol[position.symbol];
    const price = market?.latest;
    if (!price) continue;
    if (!position.exitPolicyStartedAt) position.exitPolicyStartedAt = now;
    position.exitPolicyVersion = 1;
    position.exitEvaluation = evaluateAdaptivePositionExit({
      position,
      market,
      candidate: candidatesBySymbol[position.symbol] || null,
      now,
      weights: exitWeights
    });
    let reason = null;
    if (position.side === "long") {
      if (price >= position.takeProfit) reason = "TP";
      if (price <= position.stopLoss) reason = "SL";
    } else {
      if (price <= position.takeProfit) reason = "TP";
      if (price >= position.stopLoss) reason = "SL";
    }
    if (!reason) {
      position.exitConfirmationCount = position.exitEvaluation.recommendsExit
        ? safeNumber(position.exitConfirmationCount) + 1
        : 0;
      if (position.exitEvaluation.hardExpired) reason = "MAX_HOLDING_TIME";
      else if (position.exitConfirmationCount >= position.exitEvaluation.confirmationRunsRequired) {
        reason = "ADAPTIVE_EXIT";
      }
    }
    if (reason) {
      const item = closePaperPosition(account, positionId, price, reason, now);
      if (item) closed.push(item);
    }
  }
  return closed;
}

function openPaperPosition(account, signal, now) {
  const control = signal.accountControl || {};
  if (!control.allowed || signal.status !== "passed") return null;
  const duplicate = Object.values(account.positions || {}).some((position) => position.symbol === signal.symbol);
  if (duplicate) return null;
  const config = normalizeAccountConfig(account.configSnapshot);
  const availableEquity = Math.max(0, safeNumber(account.availableEquity, account.equity));
  if (availableEquity <= 0 || control.marginRequired <= 0 || control.notional <= 0) return null;
  const estimatedEntryFee = control.notional * config.takerFeeRate;
  const scale = Math.min(1, availableEquity / (control.marginRequired + estimatedEntryFee));
  if (scale < 0.05) return null;
  const notional = control.notional * scale;
  const marginRequired = control.marginRequired * scale;
  const signalEntryPrice = signal.entry;
  const entry = adverseExecutionPrice(signalEntryPrice, signal.side, "entry", config.slippageRate);
  const quantity = entry > 0 ? notional / entry : 0;
  const entryFee = notional * config.takerFeeRate;
  const entrySlippageCost = Math.abs(entry - signalEntryPrice) * quantity;
  const maxLossAmount = control.maxLossAmount * scale;
  const position = {
    id: `paper-${signal.id}`,
    signalId: signal.id,
    costModelVersion: 1,
    openedAt: now,
    status: "open",
    symbol: signal.symbol,
    side: signal.side,
    candidateMode: signal.candidateMode,
    accountMarketType: config.marketType,
    riskProfile: config.riskProfile,
    signalEntryPrice,
    entry,
    currentPrice: signalEntryPrice,
    takeProfit: signal.takeProfit,
    stopLoss: signal.stopLoss,
    winRate: signal.winRate,
    adaptiveWinRateThreshold: signal.adaptiveWinRateThreshold,
    breakEvenWinRate: signal.breakEvenWinRate,
    expectancyPct: signal.expectancyPct,
    expectancyR: signal.expectancyR,
    eventImpactScore: signal.eventImpactScore,
    leverage: control.appliedLeverage,
    modelSuggestedLeverage: control.modelSuggestedLeverage,
    leverageCapped: control.leverageCapped,
    notional,
    marginRequired,
    quantity,
    maxLossAmount,
    feeRate: config.takerFeeRate,
    slippageRate: config.slippageRate,
    fundingIntervalHours: config.fundingIntervalHours,
    entryFee,
    entrySlippageCost,
    exitFee: 0,
    exitSlippageCost: 0,
    fundingPnl: 0,
    fundingSettlements: 0,
    lastFundingRate: 0,
    lastFundingAt: null,
    nextFundingAt:
      config.marketType === "futures"
        ? nextFundingSettlement(now, config.fundingIntervalHours)
        : null,
    scaledByAvailableEquity: scale < 1,
    relatedEvents: signal.relatedEvents || [],
    factorSnapshot: signal.factorSnapshot || null,
    decisionCalculation: signal.calculation || null,
    decisionReasons: signal.reasons || [],
    regime: signal.regime || "unknown",
    maxFavorableExcursionPct: 0,
    maxAdverseExcursionPct: 0,
    holdingObservations: [
      {
        time: now,
        price: entry,
        priceReturnPct: 0,
        netPnl: -entryFee,
        fundingRate: 0,
        openInterest: 0
      }
    ],
    exitPolicyVersion: 1,
    exitPolicyStartedAt: now,
    exitConfirmationCount: 0,
    exitEvaluation: null,
    unrealizedPnl: 0,
    unrealizedReturnPct: 0,
    priceReturnPct: 0
  };
  account.realizedPnl = safeNumber(account.realizedPnl) - entryFee;
  account.tradingFees = safeNumber(account.tradingFees) + entryFee;
  account.slippageCost = safeNumber(account.slippageCost) + entrySlippageCost;
  account.positions[position.id] = position;
  return position;
}

function appendEquityPoint(account, now) {
  const point = {
    time: now,
    equity: account.equity,
    returnPct: account.startingCapital > 0 ? account.equity / account.startingCapital - 1 : 0,
    realizedPnl: safeNumber(account.realizedPnl),
    unrealizedPnl: safeNumber(account.unrealizedPnl)
  };
  const curve = account.equityCurve || [];
  const last = curve.at(-1);
  if (!last || last.time !== now || Math.abs(safeNumber(last.equity) - point.equity) > 1e-9) {
    curve.push(point);
  }
  account.equityCurve = curve.slice(-5000);
}

function buildPaperAccountSummary(account) {
  const curve = Array.isArray(account.equityCurve) ? account.equityCurve : [];
  const startingCapital = safeNumber(account.startingCapital);
  const latestEquity = safeNumber(account.equity, startingCapital);
  let maxEquity = startingCapital;
  let peak = startingCapital;
  let maxDrawdownPct = 0;
  for (const point of curve) {
    const equity = safeNumber(point.equity);
    maxEquity = Math.max(maxEquity, equity);
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdownPct = Math.min(maxDrawdownPct, equity / peak - 1);
    }
  }
  const returns = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = safeNumber(curve[index - 1].equity);
    const current = safeNumber(curve[index].equity);
    if (previous > 0) returns.push(current / previous - 1);
  }
  const avgReturn = mean(returns);
  const returnStd = std(returns);
  const sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(Math.max(returns.length, 1)) : 0;
  const trades = Array.isArray(account.tradeHistory) ? account.tradeHistory : [];
  const closedTrades = Math.max(
    trades.length,
    Math.round(safeNumber(account.lifetimeClosedTrades, trades.length))
  );
  const wins = Math.min(
    closedTrades,
    Math.max(
      trades.filter((trade) => safeNumber(trade.realizedPnl) > 0).length,
      Math.round(safeNumber(account.lifetimeWinningTrades))
    )
  );
  return {
    startTime: account.startedAt || account.createdAt,
    endTime: account.updatedAt,
    startingCapital,
    latestEquity,
    finalReturnPct: startingCapital > 0 ? latestEquity / startingCapital - 1 : 0,
    maxReturnPct: startingCapital > 0 ? maxEquity / startingCapital - 1 : 0,
    maxDrawdownPct,
    sharpeRatio,
    closedTrades,
    wins,
    losses: closedTrades - wins,
    winRate: closedTrades ? wins / closedTrades : 0,
    openPositions: Object.keys(account.positions || {}).length,
    realizedPnl: safeNumber(account.realizedPnl),
    unrealizedPnl: safeNumber(account.unrealizedPnl),
    tradingFees: safeNumber(account.tradingFees),
    slippageCost: safeNumber(account.slippageCost),
    fundingPnl: safeNumber(account.fundingPnl),
    marginUsed: safeNumber(account.marginUsed),
    availableEquity: safeNumber(account.availableEquity),
    formula:
      "净权益=本金+已实现现金流(含手续费与资金费)+按不利滑点和平仓手续费估算的未实现盈亏；收益率=净权益/本金-1。"
  };
}

function settleExitCounterfactuals(account, marketBySymbol, now) {
  const nowMs = Date.parse(now);
  for (const trade of account.tradeHistory || []) {
    const counterfactual = trade?.exitCounterfactual;
    if (!counterfactual || counterfactual.status !== "pending") continue;
    if (nowMs < Date.parse(counterfactual.dueAt || "")) continue;
    const price = safeNumber(marketBySymbol[trade.symbol]?.latest);
    const exitPrice = safeNumber(counterfactual.referenceExitPrice, trade.exitPrice);
    if (price <= 0 || exitPrice <= 0) continue;
    const counterfactualReturnPct =
      trade.side === "short" ? 1 - price / exitPrice : price / exitPrice - 1;
    trade.exitCounterfactual = {
      ...counterfactual,
      status: "evaluated",
      evaluatedAt: now,
      counterfactualPrice: price,
      counterfactualReturnPct,
      avoidedReturnPct: -counterfactualReturnPct,
      beneficial: counterfactualReturnPct <= 0
    };
  }
}

function updatePaperAccount(account, actionableSignals, allCandidates, marketBySymbol) {
  const now = new Date().toISOString();
  account.version = MONITOR_VERSION;
  account.updatedAt = now;
  markPaperPositions(account, marketBySymbol, now);
  const candidatesBySymbol = Object.fromEntries(allCandidates.map((candidate) => [candidate.symbol, candidate]));
  const closedPositions = closeTriggeredPaperPositions(account, marketBySymbol, candidatesBySymbol, now);
  markPaperPositions(account, marketBySymbol, now);
  const openedPositions = [];
  for (const signal of actionableSignals) {
    const opened = openPaperPosition(account, signal, now);
    if (opened) {
      openedPositions.push(opened);
      markPaperPositions(account, marketBySymbol, now);
    }
  }
  markPaperPositions(account, marketBySymbol, now);
  settleExitCounterfactuals(account, marketBySymbol, now);
  appendEquityPoint(account, now);
  const postTradeReviewResult = maybeRunPostTradeReview(account, DIRECTION_MODEL_WEIGHTS, now);
  account.summary = buildPaperAccountSummary(account);
  account.lastRun = {
    generatedAt: now,
    openedPositions,
    closedPositions,
    postTradeReview: postTradeReviewResult.review
  };
  return account;
}

function updateOpenSignalsAndReviews(state, candidates, marketBySymbol) {
  const now = Date.now();
  const closedThisRun = [];
  const activeSignals = state.activeSignals || {};

  for (const [id, signal] of Object.entries(activeSignals)) {
    const market = marketBySymbol[signal.symbol];
    if (!market?.latest) continue;
    const price = market.latest;
    const ageMs = now - new Date(signal.createdAt).getTime();
    let outcome = null;
    if (signal.side === "long") {
      if (price >= signal.takeProfit) outcome = "TP";
      if (price <= signal.stopLoss) outcome = "SL";
    } else {
      if (price <= signal.takeProfit) outcome = "TP";
      if (price >= signal.stopLoss) outcome = "SL";
    }
    if (!outcome && ageMs > OPEN_SIGNAL_MAX_AGE_MS) outcome = "EXPIRED";
    if (!outcome) continue;

    const realizedR =
      outcome === "TP"
        ? signal.rewardRiskRatio
        : outcome === "SL"
          ? -1
          : signal.side === "long"
            ? (price - signal.entry) / Math.max(signal.entry - signal.stopLoss, 1e-9)
            : (signal.entry - price) / Math.max(signal.stopLoss - signal.entry, 1e-9);
    const closed = {
      ...signal,
      closedAt: new Date(now).toISOString(),
      closePrice: price,
      outcome,
      realizedR,
      review: buildReview(outcome, realizedR)
    };
    closedThisRun.push(closed);
    delete activeSignals[id];
    updateCalibration(state, signal.winRate, realizedR);
  }

  for (const candidate of candidates.filter((item) => item.status === "passed")) {
    const duplicate = Object.values(activeSignals).some(
      (signal) => signal.symbol === candidate.symbol && signal.side === candidate.side
    );
    if (duplicate) continue;
    activeSignals[candidate.id] = { ...candidate, createdAt: new Date(now).toISOString() };
  }

  state.activeSignals = activeSignals;
  state.closedSignals = [...(state.closedSignals || []), ...closedThisRun].slice(-100);
  return closedThisRun;
}

function buildReview(outcome, realizedR) {
  if (outcome === "TP") {
    return "Take profit reached. Increase weights for contributing factors slightly, then continue out-of-sample calibration.";
  }
  if (outcome === "SL") {
    return "Stop loss reached. Reduce weights for contributing factors and review event score, math direction, and cost assumptions.";
  }
  return `Signal expired with realizedR=${realizedR.toFixed(2)}. Lower confidence in similar time-window signals.`;
}

function updateCalibration(state, predictedWinRate, realizedR) {
  const calibration = state.calibration || createInitialState().calibration;
  const sample = calibration.samples + 1;
  const won = realizedR > 0 ? 1 : 0;
  calibration.samples = sample;
  calibration.wins += won;
  calibration.losses += won ? 0 : 1;
  calibration.avgPredictedWinRate =
    (calibration.avgPredictedWinRate * (sample - 1) + predictedWinRate) / sample;
  calibration.avgRealizedR = (calibration.avgRealizedR * (sample - 1) + realizedR) / sample;
  state.calibration = calibration;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function analyzeSymbol(symbol, state) {
  const [candles15m, candles1h, fundingRate, openInterest] = await Promise.all([
    fetchCandles(symbol, "15m", 120),
    fetchCandles(symbol, "1h", 120),
    fetchWithFallback(`${symbol} funding`, () => fetchFunding(symbol), 0),
    fetchWithFallback(`${symbol} open interest`, () => fetchOpenInterest(symbol), 0)
  ]);
  const warnings = [];
  if (fundingRate?.sourceFailure) warnings.push(fundingRate.sourceFailure);
  if (openInterest?.sourceFailure) warnings.push(openInterest.sourceFailure);
  const previousOpenInterest = state.openInterest?.[symbol] || null;
  const market = analyzeMarket(
    symbol,
    candles15m,
    candles1h,
    safeNumber(fundingRate),
    safeNumber(openInterest),
    previousOpenInterest,
    state.directionWeights || DIRECTION_MODEL_WEIGHTS
  );
  state.openInterest = state.openInterest || {};
  state.openInterest[symbol] = {
    value: safeNumber(openInterest),
    updatedAt: new Date().toISOString()
  };
  return { market, warnings };
}

function roundNumber(value, digits = 6) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function compactEvent(event) {
  return {
    id: event.id || null,
    type: event.type || "news",
    provider: event.provider || event.source,
    source: event.source,
    sourceName: event.sourceName || null,
    storyId: event.storyId || null,
    sourceTier: event.sourceTier || null,
    corroborationCount: event.corroborationCount || 1,
    duplicateCount: event.duplicateCount || 0,
    corroboratingSources: event.corroboratingSources || [event.source],
    trendScore: roundNumber(event.trendScore),
    title: event.title,
    url: event.url,
    occurredAt: event.occurredAt || null,
    receivedAt: event.receivedAt || null,
    freshness: event.freshness || null,
    direction: event.direction,
    rawImpactScore: Math.round(safeNumber(event.rawImpactScore, event.impactScore)),
    impactScore: Math.round(safeNumber(event.impactScore)),
    matchedSymbols: event.matchedSymbols || [],
    marketWide: Boolean(event.marketWide),
    yesPrice: roundNumber(event.yesPrice),
    yesProbability: roundNumber(event.yesProbability),
    noProbability: roundNumber(event.noProbability),
    outcomeLabels: event.outcomeLabels || [],
    outcomeProbabilities: (event.outcomeProbabilities || []).map((value) => roundNumber(value)),
    outcomeRatio: roundNumber(event.outcomeRatio),
    priceDelta: roundNumber(event.priceDelta),
    bullProbability: roundNumber(event.bullProbability),
    bearProbability: roundNumber(event.bearProbability),
    bullBearRatio: roundNumber(event.bullBearRatio),
    bullProbabilityDelta: roundNumber(event.bullProbabilityDelta),
    volume: roundNumber(event.volume),
    liquidity: roundNumber(event.liquidity),
    volumeDelta: roundNumber(event.volumeDelta),
    liquidityDelta: roundNumber(event.liquidityDelta),
    monitoringStatus: event.monitoringStatus || null,
    monitoringStartedAt: event.monitoringStartedAt || null,
    monitoringObservations: event.monitoringObservations || null,
    marketEndDate: event.marketEndDate || null,
    metrics: event.metrics || {},
    reasons: event.reasons || null,
    text: event.text
  };
}

function buildMessageFeed(scoredEvents) {
  return scoredEvents
    .slice()
    .sort((a, b) => safeNumber(b.impactScore) - safeNumber(a.impactScore))
    .slice(0, 80)
    .map(compactEvent);
}

function buildModelCalculations(marketAnalyses, eventsBySymbol, candidates) {
  const candidateBySymbol = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  return marketAnalyses
    .slice()
    .sort((a, b) => Math.abs(b.mathSignal) - Math.abs(a.mathSignal))
    .map((market) => {
      const eventAggregate = eventsBySymbol[market.symbol] || { score: 0, direction: 0, events: [] };
      const candidate = candidateBySymbol.get(market.symbol) || null;
      return {
        symbol: market.symbol,
        latest: market.latest,
        regime: market.regime,
        mathSignal: market.mathSignal,
        eventImpactScore: Math.round(eventAggregate.score || 0),
        eventDirection: roundNumber(eventAggregate.direction || 0),
        analysisMode: eventAggregate.score > 0 ? "event_math" : "math_only",
        candidateStatus: candidate?.status || "no_candidate",
        eventCount: roundNumber(eventAggregate.eventCount || 0, 3),
        candidateMode: candidate?.candidateMode || (eventAggregate.score > 0 ? "event_math" : "math_only"),
        noCandidateReason: candidate
          ? null
          : `abs(${eventAggregate.score > 0 ? "combinedDirection" : "mathSignal"}) < ${MIN_COMBINED_DIRECTION} or missing market price`,
        mathBreakdown: market.mathBreakdown,
        candidateCalculation: candidate?.calculation || null,
        signal: candidate
          ? {
              side: candidate.side,
              entry: candidate.entry,
              takeProfit: candidate.takeProfit,
              stopLoss: candidate.stopLoss,
              winRate: candidate.winRate,
              expectancyPct: candidate.expectancyPct,
              expectancyR: candidate.expectancyR,
              positionRiskPct: candidate.positionRiskPct,
              accountControl: candidate.accountControl,
              markowitz: candidate.markowitz
            }
          : null,
        advancedModels: {
          gbm: market.gbm,
          garch: market.garch,
          hiddenMarkov: market.hiddenMarkov,
          poisson:
            candidate?.calculation?.poisson ||
            analyzePoissonEventArrival(
              eventAggregate,
              clamp((eventAggregate.score || 0) / 100, 0, 1),
              eventAggregate.score >= 70 && Math.abs(eventAggregate.direction || 0) >= 0.2
            ),
          bayesian: candidate?.calculation?.bayesian || null,
          markowitz: candidate?.markowitz || null
        },
        relatedEvents: eventAggregate.events || []
      };
    });
}

function formatPrice(value) {
  if (value >= 1000) return value.toFixed(2);
  if (value >= 10) return value.toFixed(4);
  if (value >= 1) return value.toFixed(5);
  return value.toPrecision(6);
}

function renderConsoleReport(report) {
  const lines = [];
  lines.push(`Event signal monitor ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode}. Layer: ${report.layer}. This is not live trading.`);
  lines.push(
    `Sources: RSS=${report.sourceCounts.rss} Trend=${report.sourceCounts.trend} GDELT=${report.sourceCounts.gdelt} Polymarket=${report.sourceCounts.polymarket} Binance=${report.sourceCounts.binanceAnnouncements} OKX=${report.sourceCounts.okxAnnouncements} Whale=${report.sourceCounts.whale} UniqueStories=${report.sourceCounts.uniqueStories} Suppressed=${report.sourceCounts.suppressedDuplicates} Markets=${report.sourceCounts.marketAnalyses}`
  );
  if (report.warnings.length) {
    lines.push(`告警：${report.warnings.slice(0, 6).join(" | ")}`);
  }
  if (report.closedSignals.length) {
    lines.push("Closed signals this run:");
    for (const item of report.closedSignals) {
      lines.push(
        `- ${item.symbol} ${item.side} ${item.outcome} close=${formatPrice(item.closePrice)} R=${item.realizedR.toFixed(
          2
        )} review=${item.review}`
      );
    }
  }
  if (!report.actionableSignals.length) {
    lines.push("No actionable signal passed the hard gates in this run.");
  } else {
    lines.push("Actionable paper-alert candidates:");
    for (const signal of report.actionableSignals) {
      lines.push(
        `- ${signal.symbol} ${signal.side.toUpperCase()} entry=${formatPrice(signal.entry)} TP=${formatPrice(
          signal.takeProfit
        )} SL=${formatPrice(signal.stopLoss)} Pwin=${(signal.winRate * 100).toFixed(1)}% Gate=${(
          signal.adaptiveWinRateThreshold * 100
        ).toFixed(1)}% BE=${(signal.breakEvenWinRate * 100).toFixed(1)}% EV=${(
          signal.expectancyPct * 100
        ).toFixed(2)}% EV/R=${signal.expectancyR.toFixed(2)} risk=${(signal.positionRiskPct * 100).toFixed(
          2
        )}% event=${signal.eventImpactScore}`
      );
    }
  }
  lines.push(`Report: ${report.reportPath || LAYER_REPORT_PATH}`);
  return lines.join("\n");
}

async function main() {
  ensureRuntimeDir();
  const state = readJsonIfExists(STATE_PATH, createInitialState());
  state.version = MONITOR_VERSION;
  state.modelWeights = { ...BASE_MODEL_WEIGHTS, ...(state.modelWeights || {}) };
  state.polymarket = state.polymarket || {};
  state.openInterest = state.openInterest || {};
  state.newsTrends = state.newsTrends || {};
  state.sourceCache = state.sourceCache || {};
  const releaseInitialAccountLock = await acquireAccountLock();
  let accountConfig;
  let accountSessionId;
  let reviewWeightVersion = 1;
  try {
    accountConfig = readAccountConfig();
    const initialPaperAccount = readPaperAccount(accountConfig);
    accountSessionId = initialPaperAccount.sessionId;
    state.directionWeights = initialPaperAccount.postTradeReview.currentDirectionWeights;
    reviewWeightVersion = initialPaperAccount.postTradeReview.weightVersion;
  } finally {
    releaseInitialAccountLock();
  }
  const warnings = [
    "仅模拟告警：脚本不会发送实盘订单。",
    "无证据表明新闻聚合、大模型推理或 Polymarket 赔率本身能稳定盈利。"
  ];
  const [aggregatorFetch, gdeltFetch, polymarketFetch, binanceFetch, okxFetch, whaleFetch] =
    await Promise.all([
      fetchCachedSource(state, "aggregator", SOURCE_REFRESH_MS.aggregator, fetchMessageAggregator),
      fetchCachedSource(state, "gdelt", SOURCE_REFRESH_MS.gdelt, () =>
        GDELT_ENABLED ? fetchWithFallback("GDELT", fetchGdeltNews, []) : Promise.resolve([])
      ),
      fetchCachedSource(state, "polymarket", SOURCE_REFRESH_MS.polymarket, () =>
        fetchWithFallback("Polymarket", () => fetchPolymarketMarkets(state), [])
      ),
      fetchCachedSource(state, "binanceAnnouncements", SOURCE_REFRESH_MS.announcements, () =>
        fetchWithFallback("Binance announcements", fetchBinanceAnnouncements, [])
      ),
      fetchCachedSource(state, "okxAnnouncements", SOURCE_REFRESH_MS.announcements, () =>
        fetchWithFallback("OKX announcements", fetchOkxAnnouncements, [])
      ),
      fetchCachedSource(state, "whale", SOURCE_REFRESH_MS.whale, () =>
        fetchWithFallback("WhaleAlert", fetchWhaleAlertIfConfigured, { items: [], warning: null })
      )
    ]);
  const aggregatorResult = aggregatorFetch.value;
  const gdeltNewsResult = gdeltFetch.value;
  const polymarketResult = polymarketFetch.value;
  const binanceAnnouncementsResult = binanceFetch.value;
  const okxAnnouncementsResult = okxFetch.value;
  const whaleResult = whaleFetch.value;
  for (const result of [aggregatorFetch, gdeltFetch, polymarketFetch, binanceFetch, okxFetch, whaleFetch]) {
    if (result.refreshFailure) warnings.push(`缓存降级：${result.refreshFailure}`);
  }
  const sourceRefresh = Object.fromEntries(
    Object.entries({ aggregator: aggregatorFetch, gdelt: gdeltFetch, polymarket: polymarketFetch, binanceAnnouncements: binanceFetch, okxAnnouncements: okxFetch, whale: whaleFetch })
      .map(([key, result]) => [key, { cached: result.cached, stale: result.stale === true, fetchedAt: result.fetchedAt, attemptedAt: result.attemptedAt || null, refreshFailure: result.refreshFailure || null, ttlMs: result.ttlMs }])
  );

  const rawAggregatedItems = Array.isArray(aggregatorResult?.items) ? aggregatorResult.items : [];
  const trendUpdate = updateTrendHistory(rawAggregatedItems, state.newsTrends);
  const aggregatedItems = trendUpdate.items;
  state.newsTrends = trendUpdate.history;
  const gdeltNews = Array.isArray(gdeltNewsResult) ? gdeltNewsResult : [];
  const polymarketMarkets = Array.isArray(polymarketResult) ? polymarketResult : [];
  const binanceAnnouncements = Array.isArray(binanceAnnouncementsResult) ? binanceAnnouncementsResult : [];
  const okxAnnouncements = Array.isArray(okxAnnouncementsResult) ? okxAnnouncementsResult : [];
  const whaleItems = Array.isArray(whaleResult?.items) ? whaleResult.items : [];
  if (whaleResult?.warning) warnings.push(whaleResult.warning);
  if (aggregatorResult?.sourceFailures?.length) warnings.push(...aggregatorResult.sourceFailures);
  for (const result of [gdeltNewsResult, polymarketResult, binanceAnnouncementsResult, okxAnnouncementsResult, whaleResult]) {
    if (result?.sourceFailure) warnings.push(result.sourceFailure);
  }

  const collectedAt = new Date().toISOString();
  const allEvents = [
    ...aggregatedItems,
    ...gdeltNews,
    ...polymarketMarkets,
    ...binanceAnnouncements,
    ...okxAnnouncements,
    ...whaleItems
  ].map((item) => ({ ...item, receivedAt: item.receivedAt || collectedAt }));
  const storyClustering = clusterMessageItems(allEvents);
  const scoredEvents = storyClustering.items.map(classifyEvent);
  const classifiedEvents = scoredEvents.filter((event) => event.impactScore >= 18);
  const eventsBySymbol = aggregateEventsBySymbol(classifiedEvents);

  const marketResults = await mapWithConcurrency(SYMBOLS, MARKET_CONCURRENCY, async (symbol) => {
    try {
      return await analyzeSymbol(symbol, state);
    } catch (error) {
      return {
        market: null,
        warnings: [`${symbol} 行情数据：${localizeErrorMessage(error instanceof Error ? error.message : String(error))}`]
      };
    }
  });
  const marketAnalyses = [];
  for (const result of marketResults) {
    if (result?.market) marketAnalyses.push(result.market);
    if (result?.warnings?.length) warnings.push(...result.warnings);
  }

  for (const market of polymarketMarkets) {
    if (market.id) {
      state.polymarket[market.id] = updatePredictionMarketTracking(
        state.polymarket[market.id],
        {
          id: market.id,
          slug: market.marketSlug,
          title: market.title,
          active: market.marketActive,
          closed: market.marketClosed,
          endDate: market.marketEndDate,
          yesPrice: market.yesPrice,
          yesProbability: market.yesProbability,
          noProbability: market.noProbability,
          bullProbability: market.bullProbability,
          bearProbability: market.bearProbability,
          outcomeRatio: market.outcomeRatio,
          bullBearRatio: market.bullBearRatio,
          volume: market.volume,
          liquidity: market.liquidity
        },
        market.receivedAt || new Date().toISOString()
      );
    }
  }

  const marketBySymbol = Object.fromEntries(marketAnalyses.map((market) => [market.symbol, market]));
  const rawCandidates = marketAnalyses
    .map((market) =>
      buildCandidate(
        market,
        eventsBySymbol[market.symbol] || { score: 0, direction: 0, events: [] },
        state.modelWeights,
        accountConfig,
        reviewWeightVersion,
        state.calibration
      )
    )
    .filter(Boolean);
  const markowitzResult = applyMarkowitzSizing(rawCandidates, marketBySymbol, accountConfig);
  const candidates = markowitzResult.candidates.sort((a, b) => b.expectancyR - a.expectancyR);
  const actionableSignals = candidates.filter((candidate) => candidate.status === "passed").slice(0, 5);
  const watchlist = candidates.filter((candidate) => candidate.status !== "passed").slice(0, 8);
  const closedSignals = updateOpenSignalsAndReviews(state, actionableSignals, marketBySymbol);
  const releaseAccountLock = await acquireAccountLock();
  let finalAccountConfig;
  let updatedPaperAccount;
  try {
    finalAccountConfig = readAccountConfig();
    const latestPaperAccount = readPaperAccount(finalAccountConfig);
    const sameAccountSession =
      sameAccountConfig(accountConfig, finalAccountConfig) && accountSessionId === latestPaperAccount.sessionId;
    updatedPaperAccount =
      latestPaperAccount.isActive && sameAccountSession
        ? updatePaperAccount(latestPaperAccount, actionableSignals, candidates, marketBySymbol)
        : latestPaperAccount;
    state.directionWeights = updatedPaperAccount.postTradeReview?.currentDirectionWeights || state.directionWeights;
    writeJson(ACCOUNT_STATE_PATH, updatedPaperAccount);
  } finally {
    releaseAccountLock();
  }
  const messageFeed = buildMessageFeed(scoredEvents);
  const modelCalculations = buildModelCalculations(marketAnalyses, eventsBySymbol, candidates);

  state.updatedAt = new Date().toISOString();
  const report = {
    version: MONITOR_VERSION,
    generatedAt: state.updatedAt,
    mode: "paper-alert-only",
    layer: RUN_LAYER,
    simulatedAccount: finalAccountConfig,
    layerTasks: {
      unifiedHighFrequency: [
        "Binance/OKX market data",
        "funding",
        "open interest",
        "Polymarket price delta",
        "exchange announcements",
        "built-in RSS aggregation",
        "NewsNow trend ranking",
        "GDELT global news",
        "story clustering",
        "event review",
        "model weight calibration",
        "TP/SL/adaptive exit/expiry review"
      ]
    },
    analysisPolicy: {
      noMessageFallback: "消息面为空时，不中断流程；改用数学模型单独分析市场状态。",
      mathOnlyInputs: [
        "EMA20/EMA50",
        "1h EMA20/EMA50",
        "ATR",
        "RSI",
        "15m/1h ROC",
        "资金费率",
        "OI 变化",
        "GBM",
        "GARCH(1,1)",
        "三状态 HMM",
        "泊松事件到达分布",
        "贝叶斯后验胜率校准",
        "Markowitz 均值-方差配置"
      ],
      advancedModelWeights: {
        direction: state.directionWeights || DIRECTION_MODEL_WEIGHTS,
        exit: updatedPaperAccount.postTradeReview?.currentExitWeights || DEFAULT_EXIT_MODEL_WEIGHTS,
        garchConfidenceWeight: GARCH_CONFIDENCE_WEIGHT,
        markowitzSizingWeight: MARKOWITZ_SIZING_WEIGHT,
        bayesianPosteriorWeight: BAYESIAN_POSTERIOR_WEIGHT
      },
      mathOnlyGate:
        "纯数学模式仍必须满足方向强度、正 EV 和自适应胜率门槛；门槛由成本保本胜率、校准误差、样本量、行情状态、波动和因子分歧共同决定，未过线只进入观察或模型展示。",
      liveTrading: "paper-alert-only，不会发送实盘订单。"
    },
    reportPath: LAYER_REPORT_PATH,
    disclaimer:
      "Trading signals are not profit guarantees. No live order is sent unless the user separately authorizes real trading API access.",
    gateRules: {
      mode: "adaptive-break-even-plus-uncertainty",
      formula:
        "threshold = clamp(cost-adjusted break-even win rate + profile/sample/calibration/regime/volatility/alignment/mode margins - strong-direction discount, profile safety bounds)",
      safetyBounds: ADAPTIVE_GATE_BOUNDS,
      minHighExpectancyR: MIN_HIGH_EXPECTANCY_R,
      minEvPct: MIN_EV_PCT
    },
    portfolioOptimization: markowitzResult.portfolio,
    sourceCounts: {
      aggregated: aggregatedItems.length,
      rss: aggregatedItems.filter((item) => item.provider === "Built-in RSS").length,
      trend: aggregatedItems.filter((item) => item.provider === "NewsNow").length,
      gdelt: gdeltNews.length,
      polymarket: polymarketMarkets.length,
      binanceAnnouncements: binanceAnnouncements.length,
      okxAnnouncements: okxAnnouncements.length,
      whale: whaleItems.length,
      rawEvents: storyClustering.stats.inputCount,
      uniqueStories: storyClustering.stats.outputCount,
      suppressedDuplicates: storyClustering.stats.suppressedDuplicates,
      classifiedEvents: classifiedEvents.length,
      marketAnalyses: marketAnalyses.length
    },
    sourceRefresh,
    storyClustering: storyClustering.stats,
    warnings: [...new Set(warnings)].slice(0, 80),
    messageFeed,
    modelCalculations,
    actionableSignals,
    watchlist,
    closedSignals,
    activeSignals: Object.values(state.activeSignals || {}),
    paperAccount: updatedPaperAccount,
    calibration: state.calibration,
    modelWeights: state.modelWeights,
    directionWeights: state.directionWeights,
    postTradeReview: updatedPaperAccount.postTradeReview || null
  };

  let historyStorage;
  try {
    historyStorage = appendCompactHistory({
      filePath: HISTORY_PATH,
      report,
      state,
      now: report.generatedAt
    });
  } catch (error) {
    historyStorage = {
      written: false,
      reason: "write_failed",
      error: error instanceof Error ? error.message : String(error)
    };
    report.warnings = [
      ...new Set([...report.warnings, `历史摘要写入失败：${historyStorage.error}`])
    ];
  }
  report.historyStorage = historyStorage;
  if (historyStorage.reason === "low_disk") {
    report.warnings = [...new Set([...report.warnings, "历史摘要写入已暂停：磁盘可用空间低于 10%。"])];
  }
  writeJson(STATE_PATH, state);
  writeJson(LAYER_REPORT_PATH, report);
  if (LAYER_REPORT_PATH !== REPORT_PATH) {
    writeJson(REPORT_PATH, report);
  }
  console.log(renderConsoleReport(report));
}

async function run() {
  const startedAt = Date.now();
  appendRuntimeLog(`[${new Date(startedAt).toISOString()}] signal:monitor run started`);
  const releaseLock = await acquireRuntimeLock();
  try {
    await main();
    appendRuntimeLog(`[${new Date().toISOString()}] signal:monitor run completed elapsedMs=${Date.now() - startedAt}`);
  } catch (error) {
    appendRuntimeLog(`[${new Date().toISOString()}] signal:monitor run failed elapsedMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    releaseLock();
  }
}

function runCostModelSelfTest() {
  const config = normalizeAccountConfig({
    initialCapital: 1000,
    marketType: "futures",
    maxLeverage: 3
  });
  const account = createPaperAccount(config, "2026-06-05T00:01:00.000Z");
  account.isActive = true;
  const signal = {
    id: "SELFTEST-LONG",
    status: "passed",
    symbol: "BTCUSDT",
    side: "long",
    candidateMode: "math_only",
    entry: 100,
    takeProfit: 110,
    stopLoss: 90,
    winRate: 0.6,
    expectancyPct: 0.01,
    expectancyR: 0.5,
    eventImpactScore: 0,
    relatedEvents: [],
    accountControl: {
      allowed: true,
      appliedLeverage: 2,
      modelSuggestedLeverage: 2,
      leverageCapped: false,
      notional: 100,
      marginRequired: 50,
      quantity: 1,
      maxLossAmount: 10
    }
  };
  const opened = openPaperPosition(account, signal, "2026-06-05T00:01:00.000Z");
  if (!opened || opened.entry <= signal.entry || account.tradingFees <= 0 || account.slippageCost <= 0) {
    throw new Error("entry fee/slippage self-test failed");
  }
  opened.nextFundingAt = "2026-06-05T08:00:00.000Z";
  const marketBySymbol = {
    BTCUSDT: { latest: 100, fundingRate: 0.001 }
  };
  markPaperPositions(account, marketBySymbol, "2026-06-05T08:00:00.000Z");
  if (!(account.fundingPnl < 0) || opened.fundingSettlements !== 1 || !(opened.estimatedExitFee > 0)) {
    throw new Error("funding/estimated exit fee self-test failed");
  }
  const closed = closePaperPosition(
    account,
    opened.id,
    110,
    "TP",
    "2026-06-05T08:01:00.000Z"
  );
  if (!closed || !(closed.exitPrice < 110) || !(closed.exitFee > 0) || !(closed.realizedPnl < closed.grossTradingPnl)) {
    throw new Error("exit fee/slippage self-test failed");
  }
  console.log(
    JSON.stringify({
      passed: true,
      entryFee: opened.entryFee,
      entrySlippageCost: opened.entrySlippageCost,
      fundingPnl: closed.fundingPnl,
      exitFee: closed.exitFee,
      exitSlippageCost: closed.exitSlippageCost,
      netRealizedPnl: closed.realizedPnl
    })
  );
}

function runAdvancedModelsSelfTest() {
  const returns = Array.from(
    { length: 96 },
    (_, index) => 0.0008 + Math.sin(index / 5) * 0.00045
  );
  const gbm = analyzeGeometricBrownianMotion(returns);
  const garch = estimateGarch11(returns);
  const hiddenMarkov = analyzeHiddenMarkovRegime(returns);
  const poisson = analyzePoissonEventArrival(
    { score: 72, direction: 0.8, eventCount: 4, events: [{}, {}, {}, {}] },
    0.72,
    true
  );
  const bayesian = bayesianWinRateUpdate({
    priorWinRate: 0.58,
    combinedDirection: 0.55,
    eventScoreNorm: 0.72,
    alignment: 1,
    volatilityRegimeScore: 0.1,
    advancedModelQualityBoost: 0.02,
    poisson,
    roundTripExecutionCostPct: 0.0016,
    riskPct: 0.02
  });
  if (!(gbm.probabilityUp > 0.5) || !Number.isFinite(gbm.expectedReturn)) {
    throw new Error("GBM self-test failed");
  }
  if (
    !Number.isFinite(garch.forecastVolatility) ||
    !(garch.alpha + garch.beta < 1) ||
    !(garch.confidenceMultiplier > 0)
  ) {
    throw new Error("GARCH self-test failed");
  }
  if (
    !(hiddenMarkov.bullProbability > hiddenMarkov.bearProbability) ||
    Math.abs(
      hiddenMarkov.bullProbability +
        hiddenMarkov.bearProbability +
        hiddenMarkov.rangeProbability -
        1
    ) > 1e-9
  ) {
    throw new Error("HMM self-test failed");
  }
  if (
    !(poisson.tailProbability >= 0 && poisson.tailProbability <= 1) ||
    !(poisson.burstSurprise >= 0 && poisson.burstSurprise <= 1)
  ) {
    throw new Error("Poisson self-test failed");
  }
  if (
    !(bayesian.posteriorWinRate > bayesian.priorWinRate) ||
    !(bayesian.likelihoodWin > bayesian.likelihoodLoss)
  ) {
    throw new Error("Bayesian self-test failed");
  }

  const config = normalizeAccountConfig({
    initialCapital: 1000,
    marketType: "futures",
    maxLeverage: 5
  });
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const candidates = symbols.map((symbol, index) => ({
    symbol,
    side: index === 1 ? "short" : "long",
    entry: 100,
    riskPct: 0.02,
    positionRiskPct: 0.005,
    winRate: 0.6,
    expectancyPct: 0.006 - index * 0.001,
    expectancyR: 0.3,
    combinedDirection: index === 1 ? -0.5 : 0.5,
    highImpactEvent: false,
    factors: {},
    calculation: { sizing: {} },
    reasons: []
  }));
  const marketBySymbol = Object.fromEntries(
    symbols.map((symbol, index) => [
      symbol,
      {
        returns15m: returns.map((value, returnIndex) =>
          value * (1 - index * 0.15) + Math.cos(returnIndex / (4 + index)) * 0.0002
        ),
        gbm: { expectedReturn: gbm.expectedReturn * (1 - index * 0.2) },
        garch,
        volatilityExpansion: 1
      }
    ])
  );
  const markowitz = applyMarkowitzSizing(candidates, marketBySymbol, config);
  const weightSum = Object.values(markowitz.portfolio.weights).reduce(
    (sum, value) => sum + value,
    0
  );
  if (Math.abs(weightSum - 1) > 1e-9 || markowitz.candidates.some((item) => !item.accountControl)) {
    throw new Error("Markowitz self-test failed");
  }
  console.log(
    JSON.stringify({
      passed: true,
      gbm: { probabilityUp: gbm.probabilityUp, signal: gbm.signal },
      garch: {
        alpha: garch.alpha,
        beta: garch.beta,
        volatilityRatio: garch.volatilityRatio
      },
      hiddenMarkov: {
        regime: hiddenMarkov.regime,
        bullProbability: hiddenMarkov.bullProbability
      },
      poisson: {
        observedEvents: poisson.observedEvents,
        tailProbability: poisson.tailProbability
      },
      bayesian: {
        priorWinRate: bayesian.priorWinRate,
        posteriorWinRate: bayesian.posteriorWinRate
      },
      markowitz: markowitz.portfolio
    })
  );
}

function runRiskProfileSelfTest() {
  const stableGate = evaluateAdaptiveEntryGate({
    riskProfile: "aggressive",
    expectancyPct: 0.003,
    riskPct: 0.02,
    rewardRiskRatio: 1.5,
    roundTripExecutionCostPct: 0.0016,
    winRate: 0.58,
    regime: "trend",
    volatilityExpansion: 1,
    alignment: 1,
    candidateMode: "event_impact",
    combinedDirection: 0.75,
    calibration: { samples: 200, wins: 116, avgPredictedWinRate: 0.58 }
  });
  const unstableGate = evaluateAdaptiveEntryGate({
    riskProfile: "conservative",
    expectancyPct: 0.003,
    riskPct: 0.02,
    rewardRiskRatio: 1.5,
    roundTripExecutionCostPct: 0.0016,
    winRate: 0.58,
    regime: "transition",
    volatilityExpansion: 2,
    alignment: -0.35,
    candidateMode: "math_only",
    combinedDirection: 0.3,
    calibration: { samples: 0 }
  });
  const negativeEvGate = evaluateAdaptiveEntryGate({
    riskProfile: "aggressive",
    expectancyPct: -0.001,
    riskPct: 0.02,
    rewardRiskRatio: 1.5,
    winRate: 0.9
  });
  if (
    !stableGate.passesGate ||
    unstableGate.passesGate ||
    unstableGate.adaptiveWinRateThreshold <= stableGate.adaptiveWinRateThreshold ||
    negativeEvGate.passesGate
  ) {
    throw new Error("risk profile gate self-test failed");
  }

  const controlInput = {
    side: "long",
    entry: 100,
    riskPct: 0.02,
    positionRiskPct: 0.005,
    winRate: 0.64,
    expectancyR: 0.3,
    combinedDirection: 0.55,
    volatilityExpansion: 1
  };
  const conservativeControl = buildAccountControl({
    ...controlInput,
    accountConfig: {
      initialCapital: 1000,
      marketType: "futures",
      maxLeverage: 20,
      riskProfile: "conservative"
    }
  });
  const aggressiveControl = buildAccountControl({
    ...controlInput,
    accountConfig: {
      initialCapital: 1000,
      marketType: "futures",
      maxLeverage: 20,
      riskProfile: "aggressive"
    }
  });
  const cappedAggressiveControl = buildAccountControl({
    ...controlInput,
    accountConfig: {
      initialCapital: 1000,
      marketType: "futures",
      maxLeverage: 3,
      riskProfile: "aggressive"
    }
  });
  if (
    aggressiveControl.modelSuggestedLeverage + 1e-9 <
      conservativeControl.modelSuggestedLeverage * 2 ||
    aggressiveControl.appliedLeverage + 1e-9 <
      conservativeControl.appliedLeverage * 2 ||
    cappedAggressiveControl.appliedLeverage > 3 ||
    !cappedAggressiveControl.aggressiveLeverageLimitedByCap
  ) {
    throw new Error("risk profile leverage self-test failed");
  }

  console.log(
    JSON.stringify({
      passed: true,
      gates: {
        stableThreshold: stableGate.adaptiveWinRateThreshold,
        unstableThreshold: unstableGate.adaptiveWinRateThreshold,
        stablePassed: stableGate.passesGate,
        unstablePassed: unstableGate.passesGate,
        negativeEvPassed: negativeEvGate.passesGate
      },
      leverage: {
        conservativeSuggested: conservativeControl.modelSuggestedLeverage,
        aggressiveSuggested: aggressiveControl.modelSuggestedLeverage,
        cappedAggressiveApplied: cappedAggressiveControl.appliedLeverage
      }
    })
  );
}

function runAdaptiveExitIntegrationSelfTest() {
  const config = normalizeAccountConfig({
    initialCapital: 1000,
    marketType: "futures",
    maxLeverage: 2
  });
  const account = createPaperAccount(config, "2026-07-18T00:00:00.000Z");
  account.isActive = true;
  account.postTradeReview.currentExitWeights = normalizeExitWeights({
    signalReversal: 0.7,
    netExpectancyDecay: 0.01,
    eventDecay: 0.01,
    timeDecay: 0.01
  });
  const signal = {
    id: "EXIT-INTEGRATION-LONG",
    status: "passed",
    symbol: "BTCUSDT",
    side: "long",
    candidateMode: "math_only",
    entry: 100,
    takeProfit: 110,
    stopLoss: 90,
    winRate: 0.6,
    expectancyPct: 0.01,
    expectancyR: 0.5,
    eventImpactScore: 0,
    relatedEvents: [],
    regime: "range",
    factorSnapshot: { regime: "range", marketInputs: { atrPct: 0.01 } },
    accountControl: {
      allowed: true,
      appliedLeverage: 2,
      modelSuggestedLeverage: 2,
      leverageCapped: false,
      notional: 1998,
      marginRequired: 999,
      maxLossAmount: 100
    }
  };
  const opened = openPaperPosition(account, signal, "2026-07-18T00:00:00.000Z");
  const marketBySymbol = { BTCUSDT: { latest: 100, fundingRate: 0 } };
  markPaperPositions(account, marketBySymbol, "2026-07-18T00:00:10.000Z");
  const availableRatio = account.equity > 0 ? account.availableEquity / account.equity : 0;
  if (!opened || !(availableRatio < 0.2)) {
    throw new Error("position sizing unexpectedly reserves 20% free equity");
  }
  const candidatesBySymbol = {
    BTCUSDT: { side: "short", combinedDirection: -1, winRate: 0.86 }
  };
  for (let index = 1; index <= 2; index += 1) {
    const closed = closeTriggeredPaperPositions(
      account,
      marketBySymbol,
      candidatesBySymbol,
      index === 1 ? "2026-07-18T00:00:20.000Z" : "2026-07-18T00:00:30.000Z"
    );
    if (closed.length || !account.positions[opened.id]) {
      throw new Error("adaptive exit ignored its confirmation requirement");
    }
  }
  const closed = closeTriggeredPaperPositions(
    account,
    marketBySymbol,
    candidatesBySymbol,
    "2026-07-18T00:00:40.000Z"
  );
  if (
    closed.length !== 1 ||
    closed[0].closeReason !== "ADAPTIVE_EXIT" ||
    closed[0].exitCounterfactual?.status !== "pending" ||
    account.lifetimeClosedTrades !== 1
  ) {
    throw new Error(
      `adaptive exit integration self-test failed: ${JSON.stringify({
        closedCount: closed.length,
        reason: closed[0]?.closeReason,
        counterfactualStatus: closed[0]?.exitCounterfactual?.status,
        lifetimeClosedTrades: account.lifetimeClosedTrades,
        positionRemaining: Boolean(account.positions[opened.id]),
        confirmationCount: account.positions[opened.id]?.exitConfirmationCount,
        exitEvaluation: account.positions[opened.id]?.exitEvaluation
      })}`
    );
  }
  console.log(
    JSON.stringify({
      passed: true,
      availableEquityRatio: availableRatio,
      confirmationRuns: 3,
      closeReason: closed[0].closeReason,
      lifetimeClosedTrades: account.lifetimeClosedTrades
    })
  );
}

const execution = process.argv.includes("--self-test-costs")
  ? Promise.resolve().then(runCostModelSelfTest)
  : process.argv.includes("--self-test-models")
    ? Promise.resolve().then(runAdvancedModelsSelfTest)
    : process.argv.includes("--self-test-profiles")
      ? Promise.resolve().then(runRiskProfileSelfTest)
      : process.argv.includes("--self-test-exit-integration")
        ? Promise.resolve().then(runAdaptiveExitIntegrationSelfTest)
      : run();

execution.catch((error) => {
  ensureRuntimeDir();
  const report = {
    version: MONITOR_VERSION,
    generatedAt: new Date().toISOString(),
    mode: "paper-alert-only",
    layer: RUN_LAYER,
    fatal: error instanceof Error ? error.message : String(error),
    warnings: ["本轮运行发生致命错误：不要使用本轮信号。"]
  };
  writeJson(LAYER_REPORT_PATH, report);
  if (LAYER_REPORT_PATH !== REPORT_PATH) {
    writeJson(REPORT_PATH, report);
  }
  console.error(`Event signal monitor failed: ${report.fatal}`);
  process.exitCode = 1;
});
