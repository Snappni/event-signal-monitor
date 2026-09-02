import fs from "node:fs";
import assert from "node:assert/strict";
import {
  buildRealizedEvModel,
  compareShallowBoosting,
  createDecisionLearningState,
  evaluateExitShadowMatrix,
  evaluateRealizedEv,
  normalizeDecisionEvent,
  recordCandidateCycle,
  recordServiceInterruption,
  replayPortfolio,
  trainElasticNetProbability
} from "./decision-learning.mjs";
import { modelFactorGovernance, normalizeFactorLibraryConfig } from "./factor-library.mjs";

const startedAt = "2026-01-01T00:00:00.000Z";
const event = normalizeDecisionEvent({ title: "BTC ETF flow changed", source: "fixture", occurredAt: startedAt }, startedAt);
for (const field of ["event_id", "occurred_at", "fetched_at", "normalized_hash", "source", "language", "cluster_id"]) {
  assert.ok(Object.hasOwn(event, field), `missing event field ${field}`);
}

let state = recordServiceInterruption(createDecisionLearningState(), "2026-01-01T00:10:00.000Z", "2026-01-01T00:20:00.000Z");
const candidate = { id: "fixture-candidate", symbol: "BTCUSDT", side: "long", mode: "event_math", regime: "bull", rawCombinedDirection: 1.2, riskPct: 0.01, features: { event_score: 0.7, math_score: 0.5, missing_source: null } };
let cycle = recordCandidateCycle(state, { candidates: [candidate], acceptedIds: [candidate.id], prices: { BTCUSDT: { latest: 100 } }, events: [event], observedAt: startedAt });
assert.equal(cycle.audits[0].decision, "accepted");
assert.equal(cycle.audits[0].reason_code, "accepted");
assert.equal(cycle.audits[0].raw_entry_score, 1.2);
assert.equal(cycle.audits[0].raw_exit_score, null);
assert.equal(cycle.audits[0].feature_missing_mask.missing_source, true);
state = cycle.state;
for (const [at, price] of [["2026-01-01T00:05:00.000Z", 100.2], ["2026-01-01T00:15:00.000Z", 100.5], ["2026-01-01T01:00:00.000Z", 101], ["2026-01-01T04:00:00.000Z", 102]]) {
  cycle = recordCandidateCycle(state, { prices: { BTCUSDT: { latest: price } }, observedAt: at });
  state = cycle.state;
}
assert.equal(cycle.matured.length, 1);
for (const horizon of ["5m", "15m", "60m", "240m"]) {
  assert.ok(cycle.matured[0].labels[horizon]);
  assert.ok(Date.parse(cycle.matured[0].labels[horizon].label_at) > Date.parse(cycle.matured[0].observed_at));
}
assert.equal(cycle.matured[0].labels["5m"].trainable, true);
assert.equal(cycle.matured[0].labels["15m"].trainable, false);
assert.equal(cycle.matured[0].triple_barrier.trainable, false);

const positiveTrades = Array.from({ length: 500 }, (_, index) => ({
  id: `p${index}`,
  candidateMode: "event_math",
  regime: "bull",
  side: "long",
  realizedPnl: index % 2 ? 11 : 9,
  initialNotional: 1_000
}));
const negativeTrades = positiveTrades.map((trade) => ({ ...trade, id: `n${trade.id}`, realizedPnl: -10 }));
assert.equal(evaluateRealizedEv(buildRealizedEvModel(positiveTrades), { mode: "event_math", regime: "bull", side: "long" }).passed, true);
assert.equal(evaluateRealizedEv(buildRealizedEvModel(negativeTrades), { mode: "event_math", regime: "bull", side: "long" }).reason_code, "ev_lower_bound_non_positive");
const labeledEv = buildRealizedEvModel(Array.from({ length: 500 }, (_, index) => ({
  mode: "math_only",
  regime: "range",
  side: "long",
  cost_pct: 0.001,
  labels: { "60m": { trainable: true, directional_return: index % 2 ? 0.011 : 0.009 } }
})));
assert.ok(Math.abs(labeledEv.buckets["math_only|range|long"].mean_net_ev - 0.009) < 1e-12);

const labels = [];
for (let index = 0; index < 1_200; index += 1) {
  const direction = ((index * 37) % 101) / 50 - 1;
  const won = direction + (((index * 17) % 13) - 6) * 0.015 > 0;
  labels.push({
    observed_at: new Date(Date.parse(startedAt) + index * 3_600_000).toISOString(),
    mode: index % 3 ? "math_only" : "event_math",
    regime: direction > 0 ? "bull" : "bear",
    raw_entry_score: direction,
    features: { raw_entry_score: direction, event_score: Math.abs(direction), math_score: direction, volatility: 0.01 + (index % 5) * 0.001 },
    labels: { "60m": { trainable: true, directional_return: won ? 0.01 : -0.01 } }
  });
}
const probabilityModel = trainElasticNetProbability(labels);
assert.equal(probabilityModel.qualified, true);
assert.ok(probabilityModel.locked_test.auc > 0.52);
assert.ok(probabilityModel.locked_test.brier < probabilityModel.locked_test.constant_brier);
assert.ok(probabilityModel.locked_test.ece < 0.05);
assert.equal(compareShallowBoosting({ qualified: false }, labels).reason_code, "baseline_not_qualified");
assert.equal(compareShallowBoosting(probabilityModel, labels).attempted, true);

const shadow = evaluateExitShadowMatrix({ observed_at: startedAt, entry_price: 100, risk_pct: 0.01, side: "long", price_path: [{ at: startedAt, price: 100 }, { at: "2026-01-01T00:05:00.000Z", price: 100.6 }, { at: "2026-01-01T00:10:00.000Z", price: 101.2 }, { at: "2026-01-01T00:15:00.000Z", price: 100.1 }] });
assert.deepEqual(shadow.map((item) => item.exit_policy), ["vertical_hold", "breakeven_0_5r", "atr_trailing_1r"]);
assert.ok(shadow.every((item) => item.entry_model === "elastic_net_logistic"));

const replay = replayPortfolio([
  { id: "a", openedAt: startedAt, closedAt: "2026-01-01T01:00:00Z", cluster_id: "c1", side: "long", entry: 100, exitPrice: 102, feesPct: 0.001, slippagePct: 0.001, fundingPct: 0.001 },
  { id: "b", openedAt: "2026-01-01T00:05:00Z", closedAt: "2026-01-01T01:05:00Z", cluster_id: "c1", side: "long", entry: 100, exitPrice: 103 }
], { maxConcurrent: 2, maxClusterExposure: 1, interruptions: [{ started_at: "2026-01-01T00:30:00Z", ended_at: "2026-01-01T00:40:00Z" }] });
assert.ok(Math.abs(replay.results[0].net_return_after_costs - 0.017) < 1e-12);
assert.equal(replay.results[0].trainable, false);
assert.equal(replay.results[1].reason_code, "cluster_exposure_limit");

const factorConfig = normalizeFactorLibraryConfig({ factorSettings: { hmm_regime_signal: { enabled: true, useInDecision: true } } });
assert.equal(modelFactorGovernance(factorConfig).hiddenMarkov.useInDecision, false);
const explicitlyReenabledHmm = normalizeFactorLibraryConfig({ version: 8, factorSettings: { hmm_regime_signal: { enabled: true, useInDecision: true } } });
assert.equal(modelFactorGovernance(explicitlyReenabledHmm).hiddenMarkov.useInDecision, true);
assert.deepEqual(factorConfig.horizonsMinutes, [5, 15, 60, 240]);
assert.ok(factorConfig.adjustmentIntervalMinutes >= 1440);
const monitorSource = fs.readFileSync(new URL("./event-signal-monitor.mjs", import.meta.url), "utf8");
assert.match(monitorSource, /VOLUME_DIRECTION_ENABLED = process\.env\.SIGNAL_VOLUME_DIRECTION_ENABLED === "1"/);

console.log(JSON.stringify({
  passed: true,
  candidateAudit: cycle.audits.length + 1,
  fixedLabels: Object.keys(cycle.matured[0].labels),
  interruptedLabelsExcluded: true,
  realizedEvGate: true,
  probabilityModel: probabilityModel.locked_test,
  exitPolicies: shadow.map((item) => item.exit_policy),
  portfolioReplay: { accepted: replay.accepted, rejected: replay.rejected },
  hmmDirectionEnabled: false,
  volumeDirectionEnabled: false
}));
