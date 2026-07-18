const $ = (selector) => document.querySelector(selector);
let loading = false;
let formDirty = false;
let latestData = null;
let statusNotice = null;

const labels = { eventImpact: "事件影响", trend: "15分钟趋势", higherTimeframeTrend: "1小时趋势", momentum: "动量", rsi: "RSI反转", funding: "资金费率", openInterest: "未平仓量", geometricBrownianMotion: "GBM方向", hiddenMarkovModel: "HMM状态", signalReversal: "信号反转", netExpectancyDecay: "净EV失效", eventDecay: "事件衰减", timeDecay: "自适应时间衰减" };
const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = (value, digits = 2) => `${(number(value) * 100).toFixed(digits)}%`;
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function card(label, value) {
  return `<div class="review-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function setStatusNotice(text, durationMs = 5_000) {
  statusNotice = { text, expiresAt: Date.now() + durationMs };
}

function activeStatusNotice() {
  if (!statusNotice || Date.now() >= statusNotice.expiresAt) {
    statusNotice = null;
    return null;
  }
  return statusNotice.text;
}

async function request(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function promotionBlockerText(latest, config) {
  if (!latest) return "尚未触发复盘。";
  if (latest.applied) return "候选权重已应用到模拟账户。";
  if (latest.promotionEligible) return "候选权重已通过后段样本验证，可以应用。";
  const validation = latest.validation || {};
  const messages = {
    minimum_proposal_trades: `可归因样本未达到生成候选所需的 ${number(config.minimumProposalTrades) || 20} 笔`,
    minimum_promotion_trades: `可归因样本未达到晋升所需的 ${number(config.minimumPromotionTrades) || 60} 笔`,
    minimum_training_samples: "训练样本不足 10 笔",
    minimum_validation_samples: "验证样本不足 10 笔",
    accuracy_delta: `候选准确率提升 ${pct(validation.accuracyDelta, 1)}，未达到 3.0%`,
    mean_signed_margin_delta: `候选有符号边际变化 ${number(validation.meanSignedMarginDelta).toFixed(4)}，必须大于 0`
  };
  const blockerCodes = list(latest.promotionBlockers).slice();
  if (!blockerCodes.length) {
    if (number(latest.eligibleTrades) < (number(config.minimumProposalTrades) || 20)) blockerCodes.push("minimum_proposal_trades");
    else if (!validation.champion) blockerCodes.push("minimum_training_samples");
    else {
      if (number(latest.eligibleTrades) < (number(config.minimumPromotionTrades) || 60)) blockerCodes.push("minimum_promotion_trades");
      if (number(validation.validationSamples) < 10) blockerCodes.push("minimum_validation_samples");
      if (number(validation.accuracyDelta) < 0.03) blockerCodes.push("accuracy_delta");
      if (number(validation.meanSignedMarginDelta) <= 0) blockerCodes.push("mean_signed_margin_delta");
    }
  }
  const blockers = blockerCodes.map((code) => messages[code] || code);
  return blockers.length ? `本轮不迭代：${blockers.join("；")}。` : "本轮候选未满足晋升条件，继续影子观察。";
}

function render(data, { syncForm = !formDirty, statusText = null } = {}) {
  latestData = data;
  const config = data.config || {};
  const reviewState = data.review || {};
  const latest = reviewState.latestReview || null;
  const closed = number(data.closedTrades);
  const reviewed = number(reviewState.reviewedTradeCount);
  const interval = number(config.reviewEveryTrades) || 20;
  const remaining = Math.max(0, interval - Math.max(0, closed - reviewed));
  const openTradeKeys = new Set(
    Array.from(document.querySelectorAll("#reviewTrades details[open][data-detail-key]"), (item) => item.dataset.detailKey)
  );

  if (syncForm) {
    $("#reviewEveryTrades").value = interval;
    $("#reviewAutoApply").checked = config.autoApplyValidatedWeights === true;
  }
  $("#reviewStatus").textContent = statusText || activeStatusNotice() || (latest?.promotionEligible ? "候选已通过验证" : latest ? "影子观察中" : `再完成 ${remaining} 笔触发`);
  $("#reviewStatus").className = `review-status ${latest?.promotionEligible ? "ready" : latest ? "warn" : ""}`;
  $("#reviewDecision").textContent = promotionBlockerText(latest, config);
  $("#reviewForm button[type='submit']").disabled = loading;
  $("#refreshReview").disabled = loading;
  $("#applyCandidate").disabled = loading || !latest?.promotionEligible || latest?.applied;
  $("#rollbackWeights").disabled =
    loading || (!reviewState.previousDirectionWeights && !reviewState.previousExitWeights);
  $("#reviewOverview").innerHTML = [card("累计已平仓", `${closed} 笔`), card("已处理样本", `${reviewed} 笔`), card("方向 / 退出权重", `v${number(reviewState.weightVersion) || 1} / v${number(reviewState.exitWeightVersion) || 1}`), card("最新状态", latest?.status || "暂无复盘")].join("");

  const validation = latest?.validation;
  $("#validationMetrics").innerHTML = validation ? [card("训练样本", validation.trainingSamples), card("验证样本", validation.validationSamples), card("原权重准确率", pct(validation.champion?.accuracy, 1)), card("候选准确率", pct(validation.challenger?.accuracy, 1)), card("准确率变化", pct(validation.accuracyDelta, 1)), card("边际变化", number(validation.meanSignedMarginDelta).toFixed(4))].join("") : '<div class="empty">样本不足，尚未形成训练 / 验证结果。</div>';
  $("#factorRows").innerHTML = list(latest?.factorStatistics).map((item) => `<div class="review-factor-row"><div class="review-factor-name"><strong>${esc(labels[item.factor] || item.factor)}</strong><span>${number(item.activeSamples)}/${number(item.samples)} 笔有效</span></div><div><span class="row-meta">当前</span>${pct(item.currentWeight)}</div><div><span class="row-meta">候选</span>${item.candidateWeight == null ? "-" : pct(item.candidateWeight)}</div><div><span class="row-meta">建议变化</span>${item.candidateWeight == null ? "-" : pct(item.normalizedChangePct)}</div><div><span class="row-meta">方向关联</span>${number(item.directionAssociation).toFixed(3)}</div></div>`).join("") || '<div class="empty">暂无可归因因子统计。</div>';
  const exitValidation = latest?.exitValidation;
  $("#exitValidationMetrics").innerHTML = exitValidation ? [card("训练样本", exitValidation.trainingSamples), card("验证样本", exitValidation.validationSamples), card("原权重准确率", pct(exitValidation.champion?.accuracy, 1)), card("候选准确率", pct(exitValidation.challenger?.accuracy, 1)), card("边际变化", number(exitValidation.meanSignedMarginDelta).toFixed(4))].join("") : card("延迟反事实样本", `${number(latest?.exitEligibleTrades)} 笔`);
  $("#exitFactorRows").innerHTML = list(latest?.exitFactorStatistics).map((item) => `<div class="review-factor-row"><div class="review-factor-name"><strong>${esc(labels[item.factor] || item.factor)}</strong><span>${number(item.activeSamples)}/${number(item.samples)} 笔有效</span></div><div><span class="row-meta">当前</span>${pct(item.currentWeight)}</div><div><span class="row-meta">候选</span>${item.candidateWeight == null ? "-" : pct(item.candidateWeight)}</div><div><span class="row-meta">建议变化</span>${item.candidateWeight == null ? "-" : pct(item.normalizedChangePct)}</div><div><span class="row-meta">反事实关联</span>${number(item.counterfactualCorrelation).toFixed(3)}</div></div>`).join("") || '<div class="empty">新退出规则尚无完成延迟反事实评估的样本。</div>';
  $("#exitReviewDecision").textContent = latest?.exitPromotionEligible ? "退出候选已通过验证" : `退出样本 ${number(latest?.exitEligibleTrades)} 笔，继续影子验证`;
  $("#reviewTrades").innerHTML = list(latest?.trades).slice(-20).reverse().map((trade) => {
    const detailKey = `${trade.symbol || "-"}|${trade.openedAt || "-"}|${trade.closedAt || "-"}`;
    const exitSignals = trade.exitDecision?.signals || {};
    const exitText = trade.exitDecision
      ? `<div>退出评分 ${number(trade.exitDecision.exitScore).toFixed(3)} / 门槛 ${number(trade.exitDecision.threshold).toFixed(3)} · 反转 ${pct(exitSignals.signalReversal, 1)} · 净EV失效 ${pct(exitSignals.netExpectancyDecay, 1)} · 事件衰减 ${pct(exitSignals.eventDecay, 1)} · 时间衰减 ${pct(exitSignals.timeDecay, 1)}</div>`
      : "";
    const counterfactualText = trade.exitCounterfactual?.status === "evaluated"
      ? `<div>延迟反事实：若继续持有，方向收益 ${pct(trade.exitCounterfactual.counterfactualReturnPct)}；本次退出避免收益变化 ${pct(trade.exitCounterfactual.avoidedReturnPct)}</div>`
      : trade.exitCounterfactual?.status === "pending" ? `<div>延迟反事实将在 ${esc(trade.exitCounterfactual.dueAt || "-")} 后评估。</div>` : "";
    return `<details class="review-trade-details" data-detail-key="${esc(detailKey)}"><summary>${esc(trade.symbol || "-")} ${esc(String(trade.side || "").toUpperCase())} · ${number(trade.realizedPnl).toFixed(2)} USDT · ${esc(trade.classification || "-")}</summary><div>时间：${esc(trade.openedAt || "-")} → ${esc(trade.closedAt || "-")} · 原因 ${esc(trade.closeReason || "-")}</div><div>入场 ${number(trade.entry).toPrecision(7)} · 出场 ${number(trade.exitPrice).toPrecision(7)} · TP ${number(trade.takeProfit).toPrecision(7)} · SL ${number(trade.stopLoss).toPrecision(7)}</div><div>预测胜率 ${pct(trade.decision?.predictedWinRate, 1)} · 自适应门槛 ${pct(trade.decision?.adaptiveWinRateThreshold, 1)} · EV ${pct(trade.decision?.predictedExpectancyPct)}</div>${exitText}${counterfactualText}<div class="review-detail-factors">${list(trade.factorContributions).map((item) => `${esc(labels[item.factor] || item.factor)}：信号 ${number(item.signal).toFixed(3)} × 权重 ${pct(item.weight, 1)} = ${number(item.contribution).toFixed(3)}`).join("<br>") || "无因子贡献数据"}</div></details>`;
  }).join("") || '<div class="empty">暂无具备开仓快照的已平仓交易。</div>';
  document.querySelectorAll("#reviewTrades details[data-detail-key]").forEach((item) => {
    if (openTradeKeys.has(item.dataset.detailKey)) item.open = true;
  });
  $("#reviewUpdatedAt").textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}

async function loadReview() {
  if (loading) return;
  loading = true;
  if (latestData) render(latestData, { syncForm: false });
  try {
    const data = await request("/api/post-trade-review");
    loading = false;
    render(data);
  } catch (error) {
    loading = false;
    if (latestData) render(latestData, { syncForm: false, statusText: `读取失败：${error.message}` });
    else $("#reviewStatus").textContent = `读取失败：${error.message}`;
  }
}

async function mutate(url, body, successText, savedConfig = false) {
  if (loading) {
    $("#reviewStatus").textContent = "上一项操作仍在处理中";
    return;
  }
  loading = true;
  if (latestData) render(latestData, { syncForm: false, statusText: "保存中…" });
  try {
    await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const next = await request("/api/post-trade-review");
    loading = false;
    if (savedConfig) formDirty = false;
    setStatusNotice(successText);
    render(next, { syncForm: savedConfig || !formDirty });
  } catch (error) {
    loading = false;
    setStatusNotice(`操作失败：${error.message}`, 8_000);
    if (latestData) render(latestData, { syncForm: false });
    else $("#reviewStatus").textContent = `操作失败：${error.message}`;
  }
}

$("#reviewEveryTrades").addEventListener("input", () => { formDirty = true; });
$("#reviewAutoApply").addEventListener("change", () => { formDirty = true; });
$("#reviewForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = { enabled: true, reviewEveryTrades: number($("#reviewEveryTrades").value), autoApplyValidatedWeights: $("#reviewAutoApply").checked };
  mutate("/api/post-trade-review/config", payload, `设置已保存：每 ${payload.reviewEveryTrades} 笔复盘，自动应用${payload.autoApplyValidatedWeights ? "已开启" : "已关闭"}`, true);
});
$("#applyCandidate").addEventListener("click", () => mutate("/api/post-trade-review/apply", null, "已应用通过验证的候选权重"));
$("#rollbackWeights").addEventListener("click", () => mutate("/api/post-trade-review/rollback", null, "已回滚到上一版权重"));
$("#refreshReview").addEventListener("click", loadReview);
loadReview();
setInterval(loadReview, 15_000);
