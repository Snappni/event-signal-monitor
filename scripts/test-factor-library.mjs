import assert from "node:assert/strict";
import {
  FACTOR_DEFINITIONS,
  buildHistoricalFactorFrames,
  buildFactorSnapshots,
  createFactorLibraryStatus,
  factorDecisionForSnapshot,
  normalizeFactorLibraryConfig,
  normalizeFactorLibraryStatus,
  publicFactorLibrary,
  updateFactorLibraryConfig,
  updateFactorLibraryRuntime
} from "./factor-library.mjs";

const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

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
        hiddenMarkov: { signal: index / 5 * 2 - 1 },
        microstructure: {
          available: true,
          bookAvailable: true,
          tradeAvailable: true,
          signal: index / 5 * 2 - 1,
          spreadBps: 1.2,
          microPriceBiasBps: index / 3,
          topBookImbalance: index / 5 * 2 - 1,
          orderBookImbalance: index / 6,
          cumulativeVolumeDelta30s: 25_000 * (index + 1),
          flow30s: { imbalance: index / 5 * 2 - 1, totalQuoteVolume: 200_000, tradeCount: 30 },
          bookFlow30s: {
            imbalance: index / 5 * 2 - 1,
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
          fundingZScore: index / 3,
          perpetualBasis: slope,
          takerImbalance: index / 5 * 2 - 1,
          depthImbalanceL20: index / 5 * 2 - 1,
          liquidationImbalance: index / 5 * 2 - 1,
          longShortContrarian: 1 - index / 5 * 2,
          basisVolatility: 0.1,
          sources: { okx: { available: true, updatedAt: "2026-07-30T00:00:00.000Z" } }
        }
      }
    };
  });
}

assert.ok(FACTOR_DEFINITIONS.length >= 50, "factor library must ship with at least 50 built-in factors");

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
  minedFactors: ["difference", "blend", "agreement"].map((operator) => ({
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
const operatorValues = ["difference", "blend", "agreement"].map(
  (operator) => operatorSnapshot.values[`mined_${operator}_return_1m_return_5m`]
);
assert.equal(new Set(operatorValues).size, 3, "difference, blend and agreement must produce distinct values for unequal inputs");

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
assert.equal(new Set(diversityStatus.minedFactors.map((item) => item.operator)).size, 3, "mining must balance all three operators");

const directionDefinitions = FACTOR_DEFINITIONS.filter((item) => item.role === "direction");
const rejectedDefinitions = [];
for (let leftIndex = 0; leftIndex < directionDefinitions.length && rejectedDefinitions.length < 20; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < directionDefinitions.length && rejectedDefinitions.length < 20; rightIndex += 1) {
    const operator = ["difference", "blend", "agreement"][rejectedDefinitions.length % 3];
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
    samples: 90,
    meanIc: 0.001,
    icStd: 0.2,
    icir: 0.005,
    tStatistic: 0.05,
    coverage: 1,
    lastIc: 0.001,
    historySamples: 60,
    realtimeSamples: 30,
    values: Array(90).fill(0.001),
    coverageValues: Array(90).fill(1),
    sourceValues: [...Array(60).fill(0), ...Array(30).fill(1)]
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
  recyclingStatus.retiredMinedFactors.every((item) => item.retiredMetrics?.[15]?.samples === 90),
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
        tStatistic: 5
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
assert.equal(status.historicalBackfill.samplingMode, "hourly_anchors_non_overlapping_v2");

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
assert.ok(decision.requestedFactors >= 4);
assert.ok(decision.activeFactors.every((item) => !item.id.startsWith("mined_")), "quarantined factors must not trade");
assert.ok(decision.activeFactors.every((item) => Math.abs(item.orientation) === 1));
assert.equal(decision.sufficient, false, "fewer than ten validated factors must not influence trading");

config = updateFactorLibraryConfig(config, {
  factorUpdates: [{ id: "return_1m", enabled: false, useInDecision: false, weight: 3 }],
  archiveIds: [status.minedFactors[0].id],
  decisionInfluence: 0.95
}, status.minedFactors);
assert.equal(config.factorSettings.return_1m.enabled, false);
assert.equal(config.factorSettings[status.minedFactors[0].id].archived, true);
assert.equal(config.decisionInfluence, 0.4, "factor influence must remain capped");

const view = publicFactorLibrary(config, status);
assert.ok(view.counts.total >= 50);
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
