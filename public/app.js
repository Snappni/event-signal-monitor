import "./beijing-clock.js";
import "./navigation.js";

const state = {
  report: null,
  status: null,
  log: "",
  account: null,
  summaryVisible: false,
  summaryFetchedAt: null,
  positionView: "open",
  summaryCharts: new Map(),
  positionCharts: new Map(),
  translations: {},
  translationRequestKey: "",
  messageAggregator: null,
  messageAggregatorEditing: false,
  messageAggregatorSubmitting: false,
  accountFormDirty: false,
  postTradeReviewSubmitting: false,
  rawLogVisible: false,
  logCursor: null,
  loadInFlight: false,
  logLoadInFlight: false,
  closeAllPositionsSubmitting: false
};

const $ = (selector) => document.querySelector(selector);
const setText = (selector, value) => {
  const element = $(selector);
  if (element) element.textContent = value;
};

const text = {
  running: "\u8fd0\u884c\u4e2d",
  stopped: "\u672a\u8fd0\u884c",
  opening: "\u5f00\u4ed3\u5019\u9009",
  tracking: "信号结果观察中（最长 72 小时，非仓位）",
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
  notExecutable: "\u672a\u901a\u8fc7\u5f00\u4ed3\u95e8\u69db",
  notApplicable: "\u4e0d\u9002\u7528",
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
  accountRunning: "\u7eb8\u9762\u5f00\u4ed3\u5df2\u542f\u7528",
  accountIdle: "\u7eb8\u9762\u5f00\u4ed3\u5df2\u6682\u505c",
  startAccount: "\u542f\u7528\u7eb8\u9762\u5f00\u4ed3",
  runningAccount: "\u6682\u505c\u7eb8\u9762\u5f00\u4ed3",
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
    "\u7eb8\u9762\u5f00\u4ed3\u5df2\u542f\u7528\uff0c\u76d1\u63a7\u670d\u52a1\u59cb\u7ec8\u72ec\u7acb\u8fd0\u884c\u3002",
  stopped:
    "\u7eb8\u9762\u5f00\u4ed3\u5df2\u6682\u505c\uff1b\u65e2\u6709\u4ed3\u4f4d\u4ecd\u4f1a\u6301\u7eed\u8ddf\u8e2a\u3001\u6b62\u76c8\u6b62\u635f\u548c\u5e73\u4ed3\u3002",
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
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
  return `${formatted}（北京时间 UTC+8）`;
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
  if (state.loadInFlight) return;
  state.loadInFlight = true;
  const view = location.pathname === "/messages.html"
    ? "messages"
    : location.pathname === "/models.html"
      ? "models"
      : location.pathname === "/signals.html"
        ? "signals"
        : location.pathname === "/logs.html"
          ? "logs"
          : "overview";
  try {
    const data = await getJson(`/api/page-data?view=${view}`);
    state.report = data.report || {};
    state.status = data.status || {};
    if (data.log) mergeLogChunk(data.log);
    state.account = data.account || {};
    state.messageAggregator = data.messageAggregator || {};
    render();
    if ($("#messages")) {
      loadMessageTranslations(state.report).catch(() => {
        // Translation failure must not interrupt monitoring or report rendering.
      });
    }
  } finally {
    state.loadInFlight = false;
  }
}

function mergeLogChunk(log) {
  const incoming = String(log?.text || "");
  const cursor = Number(log?.cursor);
  if (state.logCursor === null || log?.reset === true) {
    state.log = incoming;
  } else if (incoming) {
    state.log = `${state.log}${incoming}`.slice(-80_000);
  }
  state.logCursor = Number.isFinite(cursor) && cursor >= 0 ? cursor : null;
}

async function refreshLog() {
  if (state.loadInFlight || state.logLoadInFlight || document.hidden) return;
  state.logLoadInFlight = true;
  try {
    const cursor = Number.isFinite(state.logCursor) ? `&cursor=${state.logCursor}` : "";
    mergeLogChunk(await getJson(`/api/log?bytes=80000${cursor}`));
    renderLog();
  } finally {
    state.logLoadInFlight = false;
  }
}

async function refreshLogStatus() {
  if (document.hidden) return;
  const status = await getJson("/api/status");
  state.status = status;
  if (status.loopLastReportAt) {
    state.report = { ...(state.report || {}), generatedAt: status.loopLastReportAt };
  }
  renderSummary();
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
  const uiCounts = report.uiCounts || {};
  const actionable = asArray(report.actionableSignals);
  const watchlist = asArray(report.watchlist);
  const messages = asArray(report.messageFeed);
  const models = asArray(report.modelCalculations);
  const messageStats = report.messageFeedStats || {};
  const messageTotal = Number(uiCounts.messages ?? messageStats.total ?? sourceCounts.uniqueStories ?? messages.length);
  const displayedMessages = Number(uiCounts.messagesDisplayed ?? messageStats.displayed ?? messages.length);
  const messageLimit = Number(messageStats.limit ?? displayedMessages);
  setText("#subtitle", `${report.mode || "paper-alert-only"} | ${fmtTimestamp(report.generatedAt)}`);
  setText("#pageDataTime", fmtTimestamp(report.generatedAt));
  setText("#layerValue", "事件驱动 + 自适应轮询");
  const session = report.marketSession || {};
  const sessionPolicy = session.policy || {};
  const sessionLabel = sessionPolicy.label || "时段未知";
  setText(
    "#sessionValue",
    `${sessionLabel}${session.overlap ? " · 交会" : ""}${sessionPolicy.strategy ? ` · ${sessionPolicy.strategy}` : ""}`
  );
  setText("#actionableValue", uiCounts.actionable ?? actionable.length);
  setText("#watchValue", uiCounts.watch ?? watchlist.length);
  setText("#messageValue", Number.isFinite(messageTotal) ? messageTotal : messages.length);
  setText(
    "#messageDisplayCount",
    displayedMessages < messageTotal
      ? `当前展示 ${displayedMessages} / 总计 ${messageTotal}（上限 ${messageLimit}）`
      : `当前展示 ${displayedMessages} 条（上限 ${messageLimit}）`
  );
  setText("#modelValue", uiCounts.models ?? models.length);
  const loopStatus = state.status?.loopRunning
    ? `${state.status?.orderFlowConnected ? "订单流已连接" : state.status?.priceConnected ? "行情流已连接" : "决策服务已运行"} · ${text.running}`
    : `事件驱动服务 ${text.stopped}`;
  setText("#loopValue", loopStatus);
  const healthStatus = $("#healthStatus");
  if (healthStatus) {
    healthStatus.classList.toggle("stopped", !state.status?.loopRunning);
    healthStatus.lastChild.textContent = state.status?.loopRunning
      ? state.status?.orderFlowConnected
        ? "订单流监控中"
        : state.status?.priceConnected
          ? "行情流监控中"
        : "决策服务运行中"
      : "监控服务未运行";
  }
  setText("#reportTime", fmtTimestamp(report.generatedAt));
  setText("#sourceCounts", `内置 RSS ${sourceCounts.rss || 0} | 热榜 ${sourceCounts.trend || 0} | GDELT ${sourceCounts.gdelt || 0} | Polymarket ${sourceCounts.polymarket || 0} | 交易所公告 ${(sourceCounts.binanceAnnouncements || 0) + (sourceCounts.okxAnnouncements || 0)} | 合并重复 ${sourceCounts.suppressedDuplicates || 0} | 市场计算 ${sourceCounts.marketAnalyses || 0}`);
  setText("#warningCount", asArray(report.warnings).length);
}

function renderSignals() {
  const target = $("#signals");
  if (!target) return;
  const report = state.report || {};
  const rows = [];
  for (const signal of asArray(report.actionableSignals)) rows.push(signalRow(signal, text.opening, "ok", true));
  for (const signal of asArray(report.activeSignals)) rows.push(signalRow(signal, text.tracking, "warn", true));
  for (const signal of asArray(report.closedSignals)) {
    const outcomeLabel = signal.outcome === "UNRESOLVED_EXPIRED" ? "到期未评估" : signal.outcome || text.closed;
    rows.push(signalRow(signal, outcomeLabel, signal.outcome === "TP" ? "ok" : "danger", true));
  }
  for (const signal of asArray(report.watchlist).slice(0, 6)) rows.push(signalRow(signal, text.watch, "", false));
  target.innerHTML = rows.length ? rows.join("") : `<div class="empty">${text.noSignals}</div>`;
}

function signalRow(signal, label, badgeType, showExecution) {
  const mode = signal.candidateMode === "math_only" ? "math-only" : signal.candidateMode || "-";
  const accountControl = signal.accountControl || {};
  const leverageText = !showExecution
    ? text.notExecutable
    : accountControl.appliedLeverage > 0
      ? accountControl.leverageRuleExact
        ? `${fmtNumber(accountControl.appliedLeverage, 0)}x / 币安档位 ${fmtNumber(accountControl.maxLeverage, 0)}x`
        : `${fmtNumber(accountControl.appliedLeverage, 0)}x（模拟，账户档位未验证）`
      : accountControl.blockReason || "-";
  const notionalText = showExecution
    ? fmtMoney(accountControl.notional, accountControl.quoteCurrency || "USDT")
    : text.notApplicable;
  const adaptiveGateText = Number.isFinite(Number(signal.adaptiveWinRateThreshold))
    ? `${fmtPct(signal.adaptiveWinRateThreshold, 1)} / 保本 ${fmtPct(signal.breakEvenWinRate, 1)}`
    : "旧信号未记录";
  const lifecycleText = signal.closedAt
    ? `结束时间 ${fmtTimestamp(signal.closedAt)}`
    : signal.expiresAt
      ? `观察截止 ${fmtTimestamp(signal.expiresAt)}`
      : signal.createdAt
        ? `信号时间 ${fmtTimestamp(signal.createdAt)}`
        : "";
  return `
    …15849 tokens truncated…g">${escapeHtml(monitoringMeta)}</div>` : ""}
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
  const target = $("#warnings");
  if (!target) return;
  const warnings = asArray(state.report?.warnings);
  target.innerHTML = warnings.length
    ? warnings.slice(0, 24).map((warning) => `<div class="row"><div>${escapeHtml(translateWarning(warning))}</div></div>`).join("")
    : `<div class="empty">${text.noWarnings}</div>`;
}

function renderModels() {
  const target = $("#models");
  if (!target) return;
  const dataset = state.report?.signalOutcomeDataset || {};
  const training = dataset.training || {};
  const validation = dataset.validation || {};
  const calibration = $("#signalCalibration");
  if (calibration) {
    calibration.innerHTML = [
      calcCell("活动观察窗", `${fmtNumber(dataset.observationWindowHours, 0)} 小时`),
      calcCell("紧凑结果集", `${fmtNumber(dataset.storedSamples, 0)} / ${fmtNumber(dataset.historyLimit, 0)}`),
      calcCell("可校准 / 未评估", `${fmtNumber(dataset.eligibleSamples, 0)} / ${fmtNumber(dataset.unresolvedSamples, 0)}`),
      calcCell("训练 / 验证样本", `${fmtNumber(training.samples, 0)} / ${fmtNumber(validation.samples, 0)}`),
      calcCell("训练实际胜率 / 平均 R", `${fmtPct(training.winRate, 1)} / ${fmtNumber(training.avgRealizedR, 3)}`),
      calcCell("验证实际胜率 / 平均 R", `${fmtPct(validation.winRate, 1)} / ${fmtNumber(validation.avgRealizedR, 3)}`),
      calcCell("训练 Brier", training.brierScore == null ? "-" : fmtNumber(training.brierScore, 4)),
      calcCell("验证 Brier", validation.brierScore == null ? "-" : fmtNumber(validation.brierScore, 4))
    ].join("");
  }
  const openDetails = new Set(
    Array.from(document.querySelectorAll("#models details.model-details[open][data-detail-key]"), (item) => item.dataset.detailKey)
  );
  const models = asArray(state.report?.modelCalculations);
  target.innerHTML = models.length ? models.slice(0, 20).map(modelRow).join("") : `<div class="empty">${text.noModel}</div>`;
  document.querySelectorAll("#models details.model-details[data-detail-key]").forEach((item) => {
    if (openDetails.has(item.dataset.detailKey)) item.open = true;
  });
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
        ${calcCell(text.modelLeverage, accountControl.modelSuggestedLeverage ? `${fmtNumber(accountControl.modelSuggestedLeverage, 0)}x` : "-")}
      </div>
      <details class="model-details" data-detail-key="${escapeHtml(item.symbol || "-")}">
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
          ${calcCell(text.leverage, accountControl.appliedLeverage ? `${fmtNumber(accountControl.appliedLeverage, 0)}x` : "-")}
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
  const target = $("#logView");
  if (!target) return;
  const followTail = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
  const lines = String(state.log || "").split("\n");
  const mojibakePattern = /(鍛婅|锛氫|妯℃嫙|浜嬩欢淇|鐩戞帶|寮曟搸|鏃犺瘉鎹)/;
  const corruptedLines = lines.filter((line) => mojibakePattern.test(line)).length;
  const cleanLog = lines
    .filter((line) => !mojibakePattern.test(line))
    .join("\n")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, (value) => fmtTimestamp(value));
  target.textContent = state.rawLogVisible ? state.log || text.noLog : cleanLog || text.noLog;
  if (followTail) target.scrollTop = target.scrollHeight;
  setText(
    "#logNotice",
    corruptedLines
      ? `检测到 ${corruptedLines} 行历史乱码，清晰视图已隐藏；时间显示为北京时间 UTC+8`
      : "清晰视图时间：北京时间 UTC+8"
  );
  setText("#toggleRawLog", state.rawLogVisible ? "隐藏历史乱码" : "显示原始日志");
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
  $("#refreshButton")?.addEventListener("click", () => loadData().catch(showError));
  $("#toggleRawLog")?.addEventListener("click", () => {
    state.rawLogVisible = !state.rawLogVisible;
    renderLog();
  });
  const messageForm = $("#messageAggregatorForm");
  if (messageForm) {
    for (const selector of ["#messageFilterKeywords", "#messageAggregatorEnabled"]) {
      $(selector)?.addEventListener("input", () => {
        state.messageAggregatorEditing = true;
        state.messageAggregator = {
          ...(state.messageAggregator || {}),
          error: null,
          errorCode: null
        };
        renderMessageAggregatorConnection();
      });
    }
    messageForm.addEventListener("submit", async (event) => {
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
  }
  const accountForm = $("#accountForm");
  for (const eventName of ["input", "change"]) {
    accountForm?.addEventListener(eventName, () => {
      state.accountFormDirty = true;
    });
  }
  accountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.account = await postJson("/api/account", getAccountFormPayload());
      state.accountFormDirty = false;
      render();
      $("#accountSummary")?.insertAdjacentHTML("afterbegin", `<div class="notice">${text.saved}</div>`);
    } catch (error) {
      showError(error);
    }
  });
  $("#postTradeReviewForm")?.addEventListener("submit", async (event) => {
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
  $("#applyReviewCandidateButton")?.addEventListener("click", async () => {
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
  $("#rollbackReviewWeightsButton")?.addEventListener("click", async () => {
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
  $("#resetAccountButton")?.addEventListener("click", async () => {
    try {
      state.account = await postJson("/api/account/reset");
      state.accountFormDirty = false;
      render();
      $("#accountSummary")?.insertAdjacentHTML("afterbegin", `<div class="notice">${text.reset}</div>`);
    } catch (error) {
      showError(error);
    }
  });
  $("#startAccountButton")?.addEventListener("click", async () => {
    const button = $("#startAccountButton");
    button.disabled = true;
    try {
      const accountActive = getAccountBundle().account.isActive === true;
      state.account = accountActive
        ? await postJson("/api/account/stop")
        : await postJson("/api/account/start", getAccountFormPayload());
      if (!accountActive) state.accountFormDirty = false;
      render();
      $("#accountSummary")?.insertAdjacentHTML(
        "afterbegin",
        `<div class="notice">${accountActive ? text.stopped : text.started}</div>`
      );
    } catch (error) {
      button.disabled = false;
      showError(error);
    }
  });
  $("#closeAllPositionsButton")?.addEventListener("click", async () => {
    const openCount = Object.keys(getAccountBundle().account.positions || {}).length;
    if (!openCount || state.closeAllPositionsSubmitting) return;
    if (!window.confirm(`确认按当前模拟价格平掉全部 ${openCount} 个纸面仓位？该操作不会暂停后续纸面开仓。`)) return;
    state.closeAllPositionsSubmitting = true;
    renderAccount();
    try {
      const result = await postJson("/api/account/close-all");
      state.account = result;
      state.positionView = "closed";
      render();
      const closedCount = Number(result.closeResult?.closedCount || 0);
      const failedCount = Number(result.closeResult?.failedCount || 0);
      $("#accountSummary")?.insertAdjacentHTML(
        "afterbegin",
        `<div class="notice">已手动平仓 ${closedCount} 个纸面仓位${failedCount ? `，${failedCount} 个失败并保持未平仓` : ""}。</div>`
      );
    } catch (error) {
      showError(error);
    } finally {
      state.closeAllPositionsSubmitting = false;
      renderAccount();
    }
  });
  $("#summaryButton")?.addEventListener("click", async () => {
    window.location.href = "/summary.html";
  });
  $("#accountSummary")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-summary-action="collapse"]') : null;
    if (!target) return;
    state.summaryVisible = false;
    renderAccount();
    $("#summaryButton").focus();
  });
  $("#accountMarketType")?.addEventListener("change", () => {
    const spot = $("#accountMarketType").value === "spot";
    const leverageInput = $("#accountMaxLeverage");
    if (spot) {
      if (!leverageInput.disabled) leverageInput.dataset.futuresValue = leverageInput.value;
      leverageInput.value = 1;
    } else {
      const { config } = getAccountBundle();
      leverageInput.value = leverageInput.dataset.futuresValue || config.maxLeverage || 3;
    }
    leverageInput.disabled = spot;
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
  const target = $("#pageError") || $("#signals") || $("#messages") || $("#models") || $("#logView");
  if (target) target.innerHTML = `<div class="empty">${text.readFailed}\uff1a${escapeHtml(error.message)}</div>`;
}

bindEvents();
window.addEventListener("resize", () => {
  for (const chart of state.summaryCharts.values()) {
    if (chart && !chart.isDisposed()) chart.resize();
  }
  for (const chart of state.positionCharts.values()) {
    if (chart && !chart.isDisposed()) chart.resize();
  }
});
loadData().catch(showError);
const pagePath = location.pathname;
if (pagePath === "/logs.html") {
  setInterval(() => refreshLog().catch(showError), 1_000);
  setInterval(() => refreshLogStatus().catch(showError), 5_000);
} else {
  const refreshIntervalMs = pagePath === "/messages.html"
    ? 15_000
    : ["/", "/index.html"].includes(pagePath)
      ? 1_000
      : 3_000;
  setInterval(() => {
    if (!document.hidden) loadData().catch(showError);
  }, refreshIntervalMs);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const refresh = pagePath === "/logs.html" ? refreshLog : loadData;
  refresh().catch(showError);
});

