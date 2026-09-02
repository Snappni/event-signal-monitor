import { createHash } from "node:crypto";

const HORIZONS_MINUTES = Object.freeze([5, 15, 60, 240]);
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
  return Math.max(0, count * (1 - rho1) / Math.max(1 + rho1, 0.05));
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
    version: 1,
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
    labels[`${horizon}m`] = {
      horizon_minutes: horizon,
      label_at: new Date(labelMs).toISOString(),
      future_return: rawReturn,
      directional_return: direction * rawReturn,
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
  const accepted = new Set(acceptedIds);
  const normalizedEvents = events.map((event) => normalizeDecisionEvent(event, now));
  const seenEventIds = new Set(state.seenEventIds);
  const newEvents = normalizedEvents.filter((event) => !seenEventIds.has(event.event_id));
  for (const event of newEvents) seenEventIds.add(event.event_id);
  state.seenEventIds = [...seenEventIds].slice(-50_000);
  for (const anchor of state.pending) {
    const price = finite(prices[anchor.symbol]?.latest ?? prices[anchor.symbol], NaN);
    const lastSampleMs = Date.parse(anchor.price_path.at(-1)?.at || "");
    if (Number.isFinite(price) && price > 0 && (!Number.isFinite(lastSampleMs) || nowMs - lastSampleMs >= 60_000)) anchor.price_path.push({ at: now, price });
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
    const entryPrice = finite(prices[candidate.symbol]?.latest ?? prices[candidate.symbol] ?? candidate.entry, NaN);
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
        event_cluster_ids: [...new Set(candidateEvents.map((event) => event.cluster_id))],
        price_path: [{ at: now, price: entryPrice }],
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
  if (fixedLabel?.trainable === true && Number.isFinite(Number(fixedLabel.directional_return))) {
    return Number(fixedLabel.directional_return) - Math.max(finite(trade?.cost_pct), 0);
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
  for (const trade of trades) {
    const value = tradeNetReturn(trade);
    if (!Number.isFinite(value)) continue;
    const mode = String(trade?.candidateMode || trade?.mode || "unknown");
    const regime = String(trade?.regime || trade?.factorSnapshot?.regime || "unknown");
    const side = String(trade?.side || "unknown");
    for (const key of [`${mode}|${regime}|${side}`, `${mode}|*|${side}`, `*|*|${side}`, "*|*|*"]) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(value);
    }
  }
  return { version: 1, buckets: Object.fromEntries([...buckets].map(([key, values]) => [key, summarizeNetEv(values)])) };
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

function aucScore(y, scores) {
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < y.length; i += 1) for (let j = 0; j < y.length; j += 1) {
    if (y[i] !== 1 || y[j] !== 0) continue;
    pairs += 1;
    wins += scores[i] > scores[j] ? 1 : (scores[i] === scores[j] ? 0.5 : 0);
  }
  return pairs ? wins / pairs : 0.5;
}

function calibrationMetrics(y, probabilities) {
  const base = clamp(mean(y), 0.001, 0.999);
  const brier = mean(y.map((value, index) => (probabilities[index] - value) ** 2));
  const constantBrier = mean(y.map((value) => (base - value) ** 2));
  let ece = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    const members = y.map((value, index) => ({ value, probability: probabilities[index] }))
      .filter((item) => item.probability >= bin / 10 && (bin === 9 ? item.probability <= 1 : item.probability < (bin + 1) / 10));
    if (members.length) ece += members.length / y.length * Math.abs(mean(members.map((item) => item.probability)) - mean(members.map((item) => item.value)));
  }
  return { auc: aucScore(y, probabilities), brier, constant_brier: constantBrier, ece };
}

function standardize(trainX, datasets) {
  const width = trainX[0]?.length || 0;
  const means = Array.from({ length: width }, (_, index) => mean(trainX.map((row) => row[index])));
  const scales = Array.from({ length: width }, (_, index) => Math.max(sampleDeviation(trainX.map((row) => row[index])), 1e-6));
  return { means, scales, datasets: datasets.map((rows) => rows.map((row) => row.map((value, index) => (value - means[index]) / scales[index]))) };
}

function fitElasticNet(x, y, { lambda = 0.02, alpha = 0.5, iterations = 800, learningRate = 0.08 } = {}) {
  const weights = Array(x[0]?.length || 0).fill(0);
  let intercept = Math.log(clamp(mean(y), 0.01, 0.99) / (1 - clamp(mean(y), 0.01, 0.99)));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const probabilities = x.map((row) => sigmoid(intercept + row.reduce((sum, value, index) => sum + value * weights[index], 0)));
    intercept -= learningRate * mean(probabilities.map((probability, index) => probability - y[index]));
    for (let feature = 0; feature < weights.length; feature += 1) {
      const gradient = mean(x.map((row, index) => (probabilities[index] - y[index]) * row[feature])) + 2 * lambda * (1 - alpha) * weights[feature];
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

function fitPlatt(probabilities, y) {
  let slope = 1;
  let intercept = 0;
  const logits = probabilities.map((value) => Math.log(clamp(value, 1e-6, 1 - 1e-6) / (1 - clamp(value, 1e-6, 1 - 1e-6))));
  for (let iteration = 0; iteration < 400; iteration += 1) {
    const calibrated = logits.map((value) => sigmoid(intercept + slope * value));
    intercept -= 0.05 * mean(calibrated.map((value, index) => value - y[index]));
    slope -= 0.05 * mean(calibrated.map((value, index) => (value - y[index]) * logits[index]));
  }
  return { slope, intercept };
}

export function trainElasticNetProbability(labels = [], options = {}) {
  const rows = labels.filter((item) => item?.labels?.["60m"]?.trainable && Number.isFinite(Number(item.labels["60m"].directional_return)))
    .sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at));
  if (rows.length < 30) return { type: "elastic_net_logistic", qualified: false, reason_code: "probability_model_insufficient_samples", samples: rows.length };
  const x = rows.map(featureVector);
  const y = rows.map((item) => Number(item.labels["60m"].directional_return > 0));
  const trainEnd = Math.floor(rows.length * 0.6);
  const validationEnd = Math.floor(rows.length * 0.8);
  const normalized = standardize(x.slice(0, trainEnd), [x.slice(0, trainEnd), x.slice(trainEnd, validationEnd), x.slice(validationEnd)]);
  const [trainX, validationX, testX] = normalized.datasets;
  const trainY = y.slice(0, trainEnd);
  const validationY = y.slice(trainEnd, validationEnd);
  const testY = y.slice(validationEnd);
  const fitted = fitElasticNet(trainX, trainY, options);
  const platt = fitPlatt(predict(fitted, validationX), validationY);
  const rawTest = predict(fitted, testX);
  const testProbabilities = rawTest.map((value) => sigmoid(
    platt.intercept + platt.slope * Math.log(clamp(value, 1e-6, 1 - 1e-6) / (1 - clamp(value, 1e-6, 1 - 1e-6)))
  ));
  const metrics = calibrationMetrics(testY, testProbabilities);
  metrics.samples = testY.length;
  metrics.wins = testY.reduce((sum, value) => sum + value, 0);
  metrics.average_probability = mean(testProbabilities);
  const nEff = effectiveSampleSize(y);
  const qualified = nEff >= 200 && metrics.auc > 0.52 && metrics.brier < metrics.constant_brier && metrics.ece < 0.05;
  return {
    type: "elastic_net_logistic",
    version: `enet_${hash(`${rows[0].observed_at}|${rows.at(-1).observed_at}|${rows.length}`).slice(0, 16)}`,
    trained_at: new Date().toISOString(),
    samples: rows.length,
    n_eff: nEff,
    coefficients: fitted,
    standardization: { means: normalized.means, scales: normalized.scales },
    calibration: platt,
    locked_test: metrics,
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
  const split = Math.floor(rows.length * 0.8);
  const trainRows = rows.slice(0, split);
  const testRows = rows.slice(split);
  const trainY = trainRows.map((item) => Number(item.labels["60m"].directional_return > 0));
  const y = testRows.map((item) => Number(item.labels["60m"].directional_return > 0));
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
          const numerator = indices.reduce((sum, index) => sum + trainY[index] - probabilities[index], 0);
          const denominator = indices.reduce((sum, index) => sum + probabilities[index] * (1 - probabilities[index]), 0);
          return clamp(numerator / Math.max(denominator, 1e-6), -2, 2);
        };
        const left = leaf(true);
        const right = leaf(false);
        const loss = mean(trainY.map((target, index) => {
          const prediction = sigmoid(trainLogits[index] + 0.1 * (trainFeatures[index][feature] <= threshold ? left : right));
          return -(target * Math.log(clamp(prediction, 1e-9, 1)) + (1 - target) * Math.log(clamp(1 - prediction, 1e-9, 1)));
        }));
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
  const baseMetrics = calibrationMetrics(y, base);
  const boostMetrics = calibrationMetrics(y, boosted);
  const retained = boostMetrics.brier < baseMetrics.brier && boostMetrics.auc >= baseMetrics.auc;
  return { attempted: true, selected: retained ? "shallow_boosting" : "elastic_net_logistic", retained, stumps: retained ? stumps : [], base: baseMetrics, boosting: boostMetrics, reason_code: retained ? "locked_test_increment_retained" : "locked_test_increment_disappeared" };
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
    rows.push({ entry_model: "elastic_net_logistic", exit_policy: policy, exit_r: exitR, exit_at: exitAt, mfe_r: peakR, mae_r: Math.min(0, ...path.slice(1).map((point) => direction * (finite(point.price) / entry - 1) / riskPct)) });
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
