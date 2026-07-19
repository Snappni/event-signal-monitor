import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendTradeHistoryRecords,
  deleteTradeHistoryRecords,
  loadTradeHistoryRecords,
  queryTradeHistory,
  tradeHistoryStats
} from "./trade-history-store.mjs";

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "trade-history-store-"));
const trade = (id, closedAt, realizedPnl) => ({
  id,
  sessionId: "session-test",
  status: "closed",
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
  factorSnapshot: { direction: { contributions: { trend: 0.2 } } },
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
