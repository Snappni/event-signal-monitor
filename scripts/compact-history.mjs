import fs from "node:fs";
import path from "node:path";

const WRITE_INTERVAL_MS = 60_000;
const MAX_ACTIVE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVES = 4;
const MIN_FREE_RATIO = 0.1;

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactPosition(position) {
  return {
    id: position?.id || null,
    symbol: position?.symbol || null,
    side: position?.side || null,
    openedAt: position?.openedAt || null,
    currentPrice: safeNumber(position?.currentPrice),
    unrealizedPnl: safeNumber(position?.unrealizedPnl),
    exitScore: safeNumber(position?.exitEvaluation?.exitScore),
    exitThreshold: safeNumber(position?.exitEvaluation?.threshold),
    exitConfirmationCount: safeNumber(position?.exitConfirmationCount)
  };
}

function compactTrade(trade) {
  return {
    id: trade?.id || null,
    symbol: trade?.symbol || null,
    side: trade?.side || null,
    openedAt: trade?.openedAt || null,
    closedAt: trade?.closedAt || null,
    closeReason: trade?.closeReason || null,
    realizedPnl: safeNumber(trade?.realizedPnl),
    exitScore: safeNumber(trade?.exitFactorSnapshot?.exitScore)
  };
}

export function buildCompactHistoryRecord(report) {
  const account = report?.paperAccount || {};
  const review = account?.postTradeReview || report?.postTradeReview || {};
  return {
    schema: "compact-history/v1",
    generatedAt: report?.generatedAt || new Date().toISOString(),
    version: report?.version || null,
    mode: report?.mode || null,
    sourceCounts: report?.sourceCounts || {},
    warnings: Array.isArray(report?.warnings) ? report.warnings.slice(0, 20) : [],
    signalCounts: {
      actionable: Array.isArray(report?.actionableSignals) ? report.actionableSignals.length : 0,
      watch: Array.isArray(report?.watchlist) ? report.watchlist.length : 0,
      active: Array.isArray(report?.activeSignals) ? report.activeSignals.length : 0
    },
    account: {
      sessionId: account?.sessionId || null,
      equity: safeNumber(account?.equity),
      realizedPnl: safeNumber(account?.realizedPnl),
      unrealizedPnl: safeNumber(account?.unrealizedPnl),
      marginUsed: safeNumber(account?.marginUsed),
      availableEquity: safeNumber(account?.availableEquity),
      openPositions: Object.values(account?.positions || {}).map(compactPosition),
      closedTradeCount: Math.max(
        Array.isArray(account?.tradeHistory) ? account.tradeHistory.length : 0,
        safeNumber(account?.lifetimeClosedTrades)
      ),
      openedThisRun: Array.isArray(account?.lastRun?.openedPositions)
        ? account.lastRun.openedPositions.map(compactPosition)
        : [],
      closedThisRun: Array.isArray(account?.lastRun?.closedPositions)
        ? account.lastRun.closedPositions.map(compactTrade)
        : []
    },
    review: {
      directionWeightVersion: safeNumber(review?.weightVersion, 1),
      exitWeightVersion: safeNumber(review?.exitWeightVersion, 1),
      latestStatus: review?.latestReview?.status || null,
      promotionEligible: review?.latestReview?.promotionEligible === true
    }
  };
}

function recordFingerprint(record) {
  return JSON.stringify({
    warnings: record.warnings,
    openIds: record.account.openPositions.map((position) => position.id),
    openedIds: record.account.openedThisRun.map((position) => position.id),
    closedIds: record.account.closedThisRun.map((trade) => trade.id),
    review: record.review
  });
}

function diskStatus(targetPath) {
  try {
    const stat = fs.statfsSync(path.dirname(targetPath));
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return {
      totalBytes,
      freeBytes,
      freeRatio: totalBytes > 0 ? freeBytes / totalBytes : 1
    };
  } catch {
    return { totalBytes: null, freeBytes: null, freeRatio: null };
  }
}

function rotateOversizedHistory(filePath, now) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_ACTIVE_FILE_BYTES) return null;
    const stamp = String(now || new Date().toISOString()).replace(/[:.]/g, "-");
    const archivePath = `${filePath}.${stamp}.archive`;
    fs.renameSync(filePath, archivePath);
    return archivePath;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function pruneHistoryArchives(filePath, keep = MAX_ARCHIVES) {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { kept: [], removed: [], errors: [] };
    throw error;
  }
  const archives = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".archive"))
    .map((entry) => {
      const archivePath = path.join(directory, entry.name);
      return { path: archivePath, mtimeMs: fs.statSync(archivePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  const kept = archives.slice(0, Math.max(0, keep)).map((item) => item.path);
  const removed = [];
  const errors = [];
  for (const item of archives.slice(Math.max(0, keep))) {
    try {
      fs.unlinkSync(item.path);
      removed.push(item.path);
    } catch (error) {
      errors.push({ path: item.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { kept, removed, errors };
}

export function appendCompactHistory({ filePath, report, state, now = report?.generatedAt }) {
  const record = buildCompactHistoryRecord(report);
  const fingerprint = recordFingerprint(record);
  const tracking = state.compactHistory && typeof state.compactHistory === "object" ? state.compactHistory : {};
  const nowMs = Date.parse(now || record.generatedAt);
  const lastWriteMs = Date.parse(tracking.lastWrittenAt || "");
  const periodicDue = !Number.isFinite(lastWriteMs) || nowMs - lastWriteMs >= WRITE_INTERVAL_MS;
  const changed = tracking.lastFingerprint !== fingerprint;
  const storage = diskStatus(filePath);
  if (storage.freeRatio !== null && storage.freeRatio < MIN_FREE_RATIO) {
    state.compactHistory = {
      ...tracking,
      lastStatus: "paused_low_disk",
      checkedAt: record.generatedAt,
      storage
    };
    return { written: false, reason: "low_disk", storage };
  }
  if (!periodicDue && !changed) {
    state.compactHistory = {
      ...tracking,
      lastStatus: "unchanged",
      checkedAt: record.generatedAt,
      storage
    };
    return { written: false, reason: "unchanged", storage };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rotatedPath = rotateOversizedHistory(filePath, record.generatedAt);
  const archiveRetention = pruneHistoryArchives(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  state.compactHistory = {
    version: 1,
    lastWrittenAt: record.generatedAt,
    lastFingerprint: fingerprint,
    lastStatus: "written",
    checkedAt: record.generatedAt,
    storage,
    rotatedPath,
    archiveRetention
  };
  return {
    written: true,
    reason: changed ? "changed" : "periodic",
    storage,
    rotatedPath,
    archiveRetention
  };
}
