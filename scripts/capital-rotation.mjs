const DEFAULTS = Object.freeze({
  minimumAdvantagePct: 0.003,
  minimumConfidenceMargin: 0.02,
  minimumPositionAgeMinutes: 30,
  maximumPositionsToRotate: 3,
  fullCloseFraction: 0.95
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function remainingExpectancy(position) {
  return number(
    position?.exitEvaluation?.diagnostics?.remainingExpectancyPct,
    number(position?.expectancyPct)
  );
}

export function planCapitalRotation({ account, signal, now, config = {} } = {}) {
  const settings = { ...DEFAULTS, ...(config || {}) };
  const positions = Object.values(account?.positions || {});
  const candidateExpectancyPct = number(signal?.expectancyPct);
  const confidenceMargin = number(signal?.winRate) - number(signal?.adaptiveWinRateThreshold);
  const feeRate = Math.max(0, number(account?.configSnapshot?.takerFeeRate));
  const slippageRate = Math.max(0, number(account?.configSnapshot?.slippageRate));
  const desiredMargin = Math.max(0, number(signal?.accountControl?.marginRequired));
  const desiredEntryFee = Math.max(0, number(signal?.accountControl?.notional) * feeRate);
  const availableEquity = Math.max(0, number(account?.availableEquity, account?.equity));
  const deficit = Math.max(0, desiredMargin + desiredEntryFee - availableEquity);
  const executionBufferPct = 2 * (feeRate + slippageRate);
  const requiredAdvantagePct = Math.max(number(settings.minimumAdvantagePct, 0.003), executionBufferPct * 2);

  const materialDeficit = Math.max(5, desiredMargin * 0.05);
  if (deficit <= 0) return { required: false, feasible: true, releases: [], deficit: 0 };
  if (deficit < materialDeficit) {
    return { required: false, feasible: true, reason: "immaterial_deficit", releases: [], deficit };
  }
  if (candidateExpectancyPct <= 0 || confidenceMargin < number(settings.minimumConfidenceMargin, 0.02)) {
    return {
      required: true,
      feasible: false,
      reason: "candidate_evidence_too_weak",
      deficit,
      candidateExpectancyPct,
      confidenceMargin,
      requiredAdvantagePct,
      releases: []
    };
  }

  const nowMs = Date.parse(now || new Date().toISOString());
  const minimumAgeMs = number(settings.minimumPositionAgeMinutes, 30) * 60_000;
  const eligible = positions
    .filter((position) => position?.symbol !== signal?.symbol)
    .map((position) => {
      const openedMs = Date.parse(position?.openedAt || "");
      const ageMs = Number.isFinite(openedMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - openedMs) : 0;
      const currentExpectancyPct = remainingExpectancy(position);
      return {
        position,
        ageMs,
        currentExpectancyPct,
        advantagePct: candidateExpectancyPct - currentExpectancyPct,
        marginRequired: Math.max(0, number(position?.marginRequired))
      };
    })
    .filter(
      (item) =>
        item.ageMs >= minimumAgeMs &&
        item.marginRequired > 0 &&
        item.advantagePct >= requiredAdvantagePct
    )
    .sort((left, right) => left.currentExpectancyPct - right.currentExpectancyPct);

  let remainingDeficit = deficit;
  const releases = [];
  const maximumPositions = Math.max(1, Math.round(number(settings.maximumPositionsToRotate, 3)));
  for (const item of eligible.slice(0, maximumPositions)) {
    if (remainingDeficit <= 1e-9) break;
    const requestedMargin = Math.min(item.marginRequired, remainingDeficit);
    const rawFraction = requestedMargin / item.marginRequired;
    const fullClose = rawFraction >= clamp(number(settings.fullCloseFraction, 0.95), 0.5, 1);
    const fraction = fullClose ? 1 : clamp(rawFraction, 0, 1);
    const releasedMargin = item.marginRequired * fraction;
    releases.push({
      positionId: item.position.id,
      symbol: item.position.symbol,
      fraction,
      fullClose,
      releasedMargin,
      currentExpectancyPct: item.currentExpectancyPct,
      candidateExpectancyPct,
      advantagePct: item.advantagePct
    });
    remainingDeficit -= releasedMargin;
  }

  if (remainingDeficit > 1e-6) {
    return {
      required: true,
      feasible: false,
      reason: "insufficient_superior_replacement_capacity",
      deficit,
      unresolvedDeficit: remainingDeficit,
      candidateExpectancyPct,
      confidenceMargin,
      requiredAdvantagePct,
      releases: []
    };
  }
  return {
    required: true,
    feasible: true,
    deficit,
    unresolvedDeficit: 0,
    candidateExpectancyPct,
    confidenceMargin,
    requiredAdvantagePct,
    releases
  };
}
