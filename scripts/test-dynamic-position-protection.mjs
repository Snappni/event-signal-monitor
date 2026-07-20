import assert from "node:assert/strict";
import {
  evaluateDynamicPositionProtection,
  initializeDynamicProtection
} from "./dynamic-position-protection.mjs";

function position(side = "long") {
  const entry = 100;
  return {
    side,
    entry,
    stopLoss: side === "long" ? 90 : 110,
    takeProfit: side === "long" ? 120 : 80,
    originalStopLoss: side === "long" ? 90 : 110,
    originalTakeProfit: side === "long" ? 120 : 80,
    winRate: 0.6,
    regime: "hmm_range",
    initialMaxLossAmount: 100,
    maxLossAmount: 100,
    entryFee: 1,
    estimatedExitFee: 1,
    entrySlippageCost: 0.5,
    estimatedExitSlippageCost: 0.5,
    fundingPnl: 0
  };
}

function applyEvaluation(item, evaluation) {
  item.stopLoss = evaluation.nextStopLoss;
  item.takeProfit = evaluation.nextTakeProfit;
  item.dynamicProtection = {
    ...item.dynamicProtection,
    mfeR: evaluation.mfeR,
    maeR: evaluation.maeR,
    stage: evaluation.stage,
    profitProtection: evaluation.profitProtection
  };
}

for (const side of ["long", "short"]) {
  const item = position(side);
  item.dynamicProtection = initializeDynamicProtection(item, "2026-07-19T00:00:00.000Z");
  const direction = side === "long" ? 1 : -1;
  const prices = [100, 104, 106, 109, 112, 108];
  const stops = [];
  for (const favorableMove of prices.map((price) => 100 + direction * (price - 100))) {
    const evaluation = evaluateDynamicPositionProtection({ position: item, currentPrice: favorableMove });
    stops.push(evaluation.nextStopLoss);
    applyEvaluation(item, evaluation);
  }
  for (let index = 1; index < stops.length; index += 1) {
    assert.ok(
      side === "long" ? stops[index] >= stops[index - 1] : stops[index] <= stops[index - 1],
      `${side} stop must never loosen`
    );
  }
  assert.ok(item.dynamicProtection.mfeR >= 1.2);
  assert.ok(item.dynamicProtection.profitProtection > 0);
}

const trendLong = { ...position("long"), regime: "hmm_bull_trend" };
trendLong.dynamicProtection = initializeDynamicProtection(trendLong);
const partial = evaluateDynamicPositionProtection({
  position: trendLong,
  currentPrice: 120,
  candidate: { side: "long", combinedDirection: 0.62, winRate: 0.64 }
});
assert.equal(partial.action, "partial_take_profit");
assert.equal(partial.partialFraction, 0.5);
assert.ok(partial.nextTakeProfit > trendLong.takeProfit);

trendLong.takeProfit = partial.nextTakeProfit;
trendLong.stopLoss = partial.nextStopLoss;
trendLong.dynamicProtection = {
  ...trendLong.dynamicProtection,
  mfeR: partial.mfeR,
  maeR: partial.maeR,
  tpPartialExecuted: true
};
const extension = evaluateDynamicPositionProtection({
  position: trendLong,
  currentPrice: partial.nextTakeProfit,
  candidate: { side: "long", combinedDirection: 0.7, winRate: 0.66 }
});
assert.equal(extension.action, "close");
assert.equal(extension.closeReason, "TP_EXTENSION");

const weakTrend = { ...position("long"), regime: "hmm_bull_trend" };
weakTrend.dynamicProtection = initializeDynamicProtection(weakTrend);
const fullTakeProfit = evaluateDynamicPositionProtection({
  position: weakTrend,
  currentPrice: 120,
  candidate: { side: "short", combinedDirection: -0.55, winRate: 0.62 }
});
assert.equal(fullTakeProfit.action, "close");
assert.equal(fullTakeProfit.closeReason, "TP");

const migrated = {
  ...position("long"),
  maxFavorableExcursionPct: 0.08,
  maxAdverseExcursionPct: -0.02,
  exchangeRule: { tickSize: "0.1" }
};
migrated.dynamicProtection = initializeDynamicProtection(migrated);
assert.ok(migrated.dynamicProtection.mfeR >= 0.8, "existing MFE must survive policy migration");
const tickAligned = evaluateDynamicPositionProtection({ position: migrated, currentPrice: 109.07 });
assert.ok(Math.abs(tickAligned.nextStopLoss * 10 - Math.round(tickAligned.nextStopLoss * 10)) < 1e-9);

console.log(JSON.stringify({ passed: true, symmetricRatchet: true, singlePartialTakeProfit: true, tickAligned: true }));
