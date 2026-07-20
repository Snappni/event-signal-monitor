import assert from "node:assert/strict";
import {
  alignToStep,
  applyBinanceMarketOrderRules,
  floorToStep,
  maxLeverageForNotional,
  parseBinanceExchangeInfo,
  parseBinanceLeverageBrackets,
  resolveBinanceLeverage
} from "./binance-trading-rules.mjs";

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.10" },
  { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "100", stepSize: "0.001" },
  { filterType: "MARKET_LOT_SIZE", minQty: "0.002", maxQty: "50", stepSize: "0.002" },
  { filterType: "MIN_NOTIONAL", notional: "5" }
];
const bracketPayload = [{
  symbol: "BTCUSDT",
  brackets: [
    { bracket: 1, initialLeverage: 50, notionalFloor: 0, notionalCap: 10000 },
    { bracket: 2, initialLeverage: 20, notionalFloor: 10000, notionalCap: 50000 }
  ]
}];
const brackets = parseBinanceLeverageBrackets(bracketPayload);
const futuresRules = parseBinanceExchangeInfo({ symbols: [{
  symbol: "BTCUSDT",
  status: "TRADING",
  contractType: "PERPETUAL",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  filters
}] }, { marketType: "futures", leverageBrackets: brackets });
const rule = futuresRules.BTCUSDT;
const testnetRule = parseBinanceExchangeInfo({ symbols: [{
  symbol: "BTCUSDT",
  status: "TRADING",
  contractType: "PERPETUAL",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  filters
}] }, {
  marketType: "futures",
  ruleSource: "binance-futures-testnet-exchangeInfo"
}).BTCUSDT;

assert.equal(floorToStep(0.0109, "0.002"), 0.01);
assert.equal(alignToStep(100.06, "0.1", "floor"), 100);
assert.equal(alignToStep(100.06, "0.1", "ceil"), 100.1);
assert.equal(rule.minNotional, 5);
assert.equal(rule.minQty, 0.002);
assert.equal(testnetRule.ruleSource, "binance-futures-testnet-exchangeInfo");
assert.equal(testnetRule.leverageExact, false);
assert.equal(maxLeverageForNotional(rule, 9000), 50);
assert.equal(maxLeverageForNotional(rule, 12000), 20);
assert.deepEqual(resolveBinanceLeverage({
  requestedLeverage: 23.8,
  accountMaxLeverage: 30,
  notional: 12000,
  rule
}), {
  requestedLeverage: 23,
  accountMaxLeverage: 30,
  symbolMaxLeverage: 20,
  appliedLeverage: 20,
  exact: true,
  source: "binance-user-leverage-bracket"
});

const valid = applyBinanceMarketOrderRules({ quantity: 0.0109, referencePrice: 1000, rule });
assert.equal(valid.valid, true);
assert.equal(valid.quantity, 0.01);
assert.equal(valid.notional, 10);
assert.equal(valid.quantityAdjusted, true);

const tooSmall = applyBinanceMarketOrderRules({ quantity: 0.0049, referencePrice: 1000, rule });
assert.equal(tooSmall.valid, false);
assert.equal(tooSmall.reason, "BELOW_BINANCE_MIN_NOTIONAL");

const noBrackets = { ...rule, leverageBrackets: [], leverageExact: false, leverageRuleSource: "missing-user-leverage-bracket" };
assert.equal(resolveBinanceLeverage({ requestedLeverage: 12.7, accountMaxLeverage: 50, notional: 1000, rule: noBrackets }).appliedLeverage, 1);
assert.deepEqual(resolveBinanceLeverage({
  requestedLeverage: 12.7,
  accountMaxLeverage: 50,
  notional: 1000,
  rule: noBrackets,
  paperTrading: true
}), {
  requestedLeverage: 12,
  accountMaxLeverage: 50,
  symbolMaxLeverage: null,
  appliedLeverage: 12,
  exact: false,
  source: "paper-model-account-cap-unverified-bracket"
});
assert.equal(resolveBinanceLeverage({
  requestedLeverage: 5.9,
  accountMaxLeverage: 5.4,
  notional: 1000,
  rule: noBrackets,
  paperTrading: true
}).appliedLeverage, 5);
assert.equal(resolveBinanceLeverage({
  requestedLeverage: 200,
  accountMaxLeverage: 200,
  notional: 1000,
  rule: noBrackets,
  paperTrading: true
}).appliedLeverage, 125);

assert.deepEqual(resolveBinanceLeverage({
  requestedLeverage: 5.9,
  accountMaxLeverage: 50,
  notional: 1000,
  rule: null,
  paperTrading: true,
  marketType: "futures"
}), {
  requestedLeverage: 5,
  accountMaxLeverage: 50,
  symbolMaxLeverage: null,
  appliedLeverage: 5,
  exact: false,
  source: "paper-integer-account-cap-no-exchange-rules"
});

assert.equal(applyBinanceMarketOrderRules({
  quantity: 1.2345,
  referencePrice: 100,
  rule: null
}).valid, false);
const paperOrderWithoutRules = applyBinanceMarketOrderRules({
  quantity: 1.2345,
  referencePrice: 100,
  rule: null,
  paperTrading: true,
  marketType: "futures"
});
assert.equal(paperOrderWithoutRules.valid, true);
assert.equal(paperOrderWithoutRules.quantity, 1.2345);
assert.ok(Math.abs(paperOrderWithoutRules.notional - 123.45) < 1e-9);
assert.equal(paperOrderWithoutRules.quantityAdjusted, false);
assert.equal(paperOrderWithoutRules.exchangeRulesExact, false);
assert.equal(resolveBinanceLeverage({
  requestedLeverage: 8.8,
  accountMaxLeverage: 20,
  notional: 1000,
  rule: { ...noBrackets, leverageExact: true },
  paperTrading: true
}).appliedLeverage, 8);
assert.equal(maxLeverageForNotional({
  ...rule,
  leverageBrackets: [{ bracket: 1, initialLeverage: 200, notionalFloor: 0, notionalCap: 10000 }]
}, 1000), 125);

console.log("binance trading rules tests passed");
