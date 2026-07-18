import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendCompactHistory,
  buildCompactHistoryRecord,
  pruneHistoryArchives
} from "./compact-history.mjs";

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "compact-history-test-"));
const filePath = path.join(runtime, "history.jsonl");
const report = {
  version: "test",
  generatedAt: "2026-07-18T00:00:00.000Z",
  mode: "paper-alert-only",
  sourceCounts: { rss: 100 },
  warnings: [],
  actionableSignals: [],
  watchlist: [],
  activeSignals: [],
  messageFeed: Array.from({ length: 100 }, () => ({ text: "x".repeat(10_000) })),
  paperAccount: {
    sessionId: "session",
    equity: 1000,
    lifetimeClosedTrades: 640,
    positions: {},
    tradeHistory: [],
    lastRun: { openedPositions: [], closedPositions: [] },
    postTradeReview: { weightVersion: 1, exitWeightVersion: 1 }
  }
};
const record = buildCompactHistoryRecord(report);
assert.ok(JSON.stringify(record).length < 10_000, "compact history must not include full message/report payloads");
assert.equal(record.account.closedTradeCount, 640, "compact history must keep the lifetime trade count");
const state = {};
const first = appendCompactHistory({ filePath, report, state });
assert.equal(first.written, true);
const second = appendCompactHistory({
  filePath,
  report: { ...report, generatedAt: "2026-07-18T00:00:10.000Z" },
  state
});
assert.equal(second.written, false);
const third = appendCompactHistory({
  filePath,
  report: { ...report, generatedAt: "2026-07-18T00:01:01.000Z" },
  state
});
assert.equal(third.written, true);
assert.equal(fs.readFileSync(filePath, "utf8").trim().split("\n").length, 2);
for (let index = 0; index < 6; index += 1) {
  const archivePath = `${filePath}.2026-07-18T00-0${index}-00-000Z.archive`;
  fs.writeFileSync(archivePath, String(index));
  fs.utimesSync(archivePath, new Date(2026, 0, 1, 0, index), new Date(2026, 0, 1, 0, index));
}
const retention = pruneHistoryArchives(filePath, 4);
assert.equal(retention.removed.length, 2);
assert.equal(retention.kept.length, 4);
assert.equal(
  fs.readdirSync(runtime).filter((name) => name.endsWith(".archive")).length,
  4,
  "archive retention must bound future history growth"
);
fs.rmSync(runtime, { recursive: true, force: true });

console.log("compact history tests passed");
