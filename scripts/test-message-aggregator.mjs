import assert from "node:assert/strict";
import {
  BUILT_IN_RSS_FEEDS,
  BUILT_IN_TREND_SOURCES,
  normalizeMessageAggregatorConfig,
  parseNewsNowPayload,
  parseRssXml
} from "./message-aggregator.mjs";

const config = normalizeMessageAggregatorConfig({
  enabled: true,
  rssFeedsText: "Macro|https://example.com/rss.xml",
  dailyHotBaseUrl: "http://127.0.0.1:6688/",
  dailyHotRoutes: "weibo,thepaper",
  filterKeywords: "bitcoin,比特币,美联储",
  maxItemsPerSource: 10
});

assert.equal(config.rssFeeds.length, BUILT_IN_RSS_FEEDS.length);
assert.equal(config.trendSources.length, BUILT_IN_TREND_SOURCES.length);
assert.equal(config.rssFeeds.some((feed) => feed.url === "https://example.com/rss.xml"), false);

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Macro</title>
  <item><guid>1</guid><title>Bitcoin ETF approved</title><link>https://example.com/1</link><description><![CDATA[Bitcoin market update]]></description><pubDate>Thu, 16 Jul 2026 08:00:00 GMT</pubDate></item>
  <item><guid>2</guid><title>Unrelated sports result</title><link>https://example.com/2</link></item>
</channel></rss>`;
const rssItems = parseRssXml(rss, { name: "Macro", url: "https://example.com/rss.xml" }, config);
assert.equal(rssItems.length, 1);
assert.equal(rssItems[0].provider, "Built-in RSS");
assert.equal(rssItems[0].title, "Bitcoin ETF approved");
assert.equal(rssItems[0].occurredAt, "2026-07-16T08:00:00.000Z");

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Policy</title>
  <entry><id>a1</id><title>美联储宣布利率决定</title><link rel="alternate" href="https://example.com/a1"/><summary>市场政策更新</summary><updated>2026-07-16T09:00:00Z</updated></entry>
</feed>`;
const atomItems = parseRssXml(atom, { name: "Policy", url: "https://example.com/atom" }, config);
assert.equal(atomItems.length, 1);
assert.equal(atomItems[0].url, "https://example.com/a1");

const trendItems = parseNewsNowPayload(
  {
    status: "cache",
    updatedTime: Date.parse("2026-07-16T10:00:00Z"),
    items: [
      { id: "1", title: "比特币突破关键价位", url: "https://example.com/hot/1", extra: { hover: "市场成交量扩大" } },
      { id: "2", title: "娱乐节目更新", url: "https://example.com/hot/2" }
    ]
  },
  { id: "baidu", name: "百度热搜", maxItems: 20 },
  config
);
assert.equal(trendItems.length, 1);
assert.equal(trendItems[0].provider, "NewsNow");
assert.equal(trendItems[0].rank, 1);
assert.equal(trendItems[0].occurredAt, "2026-07-16T10:00:00.000Z");

const lockedConfig = normalizeMessageAggregatorConfig({
  rssFeedsText: "Injected|https://attacker.invalid/feed",
  dailyHotBaseUrl: "http://127.0.0.1:6688",
  dailyHotRoutes: "weibo"
});
assert.deepEqual(lockedConfig.rssFeeds, BUILT_IN_RSS_FEEDS);
assert.deepEqual(lockedConfig.trendSources, BUILT_IN_TREND_SOURCES);
assert.equal("dailyHotBaseUrl" in lockedConfig, false);
assert.equal("dailyHotRoutes" in lockedConfig, false);

console.log("Message aggregator parser self-test passed.");
