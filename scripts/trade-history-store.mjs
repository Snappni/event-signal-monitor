import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function storeDir(runtimeDir) {
  return path.join(runtimeDir, "trade-history");
}

function manifestPath(runtimeDir) {
  return path.join(storeDir(runtimeDir), "manifest.json");
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

function shardName(trade) {
  const date = new Date(trade?.closedAt || "");
  if (Number.isNaN(date.getTime())) return "unknown.jsonl";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}.jsonl`;
}

function shardFiles(runtimeDir) {
  const directory = storeDir(runtimeDir);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^(?:\d{4}-\d{2}|unknown)\.jsonl$/.test(name))
    .sort();
}

function readShard(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function writeShard(filePath, rows) {
  if (!rows.length) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  atomicWrite(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

export function compactArchivedTrade(trade) {
  return {
    id: trade?.id || null,
    sessionId: trade?.sessionId || null,
    status: "closed",
    symbol: trade?.symbol || null,
    side: trade?.side || null,
    candidateMode: trade?.candidateMode || null,
    riskProfile: trade?.riskProfile || null,
    openedAt: trade?.openedAt || null,
    closedAt: trade?.closedAt || null,
    closeReason: trade?.closeReason || null,
    entry: safeNumber(trade?.entry),
    exitPrice: safeNumber(trade?.exitPrice),
    takeProfit: safeNumber(trade?.takeProfit),
    stopLoss: safeNumber(trade?.stopLoss),
    originalTakeProfit: safeNumber(trade?.originalTakeProfit, safeNumber(trade?.takeProfit)),
    originalStopLoss: safeNumber(trade?.originalStopLoss, safeNumber(trade?.stopLoss)),
    quantity: safeNumber(trade?.quantity),
    leverage: safeNumber(trade?.leverage),
    notional: safeNumber(trade?.notional),
    marginRequired: safeNumber(trade?.marginRequired),
    grossTradingPnl: safeNumber(trade?.grossTradingPnl),
    realizedPnl: safeNumber(trade?.realizedPnl),
    realizedReturnPct: safeNumber(trade?.realizedReturnPct),
    entryFee: safeNumber(trade?.entryFee),
    exitFee: safeNumber(trade?.exitFee),
    entrySlippageCost: safeNumber(trade?.entrySlippageCost),
    exitSlippageCost: safeNumber(trade?.exitSlippageCost),
    fundingPnl: safeNumber(trade?.fundingPnl),
    winRate: safeNumber(trade?.winRate),
    adaptiveWinRateThreshold: safeNumber(trade?.adaptiveWinRateThreshold),
    breakEvenWinRate: safeNumber(trade?.breakEvenWinRate),
    expectancyPct: safeNumber(trade?.expectancyPct),
    expectancyR: safeNumber(trade?.expectancyR),
    eventImpactScore: safeNumber(trade?.eventImpactScore),
    combinedDirection: safeNumber(trade?.combinedDirection),
    mathSignal: safeNumber(trade?.mathSignal),
    eventDirection: safeNumber(trade?.eventDirection),
    regime: trade?.regime || null,
    factorSnapshot: trade?.factorSnapshot || null,
    exitFactorSnapshot: trade?.exitFactorSnapshot || null,
    exitCounterfactual: trade?.exitCounterfactual || null,
    relatedEvents: Array.isArray(trade?.relatedEvents)
      ? trade.relatedEvents.slice(0, 5).map((event) => ({
          id: event?.id || null,
          source: event?.source || null,
          title: event?.title || null,
          occurredAt: event?.occurredAt || null,
          impactScore: safeNumber(event?.impactScore)
        }))
      : []
  };
}

function rebuildManifest(runtimeDir) {
  const directory = storeDir(runtimeDir);
  fs.mkdirSync(directory, { recursive: true });
  const files = shardFiles(runtimeDir).map((name) => {
    const filePath = path.join(directory, name);
    const rows = readShard(filePath);
    return {
      name,
      records: rows.length,
      bytes: fs.statSync(filePath).size,
      firstClosedAt: rows[0]?.closedAt || null,
      lastClosedAt: rows.at(-1)?.closedAt || null
    };
  });
  const manifest = {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    totalRecords: files.reduce((sum, file) => sum + file.records, 0),
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files
  };
  atomicWrite(manifestPath(runtimeDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function tradeHistoryStats(runtimeDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(runtimeDir), "utf8"));
    if (manifest?.version === STORE_VERSION) return manifest;
  } catch {
    // Rebuild missing or invalid metadata from monthly shards.
  }
  return rebuildManifest(runtimeDir);
}

export function appendTradeHistoryRecords(runtimeDir, trades) {
  const grouped = new Map();
  for (const trade of Array.isArray(trades) ? trades : []) {
    const compact = compactArchivedTrade(trade);
    if (!compact.id || !compact.closedAt) continue;
    const name = shardName(compact);
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(compact);
  }
  if (!grouped.size) return tradeHistoryStats(runtimeDir);
  const directory = storeDir(runtimeDir);
  fs.mkdirSync(directory, { recursive: true });
  let changedAny = false;
  for (const [name, incoming] of grouped) {
    const filePath = path.join(directory, name);
    const existing = readShard(filePath);
    const byId = new Map(existing.map((trade) => [trade.id, trade]));
    let changed = false;
    for (const trade of incoming) {
      const previous = byId.get(trade.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(trade)) {
        byId.set(trade.id, trade);
        changed = true;
      }
    }
    if (!changed) continue;
    changedAny = true;
    const merged = [...byId.values()]
      .sort((left, right) => String(left.closedAt).localeCompare(String(right.closedAt)));
    writeShard(filePath, merged);
  }
  return changedAny ? rebuildManifest(runtimeDir) : tradeHistoryStats(runtimeDir);
}

export function loadTradeHistoryRecords(runtimeDir, { limit } = {}) {
  const directory = storeDir(runtimeDir);
  const maximum = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : null;
  const names = shardFiles(runtimeDir);
  const rows = [];
  for (const name of maximum ? [...names].reverse() : names) {
    rows.push(...readShard(path.join(directory, name)));
    if (maximum && rows.length >= maximum) break;
  }
  const sorted = rows.sort((left, right) =>
    String(left.closedAt || "").localeCompare(String(right.closedAt || ""))
  );
  return maximum ? sorted.slice(-maximum) : sorted;
}

export function queryTradeHistory(runtimeDir, { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const normalizedPage = Math.max(1, Math.floor(safeNumber(page, 1)));
  const normalizedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(safeNumber(pageSize, DEFAULT_PAGE_SIZE))));
  const manifest = tradeHistoryStats(runtimeDir);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const needed = offset + normalizedPageSize;
  const directory = storeDir(runtimeDir);
  const rows = [];
  for (const name of [...manifest.files].reverse().map((file) => file.name)) {
    rows.push(...readShard(path.join(directory, name)).sort((left, right) =>
      String(right.closedAt || "").localeCompare(String(left.closedAt || ""))
    ));
    if (rows.length >= needed) break;
  }
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalRecords: manifest.totalRecords,
    totalPages: Math.max(1, Math.ceil(manifest.totalRecords / normalizedPageSize)),
    totalBytes: manifest.totalBytes,
    records: rows.slice(offset, needed)
  };
}

export function deleteTradeHistoryRecords(runtimeDir, ids) {
  const requested = new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 1_000));
  if (!requested.size) return { deleted: 0, ...tradeHistoryStats(runtimeDir) };
  const directory = storeDir(runtimeDir);
  let deleted = 0;
  for (const name of shardFiles(runtimeDir)) {
    const filePath = path.join(directory, name);
    const rows = readShard(filePath);
    const retained = rows.filter((trade) => !requested.has(String(trade.id)));
    deleted += rows.length - retained.length;
    if (retained.length !== rows.length) writeShard(filePath, retained);
  }
  return { deleted, ...rebuildManifest(runtimeDir) };
}
