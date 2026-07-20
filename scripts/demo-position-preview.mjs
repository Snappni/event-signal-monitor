#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(
  process.env.SIGNAL_RUNTIME_DIR || path.join(ROOT_DIR, ".runtime", "event-signal-monitor")
);
const PREVIEW_PATH = path.join(RUNTIME_DIR, "demo-position-preview.json");
const PID_PATH = path.join(RUNTIME_DIR, "demo-position-preview.pid");
const LOG_PATH = path.join(RUNTIME_DIR, "demo-position-preview.log");
const durationSeconds = Math.max(20, Number(process.argv[2] || 300));
const intervalSeconds = Math.max(2, Number(process.argv[3] || 10));
const durationMs = durationSeconds * 1000;
const intervalMs = intervalSeconds * 1000;
const startedMs = Date.now();
const startedAt = new Date(startedMs).toISOString();
const expiresAt = new Date(startedMs + durationMs).toISOString();
const entry = 100;
const originalStopLoss = 96;
const originalTakeProfit = 108;
const initialRiskPrice = entry - originalStopLoss;
const quantity = 10;
const leverage = 5;
const initialNotional = entry * quantity;
const marginRequired = initialNotional / leverage;
const feeRate = 0.0005;
const slippageRate = 0.0003;
const observations = [];
const adjustments = [];
let maximumR = 0;
let minimumR = 0;
let stopLoss = originalStopLoss;
let takeProfit = originalTakeProfit;
let stopping = false;

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquirePid() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (fs.existsSync(PID_PATH)) {
    const existingPid = Number(fs.readFileSync(PID_PATH, "utf8").trim());
    if (processIsRunning(existingPid)) {
      throw new Error(`demo position preview already running pid=${existingPid}`);
    }
    fs.rmSync(PID_PATH, { force: true });
  }
  fs.writeFileSync(PID_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function appendLog(message) {
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function priceAtStep(step) {
  if (step === 0) return entry;
  const trend = Math.min(step, 18) * 0.24;
  const wave = Math.sin(step * 0.82 - 1.15) * 2.15;
  const latePullback = step > 21 ? (step - 21) * 0.22 : 0;
  return Number((entry + trend + wave - latePullback).toFixed(4));
}

function protectionFor(price, now) {
  const priceR = (price - entry) / initialRiskPrice;
  maximumR = Math.max(maximumR, priceR);
  minimumR = Math.min(minimumR, priceR);
  const previousStopLoss = stopLoss;
  const previousTakeProfit = takeProfit;
  let stage = "inactive";
  if (maximumR >= 0.5) {
    stage = "tightening";
    stopLoss = Math.max(stopLoss, entry - initialRiskPrice * 0.75);
  }
  if (maximumR >= 0.9) {
    stage = "trailing";
    stopLoss = Math.max(stopLoss, entry + initialRiskPrice * Math.max(0, maximumR - 0.7));
  }
  if (maximumR >= 1.35) {
    stage = "runner";
    takeProfit = Math.max(takeProfit, originalTakeProfit + initialRiskPrice * Math.min(0.75, maximumR - 1.35));
  }
  stopLoss = Number(stopLoss.toFixed(4));
  takeProfit = Number(takeProfit.toFixed(4));
  const changed = stopLoss !== previousStopLoss || takeProfit !== previousTakeProfit;
  const profitProtection = clamp((stopLoss - originalStopLoss) / initialRiskPrice, 0, 2);
  if (changed) {
    adjustments.push({
      time: now,
      price,
      priceR,
      mfeR: maximumR,
      stage,
      previousStopLoss,
      stopLoss,
      previousTakeProfit,
      takeProfit,
      profitProtection
    });
  }
  return { priceR, stage, profitProtection };
}

function previewAtStep(step) {
  const now = new Date().toISOString();
  const currentPrice = priceAtStep(step);
  const protection = protectionFor(currentPrice, now);
  const grossUnrealizedPnl = (currentPrice - entry) * quantity;
  const estimatedExitFee = currentPrice * quantity * feeRate;
  const estimatedExitSlippageCost = currentPrice * quantity * slippageRate;
  const entryFee = initialNotional * feeRate;
  const netPnl = grossUnrealizedPnl - entryFee - estimatedExitFee;
  const winRate = clamp(0.64 + protection.priceR * 0.035, 0.52, 0.82);
  observations.push({ time: now, price: currentPrice });
  const position = {
    id: "demo-ui-preview-position",
    symbol: "DEMOUSDT",
    side: "long",
    openedAt: startedAt,
    candidateMode: "5-minute-ui-preview",
    riskProfile: "aggressive",
    leverage,
    modelSuggestedLeverage: leverage,
    leverageRuleExact: false,
    leverageRuleSource: "demo-preview-only",
    exchangeRule: null,
    exchangeRuleValidated: false,
    currentPrice,
    entry,
    signalEntryPrice: entry,
    takeProfit,
    stopLoss,
    originalTakeProfit,
    originalStopLoss,
    initialMaxLossAmount: initialRiskPrice * quantity,
    winRate,
    expectancyPct: 0.004 + protection.priceR * 0.0015,
    eventImpactScore: 72,
    unrealizedPnl: grossUnrealizedPnl - estimatedExitFee,
    netPnl,
    unrealizedReturnPct: netPnl / marginRequired,
    quantity,
    notional: initialNotional,
    marginRequired,
    entryFee,
    estimatedExitFee,
    estimatedExitSlippageCost,
    fundingPnl: 0,
    fundingSettlements: 0,
    marginConcentrationCapRatio: 0.3,
    marginConcentrationCapped: false,
    dynamicTakeProfitPartialCount: maximumR >= 1.35 ? 1 : 0,
    holdingObservations: observations.slice(-60),
    dynamicProtection: {
      version: 1,
      initializedAt: startedAt,
      originalStopLoss,
      originalTakeProfit,
      initialRiskPrice,
      originalTargetR: 2,
      activationR: 0.5,
      breakEvenR: 0.9,
      givebackR: 0.75,
      regime: "trend",
      priceR: protection.priceR,
      mfeR: maximumR,
      maeR: minimumR,
      stage: protection.stage,
      profitProtection: protection.profitProtection,
      lastAdjustedAt: adjustments.at(-1)?.time || null,
      adjustmentHistory: adjustments.slice(-60)
    },
    exitEvaluation: {
      exitScore: clamp(0.28 - protection.profitProtection * 0.04, 0.08, 0.28),
      threshold: 0.62,
      confirmationRunsRequired: 3,
      deRiskConfirmationRunsRequired: 3,
      maxHoldingHours: 6,
      recommendsDeRisk: false,
      deRiskFraction: 0,
      signals: {
        signalReversal: 0.08,
        netExpectancyDecay: 0.1,
        eventDecay: 0.05,
        timeDecay: Math.min(0.2, step / 150),
        profitProtection: protection.profitProtection
      },
      diagnostics: { qualityRetention: 0.86 }
    },
    exitConfirmationCount: 0,
    deRiskConfirmationCount: 0,
    adaptiveDeRiskCount: 0,
    relatedEvents: [{ title: "5 分钟界面演示数据；不参与交易、复盘或模型迭代" }]
  };
  return { version: 1, startedAt, updatedAt: now, expiresAt, step, intervalSeconds, position };
}

function cleanup(reason) {
  if (stopping) return;
  stopping = true;
  fs.rmSync(PREVIEW_PATH, { force: true });
  try {
    if (Number(fs.readFileSync(PID_PATH, "utf8").trim()) === process.pid) fs.rmSync(PID_PATH, { force: true });
  } catch {
    // The process may already have been cleaned up.
  }
  appendLog(`preview stopped reason=${reason}`);
}

acquirePid();
process.once("SIGINT", () => cleanup("SIGINT"));
process.once("SIGTERM", () => cleanup("SIGTERM"));
process.once("exit", () => {
  if (!stopping) cleanup("process-exit");
});
appendLog(`preview started durationSeconds=${durationSeconds} intervalSeconds=${intervalSeconds}`);

let step = 0;
while (!stopping && Date.now() < startedMs + durationMs) {
  const preview = previewAtStep(step);
  writeJsonAtomic(PREVIEW_PATH, preview);
  appendLog(
    `step=${step} price=${preview.position.currentPrice} stop=${preview.position.stopLoss} target=${preview.position.takeProfit} netPnl=${preview.position.netPnl.toFixed(2)}`
  );
  step += 1;
  const nextAt = Math.min(startedMs + durationMs, startedMs + step * intervalMs);
  const waitMs = Math.max(0, nextAt - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}
cleanup("completed");
console.log(JSON.stringify({ completed: true, updates: step, durationSeconds, intervalSeconds }));
