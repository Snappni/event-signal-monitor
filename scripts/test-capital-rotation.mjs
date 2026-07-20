import assert from "node:assert/strict";
import { planCapitalRotation } from "./capital-rotation.mjs";

const now = "2026-07-19T12:00:00.000Z";
const position = (id, marginRequired, remainingExpectancyPct, hours = 2) => ({
  id,
  symbol: `${id}USDT`,
  openedAt: new Date(Date.parse(now) - hours * 3_600_000).toISOString(),
  marginRequired,
  expectancyPct: 0.004,
  exitEvaluation: { diagnostics: { remainingExpectancyPct } }
});
const account = (availableEquity, positions) => ({
  availableEquity,
  equity: 1000,
  configSnapshot: { takerFeeRate: 0.0005, slippageRate: 0.0003 },
  positions: Object.fromEntries(positions.map((item) => [item.id, item]))
});
const signal = {
  symbol: "NEWUSDT",
  winRate: 0.66,
  adaptiveWinRateThreshold: 0.6,
  expectancyPct: 0.01,
  accountControl: { marginRequired: 100, notional: 200 }
};

assert.deepEqual(planCapitalRotation({ account: account(150, []), signal, now }), {
  required: false,
  feasible: true,
  releases: [],
  deficit: 0
});

const partial = planCapitalRotation({
  account: account(50, [position("WEAK", 100, -0.01)]),
  signal,
  now
});
assert.equal(partial.feasible, true);
assert.equal(partial.releases.length, 1);
assert.equal(partial.releases[0].fullClose, false);
assert.ok(partial.releases[0].fraction > 0.5 && partial.releases[0].fraction < 0.52);

const multiple = planCapitalRotation({
  account: account(10, [position("WORST", 40, -0.02), position("WEAK", 60, -0.005)]),
  signal,
  now
});
assert.equal(multiple.feasible, true);
assert.equal(multiple.releases.length, 2);
assert.equal(multiple.releases[0].positionId, "WORST");

const noChurn = planCapitalRotation({
  account: account(10, [position("SIMILAR", 100, 0.008)]),
  signal,
  now
});
assert.equal(noChurn.feasible, false);
assert.equal(noChurn.releases.length, 0);

const tooYoung = planCapitalRotation({
  account: account(10, [position("YOUNG", 100, -0.02, 0.1)]),
  signal,
  now
});
assert.equal(tooYoung.feasible, false);

const weakCandidate = planCapitalRotation({
  account: account(10, [position("WEAK", 100, -0.02)]),
  signal: { ...signal, winRate: 0.605 },
  now
});
assert.equal(weakCandidate.reason, "candidate_evidence_too_weak");

console.log("capital rotation tests passed");
