import { alignToStep } from "./binance-trading-rules.mjs";

export const DYNAMIC_PROTECTION_POLICY = Object.freeze({
  minimumActivationR: 0.4,
  maximumActivationR: 0.75,
  activationToBreakEvenR: 0.4,
  firstProtectedStopR: -0.75,
  minimumBreakEvenR: 0.8,
  maximumBreakEvenR: 1.1,
  trendGivebackR: 0.75,
  rangeGivebackR: 0.5,
  transitionGivebackR: 0.3,
  takeProfitPartialFraction: 0.5,
  maximumExtensionR: 0.75
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedRegime(value, side) {
  const regime = String(value || "unknown").toLowerCase();
  if (regime.includes("transition")) return "transition";
  if (regime.includes("range")) return "range";
  if (regime.includes("bull")) return side === "short" ? "transition" : "trend";
  if (regime.includes("bear")) return side === "long" ? "transition" : "trend";
  if (regime.includes("trend")) return "trend";
  return "unknown";
}

function directionForSide(side) {
  return side === "short" ? -1 : 1;
}

function activationFor(position, regime) {
  const winRateAdjustment = clamp((safeNumber(position?.winRate, 0.6) - 0.6) * 0.5, -0.08, 0.08);
  const regimeAdjustment = regime === "trend" ? 0.15 : regime === "range" ? -0.05 : regime === "transition" ? -0.1 : 0;
  return clamp(
    0.5 + winRateAdjustment + regimeAdjustment,
    DYNAMIC_PROTECTION_POLICY.minimumActivationR,
    DYNAMIC_PROTECTION_POLICY.maximumActivationR
  );
}

function givebackFor(regime) {
  if (regime === "trend") return DYNAMIC_PROTECTION_POLICY.trendGivebackR;
  if (regime === "range") return DYNAMIC_PROTECTION_POLICY.rangeGivebackR;
  return DYNAMIC_PROTECTION_POLICY.transitionGivebackR;
}

function priceAtR(entry, initialRiskPrice, direction, riskUnits) {
  return entry + direction * initialRiskPrice * riskUnits;
}

function riskUnitsAtPrice(entry, initialRiskPrice, direction, price) {
  return direction * (price - entry) / initialRiskPrice;
}

export function initializeDynamicProtection(position, now = new Date().toISOString()) {
  const side = position?.side === "short" ? "short" : "long";
  const entry = safeNumber(position?.entry);
  const originalStopLoss = safeNumber(position?.originalStopLoss, position?.stopLoss);
  const originalTakeProfit = safeNumber(position?.originalTakeProfit, position?.takeProfit);
  const initialRiskPrice = Math.abs(entry - originalStopLoss);
  if (!(entry > 0) || !(initialRiskPrice > 0) || !(originalTakeProfit > 0)) return null;
  const regime = normalizedRegime(position?.regime || position?.factorSnapshot?.regime, side);
  const activationR = activationFor(position, regime);
  const historicalRScale = entry / initialRiskPrice;
  return {
    version: 1,
    initializedAt: now,
    originalStopLoss,
    originalTakeProfit,
    initialRiskPrice,
    originalTargetR: Math.abs(originalTakeProfit - entry) / initialRiskPrice,
    activationR,
    breakEvenR: clamp(
      activationR + DYNAMIC_PROTECTION_POLICY.activationToBreakEvenR,
      DYNAMIC_PROTECTION_POLICY.minimumBreakEvenR,
      DYNAMIC_PROTECTION_POLICY.maximumBreakEvenR
    ),
    givebackR: givebackFor(regime),
    regime,
    mfeR: Math.max(0, safeNumber(position?.maxFavorableExcursionPct) * historicalRScale),
    maeR: Math.min(0, safeNumber(position?.maxAdverseExcursionPct) * historicalRScale),
    stage: "inactive",
    profitProtection: 0,
    tpPartialExecuted: false,
    tpPartialExecutedAt: null,
    lastAdjustedAt: null,
    adjustmentHistory: []
  };
}

export function evaluateDynamicPositionProtection({
  position,
  currentPrice,
  candidate = null,
  now = new Date().toISOString()
}) {
  const state = position?.dynamicProtection || initializeDynamicProtection(position, now);
  const price = safeNumber(currentPrice, position?.currentPrice);
  if (!state || !(price > 0)) return { valid: false, action: "none", profitProtection: 0 };

  const side = position?.side === "short" ? "short" : "long";
  const direction = directionForSide(side);
  const entry = safeNumber(position?.entry);
  const initialRiskPrice = safeNumber(state.initialRiskPrice);
  const priceR = riskUnitsAtPrice(entry, initialRiskPrice, direction, price);
  const mfeR = Math.max(safeNumber(state.mfeR), priceR, 0);
  const maeR = Math.min(safeNumber(state.maeR), priceR, 0);
  const activationR = safeNumber(state.activationR, activationFor(position, state.regime));
  const breakEvenR = safeNumber(
    state.breakEvenR,
    clamp(
      activationR + DYNAMIC_PROTECTION_POLICY.activationToBreakEvenR,
      DYNAMIC_PROTECTION_POLICY.minimumBreakEvenR,
      DYNAMIC_PROTECTION_POLICY.maximumBreakEvenR
    )
  );
  const givebackR = safeNumber(state.givebackR, givebackFor(state.regime));
  const initialMaxLossAmount = Math.max(
    safeNumber(position?.initialMaxLossAmount),
    safeNumber(position?.maxLossAmount),
    1e-9
  );
  const remainingFraction = safeNumber(position?.initialQuantity) > 0
    ? clamp(safeNumber(position?.quantity) / safeNumber(position?.initialQuantity), 0.0001, 1)
    : 1;
  const remainingRiskAmount = initialMaxLossAmount * remainingFraction;
  const estimatedCosts =
    safeNumber(position?.entryFee) +
    safeNumber(position?.estimatedExitFee) +
    safeNumber(position?.entrySlippageCost) +
    safeNumber(position?.estimatedExitSlippageCost) -
    safeNumber(position?.fundingPnl);
  const costBreakEvenR = clamp(Math.max(0, estimatedCosts) / remainingRiskAmount, 0, 0.3);
  const currentStop = safeNumber(position?.stopLoss, state.originalStopLoss);
  const currentStopR = riskUnitsAtPrice(entry, initialRiskPrice, direction, currentStop);

  let proposedStopR = currentStopR;
  let stage = state.stage || "inactive";
  if (mfeR >= activationR) {
    if (mfeR < breakEvenR) {
      const progress = clamp((mfeR - activationR) / Math.max(0.01, breakEvenR - activationR), 0, 1);
      proposedStopR = DYNAMIC_PROTECTION_POLICY.firstProtectedStopR +
        progress * (costBreakEvenR - DYNAMIC_PROTECTION_POLICY.firstProtectedStopR);
      stage = "tightening";
    } else {
      proposedStopR = Math.max(costBreakEvenR, mfeR - givebackR);
      stage = "trailing";
    }
  }
  const nextStopR = Math.max(currentStopR, proposedStopR);
  const priceAlignment = side === "long" ? "floor" : "ceil";
  const rawNextStopLoss = priceAtR(entry, initialRiskPrice, direction, nextStopR);
  const nextStopLoss = safeNumber(position?.exchangeRule?.tickSize) > 0
    ? alignToStep(rawNextStopLoss, position.exchangeRule.tickSize, priceAlignment)
    : rawNextStopLoss;
  const alignedNextStopR = riskUnitsAtPrice(entry, initialRiskPrice, direction, nextStopLoss);
  const stopMoved = alignedNextStopR > currentStopR + 1e-9;
  const stopTriggered = priceR <= alignedNextStopR + 1e-9;

  const activeProfitRange = Math.max(0, mfeR - activationR);
  const activationProgress = clamp(activeProfitRange / Math.max(0.1, breakEvenR - activationR), 0, 1);
  const givebackPressure = clamp(Math.max(0, mfeR - priceR) / Math.max(0.1, givebackR), 0, 1);
  const profitProtection = mfeR >= activationR
    ? clamp(activationProgress * 0.25 + givebackPressure * 0.75, 0, 1)
    : 0;

  const originalTakeProfit = safeNumber(state.originalTakeProfit, position?.takeProfit);
  const currentTakeProfit = safeNumber(position?.takeProfit, originalTakeProfit);
  const targetHit = direction * (price - currentTakeProfit) >= 0;
  const candidateSameSide = candidate?.side === side;
  const continuationStrong =
    state.regime === "trend" &&
    candidateSameSide &&
    Math.abs(safeNumber(candidate?.combinedDirection)) >= 0.45 &&
    safeNumber(candidate?.winRate, 0.5) >= 0.57;
  let action = "none";
  let closeReason = null;
  let partialFraction = 0;
  let nextTakeProfit = currentTakeProfit;
  if (stopTriggered) {
    action = "close";
    closeReason = alignedNextStopR > -1 + 1e-9 ? "DYNAMIC_SL" : "SL";
    stage = "exit";
  } else if (targetHit && state.tpPartialExecuted) {
    action = "close";
    closeReason = "TP_EXTENSION";
    stage = "exit";
  } else if (targetHit && continuationStrong) {
    const extensionR = safeNumber(state.originalTargetR) + Math.min(
      DYNAMIC_PROTECTION_POLICY.maximumExtensionR,
      safeNumber(state.originalTargetR) * 0.5
    );
    action = "partial_take_profit";
    partialFraction = DYNAMIC_PROTECTION_POLICY.takeProfitPartialFraction;
    const rawNextTakeProfit = priceAtR(entry, initialRiskPrice, direction, extensionR);
    nextTakeProfit = safeNumber(position?.exchangeRule?.tickSize) > 0
      ? alignToStep(rawNextTakeProfit, position.exchangeRule.tickSize, priceAlignment)
      : rawNextTakeProfit;
    stage = "runner";
  } else if (targetHit) {
    action = "close";
    closeReason = "TP";
    stage = "exit";
  }

  return {
    valid: true,
    evaluatedAt: now,
    action,
    closeReason,
    partialFraction,
    nextStopLoss,
    nextStopR: alignedNextStopR,
    stopMoved,
    nextTakeProfit,
    targetMoved: Math.abs(nextTakeProfit - currentTakeProfit) > 1e-9,
    priceR,
    mfeR,
    maeR,
    activationR,
    breakEvenR,
    givebackR,
    costBreakEvenR,
    profitProtection,
    stage,
    diagnostics: {
      continuationStrong,
      candidateSameSide,
      originalTargetR: safeNumber(state.originalTargetR),
      currentStopR,
      currentTakeProfit,
      originalTakeProfit
    }
  };
}
