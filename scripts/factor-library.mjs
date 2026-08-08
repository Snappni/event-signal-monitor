const FACTOR_LIBRARY_VERSION = 3;
const PRIMARY_IC_HORIZON_MINUTES = 15;
const MAX_PENDING_FRAMES = 90;
const MAX_IC_OBSERVATIONS = 2304;
const MAX_ACTIVE_MINED_FACTORS = 20;
const MAX_RETIRED_MINED_FACTORS = 2048;
const MIN_RETIRED_FACTOR_SAMPLES = 90;
const MIN_REJECTED_FACTOR_AGE_MS = 6 * 60 * 60 * 1_000;
const HISTORICAL_BACKFILL_VERSION = 2;
const MIN_CROSS_SECTION_SYMBOLS = 5;
const MIN_SMART_WEIGHT_SAMPLES = 30;
const MIN_MINED_FACTOR_SAMPLES = 30;

function factor(id, name, category, role, source, description, options = {}) {
  return Object.freeze({
    id,
    name,
    category,
    role,
    source,
    description,
    origin: "built_in",
    orientation: 1,
    defaultEnabled: options.defaultEnabled === true,
    defaultUseInDecision: options.defaultUseInDecision === true,
    defaultWeight: Number.isFinite(options.defaultWeight) ? options.defaultWeight : 1,
    formula: options.formula || null
  });
}

export const FACTOR_DEFINITIONS = Object.freeze([
  factor("return_1m", "1分钟收益率", "价格与趋势", "direction", "OKX/Binance 1m K线", "最近一分钟对数收益率。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("return_5m", "5分钟收益率", "价格与趋势", "direction", "OKX/Binance 1m K线", "最近五分钟价格动量。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("return_15m", "15分钟收益率", "价格与趋势", "direction", "OKX/Binance K线", "最近十五分钟价格动量。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("return_1h", "1小时收益率", "价格与趋势", "direction", "OKX/Binance 1h K线", "最近一小时价格动量。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("ema_spread_5_20", "EMA 5/20差值", "价格与趋势", "direction", "K线计算", "短周期与中周期指数均线的标准化差值。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("ema_slope_20", "EMA20斜率", "价格与趋势", "direction", "K线计算", "EMA20近期斜率，经价格和波动归一化。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("macd_histogram", "MACD柱体", "价格与趋势", "direction", "K线计算", "MACD与信号线差值，经波动归一化。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("adx_strength", "ADX趋势强度", "价格与趋势", "risk", "K线计算", "方向运动强度，只用于置信和行情状态，不直接决定多空。"),
  factor("donchian_breakout", "Donchian突破", "价格与趋势", "direction", "K线计算", "价格相对最近20根K线通道的位置。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("rsi_reversal", "RSI反转", "价格与趋势", "direction", "K线计算", "极端RSI后的均值回归信号。", { defaultEnabled: true, defaultUseInDecision: true }),

  factor("realized_volatility", "实现波动率", "波动率与分布", "risk", "K线计算", "滚动实现波动率。"),
  factor("volatility_zscore", "波动率Z分数", "波动率与分布", "risk", "K线计算", "短期波动相对历史基线的偏离。"),
  factor("range_expansion", "区间扩张", "波动率与分布", "risk", "K线计算", "当前高低区间相对历史平均区间的扩张程度。"),
  factor("range_compression", "区间压缩", "波动率与分布", "risk", "K线计算", "低波动压缩状态，供突破逻辑使用。"),
  factor("parkinson_volatility", "Parkinson波动率", "波动率与分布", "risk", "K线计算", "使用最高价和最低价估算的波动率。"),
  factor("garman_klass_volatility", "Garman-Klass波动率", "波动率与分布", "risk", "K线计算", "使用开高低收估算的波动率。"),
  factor("downside_semivolatility", "下行半波动率", "波动率与分布", "risk", "K线计算", "只统计负收益的半波动率。"),
  factor("jump_intensity", "跳跃强度", "波动率与分布", "risk", "K线计算", "异常大收益出现频率与幅度。"),

  factor("volume_zscore", "成交量Z分数", "成交量与成交流", "context", "K线成交量", "当前成交量相对滚动均值的标准分。"),
  factor("volume_roc", "成交量变化率", "成交量与成交流", "context", "K线成交量", "短期成交量变化速度。"),
  factor("obv_slope", "OBV斜率", "成交量与成交流", "direction", "K线成交量", "价量方向累计后的近期斜率。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("vwap_deviation", "VWAP偏离", "成交量与成交流", "direction", "K线成交量", "当前价格相对滚动VWAP的偏离。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("cumulative_volume_delta", "CVD", "成交量与成交流", "direction", "实时聚合成交", "主动买卖成交量差。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("aggressor_imbalance", "主动买卖不平衡", "成交量与成交流", "direction", "实时聚合成交/OKX", "主动买入和主动卖出成交量的归一化差。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("trade_intensity", "成交频率", "成交量与成交流", "context", "实时聚合成交", "单位时间内的成交笔数。"),
  factor("average_trade_size", "平均单笔成交量", "成交量与成交流", "context", "实时聚合成交", "单位时间内平均成交名义金额。"),
  factor("buy_sell_volume_divergence", "买卖量背离", "成交量与成交流", "direction", "K线主动成交量", "K线主动买量与卖量的差异。"),
  factor("price_volume_correlation", "价格成交量相关", "成交量与成交流", "direction", "K线计算", "收益率与成交量变化的滚动相关。"),

  factor("spread_bps", "买卖价差", "订单簿与微观结构", "risk", "实时盘口", "最优买卖价差，单位为基点。"),
  factor("microprice_bias", "Microprice偏离", "订单簿与微观结构", "direction", "实时盘口", "按最优档数量加权的微价格偏离。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("depth_imbalance_l1", "L1深度不平衡", "订单簿与微观结构", "direction", "实时盘口", "最优一档买卖深度不平衡。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("depth_imbalance_l5", "L5深度不平衡", "订单簿与微观结构", "direction", "实时五档盘口", "前五档买卖深度不平衡。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("depth_imbalance_l20", "L20深度不平衡", "订单簿与微观结构", "direction", "外部深度接口", "前二十档深度不平衡；没有二十档数据时保持不可用。"),
  factor("order_flow_imbalance", "订单流不平衡", "订单簿与微观结构", "direction", "实时成交与盘口", "成交方向和盘口变化融合后的订单流。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("cancellation_imbalance", "撤单不平衡", "订单簿与微观结构", "direction", "实时五档盘口", "买卖两侧撤单行为的方向差。"),
  factor("replenishment_rate", "挂单补充速度", "订单簿与微观结构", "context", "实时五档盘口", "盘口被消耗后新增挂单的相对速度。"),
  factor("book_slope", "订单簿斜率", "订单簿与微观结构", "direction", "实时五档盘口", "买卖盘深度随价格距离的变化差异。"),
  factor("liquidity_void", "流动性空洞", "订单簿与微观结构", "risk", "实时五档盘口", "近端盘口深度不足和集中度异常。"),
  factor("kyle_lambda_proxy", "Kyle Lambda近似", "订单簿与微观结构", "risk", "实时成交", "单位成交量造成价格变化的近似冲击。"),
  factor("amihud_illiquidity", "Amihud非流动性", "订单簿与微观结构", "risk", "K线成交额", "绝对收益率除以成交额的非流动性近似。"),

  factor("funding_zscore", "资金费率Z分数", "合约衍生品", "context", "OKX资金费率历史", "当前资金费率相对近期历史的偏离。"),
  factor("funding_price_divergence", "资金费率价格背离", "合约衍生品", "direction", "价格与资金费率", "价格方向与拥挤资金费率的背离。"),
  factor("open_interest_change", "OI变化率", "合约衍生品", "context", "OKX/Binance OI", "未平仓量相对上一观察值的变化。"),
  factor("oi_price_confirmation", "OI价格确认", "合约衍生品", "direction", "价格与OI", "价格方向是否得到新增持仓确认。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("perpetual_basis", "永续合约基差", "合约衍生品", "direction", "OKX标记价与指数价", "永续标记价相对现货指数的偏离。"),
  factor("liquidation_imbalance", "强平方向不平衡", "合约衍生品", "direction", "OKX公开强平订单", "多头与空头强平名义量的方向差。"),
  factor("long_short_ratio", "多空账户比", "合约衍生品", "direction", "OKX合约统计", "全市场多空账户比的拥挤反向信号。"),
  factor("basis_volatility", "基差波动率", "合约衍生品", "risk", "OKX标记价与指数价", "基差变化的滚动波动率；历史不足时不可用。"),

  factor("btc_beta_residual", "BTC Beta残差", "市场状态与跨资产", "direction", "跨资产K线", "剔除BTC共同波动后的相对收益。"),
  factor("eth_btc_relative_strength", "ETH/BTC相对强弱", "市场状态与跨资产", "direction", "跨资产K线", "相对BTC和ETH基准的强弱。"),
  factor("cross_section_momentum_rank", "横截面动量排名", "市场状态与跨资产", "direction", "多标的K线", "同一时点全部监控标的的动量分位。"),
  factor("correlation_regime", "滚动相关性状态", "市场状态与跨资产", "risk", "跨资产K线", "标的与BTC滚动相关性。"),
  factor("hmm_regime_signal", "HMM市场状态", "市场状态与跨资产", "direction", "三状态HMM", "HMM牛熊状态概率差。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("market_session", "交易时段因子", "市场状态与跨资产", "context", "UTC交易时段", "亚洲、欧洲、美国及交会时段的策略上下文。"),
  factor("news_impact_decay", "消息影响衰减", "市场状态与跨资产", "direction", "消息聚合", "消息方向乘以时效影响。"),
  factor("event_source_consensus", "多消息源一致性", "市场状态与跨资产", "direction", "消息聚合", "独立来源方向一致程度。")
]);

const DEFINITION_BY_ID = new Map(FACTOR_DEFINITIONS.map((item) => [item.id, item]));

const MINED_OPERATOR_META = Object.freeze({
  difference: Object.freeze({
    label: "差值",
    category: "自动挖掘·差值",
    symbol: "−",
    explanation: "衡量左侧因子相对右侧因子的方向优势；正值表示左侧更强，负值表示右侧更强。"
  }),
  blend: Object.freeze({
    label: "均值融合",
    category: "自动挖掘·均值融合",
    symbol: "+",
    explanation: "对两个因子等权平均，用于提取共同方向并降低单因子噪声。"
  }),
  agreement: Object.freeze({
    label: "一致性确认",
    category: "自动挖掘·一致性确认",
    symbol: "↔",
    explanation: "先融合两个因子，再按二者分歧程度衰减；方向越一致，保留的信号越多。"
  })
});

function minedPairKey(leftId, rightId) {
  return [String(leftId || ""), String(rightId || "")].sort().join("|");
}

function minedSemanticKey(definition) {
  return `${String(definition?.operator || "blend")}|${minedPairKey(definition?.leftId, definition?.rightId)}`;
}

function minedFactorPresentation(definition) {
  const operator = String(definition?.operator || "blend");
  const meta = MINED_OPERATOR_META[operator] || MINED_OPERATOR_META.blend;
  const left = DEFINITION_BY_ID.get(definition?.leftId);
  const right = DEFINITION_BY_ID.get(definition?.rightId);
  const leftName = left?.name || definition?.leftId || "左因子";
  const rightName = right?.name || definition?.rightId || "右因子";
  return {
    ...definition,
    name: `挖掘·${meta.label}：${leftName} ${meta.symbol} ${rightName}`,
    category: meta.category,
    source: `受限DSL自动挖掘·${meta.label}`,
    description: `${meta.explanation} 该候选保持隔离，必须通过样本量、IC、ICIR、覆盖率与多重检验后才可验证。`,
    formula: `${operator}(${definition?.leftId}, ${definition?.rightId})`,
    operator,
    operatorLabel: meta.label,
    semanticKey: minedSemanticKey(definition)
  };
}

function minedEvidenceScore(definition, metrics) {
  const validationRank = { validated: 3, quarantine: 2, rejected: 1 }[definition?.validationStatus] || 0;
  const samples = safeNumber(
    metrics?.[definition?.id]?.[PRIMARY_IC_HORIZON_MINUTES]?.samples,
    safeNumber(definition?.validation?.samples)
  );
  return validationRank * 1e9 + samples * 1e3 - safeNumber(Date.parse(definition?.createdAt || ""), 0) / 1e12;
}

function normalizeMinedFactors(rawFactors, metrics) {
  const groups = new Map();
  for (const rawDefinition of Array.isArray(rawFactors) ? rawFactors : []) {
    if (!rawDefinition?.id || !rawDefinition?.leftId || !rawDefinition?.rightId) continue;
    const definition = minedFactorPresentation(rawDefinition);
    const key = definition.semanticKey;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, definition);
      continue;
    }
    const currentScore = minedEvidenceScore(current, metrics);
    const nextScore = minedEvidenceScore(definition, metrics);
    const kept = nextScore > currentScore ? definition : current;
    const removed = nextScore > currentScore ? current : definition;
    groups.set(key, {
      ...kept,
      mergedDuplicateIds: [...new Set([
        ...(Array.isArray(kept.mergedDuplicateIds) ? kept.mergedDuplicateIds : []),
        ...(Array.isArray(removed.mergedDuplicateIds) ? removed.mergedDuplicateIds : []),
        removed.id
      ])].filter((id) => id && id !== kept.id)
    });
  }
  return [...groups.values()].slice(-MAX_ACTIVE_MINED_FACTORS);
}

function compactMetricEvidence(metric) {
  if (!metric || typeof metric !== "object") return null;
  return {
    samples: safeNumber(metric.samples),
    meanIc: metric.meanIc ?? null,
    icStd: metric.icStd ?? null,
    icir: metric.icir ?? null,
    tStatistic: metric.tStatistic ?? null,
    coverage: metric.coverage ?? null,
    lastIc: metric.lastIc ?? null,
    historySamples: safeNumber(metric.historySamples),
    realtimeSamples: safeNumber(metric.realtimeSamples)
  };
}

function normalizeRetiredMinedFactors(rawFactors = []) {
  const groups = new Map();
  for (const rawDefinition of Array.isArray(rawFactors) ? rawFactors : []) {
    if (!rawDefinition?.id || !rawDefinition?.leftId || !rawDefinition?.rightId) continue;
    const presentation = minedFactorPresentation(rawDefinition);
    const definition = {
      ...presentation,
      description: `${presentation.description.replace(" 该候选保持隔离，必须通过样本量、IC、ICIR、覆盖率与多重检验后才可验证。", "")} 该候选在扩展观察期后仍未通过验证，已停止实时计算并保留压缩证据。`,
      retired: true,
      archived: true,
      retiredAt: rawDefinition.retiredAt || null,
      retirementReason: rawDefinition.retirementReason || "failed_validation_after_extended_observation",
      retiredMetrics: rawDefinition.retiredMetrics && typeof rawDefinition.retiredMetrics === "object"
        ? rawDefinition.retiredMetrics
        : {}
    };
    const current = groups.get(definition.semanticKey);
    if (!current || Date.parse(definition.retiredAt || "") > Date.parse(current.retiredAt || "")) {
      groups.set(definition.semanticKey, definition);
    }
  }
  return [...groups.values()]
    .sort((left, right) => safeNumber(Date.parse(left.retiredAt || ""), 0) - safeNumber(Date.parse(right.retiredAt || ""), 0))
    .slice(-MAX_RETIRED_MINED_FACTORS);
}

export const DEFAULT_FACTOR_LIBRARY_CONFIG = Object.freeze({
  version: FACTOR_LIBRARY_VERSION,
  enabled: true,
  intelligentAdjustment: false,
  miningEnabled: false,
  autoPromoteMined: false,
  decisionInfluence: 0.25,
  captureIntervalSeconds: 60,
  adjustmentIntervalMinutes: 60,
  miningIntervalMinutes: 15,
  maxFactorWeight: 0.1,
  maxCategoryWeight: 0.3,
  maxWeightStep: 0.02,
  horizonsMinutes: [5, 15, 60],
  factorSettings: {}
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function correlation(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 3) return null;
  const xs = left.slice(-length);
  const ys = right.slice(-length);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < length; index += 1) {
    const xDelta = xs[index] - xMean;
    const yDelta = ys[index] - yMean;
    numerator += xDelta * yDelta;
    xVariance += xDelta ** 2;
    yVariance += yDelta ** 2;
  }
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator > 0 ? numerator / denominator : null;
}

function returns(values) {
  const result = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] > 0 && values[index] > 0) result.push(Math.log(values[index] / values[index - 1]));
  }
  return result;
}

function ema(values, period) {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  let result = values[0];
  for (const value of values.slice(1)) result = value * multiplier + result * (1 - multiplier);
  return result;
}

function roc(values, periods) {
  if (values.length <= periods) return null;
  const previous = values.at(-(periods + 1));
  const current = values.at(-1);
  return previous > 0 ? current / previous - 1 : null;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  const deltas = values.slice(1).map((value, index) => value - values[index]).slice(-period);
  const gain = mean(deltas.map((value) => Math.max(0, value)));
  const loss = mean(deltas.map((value) => Math.max(0, -value)));
  if (loss <= 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function zscore(value, values) {
  const deviation = std(values);
  return deviation > 0 ? (value - mean(values)) / deviation : null;
}

function rank(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  let start = 0;
  while (start < indexed.length) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const averageRank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index += 1) result[indexed[index].index] = averageRank;
    start = end;
  }
  return result;
}

function spearman(left, right) {
  if (left.length < MIN_CROSS_SECTION_SYMBOLS || right.length !== left.length) return null;
  return correlation(rank(left), rank(right));
}

function adx(candles, period = 14) {
  if (candles.length <= period + 1) return null;
  const recent = candles.slice(-(period + 1));
  let plus = 0;
  let minus = 0;
  let tr = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const current = recent[index];
    const previous = recent[index - 1];
    const up = current.high - previous.high;
    const down = previous.low - current.low;
    plus += up > down ? Math.max(0, up) : 0;
    minus += down > up ? Math.max(0, down) : 0;
    tr += Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
  }
  if (tr <= 0) return null;
  const plusDi = plus / tr;
  const minusDi = minus / tr;
  return plusDi + minusDi > 0 ? Math.abs(plusDi - minusDi) / (plusDi + minusDi) : 0;
}

function macdHistogram(values) {
  if (values.length < 35) return null;
  const macdSeries = [];
  for (let index = 26; index <= values.length; index += 1) {
    const sample = values.slice(0, index);
    macdSeries.push(ema(sample, 12) - ema(sample, 26));
  }
  return macdSeries.at(-1) - ema(macdSeries, 9);
}

function parkinsonVolatility(candles) {
  const sample = candles.slice(-20).filter((item) => item.high > 0 && item.low > 0);
  if (sample.length < 5) return null;
  return Math.sqrt(mean(sample.map((item) => Math.log(item.high / item.low) ** 2)) / (4 * Math.log(2)));
}

function garmanKlassVolatility(candles) {
  const sample = candles.slice(-20).filter((item) => item.open > 0 && item.high > 0 && item.low > 0 && item.close > 0);
  if (sample.length < 5) return null;
  const variance = mean(sample.map((item) =>
    0.5 * Math.log(item.high / item.low) ** 2 - (2 * Math.log(2) - 1) * Math.log(item.close / item.open) ** 2
  ));
  return Math.sqrt(Math.max(0, variance));
}

function factorSetting(config, definition) {
  const override = config.factorSettings?.[definition.id] || {};
  return {
    enabled: override.enabled ?? definition.defaultEnabled,
    useInDecision: override.useInDecision ?? definition.defaultUseInDecision,
    weight: clamp(safeNumber(override.weight, definition.defaultWeight), 0, 100),
    archived: override.archived === true
  };
}

function allDefinitions(status) {
  return [...FACTOR_DEFINITIONS, ...(Array.isArray(status?.minedFactors) ? status.minedFactors : [])];
}

export function normalizeFactorLibraryConfig(value = {}, extraDefinitions = []) {
  const raw = value && typeof value === "object" ? value : {};
  const definitions = [...FACTOR_DEFINITIONS, ...extraDefinitions];
  const mergedDuplicateIds = new Set(
    definitions.flatMap((definition) => Array.isArray(definition.mergedDuplicateIds) ? definition.mergedDuplicateIds : [])
  );
  const settings = {};
  for (const definition of definitions) {
    const overrides = [definition.id, ...(definition.mergedDuplicateIds || [])]
      .map((id) => raw.factorSettings?.[id])
      .filter((override) => override && typeof override === "object");
    const primary = overrides[0] || {};
    const override = overrides.length > 1
      ? {
          enabled: overrides.some((item) => item.enabled === true),
          useInDecision: overrides.some((item) => item.useInDecision === true),
          weight: Math.max(...overrides.map((item) => safeNumber(item.weight, definition.defaultWeight))),
          archived: overrides.every((item) => item.archived === true)
        }
      : primary;
    settings[definition.id] = {
      enabled: override.enabled ?? definition.defaultEnabled,
      useInDecision: override.useInDecision ?? definition.defaultUseInDecision,
      weight: clamp(safeNumber(override.weight, definition.defaultWeight), 0, 100),
      archived: override.archived === true
    };
  }
  for (const [id, override] of Object.entries(raw.factorSettings || {})) {
    if (mergedDuplicateIds.has(id)) continue;
    if (!settings[id]) settings[id] = {
      enabled: override.enabled === true,
      useInDecision: override.useInDecision === true,
      weight: clamp(safeNumber(override.weight, 1), 0, 100),
      archived: override.archived === true
    };
  }
  return {
    version: FACTOR_LIBRARY_VERSION,
    enabled: raw.enabled !== false,
    intelligentAdjustment: raw.intelligentAdjustment === true,
    miningEnabled: raw.miningEnabled === true,
    autoPromoteMined: raw.autoPromoteMined === true,
    decisionInfluence: clamp(safeNumber(raw.decisionInfluence, DEFAULT_FACTOR_LIBRARY_CONFIG.decisionInfluence), 0, 0.4),
    captureIntervalSeconds: Math.round(clamp(safeNumber(raw.captureIntervalSeconds, 60), 30, 300)),
    adjustmentIntervalMinutes: Math.round(clamp(safeNumber(raw.adjustmentIntervalMinutes, 60), 15, 1440)),
    miningIntervalMinutes: Math.round(clamp(safeNumber(raw.miningIntervalMinutes, 15), 5, 1440)),
    maxFactorWeight: clamp(safeNumber(raw.maxFactorWeight, 0.1), 0.03, 0.25),
    maxCategoryWeight: clamp(safeNumber(raw.maxCategoryWeight, 0.3), 0.15, 0.6),
    maxWeightStep: clamp(safeNumber(raw.maxWeightStep, 0.02), 0.005, 0.1),
    horizonsMinutes: [5, 15, 60],
    factorSettings: settings,
    updatedAt: raw.updatedAt || null
  };
}

export function updateFactorLibraryConfig(current, patch = {}, extraDefinitions = []) {
  const base = normalizeFactorLibraryConfig(current, extraDefinitions);
  const nextSettings = { ...base.factorSettings };
  for (const item of Array.isArray(patch.factorUpdates) ? patch.factorUpdates : []) {
    if (!item?.id) continue;
    const previous = nextSettings[item.id] || { enabled: false, useInDecision: false, weight: 1, archived: false };
    nextSettings[item.id] = {
      enabled: item.enabled == null ? previous.enabled : item.enabled === true,
      useInDecision: item.useInDecision == null ? previous.useInDecision : item.useInDecision === true,
      weight: item.weight == null ? previous.weight : clamp(safeNumber(item.weight, previous.weight), 0, 100),
      archived: item.archived == null ? previous.archived : item.archived === true
    };
  }
  for (const id of Array.isArray(patch.archiveIds) ? patch.archiveIds : []) {
    const previous = nextSettings[id] || { enabled: false, useInDecision: false, weight: 1, archived: false };
    nextSettings[id] = { ...previous, archived: true, enabled: false, useInDecision: false };
  }
  return normalizeFactorLibraryConfig({
    ...base,
    ...Object.fromEntries(Object.entries(patch).filter(([key]) => !["factorUpdates", "archiveIds"].includes(key))),
    factorSettings: nextSettings,
    updatedAt: new Date().toISOString()
  }, extraDefinitions);
}

export function createFactorLibraryStatus() {
  return {
    version: FACTOR_LIBRARY_VERSION,
    generatedAt: null,
    lastFrameAt: null,
    lastAdjustmentAt: null,
    weightVersion: 1,
    effectiveWeights: {},
    pendingFrames: [],
    metrics: {},
    latestBySymbol: {},
    latestFactorAvailability: {},
    minedFactors: [],
    retiredMinedFactors: [],
    mining: {
      enabled: false,
      lastRunAt: null,
      runCount: 0,
      rejectedCount: 0,
      validatedCount: 0,
      mergedDuplicateCount: 0,
      retiredCount: 0,
      lastRetiredAt: null,
      activeLimit: MAX_ACTIVE_MINED_FACTORS,
      archiveLimit: MAX_RETIRED_MINED_FACTORS,
      currentActivity: "idle"
    },
    dataSources: {},
    historicalBackfill: {
      version: HISTORICAL_BACKFILL_VERSION,
      samplingMode: null,
      status: "not_started",
      source: "OKX public historical candles",
      intervalMinutes: 15,
      lookbackMonths: 3,
      symbols: 0,
      frames: 0,
      resolvedSamples: 0,
      lastAttemptAt: null,
      completedAt: null,
      startAt: null,
      endAt: null,
      error: null
    }
  };
}

export function normalizeFactorLibraryStatus(value = {}) {
  const base = createFactorLibraryStatus();
  const raw = value && typeof value === "object" ? value : {};
  const rawMetrics = raw.metrics && typeof raw.metrics === "object" ? raw.metrics : {};
  const rawMinedFactors = Array.isArray(raw.minedFactors) ? raw.minedFactors : [];
  const minedFactors = normalizeMinedFactors(rawMinedFactors, rawMetrics);
  const activeSemanticKeys = new Set(minedFactors.map(minedSemanticKey));
  const retiredMinedFactors = normalizeRetiredMinedFactors(raw.retiredMinedFactors)
    .filter((definition) => !activeSemanticKeys.has(definition.semanticKey));
  const keptMinedIds = new Set(minedFactors.map((definition) => definition.id));
  const removedMinedIds = new Set(
    rawMinedFactors.map((definition) => definition?.id).filter((id) => id && !keptMinedIds.has(id))
  );
  const inactiveMinedIds = new Set([
    ...removedMinedIds,
    ...(Array.isArray(raw.retiredMinedFactors) ? raw.retiredMinedFactors : [])
      .map((definition) => definition?.id)
      .filter((id) => id && !keptMinedIds.has(id))
  ]);
  const metrics = Object.fromEntries(
    Object.entries(rawMetrics).filter(([id]) => !inactiveMinedIds.has(id))
  );
  const effectiveWeights = Object.fromEntries(
    Object.entries(raw.effectiveWeights && typeof raw.effectiveWeights === "object" ? raw.effectiveWeights : {})
      .filter(([id]) => !inactiveMinedIds.has(id))
  );
  const latestFactorAvailability = Object.fromEntries(
    Object.entries(raw.latestFactorAvailability && typeof raw.latestFactorAvailability === "object"
      ? raw.latestFactorAvailability
      : {})
      .filter(([id]) => !inactiveMinedIds.has(id))
  );
  const stripInactiveValues = (values) => Object.fromEntries(
    Object.entries(values && typeof values === "object" ? values : {})
      .filter(([id]) => !inactiveMinedIds.has(id))
  );
  const pendingFrames = (Array.isArray(raw.pendingFrames) ? raw.pendingFrames : []).slice(-MAX_PENDING_FRAMES)
    .map((frame) => ({
      ...frame,
      values: Object.fromEntries(
        Object.entries(frame?.values && typeof frame.values === "object" ? frame.values : {})
          .map(([symbol, values]) => [symbol, stripInactiveValues(values)])
      )
    }));
  const latestBySymbol = Object.fromEntries(
    Object.entries(raw.latestBySymbol && typeof raw.latestBySymbol === "object" ? raw.latestBySymbol : {})
      .map(([symbol, snapshot]) => [symbol, {
        ...snapshot,
        values: stripInactiveValues(snapshot?.values)
      }])
  );
  const mining = {
    ...base.mining,
    ...(raw.mining || {}),
    validatedCount: minedFactors.filter((item) => item.validationStatus === "validated").length,
    rejectedCount: minedFactors.filter((item) => item.validationStatus === "rejected").length,
    mergedDuplicateCount: safeNumber(raw.mining?.mergedDuplicateCount) + removedMinedIds.size,
    retiredCount: retiredMinedFactors.length,
    activeLimit: MAX_ACTIVE_MINED_FACTORS,
    archiveLimit: MAX_RETIRED_MINED_FACTORS
  };
  return {
    ...base,
    ...raw,
    version: FACTOR_LIBRARY_VERSION,
    weightVersion: Math.max(1, Math.round(safeNumber(raw.weightVersion, 1))),
    effectiveWeights,
    pendingFrames,
    metrics,
    latestBySymbol,
    latestFactorAvailability,
    minedFactors,
    retiredMinedFactors,
    mining,
    dataSources: raw.dataSources && typeof raw.dataSources === "object" ? raw.dataSources : {},
    historicalBackfill: { ...base.historicalBackfill, ...(raw.historicalBackfill || {}) }
  };
}

function normalizeSignal(value, scale) {
  return value == null ? null : clamp(value / Math.max(scale, 1e-12), -1, 1);
}

function priceVolumeCorrelation(candles) {
  const sample = candles.slice(-30);
  const priceReturns = returns(sample.map((item) => item.close));
  const volumeChanges = returns(sample.map((item) => Math.max(item.quoteVolume || item.volume, 1e-9)));
  return correlation(priceReturns, volumeChanges);
}

function factorValueMap(context) {
  const market = context.market || {};
  const micro = market.microstructure || {};
  const candles1m = Array.isArray(context.candles1m) ? context.candles1m : [];
  const candles15m = Array.isArray(context.candles15m) ? context.candles15m : [];
  const candles1h = Array.isArray(context.candles1h) ? context.candles1h : [];
  const derivatives = context.derivatives || {};
  const barMinutes = Math.max(1, safeNumber(context.barMinutes, 1));
  const barsForMinutes = (minutes) => Math.max(1, Math.round(minutes / barMinutes));
  const closes1m = candles1m.map((item) => safeNumber(item.close)).filter((value) => value > 0);
  const closes15m = candles15m.map((item) => safeNumber(item.close)).filter((value) => value > 0);
  const closes1h = candles1h.map((item) => safeNumber(item.close)).filter((value) => value > 0);
  const latest = safeNumber(market.latest, closes1m.at(-1) || closes15m.at(-1));
  const returns1m = returns(closes1m);
  const returns15m = returns(closes15m);
  const recentVolume = candles1m.slice(-30).map((item) => safeNumber(item.quoteVolume || item.volume)).filter((value) => value > 0);
  const currentVolume = recentVolume.at(-1);
  const priceScale = Math.max(latest * Math.max(safeNumber(market.atrPct, 0.004), 0.002), 1e-9);
  const ema5 = ema(closes1m.slice(-60), 5);
  const ema20 = ema(closes1m.slice(-90), 20);
  const previousEma20 = ema(closes1m.slice(-91, -1), 20);
  const macd = macdHistogram(closes1m);
  const currentRsi = rsi(closes1m);
  const channel = candles1m.slice(-21, -1);
  const channelHigh = channel.length ? Math.max(...channel.map((item) => item.high)) : null;
  const channelLow = channel.length ? Math.min(...channel.map((item) => item.low)) : null;
  const ranges = candles1m.slice(-30).map((item) => item.close > 0 ? (item.high - item.low) / item.close : 0).filter((value) => value > 0);
  const currentRange = ranges.at(-1);
  const realized = std(returns1m.slice(-30));
  const baselineVols = [];
  for (let end = 30; end <= returns1m.length; end += 10) baselineVols.push(std(returns1m.slice(Math.max(0, end - 30), end)));
  const downside = returns1m.slice(-30).filter((value) => value < 0);
  const jumpThreshold = Math.max(3 * std(returns1m.slice(-60)), 1e-9);
  const jumpValues = returns1m.slice(-30).filter((value) => Math.abs(value) >= jumpThreshold);
  let obv = 0;
  const obvSeries = [];
  for (let index = 1; index < candles1m.length; index += 1) {
    obv += Math.sign(candles1m[index].close - candles1m[index - 1].close) * safeNumber(candles1m[index].volume);
    obvSeries.push(obv);
  }
  const obvDelta = obvSeries.length > 20 ? obvSeries.at(-1) - obvSeries.at(-20) : null;
  const obvScale = candles1m.slice(-20).reduce((sum, item) => sum + Math.abs(safeNumber(item.volume)), 0);
  const vwapNumerator = candles1m.slice(-30).reduce((sum, item) => sum + safeNumber(item.quoteVolume), 0);
  const vwapDenominator = candles1m.slice(-30).reduce((sum, item) => sum + safeNumber(item.volume), 0);
  const vwap = vwapDenominator > 0 ? vwapNumerator / vwapDenominator : null;
  const takerBuy = candles1m.slice(-10).reduce((sum, item) => sum + safeNumber(item.takerBuyQuoteVolume), 0);
  const totalQuote = candles1m.slice(-10).reduce((sum, item) => sum + safeNumber(item.quoteVolume), 0);
  const flow30 = micro.flow30s || {};
  const bookFlow30 = micro.bookFlow30s || {};
  const bookAdd = safeNumber(bookFlow30.bidAddedQuote) + safeNumber(bookFlow30.askAddedQuote);
  const bookCancel = safeNumber(bookFlow30.bidCancelledQuote) + safeNumber(bookFlow30.askCancelledQuote);
  const ret15 = finiteOrNull(roc(closes1m, barsForMinutes(15)) ?? roc(closes15m, 1));
  const ret1h = finiteOrNull(roc(closes1m, barsForMinutes(60)) ?? roc(closes1h, 1));
  const fundingZ = finiteOrNull(derivatives.fundingZScore);
  const basis = finiteOrNull(derivatives.perpetualBasis);
  const returnForImpact = safeNumber(roc(closes1m, 1));
  const quoteForImpact = safeNumber(flow30.totalQuoteVolume);
  const last15mQuote = safeNumber(candles15m.at(-2)?.quoteVolume, candles15m.at(-2)?.volume);
  const eventDirection = safeNumber(context.eventAggregate?.direction);
  const eventScore = clamp(safeNumber(context.eventAggregate?.score) / 100, 0, 1);
  const eventCount = safeNumber(context.eventAggregate?.eventCount, context.eventAggregate?.events?.length || 0);
  const sourceCount = new Set((context.eventAggregate?.events || []).map((item) => item.source).filter(Boolean)).size;
  const sessionKey = String(context.sessionContext?.policyKey || "off_hours");
  const sessionSignal = sessionKey.includes("overlap") ? 0.2 : sessionKey === "europe" ? 0.15 : sessionKey === "us" ? 0.1 : sessionKey === "asia" ? 0 : -0.2;

  return {
    return_1m: barMinutes === 1 ? normalizeSignal(roc(closes1m, 1), 0.003) : null,
    return_5m: barMinutes <= 5 ? normalizeSignal(roc(closes1m, barsForMinutes(5)), 0.008) : null,
    return_15m: normalizeSignal(ret15, 0.015),
    return_1h: normalizeSignal(ret1h, 0.03),
    ema_spread_5_20: latest > 0 && ema20 > 0 ? clamp((ema5 - ema20) / priceScale, -1, 1) : null,
    ema_slope_20: latest > 0 && previousEma20 > 0 ? clamp((ema20 - previousEma20) / Math.max(priceScale * 0.25, 1e-9), -1, 1) : null,
    macd_histogram: macd == null ? null : clamp(macd / priceScale, -1, 1),
    adx_strength: adx(candles1m),
    donchian_breakout: channelHigh != null && channelLow != null && channelHigh > channelLow
      ? clamp(((latest - channelLow) / (channelHigh - channelLow) - 0.5) * 2, -1, 1)
      : null,
    rsi_reversal: currentRsi == null ? null : clamp((50 - currentRsi) / 25, -1, 1),
    realized_volatility: realized > 0 ? clamp(realized / 0.02, 0, 1) : null,
    volatility_zscore: baselineVols.length ? clamp(safeNumber(zscore(realized, baselineVols)) / 3, -1, 1) : null,
    range_expansion: currentRange && ranges.length > 5 ? clamp(currentRange / Math.max(mean(ranges.slice(-21, -1)), 1e-9) - 1, -1, 1) : null,
    range_compression: currentRange && ranges.length > 5 ? clamp(1 - currentRange / Math.max(mean(ranges.slice(-21, -1)), 1e-9), -1, 1) : null,
    parkinson_volatility: parkinsonVolatility(candles1m),
    garman_klass_volatility: garmanKlassVolatility(candles1m),
    downside_semivolatility: downside.length ? clamp(std(downside) / 0.02, 0, 1) : 0,
    jump_intensity: returns1m.length >= 30 ? clamp(jumpValues.length / 5, 0, 1) : null,
    volume_zscore: currentVolume != null && recentVolume.length > 10 ? clamp(safeNumber(zscore(currentVolume, recentVolume.slice(0, -1))) / 3, -1, 1) : null,
    volume_roc: recentVolume.length > 6 ? normalizeSignal(roc(recentVolume, 5), 1) : null,
    obv_slope: obvDelta == null || obvScale <= 0 ? null : clamp(obvDelta / obvScale, -1, 1),
    vwap_deviation: vwap && latest > 0 ? clamp((latest / vwap - 1) / 0.01, -1, 1) : null,
    cumulative_volume_delta: quoteForImpact > 0 ? clamp(safeNumber(micro.cumulativeVolumeDelta30s) / quoteForImpact, -1, 1) : null,
    aggressor_imbalance: micro.tradeAvailable ? clamp(safeNumber(flow30.imbalance), -1, 1) : finiteOrNull(derivatives.takerImbalance),
    trade_intensity: micro.tradeAvailable ? clamp(safeNumber(flow30.tradeCount) / 50, 0, 1) : null,
    average_trade_size: safeNumber(flow30.tradeCount) > 0 ? clamp(quoteForImpact / flow30.tradeCount / 50_000, 0, 1) : null,
    buy_sell_volume_divergence: totalQuote > 0 ? clamp((2 * takerBuy - totalQuote) / totalQuote, -1, 1) : null,
    price_volume_correlation: priceVolumeCorrelation(candles1m),
    spread_bps: micro.bookAvailable ? clamp(safeNumber(micro.spreadBps) / 10, 0, 1) : null,
    microprice_bias: micro.bookAvailable ? clamp(safeNumber(micro.microPriceBiasBps) / 3, -1, 1) : null,
    depth_imbalance_l1: micro.bookAvailable ? finiteOrNull(micro.topBookImbalance) : null,
    depth_imbalance_l5: micro.bookAvailable ? finiteOrNull(micro.orderBookImbalance) : null,
    depth_imbalance_l20: finiteOrNull(derivatives.depthImbalanceL20),
    order_flow_imbalance: micro.available ? clamp(safeNumber(micro.signal), -1, 1) : null,
    cancellation_imbalance: micro.bookAvailable ? finiteOrNull(bookFlow30.imbalance) : null,
    replenishment_rate: bookAdd + bookCancel > 0 ? clamp((bookAdd - bookCancel) / (bookAdd + bookCancel), -1, 1) : null,
    book_slope: micro.bookAvailable ? finiteOrNull(micro.bookSlope) : null,
    liquidity_void: micro.bookAvailable ? finiteOrNull(micro.liquidityVoid) : null,
    kyle_lambda_proxy: quoteForImpact > 0 ? clamp(Math.abs(returnForImpact) / quoteForImpact * 1e9, 0, 1) : null,
    amihud_illiquidity: last15mQuote > 0 && ret15 != null ? clamp(Math.abs(ret15) / last15mQuote * 1e9, 0, 1) : null,
    funding_zscore: fundingZ == null ? null : clamp(fundingZ / 3, -1, 1),
    funding_price_divergence: fundingZ == null || ret1h == null ? null : clamp(-Math.sign(fundingZ) * Math.abs(ret1h / 0.03) * Math.min(1, Math.abs(fundingZ) / 2), -1, 1),
    open_interest_change: finiteOrNull(market.oiChange),
    oi_price_confirmation: ret15 == null ? null : clamp(Math.sign(safeNumber(market.oiChange)) * ret15 / 0.015, -1, 1),
    perpetual_basis: basis == null ? null : clamp(basis / 0.003, -1, 1),
    liquidation_imbalance: finiteOrNull(derivatives.liquidationImbalance),
    long_short_ratio: finiteOrNull(derivatives.longShortContrarian),
    basis_volatility: finiteOrNull(derivatives.basisVolatility),
    btc_beta_residual: finiteOrNull(context.crossAsset?.btcBetaResidual),
    eth_btc_relative_strength: finiteOrNull(context.crossAsset?.ethBtcRelativeStrength),
    cross_section_momentum_rank: finiteOrNull(context.crossAsset?.momentumRank),
    correlation_regime: finiteOrNull(context.crossAsset?.btcCorrelation),
    hmm_regime_signal: finiteOrNull(market.hiddenMarkov?.signal),
    market_session: sessionSignal,
    news_impact_decay: eventScore > 0 ? clamp(eventDirection * eventScore, -1, 1) : 0,
    event_source_consensus: sourceCount > 0 ? clamp(eventDirection * Math.min(1, sourceCount / 3) * Math.min(1, eventCount / 3), -1, 1) : 0
  };
}

function crossAssetContext(items) {
  const bySymbol = new Map(items.map((item) => [item.market.symbol, item]));
  const btc = bySymbol.get("BTCUSDT")?.market;
  const eth = bySymbol.get("ETHUSDT")?.market;
  const momentum = items.map((item) => ({ symbol: item.market.symbol, value: safeNumber(roc(item.factorContext?.candles15m?.map((candle) => candle.close) || [], 1)) }));
  const ranked = rank(momentum.map((item) => item.value));
  return Object.fromEntries(items.map((item) => {
    const marketReturns = item.market.returns15m || [];
    const btcReturns = btc?.returns15m || [];
    const betaDenominator = correlation(btcReturns, btcReturns);
    const beta = betaDenominator ? safeNumber(correlation(marketReturns, btcReturns)) * std(marketReturns) / Math.max(std(btcReturns), 1e-9) : 0;
    const ownReturn = safeNumber(momentum.find((entry) => entry.symbol === item.market.symbol)?.value);
    const btcReturn = safeNumber(momentum.find((entry) => entry.symbol === "BTCUSDT")?.value);
    const ethReturn = safeNumber(momentum.find((entry) => entry.symbol === "ETHUSDT")?.value);
    const rankIndex = momentum.findIndex((entry) => entry.symbol === item.market.symbol);
    return [item.market.symbol, {
      btcBetaResidual: clamp((ownReturn - beta * btcReturn) / 0.02, -1, 1),
      ethBtcRelativeStrength: clamp((ownReturn - mean([btcReturn, ethReturn])) / 0.02, -1, 1),
      momentumRank: ranked.length > 1 ? (ranked[rankIndex] - 1) / (ranked.length - 1) * 2 - 1 : 0,
      btcCorrelation: finiteOrNull(correlation(marketReturns, btcReturns))
    }];
  }));
}

function minedValue(definition, values) {
  const left = finiteOrNull(values[definition.leftId]);
  const right = finiteOrNull(values[definition.rightId]);
  if (left == null || right == null) return null;
  if (definition.operator === "difference") return clamp((left - right) / 2, -1, 1);
  if (definition.operator === "agreement") return clamp(((left + right) / 2) * (1 - Math.abs(left - right) / 2), -1, 1);
  return clamp((left + right) / 2, -1, 1);
}

export function buildFactorSnapshots({ marketResults = [], eventsBySymbol = {}, sessionContext = null, status = null }) {
  const normalizedStatus = normalizeFactorLibraryStatus(status);
  const crossAsset = crossAssetContext(marketResults.filter((item) => item?.market));
  return marketResults.filter((item) => item?.market).map((item) => {
    const context = {
      market: item.market,
      ...(item.factorContext || {}),
      eventAggregate: eventsBySymbol[item.market.symbol] || {},
      sessionContext,
      barMinutes: safeNumber(item.factorContext?.barMinutes, 1),
      crossAsset: crossAsset[item.market.symbol] || {}
    };
    const values = factorValueMap(context);
    for (const definition of normalizedStatus.minedFactors) values[definition.id] = minedValue(definition, values);
    return {
      symbol: item.market.symbol,
      price: safeNumber(item.market.latest),
      capturedAt: item.factorContext?.capturedAt || item.capturedAt || new Date().toISOString(),
      values: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, round(finiteOrNull(value))])),
      sources: item.factorContext?.derivatives?.sources || {}
    };
  });
}

export function buildHistoricalFactorFrames({ seriesBySymbol = {}, intervalMinutes = 60, status = null, stride = 1 }) {
  const symbols = Object.keys(seriesBySymbol).filter((symbol) => Array.isArray(seriesBySymbol[symbol]) && seriesBySymbol[symbol].length > 0);
  if (symbols.length < MIN_CROSS_SECTION_SYMBOLS) return [];
  const normalizedStatus = normalizeFactorLibraryStatus(status);
  const firstSeries = seriesBySymbol[symbols[0]];
  const commonTimes = firstSeries.map((candle) => safeNumber(candle.time)).filter((time) => time > 0);
  const timeIndexes = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    new Map(seriesBySymbol[symbol].map((candle, index) => [safeNumber(candle.time), index]))
  ]));
  const frames = [];
  const warmup = 95;
  for (let index = warmup; index < commonTimes.length; index += Math.max(1, Math.round(stride))) {
    const capturedAt = new Date(commonTimes[index]).toISOString();
    const marketResults = symbols.map((symbol) => {
      const series = seriesBySymbol[symbol];
      const candleIndex = timeIndexes[symbol].get(commonTimes[index]) ?? -1;
      if (candleIndex < warmup) return null;
      const candles = series.slice(Math.max(0, candleIndex - 119), candleIndex + 1);
      const latest = candles.at(-1)?.close;
      const returns15m = candles.slice(1).map((candle, offset) => {
        const previous = candles[offset]?.close;
        return previous > 0 ? candle.close / previous - 1 : 0;
      });
      return {
        capturedAt,
        market: {
          symbol,
          latest,
          atrPct: 0.01,
          returns15m,
          hiddenMarkov: { signal: null },
          microstructure: {}
        },
        factorContext: {
          capturedAt,
          barMinutes: intervalMinutes,
          candles1m: candles,
          candles15m: candles,
          candles1h: candles,
          derivatives: { sources: { historicalCandles: { available: true, updatedAt: capturedAt } } }
        }
      };
    }).filter(Boolean);
    if (marketResults.length < MIN_CROSS_SECTION_SYMBOLS) continue;
    const snapshots = buildFactorSnapshots({ marketResults, status: normalizedStatus });
    frames.push({
      capturedAt,
      intervalMinutes,
      source: "historical_public_candles",
      prices: Object.fromEntries(snapshots.map((snapshot) => [snapshot.symbol, snapshot.price])),
      values: Object.fromEntries(snapshots.map((snapshot) => [snapshot.symbol, snapshot.values]))
    });
  }
  return frames;
}

function cappedAllocation(items, cap) {
  if (!items.length) return {};
  const effectiveCap = Math.max(cap, 1 / items.length);
  const scores = Object.fromEntries(items.map((item) => [item.id, Math.max(0, safeNumber(item.score))]));
  if (Object.values(scores).every((value) => value <= 0)) for (const item of items) scores[item.id] = 1;
  const result = Object.fromEntries(items.map((item) => [item.id, 0]));
  let remaining = 1;
  let active = items.map((item) => item.id);
  while (active.length && remaining > 1e-12) {
    const total = active.reduce((sum, id) => sum + scores[id], 0);
    const proposed = active.map((id) => ({ id, weight: remaining * (total > 0 ? scores[id] / total : 1 / active.length) }));
    const capped = proposed.filter((item) => item.weight > effectiveCap + 1e-12);
    if (!capped.length) {
      for (const item of proposed) result[item.id] += item.weight;
      break;
    }
    for (const item of capped) {
      result[item.id] = effectiveCap;
      remaining -= effectiveCap;
    }
    const cappedIds = new Set(capped.map((item) => item.id));
    active = active.filter((id) => !cappedIds.has(id));
  }
  return result;
}

function constrainedWeights(definitions, rawScores, config) {
  const active = definitions.filter((definition) => safeNumber(rawScores[definition.id]) > 0);
  if (!active.length) return {};
  const grouped = new Map();
  for (const definition of active) {
    if (!grouped.has(definition.category)) grouped.set(definition.category, []);
    grouped.get(definition.category).push(definition);
  }
  const categoryItems = [...grouped.entries()].map(([id, factors]) => ({
    id,
    score: factors.reduce((sum, definition) => sum + safeNumber(rawScores[definition.id]), 0)
  }));
  const categoryWeights = cappedAllocation(categoryItems, config.maxCategoryWeight);
  const result = {};
  for (const [category, factors] of grouped.entries()) {
    const within = cappedAllocation(
      factors.map((definition) => ({ id: definition.id, score: rawScores[definition.id] })),
      Math.min(1, config.maxFactorWeight / Math.max(categoryWeights[category], 1e-9))
    );
    for (const definition of factors) result[definition.id] = categoryWeights[category] * safeNumber(within[definition.id]);
  }
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  return total > 0 ? Object.fromEntries(Object.entries(result).map(([id, value]) => [id, value / total])) : {};
}

function metricSummary(values, coverageValues, sourceValues = []) {
  const sample = values.filter(Number.isFinite).slice(-MAX_IC_OBSERVATIONS);
  const retainedSources = sourceValues.slice(-sample.length);
  const average = mean(sample);
  const deviation = std(sample);
  return {
    samples: sample.length,
    meanIc: round(average),
    icStd: round(deviation),
    icir: round(deviation > 0 ? average / deviation : 0),
    tStatistic: round(deviation > 0 ? average / (deviation / Math.sqrt(sample.length)) : 0),
    coverage: round(mean(coverageValues.filter(Number.isFinite).slice(-MAX_IC_OBSERVATIONS))),
    lastIc: round(sample.at(-1)),
    historySamples: retainedSources.filter((source) => source === 0).length,
    realtimeSamples: retainedSources.filter((source) => source === 1).length,
    values: sample,
    coverageValues: coverageValues.filter(Number.isFinite).slice(-MAX_IC_OBSERVATIONS),
    sourceValues: retainedSources
  };
}

function appendIc(status, factorId, horizon, ic, coverage, source = "realtime") {
  status.metrics[factorId] = status.metrics[factorId] || {};
  const current = status.metrics[factorId][horizon] || { values: [], coverageValues: [], sourceValues: [] };
  const previousSources = Array.isArray(current.sourceValues) && current.sourceValues.length === (current.values || []).length
    ? current.sourceValues
    : (current.values || []).map(() => 1);
  status.metrics[factorId][horizon] = metricSummary(
    [...(current.values || []), ic],
    [...(current.coverageValues || []), coverage],
    [...previousSources, source === "historical" ? 0 : 1]
  );
}

function removeHistoricalMetricObservations(status) {
  for (const horizons of Object.values(status.metrics || {})) {
    for (const [horizon, metric] of Object.entries(horizons || {})) {
      const values = Array.isArray(metric?.values) ? metric.values : [];
      const coverageValues = Array.isArray(metric?.coverageValues) ? metric.coverageValues : [];
      const sourceValues = Array.isArray(metric?.sourceValues) && metric.sourceValues.length === values.length
        ? metric.sourceValues
        : values.map(() => 1);
      const retainedIndexes = sourceValues.map((source, index) => source === 1 ? index : -1).filter((index) => index >= 0);
      horizons[horizon] = metricSummary(
        retainedIndexes.map((index) => values[index]),
        retainedIndexes.map((index) => coverageValues[index]),
        retainedIndexes.map(() => 1)
      );
    }
  }
}

function resolvePendingFrames(status, snapshots, nowMs, definitions, horizons) {
  const currentPrices = Object.fromEntries(snapshots.map((item) => [item.symbol, item.price]));
  for (const frame of status.pendingFrames) {
    frame.resolvedHorizons = Array.isArray(frame.resolvedHorizons) ? frame.resolvedHorizons : [];
    const capturedMs = Date.parse(frame.capturedAt || "");
    if (!Number.isFinite(capturedMs)) continue;
    for (const horizon of horizons) {
      if (frame.resolvedHorizons.includes(horizon) || nowMs - capturedMs < horizon * 60_000) continue;
      const symbols = Object.keys(frame.prices || {}).filter((symbol) => frame.prices[symbol] > 0 && currentPrices[symbol] > 0);
      const forwardReturns = Object.fromEntries(symbols.map((symbol) => [symbol, currentPrices[symbol] / frame.prices[symbol] - 1]));
      for (const definition of definitions) {
        const factorValues = [];
        const targetReturns = [];
        for (const symbol of symbols) {
          const value = finiteOrNull(frame.values?.[symbol]?.[definition.id]);
          if (value == null) continue;
          factorValues.push(value * safeNumber(definition.orientation, 1));
          targetReturns.push(forwardReturns[symbol]);
        }
        const ic = spearman(factorValues, targetReturns);
        if (ic == null) continue;
        appendIc(status, definition.id, horizon, ic, factorValues.length / Math.max(symbols.length, 1), "realtime");
      }
      frame.resolvedHorizons.push(horizon);
    }
  }
  status.pendingFrames = status.pendingFrames
    .filter((frame) => horizons.some((horizon) => !frame.resolvedHorizons?.includes(horizon)) && nowMs - Date.parse(frame.capturedAt || "") < 2 * Math.max(...horizons) * 60_000)
    .slice(-MAX_PENDING_FRAMES);
}

function resolveHistoricalFrames(status, frames, definitions, horizons) {
  const ordered = frames
    .filter((frame) => Number.isFinite(Date.parse(frame.capturedAt || "")))
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  if (!ordered.length) return 0;
  const byTime = new Map(ordered.map((frame) => [Date.parse(frame.capturedAt), frame]));
  let resolved = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const frame = ordered[index];
    const capturedMs = Date.parse(frame.capturedAt);
    for (const horizon of horizons) {
      const intervalMs = Math.max(1, safeNumber(frame.intervalMinutes, 60)) * 60_000;
      if (horizon * 60_000 % intervalMs !== 0) continue;
      const anchorStep = Math.max(1, Math.round(Math.max(60, horizon) * 60_000 / intervalMs));
      if (index % anchorStep !== 0) continue;
      const targetMs = capturedMs + horizon * 60_000;
      const future = byTime.get(targetMs);
      if (!future) continue;
      const symbols = Object.keys(frame.prices || {}).filter((symbol) => frame.prices[symbol] > 0 && future.prices?.[symbol] > 0);
      const forwardReturns = Object.fromEntries(symbols.map((symbol) => [symbol, future.prices[symbol] / frame.prices[symbol] - 1]));
      for (const definition of definitions) {
        const factorValues = [];
        const targetReturns = [];
        for (const symbol of symbols) {
          const value = finiteOrNull(frame.values?.[symbol]?.[definition.id]);
          if (value == null) continue;
          factorValues.push(value * safeNumber(definition.orientation, 1));
          targetReturns.push(forwardReturns[symbol]);
        }
        const ic = spearman(factorValues, targetReturns);
        if (ic == null) continue;
        appendIc(status, definition.id, horizon, ic, factorValues.length / Math.max(symbols.length, 1), "historical");
        resolved += 1;
      }
    }
  }
  return resolved;
}

function latestAvailability(snapshots, definitions) {
  return Object.fromEntries(definitions.map((definition) => {
    const values = snapshots.map((snapshot) => finiteOrNull(snapshot.values?.[definition.id])).filter((value) => value != null);
    return [definition.id, {
      availableSymbols: values.length,
      totalSymbols: snapshots.length,
      coverage: snapshots.length ? values.length / snapshots.length : 0,
      meanValue: values.length ? round(mean(values)) : null
    }];
  }));
}

function evidenceOrientation(definition, status) {
  if (definition.origin === "mined") {
    return definition.validationStatus === "validated" ? safeNumber(definition.orientation, 1) : null;
  }
  const metric = status.metrics?.[definition.id]?.[PRIMARY_IC_HORIZON_MINUTES];
  if (
    safeNumber(metric?.samples) < MIN_SMART_WEIGHT_SAMPLES ||
    Math.abs(safeNumber(metric?.meanIc)) < 0.02 ||
    Math.abs(safeNumber(metric?.icir)) < 0.1 ||
    Math.abs(safeNumber(metric?.tStatistic)) < 2 ||
    safeNumber(metric?.coverage) < 0.6
  ) return null;
  return safeNumber(metric.meanIc) < 0 ? -1 : 1;
}

function manualWeights(config, definitions, status) {
  const raw = {};
  for (const definition of definitions) {
    const setting = factorSetting(config, definition);
    const orientation = evidenceOrientation(definition, status);
    if (setting.enabled && setting.useInDecision && !setting.archived && definition.role === "direction" && orientation != null) {
      raw[definition.id] = setting.weight;
    }
  }
  return constrainedWeights(definitions, raw, config);
}

function adjustSmartWeights(config, status, definitions, nowMs) {
  const previous = Object.keys(status.effectiveWeights || {}).length
    ? status.effectiveWeights
    : manualWeights(config, definitions, status);
  const raw = {};
  let eligible = 0;
  for (const definition of definitions) {
    const setting = factorSetting(config, definition);
    const metric = status.metrics?.[definition.id]?.[PRIMARY_IC_HORIZON_MINUTES];
    const orientation = evidenceOrientation(definition, status);
    if (!setting.enabled || !setting.useInDecision || setting.archived || definition.role !== "direction" || orientation == null) continue;
    if (safeNumber(metric?.samples) < MIN_SMART_WEIGHT_SAMPLES) {
      raw[definition.id] = Math.max(0.001, safeNumber(previous[definition.id], setting.weight));
      continue;
    }
    eligible += 1;
    const positiveIc = Math.abs(safeNumber(metric.meanIc));
    const stability = clamp(1 - safeNumber(metric.icStd), 0.05, 1);
    raw[definition.id] = Math.max(0.0001, positiveIc * stability * clamp(safeNumber(metric.coverage), 0, 1));
  }
  const candidate = constrainedWeights(definitions, raw, config);
  if (!eligible || !Object.keys(candidate).length) return previous;
  const blendedRaw = {};
  for (const id of new Set([...Object.keys(previous), ...Object.keys(candidate)])) {
    const before = safeNumber(previous[id]);
    const after = safeNumber(candidate[id]);
    blendedRaw[id] = clamp(after, Math.max(0, before - config.maxWeightStep), before + config.maxWeightStep);
  }
  status.lastAdjustmentAt = new Date(nowMs).toISOString();
  status.weightVersion += 1;
  return constrainedWeights(definitions, blendedRaw, config);
}

function approximatePValue(tStatistic) {
  const value = Math.abs(safeNumber(tStatistic));
  return clamp(Math.exp(-0.717 * value - 0.416 * value * value), 0, 1);
}

function updateMinedValidation(status, nowMs) {
  const now = new Date(nowMs).toISOString();
  const candidates = status.minedFactors || [];
  const tests = candidates.map((definition) => {
    const metric = status.metrics?.[definition.id]?.[PRIMARY_IC_HORIZON_MINUTES];
    return { definition, metric, pValue: approximatePValue(metric?.tStatistic) };
  }).filter((item) => safeNumber(item.metric?.samples) >= MIN_MINED_FACTOR_SAMPLES).sort((a, b) => a.pValue - b.pValue);
  let bhCutoff = 0;
  tests.forEach((item, index) => {
    if (item.pValue <= ((index + 1) / tests.length) * 0.1) bhCutoff = item.pValue;
  });
  status.minedFactors = candidates.map((definition) => {
    const metric = status.metrics?.[definition.id]?.[PRIMARY_IC_HORIZON_MINUTES];
    const pValue = approximatePValue(metric?.tStatistic);
    const validated =
      safeNumber(metric?.samples) >= MIN_MINED_FACTOR_SAMPLES &&
      Math.abs(safeNumber(metric?.meanIc)) >= 0.02 &&
      Math.abs(safeNumber(metric?.icir)) >= 0.3 &&
      safeNumber(metric?.coverage) >= 0.8 &&
      bhCutoff > 0 && pValue <= bhCutoff;
    const validationStatus = validated
      ? "validated"
      : safeNumber(metric?.samples) >= MIN_MINED_FACTOR_SAMPLES
        ? "rejected"
        : "quarantine";
    return {
      ...definition,
      orientation: validated
        ? (safeNumber(metric?.meanIc) < 0 ? -1 : 1)
        : safeNumber(definition.orientation, 1),
      validationStatus,
      firstRejectedAt: validationStatus === "rejected"
        ? definition.firstRejectedAt || (definition.validationStatus === "rejected" ? definition.createdAt : null) || now
        : null,
      validation: { samples: safeNumber(metric?.samples), meanIc: metric?.meanIc ?? null, icir: metric?.icir ?? null, tStatistic: metric?.tStatistic ?? null, pValue: round(pValue), bhCutoff: round(bhCutoff) }
    };
  });
  status.mining.validatedCount = status.minedFactors.filter((item) => item.validationStatus === "validated").length;
  status.mining.rejectedCount = status.minedFactors.filter((item) => item.validationStatus === "rejected").length;
}

function retireRejectedFactors(status, nowMs) {
  const retired = [];
  const active = [];
  for (const definition of status.minedFactors || []) {
    const metric = status.metrics?.[definition.id]?.[PRIMARY_IC_HORIZON_MINUTES];
    const rejectedAtMs = Date.parse(definition.firstRejectedAt || "");
    const eligible =
      definition.validationStatus === "rejected" &&
      safeNumber(metric?.samples) >= MIN_RETIRED_FACTOR_SAMPLES &&
      Number.isFinite(rejectedAtMs) &&
      nowMs - rejectedAtMs >= MIN_REJECTED_FACTOR_AGE_MS;
    if (!eligible) {
      active.push(definition);
      continue;
    }
    retired.push({
      ...definition,
      retired: true,
      archived: true,
      retiredAt: new Date(nowMs).toISOString(),
      retirementReason: "failed_validation_after_extended_observation",
      retiredMetrics: Object.fromEntries(
        Object.entries(status.metrics?.[definition.id] || {})
          .map(([horizon, value]) => [horizon, compactMetricEvidence(value)])
      ),
      retiredAvailability: status.latestFactorAvailability?.[definition.id] || null
    });
  }
  if (!retired.length) return new Set();

  const retiredIds = new Set(retired.map((definition) => definition.id));
  status.minedFactors = active;
  status.retiredMinedFactors = normalizeRetiredMinedFactors([
    ...(status.retiredMinedFactors || []),
    ...retired
  ]);
  for (const id of retiredIds) {
    delete status.metrics[id];
    delete status.effectiveWeights[id];
    delete status.latestFactorAvailability[id];
  }
  for (const frame of status.pendingFrames || []) {
    for (const values of Object.values(frame.values || {})) {
      for (const id of retiredIds) delete values[id];
    }
  }
  for (const snapshot of Object.values(status.latestBySymbol || {})) {
    for (const id of retiredIds) delete snapshot?.values?.[id];
  }
  status.mining.retiredCount = status.retiredMinedFactors.length;
  status.mining.lastRetiredAt = new Date(nowMs).toISOString();
  status.mining.rejectedCount = status.minedFactors.filter((item) => item.validationStatus === "rejected").length;
  status.mining.currentActivity = `retired:${retired.length}`;
  return retiredIds;
}

function mineFactor(status, config, definitions, nowMs) {
  if (!config.miningEnabled || status.minedFactors.length >= MAX_ACTIVE_MINED_FACTORS) return;
  const lastRunMs = Date.parse(status.mining.lastRunAt || "");
  if (Number.isFinite(lastRunMs) && nowMs - lastRunMs < config.miningIntervalMinutes * 60_000) return;
  const candidates = definitions.filter((definition) => definition.origin === "built_in" && definition.role === "direction");
  const scored = candidates.map((definition) => ({
    definition,
    score: Math.abs(safeNumber(status.metrics?.[definition.id]?.[PRIMARY_IC_HORIZON_MINUTES]?.meanIc)) + (definition.defaultEnabled ? 0.01 : 0)
  })).sort((a, b) => b.score - a.score);
  const existing = new Set([
    ...status.minedFactors.map(minedSemanticKey),
    ...(status.retiredMinedFactors || []).map(minedSemanticKey)
  ]);
  const pairUsage = new Map();
  const operatorUsage = new Map();
  for (const definition of status.minedFactors) {
    const pairKey = minedPairKey(definition.leftId, definition.rightId);
    pairUsage.set(pairKey, safeNumber(pairUsage.get(pairKey)) + 1);
    operatorUsage.set(definition.operator, safeNumber(operatorUsage.get(definition.operator)) + 1);
  }
  const operators = ["agreement", "blend", "difference"];
  const candidateSpace = [];
  for (let leftIndex = 0; leftIndex < Math.min(scored.length, 12); leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < Math.min(scored.length, 12); rightIndex += 1) {
      for (const operator of operators) {
        const left = scored[leftIndex].definition;
        const right = scored[rightIndex].definition;
        const semanticKey = minedSemanticKey({ leftId: left.id, rightId: right.id, operator });
        if (existing.has(semanticKey)) continue;
        const pairKey = minedPairKey(left.id, right.id);
        candidateSpace.push({
          left,
          right,
          operator,
          semanticKey,
          pairUsage: safeNumber(pairUsage.get(pairKey)),
          operatorUsage: safeNumber(operatorUsage.get(operator)),
          parentScore: scored[leftIndex].score + scored[rightIndex].score
        });
      }
    }
  }
  candidateSpace.sort((left, right) =>
    left.pairUsage - right.pairUsage ||
    left.operatorUsage - right.operatorUsage ||
    right.parentScore - left.parentScore ||
    left.semanticKey.localeCompare(right.semanticKey)
  );
  const selected = candidateSpace[0] || null;
  status.mining.lastRunAt = new Date(nowMs).toISOString();
  status.mining.runCount += 1;
  if (!selected) {
    status.mining.currentActivity = "candidate_space_exhausted";
    return;
  }
  const orderedParents = [selected.left, selected.right].sort((left, right) => left.id.localeCompare(right.id));
  const left = orderedParents[0];
  const right = orderedParents[1];
  const id = `mined_${selected.operator}_${left.id}_${right.id}`;
  status.minedFactors.push(minedFactorPresentation({
    id,
    name: "",
    category: "",
    role: "direction",
    source: "",
    description: "",
    origin: "mined",
    orientation: 1,
    defaultEnabled: false,
    defaultUseInDecision: false,
    defaultWeight: 1,
    formula: "",
    leftId: left.id,
    rightId: right.id,
    operator: selected.operator,
    createdAt: new Date(nowMs).toISOString(),
    validationStatus: "quarantine"
  }));
  status.mining.currentActivity = `generated:${id}`;
}

export function factorDecisionForSnapshot(snapshot, configValue, statusValue) {
  const status = normalizeFactorLibraryStatus(statusValue);
  const definitions = allDefinitions(status);
  const config = normalizeFactorLibraryConfig(configValue, status.minedFactors);
  if (!config.enabled) return { composite: 0, influence: 0, coverage: 0, activeFactors: [], weightVersion: status.weightVersion };
  const weights = Object.keys(status.effectiveWeights || {}).length ? status.effectiveWeights : manualWeights(config, definitions, status);
  const activeFactors = [];
  let weighted = 0;
  let activeWeight = 0;
  let requested = 0;
  for (const definition of definitions) {
    const setting = factorSetting(config, definition);
    const orientation = evidenceOrientation(definition, status);
    if (!setting.enabled || !setting.useInDecision || setting.archived || definition.role !== "direction" || orientation == null) continue;
    requested += 1;
    const value = finiteOrNull(snapshot?.values?.[definition.id]);
    const weight = safeNumber(weights[definition.id]);
    if (value == null || weight <= 0) continue;
    weighted += value * orientation * weight;
    activeWeight += weight;
    activeFactors.push({ id: definition.id, value, weight, orientation, contribution: value * orientation * weight });
  }
  const coverage = requested > 0 ? activeFactors.length / requested : 0;
  const minimumActiveFactors = Math.max(4, Math.ceil(1 / Math.max(config.maxFactorWeight, 1e-9)));
  const sufficient = activeFactors.length >= minimumActiveFactors && coverage >= 0.5;
  return {
    composite: activeWeight > 0 ? clamp(weighted / activeWeight, -1, 1) : 0,
    influence: sufficient ? config.decisionInfluence * clamp(coverage, 0.5, 1) : 0,
    coverage,
    activeFactors,
    requestedFactors: requested,
    minimumActiveFactors,
    weightVersion: status.weightVersion,
    sufficient
  };
}

export function updateFactorLibraryRuntime({ config: configValue, status: statusValue, snapshots = [], historicalFrames = [], now = new Date().toISOString() }) {
  const nowMs = Date.parse(now);
  const status = normalizeFactorLibraryStatus(statusValue);
  let definitions = allDefinitions(status);
  const config = normalizeFactorLibraryConfig(configValue, status.minedFactors);
  status.generatedAt = now;
  status.mining.enabled = config.miningEnabled;
  if (!Number.isFinite(nowMs)) return { config, status };

  if (
    historicalFrames.length &&
    (
      status.historicalBackfill.status !== "complete" ||
      safeNumber(status.historicalBackfill.version) !== HISTORICAL_BACKFILL_VERSION ||
      status.historicalBackfill.samplingMode !== "hourly_anchors_non_overlapping_v2"
    )
  ) {
    removeHistoricalMetricObservations(status);
    status.historicalBackfill.status = "processing";
    status.historicalBackfill.symbols = new Set(historicalFrames.flatMap((frame) => Object.keys(frame.prices || {}))).size;
    status.historicalBackfill.frames = historicalFrames.length;
    status.historicalBackfill.intervalMinutes = safeNumber(historicalFrames[0]?.intervalMinutes, 60);
    const historicalResolved = resolveHistoricalFrames(status, historicalFrames, definitions, config.horizonsMinutes);
    status.historicalBackfill.status = "complete";
    status.historicalBackfill.version = HISTORICAL_BACKFILL_VERSION;
    status.historicalBackfill.samplingMode = "hourly_anchors_non_overlapping_v2";
    status.historicalBackfill.completedAt = now;
    status.historicalBackfill.resolvedSamples = historicalResolved;
    status.historicalBackfill.startAt = historicalFrames[0]?.capturedAt || null;
    status.historicalBackfill.endAt = historicalFrames.at(-1)?.capturedAt || null;
  }
  resolvePendingFrames(status, snapshots, nowMs, definitions, config.horizonsMinutes);
  updateMinedValidation(status, nowMs);
  const retiredIds = retireRejectedFactors(status, nowMs);
  for (const snapshot of snapshots) {
    for (const id of retiredIds) delete snapshot?.values?.[id];
  }
  definitions = allDefinitions(status);
  mineFactor(status, config, definitions, nowMs);
  definitions = allDefinitions(status);
  for (const snapshot of snapshots) {
    for (const definition of status.minedFactors) {
      if (!Object.hasOwn(snapshot.values, definition.id)) snapshot.values[definition.id] = round(minedValue(definition, snapshot.values));
    }
  }

  const lastFrameMs = Date.parse(status.lastFrameAt || "");
  if (!Number.isFinite(lastFrameMs) || nowMs - lastFrameMs >= config.captureIntervalSeconds * 1_000) {
    status.pendingFrames.push({
      capturedAt: now,
      prices: Object.fromEntries(snapshots.filter((item) => item.price > 0).map((item) => [item.symbol, item.price])),
      values: Object.fromEntries(snapshots.map((item) => [item.symbol, item.values])),
      resolvedHorizons: []
    });
    status.pendingFrames = status.pendingFrames.slice(-MAX_PENDING_FRAMES);
    status.lastFrameAt = now;
  }

  const lastAdjustmentMs = Date.parse(status.lastAdjustmentAt || "");
  if (!config.intelligentAdjustment) {
    status.effectiveWeights = manualWeights(config, definitions, status);
  } else if (!Number.isFinite(lastAdjustmentMs) || nowMs - lastAdjustmentMs >= config.adjustmentIntervalMinutes * 60_000) {
    status.effectiveWeights = adjustSmartWeights(config, status, definitions, nowMs);
  }
  status.latestBySymbol = Object.fromEntries(snapshots.map((item) => [item.symbol, { price: item.price, capturedAt: item.capturedAt, values: item.values }]));
  status.latestFactorAvailability = latestAvailability(snapshots, definitions);
  status.dataSources = snapshots.reduce((result, snapshot) => {
    for (const [key, value] of Object.entries(snapshot.sources || {})) {
      const current = result[key] || { availableSymbols: 0, failedSymbols: 0, lastUpdatedAt: null };
      if (value?.available) current.availableSymbols += 1;
      else current.failedSymbols += 1;
      current.lastUpdatedAt = value?.updatedAt || current.lastUpdatedAt;
      result[key] = current;
    }
    return result;
  }, {});
  if (status.historicalBackfill.status === "complete") {
    status.dataSources.historicalCandles = {
      availableSymbols: safeNumber(status.historicalBackfill.symbols),
      failedSymbols: 0,
      lastUpdatedAt: status.historicalBackfill.completedAt,
      lookbackMonths: status.historicalBackfill.lookbackMonths,
      intervalMinutes: status.historicalBackfill.intervalMinutes
    };
  }
  status.mining.currentActivity = config.miningEnabled ? status.mining.currentActivity : "disabled";
  return { config, status };
}

function publicMetric(metric) {
  return compactMetricEvidence(metric);
}

export function publicFactorLibrary(configValue, statusValue) {
  const status = normalizeFactorLibraryStatus(statusValue);
  const definitions = allDefinitions(status);
  const publicDefinitions = [...definitions, ...(status.retiredMinedFactors || [])];
  const config = normalizeFactorLibraryConfig(configValue, [
    ...status.minedFactors,
    ...(status.retiredMinedFactors || [])
  ]);
  const minimumActiveFactors = Math.max(4, Math.ceil(1 / Math.max(config.maxFactorWeight, 1e-9)));
  const eligibleDecisionIds = new Set(definitions.filter((definition) => {
    const setting = factorSetting(config, definition);
    return setting.enabled && setting.useInDecision && !setting.archived && definition.role === "direction" && evidenceOrientation(definition, status) != null;
  }).map((definition) => definition.id));
  const decisionReady = eligibleDecisionIds.size >= minimumActiveFactors;
  const factors = publicDefinitions.map((definition) => {
    const setting = factorSetting(config, definition);
    const metrics = Object.fromEntries(config.horizonsMinutes.map((horizon) => [
      horizon,
      publicMetric(status.metrics?.[definition.id]?.[horizon] || definition.retiredMetrics?.[horizon])
    ]));
    const primary = metrics[PRIMARY_IC_HORIZON_MINUTES];
    const availability = status.latestFactorAvailability?.[definition.id] || definition.retiredAvailability || { availableSymbols: 0, totalSymbols: 0, coverage: 0, meanValue: null };
    const primaryMeanIc = safeNumber(primary?.meanIc);
    const primaryIcIr = safeNumber(primary?.icir);
    const primaryT = safeNumber(primary?.tStatistic);
    const primaryCoverage = safeNumber(primary?.coverage);
    const evidenceStatus = availability.availableSymbols <= 0
      ? "data_unavailable"
      : safeNumber(primary?.samples) < MIN_SMART_WEIGHT_SAMPLES
        ? "insufficient_samples"
        : Math.abs(primaryMeanIc) >= 0.02 && Math.abs(primaryIcIr) >= 0.1 && Math.abs(primaryT) >= 2 && primaryCoverage >= 0.6
          ? primaryMeanIc >= 0 ? "effective" : "inverse_effective"
          : "unstable";
    return {
      ...definition,
      ...setting,
      enabled: definition.retired ? false : setting.enabled,
      useInDecision: definition.retired ? false : setting.useInDecision,
      archived: definition.retired === true || setting.archived,
      effectiveWeight: decisionReady && eligibleDecisionIds.has(definition.id)
        ? safeNumber(status.effectiveWeights?.[definition.id])
        : 0,
      availability,
      evidenceStatus,
      metrics
    };
  });
  return {
    generatedAt: status.generatedAt,
    version: FACTOR_LIBRARY_VERSION,
    weightVersion: status.weightVersion,
    config,
    counts: {
      total: factors.filter((item) => !item.archived).length,
      enabled: factors.filter((item) => item.enabled && !item.archived).length,
      inDecision: factors.filter((item) => item.enabled && item.useInDecision && !item.archived).length,
      decisionEligible: eligibleDecisionIds.size,
      mined: factors.filter((item) => item.origin === "mined" && !item.archived).length,
      validatedMined: factors.filter((item) => item.origin === "mined" && item.validationStatus === "validated" && !item.archived).length,
      retiredMined: factors.filter((item) => item.origin === "mined" && item.retired === true).length
    },
    factors,
    mining: status.mining,
    dataSources: status.dataSources,
    pendingFrameCount: status.pendingFrames.length,
    decisionReadiness: {
      ready: decisionReady,
      eligibleFactors: eligibleDecisionIds.size,
      minimumActiveFactors,
      reason: decisionReady ? null : "通过证据门槛的方向因子不足，因子组合暂不影响交易判断。"
    },
    historicalBackfill: status.historicalBackfill,
    samplingPolicy: {
      usesPaperPositions: false,
      runsWhenPaperEntriesPaused: true,
      realtimeSource: "public market candles, order book, trades and derivatives statistics",
      historicalSource: status.historicalBackfill.source,
      icMethod: "cross-sectional Spearman correlation between factor ranks and forward returns"
    },
    limitations: [
      "IC is a rolling predictive association, not proof of causality or future profitability.",
      "Mined factors remain quarantined until sample, ICIR, coverage, t-statistic and multiple-testing gates pass.",
      "Rejected mined factors retire only after extended observation; compact evidence is archived and the same semantic formula is not mined again.",
      "Unavailable source data is represented as null and is never replaced with fabricated values."
    ]
  };
}
