import fs from "node:fs";
import assert from "node:assert/strict";
import {
  buildRealizedEvModel,
  compareShallowBoosting,
  countIndependentBatches,
  createDecisionLearningState,
  effectiveSampleSize,
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
const candidate = { id: "fixture-candidate", symbol: "BTCUSDT", side: "long", mode: "event_math", regime: "bull", rawCombinedDirection: 1.2, riskPct: 0.01, roundTripExecutionCostPct: 0.0016, takerFeeRate: 0.0005, slippageRate: 0.0003, fundingIntervalHours: 8, features: { event_score: 0.7, math_score: 0.5, missing_source: null } };
let cycle = recordCandidateCycle(state, { candidates: [candidate], acceptedIds: [candidate.id], prices: { BTCUSDT: { latest: 100, fundingRate: 0.001 } }, events: [event], observedAt: startedAt });
assert.equal(cycle.audits[0].decision, "accepted");
assert.equal(cycle.audits[0].reason_code, "accepted");
assert.equal(cycle.audits[0].raw_entry_score, 1.2);
assert.equal(cycle.audits[0].raw_exit_score, null);
assert.equal(cycle.audits[0].feature_missing_mask.missing_source, true);
assert.ok(cycle.audits[0].decision_batch_id);
assert.ok(cycle.audits[0].independence_bucket_id);
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
assert.equal(cycle.matured[0].labels["5m"].execution_cost_pct, 0.0016);
assert.ok(Number.isFinite(cycle.matured[0].labels["5m"].net_directional_return));
assert.equal(effectiveSampleSize(10, -0.5), 10);

let fundingState = createDecisionLearningState();
const fundingStart = "2026-01-01T07:59:00.000Z";
let fundingCycle = recordCandidateCycle(fundingState, {
  candidates: [{ ...candidate, id: "funding-candidate", fundingRate: 0.001 }],
  prices: { BTCUSDT: { latest: 100, fundingRate: 0.001 } },
  observedAt: fundingStart
});
fundingState = fundingCycle.state;
for (const [at, price] of [["2026-01-01T08:04:00.000Z", 101], ["2026-01-01T11:59:00.000Z", 102]]) {
  fundingCycle = recordCandidateCycle(fundingState, { prices: { BTCUSDT: { latest: price, fundingRate: 0.001 } }, observedAt: at });
  fundingState = fundingCycle.state;
}
assert.equal(fundingCycle.matured[0].labels["5m"].funding_cost_pct, 0.001);
assert.equal(fundingCycle.matured[0].labels["5m"].funding_settlements.length, 1);
assert.ok(Math.abs(fundingCycle.matured[0].labels["5m"].net_directional_return - 0.0074) < 1e-12);

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
const clusteredEv = buildRealizedEvModel(Array.from({ length: 500 }, (_, index) => ({
  id: `clustered-${index}`,
  observed_at: startedAt,
  mode: "math_only",
  regime: "range",
  side: "long",
  labels: { "60m": { trainable: true, directional_return: 0.01 } }
})));
assert.equal(clusteredEv.buckets["math_only|range|long"].samples, 500);
assert.equal(clusteredEv.buckets["math_only|range|long"].independent_batches, 1);
assert.equal(clusteredEv.buckets["math_only|range|long"].n_eff, 1);
assert.equal(evaluateRealizedEv(clusteredEv, { mode: "math_only", regime: "range", side: "long" }).passed, false);

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
    labels: { "60m": { trainable: true, directional_return: won ? 0.01 : -0.01, label_at: new Date(Date.parse(startedAt) + (index + 1) * 3_600_000).toISOString() } }
  });
}
const probabilityModel = trainElasticNetProbability(labels);
assert.equal(probabilityModel.qualified, true);
assert.equal(probabilityModel.independent_batches, 300);
assert.ok(probabilityModel.n_eff <= probabilityModel.independent_batches);
assert.equal(probabilityModel.split.overlap_count, 0);
assert.ok(probabilityModel.split.purged_batches >= 1);
assert.ok(probabilityModel.locked_test.auc > 0.52);
assert.ok(probabilityModel.locked_test.brier < probabilityModel.locked_test.constant_brier);
assert.ok(probabilityModel.locked_test.ece < 0.05);
assert.equal(compareShallowBoosting({ qualified: false }, labels).reason_code, "baseline_not_qualified");
assert.equal(compareShallowBoosting(probabilityModel, labels).attempted, true);

const repeatedCrossSection = Array.from({ length: 14 * 19 }, (_, index) => ({
  observed_at: new Date(Date.parse(startedAt) + Math.floor(index / 19) * 4 * 3_600_000).toISOString(),
  symbol: `S${index % 19}`,
  labels: { "60m": { trainable: true, directional_return: index % 2 ? 0.01 : -0.01 } }
}));
const repeatedModel = trainElasticNetProbability(repeatedCrossSection);
assert.equal(countIndependentBatches(repeatedCrossSection), 14);
assert.equal(repeatedModel.qualified, false);
assert.equal(repeatedModel.reason_code, "probability_model_insufficient_independent_batches");
assert.equal(repeatedModel.n_eff, 14);
const splitMinuteBatch = [
  ...Array.from({ length: 14 }, (_, index) => ({ id: `early-${index}`, observed_at: "2026-01-01T13:37:51.139Z" })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: `late-${index}`, observed_at: "2026-01-01T13:38:25.766Z" }))
];
assert.equal(countIndependentBatches(splitMinuteBatch), 1);

const shadow = evaluateExitShadowMatrix({ observed_at: startedAt, entry_price: 100, risk_pct: 0.01, side: "long", price_path: [{ at: startedAt, price: 100 }, { at: "2026-01-01T00:05:00.000Z", price: 100.6 }, { at: "2026-01-01T00:10:00.000Z", price: 101.2 }, { at: "2026-01-01T00:15:00.000Z", price: 100.1 }] });
assert.deepEqual(shadow.map((item) => item.exit_policy), ["vertical_hold", "breakeven_0_5r", "atr_trailing_1r"]);
assert.ok(shadow.every((item) => item.entry_model === "elastic_net_logistic"));
assert.ok(shadow.every((item) => Number.isFinite(item.net_exit_r)));

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
assert.match(monitorSource, /const MONITOR_VERSION = "0\.23\.0"/);
assert.match(monitorSource, /VOLUME_DIRECTION_ENABLED = process\.env\.SIGNAL_VOLUME_DIRECTION_ENABLED === "1"/);
assert.match(monitorSource, /max_configured_rate_or_observed_half_spread/);

console.log(JSON.stringify({
  passed: true,
  candidateAudit: cycle.audits.length + 1,
  fixedLabels: Object.keys(cycle.matured[0].labels),
  interruptedLabelsExcluded: true,
  realizedEvGate: true,
  independentBatchPolicy: { repeatedRows: repeatedCrossSection.length, independentBatches: repeatedModel.independent_batches },
  probabilityModel: probabilityModel.locked_test,
  exitPolicies: shadow.map((item) => item.exit_policy),
  portfolioReplay: { accepted: replay.accepted, rejected: replay.rejected },
  hmmDirectionEnabled: false,
  volumeDirectionEnabled: false
}));
