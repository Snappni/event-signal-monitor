import assert from "node:assert/strict";
import {
  FACTOR_DEFINITIONS,
  buildHistoricalFactorFrames,
  buildFactorSnapshots,
  createFactorLibraryStatus,
  factorDecisionForSnapshot,
  normalizeFactorLibraryConfig,
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
