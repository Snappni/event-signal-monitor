import assert from "node:assert/strict";
import {
  clusterMessageItems,
  inferSourceTier,
  updateTrendHistory
} from "./news-intelligence.mjs";

const firstRun = updateTrendHistory(
  [
    {
      provider: "NewsNow",
      source: "NewsNow:baidu",
      title: "比特币突破十万美元",
      url: "https://example.com/1",
      rank: 8,
      metrics: { rank: 8 }
    }
  ],
  {},
  Date.parse("2026-07-16T10:00:00Z")
);
const secondRun = updateTrendHistory(
  [{ ...firstRun.items[0], rank: 3, metrics: { rank: 3 } }],
  firstRun.history,
  Date.parse("2026-07-16T10:05:00Z")
);
assert.equal(secondRun.items[0].metrics.previousRank, 8);
assert.equal(secondRun.items[0].metrics.rankDelta, 5);
assert.equal(secondRun.items[0].metrics.observations, 2);
assert.ok(secondRun.items[0].trendScore > firstRun.items[0].trendScore);

const clustered = clusterMessageItems([
  {
    type: "news",
    provider: "NewsNow",
    source: "NewsNow:weibo",
    title: "比特币突破十万美元引发市场关注",
    text: "比特币突破十万美元引发市场关注",
    url: "https://social.example/1",
    metrics: { fetchLatencyMs: 100 }
  },
  {
    type: "news",
    provider: "Built-in RSS",
    source: "RSS:CNBC Markets",
    title: "比特币突破十万美元，市场高度关注",
    text: "比特币突破十万美元，市场高度关注",
    url: "https://news.example/1",
    metrics: { fetchLatencyMs: 500 }
  },
  {
    type: "prediction",
    provider: "Polymarket",
    source: "Polymarket",
    title: "Will Bitcoin be above $100,000?",
    url: "https://polymarket.example/1"
  }
]);
assert.equal(clustered.stats.inputCount, 3);
assert.equal(clustered.stats.outputCount, 2);
assert.equal(clustered.stats.suppressedDuplicates, 1);
assert.equal(clustered.items[0].source, "RSS:CNBC Markets");
assert.equal(clustered.items[0].corroborationCount, 2);
assert.equal(inferSourceTier(clustered.items[0]), 2);

console.log("News intelligence self-test passed.");
