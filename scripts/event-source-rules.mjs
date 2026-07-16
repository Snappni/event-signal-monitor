const ROUTINE_EXCHANGE_PRODUCT_PATTERNS = [
  /\bWILL\s+(?:LIST|LAUNCH|INTRODUCE|ADD)\b.{0,240}\b(?:SPOT|TRADING\s+PAIRS?|PERPETUAL|FUTURES?|CONTRACT|COLLATERAL\s+ASSETS?)\b/i,
  /\b(?:NEW\s+LISTING|LISTING\s+OF|SPOT\s+LISTING|SPOT\s+TRADING\s+WILL\s+OPEN|NEW\s+TRADING\s+PAIRS?|WILL\s+ADD\s+NEW\s+PAIRS?)\b/i,
  /\b(?:LAUNCH(?:ES|ING)?|INTRODUC(?:E|ES|ING)|ADD(?:S|ING)?)\b.{0,240}\b(?:USD.?-M|COIN-M|PERPETUAL|FUTURES?|TRADING\s+PAIRS?|SPOT|STOCK\s+TRADING|MARGIN|COLLATERAL\s+ASSETS?)\b/i,
  /\b(?:HODLER\s+AIRDROPS?|LAUNCHPOOL|MEGADROP)\b/i,
  /(?:将|即将).{0,30}(?:上线|推出|新增|开放).{0,80}(?:永续合约|交割合约|现货|交易对|U本位|币本位)/i,
  /(?:上线|推出|新增|开放).{0,80}(?:U本位|币本位|多资产模式).{0,50}(?:永续|合约|交易)/i,
  /(?:新币上线|现货上新|新增现货交易对|新增保证金交易对|开放现货交易|持币空投)/i
];

const MATERIAL_EXCHANGE_RISK_PATTERNS = [
  /\b(?:DELIST|DELISTING|REMOVE|REMOVAL|SUSPEND|SUSPENSION|PAUSE|HALT|RISK|SECURITY|HACK|EXPLOIT|ATTACK|INCIDENT|MAINTENANCE)\b/i,
  /(?:下架|移除|暂停|停止|终止|风险|安全|黑客|攻击|漏洞|异常|维护)/i
];

const SYMBOL_RULES = [
  { symbol: "BTCUSDT", pattern: /\b(?:BTC|BITCOIN)\b|比特币/i },
  { symbol: "ETHUSDT", pattern: /\b(?:ETH|ETHEREUM)\b|以太坊/i },
  { symbol: "SOLUSDT", pattern: /\b(?:SOL|SOLANA)\b|索拉纳/i },
  { symbol: "XRPUSDT", pattern: /\bXRP\b|瑞波/i },
  { symbol: "DOGEUSDT", pattern: /\b(?:DOGE|DOGECOIN)\b|狗狗币/i }
];

const BULLISH_YES_PATTERN = /\b(?:ABOVE|OVER|EXCEED|EXCEEDS|REACH|REACHES|HIT|HITS|HIGHER\s+THAN|AT\s+LEAST)\b|(?:大于|高于|超过|突破|达到)/i;
const BEARISH_YES_PATTERN = /\b(?:BELOW|UNDER|LOWER\s+THAN|FALL\s+TO|FALLS\s+TO|DROP\s+BELOW|DROPS\s+BELOW|AT\s+MOST)\b|(?:低于|跌破|小于|不高于)/i;
const NEGATED_BULLISH_PATTERN = /\b(?:NOT|WON'T|WILL\s+NOT)\b.{0,25}\b(?:ABOVE|OVER|EXCEED|REACH|HIT)\b|(?:不会|未能|不能).{0,12}(?:超过|突破|达到|高于)/i;
const PRICE_THRESHOLD_PATTERN = /(?:[$€£¥]\s*\d|\b\d[\d,.]*\s*(?:USD|USDT|DOLLARS?|K|M)\b|(?:价格|价位).{0,12}\d)/i;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function finiteNumber(value, fallback = null) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isRoutineExchangeProductAnnouncement(item) {
  const source = normalizeText(item?.source).toUpperCase();
  if (source && !/(BINANCE|OKX)/.test(source)) return false;
  const text = normalizeText([item?.title, item?.text].filter(Boolean).join(" "));
  if (!text || MATERIAL_EXCHANGE_RISK_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return ROUTINE_EXCHANGE_PRODUCT_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCryptoPolymarketMarket(market) {
  const text = normalizeText([market?.question, market?.title, market?.slug, market?.description].filter(Boolean).join(" ")).toUpperCase();
  return /\bBTC\b|\bBITCOIN\b|\bETH\b|\bETHEREUM\b|\bCRYPTO\b|\bCRYPTOCURRENCY\b|\bSOLANA\b|\bSOL\b|\bXRP\b|\bDOGE\b|\bBINANCE\b|\bSTABLECOIN\b|\bTETHER\b|\bUSDT\b|\bUSDC\b/.test(text);
}

export function extractBinaryMarketProbabilities(market) {
  const outcomes = asArray(market?.outcomes).map((value) => normalizeText(value));
  const prices = asArray(market?.outcomePrices).map((value) => finiteNumber(value));
  if (prices.length !== 2 || prices.some((value) => value === null)) return null;
  const total = prices[0] + prices[1];
  if (!(total > 0)) return null;
  const labels = outcomes.length === 2 && outcomes.every(Boolean) ? outcomes : ["Yes", "No"];
  const probabilities = prices.map((value) => clamp(value / total, 0, 1));
  return {
    labels,
    probabilities,
    ratio: probabilities[1] > 0 ? probabilities[0] / probabilities[1] : null
  };
}

function updateBucketedHistory(previous, snapshot, bucketMs, limit) {
  const history = Array.isArray(previous) ? previous.slice(-(limit - 1)) : [];
  const snapshotBucket = Math.floor(Date.parse(snapshot.observedAt) / bucketMs);
  const lastBucket = history.length
    ? Math.floor(Date.parse(history.at(-1).observedAt) / bucketMs)
    : null;
  if (lastBucket === snapshotBucket) history[history.length - 1] = snapshot;
  else history.push(snapshot);
  return history.slice(-limit);
}

export function updatePredictionMarketTracking(previous = {}, observation = {}, now = new Date().toISOString()) {
  const observedAt = new Date(now).toISOString();
  const snapshot = {
    observedAt,
    yesProbability: finiteNumber(observation.yesProbability),
    noProbability: finiteNumber(observation.noProbability),
    bullProbability: finiteNumber(observation.bullProbability),
    bearProbability: finiteNumber(observation.bearProbability),
    outcomeRatio: finiteNumber(observation.outcomeRatio),
    bullBearRatio: finiteNumber(observation.bullBearRatio),
    volume: finiteNumber(observation.volume),
    liquidity: finiteNumber(observation.liquidity)
  };
  const history = Array.isArray(previous.history) ? previous.history.slice(-179) : [];
  if (!history.length || history.at(-1)?.observedAt !== observedAt) history.push(snapshot);
  const hourlyHistory = updateBucketedHistory(previous.hourlyHistory, snapshot, 60 * 60 * 1_000, 24 * 7);
  const dailyHistory = updateBucketedHistory(previous.dailyHistory, snapshot, 24 * 60 * 60 * 1_000, 365 * 5);
  const closed = observation.closed === true;

  return {
    id: String(observation.id || previous.id || ""),
    slug: observation.slug || previous.slug || null,
    title: observation.title || previous.title || null,
    status: closed ? "closed" : "tracking",
    active: observation.active !== false && !closed,
    closed,
    endDate: observation.endDate || previous.endDate || null,
    firstSeenAt: previous.firstSeenAt || observedAt,
    lastSeenAt: observedAt,
    closedAt: closed ? previous.closedAt || observedAt : null,
    observations: Math.max(0, finiteNumber(previous.observations, 0)) + 1,
    yesPrice: finiteNumber(observation.yesPrice),
    yesProbability: snapshot.yesProbability,
    noProbability: snapshot.noProbability,
    bullProbability: snapshot.bullProbability,
    bearProbability: snapshot.bearProbability,
    outcomeRatio: snapshot.outcomeRatio,
    bullBearRatio: snapshot.bullBearRatio,
    volume: snapshot.volume,
    liquidity: snapshot.liquidity,
    history,
    hourlyHistory,
    dailyHistory
  };
}

export function buildPolymarketPriceSentiment(market, previous = {}) {
  const title = normalizeText([market?.question, market?.title, market?.slug].filter(Boolean).join(" "));
  const symbol = SYMBOL_RULES.find((rule) => rule.pattern.test(title))?.symbol || null;
  if (!symbol || !PRICE_THRESHOLD_PATTERN.test(title)) return null;

  const outcomes = asArray(market?.outcomes).map((value) => normalizeText(value).toUpperCase());
  const prices = asArray(market?.outcomePrices).map((value) => finiteNumber(value));
  if (prices.length !== 2 || prices.some((value) => value === null)) return null;

  const yesIndex = outcomes.findIndex((value) => value === "YES");
  const noIndex = outcomes.findIndex((value) => value === "NO");
  const resolvedYesIndex = yesIndex >= 0 ? yesIndex : outcomes.length === 0 ? 0 : -1;
  const resolvedNoIndex = noIndex >= 0 ? noIndex : outcomes.length === 0 ? 1 : -1;
  if (resolvedYesIndex < 0 || resolvedNoIndex < 0) return null;

  const total = prices[resolvedYesIndex] + prices[resolvedNoIndex];
  if (!(total > 0)) return null;
  const yesProbability = clamp(prices[resolvedYesIndex] / total, 0, 1);
  const noProbability = clamp(prices[resolvedNoIndex] / total, 0, 1);

  const negatedBullish = NEGATED_BULLISH_PATTERN.test(title);
  const bullishYes = !negatedBullish && BULLISH_YES_PATTERN.test(title);
  const bearishYes = negatedBullish || BEARISH_YES_PATTERN.test(title);
  if (bullishYes === bearishYes) return null;

  const bullProbability = bullishYes ? yesProbability : noProbability;
  const bearProbability = bullishYes ? noProbability : yesProbability;
  const previousBullProbability = finiteNumber(previous?.bullProbability);
  const previousYesProbability = finiteNumber(previous?.yesPrice);
  const derivedPreviousBullProbability =
    previousBullProbability ??
    (previousYesProbability === null ? null : bullishYes ? previousYesProbability : 1 - previousYesProbability);
  const bullProbabilityDelta =
    derivedPreviousBullProbability === null ? 0 : bullProbability - derivedPreviousBullProbability;
  const bullBearRatio = bearProbability > 0 ? bullProbability / bearProbability : null;
  const volume = finiteNumber(market?.volume24hr, finiteNumber(market?.volume, 0));
  const signal = (bullProbability - 0.5) * 0.7 + bullProbabilityDelta * 1.5;
  const direction = signal > 0.02 ? 1 : signal < -0.02 ? -1 : 0;
  const sentimentImpact = clamp(
    20 + Math.abs(bullProbability - 0.5) * 80 + Math.abs(bullProbabilityDelta) * 250 + Math.min(15, Math.log10(volume + 1) * 2),
    0,
    100
  );

  return {
    symbol,
    orientation: bullishYes ? "bullish-yes" : "bearish-yes",
    yesProbability,
    noProbability,
    bullProbability,
    bearProbability,
    bullBearRatio,
    bullProbabilityDelta,
    direction,
    sentimentImpact,
    volume
  };
}
