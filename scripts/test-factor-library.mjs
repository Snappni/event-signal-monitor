import assert from "node:assert/strict";
import {
  FACTOR_CATALOG_AUDIT,
  FACTOR_DEFINITIONS,
  FACTOR_HISTORICAL_SAMPLING_MODE,
  FACTOR_RESEARCH_REFERENCES,
  buildHistoricalFactorEvidence,
  buildHistoricalFactorFrames,
  buildFactorSnapshots,
  createFactorLibraryStatus,
  discreteFourierFeatures,
  factorDecisionForSnapshot,
  factorLayerHeadsForSnapshot,
  modelFactorGovernance,
  normalizeFactorLibraryConfig,
  normalizeFactorLibraryStatus,
  mergeHistoricalFactorEvidence,
  publicFactorLibrary,
  updateFactorLibraryConfig,
  updateFactorLibraryRuntime
} from "./factor-library.mjs";
import {
  canonicalExpression,
  chooseMiningCandidate,
  chronologicalFactorEvidence,
  evaluateExpression,
  expressionLeafIds
} from "./factor-research.mjs";

const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT", "DOTUSDT"];

function candles(base, slope, count = 100) {
  return Array.from({ length: count }, (_, index) => {
    const close = base * (1 + slope * index + Math.sin(index / 4) * 0.0002);
    const open = close * (1 - slope * 0.2);
    return {
      time: Date.parse("2026-07-29T00:00:00.000Z") + index * 900_000,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 1000 + index * 7,
      quoteVolume: close * (1000 + index * 7),
      takerBuyQuoteVolume: close * (520 + index * 4)
    };
  });
}

function marketResults(priceMultiplier = 1) {
  return symbols.map((symbol, index) => {
    const slope = (index + 1) * 0.00008;
    const oneMinute = candles(100 + index * 20, slope);
    const fifteenMinute = candles(100 + index * 20, slope * 4, 260);
    const hourly = candles(100 + index * 20, slope * 8, 260);
    const latest = oneMinute.at(-1).close * priceMultiplier ** (index + 1);
    return {
      market: {
        symbol,
        latest,
        atrPct: 0.008,
        returns15m: Array.from({ length: 30 }, (_, offset) => slope * (offset + 1)),
        oiChange: slope * 10,
        hiddenMarkov: { signal: index / (symbols.length - 1) * 2 - 1 },
        microstructure: {
          available: true,
          bookAvailable: true,
          tradeAvailable: true,
          signal: index / (symbols.length - 1) * 2 - 1,
          spreadBps: 1.2,
          microPriceBiasBps: index / 3,
          topBookImbalance: index / (symbols.length - 1) * 2 - 1,
          orderBookImbalance: index / (symbols.length - 1),
          cumulativeVolumeDelta30s: 25_000 * (index + 1),
          flow30s: { imbalance: index / (symbols.length - 1) * 2 - 1, totalQuoteVolume: 200_000, tradeCount: 30 },
          bookFlow30s: {
            imbalance: index / (symbols.length - 1) * 2 - 1,
            bidAddedQuote: 50_000,
            askAddedQuote: 40_000,
            bidCancelledQuote: 10_000,
            askCancelledQuote: 15_000
          },
          bookSlope: index / 10,
          liquidityVoid: 0.1
        }
      },
      factorContext: {
        candles1m: oneMinute,
        candles15m: fifteenMinute,
        candles1h: hourly,
        derivatives: {
          fundingZScore: index / (symbols.length - 1) * 2 - 1,
          perpetualBasis: slope,
          takerImbalance: index / (symbols.length - 1) * 2 - 1,
          depthImbalanceL20: index / (symbols.length - 1) * 2 - 1,
          liquidationImbalance: index / (symbols.length - 1) * 2 - 1,
          longShortContrarian: 1 - index / (symbols.length - 1) * 2,
          basisVolatility: 0.1,
          sources: { okx: { available: true, updatedAt: "2026-07-30T00:00:00.000Z" } }
        }
      }
    };
  });
}

assert.equal(FACTOR_DEFINITIONS.length, 108, "reviewed built-in catalog should only grow by the declared Fourier/model factors");
assert.equal(FACTOR_CATALOG_AUDIT.passed, true, FACTOR_CATALOG_AUDIT.errors.join(", "));
assert.equal(FACTOR_CATALOG_AUDIT.factorCount, 108);
assert.ok(Object.keys(FACTOR_RESEARCH_REFERENCES).length >= 8);
assert.ok(FACTOR_DEFINITIONS.every((item) => item.catalogStatus === "mechanism_validated"));
assert.ok(FACTOR_DEFINITIONS.every((item) => item.referenceIds.length > 0 && item.dataRequirements.length > 0));

const expressionLeft = { type: "operator", operator: "blend", children: [{ type: "factor", id: "return_5m" }, { type: "factor", id: "return_15m" }] };
const expressionRight = { type: "operator", operator: "blend", children: [...expressionLeft.children].reverse() };
assert.equal(canonicalExpression(expressionLeft), canonicalExpression(expressionRight), "commutative DSL expressions must deduplicate canonically");
assert.ok(Math.abs(evaluateExpression(expressionLeft, { return_5m: 0.8, return_15m: -0.2 }) - 0.3) < 1e-12);

const nestedExpression = {
  type: "operator",
  operator: "agreement",
  children: [expressionLeft, { type: "factor", id: "return_1h" }]
};
const multiFactorCandidate = chooseMiningCandidate({
  definitions: [
    {
      id: "validated_pair",
      role: "direction",
      origin: "mined",
      validationStatus: "validated",
      expression: expressionLeft
    },
    { id: "return_1h", role: "direction", origin: "built_in" }
  ],
  metrics: {
    validated_pair: { 15: { samples: 120, meanIc: 0.04, icir: 0.4, coverage: 1 } },
    return_1h: { 15: { samples: 120, meanIc: 0.03, icir: 0.3, coverage: 1 } }
  }
});
assert.equal(multiFactorCandidate.leafCount, 3, "validated expressions must be extendable beyond pair-only mining");
assert.equal(expressionLeafIds(multiFactorCandidate.expression).length, 3);
assert.ok(Number.isFinite(evaluateExpression(nestedExpression, { return_5m: 0.8, return_15m: -0.2, return_1h: 0.4 })));

const periodicCloses = Array.from({ length: 64 }, (_, index) => 100 * Math.exp(0.002 * Math.sin(2 * Math.PI * index / 16)));
const spectral = discreteFourierFeatures(periodicCloses);
assert.ok(spectral.concentration > 0.8, "single periodic component should concentrate spectral energy");
assert.ok(Number.isFinite(spectral.phaseSignal));

const defaultModelGovernance = modelFactorGovernance(normalizeFactorLibraryConfig());
assert.equal(defaultModelGovernance.gbm.useInDecision, true);
assert.equal(defaultModelGovernance.hiddenMarkov.useInDecision, false);
const shadowModelGovernance = modelFactorGovernance(normalizeFactorLibraryConfig({
  factorSettings: { model_gbm_direction: { enabled: true, useInDecision: false } }
}));
assert.equal(shadowModelGovernance.gbm.shadow, true);
assert.equal(shadowModelGovernance.gbm.useInDecision, false);

const stableHoldoutValues = Array.from({ length: 120 }, (_, index) => 0.025 + (index % 3 - 1) * 0.004);
const stableHoldout = chronologicalFactorEvidence({
  values: stableHoldoutValues,
  coverageValues: Array(120).fill(1),
  sourceValues: Array(120).fill(0)
});
assert.equal(stableHoldout.passed, true, "stable chronological evidence should pass the holdout gate");

let governanceConfig = normalizeFactorLibraryConfig({
  autoGovernanceEnabled: true,
  factorSettings: { fourier_dominant_phase: { enabled: true, useInDecision: false } }
});
let governanceStatus = normalizeFactorLibraryStatus({
  metrics: {
    fourier_dominant_phase: {
      15: {
        values: stableHoldoutValues,
        coverageValues: Array(stableHoldoutValues.length).fill(1),
        sourceValues: Array(stableHoldoutValues.length).fill(0)
      }
    }
  }
});
const governanceTrades = (beneficial, count = 400) => Array.from({ length: count }, (_, index) => {
  const side = index % 2 ? "long" : "short";
  const sideDirection = side === "long" ? 1 : -1;
  return {
    id: `governance-${beneficial ? "good" : "bad"}-${index}`,
    side,
    initialMaxLossAmount: 100,
    realizedPnl: beneficial ? 40 : -40,
    closedAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 5 * 3_600_000).toISOString(),
    factorSnapshot: { factorLibrary: { values: { fourier_dominant_phase: sideDirection * 0.6 } } }
  };
});
({ config: governanceConfig, status: governanceStatus } = updateFactorLibraryRuntime({
  config: governanceConfig,
  status: governanceStatus,
  snapshots: [],
  closedTrades: governanceTrades(true),
  now: "2026-07-30T00:00:00.000Z"
}));
({ config: governanceConfig, status: governanceStatus } = updateFactorLibraryRuntime({
  config: governanceConfig,
  status: governanceStatus,
  snapshots: [],
  closedTrades: governanceTrades(true),
  now: "2026-07-31T00:01:00.000Z"
}));
({ config: governanceConfig, status: governanceStatus } = updateFactorLibraryRuntime({
  config: governanceConfig,
  status: governanceStatus,
  snapshots: [],
  closedTrades: governanceTrades(true),
  now: "2026-08-01T00:02:00.000Z"
}));
assert.equal(governanceConfig.factorSettings.fourier_dominant_phase.useInDecision, true, "validated evidence must dwell for 48 hours before promotion");
governanceStatus.metrics.fourier_dominant_phase[15] = {
  values: [...Array(72).fill(0.03), ...Array(48).fill(-0.03)],
  coverageValues: Array(120).fill(1),
  sourceValues: Array(120).fill(0)
};
({ config: governanceConfig, status: governanceStatus } = updateFactorLibraryRuntime({
  config: governanceConfig,
  status: governanceStatus,
  snapshots: [],
  closedTrades: governanceTrades(false, 600),
  now: "2026-08-03T00:03:00.000Z"
}));
({ config: governanceConfig, status: governanceStatus } = updateFactorLibraryRuntime({
  config: governanceConfig,
  status: governanceStatus,
  snapshots: [],
  closedTrades: governanceTrades(false, 600),
  now: "2026-08-04T00:04:00.000Z"
}));
assert.equal(governanceConfig.factorSettings.fourier_dominant_phase.useInDecision, false, "two invalid runs after cooldown should demote a factor to shadow");
assert.ok(governanceStatus.autoGovernance.actions.some((item) => item.action === "promoted_to_decision"));
assert.ok(governanceStatus.autoGovernance.actions.some((item) => item.action === "demoted_to_shadow"));
const signFlipHoldout = chronologicalFactorEvidence({
  values: [...Array(72).fill(0.03), ...Array(24).fill(-0.03), ...Array(24).fill(0.03)],
  coverageValues: Array(120).fill(1),
  sourceValues: Array(120).fill(0)
});
assert.equal(signFlipHoldout.passed, false, "validation sign reversal must fail even when aggregate IC is positive");
const contradictedHoldout = chronologicalFactorEvidence({
  values: [...stableHoldoutValues, ...Array(30).fill(-0.03)],
  coverageValues: Array(150).fill(1),
  sourceValues: [...Array(120).fill(0), ...Array(30).fill(1)]
});
assert.equal(contradictedHoldout.passed, false, "sustained realtime contradiction must block validation");

const legacyDuplicateStatus = normalizeFactorLibraryStatus({
  metrics: {
    mined_difference_news_impact_decay_event_source_consensus: {
      15: { samples: 40, meanIc: 0.03 }
    },
    mined_difference_event_source_consensus_news_impact_decay: {
      15: { samples: 60, meanIc: -0.03 }
    },
    mined_blend_news_impact_decay_event_source_consensus: {
      15: { samples: 45, meanIc: 0.02 }
    }
  },
  minedFactors: [
    {
      id: "mined_difference_news_impact_decay_event_source_consensus",
      leftId: "news_impact_decay",
      rightId: "event_source_consensus",
      operator: "difference",
      origin: "mined",
      role: "direction",
      validationStatus: "rejected",
      createdAt: "2026-07-30T00:00:00.000Z"
    },
    {
      id: "mined_difference_event_source_consensus_news_impact_decay",
      leftId: "event_source_consensus",
      rightId: "news_impact_decay",
      operator: "difference",
      origin: "mined",
      role: "direction",
      validationStatus: "rejected",
      createdAt: "2026-07-30T00:15:00.000Z"
    },
    {
      id: "mined_blend_news_impact_decay_event_source_consensus",
      leftId: "news_impact_decay",
      rightId: "event_source_consensus",
      operator: "blend",
      origin: "mined",
      role: "direction",
      validationStatus: "rejected",
      createdAt: "2026-07-30T00:30:00.000Z"
    }
  ]
});
assert.equal(legacyDuplicateStatus.minedFactors.length, 2, "reversed difference factors must merge semantically");
assert.equal(legacyDuplicateStatus.mining.mergedDuplicateCount, 1);
assert.equal(
  new Set(legacyDuplicateStatus.minedFactors.map((item) => item.semanticKey)).size,
  legacyDuplicateStatus.minedFactors.length,
  "normalized mined factors must have unique semantic keys"
);
assert.ok(legacyDuplicateStatus.minedFactors.some((item) => item.operator === "blend"), "blend must remain distinct from difference");
assert.ok(legacyDuplicateStatus.minedFactors.every((item) => item.operatorLabel && item.category.includes(item.operatorLabel)));
assert.ok(legacyDuplicateStatus.minedFactors.every((item) => !item.name.includes(" × ")), "operator semantics must be visible in names");
const legacyMergedFactor = legacyDuplicateStatus.minedFactors.find((item) => item.operator === "difference");
assert.equal(
  Object.hasOwn(legacyDuplicateStatus.metrics, legacyMergedFactor.mergedDuplicateIds[0]),
  false,
  "removed duplicate metric series must not remain orphaned"
);
const migratedConfig = normalizeFactorLibraryConfig({
  factorSettings: {
    mined_difference_news_impact_decay_event_source_consensus: {
      enabled: true,
      useInDecision: true,
      weight: 2,
      archived: false
    },
    mined_difference_event_source_consensus_news_impact_decay: {
      enabled: false,
      useInDecision: false,
      weight: 1,
      archived: false
    }
  }
}, legacyDuplicateStatus.minedFactors);
assert.equal(migratedConfig.factorSettings[legacyMergedFactor.id].enabled, true, "merged factor must preserve enabled intent");
assert.equal(migratedConfig.factorSettings[legacyMergedFactor.id].useInDecision, true, "merged factor must preserve decision intent");
assert.equal(
  Object.hasOwn(migratedConfig.factorSettings, legacyMergedFactor.mergedDuplicateIds[0]),
  false,
  "removed duplicate settings must not remain orphaned"
);

const operatorStatus = normalizeFactorLibraryStatus({
  minedFactors: ["difference", "blend", "agreement", "signed_product"].map((operator) => ({
    id: `mined_${operator}_return_1m_return_5m`,
    leftId: "return_1m",
    rightId: "return_5m",
    operator,
    origin: "mined",
    role: "direction",
    validationStatus: "quarantine"
  }))
});
const operatorSnapshot = buildFactorSnapshots({ marketResults: marketResults(), status: operatorStatus })[0];
const operatorValues = ["difference", "blend", "agreement", "signed_product"].map(
  (operator) => operatorSnapshot.values[`mined_${operator}_return_1m_return_5m`]
);
assert.equal(new Set(operatorValues).size, 4, "typed DSL operators must produce distinct values for unequal inputs");

let diversityConfig = normalizeFactorLibraryConfig({ miningEnabled: true });
let diversityStatus = createFactorLibraryStatus();
for (let index = 0; index < 6; index += 1) {
  ({ config: diversityConfig, status: diversityStatus } = updateFactorLibraryRuntime({
    config: diversityConfig,
    status: diversityStatus,
    snapshots: [],
    now: new Date(Date.parse("2026-07-30T00:00:00.000Z") + index * 16 * 60_000).toISOString()
  }));
}
const diversityPairs = diversityStatus.minedFactors.map((item) => [item.leftId, item.rightId].sort().join("|"));
assert.equal(new Set(diversityPairs).size, diversityPairs.length, "early mining must diversify parent pairs");
assert.equal(new Set(diversityStatus.minedFactors.map((item) => item.operator)).size, 4, "mining must balance all typed DSL operators");

const directionDefinitions = FACTOR_DEFINITIONS.filter((item) => item.role === "direction");
const rejectedDefinitions = [];
for (let leftIndex = 0; leftIndex < directionDefinitions.length && rejectedDefinitions.length < 20; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < directionDefinitions.length && rejectedDefinitions.length < 20; rightIndex += 1) {
    const operator = ["difference", "blend", "agreement", "signed_product"][rejectedDefinitions.length % 4];
    const leftId = directionDefinitions[leftIndex].id;
    const rightId = directionDefinitions[rightIndex].id;
    rejectedDefinitions.push({
      id: `mined_${operator}_${leftId}_${rightId}`,
      leftId,
      rightId,
      operator,
      origin: "mined",
      role: "direction",
      validationStatus: "rejected",
      createdAt: "2026-07-30T00:00:00.000Z",
      firstRejectedAt: "2026-07-30T06:00:00.000Z"
    });
  }
}
const rejectedMetrics = Object.fromEntries(rejectedDefinitions.map((definition) => [definition.id, {
  15: {
    samples: 200,
    meanIc: 0.001,
    icStd: 0.2,
    icir: 0.005,
    tStatistic: 0.05,
    coverage: 1,
    lastIc: 0.001,
    historySamples: 140,
    realtimeSamples: 60,
    values: Array(200).fill(0.001),
    coverageValues: Array(200).fill(1),
    sourceValues: [...Array(140).fill(0), ...Array(60).fill(1)]
  }
}]));
let recyclingConfig = normalizeFactorLibraryConfig({ miningEnabled: true });
let recyclingStatus = normalizeFactorLibraryStatus({
  minedFactors: rejectedDefinitions,
  metrics: rejectedMetrics,
  mining: { lastRunAt: "2026-07-30T00:00:00.000Z" }
});
const recyclingSnapshots = [{
  symbol: "BTCUSDT",
  price: 100,
  capturedAt: "2026-07-31T00:00:00.000Z",
  values: Object.fromEntries(rejectedDefinitions.map((definition) => [definition.id, 0.1])),
  sources: {}
}];
({ config: recyclingConfig, status: recyclingStatus } = updateFactorLibraryRuntime({
  config: recyclingConfig,
  status: recyclingStatus,
  snapshots: recyclingSnapshots,
  now: "2026-07-31T00:00:00.000Z"
}));
assert.equal(recyclingStatus.retiredMinedFactors.length, 20, "mature rejected factors must move to compact retirement archive");
assert.equal(recyclingStatus.mining.retiredCount, 20);
assert.equal(recyclingStatus.minedFactors.length, 1, "retirement must immediately free one slot for a new candidate");
assert.ok(
  recyclingStatus.retiredMinedFactors.every((item) => item.retiredMetrics?.[15]?.samples === 200),
  "retired factors must retain compact validation evidence"
);
assert.ok(
  recyclingStatus.retiredMinedFactors.every((item) => !Object.hasOwn(recyclingStatus.metrics, item.id)),
  "retired factors must release full rolling metric arrays"
);
assert.ok(
  recyclingStatus.retiredMinedFactors.every((item) => !Object.hasOwn(recyclingSnapshots[0].values, item.id)),
  "retired factor values must not be written back by the retirement cycle snapshot"
);
assert.ok(
  !new Set(recyclingStatus.retiredMinedFactors.map((item) => item.semanticKey)).has(recyclingStatus.minedFactors[0].semanticKey),
  "retired semantics must not be mined again"
);
const recyclingView = publicFactorLibrary(recyclingConfig, recyclingStatus);
assert.equal(recyclingView.counts.retiredMined, 20);
assert.ok(recyclingView.factors.filter((item) => item.retired).every((item) => item.archived && !item.enabled && !item.useInDecision));

let graceStatus = normalizeFactorLibraryStatus({
  minedFactors: [{ ...rejectedDefinitions[0], firstRejectedAt: "2026-07-30T23:00:00.000Z" }],
  metrics: { [rejectedDefinitions[0].id]: rejectedMetrics[rejectedDefinitions[0].id] }
});
({ status: graceStatus } = updateFactorLibraryRuntime({
  config: normalizeFactorLibraryConfig({ miningEnabled: false }),
  status: graceStatus,
  snapshots: [],
  now: "2026-07-31T00:00:00.000Z"
}));
assert.equal(graceStatus.minedFactors.length, 1, "recently rejected factor must retain its observation grace period");
assert.equal(graceStatus.retiredMinedFactors.length, 0);

const validatedDefinition = {
  ...rejectedDefinitions[1],
  validationStatus: "validated",
  orientation: -1,
  firstRejectedAt: "2026-07-01T00:00:00.000Z"
};
let validatedStatus = normalizeFactorLibraryStatus({
  minedFactors: [validatedDefinition],
  metrics: {
    [validatedDefinition.id]: {
      15: {
        ...rejectedMetrics[rejectedDefinitions[1].id][15],
        meanIc: 0.05,
        icStd: 0.1,
        icir: 0.5,
        tStatistic: 5,
        values: Array.from({ length: 200 }, (_, index) => index % 2 ? 0.04 : 0.06),
        coverageValues: Array(200).fill(1),
        sourceValues: [...Array(140).fill(0), ...Array(60).fill(1)]
      }
    }
  }
});
({ status: validatedStatus } = updateFactorLibraryRuntime({
  config: normalizeFactorLibraryConfig({ miningEnabled: false }),
  status: validatedStatus,
  snapshots: [],
  now: "2026-07-31T00:00:00.000Z"
}));
assert.equal(validatedStatus.minedFactors[0].validationStatus, "validated");
assert.equal(validatedStatus.minedFactors[0].orientation, 1, "positive validated IC must clear a stale inverse orientation");
assert.equal(validatedStatus.minedFactors[0].firstRejectedAt, null, "leaving rejected state must reset the continuous rejection clock");
assert.equal(validatedStatus.retiredMinedFactors.length, 0, "validated factor must never be retired by rejected-factor recycling");

const boundedRetirementStatus = normalizeFactorLibraryStatus({
  retiredMinedFactors: Array.from({ length: 2050 }, (_, index) => ({
    id: `mined_blend_synthetic_left_${index}_synthetic_right_${index}`,
    leftId: `synthetic_left_${index}`,
    rightId: `synthetic_right_${index}`,
    operator: "blend",
    origin: "mined",
    role: "direction",
    validationStatus: "rejected",
    retired: true,
    retiredAt: new Date(Date.parse("2026-07-01T00:00:00.000Z") + index * 1_000).toISOString()
  }))
});
assert.equal(boundedRetirementStatus.retiredMinedFactors.length, 2048, "retirement archive must remain hard bounded");

let config = normalizeFactorLibraryConfig({ miningEnabled: true, intelligentAdjustment: true });
let status = createFactorLibraryStatus();
const firstSnapshots = buildFactorSnapshots({ marketResults: marketResults(), status });
assert.ok(firstSnapshots.every((snapshot) => FACTOR_DEFINITIONS.every((definition) => Object.hasOwn(snapshot.values, definition.id))), "every catalog factor must have an explicit value or null");
assert.ok(firstSnapshots.every((snapshot) => Object.values(snapshot.values).every((value) => value == null || value >= -1 && value <= 1)), "all factor outputs must stay in the normalized range");
const openCandleMutation = marketResults();
openCandleMutation[0].factorContext.candles15m.at(-1).close *= 10;
const mutatedFourierSnapshot = buildFactorSnapshots({ marketResults: openCandleMutation, status })[0];
for (const id of ["fourier_dominant_phase", "fourier_spectral_concentration", "fourier_high_frequency_ratio"]) {
  assert.equal(mutatedFourierSnapshot.values[id], firstSnapshots[0].values[id], `${id} must ignore the still-open final candle`);
}
const historicalSeries = Object.fromEntries(
  marketResults().map((item) => [item.market.symbol, item.factorContext.candles15m])
);
const historicalFrames = buildHistoricalFactorFrames({
  seriesBySymbol: historicalSeries,
  intervalMinutes: 15,
  status,
  stride: 1
});
assert.ok(historicalFrames.length > 10, "historical factor frames must be constructed");
const isolatedEvidence = buildHistoricalFactorEvidence({
  config,
  status,
  historicalFrames,
  now: "2026-07-29T23:59:00.000Z",
  sourcePolicy: "self-test-isolated-worker",
  lookbackMonths: 3
});
const liveDuringBackfill = normalizeFactorLibraryStatus({
  metrics: {
    return_15m: {
      15: {
        values: [0.123],
        coverageValues: [1],
        sourceValues: [1]
      }
    }
  }
});
const mergedEvidence = mergeHistoricalFactorEvidence(liveDuringBackfill, isolatedEvidence);
assert.equal(mergedEvidence.historicalBackfill.status, "complete");
assert.equal(mergedEvidence.historicalBackfill.samplingMode, FACTOR_HISTORICAL_SAMPLING_MODE);
assert.ok(mergedEvidence.metrics.return_15m[15].historySamples > 0, "isolated evidence must retain historical IC observations");
assert.equal(mergedEvidence.metrics.return_15m[15].realtimeSamples, 1, "isolated evidence merge must preserve realtime observations created during backfill");
assert.equal(mergedEvidence.metrics.return_15m[15].values.at(-1), 0.123);
({ config, status } = updateFactorLibraryRuntime({
  config,
  status,
  snapshots: firstSnapshots,
  historicalFrames,
  now: "2026-07-30T00:00:00.000Z"
}));
assert.equal(status.minedFactors.length, 1, "enabled mining must create a quarantined candidate");
assert.equal(status.minedFactors[0].validationStatus, "quarantine");
assert.ok(status.minedFactors[0].operatorLabel);
assert.ok(status.minedFactors[0].category.includes(status.minedFactors[0].operatorLabel));

const laterSnapshots = buildFactorSnapshots({ marketResults: marketResults(1.002), status });
({ config, status } = updateFactorLibraryRuntime({
  config,
  status,
  snapshots: laterSnapshots,
  now: "2026-07-30T00:15:01.000Z"
}));
assert.ok(status.metrics.return_1m?.[15]?.samples >= 1, "15-minute IC must be recorded");
assert.ok(Number.isFinite(status.metrics.return_1m[15].meanIc));
assert.ok(status.metrics.return_15m?.[15]?.historySamples > 0, "historical public candles must feed 15-minute IC");
assert.ok(status.metrics.return_15m[15].historySamples <= status.metrics.return_15m[15].samples);
assert.equal(status.historicalBackfill.status, "complete");
assert.equal(status.historicalBackfill.samplingMode, FACTOR_HISTORICAL_SAMPLING_MODE);

const partitionedStatus = normalizeFactorLibraryStatus({
  metrics: {
    return_15m: {
      15: {
        samples: 2304,
        meanIc: 0.01,
        icStd: 0.1,
        icir: 0.1,
        tStatistic: 4.8,
        coverage: 1,
        values: [...Array(1536).fill(0.01), ...Array(768).fill(0.02)],
        coverageValues: Array(2304).fill(1),
        sourceValues: [...Array(1536).fill(0), ...Array(768).fill(1)]
      }
    }
  },
  pendingFrames: [{
    capturedAt: "2026-07-30T00:00:00.000Z",
    prices: Object.fromEntries(symbols.map((symbol) => [symbol, 100])),
    values: Object.fromEntries(symbols.map((symbol, index) => [symbol, { return_15m: index / (symbols.length - 1) * 2 - 1 }])),
    resolvedHorizons: []
  }]
});
const partitionedSnapshots = symbols.map((symbol, index) => ({
  symbol,
  price: 100 * (1 + index * 0.001),
  capturedAt: "2026-07-30T00:15:01.000Z",
  values: { return_15m: index / (symbols.length - 1) * 2 - 1 },
  sources: {}
}));
const partitionedResult = updateFactorLibraryRuntime({
  config: normalizeFactorLibraryConfig({ miningEnabled: false }),
  status: partitionedStatus,
  snapshots: partitionedSnapshots,
  now: "2026-07-30T00:15:01.000Z"
});
assert.equal(partitionedResult.status.metrics.return_15m[15].historySamples, 1536, "realtime observations must never evict the bounded historical partition");
assert.equal(partitionedResult.status.metrics.return_15m[15].realtimeSamples, 768, "realtime partition must remain independently bounded");
assert.equal(partitionedResult.status.metrics.return_15m[15].samples, 2304, "partitioned retention must not increase the previous per-metric storage bound");
const overlappingStatus = partitionedResult.status;
overlappingStatus.pendingFrames.push({
  capturedAt: "2026-07-30T00:01:00.000Z",
  prices: Object.fromEntries(symbols.map((symbol) => [symbol, 100])),
  values: Object.fromEntries(symbols.map((symbol, index) => [symbol, { return_15m: index / (symbols.length - 1) * 2 - 1 }])),
  resolvedHorizons: []
});
overlappingStatus.pendingFrames.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
const overlapResult = updateFactorLibraryRuntime({
  config: normalizeFactorLibraryConfig({ miningEnabled: false }),
  status: overlappingStatus,
  snapshots: partitionedSnapshots,
  now: "2026-07-30T00:16:01.000Z"
});
assert.equal(overlapResult.status.lastRealtimeIcAt[15], "2026-07-30T00:00:00.000Z", "overlapping forward-return labels must not create a second IC observation");

for (const id of ["return_15m", "return_1h", "ema_spread_5_20", "donchian_breakout"]) {
  status.metrics[id] ||= {};
  status.metrics[id][15] = {
    ...(status.metrics[id][15] || {}),
    samples: 40,
    meanIc: 0.1,
    icStd: 0.2,
    icir: 0.5,
    tStatistic: 3,
    coverage: 1
  };
}

const decision = factorDecisionForSnapshot(laterSnapshots[0], config, status);
assert.equal(decision.requestedFactors, 0, "mixed aggregate IC must not bypass the chronological holdout gate");
assert.ok(decision.activeFactors.every((item) => !item.id.startsWith("mined_")), "quarantined factors must not trade");
assert.ok(decision.activeFactors.every((item) => Math.abs(item.orientation) === 1));
assert.equal(decision.sufficient, false, "unvalidated factor evidence must not influence trading");

const validatedDirectionIds = FACTOR_DEFINITIONS
  .filter((item) => item.role === "direction" && item.defaultEnabled)
  .slice(0, 10)
  .map((item) => item.id);
const strictEvidenceStatus = normalizeFactorLibraryStatus({
  metrics: Object.fromEntries(validatedDirectionIds.map((id) => [id, {
    15: {
      samples: stableHoldoutValues.length,
      meanIc: 0.025,
      icStd: 0.004,
      icir: 6.25,
      tStatistic: 60,
      coverage: 1,
      values: stableHoldoutValues,
      coverageValues: Array(stableHoldoutValues.length).fill(1),
      sourceValues: Array(stableHoldoutValues.length).fill(0)
    }
  }]))
});
const strictDecision = factorDecisionForSnapshot(
  laterSnapshots[0],
  normalizeFactorLibraryConfig({ enabled: true }),
  strictEvidenceStatus
);
assert.equal(strictDecision.requestedFactors, 1, "perfectly correlated direction factors must collapse to one representative");
assert.equal(strictDecision.sufficient, false, "one correlation-cluster representative cannot masquerade as ten independent factors");
assert.equal(strictDecision.influence, 0);

const layerFactorIds = Object.fromEntries(["context", "risk"].map((role) => [role,
  FACTOR_DEFINITIONS
    .filter((item) => item.role === role && !item.governanceOnly && Number.isFinite(laterSnapshots[0].values[item.id]))
    .slice(0, 4)
    .map((item) => item.id)
]));
const layeredEvidenceStatus = normalizeFactorLibraryStatus({
  metrics: Object.fromEntries([...validatedDirectionIds, ...layerFactorIds.context, ...layerFactorIds.risk].map((id, definitionIndex) => [id, {
    15: {
      samples: stableHoldoutValues.length,
      meanIc: 0.025,
      icStd: 0.004,
      icir: 6.25,
      tStatistic: 60,
      coverage: 1,
      values: stableHoldoutValues.map((value, sampleIndex) => value + Math.sin((sampleIndex + 1) * (definitionIndex + 2)) * 0.012),
      coverageValues: Array(stableHoldoutValues.length).fill(1),
      sourceValues: Array(stableHoldoutValues.length).fill(0)
    }
  }]))
});
const layeredConfig = normalizeFactorLibraryConfig({
  enabled: true,
  factorSettings: Object.fromEntries([...layerFactorIds.context, ...layerFactorIds.risk].map((id) => [id, {
    enabled: true,
    useInDecision: true,
    weight: 1
  }]))
});
layeredEvidenceStatus.effectiveWeights = Object.fromEntries(layerFactorIds.context.map((id) => [id, 0.1]));
const layerHeads = factorLayerHeadsForSnapshot(laterSnapshots[0], layeredConfig, layeredEvidenceStatus);
assert.equal(layerHeads.direction.sufficient, true);
assert.equal(layerHeads.context.sufficient, true);
assert.equal(layerHeads.risk.sufficient, true);
assert.equal(layerHeads.direction.strength, 1);
assert.equal(layerHeads.context.minimumActiveFactors, 4);
assert.equal(layerHeads.risk.minimumActiveFactors, 4);
assert.equal(layerHeads.context.fullStrengthFactors, 10);
assert.equal(layerHeads.risk.fullStrengthFactors, 10);
assert.equal(layerHeads.context.strength, 0.4);
assert.equal(layerHeads.risk.strength, 0.4);
assert.ok(Math.abs(layerHeads.context.activeFactors.reduce((sum, item) => sum + item.weight, 0) - 0.4) < 1e-12);
assert.ok(Object.values(layerHeads).every((head) => head.activeFactors.every((item) => item.weight <= 0.1 + 1e-12)));
assert.ok(layerHeads.direction.activeFactors.every((item) => validatedDirectionIds.includes(item.id)));
assert.ok(layerHeads.context.activeFactors.every((item) => layerFactorIds.context.includes(item.id)));
assert.ok(layerHeads.risk.activeFactors.every((item) => layerFactorIds.risk.includes(item.id)));
const contextMutatedSnapshot = {
  ...laterSnapshots[0],
  values: {
    ...laterSnapshots[0].values,
    ...Object.fromEntries(layerFactorIds.context.map((id) => [id, -laterSnapshots[0].values[id]]))
  }
};
const contextMutatedHeads = factorLayerHeadsForSnapshot(contextMutatedSnapshot, layeredConfig, layeredEvidenceStatus);
assert.equal(contextMutatedHeads.direction.composite, layerHeads.direction.composite, "context factors must not leak into the direction head");
assert.notEqual(contextMutatedHeads.context.composite, layerHeads.context.composite, "context factors must remain isolated in the context head");
const layeredView = publicFactorLibrary(layeredConfig, layeredEvidenceStatus);
assert.equal(layeredView.decisionReadiness.layers.context.ready, true);
assert.equal(layeredView.decisionReadiness.layers.context.strength, 0.4);
assert.ok(layeredView.factors
  .filter((factor) => layerFactorIds.context.includes(factor.id))
  .every((factor) => factor.effectiveWeight <= 0.1 + 1e-12));

config = updateFactorLibraryConfig(config, {
  factorUpdates: [{ id: "return_1m", enabled: false, useInDecision: false, weight: 3 }],
  archiveIds: [status.minedFactors[0].id],
  decisionInfluence: 0.95
}, status.minedFactors);
assert.equal(config.factorSettings.return_1m.enabled, false);
assert.equal(config.factorSettings[status.minedFactors[0].id].archived, true);
assert.equal(config.decisionInfluence, 0.4, "factor influence must remain capped");

const view = publicFactorLibrary(config, status);
assert.ok(view.counts.total >= 100);
assert.equal(view.catalogAudit.passed, true);
assert.equal(view.samplingPolicy.observationRetention.sourcePartitioned, true);
assert.equal(Object.hasOwn(view.factors[0].metrics[15] || {}, "values"), false, "public API must not expose rolling raw IC arrays");
assert.ok(view.limitations.length >= 3);
assert.equal(view.samplingPolicy.usesPaperPositions, false);
assert.equal(view.samplingPolicy.runsWhenPaperEntriesPaused, true);

console.log(JSON.stringify({
  passed: true,
  builtInFactors: FACTOR_DEFINITIONS.length,
  minedFactors: status.minedFactors.length,
  recordedIcSamples: status.metrics.return_1m[15].samples
}));
