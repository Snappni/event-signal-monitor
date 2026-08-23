export const GARCH_CONFIDENCE_WEIGHT = 0.35;

function safeNumber(value, fallback = 0) {
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

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
    0.254829592) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function gaussianDensity(value, center, deviation) {
  const sigma = Math.max(Math.abs(deviation), 1e-9);
  const z = (value - center) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

export function analyzeGeometricBrownianMotion(returns, horizonSteps = 4) {
  const sample = returns.slice(-96);
  const meanLogReturn = mean(sample);
  const sigma = std(sample);
  const horizonLogMean = meanLogReturn * horizonSteps;
  const horizonVolatility = sigma * Math.sqrt(horizonSteps);
  const expectedReturn = Math.exp(horizonLogMean + 0.5 * sigma * sigma * horizonSteps) - 1;
  const probabilityUp = sigma > 0 ? normalCdf(horizonLogMean / Math.max(horizonVolatility, 1e-9)) : 0.5;
  const probabilitySignal = (probabilityUp - 0.5) * 2;
  const expectedReturnSignal = horizonVolatility > 0
    ? clamp(expectedReturn / Math.max(horizonVolatility * 1.5, 1e-9), -1, 1)
    : 0;
  return {
    horizonSteps,
    observations: sample.length,
    meanLogReturn,
    sigma,
    expectedReturn,
    probabilityUp,
    signal: clamp(probabilitySignal * 0.7 + expectedReturnSignal * 0.3, -1, 1),
    formula:
      "GBM: ln(S[t+h]/S[t]) ~ N(m*h, sigma^2*h); E[S[t+h]/S[t]-1] = exp(m*h + 0.5*sigma^2*h)-1"
  };
}

export function estimateGarch11(returns) {
  const sample = returns.slice(-96);
  const sampleVariance = Math.max(std(sample) ** 2, 1e-12);
  const alphaGrid = [0.05, 0.08, 0.12, 0.16];
  const betaGrid = [0.72, 0.8, 0.86, 0.9, 0.93];
  let best = null;

  for (const alpha of alphaGrid) {
    for (const beta of betaGrid) {
      if (alpha + beta >= 0.985) continue;
      const omega = sampleVariance * (1 - alpha - beta);
      let variance = sampleVariance;
      let logLikelihood = 0;
      for (const value of sample) {
        variance = Math.max(omega + alpha * value * value + beta * variance, 1e-12);
        logLikelihood += -0.5 * (Math.log(2 * Math.PI) + Math.log(variance) + value * value / variance);
      }
      if (!best || logLikelihood > best.logLikelihood) best = { alpha, beta, omega, variance, logLikelihood };
    }
  }

  const parameters = best || {
    alpha: 0.08,
    beta: 0.9,
    omega: sampleVariance * 0.02,
    variance: sampleVariance,
    logLikelihood: 0
  };
  const latestReturn = safeNumber(sample.at(-1));
  const forecastVariance = Math.max(
    parameters.omega + parameters.alpha * latestReturn * latestReturn + parameters.beta * parameters.variance,
    1e-12
  );
  const forecastVolatility = Math.sqrt(forecastVariance);
  const baselineVolatility = Math.sqrt(sampleVariance);
  const volatilityRatio = baselineVolatility > 0 ? forecastVolatility / baselineVolatility : 1;
  const stabilityScore = clamp(1.25 - volatilityRatio * 0.35, 0, 1);
  return {
    observations: sample.length,
    alpha: parameters.alpha,
    beta: parameters.beta,
    omega: parameters.omega,
    persistence: parameters.alpha + parameters.beta,
    forecastVariance,
    forecastVolatility,
    volatilityRatio,
    stabilityScore,
    confidenceMultiplier: 1 - GARCH_CONFIDENCE_WEIGHT + GARCH_CONFIDENCE_WEIGHT * stabilityScore,
    formula:
      "GARCH(1,1): sigma[t+1]^2 = omega + alpha*epsilon[t]^2 + beta*sigma[t]^2; final signal magnitude *= 0.65 + 0.35*stability"
  };
}

export function analyzeHiddenMarkovRegime(returns) {
  const sample = returns.slice(-96);
  const sigma = Math.max(std(sample), 1e-6);
  const states = [
    { name: "bull", mean: sigma * 0.35, deviation: sigma * 0.9 },
    { name: "bear", mean: -sigma * 0.35, deviation: sigma * 0.9 },
    { name: "range", mean: 0, deviation: sigma * 0.55 }
  ];
  const transition = [
    [0.92, 0.03, 0.05],
    [0.03, 0.92, 0.05],
    [0.08, 0.08, 0.84]
  ];
  let probabilities = [1 / 3, 1 / 3, 1 / 3];
  for (const value of sample) {
    const predicted = states.map((_, nextState) => probabilities.reduce(
      (sum, probability, previousState) => sum + probability * transition[previousState][nextState],
      0
    ));
    const filtered = states.map(
      (state, index) => predicted[index] * gaussianDensity(value, state.mean, state.deviation)
    );
    const total = filtered.reduce((sum, value) => sum + value, 0);
    probabilities = total > 0 ? filtered.map((value) => value / total) : [1 / 3, 1 / 3, 1 / 3];
  }
  const regimeIndex = probabilities.indexOf(Math.max(...probabilities));
  return {
    observations: sample.length,
    regime: states[regimeIndex].name,
    bullProbability: probabilities[0],
    bearProbability: probabilities[1],
    rangeProbability: probabilities[2],
    confidence: probabilities[regimeIndex],
    signal: clamp(probabilities[0] - probabilities[1], -1, 1),
    transition,
    formula:
      "HMM filter: P(z[t]|r[1:t]) proportional to Normal(r[t]|mu[z],sigma[z]) * sum(P(z[t]|z[t-1])*P(z[t-1]|r[1:t-1]))"
  };
}
