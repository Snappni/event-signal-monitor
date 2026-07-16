import { createHash } from "node:crypto";

const SOURCE_TIER_PATTERNS = [
  {
    tier: 1,
    pattern: /FEDERAL RESERVE|SEC PRESS|ECB PRESS|CFTC |BINANCE|OKX/i
  },
  {
    tier: 2,
    pattern: /NPR WORLD|CNBC |GDELT|WALLSTREETCN/i
  },
  {
    tier: 3,
    pattern: /COINTELEGRAPH|DECRYPT|BITCOIN MAGAZINE|FASTBULL|MKTNEWS|XUEQIU/i
  }
];

const SOURCE_WEIGHTS = Object.freeze({ 1: 1.15, 2: 1.03, 3: 0.92, 4: 0.8 });
const STORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TREND_RECORDS = 4_000;

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/(?:\s*[-|｜:]\s*)?(?:reuters|ap news|bbc|cnbc|cointelegraph|decrypt)$/iu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storyKey(item) {
  const identity = normalizedText(item?.title) || String(item?.url || item?.id || "");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

function sourceIdentity(item) {
  return String(item?.source || item?.provider || "unknown");
}

function titleTokens(value) {
  const normalized = normalizedText(value);
  const tokens = new Set(normalized.match(/[a-z0-9]{2,}/g) || []);
  const han = [...normalized].filter((character) => /\p{Script=Han}/u.test(character));
  for (let index = 0; index < han.length - 1; index += 1) {
    tokens.add(`${han[index]}${han[index + 1]}`);
  }
  return tokens;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function titleSimilarity(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 12 && longer.includes(shorter)) return 0.86;
  return jaccard(titleTokens(a), titleTokens(b));
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function representativeOrder(item) {
  return [
    inferSourceTier(item),
    Math.max(0, finiteNumber(item?.metrics?.fetchLatencyMs, 60_000)),
    item?.url ? 0 : 1,
    -String(item?.text || item?.title || "").length
  ];
}

function compareRepresentative(left, right) {
  const a = representativeOrder(left);
  const b = representativeOrder(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function inferSourceTier(item) {
  const source = `${item?.source || ""} ${item?.sourceName || ""} ${item?.provider || ""}`;
  const match = SOURCE_TIER_PATTERNS.find((entry) => entry.pattern.test(source));
  return match?.tier || 4;
}

export function sourceWeightForTier(tier) {
  return SOURCE_WEIGHTS[tier] || SOURCE_WEIGHTS[4];
}

function parsedTimestamp(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return null;
  const milliseconds = parsed > 0 && parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function freshnessProfile(item) {
  const source = `${item?.source || ""} ${item?.provider || ""}`.toUpperCase();
  if (item?.type === "prediction" || source.includes("POLYMARKET")) {
    return { halfLifeHours: 0.5, graceHours: 5 / 60 };
  }
  if (source.includes("WHALEALERT")) return { halfLifeHours: 2, graceHours: 10 / 60 };
  if (source.includes("NEWSNOW")) return { halfLifeHours: 4, graceHours: 0.25 };
  if (/BINANCE|OKX/.test(source)) return { halfLifeHours: 12, graceHours: 0.5 };
  if (inferSourceTier(item) === 1) return { halfLifeHours: 72, graceHours: 1 };
  return { halfLifeHours: 24, graceHours: 0.5 };
}

function freshnessLevel(ageMinutes) {
  if (ageMinutes <= 5) return "live";
  if (ageMinutes <= 30) return "fresh";
  if (ageMinutes <= 120) return "recent";
  if (ageMinutes <= 1_440) return "today";
  if (ageMinutes <= 4_320) return "aging";
  return "stale";
}

export function analyzeEventFreshness(item, now = Date.now()) {
  const receivedAtMs = parsedTimestamp(item?.receivedAt);
  const occurredAtCandidate = parsedTimestamp(item?.occurredAt);
  const futureToleranceMs = 5 * 60 * 1_000;
  const occurredAtMs = occurredAtCandidate != null && occurredAtCandidate <= now + futureToleranceMs
    ? occurredAtCandidate
    : null;
  const usableReceivedAtMs = receivedAtMs != null && receivedAtMs <= now + futureToleranceMs ? receivedAtMs : null;
  const effectiveAtMs = occurredAtMs ?? usableReceivedAtMs;
  const hasClockSkew = occurredAtCandidate != null && occurredAtMs == null;

  if (effectiveAtMs == null) {
    return {
      effectiveAt: null,
      timestampBasis: "unknown",
      ageMinutes: null,
      level: "unknown",
      freshnessWeight: 0.55,
      halfLifeHours: null,
      timestampConfidence: 0.4,
      hasClockSkew
    };
  }

  const { halfLifeHours, graceHours } = freshnessProfile(item);
  const ageHours = Math.max(0, now - effectiveAtMs) / (60 * 60 * 1_000);
  const decayingAgeHours = Math.max(0, ageHours - graceHours);
  const freshnessWeight = Math.max(0.15, Math.min(1, Math.exp((-Math.LN2 * decayingAgeHours) / halfLifeHours)));
  const ageMinutes = ageHours * 60;
  const timestampBasis = occurredAtMs != null ? "occurredAt" : "receivedAt";

  return {
    effectiveAt: new Date(effectiveAtMs).toISOString(),
    timestampBasis,
    ageMinutes: Number(ageMinutes.toFixed(1)),
    level: freshnessLevel(ageMinutes),
    freshnessWeight: Number(freshnessWeight.toFixed(4)),
    halfLifeHours,
    timestampConfidence: timestampBasis === "occurredAt" ? 1 : 0.8,
    hasClockSkew
  };
}

export function updateTrendHistory(items, history = {}, now = Date.now()) {
  const nextHistory = { ...(history && typeof history === "object" ? history : {}) };
  const enrichedItems = items.map((item) => {
    if (item.provider !== "NewsNow" || !Number.isFinite(Number(item.rank))) return item;
    const key = `${sourceIdentity(item)}:${storyKey(item)}`;
    const previous = nextHistory[key] || null;
    const rank = Math.max(1, Math.floor(Number(item.rank)));
    const previousRank = Number.isFinite(Number(previous?.rank)) ? Number(previous.rank) : null;
    const observations = Math.max(1, finiteNumber(previous?.observations) + 1);
    const rankDelta = previousRank === null ? 0 : previousRank - rank;
    const bestRank = Math.min(rank, finiteNumber(previous?.bestRank, rank));
    const rankScore = 1 / Math.sqrt(rank);
    const frequencyScore = Math.min(1, observations / 8);
    const momentumScore = Math.max(-1, Math.min(1, rankDelta / 10));
    const hotnessScore = Math.max(
      0,
      Math.min(1, rankScore * 0.55 + frequencyScore * 0.25 + Math.max(0, momentumScore) * 0.2)
    );
    const record = {
      source: sourceIdentity(item),
      title: item.title,
      rank,
      previousRank,
      rankDelta,
      bestRank,
      observations,
      firstSeenAt: previous?.firstSeenAt || new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString()
    };
    nextHistory[key] = record;
    return {
      ...item,
      trendScore: hotnessScore,
      metrics: {
        ...(item.metrics || {}),
        previousRank,
        rankDelta,
        bestRank,
        observations,
        firstSeenAt: record.firstSeenAt,
        hotnessScore
      }
    };
  });

  const retained = Object.entries(nextHistory)
    .filter(([, value]) => now - Date.parse(value?.lastSeenAt || 0) <= STORY_RETENTION_MS)
    .sort((left, right) => Date.parse(right[1]?.lastSeenAt || 0) - Date.parse(left[1]?.lastSeenAt || 0))
    .slice(0, MAX_TREND_RECORDS);
  return { items: enrichedItems, history: Object.fromEntries(retained) };
}

export function clusterMessageItems(items, similarityThreshold = 0.5) {
  const clusters = [];
  const exactUrls = new Map();
  const exactTitles = new Map();

  for (const item of items) {
    if (!item?.title) continue;
    const url = String(item.url || "").trim().toLocaleLowerCase();
    const normalizedTitle = normalizedText(item.title);
    const clusterable = (item.type || "news") === "news";
    let clusterIndex = url ? exactUrls.get(url) : undefined;
    if (clusterIndex === undefined && normalizedTitle) clusterIndex = exactTitles.get(normalizedTitle);
    if (clusterIndex === undefined && clusterable) {
      for (let index = 0; index < clusters.length; index += 1) {
        const candidate = clusters[index];
        if (!candidate.clusterable) continue;
        if (titleSimilarity(item.title, candidate.anchor.title) >= similarityThreshold) {
          clusterIndex = index;
          break;
        }
      }
    }
    if (clusterIndex === undefined) {
      clusterIndex = clusters.length;
      clusters.push({ anchor: item, items: [item], clusterable });
    } else {
      clusters[clusterIndex].items.push(item);
    }
    if (url) exactUrls.set(url, clusterIndex);
    if (normalizedTitle) exactTitles.set(normalizedTitle, clusterIndex);
  }

  const sourceStats = {};
  const output = clusters.map((cluster) => {
    const sorted = cluster.items.slice().sort(compareRepresentative);
    const representative = sorted[0];
    const sources = [...new Set(cluster.items.map(sourceIdentity))];
    for (const item of cluster.items) {
      const source = sourceIdentity(item);
      sourceStats[source] ||= { input: 0, selected: 0, suppressed: 0 };
      sourceStats[source].input += 1;
      if (item === representative) sourceStats[source].selected += 1;
      else sourceStats[source].suppressed += 1;
    }
    const sourceTier = inferSourceTier(representative);
    const storyId = storyKey(representative);
    const maxTrendScore = Math.max(...cluster.items.map((item) => finiteNumber(item.trendScore)));
    return {
      ...representative,
      storyId,
      sourceTier,
      sourceQualityWeight: sourceWeightForTier(sourceTier),
      corroborationCount: sources.length,
      duplicateCount: cluster.items.length - 1,
      corroboratingSources: sources,
      trendScore: maxTrendScore,
      metrics: {
        ...(representative.metrics || {}),
        storyId,
        sourceTier,
        corroborationCount: sources.length,
        duplicateCount: cluster.items.length - 1,
        corroboratingSources: sources,
        hotnessScore: maxTrendScore
      }
    };
  });

  return {
    items: output,
    stats: {
      inputCount: items.length,
      outputCount: output.length,
      suppressedDuplicates: Math.max(0, items.length - output.length),
      sourceStats
    }
  };
}
