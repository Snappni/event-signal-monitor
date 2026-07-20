import "./beijing-clock.js";

const $ = (selector) => document.querySelector(selector);
const summaryCharts = new Map();

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency) {
  return `${safeNumber(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${currency}`;
}

function pct(value, digits = 2) {
  return `${(safeNumber(value) * 100).toFixed(digits)}%`;
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

function metric(label, value) {
  return `<div class="account-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function setProgress(percent, label, startedAt) {
  const value = Math.max(0, Math.min(100, percent));
  $("#summaryProgressBar").style.width = `${value}%`;
  $(".progress-track").setAttribute("aria-valuenow", String(value));
  $("#summaryProgressLabel").textContent = label;
  $("#summaryElapsed").textContent = `${Math.round(performance.now() - startedAt)} ms`;
}

function chronological(rows, field) {
  const result = [];
  let previous = -Infinity;
  let ordered = true;
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = Date.parse(row?.[field] || "");
    if (!Number.isFinite(time)) continue;
    if (time < previous) ordered = false;
    previous = time;
    result.push({ ...row, _time: time });
  }
  return ordered ? result : result.sort((left, right) => left._time - right._time);
}

function analyzeAccount(account, summary) {
  const curve = chronological(account?.equityCurve, "time");
  const trades = chronological(account?.tradeHistory, "closedAt");
  const startingCapital = safeNumber(summary?.startingCapital, safeNumber(curve[0]?.equity));
  let peak = startingCapital;
  let maxDrawdown = 0;
  let previousEquity = null;
  let rollingSum = 0;
  let rollingSquareSum = 0;
  const returnWindow = [];
  const performance = [];
  for (const point of curve) {
    const equity = safeNumber(point.equity);
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? equity / peak - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    if (previousEquity > 0) {
      const periodReturn = equity / previousEquity - 1;
      returnWindow.push(periodReturn);
      rollingSum += periodReturn;
      rollingSquareSum += periodReturn ** 2;
      if (returnWindow.length > 30) {
        const removed = returnWindow.shift();
        rollingSum -= removed;
        rollingSquareSum -= removed ** 2;
      }
    }
    previousEquity = equity;
    const rollingMean = returnWindow.length ? rollingSum / returnWindow.length : 0;
    const rollingVariance = returnWindow.length
      ? Math.max(0, rollingSquareSum / returnWindow.length - rollingMean ** 2)
      : 0;
    const rollingStd = Math.sqrt(rollingVariance);
    const rollingSharpe =
      returnWindow.length >= 5 && rollingStd > 0
        ? (rollingMean / rollingStd) * Math.sqrt(returnWindow.length)
        : 0;
    performance.push({
      time: point.time,
      timestamp: point._time,
      equity,
      returnPct: safeNumber(point.returnPct, startingCapital > 0 ? equity / startingCapital - 1 : 0),
      drawdown,
      rollingSharpe
    });
  }

  let wins = 0;
  let winningPnl = 0;
  let losingPnl = 0;
  let predictedWinRateSum = 0;
  let brierSum = 0;
  let cumulativePnl = 0;
  const tradeSeries = [];
  for (const trade of trades) {
    const pnl = safeNumber(trade.realizedPnl);
    const prediction = safeNumber(trade.winRate, safeNumber(trade.decision?.predictedWinRate));
    const won = pnl > 0 ? 1 : 0;
    wins += won;
    winningPnl += Math.max(pnl, 0);
    losingPnl += Math.abs(Math.min(pnl, 0));
    predictedWinRateSum += prediction;
    brierSum += (prediction - won) ** 2;
    cumulativePnl += pnl;
    tradeSeries.push({
      index: tradeSeries.length + 1,
      time: trade.closedAt,
      symbol: trade.symbol || "-",
      side: String(trade.side || "").toUpperCase(),
      result: trade.closeReason || "-",
      realizedPnl: pnl,
      cumulativePnl,
      predictedWinRate: prediction,
      expectancyPct: safeNumber(trade.expectancyPct, safeNumber(trade.decision?.predictedExpectancyPct))
    });
  }
  const fees = safeNumber(summary?.tradingFees);
  const slippage = safeNumber(summary?.slippageCost);
  const funding = safeNumber(summary?.fundingPnl);
  const costDrag = fees + slippage - funding;
  const summaryDrawdown = safeNumber(summary?.maxDrawdownPct, maxDrawdown);
  return {
    performance,
    trades,
    tradeSeries,
    maxDrawdown,
    winRate: trades.length ? wins / trades.length : 0,
    predictedWinRate: trades.length ? predictedWinRateSum / trades.length : 0,
    brier: trades.length ? brierSum / trades.length : 0,
    profitFactor: losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? Infinity : 0,
    costDrag,
    costDragPct: startingCapital > 0 ? costDrag / startingCapital : 0,
    returnDrawdownRatio:
      Math.abs(summaryDrawdown) > 0 ? safeNumber(summary?.finalReturnPct) / Math.abs(summaryDrawdown) : 0,
    costs: [
      { name: "手续费", value: fees, beneficial: false },
      { name: "滑点估算", value: slippage, beneficial: false },
      { name: funding >= 0 ? "资金费收益" : "资金费支出", value: funding, beneficial: funding >= 0 }
    ]
  };
}

function minMaxSample(points, limit = 600) {
  if (points.length <= limit) return points;
  const bucketSize = (points.length - 2) / (limit / 2 - 1);
  const sampled = [points[0]];
  for (let start = 1; start < points.length - 1; start += bucketSize) {
    const end = Math.min(points.length - 1, Math.ceil(start + bucketSize));
    let low = points[Math.floor(start)];
    let high = low;
    for (let index = Math.floor(start) + 1; index < end; index += 1) {
      if (points[index].equity < low.equity) low = points[index];
      if (points[index].equity > high.equity) high = points[index];
    }
    if (low.timestamp < high.timestamp) sampled.push(low, high);
    else if (high !== low) sampled.push(high, low);
    else sampled.push(low);
  }
  sampled.push(points.at(-1));
  return sampled;
}

function disposeSummaryCharts() {
  for (const chart of summaryCharts.values()) {
    if (chart && !chart.isDisposed()) chart.dispose();
  }
  summaryCharts.clear();
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
  summaryCharts.set(id, chart);
}

function emptyGraphic(message) {
  return {
    type: "text",
    left: "center",
    top: "middle",
    style: { text: message, fill: "#728196", fontSize: 13 }
  };
}

function renderPerformanceCharts(analytics, currency) {
  disposeSummaryCharts();
  if (!window.echarts) {
    document.querySelectorAll(".chart-canvas").forEach((node) => {
      node.innerHTML = '<div class="chart-error">图表组件未加载。</div>';
    });
    return;
  }

  const shown = minMaxSample(analytics.performance);
  $("#curveMeta").textContent = `${analytics.performance.length} 个原始点 · ${shown.length} 个绘图点 · 4 张交互图`;
  const times = shown.map((point) => point.time);
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
    graphic: shown.length ? [] : [emptyGraphic("暂无净值数据")],
    xAxis: commonTimeAxis,
    yAxis: [
      { type: "value", scale: true, name: currency, nameTextStyle: { color: "#728196" }, axisLabel: { color: "#728196" }, splitLine },
      { type: "value", name: "收益率", nameTextStyle: { color: "#728196" }, axisLabel: { color: "#728196", formatter: (value) => `${value.toFixed(1)}%` }, splitLine: { show: false } }
    ],
    series: [
      { name: "账户净值", type: "line", showSymbol: false, lineStyle: { color: "#44d3a5", width: 2 }, areaStyle: { color: "rgba(68, 211, 165, 0.08)" }, data: shown.map((point) => point.equity) },
      { name: "累计收益率", type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { color: "#5ea7ff", width: 1.5 }, data: shown.map((point) => point.returnPct * 100) }
    ]
  });

  initSummaryChart("riskChart", {
    ...baseChartOption(),
    graphic: shown.length ? [] : [emptyGraphic("暂无风险数据")],
    xAxis: commonTimeAxis,
    yAxis: [
      { type: "value", name: "回撤", nameTextStyle: { color: "#728196" }, axisLabel: { color: "#728196", formatter: (value) => `${value.toFixed(1)}%` }, splitLine },
      { type: "value", name: "夏普", nameTextStyle: { color: "#728196" }, axisLabel: { color: "#728196" }, splitLine: { show: false } }
    ],
    series: [
      { name: "动态回撤", type: "line", showSymbol: false, lineStyle: { color: "#ff6b6b", width: 1.8 }, areaStyle: { color: "rgba(255, 107, 107, 0.08)" }, data: shown.map((point) => point.drawdown * 100) },
      { name: "滚动夏普（30点）", type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { color: "#f2b84b", width: 1.5 }, data: shown.map((point) => point.rollingSharpe) }
    ]
  });

  const trades = analytics.tradeSeries;
  const tradeLabels = trades.map((trade) => `#${trade.index} ${trade.symbol} ${trade.side}`);
  const tradeBase = baseChartOption();
  initSummaryChart("tradeChart", {
    ...tradeBase,
    graphic: trades.length ? [] : [emptyGraphic("暂无已平仓交易")],
    tooltip: {
      ...tradeBase.tooltip,
      formatter(params) {
        const index = params[0]?.dataIndex ?? 0;
        const trade = trades[index];
        if (!trade) return "";
        return [
          `${escapeHtml(tradeLabels[index])} · ${escapeHtml(trade.result)}`,
          `平仓时间：${escapeHtml(trade.time || "-")}`,
          `单笔净盈亏：${escapeHtml(money(trade.realizedPnl, currency))}`,
          `累计净盈亏：${escapeHtml(money(trade.cumulativePnl, currency))}`,
          `预测胜率：${escapeHtml(pct(trade.predictedWinRate, 1))}`,
          `预测 EV：${escapeHtml(pct(trade.expectancyPct, 2))}`
        ].join("<br>");
      }
    },
    xAxis: { type: "category", data: tradeLabels, axisLine: { lineStyle: { color: "#2a3849" } }, axisTick: { show: false }, axisLabel: { color: "#728196", hideOverlap: true } },
    yAxis: [
      { type: "value", scale: true, name: `单笔 ${currency}`, axisLabel: { color: "#728196" }, splitLine },
      { type: "value", scale: true, name: `累计 ${currency}`, axisLabel: { color: "#728196" }, splitLine: { show: false } }
    ],
    series: [
      { name: "单笔净盈亏", type: "bar", barMaxWidth: 22, data: trades.map((trade) => ({ value: trade.realizedPnl, itemStyle: { color: trade.realizedPnl >= 0 ? "#44d3a5" : "#ff6b6b" } })) },
      { name: "累计净盈亏", type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { color: "#5ea7ff", width: 2 }, data: trades.map((trade) => trade.cumulativePnl) }
    ]
  });

  initSummaryChart("costChart", {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 78, right: 44, top: 18, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#111821", borderColor: "#2a3849", textStyle: { color: "#edf2f7" }, valueFormatter: (value) => money(value, currency) },
    xAxis: { type: "value", axisLabel: { color: "#728196" }, splitLine: { lineStyle: { color: "#202b38", type: "dashed" } } },
    yAxis: { type: "category", data: analytics.costs.map((item) => item.name), axisLine: { lineStyle: { color: "#2a3849" } }, axisTick: { show: false }, axisLabel: { color: "#8d9caf" } },
    series: [{ type: "bar", barMaxWidth: 24, label: { show: true, position: "right", color: "#a5b1c2", formatter: ({ value }) => safeNumber(value).toFixed(2) }, data: analytics.costs.map((item) => ({ value: item.value, itemStyle: { color: item.beneficial ? "#44d3a5" : "#f2b84b" } })) }]
  });
}

function renderTrades(trades, currency) {
  const rows = trades.slice(-20).reverse();
  $("#recentTrades").innerHTML = rows.length ? rows.map((trade) => `
    <div class="summary-trade-row">
      <strong>${escapeHtml(trade.symbol || "-")} ${escapeHtml(String(trade.side || "").toUpperCase())}</strong>
      <span>${escapeHtml(fmtTimestamp(trade.closedAt))}</span>
      <span>${escapeHtml(trade.closeReason || "-")}</span>
      <strong class="${safeNumber(trade.realizedPnl) >= 0 ? "positive" : "negative"}">${escapeHtml(money(trade.realizedPnl, currency))}</strong>
    </div>`).join("") : '<div class="empty">暂无已平仓交易。</div>';
}

async function loadSummary() {
  const startedAt = performance.now();
  const button = $("#refreshSummary");
  button.disabled = true;
  $(".progress-value").classList.remove("failed");
  try {
    setProgress(8, "正在读取账户数据", startedAt);
    const response = await fetch("/api/account/summary", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    setProgress(30, "数据已到达，正在解析", startedAt);
    const data = await response.json();
    await nextPaint();
    setProgress(48, "单次扫描全部净值与交易", startedAt);
    const account = data.account || {};
    const summary = data.summary || account.summary || {};
    const currency = data.config?.quoteCurrency || "USDT";
    const analytics = analyzeAccount(account, summary);
    $("#summaryMetrics").innerHTML = [
      metric("开始时间", fmtTimestamp(summary.startTime)),
      metric("截止时间", fmtTimestamp(summary.endTime)),
      metric("最终收益率", pct(summary.finalReturnPct)),
      metric("最大收益率", pct(summary.maxReturnPct)),
      metric("最大回撤", pct(summary.maxDrawdownPct ?? analytics.maxDrawdown)),
      metric("夏普比率", safeNumber(summary.sharpeRatio).toFixed(3)),
      metric("已平仓笔数", `${safeNumber(summary.closedTrades, analytics.trades.length)} 笔`),
      metric("账户胜率", pct(safeNumber(summary.winRate, analytics.winRate), 1)),
      metric("已实现盈亏", money(summary.realizedPnl, currency)),
      metric("未实现盈亏", money(summary.unrealizedPnl, currency)),
      metric("手续费", money(summary.tradingFees, currency)),
      metric("滑点成本", money(summary.slippageCost, currency)),
      metric("资金费率净额", money(summary.fundingPnl, currency))
    ].join("");
    await nextPaint();
    setProgress(68, "绘制四组限点图表", startedAt);
    renderPerformanceCharts(analytics, currency);
    await nextPaint();
    setProgress(86, "生成交易质量诊断", startedAt);
    $("#qualityMetrics").innerHTML = [
      metric("样本数", `${analytics.trades.length} 笔`),
      metric("实际胜率", pct(analytics.winRate, 1)),
      metric("平均预测胜率", pct(analytics.predictedWinRate, 1)),
      metric("Brier 误差", analytics.brier.toFixed(4)),
      metric("利润因子", Number.isFinite(analytics.profitFactor) ? analytics.profitFactor.toFixed(3) : "∞"),
      metric("成本拖累", `${money(analytics.costDrag, currency)} / ${pct(analytics.costDragPct)}`),
      metric("收益 / 最大回撤", analytics.returnDrawdownRatio.toFixed(3)),
      metric("当前权益", money(account.equity, currency))
    ].join("");
    renderTrades(analytics.trades, currency);
    $("#summaryUpdatedAt").textContent = fmtTimestamp(new Date());
    $("#subtitle").textContent = `账户更新 ${fmtTimestamp(account.updatedAt)}`;
    await nextPaint();
    setProgress(100, "总结已完成", startedAt);
  } catch (error) {
    setProgress(100, `总结失败：${error.message}`, startedAt);
    $(".progress-value").classList.add("failed");
  } finally {
    button.disabled = false;
  }
}

$("#refreshSummary").addEventListener("click", loadSummary);
window.addEventListener("resize", () => {
  for (const chart of summaryCharts.values()) chart.resize();
});
window.addEventListener("beforeunload", disposeSummaryCharts);
loadSummary();
