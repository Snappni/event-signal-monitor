#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildPolymarketPriceSentiment,
  extractBinaryMarketProbabilities,
  isCryptoPolymarketMarket,
  isRoutineExchangeProductAnnouncement,
  updatePredictionMarketTracking
} from "./event-source-rules.mjs";

assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "Binance",
    title: "币安合约将推出多资产模式下 ABCUSDT U本位永续合约"
  }),
  true
);

const genericBinary = extractBinaryMarketProbabilities({
  outcomes: ["Yes", "No"],
  outcomePrices: ["0.63", "0.37"]
});
assert.deepEqual(genericBinary.labels, ["Yes", "No"]);
assert.deepEqual(genericBinary.probabilities, [0.63, 0.37]);
assert.ok(Math.abs(genericBinary.ratio - 0.63 / 0.37) < 1e-12);

const trackedOpen = updatePredictionMarketTracking(
  {},
  {
    id: "market-1",
    title: "Will Bitcoin be above $100,000?",
    active: true,
    closed: false,
    yesProbability: 0.63,
    noProbability: 0.37,
    volume: 1000,
    liquidity: 500
  },
  "2026-07-16T10:00:00Z"
);
const trackedClosed = updatePredictionMarketTracking(
  trackedOpen,
  {
    id: "market-1",
    closed: true,
    yesProbability: 1,
    noProbability: 0,
    volume: 1500,
    liquidity: 0
  },
  "2026-07-16T11:00:00Z"
);
assert.equal(trackedOpen.status, "tracking");
assert.equal(trackedOpen.observations, 1);
assert.equal(trackedClosed.status, "closed");
assert.equal(trackedClosed.observations, 2);
assert.equal(trackedClosed.history.length, 2);
assert.equal(trackedClosed.hourlyHistory.length, 2);
assert.equal(trackedClosed.dailyHistory.length, 1);
assert.equal(trackedClosed.closedAt, "2026-07-16T11:00:00.000Z");
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "Binance",
    title: "Binance Exchange Adds bStocks Tokenized Securities SK Hynix (SKHYB) on Binance Spot"
  }),
  true
);
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "Binance",
    title: "Binance Margin Will Add New Pairs"
  }),
  true
);
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "Binance",
    title: "Notice on New Trading Pairs & Trading Bots Services on Binance Spot"
  }),
  true
);
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "Binance",
    title: "Binance Futures Will Launch USDⓈ-Margined ABCUSDT Perpetual Contract"
  }),
  true
);
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "OKX",
    title: "OKX will list ABC spot trading pair"
  }),
  true
);
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "Binance",
    title: "币安将下架 ABCUSDT 永续合约"
  }),
  false,
  "下架公告具有存量风险，不应按例行上新过滤"
);
assert.equal(
  isRoutineExchangeProductAnnouncement({
    source: "OKX",
    title: "Security incident notice: deposits are suspended"
  }),
  false,
  "安全和暂停公告必须保留"
);
assert.equal(isCryptoPolymarketMarket({ question: "Will Bitcoin be above $100,000?" }), true);
assert.equal(
  isCryptoPolymarketMarket({ question: "Will Gedion Timothewos be the next Prime Minister of Ethiopia?" }),
  false,
  "ETH 代号不能误命中 Ethiopia 等普通英文单词"
);

const above = buildPolymarketPriceSentiment(
  {
    question: "Will Bitcoin be above $100,000 on July 31?",
    outcomes: JSON.stringify(["Yes", "No"]),
    outcomePrices: JSON.stringify(["0.68", "0.32"]),
    volume24hr: "1000000"
  },
  { bullProbability: 0.6 }
);
assert.ok(above);
assert.equal(above.symbol, "BTCUSDT");
assert.equal(above.orientation, "bullish-yes");
assert.equal(above.bullProbability, 0.68);
assert.equal(above.bearProbability, 0.32);
assert.ok(Math.abs(above.bullBearRatio - 2.125) < 1e-12);
assert.ok(Math.abs(above.bullProbabilityDelta - 0.08) < 1e-12);
assert.equal(above.direction, 1);

const below = buildPolymarketPriceSentiment(
  {
    question: "Will Ethereum be below $2,000 on July 31?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.7, 0.3],
    volume24hr: 500000
  },
  { bullProbability: 0.4 }
);
assert.ok(below);
assert.equal(below.symbol, "ETHUSDT");
assert.equal(below.orientation, "bearish-yes");
assert.ok(Math.abs(below.bullProbability - 0.3) < 1e-12);
assert.ok(Math.abs(below.bearProbability - 0.7) < 1e-12);
assert.equal(below.direction, -1);

assert.equal(
  buildPolymarketPriceSentiment({
    question: "Will a Bitcoin ETF be approved this year?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.6, 0.4]
  }),
  null,
  "非价格阈值市场不能被解释成价格多空比"
);
assert.equal(
  buildPolymarketPriceSentiment({
    question: "What price will Bitcoin reach?",
    outcomes: ["$80k", "$100k", "$120k"],
    outcomePrices: [0.2, 0.5, 0.3]
  }),
  null,
  "多选市场不能套用二元 Yes/No 方向"
);

console.log("event source rules tests passed");
