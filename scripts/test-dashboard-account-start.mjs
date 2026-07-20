import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.join(__dirname, "serve-dashboard.mjs");
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-signal-dashboard-test-"));
const largeMessage = `MESSAGE_ONLY_${"x".repeat(100_000)}`;
const largeModel = `MODEL_ONLY_${"y".repeat(100_000)}`;
fs.writeFileSync(
  path.join(runtimeDir, "latest-report.json"),
  JSON.stringify({
    version: "test",
    generatedAt: new Date().toISOString(),
    mode: "paper-alert-only",
    sourceCounts: { rss: 1, marketAnalyses: 1, uniqueStories: 182 },
    warnings: [],
    messageFeedStats: { total: 182, displayed: 1, limit: 200 },
    messageFeed: [{ title: "message", text: largeMessage }],
    modelCalculations: [{ symbol: "BTCUSDT", mathBreakdown: { formula: largeModel } }],
    actionableSignals: [],
    watchlist: [],
    activeSignals: [],
    closedSignals: []
  }),
  "utf8"
);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForDashboard(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dashboard exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("dashboard did not become ready");
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [dashboardPath], {
  env: {
    ...process.env,
    SIGNAL_DASHBOARD_PORT: String(port),
    SIGNAL_RUNTIME_DIR: runtimeDir,
    SIGNAL_DASHBOARD_AUTO_START_SERVICE: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForDashboard(baseUrl, child);
  const [indexResponse, summaryPageResponse, reviewPageResponse, signalsPageResponse, messagesPageResponse, modelsPageResponse, logsPageResponse, appScriptResponse, summaryScriptResponse, reviewScriptResponse, clockScriptResponse, echartsResponse] =
    await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/summary.html`),
      fetch(`${baseUrl}/review.html`),
      fetch(`${baseUrl}/signals.html`),
      fetch(`${baseUrl}/messages.html`),
      fetch(`${baseUrl}/models.html`),
      fetch(`${baseUrl}/logs.html`),
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/summary.js`),
      fetch(`${baseUrl}/review.js`),
      fetch(`${baseUrl}/beijing-clock.js`),
      fetch(`${baseUrl}/vendor/echarts.min.js`)
    ]);
  for (const response of [indexResponse, summaryPageResponse, reviewPageResponse, signalsPageResponse, messagesPageResponse, modelsPageResponse, logsPageResponse, appScriptResponse, summaryScriptResponse, reviewScriptResponse, clockScriptResponse, echartsResponse]) {
    assert.equal(response.status, 200);
  }
  const [indexHtml, summaryHtml, reviewHtml, signalsHtml, messagesHtml, modelsHtml, logsHtml, appScript, summaryScript, reviewScript, clockScript] = await Promise.all([
    indexResponse.text(),
    summaryPageResponse.text(),
    reviewPageResponse.text(),
    signalsPageResponse.text(),
    messagesPageResponse.text(),
    modelsPageResponse.text(),
    logsPageResponse.text(),
    appScriptResponse.text(),
    summaryScriptResponse.text(),
    reviewScriptResponse.text(),
    clockScriptResponse.text()
  ]);
  for (const id of ["accountCapital", "accountMarketType", "accountMaxLeverage", "accountRiskProfile", "accountTakerFeePct", "accountSlippagePct", "accountFundingIntervalHours", "startAccountButton", "saveAccountButton", "resetAccountButton", "summaryButton"]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `missing main-page control ${id}`);
  }
  assert.ok(signalsHtml.includes('id="signals"'), "missing signals-page list");
  for (const id of ["messageFilterKeywords", "messageAggregatorEnabled", "messageAggregatorConnectButton", "messageValue", "messageDisplayCount", "messages", "warnings"]) {
    assert.ok(messagesHtml.includes(`id="${id}"`), `missing messages-page control ${id}`);
  }
  assert.ok(modelsHtml.includes('id="models"'), "missing models-page list");
  for (const id of ["logView", "logNotice", "toggleRawLog"]) {
    assert.ok(logsHtml.includes(`id="${id}"`), `missing logs-page control ${id}`);
  }
  const pageHtml = [indexHtml, summaryHtml, reviewHtml, signalsHtml, messagesHtml, modelsHtml, logsHtml];
  for (const html of pageHtml) {
    for (const href of ["/", "/summary.html", "/signals.html", "/messages.html", "/models.html", "/logs.html", "/review.html"]) {
      assert.ok(html.includes(`href="${href}"`), `missing sidebar link ${href}`);
    }
  }
  assert.ok(summaryHtml.includes('src="/vendor/echarts.min.js"'));
  assert.ok(modelsHtml.includes('id="signalCalibration"'), "models page must expose the bounded signal outcome dataset");
  assert.ok(indexHtml.includes('src="/vendor/echarts.min.js"'), "position charts require the bundled ECharts runtime");
  assert.ok(indexHtml.includes('id="healthStatus"'), "main page must expose the event-service health state");
  assert.ok(indexHtml.includes("监控服务持续运行"), "paper-entry controls must explain service independence");
  assert.ok(summaryHtml.includes('id="refreshSummary"'));
  for (const id of ["reviewEveryTrades", "reviewAutoApply", "applyCandidate", "rollbackWeights", "refreshReview", "reviewDecision", "historyDatabaseButton", "historyDatabasePanel", "historySelectAll", "historyDeleteSelected", "historyDatabaseRows"]) {
    assert.ok(reviewHtml.includes(`id="${id}"`), `missing review-page control ${id}`);
  }
  for (const binding of ["messageAggregatorForm", "accountForm", "resetAccountButton", "startAccountButton", "summaryButton", "accountMarketType"]) {
    assert.ok(appScript.includes(`$("#${binding}")`), `missing main-page event binding ${binding}`);
  }
  assert.ok(summaryScript.includes('$("#refreshSummary").addEventListener("click", loadSummary)'));
  for (const pageScript of [appScript, summaryScript, reviewScript]) {
    assert.ok(pageScript.startsWith('import "./beijing-clock.js";'), "every page script must start the independent Beijing clock");
  }
  assert.ok(clockScript.includes('timeZone: "Asia/Shanghai"'), "live clock must force Beijing timezone");
  assert.ok(clockScript.includes('second: "2-digit"'), "live clock must render seconds");
  assert.ok(clockScript.includes("setInterval(updateClock, 1_000)"), "live clock must update every second independently of data polling");
  assert.ok(clockScript.includes('clock.id = CLOCK_ID'), "live clock must expose one stable DOM target");
  for (const binding of ["reviewForm", "applyCandidate", "rollbackWeights", "refreshReview", "historyDatabaseButton", "historySelectAll", "historyDeleteSelected"]) {
    assert.ok(reviewScript.includes(`$("#${binding}").addEventListener`), `missing review-page event binding ${binding}`);
  }
  assert.ok(reviewScript.includes("formDirty = true"), "review form must preserve unsaved input");
  assert.ok(
    reviewScript.includes("previousExitWeights"),
    "exit-only promotions must remain rollback-capable"
  );
  assert.ok(reviewScript.includes("setInterval(loadReview, 15_000)"), "review page must refresh without losing form state");
  assert.ok(reviewScript.includes('data-detail-key="${esc(detailKey)}"'), "review details need stable expansion keys");
  assert.ok(appScript.includes('data-detail-key="${escapeHtml(item.symbol || "-")}"'), "model details need stable expansion keys");
  assert.ok(appScript.includes("/api/page-data?view="), "dedicated pages must use the slim page-data endpoint");
  assert.ok(!appScript.includes('getJson("/api/report")'), "dedicated pages must not download the full report");
  assert.ok(
    appScript.includes("loadMessageTranslations(state.report)"),
    "message translation must receive the page report from state"
  );
  assert.ok(appScript.includes('postJson("/api/account/stop")'), "paper entries need an explicit pause action");
  assert.ok(!appScript.includes("规则不可用：停止新开仓"), "paper-only UI must not claim missing exchange rules stop entries");
  assert.ok(!appScript.includes("text.leverageRule"), "account metrics must omit the leverage-rule label");
  assert.ok(appScript.includes('signalRow(signal, text.watch, "", false)'), "watch samples must hide executable sizing");
  assert.ok(appScript.includes("text.notExecutable"), "watch samples need an explicit non-executable state");
  assert.ok(appScript.includes("accountFormDirty: false"), "account form needs persistent draft state");
  assert.ok(appScript.includes("if (!state.accountFormDirty)"), "background refresh must preserve an edited account form");
  assert.ok(appScript.includes('for (const eventName of ["input", "change"])'), "all account inputs must mark the form dirty");
  assert.ok(appScript.includes("leverageInput.dataset.futuresValue"), "market switching must preserve the futures leverage draft");
  assert.ok(appScript.includes('timeZone: "Asia/Shanghai"'), "dashboard timestamps must use Beijing time explicitly");
  assert.ok(appScript.includes("北京时间 UTC+8"), "dashboard timestamps must label their timezone");
  assert.ok(appScript.includes("信号结果观察中（最长 72 小时，非仓位）"), "tracked signals must expose their bounded observation window");
  assert.ok(appScript.includes("清晰视图时间：北京时间 UTC+8"), "clean log view must label converted timestamps");
  assert.ok(summaryScript.includes('timeZone: "Asia/Shanghai"'));
  assert.ok(reviewScript.includes('timeZone: "Asia/Shanghai"'));
  assert.ok(reviewHtml.includes('id="exitFactorRows"'), "review page must expose exit-factor iteration");

  const pageResponses = await Promise.all(
    ["overview", "signals", "messages", "models", "logs"].map((view) =>
      fetch(`${baseUrl}/api/page-data?view=${view}`)
    )
  );
  for (const response of pageResponses) assert.equal(response.status, 200);
  const statusResponse = await fetch(`${baseUrl}/api/status`);
  const serviceStatus = await statusResponse.json();
  assert.equal(serviceStatus.loopMode, "event-driven-hybrid");
  assert.equal(serviceStatus.loopIntervalSeconds, null);
  assert.equal(serviceStatus.priceBackend, "binance-bookTicker-websocket");
  const [overviewText, signalsText, messagesText, modelsText, logsText] = await Promise.all(
    pageResponses.map((response) => response.text())
  );
  assert.ok(overviewText.length < 100_000, "overview payload must stay compact");
  assert.ok(signalsText.length < 100_000, "signals payload must omit messages and models");
  assert.ok(messagesText.includes("MESSAGE_ONLY_") && !messagesText.includes("MODEL_ONLY_"));
  assert.ok(modelsText.includes("MODEL_ONLY_") && !modelsText.includes("MESSAGE_ONLY_"));
  assert.ok(!logsText.includes("MESSAGE_ONLY_") && !logsText.includes("MODEL_ONLY_"));
  const messagesPayload = JSON.parse(messagesText);
  assert.equal(messagesPayload.report.uiCounts.messages, 182, "message count must expose the deduplicated total before truncation");
  assert.equal(messagesPayload.report.uiCounts.messagesDisplayed, 1);
  assert.deepEqual(messagesPayload.report.messageFeedStats, { total: 182, displayed: 1, limit: 200 });

  const demoPreviewPath = path.join(runtimeDir, "demo-position-preview.json");
  fs.writeFileSync(demoPreviewPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    position: {
      id: "demo-preview-test",
      symbol: "DEMOUSDT",
      side: "long",
      entry: 100,
      currentPrice: 101,
      takeProfit: 108,
      stopLoss: 96,
      marginRequired: 200,
      unrealizedPnl: 9,
      netPnl: 8.5
    }
  }), "utf8");
  const previewResponse = await fetch(`${baseUrl}/api/page-data?view=overview`);
  const previewPayload = await previewResponse.json();
  assert.equal(previewPayload.account.account.positions["demo-preview-test"].symbol, "DEMOUSDT");
  assert.equal(previewPayload.account.account.marginUsed, 200);
  const rawAccountDuringPreview = await (await fetch(`${baseUrl}/api/account`)).json();
  assert.equal("demo-preview-test" in rawAccountDuringPreview.account.positions, false);
  fs.rmSync(demoPreviewPath, { force: true });

  const requested = {
    initialCapital: 25_000,
    marketType: "futures",
    maxLeverage: 17.8,
    riskProfile: "aggressive",
    takerFeeRate: 0.0007,
    slippageRate: 0.0004,
    fundingIntervalHours: 6
  };
  const startResponse = await fetch(`${baseUrl}/api/account/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requested)
  });
  assert.equal(startResponse.status, 200);
  const started = await startResponse.json();
  assert.equal(started.config.initialCapital, requested.initialCapital);
  assert.equal(started.config.maxLeverage, 17);
  assert.equal(started.config.riskProfile, requested.riskProfile);
  assert.equal(started.config.takerFeeRate, requested.takerFeeRate);
  assert.equal(started.config.slippageRate, requested.slippageRate);
  assert.equal(started.config.fundingIntervalHours, requested.fundingIntervalHours);
  assert.equal(started.account.isActive, true);
  assert.equal(started.account.startingCapital, requested.initialCapital);
  assert.equal(started.account.equity, requested.initialCapital);
  assert.equal(started.account.configSnapshot.maxLeverage, 17);
  assert.equal(started.account.configSnapshot.takerFeeRate, requested.takerFeeRate);
  assert.equal(started.account.configSnapshot.slippageRate, requested.slippageRate);
  assert.equal(started.account.configSnapshot.fundingIntervalHours, requested.fundingIntervalHours);

  const persistedResponse = await fetch(`${baseUrl}/api/account`);
  const persisted = await persistedResponse.json();
  assert.equal(persisted.config.maxLeverage, 17);
  assert.equal(persisted.config.riskProfile, requested.riskProfile);
  assert.equal(persisted.config.takerFeeRate, requested.takerFeeRate);
  assert.equal(persisted.config.slippageRate, requested.slippageRate);
  assert.equal(persisted.config.fundingIntervalHours, requested.fundingIntervalHours);
  assert.equal(persisted.account.isActive, true);

  const equityPointCount = persisted.account.equityCurve.length;
  const stopResponse = await fetch(`${baseUrl}/api/account/stop`, { method: "POST" });
  assert.equal(stopResponse.status, 200);
  const stopped = await stopResponse.json();
  assert.equal(stopped.account.isActive, false);
  assert.equal(stopped.account.sessionId, started.account.sessionId);
  assert.ok(stopped.account.stoppedAt);
  assert.equal(stopped.account.equityCurve.length, equityPointCount);

  const compactSummaryResponse = await fetch(`${baseUrl}/api/account/summary`);
  const compactSummaryText = await compactSummaryResponse.text();
  assert.equal(compactSummaryResponse.status, 200);
  assert.ok(!compactSummaryText.includes("factorSnapshot"));
  assert.ok(!compactSummaryText.includes('"positions"'));

  const secondStartResponse = await fetch(`${baseUrl}/api/account/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const secondStart = await secondStartResponse.json();
  assert.equal(secondStart.config.maxLeverage, 17);
  assert.equal(secondStart.account.sessionId, started.account.sessionId);
  assert.equal(secondStart.account.isActive, true);
  assert.equal(secondStart.account.stoppedAt, null);
  assert.equal(secondStart.account.equityCurve.length, equityPointCount);

  const archiveAccountPath = path.join(runtimeDir, "paper-account.json");
  const archiveAccount = JSON.parse(fs.readFileSync(archiveAccountPath, "utf8"));
  archiveAccount.tradeHistory = [{
    id: "ARCHIVE-TRADE-1",
    sessionId: archiveAccount.sessionId,
    status: "closed",
    symbol: "BTCUSDT",
    side: "long",
    openedAt: "2026-07-01T00:00:00.000Z",
    closedAt: "2026-07-01T01:00:00.000Z",
    closeReason: "TP",
    entry: 100,
    exitPrice: 105,
    takeProfit: 105,
    stopLoss: 98,
    quantity: 1,
    leverage: 3,
    realizedPnl: 5,
    realizedReturnPct: 0.05,
    factorSnapshot: { direction: { contributions: { trend: 0.2 } } },
    holdingObservations: Array.from({ length: 1_000 }, (_, index) => ({ index }))
  }];
  archiveAccount.lifetimeClosedTrades = 1;
  archiveAccount.exitDecisionHistory = [{ id: "EXIT-1", positionId: "ARCHIVE-TRADE-1" }];
  archiveAccount.capitalRotationHistory = [{ id: "ROTATION-1", positionId: "ARCHIVE-TRADE-1" }];
  fs.writeFileSync(archiveAccountPath, JSON.stringify(archiveAccount), "utf8");
  const historyBeforeReset = await (await fetch(`${baseUrl}/api/trade-history?page=1&pageSize=50`)).json();
  assert.equal(historyBeforeReset.totalRecords, 1);
  assert.equal(historyBeforeReset.records[0].id, "ARCHIVE-TRADE-1");
  assert.equal(Object.hasOwn(historyBeforeReset.records[0], "holdingObservations"), false);

  const resetResponse = await fetch(`${baseUrl}/api/account/reset`, { method: "POST" });
  assert.equal(resetResponse.status, 200);
  const reset = await resetResponse.json();
  assert.equal(reset.config.initialCapital, requested.initialCapital);
  assert.equal(reset.account.isActive, false);
  assert.notEqual(reset.account.sessionId, started.account.sessionId);
  assert.equal(reset.account.lifetimeClosedTrades, 0);
  assert.equal(reset.account.lifetimeWinningTrades, 0);

  const historyAfterReset = await (await fetch(`${baseUrl}/api/trade-history?page=1&pageSize=50`)).json();
  assert.equal(historyAfterReset.totalRecords, 1, "account reset must preserve the historical database");
  const deleteHistoryResponse = await fetch(`${baseUrl}/api/trade-history/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: ["ARCHIVE-TRADE-1"] })
  });
  assert.equal(deleteHistoryResponse.status, 200);
  const deleteHistory = await deleteHistoryResponse.json();
  assert.equal(deleteHistory.deleted, 1);
  assert.equal(deleteHistory.totalRecords, 0);
  const accountAfterHistoryDeletion = await (await fetch(`${baseUrl}/api/account`)).json();
  assert.equal(accountAfterHistoryDeletion.account.exitDecisionHistory.length, 0);
  assert.equal(accountAfterHistoryDeletion.account.capitalRotationHistory.length, 0);

  const reviewConfigResponse = await fetch(`${baseUrl}/api/post-trade-review/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, reviewEveryTrades: 12, autoApplyValidatedWeights: true })
  });
  assert.equal(reviewConfigResponse.status, 200);
  const reviewConfigText = await reviewConfigResponse.text();
  assert.ok(reviewConfigText.length < 10_000, "review config mutation must not return the full account");
  assert.ok(!reviewConfigText.includes('"tradeHistory"'));
  const reviewConfig = JSON.parse(reviewConfigText);
  assert.equal(reviewConfig.config.reviewEveryTrades, 12);
  assert.equal(reviewConfig.config.autoApplyValidatedWeights, true);

  const reviewAccountResponse = await fetch(`${baseUrl}/api/account`);
  const reviewAccount = await reviewAccountResponse.json();
  reviewAccount.account.lifetimeClosedTrades = 640;
  reviewAccount.account.postTradeReview.latestReview = {
    trades: Array.from({ length: 25 }, (_, index) => ({
      symbol: `TEST${index}`,
      realizedPnl: index,
      relatedEvents: [{ title: largeMessage }]
    }))
  };
  reviewAccount.account.postTradeReview.reviewHistory = Array.from({ length: 20 }, () => ({
    trades: [{ relatedEvents: [{ title: largeMessage }] }]
  }));
  fs.writeFileSync(
    path.join(runtimeDir, "paper-account.json"),
    JSON.stringify(reviewAccount.account),
    "utf8"
  );

  const reviewStateResponse = await fetch(`${baseUrl}/api/post-trade-review`);
  const reviewStateText = await reviewStateResponse.text();
  assert.ok(reviewStateText.length < 100_000, "review page payload must stay compact");
  const reviewState = JSON.parse(reviewStateText);
  assert.equal(reviewState.config.reviewEveryTrades, 12);
  assert.equal(reviewState.config.autoApplyValidatedWeights, true);
  assert.equal(reviewState.closedTrades, 640);
  assert.equal(reviewState.review.latestReview.trades.length, 20);
  assert.equal("reviewHistory" in reviewState.review, false);
  assert.ok(!reviewStateText.includes("MESSAGE_ONLY_"), "review payload must omit unused related-event bodies");

  const applyResponse = await fetch(`${baseUrl}/api/post-trade-review/apply`, { method: "POST" });
  const rollbackResponse = await fetch(`${baseUrl}/api/post-trade-review/rollback`, { method: "POST" });
  assert.equal(applyResponse.status, 409);
  assert.equal(rollbackResponse.status, 409);

  console.log("dashboard controls and account actions test passed");
} finally {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 2_000).unref();
  });
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  if (stderr.trim()) process.stderr.write(stderr);
}
