export const DECISION_GOVERNANCE_MODE = "single_writer_layered_v1";
export const DIRECTION_REVIEW_MODE = "fixed_champion_read_only";
export const EXIT_REVIEW_MODE = "validated_exit_only";

export const DECISION_WRITER_BINDINGS = Object.freeze([
  Object.freeze({ field: "legacyDirectionWeights", owner: "fixed_legacy_champion" }),
  Object.freeze({ field: "factorParticipation", owner: "factor_library_auto_governance" }),
  Object.freeze({ field: "factorLayerWeights", owner: "factor_library_weight_engine" }),
  Object.freeze({ field: "entryProbability", owner: "candidate_probability_pipeline" }),
  Object.freeze({ field: "exitWeights", owner: "post_trade_review" }),
  Object.freeze({ field: "hardRiskLimits", owner: "paper_risk_policy" })
]);

export const DECISION_FIELD_WRITERS = Object.freeze(Object.fromEntries(
  DECISION_WRITER_BINDINGS.map(({ field, owner }) => [field, owner])
));

function list(value) {
  return Array.isArray(value) ? value : [];
}

function check(id, passed, detail) {
  return { id, passed, detail };
}

function duplicateIds(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function buildDecisionGovernanceAudit({
  markets = [],
  factorSnapshots = [],
  reviewConfig = {},
  reviewState = {}
} = {}) {
  const checks = [];
  const conflicts = [];
  const duplicateWriterFields = duplicateIds(DECISION_WRITER_BINDINGS.map(({ field }) => field));
  checks.push(check(
    "single_writer_per_decision_field",
    duplicateWriterFields.length === 0,
    duplicateWriterFields.length ? duplicateWriterFields.join(",") : "each mutable field has one owner"
  ));

  const directionReadOnly =
    reviewConfig.directionMode !== "mutable" &&
    reviewConfig.autoApplyValidatedWeights !== true &&
    reviewState.directionMode !== "mutable";
  checks.push(check(
    "direction_review_is_evidence_only",
    directionReadOnly,
    directionReadOnly ? DIRECTION_REVIEW_MODE : "legacy direction mutation is enabled"
  ));

  for (const market of list(markets)) {
    const layerEntries = Object.entries(market?.factorLayers || {});
    const activeIds = layerEntries.flatMap(([, layer]) => list(layer?.activeFactors).map((factor) => factor?.id));
    const duplicateLayerIds = duplicateIds(activeIds);
    const modelFactorIds = Object.values(market?.modelGovernance || {}).map((model) => model?.factorId).filter(Boolean);
    const modelOrdinaryOverlap = [...new Set(activeIds.filter((id) => modelFactorIds.includes(id)))].sort();
    const symbol = market?.symbol || "unknown";
    checks.push(check(
      `unique_factor_layer_${symbol}`,
      duplicateLayerIds.length === 0,
      duplicateLayerIds.length ? duplicateLayerIds.join(",") : "ordinary factor appears in one layer only"
    ));
    checks.push(check(
      `model_path_isolated_${symbol}`,
      modelOrdinaryOverlap.length === 0,
      modelOrdinaryOverlap.length ? modelOrdinaryOverlap.join(",") : "governance-only models stay outside ordinary heads"
    ));
  }

  for (const snapshot of list(factorSnapshots)) {
    const reuse = snapshot?.modelReuse || {};
    const missed = ["gbm", "garch", "hiddenMarkov"].filter((key) => reuse[key] !== true);
    const symbol = snapshot?.symbol || "unknown";
    checks.push(check(
      `model_output_reuse_${symbol}`,
      missed.length === 0,
      missed.length ? `not reused: ${missed.join(",")}` : "factor snapshot reused the decision-layer model outputs"
    ));
  }

  for (const item of checks) {
    if (!item.passed) conflicts.push({ check: item.id, detail: item.detail });
  }
  return {
    mode: DECISION_GOVERNANCE_MODE,
    conflictFree: conflicts.length === 0,
    directionReviewMode: DIRECTION_REVIEW_MODE,
    exitReviewMode: EXIT_REVIEW_MODE,
    writers: { ...DECISION_FIELD_WRITERS },
    checks,
    conflicts
  };
}
