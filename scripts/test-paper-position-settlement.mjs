import assert from "node:assert/strict";
import { closePaperPosition } from "./paper-position-settlement.mjs";

const account = {
  sessionId: "session-test",
  startingCapital: 10_000,
  realizedPnl: 0,
  tradingFees: 0,
  slippageCost: 0,
  lifetimeClosedTrades: 0,
  lifetimeWinningTrades: 0,
  tradeHistory: [],
  positions: {
    "paper-test": {
      id: "paper-test",
      status: "open",
      symbol: "BTCUSDT",
      side: "long",
      entry: 100,
      quantity: 1,
      feeRate: 0.0005,
      slippageRate: 0.0003,
      entryFee: 0.05,
      entrySlippageCost: 0.03,
      exitFee: 0,
      exitSlippageCost: 0,
      fundingPnl: 0,
      initialQuantity: 1,
      initialNotional: 100,
      initialMarginRequired: 33.333,
      maxLossAmount: 10,
      initialMaxLossAmount: 10,
      takeProfit: 105,
      stopLoss: 98,
      factorSnapshot: {
        modelVersion: "test",
        directionSignals: { trend: 0.5 }
      },
      decisionCalculation: {
        direction: {
          combinedDirection: 0.5,
          eventDirection: 0.2,
          eventWeight: 0.3,
          mathDirection: 0.6,
          mathWeight: 0.7
        },
        oversized: "x".repeat(100_000)
      },
      holdingObservations: Array.from({ length: 10_000 }, (_, index) => ({
        time: new Date(1_700_000_000_000 + index).toISOString(),
        price: 100
      })),
      exitEvaluation: null,
      relatedEvents: []
    }
  }
};

const closed = closePaperPosition(
  account,
  "paper-test",
  101,
  "TP",
  "2026-07-29T00:00:00.000Z"
);

assert.ok(closed);
assert.equal(account.tradeHistorySchemaVersion, 2);
assert.equal(account.tradeHistory.length, 1);
assert.equal(Object.hasOwn(account.tradeHistory[0], "holdingObservations"), false);
assert.equal(account.tradeHistory[0].holdingObservationCount, 10_000);
assert.equal(
  account.tradeHistory[0].decisionCalculation.direction.combinedDirection,
  0.5
);
assert.equal(
  Object.hasOwn(account.tradeHistory[0].decisionCalculation, "oversized"),
  false
);
console.log("paper position settlement compaction test passed");
