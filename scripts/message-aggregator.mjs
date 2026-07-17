import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export const DEFAULT_MESSAGE_KEYWORDS = [
  "bitcoin",
  "btc",
  "ethereum",
  "eth",
  "crypto",
  "cryptocurrency",
  "blockchain",
  "stablecoin",
  "usdt",
  "usdc",
  "binance",
  "okx",
  "coinbase",
  "solana",
  "xrp",
  "doge",
  "etf",
  "sec",
  "fed",
  "fomc",
  "cpi",
  "pce",
  "interest rate",
  "inflation",
  "tariff",
  "sanction",
  "war",
  "conflict",
  "election",
  "president",
  "treasury",
  "dollar",
  "gold",
  "oil",
  "stock market",
  "比特币",
  "以太坊",
  "加密货币",
  "数字货币",
  "虚拟货币",
  "区块链",
  "稳定币",
  "币安",
  "欧易",
  "交易所",
  "美联储",
  "利率",
  "降息",
  "加息",
  "通胀",
  "关税",
  "制裁",
  "战争",
  "冲突",
  "选举",
  "总统",
  "财政部",
  "美元",
  "黄金",
  "原油",
  "股市",
  "金融监管"
];

export const BUILT_IN_RSS_FEEDS = Object.freeze(
  [
    ["Cointelegraph", "https://cointelegraph.com/rss"],
    ["Decrypt", "https://decrypt.co/feed"],
    ["Bitcoin Magazine", "https://bitcoinmagazine.com/.rss/full/"],
    ["Federal Reserve Monetary Policy", "https://www.federalreserve.gov/feeds/press_monetary.xml"],
    ["SEC Press Releases", "https://www.sec.gov/news/pressreleases.rss"],
    ["ECB Press Releases", "https://www.ecb.europa.eu/rss/press.html"],
    ["CFTC General", "https://www.cftc.gov/RSS/RSSGP/rssgp.xml"],
    ["CFTC Enforcement", "https://www.cftc.gov/RSS/RSSENF/rssenf.xml"],
    ["NPR World", "https://feeds.npr.org/1004/rss.xml"],
    ["CNBC Markets", "https://www.cnbc.com/id/10000664/device/rss/rss.html"],
    ["CNBC World", "https://www.cnbc.com/id/100727362/device/rss/rss.html"],
    ["CNBC Economy", "https://www.cnbc.com/id/20910258/device/rss/rss.html"]
  ]
    .filter(([name]) => process.env.MESSAGE_CFTC_ENABLED !== "false" || !name.startsWith("CFTC "))
    .map(([name, url]) => Object.freeze({ name, url }))
);

const NEWSNOW_API_BASE = "https://newsnow.busiyi.world/api/s";

export const BUILT_IN_TREND_SOURCES = Object.freeze(
  [
    ["wallstreetcn-hot", "华尔街见闻热榜", 10],
    ["wallstreetcn", "华尔街见闻快讯", 20],
    ["fastbull", "FastBull 快讯", 20],
    ["mktnews", "MKTNews 市场快讯", 20],
    ["xueqiu", "雪球热榜", 20],
    ["weibo", "微博热搜", 20],
    ["baidu", "百度热搜", 20]
  ].map(([id, name, maxItems]) =>
    Object.freeze({
      id,
      name,
      maxItems,
      url: `${NEWSNOW_API_BASE}?id=${encodeURIComponent(id)}&latest`
    })
  )
);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[;,\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizeMessageAggregatorConfig(value = {}) {
  const requestedKeywords = splitList(value.filterKeywords);
  const hasCorruptedKeywords = requestedKeywords.some((keyword) => /^[?\uFFFD]+$/u.test(keyword));
  const validKeywords = requestedKeywords.filter((keyword) => !/^[?\uFFFD]+$/u.test(keyword));
  const repairedKeywords = hasCorruptedKeywords
    ? [...new Set([
        ...validKeywords,
        ...DEFAULT_MESSAGE_KEYWORDS.filter((keyword) => /[\u3400-\u9fff]/u.test(keyword))
      ])]
    : validKeywords;

  return {
    enabled: value.enabled !== false && String(value.enabled).toLowerCase() !== "false",
    rssFeeds: BUILT_IN_RSS_FEEDS.map((feed) => ({ ...feed })),
    trendSources: BUILT_IN_TREND_SOURCES.map((source) => ({ ...source })),
    filterKeywords: repairedKeywords.length
      ? repairedKeywords.slice(0, 120)
      : DEFAULT_MESSAGE_KEYWORDS,
    maxItemsPerSource: clampInteger(value.maxItemsPerSource, 1, 50, 15),
    updatedAt: value.updatedAt || null
  };
}

function nodeText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(nodeText).filter(Boolean).join(" ");
  if (typeof value === "object") return nodeText(value["#text"] ?? value.value ?? value.content ?? "");
  return "";
}

function linkUrl(value) {
  if (Array.isArray(value)) {
    const preferred = value.find((item) => item?.rel === "alternate") || value[0];
    return linkUrl(preferred);
  }
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.href || value.url || value["#text"] || "").trim();
  return "";
}

function normalizeTimestamp(value) {
  const text = nodeText(value);
  if (!text) return null;
  const timestamp = new Date(text);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function stableId(parts) {
  return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 24);
}

function normalizeEventText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesMessageKeywords(item, keywords) {
  const normalizedKeywords = splitList(keywords).map((keyword) => keyword.toLocaleLowerCase());
  if (!normalizedKeywords.length) return true;
  const haystack = `${item?.title || ""} ${item?.text || ""}`.toLocaleLowerCase();
  return normalizedKeywords.some((keyword) => {
    if (/^[a-z0-9]{1,3}$/i.test(keyword)) {
      return new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(
        haystack
      );
    }
    return haystack.includes(keyword);
  });
}

export function parseRssXml(xml, feed, config) {
  const parsed = xmlParser.parse(String(xml || ""));
  const channel = parsed?.rss?.channel || parsed?.channel;
  const atom = parsed?.feed;
  const rdf = parsed?.RDF;
  const rows = asArray(channel?.item || atom?.entry || rdf?.item);
  if (!rows.length) throw new Error("RSS/Atom 响应中没有 item 或 entry");
  const receivedAt = new Date().toISOString();
  return rows
    .map((row) => {
      const title = normalizeEventText(nodeText(row?.title));
      const text = normalizeEventText(
        nodeText(row?.description || row?.summary || row?.content || row?.encoded || row?.subtitle || title)
      );
      const url = linkUrl(row?.link) || linkUrl(row?.guid);
      const occurredAt = normalizeTimestamp(row?.pubDate || row?.published || row?.updated || row?.date);
      const externalId = nodeText(row?.guid || row?.id);
      return {
        id: stableId(["rss", feed.name, externalId, url, title]),
        type: "news",
        provider: "Built-in RSS",
        source: `RSS:${feed.name}`,
        title,
        text: text || title,
        url,
        occurredAt,
        receivedAt,
        metrics: {},
        raw: row
      };
    })
    .filter((item) => item.title && matchesMessageKeywords(item, config.filterKeywords))
    .slice(0, config.maxItemsPerSource);
}

export function parseNewsNowPayload(payload, source, config) {
  if (!payload || !["success", "cache"].includes(payload.status) || !Array.isArray(payload.items)) {
    throw new Error("NewsNow 响应格式无效");
  }
  const receivedAt = new Date().toISOString();
  const occurredAt = Number.isFinite(Number(payload.updatedTime))
    ? new Date(Number(payload.updatedTime)).toISOString()
    : null;
  const maxItems = Math.min(source.maxItems || config.maxItemsPerSource, config.maxItemsPerSource * 2);
  return payload.items
    .map((row, index) => {
      const title = normalizeEventText(row?.title);
      const description = normalizeEventText(
        row?.extra?.hover || row?.description || row?.summary || row?.digest || ""
      );
      const url = String(row?.url || row?.mobileUrl || row?.id || "").trim();
      return {
        id: stableId(["newsnow", source.id, row?.id, url, title]),
        type: "news",
        provider: "NewsNow",
        source: `NewsNow:${source.id}`,
        sourceName: source.name,
        title,
        text: description ? `${title} ${description}` : title,
        url,
        occurredAt,
        receivedAt,
        rank: index + 1,
        metrics: {
          platformId: source.id,
          platformName: source.name,
          rank: index + 1,
          upstreamStatus: payload.status
        },
        raw: row
      };
    })
    .filter((item) => item.title && matchesMessageKeywords(item, config.filterKeywords))
    .slice(0, maxItems);
}
