function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function precisionOf(value) {
  const text = String(value ?? "0").toLowerCase();
  if (text.includes("e-")) return Math.max(0, Number(text.split("e-")[1]) || 0);
  const decimal = text.split(".")[1] || "";
  return decimal.replace(/0+$/, "").length;
}

export function floorToStep(value, stepValue) {
  const step = number(stepValue);
  if (!(step > 0) || !(number(value) > 0)) return 0;
  const precision = Math.min(12, precisionOf(stepValue));
  const scale = 10 ** precision;
  const stepUnits = Math.max(1, Math.round(step * scale));
  const valueUnits = Math.floor((number(value) + Number.EPSILON) * scale);
  return Math.floor(valueUnits / stepUnits) * stepUnits / scale;
}

export function alignToStep(value, stepValue, mode = "floor") {
  const floor = floorToStep(value, stepValue);
  const step = number(stepValue);
  if (!(step > 0)) return number(value);
  if (mode === "ceil" && floor + 1e-12 < number(value)) {
    const precision = Math.min(12, precisionOf(stepValue));
    return Number((floor + step).toFixed(precision));
  }
  if (mode === "nearest") {
    const ceil = floor + (floor + 1e-12 < number(value) ? step : 0);
    return Math.abs(number(value) - floor) <= Math.abs(ceil - number(value)) ? floor : Number(ceil.toFixed(precisionOf(stepValue)));
  }
  return floor;
}

function filterByType(filters, type) {
  return (Array.isArray(filters) ? filters : []).find((filter) => filter?.filterType === type) || null;
}

export function parseBinanceLeverageBrackets(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.symbol ? [payload] : [];
  return Object.fromEntries(rows.map((row) => [
    String(row?.symbol || "").toUpperCase(),
    (Array.isArray(row?.brackets) ? row.brackets : [])
      .map((item) => ({
        bracket: Math.max(1, Math.floor(number(item?.bracket, 1))),
        initialLeverage: Math.max(1, Math.floor(number(item?.initialLeverage, 1))),
        notionalFloor: Math.max(0, number(item?.notionalFloor)),
        notionalCap: Math.max(0, number(item?.notionalCap, Number.MAX_VALUE))
      }))
      .filter((item) => item.notionalCap > item.notionalFloor)
      .sort((left, right) => left.notionalFloor - right.notionalFloor)
  ]).filter(([symbol]) => symbol));
}

function marketMinimumNotional(filters, marketType) {
  const values = [];
  const minimum = filterByType(filters, "MIN_NOTIONAL");
  if (minimum && (marketType === "futures" || minimum.applyToMarket !== false)) {
    values.push(number(minimum.minNotional, number(minimum.notional)));
  }
  const notional = filterByType(filters, "NOTIONAL");
  if (notional && notional.applyMinToMarket !== false) values.push(number(notional.minNotional));
  return Math.max(0, ...values);
}

function marketMaximumNotional(filters) {
  const notional = filterByType(filters, "NOTIONAL");
  if (!notional || notional.applyMaxToMarket === false) return null;
  const value = number(notional.maxNotional);
  return value > 0 ? value : null;
}

export function parseBinanceExchangeInfo(
  payload,
  { marketType, leverageBrackets = {}, fetchedAt, ruleSource } = {}
) {
  const type = marketType === "spot" ? "spot" : "futures";
  const rows = Array.isArray(payload?.symbols) ? payload.symbols : [];
  const symbols = {};
  for (const row of rows) {
    const symbol = String(row?.symbol || "").toUpperCase();
    if (!symbol) continue;
    const lot = filterByType(row.filters, "LOT_SIZE");
    const marketLot = filterByType(row.filters, "MARKET_LOT_SIZE");
    const effectiveLot = number(marketLot?.stepSize) > 0 ? marketLot : lot;
    const priceFilter = filterByType(row.filters, "PRICE_FILTER");
    const permissions = Array.isArray(row.permissions) ? row.permissions : [];
    const tradable = row.status === "TRADING" && (
      type === "futures"
        ? row.contractType === "PERPETUAL"
        : permissions.length === 0 || permissions.includes("SPOT") || row.isSpotTradingAllowed === true
    );
    const brackets = Array.isArray(leverageBrackets[symbol]) ? leverageBrackets[symbol] : [];
    symbols[symbol] = {
      symbol,
      marketType: type,
      status: row.status || "UNKNOWN",
      tradable,
      baseAsset: row.baseAsset || null,
      quoteAsset: row.quoteAsset || null,
      minQty: Math.max(0, number(effectiveLot?.minQty)),
      maxQty: Math.max(0, number(effectiveLot?.maxQty, Number.MAX_VALUE)),
      stepSize: String(effectiveLot?.stepSize || lot?.stepSize || "0"),
      tickSize: String(priceFilter?.tickSize || "0"),
      minNotional: marketMinimumNotional(row.filters, type),
      maxNotional: marketMaximumNotional(row.filters),
      leverageBrackets: brackets,
      leverageExact: type === "spot" || brackets.length > 0,
      ruleSource: ruleSource || (type === "spot" ? "binance-spot-exchangeInfo" : "binance-futures-exchangeInfo"),
      leverageRuleSource: type === "spot"
        ? "spot-1x"
        : brackets.length
          ? "binance-user-leverage-bracket"
          : "missing-user-leverage-bracket",
      fetchedAt: fetchedAt || new Date().toISOString()
    };
  }
  return symbols;
}

export function maxLeverageForNotional(rule, notional) {
  if (rule?.marketType === "spot") return 1;
  const brackets = Array.isArray(rule?.leverageBrackets) ? rule.leverageBrackets : [];
  if (!brackets.length) return 1;
  const value = Math.max(0, number(notional));
  const bracket = brackets.find((item) => value >= item.notionalFloor && value < item.notionalCap) || brackets.at(-1);
  return Math.min(125, Math.max(1, Math.floor(number(bracket?.initialLeverage, 1))));
}

export function resolveBinanceLeverage({
  requestedLeverage,
  accountMaxLeverage,
  notional,
  rule,
  paperTrading = false,
  marketType = rule?.marketType
}) {
  const requested = Math.min(125, Math.max(1, Math.floor(number(requestedLeverage, 1))));
  const accountCap = Math.min(125, Math.max(1, Math.floor(number(accountMaxLeverage, 1))));
  const exact = rule?.marketType === "spot" || (
    rule?.marketType === "futures" &&
    rule?.leverageExact === true &&
    Array.isArray(rule?.leverageBrackets) &&
    rule.leverageBrackets.length > 0
  );
  const verifiedSymbolCap = maxLeverageForNotional(rule, notional);
  const usesPaperFallback = paperTrading && marketType === "futures" && !exact;
  const effectiveSymbolCap = usesPaperFallback ? 125 : verifiedSymbolCap;
  return {
    requestedLeverage: requested,
    accountMaxLeverage: accountCap,
    symbolMaxLeverage: exact ? verifiedSymbolCap : null,
    appliedLeverage: Math.max(1, Math.min(requested, accountCap, effectiveSymbolCap)),
    exact,
    source: usesPaperFallback
      ? rule
        ? "paper-model-account-cap-unverified-bracket"
        : "paper-integer-account-cap-no-exchange-rules"
      : rule?.leverageRuleSource || "missing-rule"
  };
}

export function applyBinanceMarketOrderRules({
  quantity,
  referencePrice,
  rule,
  paperTrading = false,
  marketType = rule?.marketType
}) {
  const price = number(referencePrice);
  if (!(price > 0)) return { valid: false, reason: "INVALID_REFERENCE_PRICE", quantity: 0, notional: 0 };
  if (!rule) {
    if (!paperTrading || marketType !== "futures") {
      return { valid: false, reason: "BINANCE_RULES_UNAVAILABLE", quantity: 0, notional: 0 };
    }
    const paperQuantity = Math.max(0, number(quantity));
    return {
      valid: paperQuantity > 0,
      reason: paperQuantity > 0 ? null : "INVALID_QUANTITY",
      quantity: paperQuantity,
      notional: paperQuantity * price,
      quantityAdjusted: false,
      exchangeRulesExact: false
    };
  }
  if (!rule.tradable) return { valid: false, reason: `BINANCE_SYMBOL_${rule.status || "UNAVAILABLE"}`, quantity: 0, notional: 0 };
  let adjustedQuantity = floorToStep(quantity, rule.stepSize);
  if (rule.maxQty > 0) adjustedQuantity = Math.min(adjustedQuantity, floorToStep(rule.maxQty, rule.stepSize));
  if (rule.maxNotional > 0) {
    adjustedQuantity = Math.min(adjustedQuantity, floorToStep(rule.maxNotional / price, rule.stepSize));
  }
  const notional = adjustedQuantity * price;
  if (!(adjustedQuantity > 0) || adjustedQuantity + 1e-12 < rule.minQty) {
    return { valid: false, reason: "BELOW_BINANCE_MIN_QTY", quantity: adjustedQuantity, notional };
  }
  if (notional + 1e-9 < rule.minNotional) {
    return { valid: false, reason: "BELOW_BINANCE_MIN_NOTIONAL", quantity: adjustedQuantity, notional };
  }
  return {
    valid: true,
    reason: null,
    quantity: adjustedQuantity,
    notional,
    minQty: rule.minQty,
    maxQty: rule.maxQty,
    stepSize: rule.stepSize,
    tickSize: rule.tickSize,
    minNotional: rule.minNotional,
    maxNotional: rule.maxNotional,
    quantityAdjusted: Math.abs(adjustedQuantity - number(quantity)) > 1e-12
  };
}
