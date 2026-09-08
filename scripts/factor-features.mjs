// Pure feature catalog and market transforms. No IC, mining, publication or weight writer.
import { validateResearchCatalog } from "./factor-research.mjs";
import { analyzeGeometricBrownianMotion, analyzeHiddenMarkovRegime, estimateGarch11 } from "./model-factors.mjs";
const MIN_CROSS_SECTION_SYMBOLS = 8;
export const FACTOR_RESEARCH_REFERENCES = Object.freeze({
  formulaic_alpha: Object.freeze({
    title: "101 Formulaic Alphas",
    url: "https://arxiv.org/abs/1601.00991",
    scope: "价格、成交量和横截面公式因子的公开机制基线"
  }),
  range_volatility: Object.freeze({
    title: "The Extreme Value Method for Estimating the Variance of the Rate of Return",
    url: "https://doi.org/10.1086/296071",
    scope: "高低价区间波动估计"
  }),
  rogers_satchell: Object.freeze({
    title: "Estimating Variance From High, Low and Closing Prices",
    url: "https://doi.org/10.1214/aoap/1177005835",
    scope: "允许价格漂移的OHLC区间波动估计"
  }),
  yang_zhang: Object.freeze({
    title: "Drift-Independent Volatility Estimation Based on High, Low, Open, and Close Prices",
    url: "https://doi.org/10.1086/209650",
    scope: "漂移无关并处理开盘跳跃的OHLC波动估计"
  }),
  realized_jumps: Object.freeze({
    title: "Realized Volatility and Bipower Variation",
    url: "https://public.econ.duke.edu/~boller/Published_Papers/joe_07.pdf",
    scope: "实现波动、双幂变差和跳跃分解"
  }),
  order_flow_imbalance: Object.freeze({
    title: "The Price Impact of Order Book Events",
    url: "https://arxiv.org/abs/1011.6402",
    scope: "订单流不平衡、盘口深度与短期价格冲击"
  }),
  illiquidity: Object.freeze({
    title: "Illiquidity and Stock Returns: Cross-section and Time-series Effects",
    url: "https://doi.org/10.1016/S0304-405X(01)00024-6",
    scope: "收益相对成交额的非流动性代理"
  }),
  perpetual_markets: Object.freeze({
    title: "Reconciling Open Interest with Traded Volume in Perpetual Swaps",
    url: "https://arxiv.org/abs/2310.14973",
    scope: "永续合约、资金费率、未平仓量和强平数据的适用边界"
  }),
  factor_evaluation: Object.freeze({
    title: "Alphalens Reloaded",
    url: "https://github.com/stefan-jansen/alphalens-reloaded",
    scope: "IC、分组收益、换手率和因子诊断方法"
  }),
  factor_pipeline: Object.freeze({
    title: "Microsoft Qlib",
    url: "https://github.com/microsoft/qlib",
    scope: "时点一致的数据、因子表达式、研究与回测工作流"
  }),
  technical_analysis: Object.freeze({
    title: "Foundations of Technical Analysis",
    url: "https://www.nber.org/papers/w7613",
    scope: "将主观图形和技术信号转化为可重复统计检验"
  }),
  ta_lib: Object.freeze({
    title: "TA-Lib",
    url: "https://github.com/TA-Lib/ta-lib",
    scope: "常见技术指标的开源实现参照；本项目未引入其运行时依赖"
  }),
  crypto_factors: Object.freeze({
    title: "Common Risk Factors in Cryptocurrency",
    url: "https://economics.yale.edu/research/common-risk-factors-cryptocurrency",
    scope: "加密资产横截面市场、规模与动量因子"
  }),
  openfe: Object.freeze({
    title: "OpenFE",
    url: "https://github.com/IIIS-Li-Group/OpenFE",
    scope: "扩展—缩减、粗筛—精筛的自动特征生成流程"
  }),
  gplearn: Object.freeze({
    title: "gplearn SymbolicTransformer",
    url: "https://github.com/trevorstephens/gplearn",
    scope: "以相关性为目标并从优胜表达式中去除高度相关候选"
  }),
  alphagen: Object.freeze({
    title: "AlphaGen",
    url: "https://github.com/ICT-FinD-Lab/alphagen",
    scope: "协同公式因子集合与增量组合评价；仅借鉴研究思想，未复制无明确许可代码"
  }),
  discrete_fourier_transform: Object.freeze({
    title: "An Algorithm for the Machine Calculation of Complex Fourier Series",
    url: "https://doi.org/10.1090/S0025-5718-1965-0178586-1",
    scope: "离散频域分解的计算基础；交易有效性仍需本项目样本外证据"
  })
});

const FACTOR_CATEGORY_RESEARCH = Object.freeze({
  "价格与趋势": Object.freeze({ basis: "可解释的价格路径、趋势与均值回归变换", references: ["formulaic_alpha", "technical_analysis", "ta_lib", "factor_evaluation"], data: ["public_ohlcv"] }),
  "波动率与分布": Object.freeze({ basis: "收益分布、区间估计与连续/跳跃波动分解", references: ["range_volatility", "realized_jumps", "factor_evaluation"], data: ["public_ohlcv"] }),
  "成交量与成交流": Object.freeze({ basis: "价格与成交量、主动成交方向的可检验联合关系", references: ["formulaic_alpha", "ta_lib", "order_flow_imbalance", "factor_evaluation"], data: ["public_ohlcv", "public_trades"] }),
  "订单簿与微观结构": Object.freeze({ basis: "盘口供需、订单事件和流动性对短期价格的影响", references: ["order_flow_imbalance", "illiquidity", "factor_evaluation"], data: ["public_order_book", "public_trades"] }),
  "合约衍生品": Object.freeze({ basis: "永续合约拥挤、基差、未平仓量与强平的状态代理", references: ["perpetual_markets", "factor_evaluation"], data: ["public_derivatives"] }),
  "市场状态与跨资产": Object.freeze({ basis: "横截面相对价值、共同风险暴露与市场状态", references: ["crypto_factors", "factor_pipeline", "factor_evaluation"], data: ["multi_symbol_public_ohlcv"] }),
  "模型与频域": Object.freeze({ basis: "将模型输出和离散频域特征作为可隔离、可检验的因子，而非底层无条件规则", references: ["discrete_fourier_transform", "factor_pipeline", "factor_evaluation"], data: ["public_ohlcv"] })
});

function factor(id, name, category, role, source, description, options = {}) {
  const research = FACTOR_CATEGORY_RESEARCH[category] || FACTOR_CATEGORY_RESEARCH["价格与趋势"];
  return Object.freeze({
    id,
    name,
    category,
    role,
    decisionLayer: options.decisionLayer || (role === "context" ? "probability" : role),
    source,
    description,
    origin: "built_in",
    orientation: 1,
    defaultEnabled: options.defaultEnabled === true,
    defaultUseInDecision: options.defaultUseInDecision === true,
    defaultWeight: Number.isFinite(options.defaultWeight) ? options.defaultWeight : 1,
    governanceTarget: options.governanceTarget || null,
    governanceOnly: options.governanceTarget != null,
    autoGovernanceEligible: options.autoGovernanceEligible === true,
    formula: options.formula || null,
    implementationKey: id,
    researchBasis: options.researchBasis || research.basis,
    referenceIds: Object.freeze([...(options.referenceIds || research.references)]),
    dataRequirements: Object.freeze([...(options.dataRequirements || research.data)]),
    catalogStatus: "mechanism_validated",
    catalogValidation: "公开机制依据 + 数据可得性 + 公式静态校验；交易有效性仍需本项目样本外证据"
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
  factor("return_3m", "3分钟收益率", "价格与趋势", "direction", "公共K线", "三分钟价格动量；短于可用K线粒度时保持不可用。"),
  factor("return_10m", "10分钟收益率", "价格与趋势", "direction", "公共K线", "十分钟价格动量；短于可用K线粒度时保持不可用。"),
  factor("return_30m", "30分钟收益率", "价格与趋势", "direction", "公共K线", "三十分钟价格动量。"),
  factor("ema_spread_10_50", "EMA 10/50差值", "价格与趋势", "direction", "K线计算", "中短周期与长周期指数均线的波动归一化差值。"),
  factor("price_acceleration_5_20", "价格加速度 5/20", "价格与趋势", "direction", "K线计算", "短期动量相对中期动量的变化，识别趋势加速与衰减。"),
  factor("linear_trend_slope_20", "线性趋势斜率", "价格与趋势", "direction", "K线计算", "最近20根对数价格的最小二乘斜率，经波动归一化。"),
  factor("trend_fit_r2_20", "趋势拟合度 R²", "价格与趋势", "risk", "K线计算", "最近20根价格线性趋势的拟合度，只衡量趋势可解释度，不决定方向。"),
  factor("stochastic_reversal", "随机指标反转", "价格与趋势", "direction", "K线计算", "收盘价在近期高低区间的位置，经反向处理用于检验均值回归。"),
  factor("williams_r_reversal", "Williams %R反转", "价格与趋势", "direction", "K线计算", "Williams %R的居中反向信号，与随机指标采用不同的平滑区间。"),
  factor("bollinger_reversal", "布林偏离反转", "价格与趋势", "direction", "K线计算", "价格相对20期均值的标准化偏离，反向检验均值回归。"),
  factor("cci_reversal", "CCI反转", "价格与趋势", "direction", "K线计算", "典型价格相对滚动均值和平均绝对偏差的反向信号。"),
  factor("aroon_oscillator", "Aroon振荡", "价格与趋势", "direction", "K线计算", "近期最高点和最低点出现时间差形成的趋势方向信号。"),

  factor("realized_volatility", "实现波动率", "波动率与分布", "risk", "K线计算", "滚动实现波动率。"),
  factor("volatility_zscore", "波动率Z分数", "波动率与分布", "risk", "K线计算", "短期波动相对历史基线的偏离。"),
  factor("range_expansion", "区间扩张", "波动率与分布", "risk", "K线计算", "当前高低区间相对历史平均区间的扩张程度。"),
  factor("range_compression", "区间压缩", "波动率与分布", "risk", "K线计算", "低波动压缩状态，供突破逻辑使用。"),
  factor("parkinson_volatility", "Parkinson波动率", "波动率与分布", "risk", "K线计算", "使用最高价和最低价估算的波动率。"),
  factor("garman_klass_volatility", "Garman-Klass波动率", "波动率与分布", "risk", "K线计算", "使用开高低收估算的波动率。"),
  factor("downside_semivolatility", "下行半波动率", "波动率与分布", "risk", "K线计算", "只统计负收益的半波动率。"),
  factor("jump_intensity", "跳跃强度", "波动率与分布", "risk", "K线计算", "异常大收益出现频率与幅度。"),
  factor("rogers_satchell_volatility", "Rogers-Satchell波动率", "波动率与分布", "risk", "公共OHLC K线", "考虑开收方向且对非零漂移更稳健的区间波动估计。", { referenceIds: ["rogers_satchell", "factor_evaluation"] }),
  factor("yang_zhang_volatility", "Yang-Zhang波动率", "波动率与分布", "risk", "公共OHLC K线", "融合隔夜、开收和区间分量的波动估计；连续市场中隔夜项通常较小。", { referenceIds: ["yang_zhang", "factor_evaluation"] }),
  factor("upside_semivolatility", "上行半波动率", "波动率与分布", "risk", "K线计算", "只统计正收益的半波动率，与下行半波动率共同描述不对称。"),
  factor("realized_skewness", "实现偏度", "波动率与分布", "risk", "K线计算", "近期收益分布的标准化三阶矩。"),
  factor("realized_kurtosis", "实现超额峰度", "波动率与分布", "risk", "K线计算", "近期收益分布的超额四阶矩，反映厚尾风险。"),
  factor("bipower_jump_ratio", "双幂跳跃占比", "波动率与分布", "risk", "K线计算", "实现方差超过双幂变差的比例，作为跳跃成分代理。"),
  factor("volatility_of_volatility", "波动率的波动", "波动率与分布", "risk", "K线计算", "多个滚动窗口实现波动率的离散程度。"),
  factor("return_entropy", "收益符号熵", "波动率与分布", "risk", "K线计算", "近期涨跌与近零收益状态的离散熵，衡量路径不确定性。"),

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
  factor("money_flow_index", "资金流量指标", "成交量与成交流", "direction", "公共OHLCV K线", "典型价格方向加权成交量形成的资金流强弱，并居中为方向信号。"),
  factor("chaikin_money_flow", "Chaikin资金流", "成交量与成交流", "direction", "公共OHLCV K线", "收盘价在高低区间的位置乘以成交量，衡量累积买卖压力。"),
  factor("accumulation_distribution_slope", "累积派发线斜率", "成交量与成交流", "direction", "公共OHLCV K线", "资金流量乘数累计值的近期归一化斜率。"),
  factor("force_index", "Force Index", "成交量与成交流", "direction", "公共OHLCV K线", "价格变化与成交量的乘积，经近期绝对规模归一化。"),
  factor("ease_of_movement", "Ease of Movement", "成交量与成交流", "direction", "公共OHLCV K线", "中间价变化相对成交量和区间宽度的移动便利度。"),
  factor("volume_weighted_momentum", "成交量加权动量", "成交量与成交流", "direction", "公共OHLCV K线", "近期收益按相对成交量加权，区分放量与缩量价格变化。"),
  factor("volume_trend_confirmation", "量价趋势确认", "成交量与成交流", "direction", "公共OHLCV K线", "价格动量与成交量变化方向的交互确认。"),
  factor("signed_trade_intensity", "有向成交强度", "成交量与成交流", "direction", "实时公共成交", "主动买卖不平衡乘以成交频率置信度。", { dataRequirements: ["public_trades"] }),

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
  factor("quoted_depth", "可见报价深度", "订单簿与微观结构", "context", "实时五档盘口", "买卖两侧可见名义深度的对数缩放值。", { dataRequirements: ["public_order_book"] }),
  factor("depth_concentration", "盘口深度集中度", "订单簿与微观结构", "risk", "实时五档盘口", "最优档深度占可见总深度的比例，识别表层流动性集中。", { dataRequirements: ["public_order_book"] }),
  factor("weighted_book_pressure", "深度加权盘口压力", "订单簿与微观结构", "direction", "实时五档盘口", "L1与L5不平衡按近端权重融合。", { dataRequirements: ["public_order_book"] }),
  factor("order_flow_persistence", "订单流持续性", "订单簿与微观结构", "direction", "实时公共成交", "5秒与30秒主动成交方向一致时保留信号，分歧时衰减。", { dataRequirements: ["public_trades"] }),
  factor("cancel_to_add_ratio", "撤单/挂单比", "订单簿与微观结构", "risk", "实时五档盘口", "近期撤单名义量相对新增挂单名义量的比例。", { dataRequirements: ["public_order_book"] }),
  factor("depth_adjusted_ofi", "深度调整订单流", "订单簿与微观结构", "direction", "实时成交与盘口", "订单流不平衡按可见深度和数据置信度调整。", { dataRequirements: ["public_order_book", "public_trades"] }),

  factor("funding_zscore", "资金费率Z分数", "合约衍生品", "context", "OKX资金费率历史", "当前资金费率相对近期历史的偏离。"),
  factor("funding_price_divergence", "资金费率价格背离", "合约衍生品", "direction", "价格与资金费率", "价格方向与拥挤资金费率的背离。"),
  factor("open_interest_change", "OI变化率", "合约衍生品", "context", "OKX/Binance OI", "未平仓量相对上一观察值的变化。"),
  factor("oi_price_confirmation", "OI价格确认", "合约衍生品", "direction", "价格与OI", "价格方向是否得到新增持仓确认。", { defaultEnabled: true, defaultUseInDecision: true }),
  factor("perpetual_basis", "永续合约基差", "合约衍生品", "direction", "OKX标记价与指数价", "永续标记价相对现货指数的偏离。"),
  factor("liquidation_imbalance", "强平方向不平衡", "合约衍生品", "direction", "OKX公开强平订单", "多头与空头强平名义量的方向差。"),
  factor("long_short_ratio", "多空账户比", "合约衍生品", "direction", "OKX合约统计", "全市场多空账户比的拥挤反向信号。"),
  factor("basis_volatility", "基差波动率", "合约衍生品", "risk", "OKX标记价与指数价", "基差变化的滚动波动率；历史不足时不可用。"),
  factor("taker_oi_confirmation", "主动成交/OI确认", "合约衍生品", "direction", "公开主动成交与OI", "主动成交方向与未平仓量变化共同确认新仓推动。"),
  factor("liquidation_price_confirmation", "强平/价格确认", "合约衍生品", "direction", "公开强平与价格", "强平方向与短期价格变化的交互，区分顺势踩踏与吸收。"),
  factor("leverage_crowding_risk", "杠杆拥挤风险", "合约衍生品", "risk", "资金费率与OI", "资金费率极端程度与未平仓量变化绝对值的联合风险。"),
  factor("basis_dislocation_risk", "基差脱锚风险", "合约衍生品", "risk", "标记价与指数价", "永续标记价相对指数价偏离的绝对程度。"),
  factor("derivatives_consensus", "衍生品方向共识", "合约衍生品", "direction", "公开合约统计", "OI价格确认、主动成交与强平信号的稳健中位融合。"),

  factor("btc_beta_residual", "BTC Beta残差", "市场状态与跨资产", "direction", "跨资产K线", "剔除BTC共同波动后的相对收益。"),
  factor("eth_btc_relative_strength", "ETH/BTC相对强弱", "市场状态与跨资产", "direction", "跨资产K线", "相对BTC和ETH基准的强弱。"),
  factor("cross_section_momentum_rank", "横截面动量排名", "市场状态与跨资产", "direction", "多标的K线", "同一时点全部监控标的的动量分位。"),
  factor("correlation_regime", "滚动相关性状态", "市场状态与跨资产", "risk", "跨资产K线", "标的与BTC滚动相关性。"),
  factor("market_session", "交易时段因子", "市场状态与跨资产", "context", "UTC交易时段", "亚洲、欧洲、美国及交会时段的策略上下文。"),
  factor("news_impact_decay", "消息影响衰减", "市场状态与跨资产", "direction", "消息聚合", "消息方向乘以时效影响。"),
  factor("event_source_consensus", "多消息源一致性", "市场状态与跨资产", "direction", "消息聚合", "独立来源方向一致程度。"),
  factor("btc_lead_lag", "BTC领先滞后", "市场状态与跨资产", "direction", "跨资产K线", "BTC前一期收益与标的当期相对收益的方向差。"),
  factor("market_breadth", "市场涨跌宽度", "市场状态与跨资产", "context", "多标的公共K线", "同一时点上涨标的占比的居中值，只作为市场状态。"),
  factor("cross_section_dispersion", "横截面收益偏离度", "市场状态与跨资产", "risk", "多标的公共K线", "单一标的相对横截面平均收益的绝对偏离，并用当期离散度归一化。"),
  factor("beta_instability", "BTC Beta不稳定度", "市场状态与跨资产", "risk", "跨资产K线", "短窗与长窗BTC Beta差异的绝对值。"),
  factor("cross_section_residual_momentum", "市场中性残差动量", "市场状态与跨资产", "direction", "多标的公共K线", "标的收益减去横截面平均收益，降低共同市场方向暴露。"),

  factor("fourier_dominant_phase", "傅里叶主周期相位", "模型与频域", "direction", "闭合15分钟K线DFT", "对去趋势对数价格执行离散傅里叶变换，以主频下一步相位变化形成方向信号；默认只影子观察。", {
    defaultEnabled: true,
    defaultUseInDecision: false,
    autoGovernanceEligible: true,
    referenceIds: ["discrete_fourier_transform", "factor_evaluation"]
  }),
  factor("fourier_spectral_concentration", "傅里叶频谱集中度", "模型与频域", "context", "闭合15分钟K线DFT", "主频能量占非零频率总能量的比例，衡量周期结构是否集中。", {
    defaultEnabled: true,
    referenceIds: ["discrete_fourier_transform", "factor_evaluation"]
  }),
  factor("fourier_high_frequency_ratio", "傅里叶高频能量比", "模型与频域", "risk", "闭合15分钟K线DFT", "频谱上三分之一频段的能量占比，作为短周期噪声代理。", {
    defaultEnabled: true,
    referenceIds: ["discrete_fourier_transform", "factor_evaluation"]
  }),
  factor("model_gbm_direction", "GBM方向模型因子", "模型与频域", "direction", "GBM模型输出", "GBM上涨概率与期望收益合成的方向信号；因子库只治理其原有单一路径，不重复叠加。", {
    defaultEnabled: true,
    defaultUseInDecision: true,
    governanceTarget: "gbm",
    autoGovernanceEligible: true,
    referenceIds: ["factor_pipeline", "factor_evaluation"]
  }),
  factor("hmm_regime_signal", "HMM方向模型因子", "模型与频域", "direction", "三状态HMM", "HMM牛熊状态概率差；因子库只治理其原有单一路径，不重复叠加。", {
    defaultEnabled: true,
    defaultUseInDecision: false,
    governanceTarget: "hiddenMarkov",
    autoGovernanceEligible: true,
    referenceIds: ["factor_pipeline", "factor_evaluation"]
  }),
  factor("model_garch_risk", "GARCH风险模型因子", "模型与频域", "risk", "GARCH(1,1)模型输出", "GARCH波动稳定度、信号置信缩放和止损波动下限的统一参与门控。", {
    defaultEnabled: true,
    defaultUseInDecision: true,
    governanceTarget: "garch",
    referenceIds: ["factor_pipeline", "factor_evaluation"]
  }),
  factor("model_poisson_context", "Poisson事件聚集因子", "模型与频域", "context", "事件到达模型", "事件聚集异常度的上下文门控；不把事件强度误当成多空方向。", {
    defaultEnabled: true,
    defaultUseInDecision: true,
    governanceTarget: "poisson",
    referenceIds: ["factor_pipeline", "factor_evaluation"]
  }),
  factor("model_bayesian_calibration", "Bayesian概率校准因子", "模型与频域", "context", "Bayesian更新", "胜率后验校准的参与门控；应以校准误差评价，暂不由方向IC自动启停。", {
    defaultEnabled: true,
    defaultUseInDecision: true,
    governanceTarget: "bayesian",
    referenceIds: ["factor_pipeline", "factor_evaluation"]
  }),
  factor("model_markowitz_allocator", "Markowitz配置因子", "模型与频域", "context", "正则化切点组合", "候选仓位横截面配置的参与门控；应以组合增益评价，暂不由方向IC自动启停。", {
    defaultEnabled: true,
    defaultUseInDecision: true,
    governanceTarget: "markowitz",
    decisionLayer: "sizing",
    referenceIds: ["factor_pipeline", "factor_evaluation"]
  })
]);

export const FACTOR_CATALOG_AUDIT = Object.freeze(validateResearchCatalog(
  FACTOR_DEFINITIONS,
  FACTOR_RESEARCH_REFERENCES
));
if (!FACTOR_CATALOG_AUDIT.passed) {
  throw new Error(`factor catalog validation failed: ${FACTOR_CATALOG_AUDIT.errors.join(", ")}`);
}

const DEFINITION_BY_ID = new Map(FACTOR_DEFINITIONS.map((item) => [item.id, item]));

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
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

function rogersSatchellVolatility(candles) {
  const sample = candles.slice(-20).filter((item) => item.open > 0 && item.high > 0 && item.low > 0 && item.close > 0);
  if (sample.length < 5) return null;
  const variance = mean(sample.map((item) =>
    Math.log(item.high / item.open) * Math.log(item.high / item.close) +
    Math.log(item.low / item.open) * Math.log(item.low / item.close)
  ));
  return Math.sqrt(Math.max(0, variance));
}

function yangZhangVolatility(candles) {
  const sample = candles.slice(-21).filter((item) => item.open > 0 && item.high > 0 && item.low > 0 && item.close > 0);
  if (sample.length < 6) return null;
  const overnight = [];
  const openClose = [];
  const rs = [];
  for (let index = 1; index < sample.length; index += 1) {
    const item = sample[index];
    overnight.push(Math.log(item.open / sample[index - 1].close));
    openClose.push(Math.log(item.close / item.open));
    rs.push(
      Math.log(item.high / item.open) * Math.log(item.high / item.close) +
      Math.log(item.low / item.open) * Math.log(item.low / item.close)
    );
  }
  const count = openClose.length;
  const k = 0.34 / (1.34 + (count + 1) / Math.max(count - 1, 1));
  return Math.sqrt(Math.max(0, std(overnight) ** 2 + k * std(openClose) ** 2 + (1 - k) * mean(rs)));
}

function standardizedMoment(values, order) {
  const sample = values.filter(Number.isFinite);
  const deviation = std(sample);
  if (sample.length < 8 || deviation <= 0) return null;
  const average = mean(sample);
  const moment = mean(sample.map((value) => ((value - average) / deviation) ** order));
  return order === 4 ? moment - 3 : moment;
}

function bipowerJumpRatio(values) {
  const sample = values.slice(-30).filter(Number.isFinite);
  if (sample.length < 8) return null;
  const realizedVariance = sample.reduce((sum, value) => sum + value ** 2, 0);
  let bipower = 0;
  for (let index = 1; index < sample.length; index += 1) bipower += Math.abs(sample[index]) * Math.abs(sample[index - 1]);
  bipower *= Math.PI / 2;
  return realizedVariance > 0 ? clamp((realizedVariance - bipower) / realizedVariance, 0, 1) : 0;
}

function discreteEntropy(values) {
  const sample = values.slice(-30).filter(Number.isFinite);
  if (sample.length < 8) return null;
  const scale = Math.max(std(sample) * 0.25, 1e-12);
  const counts = [0, 0, 0];
  for (const value of sample) counts[value < -scale ? 0 : value > scale ? 2 : 1] += 1;
  const entropy = counts.reduce((sum, count) => {
    if (!count) return sum;
    const probability = count / sample.length;
    return sum - probability * Math.log(probability);
  }, 0);
  return entropy / Math.log(3);
}

export function discreteFourierFeatures(closes) {
  const sample = closes.filter((value) => value > 0).slice(-64).map(Math.log);
  if (sample.length < 32) return { phaseSignal: null, concentration: null, highFrequencyRatio: null, dominantPeriodBars: null };
  const count = sample.length;
  const xMean = (count - 1) / 2;
  const yMean = mean(sample);
  let covariance = 0;
  let xVariance = 0;
  for (let index = 0; index < count; index += 1) {
    covariance += (index - xMean) * (sample[index] - yMean);
    xVariance += (index - xMean) ** 2;
  }
  const slope = xVariance > 0 ? covariance / xVariance : 0;
  const detrended = sample.map((value, index) => value - (yMean + slope * (index - xMean)));
  const bins = [];
  for (let frequency = 1; frequency <= Math.floor(count / 2); frequency += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < count; index += 1) {
      const angle = 2 * Math.PI * frequency * index / count;
      real += detrended[index] * Math.cos(angle);
      imaginary -= detrended[index] * Math.sin(angle);
    }
    bins.push({ frequency, real, imaginary, energy: real ** 2 + imaginary ** 2 });
  }
  const totalEnergy = bins.reduce((sum, item) => sum + item.energy, 0);
  if (!(totalEnergy > 0)) return { phaseSignal: 0, concentration: 0, highFrequencyRatio: 0, dominantPeriodBars: null };
  const cycleBins = bins.filter((item) => item.frequency <= Math.max(2, Math.floor(count / 4)));
  const dominant = cycleBins.reduce((best, item) => !best || item.energy > best.energy ? item : best, null);
  const amplitude = dominant ? 2 * Math.sqrt(dominant.energy) / count : 0;
  const componentAt = (index) => {
    if (!dominant) return 0;
    const angle = 2 * Math.PI * dominant.frequency * index / count;
    return 2 / count * (dominant.real * Math.cos(angle) - dominant.imaginary * Math.sin(angle));
  };
  const concentration = dominant ? dominant.energy / totalEnergy : 0;
  const phaseDelta = amplitude > 0 ? (componentAt(count) - componentAt(count - 1)) / (2 * amplitude) : 0;
  const highFrequencyStart = Math.ceil(bins.length * 2 / 3);
  const highFrequencyEnergy = bins
    .filter((item) => item.frequency >= highFrequencyStart)
    .reduce((sum, item) => sum + item.energy, 0);
  return {
    phaseSignal: clamp(phaseDelta * Math.sqrt(concentration), -1, 1),
    concentration: clamp(concentration, 0, 1),
    highFrequencyRatio: clamp(highFrequencyEnergy / totalEnergy, 0, 1),
    dominantPeriodBars: dominant ? count / dominant.frequency : null
  };
}

function linearTrend(values) {
  const sample = values.slice(-20).filter((value) => value > 0).map(Math.log);
  if (sample.length < 8) return { slope: null, r2: null };
  const xMean = (sample.length - 1) / 2;
  const yMean = mean(sample);
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < sample.length; index += 1) {
    covariance += (index - xMean) * (sample[index] - yMean);
    xVariance += (index - xMean) ** 2;
    yVariance += (sample[index] - yMean) ** 2;
  }
  const slope = xVariance > 0 ? covariance / xVariance : 0;
  const r2 = xVariance > 0 && yVariance > 0 ? clamp(covariance ** 2 / (xVariance * yVariance), 0, 1) : 0;
  return { slope, r2 };
}

function moneyFlowIndex(candles) {
  const sample = candles.slice(-15);
  if (sample.length < 6) return null;
  let positive = 0;
  let negative = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const typical = (sample[index].high + sample[index].low + sample[index].close) / 3;
    const previous = (sample[index - 1].high + sample[index - 1].low + sample[index - 1].close) / 3;
    const flow = typical * safeNumber(sample[index].volume);
    if (typical >= previous) positive += flow;
    else negative += flow;
  }
  if (positive + negative <= 0) return null;
  const mfi = negative > 0 ? 100 - 100 / (1 + positive / negative) : 100;
  return clamp((mfi - 50) / 50, -1, 1);
}

function chaikinMoneyFlow(candles) {
  const sample = candles.slice(-20);
  let weighted = 0;
  let volume = 0;
  for (const item of sample) {
    const range = safeNumber(item.high) - safeNumber(item.low);
    const itemVolume = safeNumber(item.volume);
    if (range <= 0 || itemVolume <= 0) continue;
    weighted += ((2 * safeNumber(item.close) - item.high - item.low) / range) * itemVolume;
    volume += itemVolume;
  }
  return volume > 0 ? clamp(weighted / volume, -1, 1) : null;
}

function accumulationDistributionSlope(candles) {
  const sample = candles.slice(-20);
  const flows = sample.map((item) => {
    const range = safeNumber(item.high) - safeNumber(item.low);
    return range > 0 ? ((2 * safeNumber(item.close) - item.high - item.low) / range) * safeNumber(item.volume) : 0;
  });
  const scale = flows.reduce((sum, value) => sum + Math.abs(value), 0);
  return flows.length >= 6 && scale > 0 ? clamp(flows.reduce((sum, value) => sum + value, 0) / scale, -1, 1) : null;
}

function easeOfMovement(candles) {
  const sample = candles.slice(-15);
  const values = [];
  for (let index = 1; index < sample.length; index += 1) {
    const midpoint = (sample[index].high + sample[index].low) / 2;
    const previousMidpoint = (sample[index - 1].high + sample[index - 1].low) / 2;
    const range = Math.max(sample[index].high - sample[index].low, 1e-12);
    values.push((midpoint - previousMidpoint) * range / Math.max(safeNumber(sample[index].volume), 1e-12));
  }
  const scale = mean(values.map(Math.abs));
  return values.length >= 5 && scale > 0 ? clamp(mean(values) / (3 * scale), -1, 1) : null;
}

function median(values) {
  const sample = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sample.length) return null;
  const middle = Math.floor(sample.length / 2);
  return sample.length % 2 ? sample[middle] : (sample[middle - 1] + sample[middle]) / 2;
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
  const closedCandles15m = context.candlesAreClosed === true ? candles15m : candles15m.slice(0, -1);
  const closedCloses15m = closedCandles15m.map((item) => safeNumber(item.close)).filter((value) => value > 0);
  const modelReturns15m = returns(closedCloses15m);
  const fourier = discreteFourierFeatures(closedCloses15m);
  const gbmModel = Number.isFinite(market.gbm?.signal)
    ? market.gbm
    : analyzeGeometricBrownianMotion(modelReturns15m);
  const garchModel = Number.isFinite(market.garch?.stabilityScore)
    ? market.garch
    : estimateGarch11(modelReturns15m);
  const hmmModel = Number.isFinite(market.hiddenMarkov?.signal)
    ? market.hiddenMarkov
    : analyzeHiddenMarkovRegime(modelReturns15m);
  const recentVolume = candles1m.slice(-30).map((item) => safeNumber(item.quoteVolume || item.volume)).filter((value) => value > 0);
  const currentVolume = recentVolume.at(-1);
  const priceScale = Math.max(latest * Math.max(safeNumber(market.atrPct, 0.004), 0.002), 1e-9);
  const ema5 = ema(closes1m.slice(-60), 5);
  const ema20 = ema(closes1m.slice(-90), 20);
  const previousEma20 = ema(closes1m.slice(-91, -1), 20);
  const ema10 = ema(closes1m.slice(-90), 10);
  const ema50 = ema(closes1m.slice(-120), 50);
  const macd = macdHistogram(closes1m);
  const currentRsi = rsi(closes1m);
  const trend20 = linearTrend(closes1m);
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
  const upside = returns1m.slice(-30).filter((value) => value > 0);
  const rollingVolatility = [];
  for (let end = 10; end <= returns1m.length; end += 5) rollingVolatility.push(std(returns1m.slice(Math.max(0, end - 10), end)));
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
  const eventLambda = clamp(0.25 + eventScore * 1.65, 0.05, 4);
  const poissonCluster = eventCount > eventLambda
    ? clamp((eventCount - eventLambda) / Math.sqrt(eventLambda) / 3, 0, 1) * Math.abs(eventDirection)
    : 0;
  const sourceCount = new Set((context.eventAggregate?.events || []).map((item) => item.source).filter(Boolean)).size;
  const sessionKey = String(context.sessionContext?.policyKey || "off_hours");
  const sessionSignal = sessionKey.includes("overlap") ? 0.2 : sessionKey === "europe" ? 0.15 : sessionKey === "us" ? 0.1 : sessionKey === "asia" ? 0 : -0.2;
  const oscillatorWindow = candles1m.slice(-14);
  const oscillatorHigh = oscillatorWindow.length ? Math.max(...oscillatorWindow.map((item) => safeNumber(item.high))) : null;
  const oscillatorLow = oscillatorWindow.length ? Math.min(...oscillatorWindow.map((item) => safeNumber(item.low))) : null;
  const stochasticPosition = oscillatorHigh > oscillatorLow ? (latest - oscillatorLow) / (oscillatorHigh - oscillatorLow) : null;
  const williamsPositions = [0, 1, 2].map((offset) => {
    const end = candles1m.length - offset;
    const sample = candles1m.slice(Math.max(0, end - 21), end);
    const high = sample.length ? Math.max(...sample.map((item) => safeNumber(item.high))) : null;
    const low = sample.length ? Math.min(...sample.map((item) => safeNumber(item.low))) : null;
    const close = safeNumber(sample.at(-1)?.close);
    return high > low && close > 0 ? (close - low) / (high - low) : null;
  }).filter((value) => value != null);
  const bollingerSample = closes1m.slice(-20);
  const bollingerDeviation = std(bollingerSample);
  const typicalPrices = candles1m.slice(-20).map((item) => (safeNumber(item.high) + safeNumber(item.low) + safeNumber(item.close)) / 3);
  const typicalMean = mean(typicalPrices);
  const typicalDeviation = mean(typicalPrices.map((value) => Math.abs(value - typicalMean)));
  const aroonWindow = candles1m.slice(-25);
  const aroonHighIndex = aroonWindow.length ? aroonWindow.reduce((best, item, index, array) => item.high >= array[best].high ? index : best, 0) : -1;
  const aroonLowIndex = aroonWindow.length ? aroonWindow.reduce((best, item, index, array) => item.low <= array[best].low ? index : best, 0) : -1;
  const forceValues = candles1m.slice(-11).slice(1).map((item, index, sample) => {
    const previous = candles1m.slice(-11)[index];
    return (safeNumber(item.close) - safeNumber(previous?.close)) * safeNumber(item.volume);
  });
  const forceScale = forceValues.reduce((sum, value) => sum + Math.abs(value), 0);
  const weightedMomentumRows = candles1m.slice(-16);
  let weightedMomentum = 0;
  let weightedMomentumVolume = 0;
  for (let index = 1; index < weightedMomentumRows.length; index += 1) {
    const previous = safeNumber(weightedMomentumRows[index - 1].close);
    const volume = safeNumber(weightedMomentumRows[index].volume);
    if (previous <= 0 || volume <= 0) continue;
    weightedMomentum += (weightedMomentumRows[index].close / previous - 1) * volume;
    weightedMomentumVolume += volume;
  }
  const topDepthQuote = safeNumber(micro.topDepthQuote);
  const visibleDepthQuote = safeNumber(micro.bidDepthQuote) + safeNumber(micro.askDepthQuote);
  const flow5 = micro.flow5s || {};
  const flowPersistence = micro.tradeAvailable
    ? Math.sign(safeNumber(flow5.imbalance)) === Math.sign(safeNumber(flow30.imbalance))
      ? mean([safeNumber(flow5.imbalance), safeNumber(flow30.imbalance)])
      : mean([safeNumber(flow5.imbalance), safeNumber(flow30.imbalance)]) * 0.25
    : null;
  const directionalDerivatives = [
    ret15 == null ? null : clamp(Math.sign(safeNumber(market.oiChange)) * ret15 / 0.015, -1, 1),
    finiteOrNull(derivatives.takerImbalance),
    finiteOrNull(derivatives.liquidationImbalance)
  ];

  return {
    return_1m: barMinutes === 1 ? normalizeSignal(roc(closes1m, 1), 0.003) : null,
    return_3m: barMinutes <= 3 ? normalizeSignal(roc(closes1m, barsForMinutes(3)), 0.005) : null,
    return_5m: barMinutes <= 5 ? normalizeSignal(roc(closes1m, barsForMinutes(5)), 0.008) : null,
    return_10m: barMinutes <= 10 ? normalizeSignal(roc(closes1m, barsForMinutes(10)), 0.012) : null,
    return_15m: normalizeSignal(ret15, 0.015),
    return_30m: normalizeSignal(roc(closes1m, barsForMinutes(30)), 0.022),
    return_1h: normalizeSignal(ret1h, 0.03),
    ema_spread_5_20: latest > 0 && ema20 > 0 ? clamp((ema5 - ema20) / priceScale, -1, 1) : null,
    ema_slope_20: latest > 0 && previousEma20 > 0 ? clamp((ema20 - previousEma20) / Math.max(priceScale * 0.25, 1e-9), -1, 1) : null,
    macd_histogram: macd == null ? null : clamp(macd / priceScale, -1, 1),
    adx_strength: adx(candles1m),
    donchian_breakout: channelHigh != null && channelLow != null && channelHigh > channelLow
      ? clamp(((latest - channelLow) / (channelHigh - channelLow) - 0.5) * 2, -1, 1)
      : null,
    rsi_reversal: currentRsi == null ? null : clamp((50 - currentRsi) / 25, -1, 1),
    ema_spread_10_50: latest > 0 && ema50 > 0 ? clamp((ema10 - ema50) / Math.max(priceScale * 1.5, 1e-9), -1, 1) : null,
    price_acceleration_5_20: normalizeSignal(
      safeNumber(roc(closes1m, barsForMinutes(5))) - safeNumber(roc(closes1m, barsForMinutes(20))),
      0.015
    ),
    linear_trend_slope_20: trend20.slope == null ? null : clamp(trend20.slope / Math.max(realized, 1e-6), -1, 1),
    trend_fit_r2_20: trend20.r2,
    stochastic_reversal: stochasticPosition == null ? null : clamp(1 - 2 * stochasticPosition, -1, 1),
    williams_r_reversal: williamsPositions.length === 3 ? clamp(1 - 2 * mean(williamsPositions), -1, 1) : null,
    bollinger_reversal: bollingerDeviation > 0 ? clamp(-(latest - mean(bollingerSample)) / (2 * bollingerDeviation), -1, 1) : null,
    cci_reversal: typicalDeviation > 0 ? clamp(-(typicalPrices.at(-1) - typicalMean) / (0.015 * typicalDeviation * 200), -1, 1) : null,
    aroon_oscillator: aroonWindow.length >= 8 ? clamp((aroonHighIndex - aroonLowIndex) / Math.max(aroonWindow.length - 1, 1), -1, 1) : null,
    realized_volatility: realized > 0 ? clamp(realized / 0.02, 0, 1) : null,
    volatility_zscore: baselineVols.length ? clamp(safeNumber(zscore(realized, baselineVols)) / 3, -1, 1) : null,
    range_expansion: currentRange && ranges.length > 5 ? clamp(currentRange / Math.max(mean(ranges.slice(-21, -1)), 1e-9) - 1, -1, 1) : null,
    range_compression: currentRange && ranges.length > 5 ? clamp(1 - currentRange / Math.max(mean(ranges.slice(-21, -1)), 1e-9), -1, 1) : null,
    parkinson_volatility: parkinsonVolatility(candles1m),
    garman_klass_volatility: garmanKlassVolatility(candles1m),
    downside_semivolatility: downside.length ? clamp(std(downside) / 0.02, 0, 1) : 0,
    jump_intensity: returns1m.length >= 30 ? clamp(jumpValues.length / 5, 0, 1) : null,
    rogers_satchell_volatility: rogersSatchellVolatility(candles1m),
    yang_zhang_volatility: yangZhangVolatility(candles1m),
    upside_semivolatility: upside.length ? clamp(std(upside) / 0.02, 0, 1) : 0,
    realized_skewness: normalizeSignal(standardizedMoment(returns1m.slice(-30), 3), 3),
    realized_kurtosis: normalizeSignal(standardizedMoment(returns1m.slice(-30), 4), 10),
    bipower_jump_ratio: bipowerJumpRatio(returns1m),
    volatility_of_volatility: rollingVolatility.length >= 5 ? clamp(std(rollingVolatility) / Math.max(mean(rollingVolatility), 1e-9), 0, 1) : null,
    return_entropy: discreteEntropy(returns1m),
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
    money_flow_index: moneyFlowIndex(candles1m),
    chaikin_money_flow: chaikinMoneyFlow(candles1m),
    accumulation_distribution_slope: accumulationDistributionSlope(candles1m),
    force_index: forceScale > 0 ? clamp(forceValues.reduce((sum, value) => sum + value, 0) / forceScale, -1, 1) : null,
    ease_of_movement: easeOfMovement(candles1m),
    volume_weighted_momentum: weightedMomentumVolume > 0 ? normalizeSignal(weightedMomentum / weightedMomentumVolume, 0.01) : null,
    volume_trend_confirmation: ret15 == null || recentVolume.length <= 6 ? null : clamp(
      normalizeSignal(ret15, 0.015) * Math.sign(safeNumber(roc(recentVolume, 5))) * Math.min(1, Math.abs(safeNumber(roc(recentVolume, 5)))),
      -1,
      1
    ),
    signed_trade_intensity: micro.tradeAvailable ? clamp(safeNumber(flow30.imbalance) * clamp(safeNumber(flow30.tradeCount) / 50, 0, 1), -1, 1) : null,
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
    quoted_depth: micro.bookAvailable && visibleDepthQuote > 0 ? clamp(Math.log1p(visibleDepthQuote) / Math.log1p(10_000_000), 0, 1) : null,
    depth_concentration: micro.bookAvailable && visibleDepthQuote > 0 && topDepthQuote > 0 ? clamp(topDepthQuote / visibleDepthQuote, 0, 1) : null,
    weighted_book_pressure: micro.bookAvailable ? clamp(0.6 * safeNumber(micro.topBookImbalance) + 0.4 * safeNumber(micro.orderBookImbalance), -1, 1) : null,
    order_flow_persistence: flowPersistence == null ? null : clamp(flowPersistence, -1, 1),
    cancel_to_add_ratio: micro.bookAvailable && bookAdd > 0 ? clamp(bookCancel / bookAdd / 3, 0, 1) : null,
    depth_adjusted_ofi: micro.available && visibleDepthQuote > 0 ? clamp(
      safeNumber(micro.signal) * clamp(safeNumber(micro.tradeConfidence) + safeNumber(micro.bookFlowConfidence), 0, 1) *
      clamp(Math.log1p(visibleDepthQuote) / Math.log1p(1_000_000), 0.2, 1),
      -1,
      1
    ) : null,
    funding_zscore: fundingZ == null ? null : clamp(fundingZ / 3, -1, 1),
    funding_price_divergence: fundingZ == null || ret1h == null ? null : clamp(-Math.sign(fundingZ) * Math.abs(ret1h / 0.03) * Math.min(1, Math.abs(fundingZ) / 2), -1, 1),
    open_interest_change: finiteOrNull(market.oiChange),
    oi_price_confirmation: ret15 == null ? null : clamp(Math.sign(safeNumber(market.oiChange)) * ret15 / 0.015, -1, 1),
    perpetual_basis: basis == null ? null : clamp(basis / 0.003, -1, 1),
    liquidation_imbalance: finiteOrNull(derivatives.liquidationImbalance),
    long_short_ratio: finiteOrNull(derivatives.longShortContrarian),
    basis_volatility: finiteOrNull(derivatives.basisVolatility),
    taker_oi_confirmation: finiteOrNull(derivatives.takerImbalance) == null ? null : clamp(
      safeNumber(derivatives.takerImbalance) * Math.sign(safeNumber(market.oiChange)) * Math.sqrt(Math.min(1, Math.abs(safeNumber(market.oiChange)))),
      -1,
      1
    ),
    liquidation_price_confirmation: finiteOrNull(derivatives.liquidationImbalance) == null || ret15 == null ? null : clamp(
      safeNumber(derivatives.liquidationImbalance) * Math.sign(ret15) * Math.min(1, Math.abs(ret15) / 0.015),
      -1,
      1
    ),
    leverage_crowding_risk: fundingZ == null ? null : clamp(Math.abs(fundingZ) / 3 * Math.min(1, Math.abs(safeNumber(market.oiChange))), 0, 1),
    basis_dislocation_risk: basis == null ? null : clamp(Math.abs(basis) / 0.005, 0, 1),
    derivatives_consensus: directionalDerivatives.filter((value) => value != null).length >= 2 ? clamp(median(directionalDerivatives), -1, 1) : null,
    btc_beta_residual: finiteOrNull(context.crossAsset?.btcBetaResidual),
    eth_btc_relative_strength: finiteOrNull(context.crossAsset?.ethBtcRelativeStrength),
    cross_section_momentum_rank: finiteOrNull(context.crossAsset?.momentumRank),
    correlation_regime: finiteOrNull(context.crossAsset?.btcCorrelation),
    market_session: sessionSignal,
    news_impact_decay: eventScore > 0 ? clamp(eventDirection * eventScore, -1, 1) : 0,
    event_source_consensus: sourceCount > 0 ? clamp(eventDirection * Math.min(1, sourceCount / 3) * Math.min(1, eventCount / 3), -1, 1) : 0
    ,btc_lead_lag: finiteOrNull(context.crossAsset?.btcLeadLag),
    market_breadth: finiteOrNull(context.crossAsset?.marketBreadth),
    cross_section_dispersion: finiteOrNull(context.crossAsset?.crossSectionDispersion),
    beta_instability: finiteOrNull(context.crossAsset?.betaInstability),
    cross_section_residual_momentum: finiteOrNull(context.crossAsset?.residualMomentum),
    fourier_dominant_phase: fourier.phaseSignal,
    fourier_spectral_concentration: fourier.concentration,
    fourier_high_frequency_ratio: fourier.highFrequencyRatio,
    model_gbm_direction: finiteOrNull(gbmModel?.signal),
    hmm_regime_signal: finiteOrNull(hmmModel?.signal),
    model_garch_risk: finiteOrNull(garchModel?.stabilityScore),
    model_poisson_context: poissonCluster,
    model_bayesian_calibration: null,
    model_markowitz_allocator: null
  };
}

function crossAssetContext(items) {
  const bySymbol = new Map(items.map((item) => [item.market.symbol, item]));
  const btc = bySymbol.get("BTCUSDT")?.market;
  const eth = bySymbol.get("ETHUSDT")?.market;
  const momentum = items.map((item) => ({ symbol: item.market.symbol, value: safeNumber(roc(item.factorContext?.candles15m?.map((candle) => candle.close) || [], 1)) }));
  const ranked = rank(momentum.map((item) => item.value));
  const crossSectionMean = mean(momentum.map((item) => item.value));
  const crossSectionDispersion = std(momentum.map((item) => item.value));
  const marketBreadth = momentum.length
    ? momentum.reduce((sum, item) => sum + (item.value > 0 ? 1 : item.value < 0 ? 0 : 0.5), 0) / momentum.length * 2 - 1
    : null;
  return Object.fromEntries(items.map((item) => {
    const marketReturns = item.market.returns15m || [];
    const btcReturns = btc?.returns15m || [];
    const betaDenominator = correlation(btcReturns, btcReturns);
    const beta = betaDenominator ? safeNumber(correlation(marketReturns, btcReturns)) * std(marketReturns) / Math.max(std(btcReturns), 1e-9) : 0;
    const shortMarketReturns = marketReturns.slice(-10);
    const shortBtcReturns = btcReturns.slice(-10);
    const shortBeta = safeNumber(correlation(shortMarketReturns, shortBtcReturns)) * std(shortMarketReturns) / Math.max(std(shortBtcReturns), 1e-9);
    const longBeta = safeNumber(correlation(marketReturns.slice(-30), btcReturns.slice(-30))) * std(marketReturns.slice(-30)) / Math.max(std(btcReturns.slice(-30)), 1e-9);
    const ownReturn = safeNumber(momentum.find((entry) => entry.symbol === item.market.symbol)?.value);
    const btcReturn = safeNumber(momentum.find((entry) => entry.symbol === "BTCUSDT")?.value);
    const ethReturn = safeNumber(momentum.find((entry) => entry.symbol === "ETHUSDT")?.value);
    const rankIndex = momentum.findIndex((entry) => entry.symbol === item.market.symbol);
    return [item.market.symbol, {
      btcBetaResidual: clamp((ownReturn - beta * btcReturn) / 0.02, -1, 1),
      ethBtcRelativeStrength: clamp((ownReturn - mean([btcReturn, ethReturn])) / 0.02, -1, 1),
      momentumRank: ranked.length > 1 ? (ranked[rankIndex] - 1) / (ranked.length - 1) * 2 - 1 : 0,
      btcCorrelation: finiteOrNull(correlation(marketReturns, btcReturns)),
      btcLeadLag: btcReturns.length >= 2 ? clamp((safeNumber(btcReturns.at(-2)) - ownReturn) / 0.02, -1, 1) : null,
      marketBreadth,
      crossSectionDispersion: crossSectionDispersion > 0 ? clamp(Math.abs(ownReturn - crossSectionMean) / (3 * crossSectionDispersion), 0, 1) : 0,
      betaInstability: marketReturns.length >= 10 && btcReturns.length >= 10 ? clamp(Math.abs(shortBeta - longBeta) / 2, 0, 1) : null,
      residualMomentum: clamp((ownReturn - crossSectionMean) / 0.02, -1, 1)
    }];
  }));
}

export function buildFactorSnapshots({ marketResults = [], eventsBySymbol = {}, sessionContext = null, status = null }) {
  const normalizedStatus = { minedFactors: [] };
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

    return {
      symbol: item.market.symbol,
      price: safeNumber(item.market.latest),
      capturedAt: item.factorContext?.capturedAt || item.capturedAt || new Date().toISOString(),
      values: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, round(finiteOrNull(value))])),
      modelReuse: {
        gbm: Number.isFinite(item.market.gbm?.signal),
        garch: Number.isFinite(item.market.garch?.stabilityScore),
        hiddenMarkov: Number.isFinite(item.market.hiddenMarkov?.signal)
      },
      sources: item.factorContext?.derivatives?.sources || {}
    };
  });
}

export function buildHistoricalFactorFrames({ seriesBySymbol = {}, series15mBySymbol = {}, fundingBySymbol = {}, intervalMinutes = 60, status = null, stride = 1 }) {
  const symbols = Object.keys(seriesBySymbol).filter((symbol) => Array.isArray(seriesBySymbol[symbol]) && seriesBySymbol[symbol].length > 0);
  if (symbols.length < MIN_CROSS_SECTION_SYMBOLS) return [];
  const normalizedStatus = { minedFactors: [] };
  const firstSeries = seriesBySymbol[symbols[0]];
  const commonTimes = firstSeries.map((candle) => safeNumber(candle.time)).filter((time) => time > 0);
  const timeIndexes = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    new Map(seriesBySymbol[symbol].map((candle, index) => [safeNumber(candle.time), index]))
  ]));
  const frames = [];
  const warmup = 95;
  // Binary search makes full-year auxiliary history causal without scanning it per frame.
  const asOf = (rows, time, key = 'time') => {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (Number(rows[mid][key]) <= time) lo = mid + 1; else hi = mid; }
    return lo;
  };
  for (let index = warmup; index < commonTimes.length; index += Math.max(1, Math.round(stride))) {
    const capturedAt = new Date(commonTimes[index] + intervalMinutes * 60_000).toISOString();
    const aligned = symbols.map((symbol) => {
      const series = seriesBySymbol[symbol];
      const candleIndex = timeIndexes[symbol].get(commonTimes[index]) ?? -1;
      if (candleIndex < warmup) return null;
      return { symbol, series, candleIndex, candle: series[candleIndex] };
    }).filter(Boolean);
    if (aligned.length < MIN_CROSS_SECTION_SYMBOLS) continue;
    const prices = Object.fromEntries(aligned.map(({ symbol, candle }) => [symbol, candle.close]));
    const isAnchor = Date.parse(capturedAt) % 3_600_000 === 0;
    if (!isAnchor) {
      frames.push({
        capturedAt,
        intervalMinutes,
        source: "historical_public_candles",
        prices,
        values: {}
      });
      continue;
    }
    const marketResults = aligned.map(({ symbol, series, candleIndex }) => {
      const candles = series.slice(Math.max(0, candleIndex - 119), candleIndex + 1);
      const latest = candles.at(-1)?.close;
      const auxiliary = series15mBySymbol[symbol] || [];
      const end15 = asOf(auxiliary, Date.parse(capturedAt) - 900_000);
      const candles15m = auxiliary.length ? auxiliary.slice(Math.max(0, end15 - 120), end15) : intervalMinutes === 15 ? candles : [];
      const returns15m = candles15m.slice(1).map((candle, offset) => {
        const previous = candles15m[offset]?.close;
        return previous > 0 ? candle.close / previous - 1 : 0;
      });
      const tr = candles15m.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles15m[i].close), Math.abs(c.low - candles15m[i].close)));
      const funding = fundingBySymbol[symbol] || [];
      // Settled OKX rates become feature inputs one minute later, never before settlement.
      const endFunding = asOf(funding, Date.parse(capturedAt) - 60_000, 'fundingTime');
      const rates = funding.slice(Math.max(0, endFunding - 20), endFunding).map(r => Number(r.fundingRate));
      const fundingFresh = endFunding > 0 && Date.parse(capturedAt) - Number(funding[endFunding - 1].fundingTime) <= 16 * 3_600_000;
      const fundingZScore = fundingFresh && rates.length >= 5 && std(rates) > 0 ? (rates.at(-1) - mean(rates)) / std(rates) : null;
      return {
        capturedAt,
        market: {
          symbol,
          latest,
          atrPct: tr.length >= 14 && latest > 0 ? mean(tr.slice(-14)) / latest : null,
          returns15m,
          hiddenMarkov: { signal: null },
          microstructure: {}
        },
        factorContext: {
          capturedAt,
          barMinutes: intervalMinutes,
          candlesAreClosed: true,
          candles1m: candles,
          candles15m,
          candles1h: [],
          derivatives: { fundingZScore, sources: { historicalCandles: { available: true, updatedAt: capturedAt }, historicalFunding: { venue: 'okx', available: fundingZScore != null } } }
        }
      };
    });
    const snapshots = buildFactorSnapshots({ marketResults, status: normalizedStatus });
    // Never relabel a 20x15m oscillator as its live 20x1m counterpart.
    const timeExplicit = new Set(["return_15m", "return_30m", "return_1h", "return_4h"]);
    const exact15m = new Set(["fourier_dominant_phase", "fourier_spectral_concentration", "fourier_high_frequency_ratio", "model_gbm_direction", "model_garch_risk", "btc_beta_residual", "eth_btc_relative_strength", "cross_section_momentum_rank", "correlation_regime", "btc_lead_lag", "market_breadth", "cross_section_dispersion", "beta_instability", "cross_section_residual_momentum"]);
    for (const snapshot of snapshots) for (const id of Object.keys(snapshot.values)) {
      const missingExternal = new Set(['open_interest_change', 'oi_price_confirmation', 'leverage_crowding_risk', 'derivatives_consensus', 'news_impact_decay', 'event_source_consensus', 'market_session', 'hmm_regime_signal', 'model_poisson_context']);
      const allowed = !missingExternal.has(id) && (timeExplicit.has(id) || id.startsWith('funding_') ||
        ((intervalMinutes === 15 || series15mBySymbol[snapshot.symbol]?.length) && exact15m.has(id)) ||
        (intervalMinutes === 1 && !exact15m.has(id) && !id.startsWith('model_')));
      if (!allowed) snapshot.values[id] = null;
    }
    frames.push({
      capturedAt,
      intervalMinutes,
      source: "historical_public_candles",
      prices,
      values: Object.fromEntries(snapshots.map((snapshot) => [snapshot.symbol, snapshot.values]))
    });
  }
  return frames;
}

