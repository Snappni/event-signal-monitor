import { randomUUID } from "node:crypto";

export const DIRECTION_FACTOR_KEYS = Object.freeze([
  "trend",
  "higherTimeframeTrend",
  "momentum",
  "rsi",
  "funding",
  "openInterest",
  "geometricBrownianMotion",
  "hiddenMarkovModel"
]);

export const DEFAULT_DIRECTION_MODEL_WEIGHTS = Object.freeze({
  trend: 0.24,
  higherTimeframeTrend: 0.14,
  momentum: 0.12,
  rsi: 0.05,
  funding: 0.05,
  openInterest: 0.05,
  geometricBrownianMotion: 0.15,
  hiddenMarkovModel: 0.2
});

export const DEFAULT_POST_TRADE_REVIEW_CONFIG = Object.freeze({
  enabled: true,
  reviewEveryTrades: 20,
  autoApplyValidatedWeights: false,
  minimumProposalTrades: 20,
  minimumPromotionTrades: 60,
  maxWeightChangePct: 0.05
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function pearson(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 3) return 0;
  const xs = left.slice(0, length);
  const ys = right.slice(0, length);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < length; index += 1) {
    const xDelta = xs[index] - xMean;
    const yDelta = ys[index] - yMean;
    numerator += xDelta * yDelta;
    xVariance += xDelta ** 2;
    yVariance += yDelta ** 2;
  }
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator > 0 ? numerator / denominator : 0;
}

export function normalizePostTradeReviewConfig(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    enabled: raw.enabled !== false,
    reviewEveryTrades: Math.round(
      clamp(safeNumber(raw.reviewEveryTrades, DEFAULT_POST_TRADE_REVIEW_CONFIG.reviewEveryTrades), 5, 500)
    ),
    autoApplyValidatedWeights: raw.autoApplyValidatedWeights === true,
    minimumProposalTrades: Math.round(
      clamp(
        safeNumber(raw.minimumProposalTrades, DEFAULT_POST_TRADE_REVIEW_CONFIG.minimumProposalTrades),
        20,
        500
      )
    ),
    minimumPromotionTrades: Math.round(
      clamp(
        safeNumber(raw.minimumPromotionTrades, DEFAULT_POST_TRADE_REVIEW_CONFIG.minimumPromotionTrades),
        60,
        2_000
      )
    ),
    maxWeightChangePct: clamp(
      safeNumber(raw.maxWeightChangePct, DEFAULT_POST_TRADE_REVIEW_CONFIG.maxWeightChangePct),
      0.01,
      0.1
    )
  };
}

export function normalizeDirectionWeights(value, fallback) {
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const raw = value && typeof value === "object" ? value : {};
  const weights = {};
  for (const key of DIRECTION_FACTOR_KEYS) {
    weights[key] = clamp(safeNumber(raw[key], safeNumber(base[key], 1 / DIRECTION_FACTOR_KEYS.length)), 0.01, 0.7);
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return Object.fromEntries(DIRECTION_FACTOR_KEYS.map((key) => [key, 1 / DIRECTION_FACTOR_KEYS.length]));
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight / total]));
}

export function createPostTradeReviewState(defaultDirectionWeights, sessionId = null) {
  const weights = normalizeDirectionWeights(defaultDirectionWeights, defaultDirectionWeights);
  return {
    version: 1,
    sessionId,
    reviewedTradeCount: 0,
    completedReviews: 0,
    currentDirectionWeights: weights,
    previousDirectionWeights: null,
    weightVersion: 1,
    latestReview: null,
    reviewHistory: [],
    lastPromotionAt: null,
    lastRollbackAt: null
  };
}

export function normalizePostTradeReviewState(value, defaultDirectionWeights, sessionId = null) {
  if (!value || typeof value !== "object" || (value.sessionId && sessionId && value.sessionId !== sessionId)) {
    return createPostTradeReviewState(defaultDirectionWeights, sessionId);
  }
  const state = createPostTradeReviewState(defaultDirectionWeights, sessionId);
  state.reviewedTradeCount = Math.max(0, Math.round(safeNumber(value.reviewedTradeCount)));
  state.completedReviews = Math.max(0, Math.round(safeNumber(value.completedReviews)));
  state.currentDirectionWeights = normalizeDirectionWeights(value.currentDirectionWeights, defaultDirectionWeights);
  state.previousDirectionWeights = value.previousDirectionWeights
    ? normalizeDirectionWeights(value.previousDirectionWeights, defaultDirectionWeights)
    : null;
  state.weightVersion = Math.max(1, Math.round(safeNumber(value.weightVersion, 1)));
  state.latestReview = value.latestReview && typeof value.latestReview === "object" ? value.latestReview : null;
  state.reviewHistory = Array.isArray(value.reviewHistory) ? value.reviewHistory.slice(-20) : [];
  state.lastPromotionAt = value.lastPromotionAt || null;
  state.lastRollbackAt = value.lastRollbackAt || null;
  return state;
}

function tradeNetR(trade) {
  const riskAmount = Math.abs(safeNumber(trade.maxLossAmount));
  if (riskAmount > 0) return safeNumber(trade.realizedPnl) / riskAmount;
  const margin = Math.abs(safeNumber(trade.marginRequired));
  return margin > 0 ? safeNumber(trade.realizedPnl) / margin : 0;
}

function tradeDirectionLabel(trade) {
  const pnlSign = safeNumber(trade.realizedPnl) >= 0 ? 1 : -1;
  return trade.side === "short" ? -pnlSign : pnlSign;
}

function eligibleTrade(trade) {
  const signals = trade?.factorSnapshot?.directionSignals;
  return Boolean(
    trade &&
      trade.status === "closed" &&
      signals &&
      typeof signals === "object" &&
      DIRECTION_FACTOR_KEYS.some((key) => Number.isFinite(Number(signals[key])))
  );
}

function scoreDirection(trade, weights) {
  const signals = trade.factorSnapshot.directionSignals || {};
  return DIRECTION_FACTOR_KEYS.reduce(
    (score, key) => score + safeNumber(signals[key]) * safeNumber(weights[key]),
    0
  );
}

function validationMetrics(trades, weights) {
  if (!trades.length) return { samples: 0, accuracy: 0, meanSignedMargin: 0 };
  let correct = 0;
  const margins = [];
  for (const trade of trades) {
    const label = tradeDirectionLabel(trade);
    const score = scoreDirection(trade, weights);
    if ((score >= 0 ? 1 : -1) === label) correct += 1;
    margins.push(label * score);
  }
  return {
    samples: trades.length,
    accuracy: correct / trades.length,
    meanSignedMargin: mean(margins)
  };
}

function factorStatistics(trades, currentWeights) {
  return DIRECTION_FACTOR_KEYS.map((key) => {
    const values = [];
    const pnlRs = [];
    const directionalProducts = [];
    let activeSamples = 0;
    for (const trade of trades) {
      const signal = safeNumber(trade.factorSnapshot.directionSignals?.[key]);
      const netR = tradeNetR(trade);
      const label = tradeDirectionLabel(trade);
      values.push(signal);
      pnlRs.push(netR);
      directionalProducts.push(signal * label);
      if (Math.abs(signal) > 1e-9) activeSamples += 1;
    }
    return {
      factor: key,
      samples: trades.length,
      activeSamples,
      coverage: trades.length ? activeSamples / trades.length : 0,
      currentWeight: safeNumber(currentWeights[key]),
      meanSignal: mean(values),
      directionAssociation: mean(directionalProducts),
      netRCorrelation: pearson(values, pnlRs)
    };
  });
}

function qualityFactorStatistics(trades) {
  const keys = [
    ...new Set(
      trades.flatMap((trade) => Object.keys(trade?.factorSnapshot?.qualityFactors || {}))
    )
  ].sort();
  return keys.map((factor) => {
    const samples = trades.map((trade) => ({
      value: safeNumber(trade.factorSnapshot.qualityFactors?.[factor]),
      netR: tradeNetR(trade),
      won: safeNumber(trade.realizedPnl) >= 0
    }));
    const wins = samples.filter((sample) => sample.won).map((sample) => sample.value);
    const losses = samples.filter((sample) => !sample.won).map((sample) => sample.value);
    return {
      factor,
      samples: samples.length,
      meanStrength: mean(samples.map((sample) => sample.value)),
      meanStrengthOnWins: mean(wins),
      meanStrengthOnLosses: mean(losses),
      netRCorrelation: pearson(
        samples.map((sample) => sample.value),
        samples.map((sample) => sample.netR)
      )
    };
  });
}

function proposeWeights(trainingTrades, currentWeights, config) {
  const statistics = factorStatistics(trainingTrades, currentWeights);
  const evidenceShrinkage = trainingTrades.length / (trainingTrades.length + 40);
  const provisional = {};
  for (const item of statistics) {
    const rawChange = clamp(
      item.directionAssociation * item.coverage * evidenceShrinkage,
      -config.maxWeightChangePct,
      config.maxWeightChangePct
    );
    provisional[item.factor] = item.currentWeight * (1 + rawChange);
    item.suggestedChangePct = rawChange;
  }
  const candidate = normalizeDirectionWeights(provisional, currentWeights);
  for (const item of statistics) {
    item.candidateWeight = candidate[item.factor];
    item.normalizedChangePct = item.currentWeight
      ? candidate[item.factor] / item.currentWeight - 1
      : 0;
  }
  return { candidate, statistics };
}

function explainTrade(trade, weights) {
  const netR = tradeNetR(trade);
  const grossPnl = safeNumber(trade.grossTradingPnl);
  const realizedPnl = safeNumber(trade.realizedPnl);
  const costs =
    safeNumber(trade.entryFee) +
    safeNumber(trade.exitFee) +
    safeNumber(trade.entrySlippageCost) +
    safeNumber(trade.exitSlippageCost) -
    safeNumber(trade.fundingPnl);
  const factorContributions = DIRECTION_FACTOR_KEYS.map((factor) => ({
    factor,
    signal: safeNumber(trade.factorSnapshot.directionSignals?.[factor]),
    weight: safeNumber(weights[factor]),
    contribution: safeNumber(trade.factorSnapshot.directionSignals?.[factor]) * safeNumber(weights[factor])
  })).sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  const classification =
    realizedPnl >= 0
      ? "profitable"
      : grossPnl > 0 && costs > grossPnl
        ? "cost_drag"
        : trade.closeReason === "SL"
          ? "stop_loss"
          : "direction_or_timing_error";
  return {
    tradeId: trade.id,
    signalId: trade.signalId || null,
    symbol: trade.symbol,
    side: trade.side,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    closeReason: trade.closeReason || null,
    regime: trade.factorSnapshot.regime || trade.regime || "unknown",
    modelVersion: trade.factorSnapshot.modelVersion || null,
    weightVersion: trade.factorSnapshot.weightVersion || null,
    realizedPnl: round(realizedPnl),
    netR: round(netR),
    grossTradingPnl: round(grossPnl),
    totalExecutionCost: round(costs),
    classification,
    entry: round(safeNumber(trade.entry)),
    exitPrice: round(safeNumber(trade.exitPrice)),
    takeProfit: round(safeNumber(trade.takeProfit)),
    stopLoss: round(safeNumber(trade.stopLoss)),
    maxFavorableExcursionPct: round(safeNumber(trade.maxFavorableExcursionPct)),
    maxAdverseExcursionPct: round(safeNumber(trade.maxAdverseExcursionPct)),
    holdingObservationCount: Array.isArray(trade.holdingObservations) ? trade.holdingObservations.length : 0,
    decision: {
      candidateMode: trade.candidateMode || null,
      predictedWinRate: round(safeNumber(trade.winRate)),
      adaptiveWinRateThreshold: round(safeNumber(trade.adaptiveWinRateThreshold)),
      breakEvenWinRate: round(safeNumber(trade.breakEvenWinRate)),
      predictedExpectancyPct: round(safeNumber(trade.expectancyPct)),
      eventImpactScore: round(safeNumber(trade.eventImpactScore)),
      combinedDirection: round(safeNumber(trade.decisionCalculation?.direction?.combinedDirection)),
      eventDirection: round(safeNumber(trade.decisionCalculation?.direction?.eventDirection)),
      eventWeight: round(safeNumber(trade.decisionCalculation?.direction?.eventWeight)),
      mathDirection: round(safeNumber(trade.decisionCalculation?.direction?.mathDirection)),
      mathWeight: round(safeNumber(trade.decisionCalculation?.direction?.mathWeight))
    },
    factorContributions: factorContributions.map((item) => ({
      ...item,
      signal: round(item.signal),
      weight: round(item.weight),
      contribution: round(item.contribution)
    })),
    relatedEvents: Array.isArray(trade.relatedEvents) ? trade.relatedEvents.slice(0, 5) : []
  };
}

export function buildPostTradeReview(trades, currentDirectionWeights, configValue, options = {}) {
  const config = normalizePostTradeReviewConfig(configValue);
  const weights = normalizeDirectionWeights(currentDirectionWeights, currentDirectionWeights);
  const allClosedTrades = Array.isArray(trades) ? trades.filter((trade) => trade?.status === "closed") : [];
  const eligibleTrades = allClosedTrades.filter(eligibleTrade).sort((left, right) =>
    String(left.closedAt || "").localeCompare(String(right.closedAt || ""))
  );
  const reviewId = `review-${randomUUID()}`;
  const review = {
    id: reviewId,
    generatedAt: options.now || new Date().toISOString(),
    status: "insufficient_data",
    totalClosedTrades: allClosedTrades.length,
    eligibleTrades: eligibleTrades.length,
    excludedTrades: allClosedTrades.length - eligibleTrades.length,
    batchTradeCount: safeNumber(options.batchTradeCount, allClosedTrades.length),
    currentDirectionWeights: weights,
    candidateDirectionWeights: null,
    factorStatistics: factorStatistics(eligibleTrades, weights),
    qualityFactorStatistics: qualityFactorStatistics(eligibleTrades),
    validation: null,
    promotionEligible: false,
    promotionBlockers: [],
    applied: false,
    limitations: [
      "Only trades with an entry-time factor snapshot are eligible.",
      "Attribution estimates predictive association, not causal effect.",
      "Executed trades contain selection bias; rejected-opportunity replay remains a separate evidence source."
    ],
    trades: eligibleTrades.slice(-Math.max(config.reviewEveryTrades, 20)).map((trade) => explainTrade(trade, weights))
  };

  if (eligibleTrades.length < config.minimumProposalTrades) {
    review.promotionBlockers.push("minimum_proposal_trades");
    return review;
  }

  const validationSize = Math.max(5, Math.min(Math.ceil(eligibleTrades.length * 0.3), 40));
  const trainingTrades = eligibleTrades.slice(0, -validationSize);
  const validationTrades = eligibleTrades.slice(-validationSize);
  if (trainingTrades.length < 10 || validationTrades.length < 5) {
    if (trainingTrades.length < 10) review.promotionBlockers.push("minimum_training_samples");
    if (validationTrades.length < 5) review.promotionBlockers.push("minimum_validation_samples");
    return review;
  }

  const proposal = proposeWeights(trainingTrades, weights, config);
  const champion = validationMetrics(validationTrades, weights);
  const challenger = validationMetrics(validationTrades, proposal.candidate);
  const accuracyDelta = challenger.accuracy - champion.accuracy;
  const marginDelta = challenger.meanSignedMargin - champion.meanSignedMargin;
  const promotionEligible =
    eligibleTrades.length >= config.minimumPromotionTrades &&
    validationTrades.length >= 10 &&
    accuracyDelta >= 0.03 &&
    marginDelta > 0;

  review.status = promotionEligible ? "validated_candidate" : "shadow_candidate";
  review.candidateDirectionWeights = proposal.candidate;
  review.factorStatistics = proposal.statistics.map((item) =>
    Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === "number" ? round(value) : value]))
  );
  review.validation = {
    chronologicalSplit: true,
    trainingSamples: trainingTrades.length,
    validationSamples: validationTrades.length,
    champion: {
      samples: champion.samples,
      accuracy: round(champion.accuracy),
      meanSignedMargin: round(champion.meanSignedMargin)
    },
    challenger: {
      samples: challenger.samples,
      accuracy: round(challenger.accuracy),
      meanSignedMargin: round(challenger.meanSignedMargin)
    },
    accuracyDelta: round(accuracyDelta),
    meanSignedMarginDelta: round(marginDelta)
  };
  if (eligibleTrades.length < config.minimumPromotionTrades) review.promotionBlockers.push("minimum_promotion_trades");
  if (validationTrades.length < 10) review.promotionBlockers.push("minimum_validation_samples");
  if (accuracyDelta < 0.03) review.promotionBlockers.push("accuracy_delta");
  if (marginDelta <= 0) review.promotionBlockers.push("mean_signed_margin_delta");
  review.promotionEligible = promotionEligible;
  return review;
}

export function maybeRunPostTradeReview(account, defaultDirectionWeights, now = new Date().toISOString()) {
  const config = normalizePostTradeReviewConfig(account.postTradeReviewConfig);
  const state = normalizePostTradeReviewState(account.postTradeReview, defaultDirectionWeights, account.sessionId);
  account.postTradeReviewConfig = config;
  account.postTradeReview = state;
  const trades = Array.isArray(account.tradeHistory) ? account.tradeHistory : [];
  const newTradeCount = Math.max(0, trades.length - state.reviewedTradeCount);
  if (!config.enabled || newTradeCount < config.reviewEveryTrades) {
    return { account, review: null, newTradeCount };
  }

  const review = buildPostTradeReview(trades, state.currentDirectionWeights, config, {
    now,
    batchTradeCount: newTradeCount
  });
  state.reviewedTradeCount = trades.length;
  state.completedReviews += 1;
  if (config.autoApplyValidatedWeights && review.promotionEligible) {
    state.previousDirectionWeights = state.currentDirectionWeights;
    state.currentDirectionWeights = normalizeDirectionWeights(
      review.candidateDirectionWeights,
      state.currentDirectionWeights
    );
    state.weightVersion += 1;
    state.lastPromotionAt = now;
    review.status = "promoted";
    review.applied = true;
  }
  state.latestReview = review;
  state.reviewHistory = [...state.reviewHistory, review].slice(-20);
  return { account, review, newTradeCount };
}

export function applyLatestReviewCandidate(account, defaultDirectionWeights, now = new Date().toISOString()) {
  const state = normalizePostTradeReviewState(account.postTradeReview, defaultDirectionWeights, account.sessionId);
  const review = state.latestReview;
  if (!review?.promotionEligible || !review?.candidateDirectionWeights) {
    throw new Error("当前没有通过样本外验证、可晋升的候选权重");
  }
  state.previousDirectionWeights = state.currentDirectionWeights;
  state.currentDirectionWeights = normalizeDirectionWeights(review.candidateDirectionWeights, state.currentDirectionWeights);
  state.weightVersion += 1;
  state.lastPromotionAt = now;
  review.status = "promoted";
  review.applied = true;
  account.postTradeReview = state;
  return account;
}

export function rollbackPostTradeReviewWeights(account, defaultDirectionWeights, now = new Date().toISOString()) {
  const state = normalizePostTradeReviewState(account.postTradeReview, defaultDirectionWeights, account.sessionId);
  if (!state.previousDirectionWeights) throw new Error("当前没有可回滚的上一版权重");
  const current = state.currentDirectionWeights;
  state.currentDirectionWeights = state.previousDirectionWeights;
  state.previousDirectionWeights = current;
  state.weightVersion += 1;
  state.lastRollbackAt = now;
  account.postTradeReview = state;
  return account;
}
