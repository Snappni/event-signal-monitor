const DEFAULT_MIN_SAMPLES = 90;
const DEFAULT_MIN_SEGMENT_SAMPLES = 18;

export const MINING_OPERATOR_META = Object.freeze({
  difference: Object.freeze({
    label: "相对差值",
    category: "自动挖掘·相对差值",
    symbol: "−",
    commutative: true,
    complexity: 1,
    explanation: "比较两个因子的相对强弱；符号方向由样本外证据确定。"
  }),
  blend: Object.freeze({
    label: "稳健均值",
    category: "自动挖掘·稳健均值",
    symbol: "+",
    commutative: true,
    complexity: 1,
    explanation: "对两个因子等权融合，降低单一输入的偶然噪声。"
  }),
  agreement: Object.freeze({
    label: "一致性衰减",
    category: "自动挖掘·一致性衰减",
    symbol: "↔",
    commutative: true,
    complexity: 2,
    explanation: "保留共同方向，并按两个因子的分歧程度衰减信号。"
  }),
  signed_product: Object.freeze({
    label: "非线性共振",
    category: "自动挖掘·非线性共振",
    symbol: "⊙",
    commutative: true,
    complexity: 2,
    explanation: "用共同方向控制符号、用几何平均控制强度，检验非线性交互。"
  })
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  if (length < 8) return null;
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

function metricSeries(metric, source) {
  const direct = source === "historical" ? metric?.historicalValues : metric?.realtimeValues;
  if (Array.isArray(direct)) return direct.filter(Number.isFinite);
  const values = Array.isArray(metric?.values) ? metric.values : [];
  const sources = Array.isArray(metric?.sourceValues) && metric.sourceValues.length === values.length
    ? metric.sourceValues
    : [];
  if (!sources.length) return source === "historical" ? values.filter(Number.isFinite) : [];
  const marker = source === "historical" ? 0 : 1;
  return values.filter((value, index) => Number.isFinite(value) && sources[index] === marker);
}

function metricCoverageSeries(metric, source) {
  const direct = source === "historical" ? metric?.historicalCoverageValues : metric?.realtimeCoverageValues;
  if (Array.isArray(direct)) return direct.filter(Number.isFinite);
  const values = Array.isArray(metric?.coverageValues) ? metric.coverageValues : [];
  const sources = Array.isArray(metric?.sourceValues) && metric.sourceValues.length === values.length
    ? metric.sourceValues
    : [];
  if (!sources.length) return source === "historical" ? values.filter(Number.isFinite) : [];
  const marker = source === "historical" ? 0 : 1;
  return values.filter((value, index) => Number.isFinite(value) && sources[index] === marker);
}

function hacTStatistic(values) {
  const sample = values.filter(Number.isFinite);
  if (sample.length < 8) return 0;
  const average = mean(sample);
  const centered = sample.map((value) => value - average);
  const lag = Math.min(5, Math.max(1, Math.floor(4 * (sample.length / 100) ** (2 / 9))));
  let longRunVariance = mean(centered.map((value) => value ** 2));
  for (let offset = 1; offset <= lag; offset += 1) {
    let covariance = 0;
    for (let index = offset; index < centered.length; index += 1) covariance += centered[index] * centered[index - offset];
    covariance /= centered.length;
    longRunVariance += 2 * (1 - offset / (lag + 1)) * covariance;
  }
  return longRunVariance > 0 ? average / Math.sqrt(longRunVariance / sample.length) : 0;
}

function segmentSummary(values) {
  const sample = values.filter(Number.isFinite);
  const deviation = std(sample);
  return {
    samples: sample.length,
    meanIc: mean(sample),
    icStd: deviation,
    icir: deviation > 0 ? mean(sample) / deviation : 0,
    hacTStatistic: hacTStatistic(sample)
  };
}

export function chronologicalFactorEvidence(metric, options = {}) {
  const minSamples = Math.max(30, finite(options.minSamples, DEFAULT_MIN_SAMPLES));
  const minSegmentSamples = Math.max(8, finite(options.minSegmentSamples, DEFAULT_MIN_SEGMENT_SAMPLES));
  const historical = metricSeries(metric, "historical");
  const realtime = metricSeries(metric, "realtime");
  const fallback = Array.isArray(metric?.values) ? metric.values.filter(Number.isFinite) : [];
  const sample = historical.length >= minSamples ? historical : fallback;
  const trainEnd = Math.floor(sample.length * 0.6);
  const validationEnd = Math.floor(sample.length * 0.8);
  const train = segmentSummary(sample.slice(0, trainEnd));
  const validation = segmentSummary(sample.slice(trainEnd, validationEnd));
  const test = segmentSummary(sample.slice(validationEnd));
  const overall = segmentSummary(sample);
  const realtimeSummary = segmentSummary(realtime);
  const orientation = overall.meanIc < 0 ? -1 : 1;
  const coverage = mean([
    ...metricCoverageSeries(metric, "historical"),
    ...metricCoverageSeries(metric, "realtime")
  ]);
  const hasHoldout = sample.length >= minSamples && [train, validation, test].every((item) => item.samples >= minSegmentSamples);
  const sameDirection = [train, validation, test].every((item) => item.meanIc * orientation > 0);
  const realtimeContradiction = realtimeSummary.samples >= 30 && realtimeSummary.meanIc * orientation < -0.005;
  const passed = hasHoldout && sameDirection && !realtimeContradiction &&
    Math.abs(overall.meanIc) >= 0.015 &&
    Math.abs(validation.meanIc) >= 0.01 &&
    Math.abs(test.meanIc) >= 0.01 &&
    Math.abs(test.hacTStatistic) >= 1.5 &&
    coverage >= 0.7;
  return {
    passed,
    hasHoldout,
    sameDirection,
    realtimeContradiction,
    orientation,
    coverage,
    source: historical.length >= minSamples ? "historical" : "legacy_mixed",
    train,
    validation,
    test,
    realtime: realtimeSummary,
    overall
  };
}

export function canonicalExpression(expression) {
  if (!expression || expression.type === "factor") return `factor:${String(expression?.id || "")}`;
  const meta = MINING_OPERATOR_META[expression.operator];
  if (!meta) throw new Error(`unsupported mining operator: ${expression.operator}`);
  const children = (expression.children || []).map(canonicalExpression);
  if (meta.commutative) children.sort();
  return `${expression.operator}(${children.join(",")})`;
}

export function evaluateExpression(expression, values) {
  if (!expression || expression.type === "factor") {
    const value = Number(values?.[expression?.id]);
    return Number.isFinite(value) ? clamp(value, -1, 1) : null;
  }
  const evaluated = (expression.children || []).map((child) => evaluateExpression(child, values));
  if (evaluated.length !== 2 || evaluated.some((value) => value == null)) return null;
  const [left, right] = evaluated;
  if (expression.operator === "difference") return clamp((left - right) / 2, -1, 1);
  if (expression.operator === "agreement") return clamp(((left + right) / 2) * (1 - Math.abs(left - right) / 2), -1, 1);
  if (expression.operator === "signed_product") {
    const direction = Math.sign(left + right);
    return clamp(direction * Math.sqrt(Math.abs(left * right)), -1, 1);
  }
  return clamp((left + right) / 2, -1, 1);
}

function expressionForDefinition(definition) {
  if (definition?.expression) return definition.expression;
  if (definition?.leftId && definition?.rightId) {
    return {
      type: "operator",
      operator: definition.operator || "blend",
      children: [{ type: "factor", id: definition.leftId }, { type: "factor", id: definition.rightId }]
    };
  }
  return { type: "factor", id: definition?.id };
}

function expressionDepth(expression) {
  if (!expression || expression.type === "factor") return 0;
  return 1 + Math.max(...(expression.children || []).map(expressionDepth), 0);
}

export function metricEvidenceCorrelation(leftMetric, rightMetric) {
  const leftHistory = metricSeries(leftMetric, "historical");
  const rightHistory = metricSeries(rightMetric, "historical");
  if (Math.min(leftHistory.length, rightHistory.length) >= 30) return correlation(leftHistory, rightHistory);
  const left = Array.isArray(leftMetric?.values) ? leftMetric.values : [];
  const right = Array.isArray(rightMetric?.values) ? rightMetric.values : [];
  return correlation(left, right);
}

function parentScore(definition, metric) {
  const samples = finite(metric?.samples);
  const coverage = clamp(finite(metric?.coverage, 0.5), 0, 1);
  const evidence = Math.abs(finite(metric?.meanIc)) * Math.max(0.05, Math.abs(finite(metric?.icir)));
  const prior = definition?.defaultEnabled ? 0.002 : 0;
  return evidence * coverage * Math.min(1, samples / DEFAULT_MIN_SAMPLES) + prior;
}

export function chooseMiningCandidate({ definitions = [], metrics = {}, blockedSemanticKeys = new Set(), pairUsage = new Map(), operatorUsage = new Map() }) {
  const parents = definitions
    .filter((definition) => definition?.role === "direction" && (definition.origin === "built_in" || definition.validationStatus === "validated"))
    .filter((definition) => expressionDepth(expressionForDefinition(definition)) < 2)
    .map((definition) => ({ definition, score: parentScore(definition, metrics?.[definition.id]?.[15]) }))
    .sort((left, right) => right.score - left.score || left.definition.id.localeCompare(right.definition.id))
    .slice(0, 24);
  const candidates = [];
  for (let leftIndex = 0; leftIndex < parents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < parents.length; rightIndex += 1) {
      const left = parents[leftIndex];
      const right = parents[rightIndex];
      const redundancy = Math.abs(finite(metricEvidenceCorrelation(
        metrics?.[left.definition.id]?.[15],
        metrics?.[right.definition.id]?.[15]
      )));
      if (redundancy >= 0.95) continue;
      for (const [operator, meta] of Object.entries(MINING_OPERATOR_META)) {
        const expression = {
          type: "operator",
          operator,
          children: [expressionForDefinition(left.definition), expressionForDefinition(right.definition)]
        };
        if (expressionDepth(expression) > 2) continue;
        const semanticKey = canonicalExpression(expression);
        if (blockedSemanticKeys.has(semanticKey)) continue;
        const pairKey = [left.definition.id, right.definition.id].sort().join("|");
        candidates.push({
          left: left.definition,
          right: right.definition,
          operator,
          expression,
          semanticKey,
          complexity: 1 + meta.complexity + expressionDepth(expression),
          pairUsage: finite(pairUsage.get(pairKey)),
          operatorUsage: finite(operatorUsage.get(operator)),
          redundancy,
          fitness: left.score + right.score - redundancy * 0.01 - meta.complexity * 0.0005
        });
      }
    }
  }
  candidates.sort((left, right) =>
    left.pairUsage - right.pairUsage ||
    left.operatorUsage - right.operatorUsage ||
    right.fitness - left.fitness ||
    left.semanticKey.localeCompare(right.semanticKey)
  );
  return candidates[0] || null;
}

export function validateResearchCatalog(definitions, references) {
  const ids = new Set();
  const formulas = new Set();
  const errors = [];
  for (const definition of definitions || []) {
    if (!definition?.id || ids.has(definition.id)) errors.push(`duplicate_or_missing_id:${definition?.id || "empty"}`);
    ids.add(definition?.id);
    const implementationKey = definition?.implementationKey || definition?.formula;
    if (!implementationKey || formulas.has(implementationKey)) errors.push(`duplicate_or_missing_implementation:${definition?.id || "empty"}`);
    formulas.add(implementationKey);
    if (!definition?.researchBasis) errors.push(`missing_research_basis:${definition?.id}`);
    if (!Array.isArray(definition?.referenceIds) || !definition.referenceIds.length) errors.push(`missing_reference:${definition?.id}`);
    for (const referenceId of definition?.referenceIds || []) {
      if (!references?.[referenceId]?.url) errors.push(`unknown_reference:${definition?.id}:${referenceId}`);
    }
    if (!Array.isArray(definition?.dataRequirements) || !definition.dataRequirements.length) errors.push(`missing_data_requirement:${definition?.id}`);
  }
  return { passed: errors.length === 0, errors, factorCount: ids.size, formulaCount: formulas.size };
}
