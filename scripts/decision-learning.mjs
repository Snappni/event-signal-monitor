import { createHash } from "node:crypto";

const HORIZONS_MINUTES = Object.freeze([5, 15, 60, 240]);
const DEFAULT_INDEPENDENCE_MINUTES = 240;
const DATA_POLICY_VERSION = 2;
const Z95_ONE_SIDED = 1.645;
const EPSILON = 1e-12;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function iso(value, fallback = null) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export function lagOneAutocorrelation(values) {
  if (!Array.isArray(values) || values.length < 3) return 0;
  const average = mean(values);
  const denominator = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  if (denominator <= EPSILON) return 0;
  const numerator = values.slice(1).reduce((sum, value, index) => (
    sum + (value - average) * (values[index] - average)
  ), 0);
  return clamp(numerator / denominator, -0.95, 0.95);
}

export function effectiveSampleSize(valuesOrCount, rho1Value) {
  const count = Array.isArray(valuesOrCount) ? valuesOrCount.length : Math.max(0, finite(valuesOrCount));
  const rho1 = Number.isFinite(Number(rho1Value))
    ? clamp(rho1Value, -0.95, 0.95)
    : lagOneAutocorrelation(Array.isArray(valuesOrCount) ? valuesOrCount : []);
  return Math.min(count, Math.max(0, count * (1 - rho1) / Math.max(1 + rho1, 0.05)));
}

function weightedMean(values, weights = []) {
  if (!values.length) return 0;
  const normalizedWeights = values.map((_, index) => Math.max(0, finite(weights[index], 1)));
  const total = normalizedWeights.reduce((sum, value) => sum + value, 0);
  return total > 0
    ? values.reduce((sum, value, index) => sum + value * normalizedWeights[index], 0) / total
    : mean(values);
}

function independenceBucketId(value, minutes = DEFAULT_INDEPENDENCE_MINUTES) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  const widthMs = Math.max(1, finite(minutes, DEFAULT_INDEPENDENCE_MINUTES)) * 60_000;
  return `time_${new Date(Math.floor(timestamp / widthMs) * widthMs).toISOString()}`;
}

export function decisionIndependenceKey(item = {}, index = 0) {
  return String(
    item.independence_bucket_id ||
    independenceBucketId(item.observed_at || item.openedAt) ||
    item.decision_batch_id ||
    item.candidate_id ||
    item.id ||
    `row_${index}`
  );
}

export function countIndependentBatches(items = []) {
  return new Set(items.map((item, index) => decisionIndependenceKey(item, index))).size;
}

export function summarizeNetEv(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  const average = mean(clean);
  const deviation = sampleDeviation(clean);
  const rho1 = lagOneAutocorrelation(clean);
  const nEff = effectiveSampleSize(clean.length, rho1);
  const standardError = nEff > 1 ? deviation / Math.sqrt(nEff) : Number.POSITIVE_INFINITY;
  return {
    samples: clean.length,
    rho1,
    n_eff: nEff,
    mean_net_ev: average,
    standard_error: standardError,
    lower_95: Number.isFinite(standardError) ? average - Z95_ONE_SIDED * standardError : Number.NEGATIVE_INFINITY,
    upper_95: Number.isFinite(standardError) ? average + Z95_ONE_SIDED * standardError : Number.POSITIVE_INFINITY
  };
}

export function normalizeDecisionEvent(event = {}, fetchedAt = new Date().toISOString()) {
  const rawText = String(event.title || event.text || event.summary || event.content || "").trim();
  const normalizedText = rawText.normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
  const source = String(event.source || event.provider || event.sourceName || "unknown").trim() || "unknown";
  const fetched_at = iso(event.fetched_at || event.fetchedAt || event.receivedAt || fetchedAt, new Date().toISOString());
  const occurred_at = iso(event.occurred_at || event.occurredAt || event.publishedAt || event.timestamp, null);
  const normalized_hash = hash(`${source}|${normalizedText}`);
  const language = event.language || (/\p{Script=Han}/u.test(rawText) ? (/\b[a-z]{3,}\b/i.test(rawText) ? "mixed" : "zh") : (/[a-z]/i.test(rawText) ? "en" : "unknown"));
  const cluster_id = String(event.cluster_id || event.clusterId || event.storyId || `evtcluster_${normalized_hash.slice(0, 16)}`);
  return {
    ...event,
    event_id: String(event.event_id || event.eventId || `evt_${hash(`${normalized_hash}|${occurred_at || "unknown"}`).slice(0, 24)}`),
    occurred_at,
    fetched_at,
    normalized_hash,
    source,
    language,
    cluster_id
  };
}

export function buildFeatureMissingMask(features = {}) {
  return Object.fromEntries(Object.entries(features).map(([key, value]) => [key, value === null || value === undefined || !Number.isFinite(Number(value))]));
}

export function createCandidateId(candidate = {}, observedAt = new Date().toISOString(), sequence = 0) {
  const identity = [observedAt, candidate.symbol, candidate.side, candidate.mode, sequence, candidate.eventClusterId || "none"].join("|");
  return `cand_${hash(identity).slice(0, 24)}`;
}

export function createDecisionLearningState(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    version: DATA_POLICY_VERSION,
    pending: Array.isArray(raw.pending) ? raw.pending.slice(-2_000) : [],
    labels: Array.isArray(raw.labels) ? raw.labels.slice(-20_000) : [],
    interruptions: Array.isArray(raw.interruptions) ? raw.interruptions.slice(-2_000) : [],
    seenEventIds: Array.isArray(raw.seenEventIds) ? raw.seenEventIds.slice(-50_000) : [],
    lastIndependentAtBySymbol: raw.lastIndependentAtBySymbol && typeof raw.lastIndependentAtBySymbol === "object" ? raw.lastIndependentAtBySymbol : {},
    probabilityModel: raw.probabilityModel && typeof raw.probabilityModel === "object" ? raw.probabilityModel : null,
    boostingComparison: raw.boostingComparison && typeof raw.boostingComparison === "object" ? raw.boostingComparison : null,
    updatedAt: iso(raw.updatedAt)
  };
}

export function recordServiceInterruption(stateValue, startedAt, endedAt, reason = "service_gap") {
  const state = createDecisionLearningState(stateValue);
  const start = iso(startedAt);
  const end = iso(endedAt);
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return state;
  const interval = { interruption_id: `gap_${hash(`${start}|${end}|${reason}`).slice(0, 20)}`, started_at: start, ended_at: end, reason };
  if (!state.interruptions.some((item) => item.interruption_id === interval.interruption_id)) state.interruptions.push(interval);
  state.interruptions = state.interruptions.slice(-2_000);
  state.updatedAt = new Date().toISOString();
  return state;
}

function overlapsInterruption(startMs, endMs, interruptions) {
  return interruptions.some((item) => {
    const gapStart = Date.parse(item.started_at || "");
    const gapEnd = Date.parse(item.ended_at || "");
    return Number.isFinite(gapStart) && Number.isFinite(gapEnd) && gapStart < endMs && gapEnd > startMs;
  });
}

function marketObservation(prices, symbol, at) {
  const market = prices?.[symbol];
  const price = finite(market?.latest ?? market, NaN);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { at, price, funding_rate: finiteOrNull(market?.fundingRate) };
}

function fundingSettlementSummary(anchor, endMs) {
  const startMs = Date.parse(anchor.observed_at || "");
  const intervalMs = Math.max(1, finite(anchor.funding_interval_hours, 8)) * 3_600_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { funding_cost_pct: 0, funding_pnl_pct: 0, funding_settlements: [] };
  }
  const direction = anchor.side === "short" ? -1 : 1;
  const path = Array.isArray(anchor.price_path) ? anchor.price_path : [];
  const settlements = [];
  for (let timestamp = (Math.floor(startMs / intervalMs) + 1) * intervalMs; timestamp <= endMs; timestamp += intervalMs) {
    const prior = path.filter((item) => Date.parse(item.at) <= timestamp && Number.isFinite(Number(item.funding_rate))).at(-1);
    const following = path.find((item) => Date.parse(item.at) > timestamp && Number.isFinite(Number(item.funding_rate)));
    const rate = finiteOrNull(prior?.funding_rate ?? following?.funding_rate ?? anchor.funding_rate);
    if (rate == null) continue;
    settlements.push({ at: new Date(timestamp).toISOString(), funding_rate: rate });
  }
  const fundingCostPct = direction * settlements.reduce((sum, item) => sum + item.funding_rate, 0);
  return { funding_cost_pct: fundingCostPct, funding_pnl_pct: -fundingCostPct, funding_settlements: settlements };
}

function resolveTripleBarrier(anchor, observations, side, stopR = 1, targetR = 1.5) {
  const direction = side === "short" ? -1 : 1;
  const riskPct = Math.max(finite(anchor.risk_pct, 0.01), 0.0001);
  for (const observation of observations) {
    const returnR = direction * (observation.price / anchor.entry_price - 1) / riskPct;
    if (returnR >= targetR) return { label: 1, barrier: "upper", touched_at: observation.at, return_r: returnR };
    if (returnR <= -stopR) return { label: -1, barrier: "lower", touched_at: observation.at, return_r: returnR };
  }
  const last = observations.at(-1);
  const returnR = last ? direction * (last.price / anchor.entry_price - 1) / riskPct : 0;
  return { label: Math.sign(returnR), barrier: "vertical", touched_at: last?.at || null, return_r: returnR };
}

function maturePendingAnchor(anchor, nowMs, interruptions) {
  const observedMs = Date.parse(anchor.observed_at);
  const labels = { ...(anchor.labels || {}) };
  for (const horizon of HORIZONS_MINUTES) {
    if (labels[`${horizon}m`]) continue;
    const labelMs = observedMs + horizon * 60_000;
    if (nowMs < labelMs) continue;
    const observations = anchor.price_path.filter((item) => Date.parse(item.at) > observedMs && Date.parse(item.at) <= labelMs);
    const last = observations.at(-1);
    if (!last) continue;
    const direction = anchor.side === "short" ? -1 : 1;
    const rawReturn = last.price / anchor.entry_price - 1;
    const funding = fundingSettlementSummary(anchor, labelMs);
    const executionCostPct = Math.max(finite(anchor.execution_cost_pct ?? anchor.cost_pct), 0);
    const directionalReturn = direction * rawReturn;
    labels[`${horizon}m`] = {
      horizon_minutes: horizon,
      label_at: new Date(labelMs).toISOString(),
      future_return: rawReturn,
      directional_return: directionalReturn,
      execution_cost_pct: executionCostPct,
      funding_cost_pct: funding.funding_cost_pct,
      funding_pnl_pct: funding.funding_pnl_pct,
      funding_settlements: funding.funding_settlements,
      net_directional_return: directionalReturn - executionCostPct - funding.funding_cost_pct,
      trainable: !overlapsInterruption(observedMs, labelMs, interruptions)
    };
  }
  if (labels["240m"] && !anchor.triple_barrier) {
    anchor.triple_barrier = {
      ...resolveTripleBarrier(anchor, anchor.price_path.filter((item) => Date.parse(item.at) > observedMs && Date.parse(item.at) <= observedMs + 240 * 60_000), anchor.side),
      label_at: labels["240m"].label_at,
      trainable: labels["240m"].trainable
    };
  }
  if (labels["240m"] && !anchor.exit_shadow_matrix) anchor.exit_shadow_matrix = evaluateExitShadowMatrix(anchor);
  anchor.labels = labels;
  return Boolean(labels["240m"] && anchor.triple_barrier);
}

export function recordCandidateCycle(stateValue, { candidates = [], acceptedIds = [], prices = {}, events = [], observedAt = new Date().toISOString(), independentMinutes = 240 } = {}) {
  const state = createDecisionLearningState(stateValue);
  const now = iso(observedAt, new Date().toISOString());
  const nowMs = Date.parse(now);
  const decisionBatchId = `batch_${hash(now).slice(0, 20)}`;
  const independenceId = independenceBucketId(now, independentMinutes);
  const accepted = new Set(acceptedIds);
  const normalizedEvents = events.map((event) => normalizeDecisionEvent(event, now));
  const seenEventIds = new Set(state.seenEventIds);
  const newEvents = normalizedEvents.filter((event) => !seenEventIds.has(event.event_id));
  for (const event of newEvents) seenEventIds.add(event.event_id);
  state.seenEventIds = [...seenEventIds].slice(-50_000);
  for (const anchor of state.pending) {
    const observation = marketObservation(prices, anchor.symbol, now);
    const lastSampleMs = Date.parse(anchor.price_path.at(-1)?.at || "");
    if (observation && (!Number.isFinite(lastSampleMs) || nowMs - lastSampleMs >= 60_000)) anchor.price_path.push(observation);
    anchor.price_path = anchor.price_path.slice(-300);
  }
  const audits = candidates.map((candidate, index) => {
    const candidateEvents = (candidate.relatedEvents || []).map((event) => normalizeDecisionEvent(event, now));
    const candidate_id = candidate.candidate_id || createCandidateId(candidate, now, index);
    const isAccepted = accepted.has(candidate_id) || accepted.has(candidate.id);
    const reason_code = String(isAccepted
      ? "accepted"
      : candidate.reason_code && candidate.reason_code !== "accepted"
        ? candidate.reason_code
        : "portfolio_rank_limit");
    const record = {
      candidate_id,
      decision_batch_id: decisionBatchId,
      independence_bucket_id: independenceId,
      observed_at: now,
      symbol: candidate.symbol,
      side: candidate.side,
      decision: isAccepted ? "accepted" : "rejected",
      reason_code,
      raw_entry_score: finiteOrNull(candidate.raw_entry_score ?? candidate.rawCombinedDirection ?? candidate.combinedDirection),
      raw_exit_score: finiteOrNull(candidate.raw_exit_score),
      feature_missing_mask: candidate.feature_missing_mask || buildFeatureMissingMask(candidate.features || {}),
      event_ids: candidateEvents.map((event) => event.event_id)
    };
    const prior = Date.parse(state.lastIndependentAtBySymbol[candidate.symbol] || "");
    const independent = !Number.isFinite(prior) || nowMs - prior >= independentMinutes * 60_000;
    const initialObservation = marketObservation(prices, candidate.symbol, now);
    const entryPrice = finite(initialObservation?.price ?? candidate.entry, NaN);
    if (independent && Number.isFinite(entryPrice) && entryPrice > 0) {
      state.lastIndependentAtBySymbol[candidate.symbol] = now;
      state.pending.push({
        ...record,
        mode: candidate.mode || candidate.candidateMode || "unknown",
        regime: candidate.regime || "unknown",
        features: candidate.features || {},
        entry_price: entryPrice,
        risk_pct: Math.max(finite(candidate.riskPct, 0.01), 0.0001),
        cost_pct: Math.max(finite(candidate.roundTripExecutionCostPct ?? candidate.calculation?.expectancy?.roundTripExecutionCostPct), 0),
        execution_cost_pct: Math.max(finite(candidate.roundTripExecutionCostPct ?? candidate.calculation?.expectancy?.roundTripExecutionCostPct), 0),
        taker_fee_rate: Math.max(finite(candidate.takerFeeRate), 0),
        slippage_rate: Math.max(finite(candidate.slippageRate), 0),
        funding_rate: finiteOrNull(candidate.fundingRate ?? initialObservation?.funding_rate),
        funding_interval_hours: Math.max(1, finite(candidate.fundingIntervalHours, 8)),
        event_cluster_ids: [...new Set(candidateEvents.map((event) => event.cluster_id))],
        price_path: [initialObservation || { at: now, price: entryPrice, funding_rate: finiteOrNull(candidate.fundingRate) }],
        labels: {}
      });
    }
    return record;
  });
  const matured = [];
  state.pending = state.pending.filter((anchor) => {
    if (!maturePendingAnchor(anchor, nowMs, state.interruptions)) return true;
    const completed = {
      ...anchor,
      price_path_summary: {
        samples: anchor.price_path.length,
        first_at: anchor.price_path[0]?.at || null,
        last_at: anchor.price_path.at(-1)?.at || null
      }
    };
    delete completed.price_path;
    matured.push(completed);
    state.labels.push(completed);
    return false;
  }).slice(-2_000);
  state.labels = state.labels.slice(-20_000);
  state.updatedAt = now;
  return { state, audits, matured, events: normalizedEvents, newEvents };
}

function tradeNetReturn(trade) {
  const fixedLabel = trade?.labels?.["60m"];
  if (fixedLabel?.trainable === true && Number.isFinite(Number(fixedLabel.net_directional_return))) {
    return Number(fixedLabel.net_directional_return);
  }
  if (fixedLabel?.trainable === true && Number.isFinite(Number(fixedLabel.directional_return))) {
    return Number(fixedLabel.directional_return) - Math.max(finite(trade?.execution_cost_pct ?? trade?.cost_pct), 0) - finite(fixedLabel.funding_cost_pct);
  }
  const pnl = Number(trade?.realizedPnl ?? trade?.netPnl);
  const notional = Number(trade?.initialNotional ?? trade?.notional ?? (Number(trade?.entry) * Number(trade?.quantity)));
  if (Number.isFinite(pnl) && Number.isFinite(notional) && notional > 0) return pnl / notional;
  const entry = Number(trade?.entry);
  const exit = Number(trade?.exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) return null;
  const direction = trade?.side === "short" ? -1 : 1;
  const gross = direction * (exit / entry - 1);
  const cost = finite(trade?.feesPct) + finite(trade?.slippagePct) + finite(trade?.fundingPct);
  return gross - cost;
}

export function buildRealizedEvModel(trades = []) {
  const buckets = new Map();
  for (const [index, trade] of trades.entries()) {
    const value = tradeNetReturn(trade);
    if (!Number.isFinite(value)) continue;
    const mode = String(trade?.candidateMode || trade?.mode || "unknown");
    const regime = String(trade?.regime || trade?.factorSnapshot?.regime || "unknown");
    const side = String(trade?.side || "unknown");
    for (const key of [`${mode}|${regime}|${side}`, `${mode}|*|${side}`, `*|*|${side}`, "*|*|*"]) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ value, batch: decisionIndependenceKey(trade, index) });
    }
  }
  const summarizeBucket = (entries) => {
    const batches = new Map();
    for (const entry of entries) {
      if (!batches.has(entry.batch)) batches.set(entry.batch, []);
      batches.get(entry.batch).push(entry.value);
    }
    const summary = summarizeNetEv([...batches.values()].map(mean));
    return { ...summary, samples: entries.length, independent_batches: batches.size };
  };
  return { version: DATA_POLICY_VERSION, buckets: Object.fromEntries([...buckets].map(([key, entries]) => [key, summarizeBucket(entries)])) };
}

export function evaluateRealizedEv(model, candidate = {}, minimumEffectiveSamples = 200) {
  const mode = String(candidate.mode || candidate.candidateMode || "unknown");
  const regime = String(candidate.regime || "unknown");
  const side = String(candidate.side || "unknown");
  const keys = [`${mode}|${regime}|${side}`, `${mode}|*|${side}`, `*|*|${side}`, "*|*|*"];
  const key = keys.find((item) => finite(model?.buckets?.[item]?.n_eff) >= minimumEffectiveSamples) || keys.find((item) => model?.buckets?.[item]);
  const evidence = key ? model.buckets[key] : summarizeNetEv([]);
  return {
    ...evidence,
    bucket: key || null,
    minimum_n_eff: minimumEffectiveSamples,
    passed: evidence.n_eff >= minimumEffectiveSamples && evidence.lower_95 > 0,
    reason_code: evidence.n_eff < minimumEffectiveSamples ? "ev_insufficient_effective_samples" : (evidence.lower_95 <= 0 ? "ev_lower_bound_non_positive" : "ev_gate_passed")
  };
}

function sigmoid(value) {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function featureVector(label) {
  const source = label.features || {};
  const mode = String(label.mode || "unknown");
  const regime = String(label.regime || "unknown");
  const raw = [source.raw_entry_score ?? label.raw_entry_score, source.event_score ?? source.eventScore, source.math_score ?? source.mathScore, source.volatility ?? source.atr_pct ?? source.atrPct];
  const [direction, event, math, volatility] = raw.map((value) => finite(value));
  const missing = raw.map((value) => Number.isFinite(Number(value)) ? 0 : 1);
  const base = [finite(direction), finite(event), finite(math), finite(volatility), ...missing];
  const categorical = [mode === "event_impact", mode === "math_only", regime.includes("bull"), regime.includes("bear")].map(Number);
  return [...base, ...categorical, finite(direction) * finite(event), finite(direction) * finite(volatility)];
}

function probabilityTarget(label) {
  const fixed = label?.labels?.["60m"];
  if (Number.isFinite(Number(fixed?.net_directional_return))) return Number(fixed.net_directional_return > 0);
  const net = finite(fixed?.directional_return) - Math.max(finite(label?.execution_cost_pct ?? label?.cost_pct), 0) - finite(fixed?.funding_cost_pct);
  return Number(net > 0);
}

function aucScore(y, scores, weights = []) {
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < y.length; i += 1) for (let j = 0; j < y.length; j += 1) {
    if (y[i] !== 1 || y[j] !== 0) continue;
    const pairWeight = Math.max(0, finite(weights[i], 1)) * Math.max(0, finite(weights[j], 1));
    pairs += pairWeight;
    wins += pairWeight * (scores[i] > scores[j] ? 1 : (scores[i] === scores[j] ? 0.5 : 0));
  }
  return pairs ? wins / pairs : 0.5;
}

function calibrationMetrics(y, probabilities, weights = []) {
  const base = clamp(weightedMean(y, weights), 0.001, 0.999);
  const brier = weightedMean(y.map((value, index) => (probabilities[index] - value) ** 2), weights);
  const constantBrier = weightedMean(y.map((value) => (base - value) ** 2), weights);
  const totalWeight = y.reduce((sum, _, index) => sum + Math.max(0, finite(weights[index], 1)), 0);
  let ece = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    const members = y.map((value, index) => ({ value, probability: probabilities[index], weight: Math.max(0, finite(weights[index], 1)) }))
      .filter((item) => item.probability >= bin / 10 && (bin === 9 ? item.probability <= 1 : item.probability < (bin + 1) / 10));
    const binWeight = members.reduce((sum, item) => sum + item.weight, 0);
    if (members.length && totalWeight > 0) ece += binWeight / totalWeight * Math.abs(
      weightedMean(members.map((item) => item.probability), members.map((item) => item.weight)) -
      weightedMean(members.map((item) => item.value), members.map((item) => item.weight))
    );
  }
  return { auc: aucScore(y, probabilities, weights), brier, constant_brier: constantBrier, ece };
}

function groupByIndependenceBatch(rows) {
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const key = decisionIndependenceKey(row, index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, values]) => ({
    key,
    rows: values,
    started_at: values.reduce((earliest, row) => Math.min(earliest, Date.parse(row.observed_at || row.openedAt || "")), Number.POSITIVE_INFINITY),
    label_end_at: values.reduce((latest, row) => Math.max(latest, Date.parse(row.labels?.["60m"]?.label_at || row.closedAt || row.observed_at || row.openedAt || "")), Number.NEGATIVE_INFINITY)
  })).sort((left, right) => left.started_at - right.started_at);
}

function purgedTimeSplit(rows) {
  const groups = groupByIndependenceBatch(rows);
  const trainEnd = Math.floor(groups.length * 0.6);
  const validationEnd = Math.floor(groups.length * 0.8);
  const trainGroups = groups.slice(0, trainEnd);
  const trainLabelEnd = Math.max(...trainGroups.map((group) => group.label_end_at));
  const validationGroups = groups.slice(trainEnd, validationEnd).filter((group) => group.started_at > trainLabelEnd);
  const validationLabelEnd = Math.max(...validationGroups.map((group) => group.label_end_at));
  const testGroups = groups.slice(validationEnd).filter((group) => group.started_at > validationLabelEnd);
  const flatten = (values) => values.flatMap((group) => group.rows);
  return {
    train: flatten(trainGroups),
    validation: flatten(validationGroups),
    test: flatten(testGroups),
    batch_ids: {
      train: trainGroups.map((group) => group.key),
      validation: validationGroups.map((group) => group.key),
      locked_test: testGroups.map((group) => group.key)
    },
    purged_batches: groups.length - trainGroups.length - validationGroups.length - testGroups.length,
    total_batches: groups.length
  };
}

function equalBatchWeights(rows) {
  const counts = rows.reduce((result, row, index) => {
    const key = decisionIndependenceKey(row, index);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const raw = rows.map((row, index) => 1 / counts[decisionIndependenceKey(row, index)]);
  const scale = raw.length / Math.max(raw.reduce((sum, value) => sum + value, 0), EPSILON);
  return raw.map((value) => value * scale);
}

function standardize(trainX, datasets) {
  const width = trainX[0]?.length || 0;
  const means = Array.from({ length: width }, (_, index) => mean(trainX.map((row) => row[index])));
  const scales = Array.from({ length: width }, (_, index) => Math.max(sampleDeviation(trainX.map((row) => row[index])), 1e-6));
  return { means, scales, datasets: datasets.map((rows) => rows.map((row) => row.map((value, index) => (value - means[index]) / scales[index]))) };
}

function fitElasticNet(x, y, { lambda = 0.02, alpha = 0.5, iterations = 800, learningRate = 0.08, sampleWeights = [] } = {}) {
  const weights = Array(x[0]?.length || 0).fill(0);
  let intercept = Math.log(clamp(weightedMean(y, sampleWeights), 0.01, 0.99) / (1 - clamp(weightedMean(y, sampleWeights), 0.01, 0.99)));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const probabilities = x.map((row) => sigmoid(intercept + row.reduce((sum, value, index) => sum + value * weights[index], 0)));
    intercept -= learningRate * weightedMean(probabilities.map((probability, index) => probability - y[index]), sampleWeights);
    for (let feature = 0; feature < weights.length; feature += 1) {
      const gradient = weightedMean(x.map((row, index) => (probabilities[index] - y[index]) * row[feature]), sampleWeights) + 2 * lambda * (1 - alpha) * weights[feature];
      const stepped = weights[feature] - learningRate * gradient;
      const threshold = learningRate * lambda * alpha;
      weights[feature] = Math.sign(stepped) * Math.max(Math.abs(stepped) - threshold, 0);
    }
  }
  return { intercept, weights, lambda, alpha };
}

function predict(model, rows) {
  return rows.map((row) => sigmoid(model.intercept + row.reduce((sum, value, index) => sum + value * model.weights[index], 0)));
}

function fitPlatt(probabilities, y, weights = []) {
  let slope = 1;
  let intercept = 0;
  const logits = probabilities.map((value) => Math.log(clamp(value, 1e-6, 1 - 1e-6) / (1 - clamp(value, 1e-6, 1 - 1e-6))));
  for (let iteration = 0; iteration < 400; iteration += 1) {
    const calibrated = logits.map((value) => sigmoid(intercept + slope * value));
    intercept -= 0.05 * weightedMean(calibrated.map((value, index) => value - y[index]), weights);
    slope -= 0.05 * weightedMean(calibrated.map((value, index) => (value - y[index]) * logits[index]), weights);
  }
  return { slope, intercept };
}

export function trainElasticNetProbability(labels = [], options = {}) {
  const rows = labels.filter((item) => item?.labels?.["60m"]?.trainable && Number.isFinite(Number(item.labels["60m"].directional_return)))
    .sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at));
  const independentBatches = countIndependentBatches(rows);
  if (independentBatches < 30) return {
    type: "elastic_net_logistic",
    data_policy_version: DATA_POLICY_VERSION,
    qualified: false,
    reason_code: "probability_model_insufficient_independent_batches",
    samples: rows.length,
    independent_batches: independentBatches,
    n_eff: independentBatches
  };
  const split = purgedTimeSplit(rows);
  if (!split.train.length || !split.validation.length || !split.test.length) return {
    type: "elastic_net_logistic",
    data_policy_version: DATA_POLICY_VERSION,
    qualified: false,
    reason_code: "probability_model_purged_split_empty",
    samples: rows.length,
    independent_batches: independentBatches,
    n_eff: 0,
    split
  };
  const trainXRaw = split.train.map(featureVector);
  const validationXRaw = split.validation.map(featureVector);
  const testXRaw = split.test.map(featureVector);
  const normalized = standardize(trainXRaw, [trainXRaw, validationXRaw, testXRaw]);
  const [trainX, validationX, testX] = normalized.datasets;
  const target = probabilityTarget;
  const trainY = split.train.map(target);
  const validationY = split.validation.map(target);
  const testY = split.test.map(target);
  const trainWeights = equalBatchWeights(split.train);
  const validationWeights = equalBatchWeights(split.validation);
  const testWeights = equalBatchWeights(split.test);
  const fitted = fitElasticNet(trainX, trainY, { ...options, sampleWeights: trainWeights });
  const platt = fitPlatt(predict(fitted, validationX), validationY, validationWeights);
  const rawTest = predict(fitted, testX);
  const testProbabilities = rawTest.map((value) => sigmoid(
    platt.intercept + platt.slope * Math.log(clamp(value, 1e-6, 1 - 1e-6) / (1 - clamp(value, 1e-6, 1 - 1e-6)))
  ));
  const metrics = calibrationMetrics(testY, testProbabilities, testWeights);
  metrics.samples = testY.length;
  metrics.independent_batches = split.batch_ids.locked_test.length;
  metrics.wins = weightedMean(testY, testWeights) * testY.length;
  metrics.average_probability = weightedMean(testProbabilities, testWeights);
  const batchOutcomes = groupByIndependenceBatch(rows).map((group) => mean(group.rows.map(target)));
  const nEff = effectiveSampleSize(batchOutcomes);
  const qualified = nEff >= 200 && metrics.auc > 0.52 && metrics.brier < metrics.constant_brier && metrics.ece < 0.05;
  return {
    type: "elastic_net_logistic",
    data_policy_version: DATA_POLICY_VERSION,
    version: `enet_${hash(`${rows[0].observed_at}|${rows.at(-1).observed_at}|${rows.length}|${independentBatches}`).slice(0, 16)}`,
    trained_at: new Date().toISOString(),
    samples: rows.length,
    independent_batches: independentBatches,
    n_eff: nEff,
    coefficients: fitted,
    standardization: { means: normalized.means, scales: normalized.scales },
    calibration: platt,
    locked_test: metrics,
    split: {
      batch_counts: Object.fromEntries(Object.entries(split.batch_ids).map(([key, values]) => [key, values.length])),
      batch_ids: split.batch_ids,
      purged_batches: split.purged_batches,
      overlap_count: 0
    },
    qualified,
    reason_code: qualified ? "probability_model_qualified" : "probability_model_gate_failed"
  };
}

export function predictQualifiedProbability(model, candidate) {
  if (!model?.qualified) return null;
  const row = featureVector({ ...candidate, features: candidate.features || {} });
  const standardized = row.map((value, index) => (value - finite(model.standardization?.means?.[index])) / Math.max(finite(model.standardization?.scales?.[index], 1), 1e-6));
  const raw = predict(model.coefficients, [standardized])[0];
  const logit = Math.log(clamp(raw, 1e-6, 1 - 1e-6) / (1 - clamp(raw, 1e-6, 1 - 1e-6)));
  return sigmoid(finite(model.calibration?.intercept) + finite(model.calibration?.slope, 1) * logit);
}

export function compareShallowBoosting(baseModel, labels = []) {
  if (!baseModel?.qualified) return { attempted: false, selected: "elastic_net_logistic", reason_code: "baseline_not_qualified" };
  const rows = labels.filter((item) => item?.labels?.["60m"]?.trainable).sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const split = purgedTimeSplit(rows);
  const trainRows = [...split.train, ...split.validation];
  const testRows = split.test;
  if (!trainRows.length || !testRows.length) return { attempted: false, selected: "elastic_net_logistic", reason_code: "boosting_purged_split_empty" };
  const trainY = trainRows.map(probabilityTarget);
  const y = testRows.map(probabilityTarget);
  const trainWeights = equalBatchWeights(trainRows);
  const testWeights = equalBatchWeights(testRows);
  const trainFeatures = trainRows.map(featureVector);
  const trainBase = trainRows.map((item) => predictQualifiedProbability(baseModel, item) ?? 0.5);
  const base = testRows.map((item) => predictQualifiedProbability(baseModel, item) ?? 0.5);
  const stumps = [];
  let trainLogits = trainBase.map((probability) => Math.log(clamp(probability, 1e-6, 1 - 1e-6) / (1 - clamp(probability, 1e-6, 1 - 1e-6))));
  for (let depth = 0; depth < 3; depth += 1) {
    const probabilities = trainLogits.map(sigmoid);
    let best = null;
    for (let feature = 0; feature < (trainFeatures[0]?.length || 0); feature += 1) {
      const sorted = trainFeatures.map((row) => row[feature]).sort((left, right) => left - right);
      for (const quantile of [0.25, 0.5, 0.75]) {
        const threshold = sorted[Math.floor((sorted.length - 1) * quantile)];
        const leaf = (isLeft) => {
          const indices = trainFeatures.flatMap((row, index) => (row[feature] <= threshold) === isLeft ? [index] : []);
          const numerator = indices.reduce((sum, index) => sum + trainWeights[index] * (trainY[index] - probabilities[index]), 0);
          const denominator = indices.reduce((sum, index) => sum + trainWeights[index] * probabilities[index] * (1 - probabilities[index]), 0);
          return clamp(numerator / Math.max(denominator, 1e-6), -2, 2);
        };
        const left = leaf(true);
        const right = leaf(false);
        const loss = weightedMean(trainY.map((target, index) => {
          const prediction = sigmoid(trainLogits[index] + 0.1 * (trainFeatures[index][feature] <= threshold ? left : right));
          return -(target * Math.log(clamp(prediction, 1e-9, 1)) + (1 - target) * Math.log(clamp(1 - prediction, 1e-9, 1)));
        }), trainWeights);
        if (!best || loss < best.loss) best = { feature, threshold, left, right, learning_rate: 0.1, loss };
      }
    }
    if (!best) break;
    stumps.push(best);
    trainLogits = trainLogits.map((logit, index) => logit + best.learning_rate * (trainFeatures[index][best.feature] <= best.threshold ? best.left : best.right));
  }
  const boosted = testRows.map((item, index) => {
    const features = featureVector(item);
    let logit = Math.log(clamp(base[index], 1e-6, 1 - 1e-6) / (1 - clamp(base[index], 1e-6, 1 - 1e-6)));
    for (const stump of stumps) logit += stump.learning_rate * (features[stump.feature] <= stump.threshold ? stump.left : stump.right);
    return sigmoid(logit);
  });
  const baseMetrics = calibrationMetrics(y, base, testWeights);
  const boostMetrics = calibrationMetrics(y, boosted, testWeights);
  const retained = boostMetrics.brier < baseMetrics.brier && boostMetrics.auc >= baseMetrics.auc;
  return { attempted: true, selected: retained ? "shallow_boosting" : "elastic_net_logistic", retained, stumps: retained ? stumps : [], base: baseMetrics, boosting: boostMetrics, independent_test_batches: split.batch_ids.locked_test.length, reason_code: retained ? "locked_test_increment_retained" : "locked_test_increment_disappeared" };
}

export function evaluateExitShadowMatrix(anchor = {}) {
  const path = Array.isArray(anchor.price_path) ? anchor.price_path : [];
  const entry = finite(anchor.entry_price);
  const riskPct = Math.max(finite(anchor.risk_pct, 0.01), 0.0001);
  const direction = anchor.side === "short" ? -1 : 1;
  const rows = [];
  for (const policy of ["vertical_hold", "breakeven_0_5r", "atr_trailing_1r"]) {
    let stopR = -1;
    let peakR = 0;
    let exitR = 0;
    let exitAt = path.at(-1)?.at || anchor.observed_at;
    for (const point of path.slice(1)) {
      const currentR = direction * (finite(point.price) / entry - 1) / riskPct;
      peakR = Math.max(peakR, currentR);
      if (policy === "breakeven_0_5r" && peakR >= 0.5) stopR = Math.max(stopR, 0);
      if (policy === "atr_trailing_1r" && peakR >= 1) stopR = Math.max(stopR, peakR - 1);
      exitR = currentR;
      exitAt = point.at;
      if (currentR <= stopR) { exitR = stopR; break; }
    }
    const funding = fundingSettlementSummary(anchor, Date.parse(exitAt));
    const executionCostR = Math.max(finite(anchor.execution_cost_pct ?? anchor.cost_pct), 0) / riskPct;
    rows.push({
      entry_model: "elastic_net_logistic",
      exit_policy: policy,
      exit_r: exitR,
      exit_at: exitAt,
      execution_cost_r: executionCostR,
      funding_cost_r: funding.funding_cost_pct / riskPct,
      net_exit_r: exitR - executionCostR - funding.funding_cost_pct / riskPct,
      funding_settlements: funding.funding_settlements,
      mfe_r: peakR,
      mae_r: Math.min(0, ...path.slice(1).map((point) => direction * (finite(point.price) / entry - 1) / riskPct))
    });
  }
  return rows;
}

export function replayPortfolio(trades = [], { maxConcurrent = 3, maxClusterExposure = 1, interruptions = [] } = {}) {
  const ordered = [...trades].sort((left, right) => Date.parse(left.openedAt || left.observed_at) - Date.parse(right.openedAt || right.observed_at));
  const active = [];
  const results = [];
  for (const trade of ordered) {
    const openedMs = Date.parse(trade.openedAt || trade.observed_at);
    const closedMs = Date.parse(trade.closedAt || trade.labels?.["240m"]?.label_at || trade.openedAt || trade.observed_at);
    while (active.length && active[0].closedMs <= openedMs) active.shift();
    const cluster = String(trade.cluster_id || trade.event_cluster_ids?.[0] || "none");
    const clusterCount = active.filter((item) => item.cluster === cluster).length;
    const accepted = active.length < maxConcurrent && clusterCount < maxClusterExposure;
    const netReturn = tradeNetReturn(trade);
    const interrupted = overlapsInterruption(openedMs, closedMs, interruptions);
    results.push({ id: trade.id || trade.candidate_id, accepted, reason_code: accepted ? "accepted" : (active.length >= maxConcurrent ? "concurrency_limit" : "cluster_exposure_limit"), net_return_after_costs: netReturn, interrupted, trainable: !interrupted });
    if (accepted) active.push({ closedMs, cluster });
    active.sort((a, b) => a.closedMs - b.closedMs);
  }
  return { results, accepted: results.filter((item) => item.accepted).length, rejected: results.filter((item) => !item.accepted).length, net_return_after_costs: results.filter((item) => item.accepted).reduce((sum, item) => sum + finite(item.net_return_after_costs), 0) };
}

export const DECISION_LEARNING_POLICY = Object.freeze({
  horizons_minutes: HORIZONS_MINUTES,
  minimum_effective_samples: 200,
  fdr_q: 0.05,
  minimum_dwell_hours: 48,
  minimum_new_independent_labels: 100,
  maximum_weight_updates_per_day: 1,
  correlation_cluster_threshold: 0.85,
  demotion_invalid_windows: 2
});
