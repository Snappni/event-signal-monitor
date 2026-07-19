import assert from "node:assert/strict";
import {
  buildPostTradeReview,
  createPostTradeReviewState,
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  maybeRunPostTradeReview,
  normalizeDirectionWeights,
  normalizePostTradeReviewConfig
} from "./post-trade-review.mjs";

function syntheticTrade(index, won = index % 3 !== 0) {
  const label = won ? 1 : -1;
  const directionSignals = {
    trend: label,
    higherTimeframeTrend: label * 0.7,
    momentum: -label,
    rsi: 0,
    funding: label * 0.15,
    openInterest: label * 0.25,
    geometricBrownianMotion: label * 0.5,
    hiddenMarkovModel: label * 0.8
  };
  return {
    id: `trade-${index}`,
    signalId: `signal-${index}`,
    status: "closed",
    symbol: index % 2 ? "BTCUSDT" : "ETHUSDT",
    side: "long",
    openedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    closedAt: new Date(Date.UTC(2026, 0, 1, index + 1)).toISOString(),
    closeReason: won ? "TP" : "SL",
    realizedPnl: won ? 120 : -100,
    grossTradingPnl: won ? 125 : -95,
    maxLossAmount: 100,
    factorSnapshot: {
      modelVersion: "test",
      weightVersion: 1,
      regime: index % 2 ? "trend" : "range",
      directionSignals
    },
    exitFactorSnapshot: {
      threshold: 0.68,
      signals: {
        signalReversal: 0.1,
        netExpectancyDecay: won ? 0.2 : 0.05,
        eventDecay: won ? 0.05 : 0.2,
        timeDecay: won ? 0.1 : 0.15,
        capitalEfficiency: 0,
        profitProtection: won ? 0.75 : 0.15
      }
    },
    exitCounterfactual: {
      status: "evaluated",
      evaluatedAt: new Date(Date.UTC(2026, 0, 1, index + 5)).toISOString(),
      beneficial: won,
      avoidedReturnPct: won ? 0.02 : -0.01
    },
    relatedEvents: []
  };
}

const bounded = normalizePostTradeReviewConfig({ reviewEveryTrades: 1, maxWeightChangePct: 1 });
assert.equal(bounded.reviewEveryTrades, 5);
assert.equal(bounded.maxWeightChangePct, 0.1);

const normalizedWeights = normalizeDirectionWeights({ trend: 10 }, DEFAULT_DIRECTION_MODEL_WEIGHTS);
const normalizedTotal = Object.values(normalizedWeights).reduce((sum, value) => sum + value, 0);
assert.ok(Math.abs(normalizedTotal - 1) < 1e-9);

const legacy = {
  id: "legacy",
  status: "closed",
  realizedPnl: 10,
  maxLossAmount: 10,
  side: "long"
};
const insufficient = buildPostTradeReview(
  [legacy, ...Array.from({ length: 10 }, (_, index) => syntheticTrade(index))],
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  { reviewEveryTrades: 5 }
);
assert.equal(insufficient.status, "insufficient_data");
assert.equal(insufficient.excludedTrades, 1);
assert.deepEqual(insufficient.promotionBlockers, ["minimum_proposal_trades"]);

const review = buildPostTradeReview(
  Array.from({ length: 40 }, (_, index) => syntheticTrade(index)),
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  { reviewEveryTrades: 10, minimumProposalTrades: 20 }
);
assert.equal(review.status, "shadow_candidate");
assert.ok(review.candidateDirectionWeights);
assert.ok(review.candidateExitWeights);
assert.equal(review.exitValidation.chronologicalSplit, true);
assert.ok(review.exitFactorStatistics.some((item) => item.candidateWeight !== item.currentWeight));
assert.ok(review.exitFactorStatistics.some((item) => item.factor === "profitProtection" && item.activeSamples > 0));
assert.ok(review.candidateDirectionWeights.trend > review.currentDirectionWeights.trend);
assert.ok(review.candidateDirectionWeights.momentum < review.currentDirectionWeights.momentum);
assert.equal(review.validation.chronologicalSplit, true);
assert.ok(review.promotionBlockers.includes("minimum_promotion_trades"));

const rotationExitDecision = {
  ...syntheticTrade(100, true),
  id: "rotation-exit-100",
  status: "exit_decision"
};
const reviewWithRotation = buildPostTradeReview(
  Array.from({ length: 40 }, (_, index) => syntheticTrade(index)),
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  { reviewEveryTrades: 10, minimumProposalTrades: 20 },
  { exitDecisionTrades: [rotationExitDecision] }
);
assert.equal(reviewWithRotation.exitEligibleTrades, 41, "capital-rotation exits must train the exit model");

const account = {
  sessionId: "session-test",
  tradeHistory: Array.from({ length: 5 }, (_, index) => syntheticTrade(index)),
  postTradeReviewConfig: { reviewEveryTrades: 5 },
  postTradeReview: createPostTradeReviewState(DEFAULT_DIRECTION_MODEL_WEIGHTS, "session-test")
};
const firstRun = maybeRunPostTradeReview(account, DEFAULT_DIRECTION_MODEL_WEIGHTS, "2026-01-02T00:00:00.000Z");
assert.ok(firstRun.review);
assert.equal(account.postTradeReview.reviewedTradeCount, 5);
const secondRun = maybeRunPostTradeReview(account, DEFAULT_DIRECTION_MODEL_WEIGHTS, "2026-01-02T00:01:00.000Z");
assert.equal(secondRun.review, null);

const cappedAccount = {
  sessionId: "session-capped",
  lifetimeClosedTrades: 520,
  tradeHistory: Array.from({ length: 500 }, (_, index) => syntheticTrade(index)),
  postTradeReviewConfig: { reviewEveryTrades: 20 },
  postTradeReview: {
    ...createPostTradeReviewState(DEFAULT_DIRECTION_MODEL_WEIGHTS, "session-capped"),
    reviewedTradeCount: 500
  }
};
const cappedRun = maybeRunPostTradeReview(
  cappedAccount,
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  "2026-01-03T00:00:00.000Z"
);
assert.ok(cappedRun.review, "lifetime count must keep reviews running after retained history reaches 500");
assert.equal(cappedRun.review.totalClosedTrades, 520);
assert.equal(cappedRun.review.retainedClosedTrades, 500);
assert.equal(cappedAccount.postTradeReview.reviewedTradeCount, 520);

const archivedTrades = Array.from({ length: 20 }, (_, index) => syntheticTrade(index));
const archivedAccount = {
  sessionId: "session-archive",
  lifetimeClosedTrades: 0,
  tradeHistory: [],
  postTradeReviewConfig: { reviewEveryTrades: 20 },
  postTradeReview: createPostTradeReviewState(DEFAULT_DIRECTION_MODEL_WEIGHTS, "session-archive")
};
const archivedRun = maybeRunPostTradeReview(
  archivedAccount,
  DEFAULT_DIRECTION_MODEL_WEIGHTS,
  "2026-01-04T00:00:00.000Z",
  { trades: archivedTrades, totalClosedTrades: archivedTrades.length }
);
assert.ok(archivedRun.review, "archived trades must trigger model review when recent account history is empty");
assert.equal(archivedRun.review.retainedClosedTrades, 20);
assert.equal(archivedAccount.postTradeReview.reviewedTradeCount, 20);

console.log("post-trade-review tests passed");
