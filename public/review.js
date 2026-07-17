const $ = (selector) => document.querySelector(selector);
let loading = false;

const labels = { eventImpact: "事件影响", trend: "15分钟趋势", higherTimeframeTrend: "1小时趋势", momentum: "动量", rsi: "RSI反转", funding: "资金费率", openInterest: "未平仓量", geometricBrownianMotion: "GBM方向", hiddenMarkovModel: "HMM状态" };
const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = (value, digits = 2) => `${(number(value) * 100).toFixed(digits)}%`;
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function card(label, value) {
  return `<div class="review-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

async function request(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function render(data) {
  const config = data.config || {};
  const reviewState = data.review || {};
  const latest = reviewState.latestReview || null;
  const closed = number(data.closedTrades);
  const reviewed = number(reviewState.reviewedTradeCount);
  const interval = number(config.reviewEveryTrades) || 20;
  const remaining = Math.max(0, interval - Math.max(0, closed - reviewed));
  $("#reviewEveryTrades").value = interval;
  $("#reviewAutoApply").checked = config.autoApplyValidatedWeights === true;
  $("#reviewStatus").textContent = latest?.promotionEligible ? "候选已通过验证" : latest ? "影子观察中" : `再完成 ${remaining} 笔触发`;
  $("#reviewStatus").className = `review-status ${latest?.promotionEligible ? "ready" : latest ? "warn" : ""}`;
  $("#reviewForm button[type='submit']").disabled = loading;
  $("#refreshReview").disabled = loading;
  $("#applyCandidate").disabled = loading || !latest?.promotionEligible || latest?.applied;
  $("#rollbackWeights").disabled = loading || !reviewState.previousDirectionWeights;
  $("#reviewOverview").innerHTML = [card("累计已平仓", `${closed} 笔`), card("已处理样本", `${reviewed} 笔`), card("权重版本", `v${number(reviewState.weightVersion) || 1}`), card("最新状态", latest?.status || "暂无复盘")].join("");

  const validation = latest?.validation;
  $("#validationMetrics").innerHTML = validation ? [card("训练样本", validation.trainingSamples), card("验证样本", validation.validationSamples), card("原权重准确率", pct(validation.champion?.accuracy, 1)), card("候选准确率", pct(validation.challenger?.accuracy, 1))].join("") : '<div class="empty">样本不足，尚未形成训练 / 验证结果。</div>';
  $("#factorRows").innerHTML = list(latest?.factorStatistics).map((item) => `<div class="review-factor-row"><div class="review-factor-name"><strong>${esc(labels[item.factor] || item.factor)}</strong><span>${number(item.activeSamples)}/${number(item.samples)} 笔有效</span></div><div><span class="row-meta">当前</span>${pct(item.currentWeight)}</div><div><span class="row-meta">候选</span>${item.candidateWeight == null ? "-" : pct(item.candidateWeight)}</div><div><span class="row-meta">建议变化</span>${item.candidateWeight == null ? "-" : pct(item.normalizedChangePct)}</div><div><span class="row-meta">方向关联</span>${number(item.directionAssociation).toFixed(3)}</div></div>`).join("") || '<div class="empty">暂无可归因因子统计。</div>';
  $("#reviewTrades").innerHTML = list(latest?.trades).slice(-20).reverse().map((trade) => `<details class="review-trade-details"><summary>${esc(trade.symbol || "-")} ${esc(String(trade.side || "").toUpperCase())} · ${number(trade.realizedPnl).toFixed(2)} USDT · ${esc(trade.classification || "-")}</summary><div>时间：${esc(trade.openedAt || "-")} → ${esc(trade.closedAt || "-")}</div><div>入场 ${number(trade.entry).toPrecision(7)} · 出场 ${number(trade.exitPrice).toPrecision(7)} · TP ${number(trade.takeProfit).toPrecision(7)} · SL ${number(trade.stopLoss).toPrecision(7)}</div><div>预测胜率 ${pct(trade.decision?.predictedWinRate, 1)} · 自适应门槛 ${pct(trade.decision?.adaptiveWinRateThreshold, 1)} · EV ${pct(trade.decision?.predictedExpectancyPct)}</div><div class="review-detail-factors">${list(trade.factorContributions).map((item) => `${esc(labels[item.factor] || item.factor)}：信号 ${number(item.signal).toFixed(3)} × 权重 ${pct(item.weight, 1)} = ${number(item.contribution).toFixed(3)}`).join("<br>") || "无因子贡献数据"}</div></details>`).join("") || '<div class="empty">暂无具备开仓快照的已平仓交易。</div>';
  $("#reviewUpdatedAt").textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}

async function loadReview() {
  loading = true;
  try {
    const data = await request("/api/post-trade-review");
    loading = false;
    render(data);
  }
  catch (error) { $("#reviewStatus").textContent = `读取失败：${error.message}`; }
  finally { loading = false; }
}

async function mutate(url, body) {
  if (loading) return;
  loading = true;
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const next = await request("/api/post-trade-review");
    loading = false;
    render(next);
  } catch (error) {
    const message = `操作失败：${error.message}`;
    loading = false;
    await loadReview();
    $("#reviewStatus").textContent = message;
  } finally {
    loading = false;
    $("#reviewForm button[type='submit']").disabled = false;
    $("#refreshReview").disabled = false;
  }
}

$("#reviewForm").addEventListener("submit", (event) => { event.preventDefault(); mutate("/api/post-trade-review/config", { enabled: true, reviewEveryTrades: number($("#reviewEveryTrades").value), autoApplyValidatedWeights: $("#reviewAutoApply").checked }); });
$("#applyCandidate").addEventListener("click", () => mutate("/api/post-trade-review/apply"));
$("#rollbackWeights").addEventListener("click", () => mutate("/api/post-trade-review/rollback"));
$("#refreshReview").addEventListener("click", loadReview);
loadReview();
