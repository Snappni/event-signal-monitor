const state = {
  report: null,
  status: null,
  log: "",
  account: null,
  summaryVisible: false,
  summaryFetchedAt: null,
  positionView: "open",
  summaryCharts: new Map(),
  translations: {},
  translationRequestKey: "",
  whaleAlert: null,
  whaleAlertEditing: false,
  whaleAlertSubmitting: false,
  whaleAlertAwaitingEdit: false
};

const $ = (selector) => document.querySelector(selector);

const text = {
  running: "\u8fd0\u884c\u4e2d",
  stopped: "\u672a\u8fd0\u884c",
  opening: "\u5f00\u4ed3\u5019\u9009",
  tracking: "\u8ddf\u8e2a\u4e2d",
  closed: "\u5df2\u5173\u95ed",
  watch: "\u89c2\u5bdf",
  none: "\u65e0\u5019\u9009",
  status: "\u72b6\u6001",
  symbol: "\u6807\u7684",
  entry: "\u5f00\u4ed3\u4ef7",
  takeProfit: "\u6b62\u76c8",
  stopLoss: "\u6b62\u635f",
  winRate: "\u80dc\u7387",
  noSignals: "\u5f53\u524d\u6ca1\u6709\u5f00\u4ed3\u5019\u9009\u3001\u8ddf\u8e2a\u4fe1\u53f7\u6216\u590d\u76d8\u4fe1\u53f7\u3002",
  bullish: "\u504f\u591a",
  bearish: "\u504f\u7a7a",
  neutral: "\u4e2d\u6027",
  impact: "\u5f71\u54cd\u5206",
  marketWide: "\u5e02\u573a\u7ea7",
  noMessagesMath:
    "\u672c\u8f6e\u6ca1\u6709\u53ef\u7528\u6d88\u606f\u9762\uff0c\u5df2\u6539\u7528\u6570\u5b66\u6a21\u578b\u5355\u72ec\u5206\u6790\u5e02\u573a\u72b6\u6001\u3002",
  noMessagesNoMarket:
    "\u672c\u8f6e\u6ca1\u6709\u6210\u529f\u83b7\u53d6\u5230\u6d88\u606f\u9762\uff0c\u4e14\u884c\u60c5\u6570\u636e\u4e0d\u53ef\u7528\uff0c\u65e0\u6cd5\u8fdb\u5165\u6570\u5b66\u6a21\u578b\u5206\u6790\u3002",
  noWarnings: "\u65e0\u544a\u8b66\u3002",
  candidateStatus: "\u5019\u9009\u72b6\u6001",
  generatedCandidate: "\u5df2\u751f\u6210\u5019\u9009",
  passed: "\u901a\u8fc7",
  latestPrice: "\u6700\u65b0\u4ef7",
  eventImpact: "\u4e8b\u4ef6\u5f71\u54cd",
  oiChange: "OI\u53d8\u5316",
  trendTerm: "\u8d8b\u52bf\u9879",
  htfTrendTerm: "\u9ad8\u5468\u671f\u8d8b\u52bf",
  momentumTerm: "\u52a8\u91cf\u9879",
  fundingTerm: "\u8d44\u91d1\u8d39\u7387\u9879",
  noModel: "\u672c\u8f6e\u6ca1\u6709\u53ef\u7528\u884c\u60c5\uff0c\u6570\u5b66\u6a21\u578b\u65e0\u6cd5\u8ba1\u7b97\u3002",
  noLog: "\u6682\u65e0\u65e5\u5fd7\u3002",
  readFailed: "\u8bfb\u53d6\u5931\u8d25",
  accountEquity: "\u8d26\u6237\u6743\u76ca",
  accountReturn: "\u8d26\u6237\u6536\u76ca\u7387",
  realizedPnl: "\u5df2\u5b9e\u73b0\u76c8\u4e8f",
  unrealizedPnl: "\u672a\u5b9e\u73b0\u76c8\u4e8f",
  tradingFees: "\u7d2f\u8ba1\u624b\u7eed\u8d39",
  slippageCost: "\u7d2f\u8ba1\u6ed1\u70b9\u6210\u672c",
  fundingPnl: "\u8d44\u91d1\u8d39\u7387\u51c0\u989d",
  costModel: "\u6210\u672c\u6a21\u578b",
  marginUsed: "\u5df2\u7528\u4fdd\u8bc1\u91d1",
  availableEquity: "\u53ef\u7528\u6743\u76ca",
  openPositions: "\u6301\u4ed3",
  noPositions: "\u6682\u65e0\u6a21\u62df\u6301\u4ed3\u3002\u53ea\u6709\u901a\u8fc7\u786c\u95e8\u69db\u7684\u5f00\u4ed3\u4fe1\u53f7\u624d\u4f1a\u81ea\u52a8\u7eb8\u9762\u5f00\u4ed3\u3002",
  noClosedPositions: "\u6682\u65e0\u5df2\u5e73\u4ed3\u8bb0\u5f55\u3002",
  marketType: "\u5e02\u573a\u7c7b\u578b",
  spot: "\u73b0\u8d27",
  futures: "\u5408\u7ea6",
  leverage: "\u6760\u6746",
  modelLeverage: "\u6a21\u578b\u5efa\u8bae",
  leverageCap: "\u6760\u6746\u4e0a\u9650",
  riskProfile: "\u7b56\u7565\u98ce\u683c",
  conservative: "\u4fdd\u5b88\u578b",
  aggressive: "\u6fc0\u8fdb\u578b",
  entryGate: "\u5f00\u4ed3\u95e8\u69db",
  leverageRule: "\u6760\u6746\u89c4\u5219",
  notional: "\u540d\u4e49\u4ed3\u4f4d",
  quantity: "\u6570\u91cf",
  currentPrice: "\u5f53\u524d\u4ef7",
  signalPrice: "\u4fe1\u53f7\u4ef7",
  exitPrice: "\u5e73\u4ed3\u4ef7",
  entryFee: "\u5f00\u4ed3\u624b\u7eed\u8d39",
  exitFee: "\u5e73\u4ed3\u624b\u7eed\u8d39",
  estimatedExitFee: "\u9884\u8ba1\u5e73\u4ed3\u624b\u7eed\u8d39",
  estimatedExitSlippage: "\u9884\u8ba1\u5e73\u4ed3\u6ed1\u70b9",
  fundingSettlements: "\u8d44\u91d1\u8d39\u7ed3\u7b97\u6b21\u6570",
  closeReason: "\u5e73\u4ed3\u7ed3\u679c",
  closedAt: "\u5e73\u4ed3\u65f6\u95f4",
  paperOnly: "\u4ec5\u6a21\u62df\uff0c\u4e0d\u4e0b\u5b9e\u76d8\u5355\u3002",
  accountStatus: "\u8d26\u6237\u72b6\u6001",
  accountRunning: "\u6a21\u62df\u8fd0\u884c\u4e2d",
  accountIdle: "\u672a\u542f\u52a8",
  startAccount: "\u542f\u52a8\u6a21\u62df",
  runningAccount: "\u5df2\u542f\u52a8",
  summaryStart: "\u5f00\u59cb\u65f6\u95f4",
  summaryEnd: "\u622a\u6b62\u65f6\u95f4",
  finalReturn: "\u6700\u7ec8\u6536\u76ca\u7387",
  maxReturn: "\u6700\u5927\u6536\u76ca\u7387",
  maxDrawdown: "\u6700\u5927\u56de\u64a4",
  sharpe: "\u590f\u666e\u6bd4\u7387",
  closedTrades: "\u5df2\u5e73\u4ed3\u7b14\u6570",
  saved: "\u5df2\u4fdd\u5b58\u5e76\u91cd\u7f6e\u6a21\u62df\u8d26\u6237\uff0c\u5f53\u524d\u672a\u542f\u52a8\u3002",
  reset:
    "\u5df2\u91cd\u7f6e\u6a21\u62df\u8d26\u6237\uff0c\u65e7\u6301\u4ed3\u548c\u5386\u53f2\u5df2\u6e05\u7a7a\u3002\u8d26\u6237\u4fdd\u6301\u672a\u542f\u52a8\uff0c\u70b9\u51fb\u201c\u542f\u52a8\u6a21\u62df\u201d\u540e\u624d\u4f1a\u63a5\u6536\u65b0\u4fe1\u53f7\u3002",
  started:
    "\u6a21\u62df\u8d26\u6237\u5df2\u542f\u52a8\uff0c\u4ece\u4e0b\u4e00\u4e2a\u5b8c\u6574\u76d1\u63a7\u8f6e\u6b21\u5f00\u59cb\u63a5\u6536\u5408\u683c\u5f00\u4ed3\u4fe1\u53f7\u3002",
  viewSummary: "\u67e5\u770b\u603b\u7ed3",
  refreshSummary: "\u5237\u65b0\u603b\u7ed3",
  loadingSummary: "\u8bfb\u53d6\u4e2d...",
  summaryUpdated: "\u603b\u7ed3\u5df2\u66f4\u65b0",
  accountPeriodSummary: "\u8d26\u6237\u9636\u6bb5\u603b\u7ed3"
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fmtNumber(value, digits = 4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits
  });
}

function fmtPct(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtMoney(value, currency = "USDT", digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits
  })} ${currency}`;
}

function fmtPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 10) return value.toFixed(4);
  if (value >= 1) return value.toFixed(5);
  return value.toPrecision(6);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function badge(label, type = "") {
  return `<span class="badge ${type}">${escapeHtml(label)}</span>`;
}

function translateWarning(warning) {
  const value = String(warning || "");
  if (value.includes("paper-alert-only")) return "\u4ec5\u6a21\u62df\u544a\u8b66\uff1a\u811a\u672c\u4e0d\u4f1a\u53d1\u9001\u5b9e\u76d8\u8ba2\u5355\u3002";
  if (value.includes("No evidence shows")) return "\u65e0\u8bc1\u636e\u8868\u660e\u65b0\u95fb\u805a\u5408\u3001\u5927\u6a21\u578b\u63a8\u7406\u6216 Polymarket \u8d54\u7387\u672c\u8eab\u80fd\u7a33\u5b9a\u76c8\u5229\u3002";
  if (value.includes("WHALE_ALERT_API_KEY")) return "\u672a\u914d\u7f6e WHALE_ALERT_API_KEY\uff1a\u771f\u5b9e\u5de8\u9cb8\u8f6c\u8d26\u76d1\u63a7\u672a\u542f\u7528\uff0c\u5f53\u524d\u4ec5\u4f7f\u7528 OI \u548c\u8d44\u91d1\u8d39\u7387\u4f5c\u4e3a\u8d44\u91d1\u6d41\u4ee3\u7406\u3002";
  if (value.includes("Fatal run failure")) return "\u672c\u8f6e\u8fd0\u884c\u53d1\u751f\u81f4\u547d\u9519\u8bef\uff1a\u4e0d\u8981\u4f7f\u7528\u672c\u8f6e\u4fe1\u53f7\u3002";

  const labelMap = new Map([
    ["GDELT", "GDELT \u65b0\u95fb"],
    ["Polymarket", "Polymarket \u76d8\u53e3"],
    ["Binance announcements", "Binance \u516c\u544a"],
    ["OKX announcements", "OKX \u516c\u544a"],
    ["WhaleAlert", "WhaleAlert \u5de8\u9cb8\u76d1\u63a7"]
  ]);
  const [rawLabel, ...rest] = value.split(":");
  let label = rawLabel.trim();
  label = labelMap.get(label) || label;
  label = label.replace(/ market data$/i, " \u884c\u60c5\u6570\u636e");
  label = label.replace(/ funding$/i, " \u8d44\u91d1\u8d39\u7387");
  label = label.replace(/ open interest$/i, " OI");
  const reasons = [];
  if (/429|Too Many Requests/i.test(value)) reasons.push("\u63a5\u53e3\u9650\u6d41");
  if (/aborted|AbortError/i.test(value)) reasons.push("\u8bf7\u6c42\u8d85\u65f6\u6216\u88ab\u4e2d\u6b62");
  if (/fetch failed/i.test(value)) reasons.push("\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25");
  if (/empty response/i.test(value)) reasons.push("\u63a5\u53e3\u8fd4\u56de\u4e3a\u7a7a");
  if (/unavailable/i.test(value)) reasons.push("\u6570\u636e\u6e90\u4e0d\u53ef\u7528");
  if (reasons.length) return `${label}\uff1a${[...new Set(reasons)].join("\uff1b")}`;
  return rest.length ? `${label}\uff1a${rest.join(":").trim()}` : value;
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${response.status} ${response.statusText}`);
    error.code = data.errorCode || "request_failed";
    error.data = data;
    throw error;
  }
  return data;
}

async function loadData() {
  const [report, status, log, account, whaleAlert] = await Promise.all([
    getJson("/api/report?layer=fast"),
    getJson("/api/status"),
    getJson("/api/log?bytes=80000"),
    getJson("/api/account"),
    getJson("/api/whale-alert/status")
  ]);
  state.report = report;
  state.status = status;
  state.log = log.text || "";
  state.account = account;
  state.whaleAlert = whaleAlert;
  render();
  loadMessageTranslations(report).catch(() => {
    // Translation failure must not interrupt monitoring or report rendering.
  });
}

async function loadMessageTranslations(report) {
  const texts = [];
  for (const item of asArray(report?.messageFeed)) {
    const title = String(item?.title || "").trim();
    const detail = String(item?.text || "").trim();
    if (title && !/[\u3400-\u9fff]/u.test(title)) texts.push(title);
    if (
      detail &&
      detail !== title &&
      !/\b(volume|liquidity|yes|delta)=/i.test(detail) &&
      !/[\u3400-\u9fff]/u.test(detail)
    ) {
      texts.push(detail);
    }
  }
  const uniqueTexts = [...new Set(texts)].slice(0, 80);
  const requestKey = uniqueTexts.join("\n");
  if (!requestKey || requestKey === state.translationRequestKey) return;
  state.translationRequestKey = requestKey;
  const cachedResult = await postJson("/api/translate", {
    texts: uniqueTexts,
    cachedOnly: true
  });
  state.translations = { ...state.translations, ...(cachedResult.translations || {}) };
  renderMessages();
  if (!asArray(cachedResult.pending).length) return;

  const result = await postJson("/api/translate", { texts: uniqueTexts });
  state.translations = { ...state.translations, ...(result.translations || {}) };
  renderMessages();
}

function renderSummary() {
  const report = state.report || {};
  const sourceCounts = report.sourceCounts || {};
  const actionable = asArray(report.actionableSignals);
  const watchlist = asArray(report.watchlist);
  const messages = asArray(report.messageFeed);
  const models = asArray(report.modelCalculations);
  $("#subtitle").textContent = `${report.mode || "paper-alert-only"} | ${report.generatedAt || "-"}`;
  $("#layerValue").textContent = "自动";
  $("#actionableValue").textContent = actionable.length;
  $("#watchValue").textContent = watchlist.length;
  $("#messageValue").textContent = messages.length;
  $("#modelValue").textContent = models.length;
  const fastStatus = state.status?.fastLoopRunning ? `\u9ad8\u9891 1m ${text.running}` : `\u9ad8\u9891 ${text.stopped}`;
  const slowStatus = state.status?.slowLoopRunning ? `\u4f4e\u9891 5m ${text.running}` : `\u4f4e\u9891 ${text.stopped}`;
  $("#loopValue").textContent = `${fastStatus} | ${slowStatus}`;
  $("#reportTime").textContent = report.generatedAt || "-";
  $("#sourceCounts").textContent = `GDELT ${sourceCounts.gdelt || 0} | Polymarket ${sourceCounts.polymarket || 0} | Binance\u516c\u544a ${sourceCounts.binanceAnnouncements || 0} | OKX\u516c\u544a ${sourceCounts.okxAnnouncements || 0} | Whale ${sourceCounts.whale || 0} | \u5e02\u573a\u8ba1\u7b97 ${sourceCounts.marketAnalyses || 0}`;
  $("#warningCount").textContent = asArray(report.warnings).length;
}

function renderSignals() {
  const report = state.report || {};
  const rows = [];
  for (const signal of asArray(report.actionableSignals)) rows.push(signalRow(signal, text.opening, "ok"));
  for (const signal of asArray(report.activeSignals)) rows.push(signalRow(signal, text.tracking, "warn"));
  for (const signal of asArray(report.closedSignals)) rows.push(signalRow(signal, signal.outcome || text.closed, signal.outcome === "TP" ? "ok" : "danger"));
  for (const signal of asArray(report.watchlist).slice(0, 6)) rows.push(signalRow(signal, text.watch, ""));
  $("#signals").innerHTML = rows.length ? rows.join("") : `<div class="empty">${text.noSignals}</div>`;
}

function signalRow(signal, label, badgeType) {
  const mode = signal.candidateMode === "math_only" ? "math-only" : signal.candidateMode || "-";
  const accountControl = signal.accountControl || {};
  const leverageText =
    accountControl.appliedLeverage > 0
      ? `${fmtNumber(accountControl.appliedLeverage, 2)}x / ${fmtNumber(accountControl.maxLeverage, 0)}x`
      : accountControl.blockReason || "-";
  return `
    <div class="signal-grid">
      <div class="signal-cell"><span>${text.status}</span><strong>${badge(`${label} / ${mode}`, badgeType)}</strong></div>
      <div class="signal-cell"><span>${text.symbol}</span><strong>${escapeHtml(signal.symbol)} ${escapeHtml(String(signal.side || "").toUpperCase())}</strong></div>
      <div class="signal-cell"><span>${text.entry}</span><strong>${fmtPrice(signal.entry)}</strong></div>
      <div class="signal-cell"><span>${text.takeProfit}</span><strong>${fmtPrice(signal.takeProfit)}</strong></div>
      <div class="signal-cell"><span>${text.stopLoss}</span><strong>${fmtPrice(signal.stopLoss)}</strong></div>
      <div class="signal-cell"><span>${text.winRate}</span><strong>${fmtPct(signal.winRate, 1)}</strong></div>
      <div class="signal-cell"><span>EV / EV-R</span><strong>${fmtPct(signal.expectancyPct, 2)} / ${fmtNumber(signal.expectancyR, 2)}</strong></div>
      <div class="signal-cell"><span>${text.leverage}</span><strong>${escapeHtml(leverageText)}${accountControl.leverageCapped ? " cap" : ""}</strong></div>
      <div class="signal-cell"><span>${text.notional}</span><strong>${fmtMoney(accountControl.notional, accountControl.quoteCurrency || "USDT")}</strong></div>
    </div>
  `;
}

function getAccountBundle() {
  const report = state.report || {};
  const bundle = state.account || {};
  return {
    config: bundle.config || report.simulatedAccount || {},
    account: bundle.account || report.paperAccount || {}
  };
}

function setInputValueIfUnfocused(element, value) {
  if (!element || document.activeElement === element) return;
  element.value = value ?? "";
}

function metricCell(label, value, className = "") {
  return `<div class="account-metric ${escapeHtml(className)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderAccount() {
  const { config, account } = getAccountBundle();
  const currency = config.quoteCurrency || "USDT";
  const marketType = config.marketType === "spot" ? "spot" : "futures";
  const riskProfile = config.riskProfile === "aggressive" ? "aggressive" : "conservative";
  const returnPct = account.startingCapital > 0 ? account.equity / account.startingCapital - 1 : 0;

  setInputValueIfUnfocused($("#accountCapital"), config.initialCapital ?? 10000);
  setInputValueIfUnfocused($("#accountMarketType"), marketType);
  setInputValueIfUnfocused($("#accountMaxLeverage"), marketType === "spot" ? 1 : config.maxLeverage ?? 3);
  setInputValueIfUnfocused($("#accountRiskProfile"), riskProfile);
  $("#accountMaxLeverage").disabled = marketType === "spot";
  const accountActive = account.isActive === true;
  const startButton = $("#startAccountButton");
  startButton.disabled = accountActive;
  startButton.textContent = accountActive ? text.runningAccount : text.startAccount;
  startButton.classList.toggle("is-running", accountActive);
  $("#accountUpdatedAt").textContent = `${text.paperOnly} ${account.updatedAt || config.updatedAt || "-"}`;

  $("#accountMetrics").innerHTML = [
    metricCell(text.accountStatus, accountActive ? text.accountRunning : text.accountIdle),
    metricCell(text.marketType, marketType === "spot" ? text.spot : text.futures),
    metricCell(text.riskProfile, riskProfile === "aggressive" ? text.aggressive : text.conservative),
    metricCell(
      text.entryGate,
      riskProfile === "aggressive" ? "\u9ad8\u671f\u671b 50% / \u4e00\u822c 60% + EV>0" : "\u9ad8\u671f\u671b 50% / \u4e00\u822c 70% + EV>0"
    ),
    metricCell(
      text.leverageRule,
      marketType === "spot"
        ? "\u73b0\u8d27\u56fa\u5b9a 1x"
        : riskProfile === "aggressive"
          ? "\u4fdd\u5b88\u5efa\u8bae\u503c 2x\uff0c\u4e0d\u8d85\u8fc7\u786c\u4e0a\u9650"
          : "\u539f\u6a21\u578b\u5efa\u8bae\u503c"
    ),
    metricCell(text.accountEquity, fmtMoney(account.equity, currency)),
    metricCell(text.accountReturn, fmtPct(returnPct, 2)),
    metricCell(text.realizedPnl, fmtMoney(account.realizedPnl, currency)),
    metricCell(text.unrealizedPnl, fmtMoney(account.unrealizedPnl, currency)),
    metricCell(text.tradingFees, fmtMoney(account.tradingFees || 0, currency)),
    metricCell(text.slippageCost, fmtMoney(account.slippageCost || 0, currency)),
    metricCell(text.fundingPnl, fmtMoney(account.fundingPnl || 0, currency)),
    metricCell(text.marginUsed, fmtMoney(account.marginUsed, currency)),
    metricCell(text.availableEquity, fmtMoney(account.availableEquity, currency)),
    metricCell(text.leverageCap, `${fmtNumber(config.maxLeverage || 1, 0)}x`),
    metricCell(
      text.costModel,
      `费 ${fmtPct(config.takerFeeRate || 0, 3)}/边 · 滑 ${fmtPct(config.slippageRate || 0, 3)}/边${marketType === "futures" ? ` · 资金 ${fmtNumber(config.fundingIntervalHours || 8, 0)}h` : ""}`,
      "cost-model-metric"
    )
  ].join("");

  renderAccountPositions(account, currency);
  renderAccountSummary(account.summary, currency, account);
}

function renderAccountPositions(account, currency) {
  const positions = Object.values(account.positions || {});
  const closedPositions = asArray(account.tradeHistory);
  $("#openPositionCount").textContent = positions.length;
  $("#closedPositionCount").textContent = closedPositions.length;
  document.querySelectorAll("[data-position-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.positionView === state.positionView);
  });

  if (state.positionView === "closed") {
    $("#accountPositions").innerHTML = closedPositions.length
      ? [...closedPositions]
          .sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")))
          .map((position) => closedPositionRow(position, currency))
          .join("")
      : `<div class="empty">${text.noClosedPositions}</div>`;
    return;
  }

  $("#accountPositions").innerHTML = positions.length
    ? positions
        .sort((a, b) => String(b.openedAt || "").localeCompare(String(a.openedAt || "")))
        .map((position) => positionRow(position, currency))
        .join("")
    : `<div class="empty">${text.noPositions}</div>`;
}

function positionRow(position, currency) {
  const sideLabel = String(position.side || "").toUpperCase();
  const netPnl = Number.isFinite(position.netPnl) ? position.netPnl : position.unrealizedPnl;
  const pnlType = netPnl > 0 ? "ok" : netPnl < 0 ? "danger" : "";
  const titles = asArray(position.relatedEvents)
    .slice(0, 2)
    .map((item) => item.title || item.text || "")
    .filter(Boolean)
    .join(" | ");
  return `
    <div class="position-row">
      <div class="position-head">
        <div>
          <div class="row-title">
            ${escapeHtml(position.symbol)}
            ${badge(sideLabel, position.side === "long" ? "ok" : "danger")}
            ${badge(`${fmtNumber(position.leverage, 1)}x`, "leverage")}
            ${badge(position.riskProfile === "aggressive" ? text.aggressive : text.conservative, position.riskProfile === "aggressive" ? "warn" : "")}
          </div>
          <div class="row-meta">${escapeHtml(position.openedAt || "-")} | ${escapeHtml(position.candidateMode || "-")}</div>
        </div>
        <div>${badge(`${fmtMoney(netPnl, currency)} / ${fmtPct(position.unrealizedReturnPct, 2)}`, pnlType)}</div>
      </div>
      ${positionGroup("行情与止盈止损", [
        calcCell(text.signalPrice, fmtPrice(position.signalEntryPrice)),
        calcCell(text.entry, fmtPrice(position.entry)),
        calcCell(text.currentPrice, fmtPrice(position.currentPrice)),
        calcCell(text.takeProfit, fmtPrice(position.takeProfit)),
        calcCell(text.stopLoss, fmtPrice(position.stopLoss)),
        calcCell(text.quantity, fmtNumber(position.quantity, 6))
      ])}
      ${positionGroup("仓位与风险", [
        calcCell(text.modelLeverage, `${fmtNumber(position.modelSuggestedLeverage, 1)}x`),
        calcCell(text.notional, fmtMoney(position.notional, currency)),
        calcCell(text.marginUsed, fmtMoney(position.marginRequired, currency)),
        calcCell(text.winRate, fmtPct(position.winRate, 1)),
        calcCell("EV", fmtPct(position.expectancyPct, 2)),
        calcCell(text.impact, fmtNumber(position.eventImpactScore, 0))
      ])}
      ${positionGroup("交易成本", [
        calcCell(text.entryFee, fmtMoney(position.entryFee || 0, currency)),
        calcCell(text.estimatedExitFee, fmtMoney(position.estimatedExitFee || 0, currency)),
        calcCell(text.estimatedExitSlippage, fmtMoney(position.estimatedExitSlippageCost || 0, currency)),
        calcCell(text.fundingPnl, fmtMoney(position.fundingPnl || 0, currency)),
        calcCell(text.fundingSettlements, fmtNumber(position.fundingSettlements || 0, 0))
      ])}
      ${titles ? `<div class="position-events"><span>关联事件</span>${escapeHtml(titles)}</div>` : ""}
    </div>
  `;
}

function closedPositionRow(position, currency) {
  const sideLabel = String(position.side || "").toUpperCase();
  const pnlType = position.realizedPnl > 0 ? "ok" : position.realizedPnl < 0 ? "danger" : "";
  const resultType = position.closeReason === "TP" ? "ok" : position.closeReason === "SL" ? "danger" : "warn";
  const titles = asArray(position.relatedEvents)
    .slice(0, 2)
    .map((item) => item.title || item.text || "")
    .filter(Boolean)
    .join(" | ");
  return `
    <div class="position-row closed-position">
      <div class="position-head">
        <div>
          <div class="row-title">
            ${escapeHtml(position.symbol)}
            ${badge(sideLabel, position.side === "long" ? "ok" : "danger")}
            ${badge(`${fmtNumber(position.leverage, 1)}x`, "leverage")}
            ${badge(position.riskProfile === "aggressive" ? text.aggressive : text.conservative, position.riskProfile === "aggressive" ? "warn" : "")}
            ${badge(position.closeReason || text.closed, resultType)}
          </div>
          <div class="row-meta">${escapeHtml(position.openedAt || "-")} \u2192 ${escapeHtml(position.closedAt || "-")}</div>
        </div>
        <div>${badge(`${fmtMoney(position.realizedPnl, currency)} / ${fmtPct(position.realizedReturnPct, 2)}`, pnlType)}</div>
      </div>
      ${positionGroup("成交与平仓结果", [
        calcCell(text.signalPrice, fmtPrice(position.signalEntryPrice)),
        calcCell(text.entry, fmtPrice(position.entry)),
        calcCell("\u5e73\u4ed3\u89e6\u53d1\u4ef7", fmtPrice(position.exitReferencePrice)),
        calcCell(text.exitPrice, fmtPrice(position.exitPrice)),
        calcCell(text.takeProfit, fmtPrice(position.takeProfit)),
        calcCell(text.stopLoss, fmtPrice(position.stopLoss)),
        calcCell(text.closeReason, position.closeReason || "-")
      ])}
      ${positionGroup("仓位与信号质量", [
        calcCell(text.notional, fmtMoney(position.notional, currency)),
        calcCell(text.marginUsed, fmtMoney(position.marginRequired, currency)),
        calcCell(text.quantity, fmtNumber(position.quantity, 6)),
        calcCell(text.winRate, fmtPct(position.winRate, 1)),
        calcCell("EV", fmtPct(position.expectancyPct, 2)),
        calcCell(text.impact, fmtNumber(position.eventImpactScore, 0))
      ])}
      ${positionGroup("实际交易成本", [
        calcCell(text.entryFee, fmtMoney(position.entryFee || 0, currency)),
        calcCell(text.exitFee, fmtMoney(position.exitFee || 0, currency)),
        calcCell(text.slippageCost, fmtMoney((position.entrySlippageCost || 0) + (position.exitSlippageCost || 0), currency)),
        calcCell(text.fundingPnl, fmtMoney(position.fundingPnl || 0, currency))
      ])}
      ${titles ? `<div class="position-events"><span>关联事件</span>${escapeHtml(titles)}</div>` : ""}
    </div>
  `;
}

function positionGroup(label, cells) {
  return `
    <section class="position-group">
      <div class="position-group-label">${escapeHtml(label)}</div>
      <div class="position-grid">${cells.join("")}</div>
    </section>
  `;
}

function buildEffectivenessAnalytics(account, summary) {
  const curve = asArray(account?.equityCurve)
    .filter((point) => Number.isFinite(Date.parse(point.time)) && Number.isFinite(Number(point.equity)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const trades = asArray(account?.tradeHistory)
    .filter((trade) => Number.isFinite(Date.parse(trade.closedAt)))
    .sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));

  let peak = safeNumber(summary?.startingCapital, curve[0]?.equity || 0);
  const returns = [];
  const performance = curve.map((point, index) => {
    const equity = safeNumber(point.equity);
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? equity / peak - 1 : 0;
    if (index > 0) {
      const previousEquity = safeNumber(curve[index - 1].equity);
      returns.push(previousEquity > 0 ? equity / previousEquity - 1 : 0);
    }
    const rollingReturns = returns.slice(-30);
    const rollingStd = standardDeviation(rollingReturns);
    const rollingSharpe =
      rollingReturns.length >= 5 && rollingStd > 0
        ? (mean(rollingReturns) / rollingStd) * Math.sqrt(rollingReturns.length)
        : 0;
    return {
      time: point.time,
      equity,
      returnPct: safeNumber(point.returnPct, summary?.startingCapital > 0 ? equity / summary.startingCapital - 1 : 0),
      drawdownPct,
      rollingSharpe,
      realizedPnl: safeNumber(point.realizedPnl),
      unrealizedPnl: safeNumber(point.unrealizedPnl)
    };
  });

  let cumulativePnl = 0;
  const tradeSeries = trades.map((trade, index) => {
    const realizedPnl = safeNumber(trade.realizedPnl);
    cumulativePnl += realizedPnl;
    return {
      index: index + 1,
      time: trade.closedAt,
      symbol: trade.symbol || "-",
      side: String(trade.side || "").toUpperCase(),
      result: trade.closeReason || "-",
      realizedPnl,
      cumulativePnl,
      predictedWinRate: safeNumber(trade.winRate),
      expectancyPct: safeNumber(trade.expectancyPct)
    };
  });

  const winningPnl = trades.reduce((sum, trade) => sum + Math.max(safeNumber(trade.realizedPnl), 0), 0);
  const losingPnl = Math.abs(trades.reduce((sum, trade) => sum + Math.min(safeNumber(trade.realizedPnl), 0), 0));
  const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? Number.POSITIVE_INFINITY : 0;
  const predictedWinRate = trades.length ? mean(trades.map((trade) => safeNumber(trade.winRate))) : 0;
  const actualWinRate = trades.length
    ? trades.filter((trade) => safeNumber(trade.realizedPnl) > 0).length / trades.length
    : 0;
  const brierScore = trades.length
    ? mean(
        trades.map((trade) => {
          const prediction = safeNumber(trade.winRate);
          const outcome = safeNumber(trade.realizedPnl) > 0 ? 1 : 0;
          return (prediction - outcome) ** 2;
        })
      )
    : 0;
  const fees = safeNumber(summary?.tradingFees);
  const slippage = safeNumber(summary?.slippageCost);
  const funding = safeNumber(summary?.fundingPnl);
  const costDrag = fees + slippage - funding;
  const startingCapital = safeNumber(summary?.startingCapital);
  const returnDrawdownRatio =
    Math.abs(safeNumber(summary?.maxDrawdownPct)) > 0
      ? safeNumber(summary?.finalReturnPct) / Math.abs(safeNumber(summary?.maxDrawdownPct))
      : 0;

  return {
    performance,
    tradeSeries,
    profitFactor,
    predictedWinRate,
    actualWinRate,
    brierScore,
    costDrag,
    costDragPct: startingCapital > 0 ? costDrag / startingCapital : 0,
    returnDrawdownRatio,
    sampleLabel: trades.length < 30 ? `样本较少（${trades.length}/30）` : `样本量 ${trades.length} 笔`,
    costs: [
      { name: "手续费", value: fees },
      { name: "滑点估算", value: slippage },
      { name: funding >= 0 ? "资金费收益" : "资金费支出", value: funding }
    ]
  };
}

function disposeSummaryCharts() {
  for (const chart of state.summaryCharts.values()) {
    if (chart && !chart.isDisposed()) chart.dispose();
  }
  state.summaryCharts.clear();
}

function chartAxisLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours()
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function baseChartOption() {
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: "#a5b1c2", fontFamily: "Inter, Segoe UI, sans-serif" },
    grid: { left: 54, right: 48, top: 28, bottom: 54 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#111821",
      borderColor: "#2a3849",
      textStyle: { color: "#edf2f7" },
      axisPointer: { type: "cross", lineStyle: { color: "#52657a" } }
    },
    legend: { show: false },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      {
        type: "slider",
        height: 14,
        bottom: 8,
        borderColor: "#263342",
        backgroundColor: "#0d131b",
        fillerColor: "rgba(68, 211, 165, 0.12)",
        handleStyle: { color: "#44d3a5", borderColor: "#44d3a5" },
        textStyle: { color: "#728196" }
      }
    ]
  };
}

function initSummaryChart(id, option) {
  const element = document.getElementById(id);
  if (!element || !window.echarts) return;
  const chart = window.echarts.init(element, null, { renderer: "canvas" });
  chart.setOption(option);
  state.summaryCharts.set(id, chart);
}

function renderPerformanceCharts(analytics, currency) {
  if (!window.echarts) {
    document.querySelectorAll(".chart-canvas").forEach((node) => {
      node.innerHTML = '<div class="chart-error">图表组件未加载。</div>';
    });
    return;
  }

  const times = analytics.performance.map((point) => point.time);
  const commonTimeAxis = {
    type: "category",
    boundaryGap: false,
    data: times,
    axisLine: { lineStyle: { color: "#2a3849" } },
    axisTick: { show: false },
    axisLabel: { color: "#728196", formatter: chartAxisLabel, hideOverlap: true }
  };
  const splitLine = { lineStyle: { color: "#202b38", type: "dashed" } };

  initSummaryChart("equityChart", {
    ...baseChartOption(),
    xAxis: commonTimeAxis,
    yAxis: [
      {
        type: "value",
        scale: true,
        name: currency,
        nameTextStyle: { color: "#728196" },
        axisLabel: { color: "#728196" },
        splitLine
      },
      {
        type: "value",
        name: "收益率",
        nameTextStyle: { color: "#728196" },
        axisLabel: { color: "#728196", formatter: (value) => `${value.toFixed(1)}%` },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "账户净值",
        type: "line",
        showSymbol: false,
        lineStyle: { color: "#44d3a5", width: 2 },
        areaStyle: { color: "rgba(68, 211, 165, 0.08)" },
        data: analytics.performance.map((point) => point.equity)
      },
      {
        name: "累计收益率",
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        lineStyle: { color: "#5ea7ff", width: 1.5 },
        data: analytics.performance.map((point) => point.returnPct * 100)
      }
    ]
  });

  initSummaryChart("riskChart", {
    ...baseChartOption(),
    xAxis: commonTimeAxis,
    yAxis: [
      {
        type: "value",
        name: "回撤",
        nameTextStyle: { color: "#728196" },
        axisLabel: { color: "#728196", formatter: (value) => `${value.toFixed(1)}%` },
        splitLine
      },
      {
        type: "value",
        name: "夏普",
        nameTextStyle: { color: "#728196" },
        axisLabel: { color: "#728196" },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "动态回撤",
        type: "line",
        showSymbol: false,
        lineStyle: { color: "#ff6b6b", width: 1.8 },
        areaStyle: { color: "rgba(255, 107, 107, 0.08)" },
        data: analytics.performance.map((point) => point.drawdownPct * 100)
      },
      {
        name: "滚动夏普（30点）",
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        lineStyle: { color: "#f2b84b", width: 1.5 },
        data: analytics.performance.map((point) => point.rollingSharpe)
      }
    ]
  });

  const tradeLabels = analytics.tradeSeries.map(
    (trade) => `#${trade.index} ${trade.symbol} ${trade.side}`
  );
  initSummaryChart("tradeChart", {
    ...baseChartOption(),
    tooltip: {
      ...baseChartOption().tooltip,
      formatter(params) {
        const index = params[0]?.dataIndex ?? 0;
        const trade = analytics.tradeSeries[index];
        if (!trade) return "";
        return [
          `${tradeLabels[index]} · ${escapeHtml(trade.result)}`,
          `平仓时间：${escapeHtml(trade.time)}`,
          `单笔净盈亏：${fmtMoney(trade.realizedPnl, currency)}`,
          `累计净盈亏：${fmtMoney(trade.cumulativePnl, currency)}`,
          `预测胜率：${fmtPct(trade.predictedWinRate, 1)}`,
          `预测 EV：${fmtPct(trade.expectancyPct, 2)}`
        ].join("<br>");
      }
    },
    xAxis: {
      type: "category",
      data: tradeLabels,
      axisLine: { lineStyle: { color: "#2a3849" } },
      axisTick: { show: false },
      axisLabel: { color: "#728196", hideOverlap: true }
    },
    yAxis: [
      { type: "value", scale: true, name: `单笔 ${currency}`, axisLabel: { color: "#728196" }, splitLine },
      {
        type: "value",
        scale: true,
        name: `累计 ${currency}`,
        axisLabel: { color: "#728196" },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "单笔净盈亏",
        type: "bar",
        barMaxWidth: 22,
        data: analytics.tradeSeries.map((trade) => ({
          value: trade.realizedPnl,
          itemStyle: { color: trade.realizedPnl >= 0 ? "#44d3a5" : "#ff6b6b" }
        }))
      },
      {
        name: "累计净盈亏",
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        lineStyle: { color: "#5ea7ff", width: 2 },
        data: analytics.tradeSeries.map((trade) => trade.cumulativePnl)
      }
    ]
  });

  initSummaryChart("costChart", {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 78, right: 28, top: 18, bottom: 24 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#111821",
      borderColor: "#2a3849",
      textStyle: { color: "#edf2f7" },
      valueFormatter: (value) => fmtMoney(value, currency)
    },
    xAxis: {
      type: "value",
      axisLabel: { color: "#728196" },
      splitLine: { lineStyle: { color: "#202b38", type: "dashed" } }
    },
    yAxis: {
      type: "category",
      data: analytics.costs.map((item) => item.name),
      axisLine: { lineStyle: { color: "#2a3849" } },
      axisTick: { show: false },
      axisLabel: { color: "#8d9caf" }
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 24,
        label: {
          show: true,
          position: "right",
          color: "#a5b1c2",
          formatter: ({ value }) => fmtNumber(value, 2)
        },
        data: analytics.costs.map((item) => ({
          value: item.value,
          itemStyle: { color: item.value < 0 ? "#44d3a5" : item.name.includes("资金费收益") ? "#44d3a5" : "#f2b84b" }
        }))
      }
    ]
  });
}

function renderAccountSummary(summary, currency = "USDT", account = {}) {
  const container = $("#accountSummary");
  container.hidden = !state.summaryVisible;
  $("#summaryButton").textContent = state.summaryVisible ? text.refreshSummary : text.viewSummary;
  disposeSummaryCharts();
  if (!summary) {
    container.innerHTML = "";
    return;
  }
  const analytics = buildEffectivenessAnalytics(account, summary);
  const updatedText = state.summaryFetchedAt
    ? `<span class="summary-status">${text.summaryUpdated}\uff1a${escapeHtml(state.summaryFetchedAt)}</span>`
    : "";
  container.innerHTML = `
    <div class="account-summary-head">
      <strong>${text.accountPeriodSummary}</strong>
      ${updatedText}
    </div>
    <div class="account-summary-grid">
      ${metricCell(text.summaryStart, summary.startTime || "-")}
      ${metricCell(text.summaryEnd, summary.endTime || "-")}
      ${metricCell(text.finalReturn, fmtPct(summary.finalReturnPct, 2))}
      ${metricCell(text.maxReturn, fmtPct(summary.maxReturnPct, 2))}
      ${metricCell(text.maxDrawdown, fmtPct(summary.maxDrawdownPct, 2))}
      ${metricCell(text.sharpe, fmtNumber(summary.sharpeRatio, 3))}
      ${metricCell(text.closedTrades, fmtNumber(summary.closedTrades, 0))}
      ${metricCell(text.winRate, fmtPct(summary.winRate, 1))}
      ${metricCell(text.realizedPnl, fmtMoney(summary.realizedPnl, currency))}
      ${metricCell(text.unrealizedPnl, fmtMoney(summary.unrealizedPnl, currency))}
      ${metricCell(text.tradingFees, fmtMoney(summary.tradingFees || 0, currency))}
      ${metricCell(text.slippageCost, fmtMoney(summary.slippageCost || 0, currency))}
      ${metricCell(text.fundingPnl, fmtMoney(summary.fundingPnl || 0, currency))}
    </div>
    <div class="effectiveness-head">
      <div>
        <strong>系统有效性诊断</strong>
        <span>收益、风险、交易质量与成本共同判断，单一收益率不足以证明策略有效。</span>
      </div>
      ${badge(analytics.sampleLabel, analytics.tradeSeries.length < 30 ? "warn" : "ok")}
    </div>
    <div class="effectiveness-grid">
      ${metricCell("利润因子", Number.isFinite(analytics.profitFactor) ? fmtNumber(analytics.profitFactor, 3) : "∞")}
      ${metricCell("预测 / 实际胜率", `${fmtPct(analytics.predictedWinRate, 1)} / ${fmtPct(analytics.actualWinRate, 1)}`)}
      ${metricCell("Brier 误差（越低越好）", fmtNumber(analytics.brierScore, 4))}
      ${metricCell("成本拖累", `${fmtMoney(analytics.costDrag, currency)} / ${fmtPct(analytics.costDragPct, 2)}`)}
      ${metricCell("收益 / 最大回撤", fmtNumber(analytics.returnDrawdownRatio, 3))}
    </div>
    <div class="analytics-grid">
      <section class="chart-panel chart-panel-wide">
        <div class="chart-heading">
          <div><strong>净值与累计收益</strong><span>判断最终是否赚钱及收益路径是否稳定</span></div>
          <div class="chart-key" aria-label="图例">
            <span><i style="--key-color:#44d3a5"></i>账户净值</span>
            <span><i style="--key-color:#5ea7ff"></i>累计收益率</span>
          </div>
        </div>
        <div id="equityChart" class="chart-canvas"></div>
      </section>
      <section class="chart-panel chart-panel-wide">
        <div class="chart-heading">
          <div><strong>动态回撤与滚动夏普</strong><span>30 个净值点滚动计算，非年化</span></div>
          <div class="chart-key" aria-label="图例">
            <span><i style="--key-color:#ff6b6b"></i>动态回撤</span>
            <span><i style="--key-color:#f2b84b"></i>滚动夏普</span>
          </div>
        </div>
        <div id="riskChart" class="chart-canvas"></div>
      </section>
      <section class="chart-panel chart-panel-wide">
        <div class="chart-heading">
          <div><strong>逐笔交易与累计净盈亏</strong><span>用于识别收益是否依赖少数异常交易</span></div>
          <div class="chart-key" aria-label="图例">
            <span><i style="--key-color:#44d3a5"></i>单笔净盈亏</span>
            <span><i style="--key-color:#5ea7ff"></i>累计净盈亏</span>
          </div>
        </div>
        <div id="tradeChart" class="chart-canvas"></div>
      </section>
      <section class="chart-panel">
        <div class="chart-heading">
          <div><strong>成本侵蚀</strong><span>手续费、滑点估算与资金费率净额</span></div>
        </div>
        <div id="costChart" class="chart-canvas compact-chart"></div>
      </section>
    </div>
    <p class="analytics-note">当前 ${analytics.tradeSeries.length} 笔已平仓交易。30 笔仅是最低观察阈值，不是统计稳定性的证明；无证据表明当前利润因子、胜率或夏普可以外推到未来，图表仅描述现有模拟样本。</p>
  `;
  if (state.summaryVisible) {
    requestAnimationFrame(() => renderPerformanceCharts(analytics, currency));
  }
}

function renderMessages() {
  const messages = asArray(state.report?.messageFeed);
  const models = asArray(state.report?.modelCalculations);
  $("#messages").innerHTML = messages.length
    ? messages.map(messageRow).join("")
    : `<div class="empty">${models.length ? text.noMessagesMath : text.noMessagesNoMarket}</div>`;
}

function renderWhaleAlertConnection() {
  const connection = state.whaleAlert || {};
  const input = $("#whaleAlertApiKey");
  const button = $("#whaleAlertConnectButton");
  const status = $("#whaleAlertStatus");
  if (!input || !button || !status) return;

  if (!state.whaleAlertEditing) {
    input.value = "";
    input.placeholder = connection.configured
      ? `已保存 ${connection.maskedKey || "API Key"}`
      : "输入 API Key";
  }

  if (state.whaleAlertSubmitting) {
    button.disabled = true;
    button.textContent = "连接中...";
    status.className = "whale-alert-status checking";
    status.textContent = "正在验证 Whale Alert 接口";
    return;
  }

  const hasEditedKey = state.whaleAlertEditing && input.value.trim().length > 0;
  if (connection.connected && !state.whaleAlertEditing) {
    button.disabled = true;
    button.textContent = "已连接";
    button.classList.add("connected");
    status.className = "whale-alert-status connected";
    status.textContent = `连接正常 · 最近获取 ${connection.messageCount || 0} 条 · ${connection.checkedAt || "-"}`;
    return;
  }

  button.classList.remove("connected");
  button.textContent = "确认连接";
  button.disabled = state.whaleAlertAwaitingEdit || !hasEditedKey;
  if (connection.error) {
    status.className = "whale-alert-status error";
    status.textContent = connection.error;
  } else if (state.whaleAlertEditing) {
    status.className = "whale-alert-status editing";
    status.textContent = "密钥已修改，确认后才会替换当前连接";
  } else {
    status.className = "whale-alert-status";
    status.textContent = connection.configured ? "已保存密钥，等待连接验证" : "未配置 Whale Alert";
  }
}

function messageRow(item) {
  const dir = item.direction > 0 ? badge(text.bullish, "ok") : item.direction < 0 ? badge(text.bearish, "danger") : badge(text.neutral);
  const originalTitle = String(item.title || "-");
  const translatedTitle = state.translations[originalTitle]
    ? polishChineseTranslation(state.translations[originalTitle])
    : localizeKnownMessageTitle(originalTitle) || originalTitle;
  const translatedDetail = translateMessageDetail(item, translatedTitle);
  const title = item.url
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(translatedTitle)}</a>`
    : escapeHtml(translatedTitle);
  return `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(item.source || "-")}</div>
        <div class="row-meta">${text.impact} ${fmtNumber(item.impactScore, 0)} | ${asArray(item.matchedSymbols).join(", ") || text.marketWide}</div>
      </div>
      <div>
        <div>${title}</div>
        ${translatedDetail ? `<div class="row-meta">${escapeHtml(translatedDetail)}</div>` : ""}
      </div>
      <div>${dir}</div>
    </div>
  `;
}

function translateMessageDetail(item, translatedTitle) {
  const originalTitle = String(item?.title || "").trim();
  const originalDetail = String(item?.text || "").trim();
  if (!originalDetail || originalDetail === originalTitle) return "";
  if (state.translations[originalDetail]) {
    return polishChineseTranslation(state.translations[originalDetail]);
  }

  let detail = originalDetail;
  if (originalTitle && detail.startsWith(originalTitle)) {
    detail = detail.slice(originalTitle.length).trim();
  }
  return detail
    .replace(/\bvolume=/gi, "成交量=")
    .replace(/\bliquidity=/gi, "流动性=")
    .replace(/\byes=/gi, "赞成概率=")
    .replace(/\bdelta=/gi, "价格变化=")
    .replace(/\bmarket cap=/gi, "市值=")
    .replace(/\bopen interest=/gi, "未平仓量=");
}

function polishChineseTranslation(value) {
  return String(value || "")
    .replace(/Binance Futures/gi, "币安合约")
    .replace(/Binance Exchange/gi, "币安交易所")
    .replace(/\bBinance\b/gi, "币安")
    .replace(/币安期货/g, "币安合约")
    .replace(/USDⓈ-Margined/gi, "U本位")
    .replace(/USD\s*-\s*保证金/gi, "U本位")
    .replace(/美元\s*-\s*保证金/g, "U本位")
    .replace(/美元保证金/g, "U本位")
    .replace(/Pre-IPO Trading/gi, "上市前交易")
    .replace(/IPO前交易/gi, "上市前交易")
    .replace(/Perpetual Contracts?/gi, "永续合约")
    .replace(/Spot Trading Pairs?/gi, "现货交易对")
    .replace(/Will Launch/gi, "将推出")
    .replace(/\s+([，。！？；：）])/g, "$1")
    .replace(/（\s+/g, "（")
    .replace(/\s+）/g, "）");
}

function localizeKnownMessageTitle(value) {
  const whaleTransfer = String(value || "").match(
    /^([a-z0-9]+)\s+whale transfer\s+([\d.]+)\s+USD$/i
  );
  if (!whaleTransfer) return "";
  const amount = Number(whaleTransfer[2]);
  const formattedAmount = Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : whaleTransfer[2];
  return `${whaleTransfer[1].toUpperCase()} 巨鲸转账 ${formattedAmount} 美元`;
}

function renderWarnings() {
  const warnings = asArray(state.report?.warnings);
  $("#warnings").innerHTML = warnings.length
    ? warnings.slice(0, 24).map((warning) => `<div class="row"><div>${escapeHtml(translateWarning(warning))}</div></div>`).join("")
    : `<div class="empty">${text.noWarnings}</div>`;
}

function renderModels() {
  const models = asArray(state.report?.modelCalculations);
  $("#models").innerHTML = models.length ? models.slice(0, 20).map(modelRow).join("") : `<div class="empty">${text.noModel}</div>`;
}

function modelRow(item) {
  const math = item.mathBreakdown || {};
  const inputs = math.inputs || {};
  const components = math.components || {};
  const signal = item.signal || {};
  const accountControl = signal.accountControl || {};
  const advanced = item.advancedModels || {};
  const gbm = advanced.gbm || math.models?.gbm || {};
  const garch = advanced.garch || math.models?.garch || {};
  const hiddenMarkov = advanced.hiddenMarkov || math.models?.hiddenMarkov || {};
  const markowitz = advanced.markowitz || signal.markowitz || {};
  const mode = item.candidateMode === "math_only" ? "\u7eaf\u6570\u5b66\u6a21\u578b" : item.candidateMode || item.analysisMode || "-";
  return `
    <div class="model-item">
      <div class="model-head">
        <div>
          <div class="row-title">${escapeHtml(item.symbol)} | ${escapeHtml(item.regime || "-")} | ${escapeHtml(mode)}</div>
          <div class="row-meta">${text.candidateStatus} ${escapeHtml(item.candidateStatus)} | ${escapeHtml(item.noCandidateReason || text.generatedCandidate)}</div>
        </div>
        <div>${item.candidateStatus === "passed" ? badge(text.passed, "ok") : item.candidateStatus === "watch" ? badge(text.watch, "warn") : badge(text.none)}</div>
      </div>
      <div class="calc-grid">
        ${calcCell(text.latestPrice, fmtPrice(item.latest))}
        ${calcCell("Math Signal", fmtNumber(item.mathSignal, 4))}
        ${calcCell(text.eventImpact, fmtNumber(item.eventImpactScore, 0))}
        ${calcCell("ATR%", fmtPct(inputs.atrPct, 2))}
        ${calcCell("RSI", fmtNumber(inputs.rsi14, 2))}
        ${calcCell(text.oiChange, fmtPct(inputs.oiChange, 2))}
        ${calcCell(text.trendTerm, fmtNumber(components.trendSignal, 4))}
        ${calcCell(text.htfTrendTerm, fmtNumber(components.htfTrendSignal, 4))}
        ${calcCell(text.momentumTerm, fmtNumber(components.momentumSignal, 4))}
        ${calcCell(text.fundingTerm, fmtNumber(components.fundingSignal, 4))}
        ${calcCell("GBM 上涨概率", fmtPct(gbm.probabilityUp, 1))}
        ${calcCell("GBM 1h期望", fmtPct(gbm.expectedReturn, 3))}
        ${calcCell("GARCH预测波动", fmtPct(garch.forecastVolatility, 3))}
        ${calcCell("GARCH波动比", fmtNumber(garch.volatilityRatio, 3))}
        ${calcCell("HMM状态", localizeHmmRegime(hiddenMarkov.regime))}
        ${calcCell("HMM 多/空概率", `${fmtPct(hiddenMarkov.bullProbability, 1)} / ${fmtPct(hiddenMarkov.bearProbability, 1)}`)}
        ${calcCell("Markowitz权重", fmtPct(markowitz.weight, 1))}
        ${calcCell(text.winRate, fmtPct(signal.winRate, 1))}
        ${calcCell("EV", fmtPct(signal.expectancyPct, 2))}
        ${calcCell(text.modelLeverage, accountControl.modelSuggestedLeverage ? `${fmtNumber(accountControl.modelSuggestedLeverage, 2)}x` : "-")}
        ${calcCell(text.leverage, accountControl.appliedLeverage ? `${fmtNumber(accountControl.appliedLeverage, 2)}x` : "-")}
      </div>
      <div class="formula">${escapeHtml(buildFormulaText(item))}</div>
    </div>
  `;
}

function calcCell(label, value) {
  return `<div class="calc-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function buildFormulaText(item) {
  const math = item.mathBreakdown || {};
  const calc = item.candidateCalculation || {};
  const lines = [math.formula || ""];
  for (const model of Object.values(math.models || {})) {
    if (model?.formula) lines.push(model.formula);
  }
  if (calc.direction) lines.push(calc.direction.formula);
  if (calc.winRate) lines.push(calc.winRate.formula);
  if (calc.riskReward) lines.push(calc.riskReward.formula);
  if (calc.expectancy) lines.push(calc.expectancy.formula);
  if (calc.gate) lines.push(calc.gate.formula);
  if (calc.markowitz) lines.push(calc.markowitz.formula);
  return lines.filter(Boolean).join("\n");
}

function localizeHmmRegime(regime) {
  const labels = { bull: "牛市", bear: "熊市", range: "震荡" };
  return labels[regime] || regime || "-";
}

function renderLog() {
  $("#logView").textContent = state.log || text.noLog;
}

function render() {
  renderSummary();
  renderAccount();
  renderSignals();
  renderWhaleAlertConnection();
  renderMessages();
  renderWarnings();
  renderModels();
  renderLog();
}

function bindEvents() {
  $("#refreshButton").addEventListener("click", () => loadData().catch(showError));
  $("#whaleAlertApiKey").addEventListener("input", () => {
    state.whaleAlertEditing = true;
    state.whaleAlertAwaitingEdit = false;
    state.whaleAlert = {
      ...(state.whaleAlert || {}),
      error: null,
      errorCode: null
    };
    renderWhaleAlertConnection();
  });
  $("#whaleAlertForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#whaleAlertApiKey");
    const apiKey = input.value.trim();
    if (!apiKey || state.whaleAlertSubmitting) return;
    state.whaleAlertSubmitting = true;
    renderWhaleAlertConnection();
    try {
      state.whaleAlert = await postJson("/api/whale-alert/connect", { apiKey });
      state.whaleAlertEditing = false;
      state.whaleAlertAwaitingEdit = false;
      input.value = "";
    } catch (error) {
      state.whaleAlert = {
        ...(state.whaleAlert || {}),
        connected: false,
        errorCode: error.code,
        error: error.message
      };
      state.whaleAlertAwaitingEdit = true;
    } finally {
      state.whaleAlertSubmitting = false;
      renderWhaleAlertConnection();
    }
  });
  $("#accountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const marketType = $("#accountMarketType").value === "spot" ? "spot" : "futures";
      const payload = {
        initialCapital: Number($("#accountCapital").value),
        marketType,
        maxLeverage: marketType === "spot" ? 1 : Number($("#accountMaxLeverage").value),
        riskProfile: $("#accountRiskProfile").value === "aggressive" ? "aggressive" : "conservative"
      };
      state.account = await postJson("/api/account", payload);
      render();
      $("#accountSummary").insertAdjacentHTML("afterbegin", `<div class="notice">${text.saved}</div>`);
    } catch (error) {
      showError(error);
    }
  });
  $("#resetAccountButton").addEventListener("click", async () => {
    try {
      state.account = await postJson("/api/account/reset");
      render();
      $("#accountSummary").insertAdjacentHTML("afterbegin", `<div class="notice">${text.reset}</div>`);
    } catch (error) {
      showError(error);
    }
  });
  $("#startAccountButton").addEventListener("click", async () => {
    const button = $("#startAccountButton");
    button.disabled = true;
    try {
      state.account = await postJson("/api/account/start");
      render();
      $("#accountSummary").insertAdjacentHTML("afterbegin", `<div class="notice">${text.started}</div>`);
    } catch (error) {
      button.disabled = false;
      showError(error);
    }
  });
  $("#summaryButton").addEventListener("click", async () => {
    const button = $("#summaryButton");
    button.disabled = true;
    button.textContent = text.loadingSummary;
    try {
      const data = await getJson("/api/account/summary");
      state.account = { config: data.config, account: data.account };
      state.summaryVisible = true;
      state.summaryFetchedAt = new Date().toLocaleString("zh-CN", { hour12: false });
      render();
      renderAccountSummary(data.summary, data.config?.quoteCurrency || "USDT", data.account);
      $("#accountSummary").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
      button.textContent = state.summaryVisible ? text.refreshSummary : text.viewSummary;
    }
  });
  $("#accountMarketType").addEventListener("change", () => {
    const spot = $("#accountMarketType").value === "spot";
    $("#accountMaxLeverage").disabled = spot;
    if (spot) $("#accountMaxLeverage").value = 1;
  });
  document.querySelectorAll("[data-position-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.positionView = button.dataset.positionView === "closed" ? "closed" : "open";
      const { config, account } = getAccountBundle();
      renderAccountPositions(account, config.quoteCurrency || "USDT");
    });
  });
}

function showError(error) {
  $("#signals").innerHTML = `<div class="empty">${text.readFailed}\uff1a${escapeHtml(error.message)}</div>`;
}

bindEvents();
window.addEventListener("resize", () => {
  for (const chart of state.summaryCharts.values()) {
    if (chart && !chart.isDisposed()) chart.resize();
  }
});
loadData().catch(showError);
setInterval(() => loadData().catch(showError), 15_000);
