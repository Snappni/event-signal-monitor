#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import WebSocket from "ws";
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
  buildTradeCalibration,
  calibrateCandidateWinRate,
  evaluateAdaptiveEntryGate
} from "./adaptive-entry-gate.mjs";
import {
  DEFAULT_EXIT_MODEL_WEIGHTS,
  EXIT_FACTOR_KEYS,
  evaluateAdaptivePositionExit,
  normalizeExitWeights
} from "./adaptive-position-exit.mjs";
import {
  evaluateDynamicPositionProtection,
  initializeDynamicProtection
} from "./dynamic-position-protection.mjs";
import { appendCompactHistory } from "./compact-history.mjs";
import { planCapitalRotation } from "./capital-rotation.mjs";
import {
  alignToStep,
  applyBinanceMarketOrderRules,
  parseBinanceExchangeInfo,
  parseBinanceLeverageBrackets,
  resolveBinanceLeverage
} from "./binance-trading-rules.mjs";
import {
  appendTradeHistoryRecords,
  compactArchivedTrade,
  loadTradeHistoryRecords,
  tradeHistoryStats
} from "./trade-history-store.mjs";
import { createMarketMicrostructure } from "./market-microstructure.mjs";
import { closePaperPosition } from "./paper-position-settlement.mjs";
import { classifyMarketSession, limitSessionEntryCandidates } from "./market-session-policy.mjs";
import {
  buildFactorSnapshots,
  buildHistoricalFactorFrames,
  createFactorLibraryStatus,
  factorDecisionForSnapshot,
  normalizeFactorLibraryConfig,
  normalizeFactorLibraryStatus,
  publicFactorLibrary,
  updateFactorLibraryRuntime
} from "./factor-library.mjs";
import { riskBudgetForNewPosition } from "./paper-risk-policy.mjs";

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
const isSelfTestInvocation = process.argv.some((argument) => argument.startsWith("--self-test-"));
let tradeHistoryMigrated = false;

const MONITOR_VERSION = "0.18.0";
const RUN_LAYER = "event-driven-hybrid";
const LAYER_REPORT_PATH = REPORT_PATH;
const MESSAGE_FEED_LIMIT = 200;
const LOCK_PATH = path.resolve(RUNTIME_DIR, "run.lock");
const ACCOUNT_LOCK_PATH = path.resolve(RUNTIME_DIR, "account.lock");
const SERVICE_STATUS_PATH = path.resolve(RUNTIME_DIR, "service-status.json");
const SERVICE_LOCK_PATH = path.resolve(RUNTIME_DIR, "service.lock");
const FACTOR_LIBRARY_CONFIG_PATH = path.resolve(RUNTIME_DIR, "factor-library-config.json");
const FACTOR_LIBRARY_STATUS_PATH = path.resolve(RUNTIME_DIR, "factor-library-status.json");
const SERVICE_ACTIVE_DECISION_DELAY_MS = toPositiveInt(
  process.env.SIGNAL_ACTIVE_DECISION_DELAY_MS,
  5_000
);
const SERVICE_IDLE_DECISION_DELAY_MS = toPositiveInt(
  process.env.SIGNAL_IDLE_DECISION_DELAY_MS,
  30_000
);
const SERVICE_MAX_BACKOFF_MS = toPositiveInt(process.env.SIGNAL_MAX_DECISION_BACKOFF_MS, 120_000);
const PRICE_EVENT_COALESCE_MS = toPositiveInt(process.env.SIGNAL_PRICE_EVENT_COALESCE_MS, 100);
const ORDER_FLOW_SYMBOL_LIMIT = toPositiveInt(process.env.SIGNAL_ORDER_FLOW_SYMBOL_LIMIT, 12);
const FACTOR_EXTERNAL_SYMBOL_LIMIT = toPositiveInt(process.env.SIGNAL_FACTOR_EXTERNAL_SYMBOL_LIMIT, 4);
const FACTOR_HISTORY_SYMBOL_LIMIT = toPositiveInt(process.env.SIGNAL_FACTOR_HISTORY_SYMBOL_LIMIT, 6);
const FACTOR_HISTORY_LOOKBACK_MONTHS = toPositiveInt(process.env.SIGNAL_FACTOR_HISTORY_MONTHS, 3);
const FACTOR_HISTORY_INTERVAL_MINUTES = 15;
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
const marketMicrostructure = createMarketMicrostructure();
const factorSourceCache = new Map();
const factorBasisHistory = new Map();

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
  whale: toPositiveInt(process.env.SIGNAL_WHALE_REFRESH_MS, 15_000),
  tradingRules: toPositiveInt(process.env.SIGNAL_BINANCE_RULES_REFRESH_MS, 60 * 60 * 1000)
};
const GDELT_ENABLED = process.env.SIGNAL_MONITOR_GDELT_ENABLED !== "false";
const WHALE_ALERT_ENABLED = process.env.WHALE_ALERT_ENABLED !== "false";
const OPEN_SIGNAL_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const SIGNAL_OUTCOME_HISTORY_LIMIT = 500;
const MODEL_TRADE_HISTORY_LIMIT = 20_000;
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
    stoppedAt: null,
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
    tradeHistorySchemaVersion: 2,
    capitalRotationHistory: [],
    exitDecisionHistory: [],
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
  if (!Object.hasOwn(account, "stoppedAt")) account.stoppedAt = null;
  account.tradingFees = safeNumber(account.tradingFees);
  account.slippageCost = safeNumber(account.slippageCost);
  account.fundingPnl = safeNumber(account.fundingPnl);
  account.capitalRotationHistory = Array.isArray(account.capitalRotationHistory)
    ? account.capitalRotationHistory.slice(-500)
    : [];
  account.exitDecisionHistory = Array.isArray(account.exitDecisionHistory)
    ? account.exitDecisionHistory.slice(-500)
    : [];
  for (const position of Object.values(account.positions)) {
    position.riskProfile =
      position.riskProfile === "aggressive" ? "aggressive" : config.riskProfile;
  }
  account.tradeHistory = Array.isArray(account.tradeHistory) ? account.tradeHistory : [];
  if (safeNumber(account.tradeHistorySchemaVersion) !== 2) {
    account.tradeHistory = account.tradeHistory.map((trade) => compactArchivedTrade(trade));
    account.tradeHistorySchemaVersion = 2;
  }
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
 …51542 tokens truncated…iskPct: 0.02,
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
    symbol: "BTCUSDT",
    tradingRule: selfTestTradingRule("BTCUSDT"),
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
  const paperFallbackControl = buildAccountControl({
    ...controlInput,
    tradingRule: {
      ...controlInput.tradingRule,
      leverageBrackets: [],
      leverageExact: false,
      leverageRuleSource: "missing-user-leverage-bracket"
    },
    accountConfig: {
      initialCapital: 1000,
      marketType: "futures",
      maxLeverage: 20,
      riskProfile: "aggressive"
    }
  });
  const missingRulePaperControl = buildAccountControl({
    ...controlInput,
    tradingRule: null,
    accountConfig: {
      initialCapital: 1000,
      marketType: "futures",
      maxLeverage: 20,
      riskProfile: "aggressive"
    }
  });
  const zeroRiskPaperControl = buildAccountControl({
    ...controlInput,
    tradingRule: null,
    positionRiskPct: 0,
    accountConfig: {
      initialCapital: 1000,
      marketType: "futures",
      maxLeverage: 20,
      riskProfile: "aggressive"
    }
  });
  const missingRuleConfig = normalizeAccountConfig({
    initialCapital: 1000,
    marketType: "futures",
    maxLeverage: 20,
    riskProfile: "aggressive"
  });
  const missingRuleAccount = createPaperAccount(missingRuleConfig, "2026-07-19T00:00:00.000Z");
  missingRuleAccount.isActive = true;
  const missingRulePosition = openPaperPosition(missingRuleAccount, {
    id: "MISSING-RULE-PAPER",
    status: "passed",
    symbol: "BTCUSDT",
    side: "long",
    candidateMode: "math_only",
    entry: 100,
    takeProfit: 110,
    stopLoss: 90,
    winRate: 0.64,
    expectancyPct: 0.01,
    expectancyR: 0.3,
    eventImpactScore: 0,
    relatedEvents: [],
    accountControl: missingRulePaperControl
  }, "2026-07-19T00:01:00.000Z");
  if (
    aggressiveControl.modelSuggestedLeverage + 1e-9 <
      conservativeControl.modelSuggestedLeverage * 2 ||
    aggressiveControl.appliedLeverage + 1e-9 <
      conservativeControl.appliedLeverage * 2 ||
    cappedAggressiveControl.appliedLeverage > 3 ||
    !cappedAggressiveControl.aggressiveLeverageLimitedByCap ||
    conservativeControl.marginRequired > 1000 * conservativeControl.marginConcentrationCapRatio + 1e-9 ||
    aggressiveControl.marginRequired > 1000 * aggressiveControl.marginConcentrationCapRatio + 1e-9 ||
    !(aggressiveControl.marginConcentrationCapRatio > conservativeControl.marginConcentrationCapRatio) ||
    paperFallbackControl.appliedLeverage !== paperFallbackControl.modelSuggestedLeverage ||
    paperFallbackControl.appliedLeverage <= 1 ||
    paperFallbackControl.maxLeverage !== null ||
    paperFallbackControl.leverageRuleExact ||
    paperFallbackControl.leverageRuleSource !== "paper-model-account-cap-unverified-bracket" ||
    !missingRulePaperControl.allowed ||
    !missingRulePaperControl.paperRuleFallback ||
    missingRulePaperControl.appliedLeverage !== missingRulePaperControl.modelSuggestedLeverage ||
    !Number.isInteger(missingRulePaperControl.appliedLeverage) ||
    missingRulePaperControl.maxLeverage !== null ||
    missingRulePaperControl.exchangeRule !== null ||
    missingRulePaperControl.leverageRuleSource !== "paper-integer-account-cap-no-exchange-rules" ||
    zeroRiskPaperControl.allowed ||
    zeroRiskPaperControl.riskBudgetAvailable ||
    zeroRiskPaperControl.blockReason !== "风险预算为 0，不开仓。" ||
    zeroRiskPaperControl.notional !== 0 ||
    zeroRiskPaperControl.quantity !== 0 ||
    zeroRiskPaperControl.appliedLeverage !== 0 ||
    !missingRulePosition ||
    !Number.isInteger(missingRulePosition.leverage)
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
        cappedAggressiveApplied: cappedAggressiveControl.appliedLeverage,
        paperFallbackApplied: paperFallbackControl.appliedLeverage,
        missingRulePaperApplied: missingRulePaperControl.appliedLeverage,
        zeroRiskReason: zeroRiskPaperControl.blockReason,
        conservativeMarginCap: conservativeControl.marginConcentrationCapRatio,
        aggressiveMarginCap: aggressiveControl.marginConcentrationCapRatio
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
      quantity: 19.98,
      maxLossAmount: 100,
      exchangeRule: selfTestTradingRule("BTCUSDT")
    }
  };
  const opened = openPaperPosition(account, signal, "2026-07-18T00:00:00.000Z");
  const marketBySymbol = { BTCUSDT: { latest: 100, fundingRate: 0 } };
  markPaperPositions(account, marketBySymbol, "2026-07-18T00:00:10.000Z");
  const availableRatio = account.equity > 0 ? account.availableEquity / account.equity : 0;
  if (
    !opened ||
    !(availableRatio > 0.2) ||
    opened.marginRequired > account.equity * opened.marginConcentrationCapRatio + 1
  ) {
    throw new Error("dynamic margin concentration limit failed");
  }
  const candidatesBySymbol = {
    BTCUSDT: { side: "short", combinedDirection: -1, winRate: 0.86 }
  };
  for (let index = 1; index <= 2; index += 1) {
    const { closed } = closeTriggeredPaperPositions(
      account,
      marketBySymbol,
      candidatesBySymbol,
      index === 1 ? "2026-07-18T00:00:20.000Z" : "2026-07-18T00:00:30.000Z"
    );
    if (closed.length || !account.positions[opened.id]) {
      throw new Error("adaptive exit ignored its confirmation requirement");
    }
  }
  const { closed } = closeTriggeredPaperPositions(
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
  const deRiskAccount = createPaperAccount(config, "2026-07-18T09:00:00.000Z");
  deRiskAccount.isActive = true;
  const deRiskSignal = {
    ...signal,
    id: "EXIT-INTEGRATION-DERISK",
    symbol: "ETHUSDT",
    takeProfit: 101,
    stopLoss: 99,
    winRate: 0.55,
    expectancyPct: 0.02,
    accountControl: {
      ...signal.accountControl,
      notional: 800,
      marginRequired: 400,
      quantity: 8,
      maxLossAmount: 8,
      marginConcentrationCapRatio: 0.45
    }
  };
  const deRiskPosition = openPaperPosition(deRiskAccount, deRiskSignal, "2026-07-18T10:00:00.000Z");
  const deRiskMarket = { ETHUSDT: { latest: 100, fundingRate: 0 } };
  const deRiskCandidates = { ETHUSDT: { side: "long", combinedDirection: 0.35, winRate: 0.55 } };
  let partialEvents = [];
  for (let index = 1; index <= 3; index += 1) {
    const result = closeTriggeredPaperPositions(
      deRiskAccount,
      deRiskMarket,
      deRiskCandidates,
      `2026-07-18T12:00:${String(index * 10).padStart(2, "0")}.000Z`
    );
    partialEvents = result.partialDeRisks;
    if (result.closed.length) throw new Error("quality deterioration should de-risk before a full exit");
  }
  if (
    !deRiskPosition ||
    partialEvents.length !== 1 ||
    partialEvents[0].reason !== "ADAPTIVE_DE_RISK" ||
    Math.abs(deRiskPosition.quantity / deRiskPosition.initialQuantity - 0.5) > 0.002 ||
    deRiskAccount.exitDecisionHistory.length !== 1
  ) {
    throw new Error("adaptive partial de-risk integration self-test failed");
  }

  const protectionAccount = createPaperAccount(config, "2026-07-18T14:00:00.000Z");
  protectionAccount.isActive = true;
  const protectionSignal = {
    ...signal,
    id: "EXIT-INTEGRATION-DYNAMIC-PROTECTION",
    symbol: "SOLUSDT",
    takeProfit: 120,
    stopLoss: 90,
    winRate: 0.64,
    regime: "hmm_bull_trend",
    accountControl: {
      ...signal.accountControl,
      notional: 1_000,
      marginRequired: 500,
      quantity: 10,
      maxLossAmount: 100,
      exchangeRule: selfTestTradingRule("SOLUSDT")
    }
  };
  const protectedPosition = openPaperPosition(
    protectionAccount,
    protectionSignal,
    "2026-07-18T14:00:00.000Z"
  );
  const protectionCandidates = {
    SOLUSDT: { side: "long", combinedDirection: 0.65, winRate: 0.64 }
  };
  const takeProfitResult = closeTriggeredPaperPositions(
    protectionAccount,
    { SOLUSDT: { latest: 120, fundingRate: 0 } },
    protectionCandidates,
    "2026-07-18T14:01:00.000Z"
  );
  const secondTakeProfitResult = closeTriggeredPaperPositions(
    protectionAccount,
    { SOLUSDT: { latest: 120, fundingRate: 0 } },
    protectionCandidates,
    "2026-07-18T14:01:01.000Z"
  );
  if (
    !protectedPosition ||
    takeProfitResult.partialTakeProfits.length !== 1 ||
    secondTakeProfitResult.partialTakeProfits.length !== 0 ||
    protectedPosition.dynamicTakeProfitPartialCount !== 1 ||
    protectedPosition.dynamicProtection.tpPartialExecuted !== true ||
    !(protectedPosition.stopLoss > protectedPosition.originalStopLoss) ||
    !(protectedPosition.takeProfit > protectedPosition.originalTakeProfit) ||
    safeNumber(protectedPosition.exitEvaluation?.signals?.profitProtection) <= 0
  ) {
    throw new Error("dynamic protection partial-take-profit integration self-test failed");
  }
  const failedPartialAccount = createPaperAccount(config, "2026-07-18T15:00:00.000Z");
  failedPartialAccount.isActive = true;
  const failedPartialPosition = openPaperPosition(
    failedPartialAccount,
    { ...protectionSignal, id: "EXIT-INTEGRATION-DYNAMIC-PARTIAL-FAILURE" },
    "2026-07-18T15:00:00.000Z"
  );
  failedPartialPosition.exchangeRule = {
    ...failedPartialPosition.exchangeRule,
    minNotional: 1_000_000
  };
  const failedPartialResult = closeTriggeredPaperPositions(
    failedPartialAccount,
    { SOLUSDT: { latest: 120, fundingRate: 0 } },
    protectionCandidates,
    "2026-07-18T15:01:00.000Z"
  );
  if (
    failedPartialResult.partialTakeProfits.length !== 0 ||
    failedPartialPosition.takeProfit !== failedPartialPosition.originalTakeProfit ||
    failedPartialPosition.dynamicProtection.tpPartialExecuted
  ) {
    throw new Error("failed dynamic partial take-profit changed the target state");
  }
  console.log(
    JSON.stringify({
      passed: true,
      availableEquityRatio: availableRatio,
      confirmationRuns: 3,
      deRiskFraction: partialEvents[0].fraction,
      dynamicTakeProfitFraction: takeProfitResult.partialTakeProfits[0].fraction,
      closeReason: closed[0].closeReason,
      lifetimeClosedTrades: account.lifetimeClosedTrades
    })
  );
}

function runCapitalRotationIntegrationSelfTest() {
  const config = normalizeAccountConfig({
    initialCapital: 1000,
    marketType: "futures",
    maxLeverage: 2,
    riskProfile: "aggressive",
    takerFeeRate: 0.0005,
    slippageRate: 0.0003
  });
  const oldSignal = {
    id: "ROTATION-OLD",
    status: "passed",
    symbol: "OLDUSDT",
    side: "long",
    candidateMode: "math_only",
    entry: 100,
    takeProfit: 110,
    stopLoss: 90,
    winRate: 0.58,
    adaptiveWinRateThreshold: 0.55,
    expectancyPct: 0.002,
    expectancyR: 0.1,
    eventImpactScore: 0,
    relatedEvents: [],
    regime: "hmm_range",
    factorSnapshot: { regime: "hmm_range", marketInputs: { atrPct: 0.01 } },
    accountControl: {
      allowed: true,
      appliedLeverage: 2,
      modelSuggestedLeverage: 2,
      leverageCapped: false,
      notional: 1600,
      marginRequired: 800,
      quantity: 16,
      maxLossAmount: 160,
      exchangeRule: selfTestTradingRule("OLDUSDT")
    }
  };
  const newSignal = {
    ...oldSignal,
    id: "ROTATION-NEW",
    symbol: "NEWUSDT",
    winRate: 0.68,
    adaptiveWinRateThreshold: 0.6,
    expectancyPct: 0.012,
    expectancyR: 0.6,
    accountControl: {
      ...oldSignal.accountControl,
      notional: 1000,
      marginRequired: 500,
      quantity: 10,
      exchangeRule: selfTestTradingRule("NEWUSDT"),
      maxLossAmount: 100
    }
  };
  const exitEvaluation = {
    version: 2,
    evaluatedAt: "2026-07-19T12:00:00.000Z",
    signals: { signalReversal: 0.2, netExpectancyDecay: 0.8, eventDecay: 0, timeDecay: 0.2 },
    weights: DEFAULT_EXIT_MODEL_WEIGHTS,
    exitScore: 0.35,
    threshold: 0.64,
    counterfactualHorizonHours: 1,
    diagnostics: { remainingExpectancyPct: -0.01 }
  };

  const accountingAccount = createPaperAccount(config, "2026-07-19T09:00:00.000Z");
  accountingAccount.isActive = true;
  const accountingPosition = openPaperPosition(accountingAccount, oldSignal, "2026-07-19T09:00:00.000Z");
  accountingPosition.exitEvaluation = exitEvaluation;
  attachCapitalRotationExitEvaluation(
    accountingPosition,
    { advantagePct: 0.022, replacementSymbol: newSignal.symbol },
    { requiredAdvantagePct: 0.0032 },
    "2026-07-19T12:00:00.000Z"
  );
  const initialQuantity = accountingPosition.quantity;
  const partial = partiallyClosePaperPosition(
    accountingAccount,
    accountingPosition.id,
    100,
    0.25,
    newSignal,
    "2026-07-19T12:00:00.000Z"
  );
  const closed = closePaperPosition(
    accountingAccount,
    accountingPosition.id,
    100,
    "ADAPTIVE_EXIT",
    "2026-07-19T12:01:00.000Z"
  );
  settleExitCounterfactuals(
    accountingAccount,
    { OLDUSDT: { latest: 101 }, NEWUSDT: { latest: 103 } },
    "2026-07-19T13:02:00.000Z"
  );
  const rotationCounterfactual = accountingAccount.exitDecisionHistory[0]?.exitCounterfactual;
  if (
    !partial ||
    !closed ||
    Math.abs(closed.quantity - initialQuantity) > 1e-9 ||
    Math.abs(closed.realizedPnl - accountingAccount.realizedPnl) > 1e-9 ||
    Math.abs(closed.entryFee + closed.exitFee - accountingAccount.tradingFees) > 1e-9 ||
    Math.abs(
      closed.entrySlippageCost + closed.exitSlippageCost - accountingAccount.slippageCost
    ) > 1e-9 ||
    accountingAccount.exitDecisionHistory.length !== 1 ||
    safeNumber(accountingAccount.exitDecisionHistory[0]?.exitFactorSnapshot?.signals?.capitalEfficiency) !== 1 ||
    rotationCounterfactual?.status !== "evaluated" ||
    rotationCounterfactual?.beneficial !== true ||
    !(rotationCounterfactual?.counterfactualReturnPct > 0) ||
    !(rotationCounterfactual?.relativeAdvantagePct > 0) ||
    accountingAccount.lifetimeClosedTrades !== 1
  ) {
    throw new Error("capital rotation partial-close accounting self-test failed");
  }

  const executionAccount = createPaperAccount(config, "2026-07-19T09:00:00.000Z");
  executionAccount.isActive = true;
  const existing = openPaperPosition(executionAccount, oldSignal, "2026-07-19T09:00:00.000Z");
  const marketBySymbol = {
    OLDUSDT: { latest: 100, fundingRate: 0 },
    NEWUSDT: { latest: 100, fundingRate: 0 }
  };
  markPaperPositions(executionAccount, marketBySymbol, "2026-07-19T12:00:00.000Z");
  existing.exitEvaluation = exitEvaluation;
  const rotation = executeCapitalRotation(
    executionAccount,
    newSignal,
    marketBySymbol,
    "2026-07-19T12:00:00.000Z"
  );
  const replacement = openPaperPosition(executionAccount, newSignal, "2026-07-19T12:00:00.000Z");
  if (!rotation.executed || rotation.partial.length !== 1 || !replacement || replacement.scaledByAvailableEquity) {
    throw new Error(
      `capital rotation execution self-test failed: ${JSON.stringify({ rotation, replacement })}`
    );
  }
  console.log(JSON.stringify({ passed: true, partialAccounting: true, replacementOpenedAtFullSize: true }));
}

const execution = process.argv.includes("--service")
  ? runService()
  : process.argv.includes("--self-test-isolation-probe")
    ? Promise.reject(new Error("intentional self-test isolation probe"))
  : process.argv.includes("--self-test-entry-pause")
    ? Promise.resolve().then(runPaperEntryPauseSelfTest)
  : process.argv.includes("--self-test-signal-lifecycle")
    ? Promise.resolve().then(runSignalLifecycleSelfTest)
  : process.argv.includes("--self-test-costs")
    ? Promise.resolve().then(runCostModelSelfTest)
  : process.argv.includes("--self-test-models")
    ? Promise.resolve().then(runAdvancedModelsSelfTest)
    : process.argv.includes("--self-test-profiles")
      ? Promise.resolve().then(runRiskProfileSelfTest)
      : process.argv.includes("--self-test-exit-integration")
        ? Promise.resolve().then(runAdaptiveExitIntegrationSelfTest)
        : process.argv.includes("--self-test-rotation-integration")
          ? Promise.resolve().then(runCapitalRotationIntegrationSelfTest)
      : run();

execution.catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!isSelfTestInvocation) {
    ensureRuntimeDir();
    const report = {
      version: MONITOR_VERSION,
      generatedAt: new Date().toISOString(),
      mode: "paper-alert-only",
      layer: RUN_LAYER,
      fatal: message,
      warnings: ["本轮运行发生致命错误：不要使用本轮信号。"]
    };
    writeJson(LAYER_REPORT_PATH, report);
    if (LAYER_REPORT_PATH !== REPORT_PATH) {
      writeJson(REPORT_PATH, report);
    }
  }
  console.error(`${isSelfTestInvocation ? "Self-test" : "Event signal monitor"} failed: ${message}`);
  process.exitCode = 1;
});

