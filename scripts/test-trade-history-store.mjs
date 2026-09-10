import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendTradeHistoryRecords,
  compactArchivedTrade,
  deleteTradeHistoryRecords,
  loadTradeHistoryRecords,
  queryTradeHistory,
  tradeHistoryStats
} from "./trade-history-store.mjs";

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "trade-history-store-"));
const trade = (id, closedAt, realizedPnl) => ({
  id,
  signalId: `signal-${id}`,
  candidateId: `candidate-${id}`,
  candidateReasonCode: "accepted",
  sessionId: "session-test",
  status: "closed",
  calibrationCohort: "layered-multi-factor-v1",
  symbol: "BTCUSDT",
  side: "long",
  openedAt: new Date(Date.parse(closedAt) - 3_600_000).toISOString(),
  closedAt,
  closeReason: realizedPnl > 0 ? "TP" : "SL",
  entry: 100,
  exitPrice: 101,
  takeProfit: 105,
  stopLoss: 98,
  quantity: 1,
  leverage: 3,
  realizedPnl,
  realizedReturnPct: realizedPnl / 100,
  winRate: 0.6,
  rawEntryScore: 1.2,
  featureMissingMask: { missing_feature: true },
  maxFavorableExcursionPct: 0.04,
  maxAdverseExcursionPct: -0.01,
  decisionCalculation: {
    direction: {
      combinedDirection: 0.7,
      eventDirection: 0.4,
      eventWeight: 0.3,
      mathDirection: 0.8,
      mathWeight: 0.7
    },
    oversized: "x".repeat(100_000)
  },
  factorSnapshot: { direction: { contributions: { trend: 0.2 } } },
  exitFactorSnapshot: { rawExitScore: 1.35 },
  relatedEvents: [{ event_id: "evt-1", occurred_at: "2026-06-30T20:00:00Z", fetched_at: "2026-06-30T20:01:00Z", normalized_hash: "abc", source: "fixture", language: "en", cluster_id: "cluster-1" }],
  holdingObservations: Array.from({ length: 10_000 }, (_, index) => ({ index })),
  calculation: { oversized: "x".repeat(100_000) }
});

try {
  const rows = [
    trade("trade-a", "2026-06-30T23:00:00.000Z", 2),
    trade("trade-b", "2026-07-01T01:00:00.000Z", -1),
    trade("trade-c", "2026-07-02T01:00:00.000Z", 3)
  ];
  appendTradeHistoryRecords(runtimeDir, rows);
  appendTradeHistoryRecords(runtimeDir, rows);
  appendTradeHistoryRecords(runtimeDir, [{
    ...rows[1],
    exitCounterfactual: { status: "evaluated", beneficial: true }
  }]);
  const stats = tradeHistoryStats(runtimeDir);
  assert.equal(stats.totalRecords, 3);
  assert.equal(stats.files.length, 2);
  assert.ok(stats.totalBytes < 50_000, "archive must omit oversized runtime observations");

  const firstPage = queryTradeHistory(runtimeDir, { page: 1, pageSize: 2 });
  assert.equal(firstPage.totalRecords, 3);
  assert.deepEqual(firstPage.records.map((item) => item.id), ["trade-c", "trade-b"]);
  assert.equal(firstPage.records[1].exitCounterfactual.status, "evaluated");
  assert.equal(Object.hasOwn(firstPage.records[0], "holdingObservations"), false);
  assert.equal(Object.hasOwn(firstPage.records[0], "calculation"), false);
  assert.equal(firstPage.records[0].holdingObservationCount, 10_000);
  assert.equal(firstPage.records[0].decisionCalculation.direction.combinedDirection, 0.7);
  assert.equal(firstPage.records[0].calibrationCohort, "layered-multi-factor-v1");
  assert.equal(firstPage.records[0].candidateId, "candidate-trade-c");
  assert.equal(firstPage.records[0].rawEntryScore, 1.2);
  assert.equal(firstPage.records[0].rawExitScore, 1.35);
  assert.equal(firstPage.records[0].featureMissingMask.missing_feature, true);
  assert.equal(firstPage.records[0].relatedEvents[0].cluster_id, "cluster-1");
  assert.equal(Object.hasOwn(firstPage.records[0].decisionCalculation, "oversized"), false);

  const compact = compactArchivedTrade(rows[0]);
  assert.ok(JSON.stringify(compact).length < 10_000, "paper account history row must stay compact");
  assert.equal(Object.hasOwn(compact, "holdingObservations"), false);

  const secondPage = queryTradeHistory(runtimeDir, { page: 2, pageSize: 2 });
  assert.deepEqual(secondPage.records.map((item) => item.id), ["trade-a"]);
  assert.deepEqual(loadTradeHistoryRecords(runtimeDir).map((item) => item.id), ["trade-a", "trade-b", "trade-c"]);
  assert.deepEqual(
    loadTradeHistoryRecords(runtimeDir, { limit: 2 }).map((item) => item.id),
    ["trade-b", "trade-c"]
  );

  const deletion = deleteTradeHistoryRecords(runtimeDir, ["trade-b", "missing"]);
  assert.equal(deletion.deleted, 1);
  assert.equal(deletion.totalRecords, 2);
  assert.deepEqual(loadTradeHistoryRecords(runtimeDir).map((item) => item.id), ["trade-a", "trade-c"]);
  console.log("trade history store tests passed");
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
