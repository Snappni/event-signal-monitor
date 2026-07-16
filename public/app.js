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
  messageAggregator: null,
  messageAggregatorEditing: false,
  messageAggregatorSubmitting: false,
  postTradeReviewSubmitting: false
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
  collapseSummary: "\u6536\u8d77\u603b\u7ed3",
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

function fmtTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function fmtAgeMinutes(value) {
  if (!Number.isFinite(value)) return "时间未知";
  if (value < 1) return "不足 1 分钟";
  if (value < 60) return `${Math.floor(value)} 分钟`;
  if (value < 1_440) return `${Math.floor(value / 60)} 小时 ${Math.floor(value % 60)} 分钟`;
  return `${Math.floor(value / 1_440)} 天 ${Math.floor((value % 1_440) / 60)} 小时`;
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
    ["WhaleAlert", "WhaleAlert \u5de8\u9cb8\u76d1\u63a7"],
    ["Message aggregator", "\u6d88\u606f\u805a\u5408\u5668"]
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
  const [report, status, log, account, messageAggregator] = await Promise.all([
    getJson("/api/report"),
    getJson("/api/status"),
    getJson("/api/log?bytes=80000"),
    getJson("/api/account"),
    getJson("/api/message-aggregator/status")
  ]);
  state.report = report;
  state.status = status;
  state.log = log.text || "";
  state.account = account;
  state.messageAggregator = messageAggregator;
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
  $("#layerValue").textContent = "统一高频";
  $("#actionableValue").textContent = actionable.length;
  $("#watchValue").textContent = watchlist.length;
  $("#messageValue").textContent = messages.length;
  $("#modelValue").textContent = models.length;
  const loopStatus = state.status?.loopRunning
    ? `统一高频 1m ${text.running}`
    : `统一高频 ${text.stopped}`;
  $("#loopValue").textContent = loopStatus;
  $("#reportTime").textContent = report.generatedAt || "-";
  $("#sourceCounts").textContent = `内置 RSS ${sourceCounts.rss || 0} | 热榜 ${sourceCounts.trend || 0} | GDELT ${sourceCounts.gdelt || 0} | Polymarket ${sourceCounts.polymarket || 0} | 交易所公告 ${(sourceCounts.binanceAnnouncements || 0) + (sourceCounts.okxAnnouncements || 0)} | 合并重复 ${sourceCounts.suppressedDuplicates || 0} | 市场计算 ${sourceCounts.marketAnalyses || 0}`;
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
  const adaptiveGateText = Number.isFinite(Number(signal.adaptiveWinRateThreshold))
    ? `${fmtPct(signal.adaptiveWinRateThreshold, 1)} / 保本 ${fmtPct(signal.breakEvenWinRate, 1)}`
    : "旧信号未记录";
  return `
    <div class="signal-grid">
      <div class="signal-cell"><span>${text.status}</span><strong>${badge(`${label} / ${mode}`, badgeType)}</strong></div>
      <div class="signal-cell"><span>${text.symbol}</span><strong>${escapeHtml(signal.symbol)} ${escapeHtml(String(signal.side || "").toUpperCase())}</strong></div>
      <div class="signal-cell"><span>${text.entry}</span><strong>${fmtPrice(signal.entry)}</strong></div>
      <div class="signal-cell"><span>${text.takeProfit}</span><strong>${fmtPrice(signal.takeProfit)}</strong></div>
      <div class="signal-cell"><span>${text.stopLoss}</span><strong>${fmtPrice(signal.stopLoss)}</strong></div>
      <div class="signal-cell"><span>${text.winRate}</span><strong>${fmtPct(signal.winRate, 1)}</strong></div>
      <div class="signal-cell"><span>自适应胜率门槛 / 保本</span><strong>${escapeHtml(adaptiveGateText)}</strong></div>
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
      "自适应：成本保本胜率 + 校准/波动/行情状态裕量"
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
  renderPostTradeReview(account, currency);
  renderAccountSummary(account.summary, currency, account);
}

const reviewFactorLabels = {
  eventImpact: "事件影响",
  trend: "15分钟趋势",
  higherTimeframeTrend: "1小时趋势",
  momentum: "动量",
  rsi: "RSI反转",
  funding: "资金费率",
  openInterest: "未平仓量",
  geometricBrownianMotion: "GBM方向",
  hiddenMarkovModel: "HMM状态",
  volatilityRegime: "波动状态",
  liquidity: "流动性",
  gbm: "GBM质量",
  garch: "GARCH稳定性",
  hiddenMarkov: "HMM置信度",
  markowitz: "Markowitz仓位",
  poisson: "事件到达强度",
  bayesian: "贝叶斯校准"
};

function renderPostTradeReview(account, currency) {
  const config = account.postTradeReviewConfig || {};
  const reviewState = account.postTradeReview || {};
  const latest = reviewState.latestReview || null;
  const closedTrades = asArray(account.tradeHistory).length;
  const reviewedTrades = Number(reviewState.reviewedTradeCount || 0);
  const newTrades = Math.max(0, closedTrades - reviewedTrades);
  const interval = Number(config.reviewEveryTrades || 20);
  const remaining = Math.max(0, interval - newTrades);
  const everyInput = $("#reviewEveryTrades");
  const autoInput = $("#reviewAutoApply");
  if (everyInput) setInputValueIfUnfocused(everyInput, interval);
  if (autoInput && document.activeElement !== autoInput) autoInput.checked = config.autoApplyValidatedWeights === true;

  const status = $("#postTradeReviewStatus");
  if (status) {
    status.className = "review-status";
    if (config.enabled === false) {
      status.textContent = "复盘已停用";
    } else if (latest?.status === "promoted") {
      status.textContent = `权重版本 v${reviewState.weightVersion || 1} 已晋升`;
      status.classList.add("ready");
    } else if (latest?.promotionEligible) {
      status.textContent = "候选权重已通过验证";
      status.classList.add("ready");
    } else if (latest) {
      status.textContent = latest.status === "insufficient_data" ? "样本不足，仅生成诊断" : "候选权重影子观察中";
      status.classList.add("warn");
    } else {
      status.textContent = remaining ? `再完成 ${remaining} 笔触发复盘` : "等待下一轮监控触发";
    }
  }

  const applyButton = $("#applyReviewCandidateButton");
  const rollbackButton = $("#rollbackReviewWeightsButton");
  if (applyButton) applyButton.disabled = state.postTradeReviewSubmitting || !latest?.promotionEligible || latest?.applied;
  if (rollbackButton) rollbackButton.disabled = state.postTradeReviewSubmitting || !reviewState.previousDirectionWeights;

  const target = $("#postTradeReview");
  if (!target) return;
  if (!latest) {
    target.innerHTML = `
      <div class="empty">当前已平仓 ${closedTrades} 笔；从上次复盘后新增 ${newTrades} 笔。达到 ${interval} 笔后自动生成第一份链路复盘。</div>
      <p class="review-note">只有新开仓时已经保存因子快照的交易才能用于归因。历史旧交易不会被伪造补全。</p>
    `;
    return;
  }

  const validation = latest.validation || null;
  const factorRows = asArray(latest.factorStatistics)
    .map((item) => {
      const delta = Number(item.normalizedChangePct || 0);
      const deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "";
      return `
        <div class="review-factor-row">
          <div class="review-factor-name"><strong>${escapeHtml(reviewFactorLabels[item.factor] || item.factor)}</strong><span>${fmtNumber(item.activeSamples || 0, 0)}/${fmtNumber(item.samples || 0, 0)} 笔有效</span></div>
          <div><span class="row-meta">当前权重</span>${fmtPct(item.currentWeight || 0, 2)}</div>
          <div><span class="row-meta">候选权重</span>${item.candidateWeight == null ? "-" : fmtPct(item.candidateWeight, 2)}</div>
          <div class="review-factor-delta ${deltaClass}"><span class="row-meta">建议变化</span>${item.candidateWeight == null ? "-" : fmtPct(delta, 2)}</div>
          <div><span class="row-meta">方向关联</span>${fmtNumber(item.directionAssociation || 0, 3)}</div>
        </div>
      `;
    })
    .join("");
  const tradeRows = asArray(latest.trades)
    .slice(-10)
    .reverse()
    .map((trade) => {
      const contributionText = asArray(trade.factorContributions)
        .slice(0, 3)
        .map((item) => `${reviewFactorLabels[item.factor] || item.factor} ${fmtNumber(item.contribution, 3)}`)
        .join(" · ");
      const allContributions = asArray(trade.factorContributions)
        .map((item) => `${reviewFactorLabels[item.factor] || item.factor}: 信号 ${fmtNumber(item.signal, 3)} × 权重 ${fmtPct(item.weight, 1)} = ${fmtNumber(item.contribution, 3)}`)
        .join("<br>");
      const relatedEvents = asArray(trade.relatedEvents)
        .map((event) => event.title || event.text || "")
        .filter(Boolean)
        .join(" | ");
      const classificationLabels = {
        profitable: "盈利",
        cost_drag: "交易成本侵蚀",
        stop_loss: "止损退出",
        direction_or_timing_error: "方向或时机错误"
      };
      return `
        <div class="review-trade-row">
          <div><strong>${escapeHtml(trade.symbol || "-")} ${escapeHtml(String(trade.side || "").toUpperCase())}</strong><div class="row-meta">${escapeHtml(trade.openedAt || "-")} → ${escapeHtml(trade.closedAt || "-")}</div></div>
          <div><strong>${fmtMoney(trade.realizedPnl || 0, currency)} / ${fmtNumber(trade.netR || 0, 2)}R</strong><div class="row-meta">${escapeHtml(classificationLabels[trade.classification] || trade.classification || "-")}</div></div>
          <div>
            <div>${escapeHtml(contributionText || "无可用贡献数据")}</div>
            <div class="row-meta">状态 ${escapeHtml(trade.regime || "unknown")} · 模型 ${escapeHtml(trade.modelVersion || "-")}</div>
            <details class="review-trade-details">
              <summary>查看完整交易链路</summary>
              <div>入场 ${fmtPrice(trade.entry)} · 出场 ${fmtPrice(trade.exitPrice)} · TP ${fmtPrice(trade.takeProfit)} · SL ${fmtPrice(trade.stopLoss)}</div>
              <div>预测胜率 ${fmtPct(trade.decision?.predictedWinRate || 0, 1)} · 自适应门槛 ${fmtPct(trade.decision?.adaptiveWinRateThreshold || 0, 1)} · 保本胜率 ${fmtPct(trade.decision?.breakEvenWinRate || 0, 1)}</div>
              <div>预测EV ${fmtPct(trade.decision?.predictedExpectancyPct || 0, 2)} · 事件影响 ${fmtNumber(trade.decision?.eventImpactScore || 0, 0)}</div>
              <div>事件方向 ${fmtNumber(trade.decision?.eventDirection || 0, 3)} × ${fmtPct(trade.decision?.eventWeight || 0, 1)}；数学方向 ${fmtNumber(trade.decision?.mathDirection || 0, 3)} × ${fmtPct(trade.decision?.mathWeight || 0, 1)}</div>
              <div>MFE ${fmtPct(trade.maxFavorableExcursionPct || 0, 2)} · MAE ${fmtPct(trade.maxAdverseExcursionPct || 0, 2)} · 持仓采样 ${fmtNumber(trade.holdingObservationCount || 0, 0)} 次</div>
              <div class="review-detail-factors">${allContributions || "无因子贡献数据"}</div>
              ${relatedEvents ? `<div>关联事件：${escapeHtml(relatedEvents)}</div>` : ""}
            </details>
          </div>
        </div>
      `;
    })
    .join("");
  const qualityRows = asArray(latest.qualityFactorStatistics)
    .map((item) => `
      <div class="review-factor-row">
        <div class="review-factor-name"><strong>${escapeHtml(reviewFactorLabels[item.factor] || item.factor)}</strong><span>${fmtNumber(item.samples || 0, 0)} 笔</span></div>
        <div><span class="row-meta">平均强度</span>${fmtNumber(item.meanStrength || 0, 3)}</div>
        <div><span class="row-meta">盈利交易</span>${fmtNumber(item.meanStrengthOnWins || 0, 3)}</div>
        <div><span class="row-meta">亏损交易</span>${fmtNumber(item.meanStrengthOnLosses || 0, 3)}</div>
        <div><span class="row-meta">净R相关</span>${fmtNumber(item.netRCorrelation || 0, 3)}</div>
      </div>
    `)
    .join("");

  target.innerHTML = `
    <div class="review-overview">
      <div class="review-card"><span>累计已平仓</span><strong>${fmtNumber(latest.totalClosedTrades || 0, 0)}</strong></div>
      <div class="review-card"><span>可归因样本</span><strong>${fmtNumber(latest.eligibleTrades || 0, 0)}</strong></div>
      <div class="review-card"><span>排除旧数据</span><strong>${fmtNumber(latest.excludedTrades || 0, 0)}</strong></div>
      <div class="review-card"><span>当前权重版本</span><strong>v${fmtNumber(reviewState.weightVersion || 1, 0)}</strong></div>
    </div>
    ${validation ? `
      <div class="review-subtitle">按时间顺序的训练 / 验证结果</div>
      <div class="review-validation">
        <div class="review-card"><span>训练样本</span><strong>${fmtNumber(validation.trainingSamples || 0, 0)}</strong></div>
        <div class="review-card"><span>验证样本</span><strong>${fmtNumber(validation.validationSamples || 0, 0)}</strong></div>
        <div class="review-card"><span>原权重准确率</span><strong>${fmtPct(validation.champion?.accuracy || 0, 1)}</strong></div>
        <div class="review-card"><span>候选权重准确率</span><strong>${fmtPct(validation.challenger?.accuracy || 0, 1)}</strong></div>
      </div>
    ` : `<p class="review-note">目前只有 ${fmtNumber(latest.eligibleTrades || 0, 0)} 笔可归因交易；至少需要 ${fmtNumber(config.minimumProposalTrades || 20, 0)} 笔才生成候选权重。</p>`}
    <div class="review-subtitle">因子归因与候选权重</div>
    <div>${factorRows || `<div class="empty">暂无因子统计</div>`}</div>
    <div class="review-subtitle">事件、风险与仓位因子诊断（只诊断，不混入方向权重）</div>
    <div>${qualityRows || `<div class="empty">暂无质量因子统计</div>`}</div>
    <div class="review-subtitle">最近交易完整链路摘要</div>
    <div>${tradeRows || `<div class="empty">暂无具备开仓快照的交易</div>`}</div>
    <p class="review-note">这里衡量的是因子与结果的预测关联，不是因果证明。候选权重每轮变化受限，并且必须先在后段时间样本上胜过当前权重；无证据表明权重变化一定提高未来盈利。</p>
  `;
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
      <div class="account-summary-head-actions">
        ${updatedText}
        <button class="summary-collapse-button" data-summary-action="collapse" type="button" aria-label="${text.collapseSummary}">${text.collapseSummary}</button>
      </div>
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

function renderMessageAggregatorConnection() {
  const connection = state.messageAggregator || {};
  const config = connection.config || {};
  const filterKeywords = $("#messageFilterKeywords");
  const enabled = $("#messageAggregatorEnabled");
  const button = $("#messageAggregatorConnectButton");
  const status = $("#messageAggregatorStatus");
  if (!filterKeywords || !enabled || !button || !status) return;

  if (!state.messageAggregatorEditing) {
    filterKeywords.value = Array.isArray(config.filterKeywords) ? config.filterKeywords.join(",") : "";
    enabled.checked = config.enabled !== false;
  }

  if (state.messageAggregatorSubmitting) {
    button.disabled = true;
    button.textContent = "验证中...";
    status.className = "message-aggregator-status checking";
    status.textContent = "正在读取并解析全部聚合源";
    return;
  }

  button.classList.remove("connected");
  button.textContent = "验证来源并保存关键词";
  button.disabled = false;
  if (state.messageAggregatorEditing) {
    status.className = "message-aggregator-status editing";
    status.textContent = "关键词已修改；固定来源验证成功后才会保存";
    return;
  }
  if (connection.enabled === false && connection.configured) {
    status.className = "message-aggregator-status";
    status.textContent = "聚合采集已停用；配置仍保留";
  } else if (connection.connected) {
    button.classList.add("connected");
    const connectedSources = asArray(connection.sources).filter((source) => source.connected).length;
    const totalSources = asArray(connection.sources).length;
    status.className = connection.degraded ? "message-aggregator-status editing" : "message-aggregator-status connected";
    status.textContent = `${connection.degraded ? "部分可用" : "连接正常"} · ${connectedSources}/${totalSources} 个源 · 最近 ${connection.messageCount || 0} 条 · ${connection.checkedAt || "-"}`;
  } else if (connection.error) {
    status.className = "message-aggregator-status error";
    status.textContent = connection.error;
  } else {
    status.className = "message-aggregator-status";
    status.textContent = connection.configured ? "已保存，等待下一次统一高频轮次采集" : "等待内置来源首次验证";
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
  const metrics = item.metrics || {};
  const freshness = item.freshness || {};
  const freshnessLabels = {
    live: "实时",
    fresh: "最新",
    recent: "近期",
    today: "当日",
    aging: "较旧",
    stale: "过时",
    unknown: "时间未知"
  };
  const freshnessLevel = Object.hasOwn(freshnessLabels, freshness.level) ? freshness.level : "unknown";
  const freshnessLabel = freshnessLabels[freshnessLevel];
  const freshnessBadgeType = ["live", "fresh"].includes(freshnessLevel)
    ? "ok"
    : freshnessLevel === "stale"
      ? "danger"
      : ["aging", "unknown"].includes(freshnessLevel)
        ? "warn"
        : "";
  const effectiveTimestamp = freshness.effectiveAt || item.occurredAt || item.receivedAt;
  const liveAgeMinutes = effectiveTimestamp
    ? Math.max(0, (Date.now() - new Date(effectiveTimestamp).getTime()) / 60_000)
    : Number(freshness.ageMinutes);
  const timestampMeta = [
    item.occurredAt ? `事件时间 ${fmtTimestamp(item.occurredAt)}` : "",
    item.receivedAt ? `采集时间 ${fmtTimestamp(item.receivedAt)}` : ""
  ]
    .filter(Boolean)
    .join(" | ");
  const freshnessImpact = Number.isFinite(item.rawImpactScore) && Math.abs(item.rawImpactScore - item.impactScore) >= 1
    ? ` | 影响分 ${fmtNumber(item.rawImpactScore, 0)}→${fmtNumber(item.impactScore, 0)}`
    : "";
  const freshnessMeta = `时效分析 ${freshnessLabel} · 已过去 ${fmtAgeMinutes(liveAgeMinutes)} · 时效权重 ${fmtPct(freshness.freshnessWeight, 0)}${freshnessImpact}`;
  const predictionMeta =
    Number.isFinite(metrics.bullProbability) && Number.isFinite(metrics.bearProbability)
      ? `多方隐含概率 ${fmtPct(metrics.bullProbability, 1)} / 空方隐含概率 ${fmtPct(metrics.bearProbability, 1)} | 多空比 ${fmtNumber(metrics.bullBearRatio, 2)} | 较上轮 ${metrics.bullProbabilityDelta >= 0 ? "+" : ""}${fmtPct(metrics.bullProbabilityDelta, 1)}`
      : Array.isArray(metrics.outcomeProbabilities) && metrics.outcomeProbabilities.length === 2
        ? `${metrics.outcomeLabels?.[0] || "结果 A"}隐含概率 ${fmtPct(metrics.outcomeProbabilities[0], 1)} / ${metrics.outcomeLabels?.[1] || "结果 B"}隐含概率 ${fmtPct(metrics.outcomeProbabilities[1], 1)} | 盘口概率比 ${fmtNumber(metrics.outcomeRatio, 2)}`
        : "";
  const monitoringMeta = item.source === "Polymarket"
    ? [
        item.monitoringStatus === "closed" ? "预测已关闭，停止跟踪" : "持续监控中",
        item.monitoringObservations ? `第 ${item.monitoringObservations} 次观测` : "",
        item.monitoringStartedAt ? `始于 ${fmtTimestamp(item.monitoringStartedAt)}` : "",
        item.marketEndDate ? `预计结束 ${fmtTimestamp(item.marketEndDate)}` : ""
      ].filter(Boolean).join(" · ")
    : "";
  const marketDepthMeta = item.source === "Polymarket"
    ? `累计成交量 ${fmtNumber(item.volume, 2)}${item.volumeDelta ? `（本轮 ${item.volumeDelta > 0 ? "+" : ""}${fmtNumber(item.volumeDelta, 2)}）` : ""} | 流动性 ${fmtNumber(item.liquidity, 2)}${item.liquidityDelta ? `（本轮 ${item.liquidityDelta > 0 ? "+" : ""}${fmtNumber(item.liquidityDelta, 2)}）` : ""}`
    : "";
  const storyMeta = [
    item.sourceTier ? `来源等级 T${item.sourceTier}` : "",
    item.corroborationCount > 1 ? `${item.corroborationCount} 个来源交叉佐证` : "",
    metrics.rank ? `热榜第 ${metrics.rank}` : "",
    metrics.rankDelta ? `排名${metrics.rankDelta > 0 ? "上升" : "下降"} ${Math.abs(metrics.rankDelta)}` : ""
  ]
    .filter(Boolean)
    .join(" | ");
  return `
    <div class="row">
      <div>
        <div class="row-title">${escapeHtml(item.source || "-")}</div>
        <div class="row-meta">${text.impact} ${fmtNumber(item.impactScore, 0)} | ${asArray(item.matchedSymbols).join(", ") || text.marketWide}</div>
      </div>
      <div>
        <div>${title}</div>
        ${timestampMeta ? `<div class="row-meta message-time">${escapeHtml(timestampMeta)}</div>` : ""}
        <div class="row-meta message-freshness freshness-${freshnessLevel}">${escapeHtml(freshnessMeta)}</div>
        ${predictionMeta ? `<div class="row-meta">${escapeHtml(predictionMeta)}</div>` : ""}
        ${monitoringMeta ? `<div class="row-meta prediction-monitoring">${escapeHtml(monitoringMeta)}</div>` : ""}
        ${marketDepthMeta ? `<div class="row-meta">${escapeHtml(marketDepthMeta)}</div>` : ""}
        ${predictionMeta ? `<div class="row-meta prediction-disclaimer">盘口价格表示隐含概率，不等于双方实际下注金额占比。</div>` : ""}
        ${storyMeta ? `<div class="row-meta">${escapeHtml(storyMeta)}</div>` : ""}
        ${translatedDetail ? `<div class="row-meta">${escapeHtml(translatedDetail)}</div>` : ""}
      </div>
      <div class="message-badges">${badge(`时效 ${freshnessLabel}`, freshnessBadgeType)}${dir}</div>
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
    .replace(/\bbull=/gi, "多方隐含概率=")
    .replace(/\bbear=/gi, "空方隐含概率=")
    .replace(/\bbullBearRatio=/gi, "多空比=")
    .replace(/\bbullDelta=/gi, "多方概率变化=")
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
  const poisson = advanced.poisson || signal.calculation?.poisson || {};
  const bayesian = advanced.bayesian || signal.calculation?.bayesian || {};
  const gate = item.candidateCalculation?.gate || {};
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
      <div class="calc-grid model-summary-grid">
        ${calcCell(text.latestPrice, fmtPrice(item.latest))}
        ${calcCell(text.eventImpact, fmtNumber(item.eventImpactScore, 0))}
        ${calcCell("HMM 多/空概率", `${fmtPct(hiddenMarkov.bullProbability, 1)} / ${fmtPct(hiddenMarkov.bearProbability, 1)}`)}
        ${calcCell(text.winRate, fmtPct(signal.winRate, 1))}
        ${calcCell("自适应门槛", fmtPct(gate.adaptiveWinRateThreshold, 1))}
        ${calcCell("EV", fmtPct(signal.expectancyPct, 2))}
        ${calcCell(text.modelLeverage, accountControl.modelSuggestedLeverage ? `${fmtNumber(accountControl.modelSuggestedLeverage, 2)}x` : "-")}
      </div>
      <details class="model-details">
        <summary>展开完整计算</summary>
        <div class="calc-grid calc-grid-detail">
          ${calcCell("Math Signal", fmtNumber(item.mathSignal, 4))}
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
          ${calcCell("Poisson事件数", fmtNumber(poisson.observedEvents, 0))}
          ${calcCell("Poisson尾部概率", fmtPct(poisson.tailProbability, 1))}
          ${calcCell("Bayes后验胜率", fmtPct(bayesian.posteriorWinRate, 1))}
          ${calcCell("Bayes调整", fmtPct(bayesian.adjustment, 2))}
          ${calcCell("成本保本胜率", fmtPct(gate.breakEvenWinRate, 1))}
          ${calcCell("门槛不确定性裕量", fmtPct(gate.uncertaintyMargin, 1))}
          ${calcCell("Markowitz权重", fmtPct(markowitz.weight, 1))}
          ${calcCell(text.leverage, accountControl.appliedLeverage ? `${fmtNumber(accountControl.appliedLeverage, 2)}x` : "-")}
        </div>
        <div class="formula">${escapeHtml(buildFormulaText(item))}</div>
      </details>
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
  if (calc.poisson) lines.push(calc.poisson.formula);
  if (calc.bayesian) lines.push(calc.bayesian.formula);
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
  renderMessageAggregatorConnection();
  renderMessages();
  renderWarnings();
  renderModels();
  renderLog();
}

function bindEvents() {
  $("#refreshButton").addEventListener("click", () => loadData().catch(showError));
  for (const selector of ["#messageFilterKeywords", "#messageAggregatorEnabled"]) {
    $(selector).addEventListener("input", () => {
      state.messageAggregatorEditing = true;
      state.messageAggregator = {
        ...(state.messageAggregator || {}),
        error: null,
        errorCode: null
      };
      renderMessageAggregatorConnection();
    });
  }
  $("#messageAggregatorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.messageAggregatorSubmitting) return;
    state.messageAggregatorSubmitting = true;
    renderMessageAggregatorConnection();
    try {
      state.messageAggregator = await postJson("/api/message-aggregator/config", {
        enabled: $("#messageAggregatorEnabled").checked,
        filterKeywords: $("#messageFilterKeywords").value,
        maxItemsPerSource: 15
      });
      state.messageAggregatorEditing = false;
    } catch (error) {
      state.messageAggregator = {
        ...(state.messageAggregator || {}),
        connected: false,
        errorCode: error.code,
        error: error.message
      };
    } finally {
      state.messageAggregatorSubmitting = false;
      renderMessageAggregatorConnection();
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
  $("#postTradeReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.postTradeReviewSubmitting) return;
    state.postTradeReviewSubmitting = true;
    renderAccount();
    try {
      state.account = await postJson("/api/post-trade-review/config", {
        enabled: true,
        reviewEveryTrades: Number($("#reviewEveryTrades").value),
        autoApplyValidatedWeights: $("#reviewAutoApply").checked
      });
      render();
    } catch (error) {
      showError(error);
    } finally {
      state.postTradeReviewSubmitting = false;
      renderAccount();
    }
  });
  $("#applyReviewCandidateButton").addEventListener("click", async () => {
    if (state.postTradeReviewSubmitting) return;
    state.postTradeReviewSubmitting = true;
    renderAccount();
    try {
      state.account = await postJson("/api/post-trade-review/apply");
      render();
    } catch (error) {
      showError(error);
    } finally {
      state.postTradeReviewSubmitting = false;
      renderAccount();
    }
  });
  $("#rollbackReviewWeightsButton").addEventListener("click", async () => {
    if (state.postTradeReviewSubmitting) return;
    state.postTradeReviewSubmitting = true;
    renderAccount();
    try {
      state.account = await postJson("/api/post-trade-review/rollback");
      render();
    } catch (error) {
      showError(error);
    } finally {
      state.postTradeReviewSubmitting = false;
      renderAccount();
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
  $("#accountSummary").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-summary-action="collapse"]') : null;
    if (!target) return;
    state.summaryVisible = false;
    renderAccount();
    $("#summaryButton").focus();
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
