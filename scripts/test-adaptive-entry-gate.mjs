import assert from "node:assert/strict";
import { evaluateAdaptiveEntryGate } from "./adaptive-entry-gate.mjs";

const shared = {
  expectancyPct: 0.003,
  riskPct: 0.02,
  rewardRiskRatio: 1.5,
  roundTripExecutionCostPct: 0.0016,
  winRate: 0.58
};

const stableTrend = evaluateAdaptiveEntryGate({
  ...shared,
  riskProfile: "aggressive",
  regime: "trend",
  volatilityExpansion: 1,
  alignment: 1,
  candidateMode: "event_impact",
  combinedDirection: 0.75,
  calibration: { samples: 200, wins: 116, avgPredictedWinRate: 0.58 }
});

const unstableTransition = evaluateAdaptiveEntryGate({
  ...shared,
  riskProfile: "conservative",
  regime: "transition",
  volatilityExpansion: 2,
  alignment: -0.35,
  candidateMode: "math_only",
  combinedDirection: 0.3,
  calibration: { samples: 0, wins: 0, avgPredictedWinRate: 0 }
});

assert.equal(stableTrend.passesGate, true);
assert.equal(unstableTransition.passesGate, false);
assert.ok(unstableTransition.adaptiveWinRateThreshold > stableTrend.adaptiveWinRateThreshold);

const lowReward = evaluateAdaptiveEntryGate({ ...shared, rewardRiskRatio: 1.1 });
const highReward = evaluateAdaptiveEntryGate({ ...shared, rewardRiskRatio: 2.2 });
assert.ok(highReward.breakEvenWinRate < lowReward.breakEvenWinRate);
assert.ok(highReward.adaptiveWinRateThreshold < lowReward.adaptiveWinRateThreshold);

const calibrated = evaluateAdaptiveEntryGate({
  ...shared,
  calibration: { samples: 120, wins: 70, avgPredictedWinRate: 0.58 }
});
const uncalibrated = evaluateAdaptiveEntryGate({ ...shared, calibration: { samples: 0 } });
assert.ok(calibrated.components.sampleUncertaintyMargin < uncalibrated.components.sampleUncertaintyMargin);

const calibrationMismatch = evaluateAdaptiveEntryGate({
  ...shared,
  calibration: { samples: 100, wins: 42, avgPredictedWinRate: 0.65 }
});
assert.ok(calibrationMismatch.components.calibrationErrorMargin > 0);

const negativeEv = evaluateAdaptiveEntryGate({
  ...shared,
  expectancyPct: -0.001,
  winRate: 0.9
});
assert.equal(negativeEv.passesGate, false);

console.log("adaptive entry gate tests passed");
