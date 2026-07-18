import assert from "node:assert/strict";
import {
  DEFAULT_EXIT_MODEL_WEIGHTS,
  evaluateAdaptivePositionExit,
  normalizeExitWeights
} from "./adaptive-position-exit.mjs";

const now = "2026-07-18T12:00:00.000Z";
const position = {
  side: "long",
  openedAt: "2026-07-18T06:00:00.000Z",
  exitPolicyStartedAt: "2026-07-18T06:00:00.000Z",
  entry: 100,
  currentPrice: 100,
  takeProfit: 103,
  stopLoss: 98,
  feeRate: 0.0005,
  slippageRate: 0.0003,
  candidateMode: "event_math",
  regime: "range",
  riskPct: 0.02,
  factorSnapshot: { marketInputs: { atrPct: 0.01 } },
  relatedEvents: [{ source: "news", occurredAt: "2026-07-17T12:00:00.000Z" }]
};

const normalized = normalizeExitWeights({ signalReversal: 10 }, DEFAULT_EXIT_MODEL_WEIGHTS);
assert.ok(Math.abs(Object.values(normalized).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);

const supported = evaluateAdaptivePositionExit({
  position,
  market: { latest: 100, fundingRate: 0 },
  candidate: { side: "long", combinedDirection: 0.7, winRate: 0.7 },
  now,
  weights: DEFAULT_EXIT_MODEL_WEIGHTS
});
assert.equal(supported.signals.signalReversal, 0);
assert.equal(supported.signals.netExpectancyDecay, 0);
assert.equal(supported.hardExpired, false);

const reversed = evaluateAdaptivePositionExit({
  position,
  market: { latest: 100, fundingRate: 0.001 },
  candidate: { side: "short", combinedDirection: -0.9, winRate: 0.8 },
  now,
  weights: DEFAULT_EXIT_MODEL_WEIGHTS
});
assert.ok(reversed.signals.signalReversal >= 0.89);
assert.ok(reversed.signals.netExpectancyDecay > 0);
assert.ok(reversed.exitScore > supported.exitScore);

const legacy = evaluateAdaptivePositionExit({
  position: { ...position, openedAt: "2026-07-01T00:00:00.000Z", exitPolicyStartedAt: now },
  market: { latest: 100 },
  candidate: null,
  now,
  weights: DEFAULT_EXIT_MODEL_WEIGHTS
});
assert.equal(legacy.signals.timeDecay, 0, "legacy positions start time decay when the policy is activated");
assert.equal(legacy.hardExpired, false);

const expired = evaluateAdaptivePositionExit({
  position: { ...position, exitPolicyStartedAt: "2026-07-17T00:00:00.000Z" },
  market: { latest: 100 },
  candidate: null,
  now,
  weights: DEFAULT_EXIT_MODEL_WEIGHTS
});
assert.equal(expired.hardExpired, true);
assert.equal(expired.recommendsExit, true);

console.log("adaptive position exit tests passed");
