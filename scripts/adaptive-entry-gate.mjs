export const ADAPTIVE_GATE_BOUNDS = Object.freeze({
  aggressive: Object.freeze({ min: 0.42, max: 0.7 }),
  conservative: Object.freeze({ min: 0.45, max: 0.78 })
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function regimePenalty(regime) {
  const normalized = String(regime || "unknown").toLowerCase();
  if (normalized.includes("transition")) return 0.04;
  if (normalized.includes("high_volatility")) return 0.03;
  if (normalized.includes("range")) return 0.015;
  if (normalized === "unknown") return 0.02;
  return 0;
}

function candidateModePenalty(candidateMode) {
  if (candidateMode === "math_only") return 0.012;
  if (candidateMode === "event_math") return 0.006;
  return 0;
}

export function evaluateAdaptiveEntryGate(value = {}) {
  const riskProfile = value.riskProfile === "aggressive" ? "aggressive" : "conservative";
  const bounds = ADAPTIVE_GATE_BOUNDS[riskProfile];
  const winRate = clamp(safeNumber(value.winRate, 0.5), 0, 1);
  const riskPct = Math.max(safeNumber(value.riskPct, 0.01), 1e-6);
  const rewardRiskRatio = Math.max(safeNumber(value.rewardRiskRatio, 1.5), 0.05);
  const roundTripExecutionCostPct = Math.max(0, safeNumber(value.roundTripExecutionCostPct));
  const executionCostR = roundTripExecutionCostPct / riskPct;
  const breakEvenWinRate = clamp(
    (1 + executionCostR) / (1 + rewardRiskRatio),
    0.05,
    0.95
  );

  const calibration = value.calibration && typeof value.calibration === "object" ? value.calibration : {};
  const calibrationSamples = Math.max(0, safeNumber(calibration.samples));
  const empiricalWinRate = calibrationSamples > 0
    ? safeNumber(calibration.wins) / calibrationSamples
    : null;
  const averagePredictedWinRate = safeNumber(calibration.avgPredictedWinRate, winRate);
  const sampleUncertaintyMargin = 0.07 / Math.sqrt(1 + calibrationSamples / 20);
  const calibrationErrorMargin = calibrationSamples >= 10 && empiricalWinRate != null
    ? clamp(Math.abs(empiricalWinRate - averagePredictedWinRate) * 0.5, 0, 0.06)
    : 0;
  const profileMargin = riskProfile === "aggressive" ? 0.025 : 0.045;
  const marketRegimeMargin = regimePenalty(value.regime);
  const volatilityExpansion = Math.max(0, safeNumber(value.volatilityExpansion, 1));
  const volatilityMargin = clamp((volatilityExpansion - 1.15) * 0.025, 0, 0.04);
  const alignment = safeNumber(value.alignment);
  const alignmentMargin = alignment < 0 ? 0.035 : alignment > 0.5 ? -0.01 : 0;
  const modeMargin = candidateModePenalty(value.candidateMode);
  const combinedDirection = Math.abs(safeNumber(value.combinedDirection));
  const strongDirectionDiscount = clamp((combinedDirection - 0.5) * 0.025, 0, 0.015);
  const uncertaintyMargin =
    profileMargin +
    sampleUncertaintyMargin +
    calibrationErrorMargin +
    marketRegimeMargin +
    volatilityMargin +
    alignmentMargin +
    modeMargin -
    strongDirectionDiscount;
  const lowerBound = Math.max(bounds.min, breakEvenWinRate + 0.01);
  const upperBound = Math.max(lowerBound, bounds.max);
  const adaptiveWinRateThreshold = clamp(
    breakEvenWinRate + uncertaintyMargin,
    lowerBound,
    upperBound
  );
  const expectancyPct = safeNumber(value.expectancyPct);
  const passesGate = expectancyPct > 0 && winRate >= adaptiveWinRateThreshold;

  return {
    riskProfile,
    passesGate,
    winRate,
    adaptiveWinRateThreshold,
    breakEvenWinRate,
    executionCostR,
    uncertaintyMargin,
    bounds: { lower: lowerBound, upper: upperBound },
    components: {
      profileMargin,
      sampleUncertaintyMargin,
      calibrationErrorMargin,
      marketRegimeMargin,
      volatilityMargin,
      alignmentMargin,
      modeMargin,
      strongDirectionDiscount
    },
    context: {
      calibrationSamples,
      empiricalWinRate,
      averagePredictedWinRate,
      regime: value.regime || "unknown",
      volatilityExpansion,
      alignment,
      candidateMode: value.candidateMode || "unknown",
      combinedDirection
    }
  };
}
