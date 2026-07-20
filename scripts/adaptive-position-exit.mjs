export const EXIT_FACTOR_KEYS = Object.freeze([
  "signalReversal",
  "netExpectancyDecay",
  "eventDecay",
  "timeDecay",
  "capitalEfficiency",
  "profitProtection"
]);

export const DEFAULT_EXIT_MODEL_WEIGHTS = Object.freeze({
  signalReversal: 0.277,
  netExpectancyDecay: 0.238,
  eventDecay: 0.119,
  timeDecay: 0.158,
  capitalEfficiency: 0.088,
  profitProtection: 0.12
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function regimeKind(value, side) {
  const regime = String(value || "unknown").toLowerCase();
  if (regime.includes("transition")) return "transition";
  if (regime.includes("range")) return "range";
  if (regime.includes("bull")) return side === "short" ? "transition" : "trend";
  if (regime.includes("bear")) return side === "long" ? "transition" : "trend";
  if (regime.includes("trend")) return "trend";
  return "unknown";
}

export function normalizeExitWeights(value, fallback = DEFAULT_EXIT_MODEL_WEIGHTS) {
  const raw = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_EXIT_MODEL_WEIGHTS;
  const weights = Object.fromEntries(
    EXIT_FACTOR_KEYS.map((key) => [key, clamp(safeNumber(raw[key], safeNumber(base[key], 0.25)), 0.01, 0.7)])
  );
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight / total]));
}

function eventFreshnessWeight(event, nowMs) {
  const effectiveAt =
    event?.freshness?.effectiveAt ||
    event?.occurredAt ||
    event?.publishedAt ||
    event?.receivedAt;
  const effectiveMs = Date.parse(effectiveAt || "");
  if (!Number.isFinite(effectiveMs)) return 0;
  const ageHours = Math.max(0, nowMs - effectiveMs) / 3_600_000;
  const source = String(event?.source || event?.provider || "").toLowerCase();
  const halfLifeHours = source.includes("polymarket") ? 24 : source.includes("announcement") ? 12 : 6;
  return Math.exp((-Math.LN2 * ageHours) / halfLifeHours);
}

function adaptiveMaxHoldingHours(position) {
  const mode = String(position?.candidateMode || "math_only");
  const baseHours = mode === "event_impact" ? 8 : mode === "event_math" ? 12 : 18;
  const atrPct = Math.max(
    0.001,
    Math.abs(
      safeNumber(
        position?.factorSnapshot?.marketInputs?.atrPct,
        safeNumber(position?.riskPct, 0.019) / 1.9
      )
    )
  );
  const volatilityFactor = clamp(0.012 / atrPct, 0.65, 1.35);
  const regime = regimeKind(position?.regime || position?.factorSnapshot?.regime, position?.side);
  const regimeFactor = regime === "trend" ? 1.15 : regime === "range" ? 0.85 : regime === "transition" ? 0.75 : 1;
  return clamp(baseHours * volatilityFactor * regimeFactor, 4, 24);
}

function remainingDistances(position, currentPrice) {
  const takeProfit = safeNumber(position?.takeProfit, currentPrice);
  const stopLoss = safeNumber(position?.stopLoss, currentPrice);
  if (position?.side === "short") {
    return {
      rewardPct: Math.max(0, 1 - takeProfit / currentPrice),
      riskPct: Math.max(0, stopLoss / currentPrice - 1)
    };
  }
  return {
    rewardPct: Math.max(0, takeProfit / currentPrice - 1),
    riskPct: Math.max(0, 1 - stopLoss / currentPrice)
  };
}

export function evaluateAdaptivePositionExit({ position, market, candidate, now, weights }) {
  const nowIso = now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const policyStartedAt = position?.exitPolicyStartedAt || position?.openedAt || nowIso;
  const policyStartedMs = Date.parse(policyStartedAt);
  const ageMs = Math.max(0, nowMs - (Number.isFinite(policyStartedMs) ? policyStartedMs : nowMs));
  const currentPrice = safeNumber(market?.latest, safeNumber(position?.currentPrice, position?.entry));
  const currentWeights = normalizeExitWeights(weights);
  const currentSide = position?.side === "short" ? "short" : "long";
  const candidateSide = candidate?.side === "short" ? "short" : candidate?.side === "long" ? "long" : null;
  const reversalStrength =
    candidateSide && candidateSide !== currentSide
      ? clamp(Math.abs(safeNumber(candidate?.combinedDirection)), 0, 1)
      : 0;
  const directionalWinRate = candidateSide
    ? candidateSide === currentSide
      ? clamp(safeNumber(candidate?.winRate, 0.5), 0.05, 0.95)
      : clamp(1 - safeNumber(candidate?.winRate, 0.5), 0.05, 0.95)
    : 0.5;
  const distances = remainingDistances(position, currentPrice);
  const futureExecutionCostPct = Math.max(0, safeNumber(position?.feeRate) + safeNumber(position?.slippageRate));
  const fundingRate = safeNumber(market?.fundingRate, safeNumber(position?.lastFundingRate));
  const projectedFundingCostPct = Math.max(0, currentSide === "long" ? fundingRate : -fundingRate);
  const remainingExpectancyPct =
    directionalWinRate * distances.rewardPct -
    (1 - directionalWinRate) * distances.riskPct -
    futureExecutionCostPct -
    projectedFundingCostPct;
  const expectancyScale = Math.max(distances.rewardPct + distances.riskPct, 0.005);
  const netExpectancyDecay = clamp(-remainingExpectancyPct / expectancyScale, 0, 1);
  const relatedEvents = Array.isArray(position?.relatedEvents) ? position.relatedEvents : [];
  const freshestEventWeight = relatedEvents.length
    ? Math.max(...relatedEvents.map((event) => eventFreshnessWeight(event, nowMs)))
    : 1;
  const eventDecay = relatedEvents.length ? clamp(1 - freshestEventWeight, 0, 1) : 0;
  const maxHoldingHours = adaptiveMaxHoldingHours(position);
  const timeDecay = clamp(ageMs / (maxHoldingHours * 3_600_000), 0, 1);
  const signals = {
    signalReversal: reversalStrength,
    netExpectancyDecay,
    eventDecay,
    timeDecay,
    capitalEfficiency: 0,
    profitProtection: clamp(safeNumber(position?.dynamicProtection?.profitProtection), 0, 1)
  };
  const exitScore = EXIT_FACTOR_KEYS.reduce(
    (score, key) => score + signals[key] * currentWeights[key],
    0
  );
  const regime = regimeKind(position?.regime || position?.factorSnapshot?.regime, position?.side);
  const baseThreshold = regime === "trend" ? 0.72 : regime === "range" ? 0.64 : regime === "transition" ? 0.62 : 0.68;
  const hardExpired = timeDecay >= 1;
  const materialNegativeExpectancy =
    ageMs >= 10 * 60 * 1000 &&
    remainingExpectancyPct <= -Math.max(0.0015, futureExecutionCostPct);
  const threshold = hardExpired || materialNegativeExpectancy ? Math.min(baseThreshold, exitScore) : baseThreshold;
  const recommendsExit = hardExpired || materialNegativeExpectancy || exitScore >= threshold;
  const entryExpectancyPct = Math.max(0, safeNumber(position?.expectancyPct));
  const qualityRetention = entryExpectancyPct > 0
    ? remainingExpectancyPct / entryExpectancyPct
    : 1;
  const deRiskCostFloorPct = futureExecutionCostPct + projectedFundingCostPct;
  const qualityDeteriorated =
    entryExpectancyPct > 0 && remainingExpectancyPct <= entryExpectancyPct * 0.55;
  const recommendsDeRisk =
    !recommendsExit &&
    ageMs >= 20 * 60 * 1000 &&
    (qualityDeteriorated || remainingExpectancyPct <= deRiskCostFloorPct);
  const deRiskFraction = recommendsDeRisk
    ? remainingExpectancyPct <= 0 || qualityRetention <= 0.25
      ? 0.5
      : 0.25
    : 0;
  return {
    version: 4,
    evaluatedAt: nowIso,
    policyStartedAt,
    signals,
    weights: currentWeights,
    exitScore,
    threshold,
    recommendsExit,
    recommendsDeRisk,
    deRiskFraction,
    deRiskConfirmationRunsRequired: 3,
    deRiskCooldownMinutes: 30,
    hardExpired,
    materialNegativeExpectancy,
    maxHoldingHours,
    confirmationRunsRequired: hardExpired ? 1 : 3,
    counterfactualHorizonHours: clamp(maxHoldingHours / 4, 1, 4),
    diagnostics: {
      currentPrice,
      candidateSide,
      directionalWinRate,
      remainingRewardPct: distances.rewardPct,
      remainingRiskPct: distances.riskPct,
      remainingExpectancyPct,
      entryExpectancyPct,
      qualityRetention,
      deRiskCostFloorPct,
      qualityDeteriorated,
      futureExecutionCostPct,
      projectedFundingCostPct,
      freshestEventWeight,
      normalizedRegime: regime,
      baseThreshold,
      policyAgeHours: ageMs / 3_600_000
    }
  };
}
