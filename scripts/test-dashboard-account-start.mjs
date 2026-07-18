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
    sourceCounts: { rss: 1, marketAnalyses: 1 },
    warnings: [],
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
    SIGNAL_RUNTIME_DIR: runtimeDir
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
  const [indexResponse, summaryPageResponse, reviewPageResponse, signalsPageResponse, messagesPageResponse, modelsPageResponse, logsPageResponse, appScriptResponse, summaryScriptResponse, reviewScriptResponse, echartsResponse] =
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
      fetch(`${baseUrl}/vendor/echarts.min.js`)
    ]);
  for (const response of [indexResponse, summaryPageResponse, reviewPageResponse, signalsPageResponse, messagesPageResponse, modelsPageResponse, logsPageResponse, appScriptResponse, summaryScriptResponse, reviewScriptResponse, echartsResponse]) {
    assert.equal(response.status, 200);
  }
  const [indexHtml, summaryHtml, reviewHtml, signalsHtml, messagesHtml, modelsHtml, logsHtml, appScript, summaryScript, reviewScript] = await Promise.all([
    indexResponse.text(),
    summaryPageResponse.text(),
    reviewPageResponse.text(),
    signalsPageResponse.text(),
    messagesPageResponse.text(),
    modelsPageResponse.text(),
    logsPageResponse.text(),
    appScriptResponse.text(),
    summaryScriptResponse.text(),
    reviewScriptResponse.text()
  ]);
  for (const id of ["accountCapital", "accountMarketType", "accountMaxLeverage", "accountRiskProfile", "startAccountButton", "saveAccountButton", "resetAccountButton", "summaryButton"]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `missing main-page control ${id}`);
  }
  assert.ok(signalsHtml.includes('id="signals"'), "missing signals-page list");
  for (const id of ["messageFilterKeywords", "messageAggregatorEnabled", "messageAggregatorConnectButton", "messages", "warnings"]) {
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
  assert.ok(summaryHtml.includes('id="refreshSummary"'));
  for (const id of ["reviewEveryTrades", "reviewAutoApply", "applyCandidate", "rollbackWeights", "refreshReview", "reviewDecision"]) {
    assert.ok(reviewHtml.includes(`id="${id}"`), `missing review-page control ${id}`);
  }
  for (const binding of ["messageAggregatorForm", "accountForm", "resetAccountButton", "startAccountButton", "summaryButton", "accountMarketType"]) {
    assert.ok(appScript.includes(`$("#${binding}")`), `missing main-page event binding ${binding}`);
  }
  assert.ok(summaryScript.includes('$("#refreshSummary").addEventListener("click", loadSummary)'));
  for (const binding of ["reviewForm", "applyCandidate", "rollbackWeights", "refreshReview"]) {
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
  assert.ok(reviewHtml.includes('id="exitFactorRows"'), "review page must expose exit-factor iteration");

  const pageResponses = await Promise.all(
    ["overview", "signals", "messages", "models", "logs"].map((view) =>
      fetch(`${baseUrl}/api/page-data?view=${view}`)
    )
  );
  for (const response of pageResponses) assert.equal(response.status, 200);
  const [overviewText, signalsText, messagesText, modelsText, logsText] = await Promise.all(
    pageResponses.map((response) => response.text())
  );
  assert.ok(overviewText.length < 100_000, "overview payload must stay compact");
  assert.ok(signalsText.length < 100_000, "signals payload must omit messages and models");
  assert.ok(messagesText.includes("MESSAGE_ONLY_") && !messagesText.includes("MODEL_ONLY_"));
  assert.ok(modelsText.includes("MODEL_ONLY_") && !modelsText.includes("MESSAGE_ONLY_"));
  assert.ok(!logsText.includes("MESSAGE_ONLY_") && !logsText.includes("MODEL_ONLY_"));
  const requested = {
    initialCapital: 25_000,
    marketType: "futures",
    maxLeverage: 17,
    riskProfile: "aggressive"
  };
  const startResponse = await fetch(`${baseUrl}/api/account/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requested)
  });
  assert.equal(startResponse.status, 200);
  const started = await startResponse.json();
  assert.equal(started.config.initialCapital, requested.initialCapital);
  assert.equal(started.config.maxLeverage, requested.maxLeverage);
  assert.equal(started.config.riskProfile, requested.riskProfile);
  assert.equal(started.account.isActive, true);
  assert.equal(started.account.startingCapital, requested.initialCapital);
  assert.equal(started.account.equity, requested.initialCapital);
  assert.equal(started.account.configSnapshot.maxLeverage, requested.maxLeverage);

  const persistedResponse = await fetch(`${baseUrl}/api/account`);
  const persisted = await persistedResponse.json();
  assert.equal(persisted.config.maxLeverage, requested.maxLeverage);
  assert.equal(persisted.config.riskProfile, requested.riskProfile);
  assert.equal(persisted.account.isActive, true);

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
  assert.equal(secondStart.config.maxLeverage, requested.maxLeverage);
  assert.equal(secondStart.account.sessionId, started.account.sessionId);

  const resetResponse = await fetch(`${baseUrl}/api/account/reset`, { method: "POST" });
  assert.equal(resetResponse.status, 200);
  const reset = await resetResponse.json();
  assert.equal(reset.config.initialCapital, requested.initialCapital);
  assert.equal(reset.account.isActive, false);
  assert.notEqual(reset.account.sessionId, started.account.sessionId);
  assert.equal(reset.account.lifetimeClosedTrades, 0);
  assert.equal(reset.account.lifetimeWinningTrades, 0);

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
