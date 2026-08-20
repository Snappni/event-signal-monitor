#!/usr/bin/env node
import fs from "node:fs";
import {
  buildHistoricalFactorEvidence,
  buildHistoricalFactorFrames
} from "./factor-library.mjs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function parseBinanceKline(row) {
  return {
    time: safeNumber(row?.[0]),
    open: safeNumber(row?.[1]),
    high: safeNumber(row?.[2]),
    low: safeNumber(row?.[3]),
    close: safeNumber(row?.[4]),
    volume: safeNumber(row?.[5]),
    quoteVolume: safeNumber(row?.[7]),
    tradeCount: safeNumber(row?.[8]),
    takerBuyVolume: safeNumber(row?.[9]),
    takerBuyQuoteVolume: safeNumber(row?.[10])
  };
}

function parseOkxCandle(row) {
  return {
    time: safeNumber(row?.[0]),
    open: safeNumber(row?.[1]),
    high: safeNumber(row?.[2]),
    low: safeNumber(row?.[3]),
    close: safeNumber(row?.[4]),
    volume: safeNumber(row?.[5]),
    quoteVolume: safeNumber(row?.[7])
  };
}

async function fetchJson(url, attempts = 3) {
  const reasons = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 event-signal-monitor/factor-history-worker",
          Accept: "application/json,text/plain,*/*"
        }
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
      return JSON.parse(body);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
      if (attempt < attempts) await sleep(400 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(reasons.join(" | "));
}

async function fetchBinanceHistory(symbol, intervalMinutes, fromMs, toMs) {
  const interval = intervalMinutes === 60 ? "1h" : `${intervalMinutes}m`;
  const intervalMs = intervalMinutes * 60_000;
  const rows = [];
  let cursor = fromMs;
  for (let page = 0; page < 10; page += 1) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${toMs}&limit=1500`;
    const payload = await fetchJson(url);
    if (!Array.isArray(payload)) throw new Error(`Binance historical ${symbol} returned invalid JSON`);
    const batch = payload
      .map(parseBinanceKline)
      .filter((candle) => candle.close > 0 && candle.time >= fromMs && candle.time <= toMs);
    rows.push(...batch);
    const newest = Math.max(0, ...batch.map((candle) => candle.time));
    if (!batch.length || newest >= toMs || newest < cursor) break;
    cursor = newest + intervalMs;
    if (cursor > toMs) break;
    await sleep(120);
  }
  return [...new Map(rows.map((candle) => [candle.time, candle])).values()]
    .sort((left, right) => left.time - right.time);
}

async function fetchOkxHistory(symbol, intervalMinutes, fromMs, toMs) {
  const instId = symbol.replace("USDT", "-USDT-SWAP");
  const bar = intervalMinutes === 60 ? "1H" : `${intervalMinutes}m`;
  const rows = [];
  let cursor = String(toMs);
  for (let page = 0; page < 40; page += 1) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${bar}&limit=300&after=${cursor}`;
    const payload = await fetchJson(url);
    if (String(payload?.code ?? "0") !== "0") throw new Error(payload?.msg || `OKX historical ${symbol} error`);
    const rawRows = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...rawRows
      .map(parseOkxCandle)
      .filter((candle) => candle.close > 0 && candle.time >= fromMs && candle.time <= toMs));
    const times = rawRows.map((row) => safeNumber(row?.[0])).filter((time) => time > 0);
    if (!times.length) break;
    const oldest = Math.min(...times);
    if (oldest <= fromMs || oldest >= Number(cursor)) break;
    cursor = String(oldest - 1);
    await sleep(250);
  }
  return [...new Map(rows.map((candle) => [candle.time, candle])).values()]
    .sort((left, right) => left.time - right.time);
}

async function firstHistory(symbol, intervalMinutes, fromMs, toMs) {
  const reasons = [];
  for (const loader of [fetchBinanceHistory, fetchOkxHistory]) {
    try {
      const candles = await loader(symbol, intervalMinutes, fromMs, toMs);
      if (candles.length >= 50) return candles;
      reasons.push(`only ${candles.length} candles`);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(reasons.join(" | "));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  if (!inputPath || !outputPath) throw new Error("factor history worker paths are required");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const parentPid = safeNumber(input.parentPid);
  const parentWatch = parentPid > 0
    ? setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        process.exit(74);
      }
    }, 1_000)
    : null;
  parentWatch?.unref();

  if (input.testMode === "hang") {
    setInterval(() => {}, 1_000);
    await new Promise(() => {});
  }

  const intervalMinutes = Math.max(1, safeNumber(input.intervalMinutes, 15));
  const lookbackMonths = Math.max(1, safeNumber(input.lookbackMonths, 3));
  const toMs = Date.now() - 2 * 24 * 60 * 60 * 1_000;
  const fromMs = toMs - lookbackMonths * 31 * 24 * 60 * 60 * 1_000;
  const failures = [];
  const results = await mapWithConcurrency(input.symbols || [], 2, async (symbol) => {
    try {
      return { symbol, candles: await firstHistory(symbol, intervalMinutes, fromMs, toMs) };
    } catch (error) {
      failures.push({ symbol, error: error instanceof Error ? error.message : String(error) });
      return { symbol, candles: [] };
    }
  });
  const seriesBySymbol = Object.fromEntries(results
    .filter(({ candles }) => candles.length >= 50)
    .map(({ symbol, candles }) => [symbol, candles]));
  const symbolCount = Object.keys(seriesBySymbol).length;
  const minimumSymbols = Math.max(3, safeNumber(input.minimumSymbols, 8));
  if (symbolCount < minimumSymbols) {
    throw new Error(`历史 K 线有效标的不足：${symbolCount}；${failures.slice(0, 6).map((item) => `${item.symbol}: ${item.error}`).join("；")}`);
  }
  const frames = buildHistoricalFactorFrames({
    seriesBySymbol,
    intervalMinutes,
    status: input.status,
    stride: 1
  });
  if (!frames.length) throw new Error("历史 K 线未生成有效因子帧");
  const evidence = buildHistoricalFactorEvidence({
    config: input.config,
    status: input.status,
    historicalFrames: frames,
    now: new Date().toISOString(),
    sourcePolicy: input.sourcePolicy,
    lookbackMonths
  });
  writeJson(outputPath, {
    ok: true,
    evidence,
    diagnostics: {
      requestedSymbols: (input.symbols || []).length,
      successfulSymbols: symbolCount,
      failures
    }
  });
}

main().catch((error) => {
  if (outputPath) {
    try {
      writeJson(outputPath, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    } catch {
      // Parent process also captures the worker exit code.
    }
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
