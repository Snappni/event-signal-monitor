import assert from "node:assert/strict";
import { createMarketMicrostructure } from "./market-microstructure.mjs";

const now = Date.parse("2026-07-21T00:00:30.000Z");
const flow = createMarketMicrostructure({ retentionMs: 30_000, tradeStaleMs: 5_000, bookStaleMs: 2_000 });

flow.updateTrade({ symbol: "BTCUSDT", price: 100, quantity: 2, buyerIsMaker: false, time: now - 1_000 });
flow.updateTrade({ symbol: "BTCUSDT", price: 100, quantity: 1, buyerIsMaker: true, time: now - 500 });
flow.updateTrade({ symbol: "BTCUSDT", price: 50, quantity: 10, buyerIsMaker: false, time: now - 31_000 });
flow.updateBook({
  symbol: "BTCUSDT",
  time: now - 200,
  bids: [[99, 4], [98, 2]],
  asks: [[101, 1], [102, 1]]
});
flow.updateBook({
  symbol: "BTCUSDT",
  time: now - 100,
  bids: [[99, 6], [98, 2]],
  asks: [[101, 0.5], [102, 1]]
});

const snapshot = flow.snapshot("BTCUSDT", now);
assert.equal(snapshot.available, true);
assert.equal(snapshot.tradeAvailable, true);
assert.equal(snapshot.bookAvailable, true);
assert.equal(snapshot.flow5s.buyQuoteVolume, 200);
assert.equal(snapshot.flow5s.sellQuoteVolume, 100);
assert.equal(snapshot.retainedTradeEvents, 2, "expired trades must be pruned from memory");
assert.ok(snapshot.cumulativeVolumeDelta30s > 0);
assert.ok(snapshot.orderBookImbalance > 0);
assert.ok(snapshot.bookFlow5s.imbalance > 0, "bid additions and ask cancellations must be bullish book flow");
assert.ok(snapshot.microPriceBiasBps > 0);
assert.ok(snapshot.signal > 0);
assert.equal(snapshot.tradeConfidence, 0.1);

const stale = flow.snapshot("BTCUSDT", now + 10_000);
assert.equal(stale.available, false, "stale order-flow data must not affect decisions");
assert.equal(stale.signal, 0);

const quoteOnly = createMarketMicrostructure();
quoteOnly.updateTopQuote({
  symbol: "ETHUSDT",
  bid: 1999,
  bidQuantity: 10,
  ask: 2001,
  askQuantity: 2,
  time: now
});
const quoteSnapshot = quoteOnly.snapshot("ETHUSDT", now);
assert.equal(quoteSnapshot.bookAvailable, true);
assert.ok(quoteSnapshot.orderBookImbalance > 0);
assert.ok(quoteSnapshot.microPrice > quoteSnapshot.midPrice);

console.log("market microstructure tests passed");
