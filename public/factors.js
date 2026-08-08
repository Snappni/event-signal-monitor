import "./beijing-clock.js";
import "./navigation.js";

const state = { data: null, selected: new Set(), dirty: false };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[character]));
const number = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
const time = (value) => value ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
}).format(new Date(value)) : "-";
const evidenceLabels = {
  effective: "当前有效",
  inverse_effective: "反向有效",
  unstable: "不稳定",
  insufficient_samples: "样本不足",
  data_unavailable: "数据不可用"
};
const minedValidationLabels = {
  validated: "已验证",
  rejected: "已拒绝",
  quarantine: "隔离验证"
};

function markDirty() {
  state.dirty = true;
  $("#factorSaveNotice").textContent = "存在未保存的修改；自动刷新已暂停";
}

function filteredFactors() {
  const search = $("#factorSearch").value.trim().toLowerCase();
  const category = $("#factorCategory").value;
  const evidence = $("#factorEvidence").value;
  const showArchived = $("#factorShowArchived").checked;
  return (state.data?.factors || []).filter((factor) => {
    if (factor.archived !== showArchived) return false;
    if (category && factor.category !== category) return false;
    if (evidence && factor.evidenceStatus !== evidence) return false;
    if (search && ![
      factor.name,
      factor.description,
      factor.source,
      factor.category,
      factor.operatorLabel,
      factor.formula,
      factor.id
    ].join(" ").toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderSummary() {
  const data = state.data;
  $("#factorCount").textContent = data.counts.total;
  $("#factorEnabledCount").textContent = data.counts.enabled;
  $("#factorDecisionCount").textContent = `${data.counts.decisionEligible || 0} / ${data.counts.inDecision}`;
  $("#factorMinedCount").textContent = `${data.counts.mined} / ${data.counts.validatedMined}`;
  $("#factorWeightVersion").textContent = `v${data.weightVersion}`;
  $("#factorGeneratedAt").textContent = time(data.generatedAt);
  const history = data.historicalBackfill || {};
  $("#factorRuntimeState").lastChild.textContent = history.status === "complete"
    ? `因子引擎独立运行 · 已回填${history.lookbackMonths || 3}个月历史`
    : "因子引擎独立运行 · 等待历史回填";
  $("#factorLibraryEnabled").checked = data.config.enabled;
  $("#factorIntelligentAdjustment").checked = data.config.intelligentAdjustment;
  $("#factorMiningEnabled").checked = data.config.miningEnabled;
  $("#factorDecisionInfluence").value = Math.round(data.config.decisionInfluence * 100);
  $("#factorMiningActivity").textContent = data.decisionReadiness?.ready
    ? data.mining.currentActivity || "idle"
    : `组合未就绪：${data.counts.decisionEligible || 0}/${data.decisionReadiness?.minimumActiveFactors || 10}`;
  $("#factorMiningDetails").innerHTML = [
    ["运行次数", data.mining.runCount], ["活跃池", `${data.counts.mined}/${data.mining.activeLimit || 20}`],
    ["隔离候选", data.counts.mined - data.counts.validatedMined],
    ["已验证", data.mining.validatedCount], ["已拒绝", data.mining.rejectedCount],
    ["自动淘汰", data.mining.retiredCount || 0],
    ["已合并重复", data.mining.mergedDuplicateCount || 0],
    ["待结算快照", data.pendingFrameCount], ["最近挖掘", time(data.mining.lastRunAt)]
  ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function renderCategories() {
  const selected = $("#factorCategory").value;
  const categories = [...new Set((state.data?.factors || []).map((factor) => factor.category))].sort();
  $("#factorCategory").innerHTML = '<option value="">全部分类</option>' + categories.map((category) =>
    `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
  ).join("");
  $("#factorCategory").value = selected;
}

function renderFactors() {
  const factors = filteredFactors();
  const selectableFactors = factors.filter((factor) => !factor.retired);
  $("#factorFilteredCount").textContent = `${factors.length} 项`;
  $("#factorSelectAll").checked = selectableFactors.length > 0 && selectableFactors.every((factor) => state.selected.has(factor.id));
  $("#factorList").innerHTML = factors.map((factor) => {
    const metric = factor.metrics?.[15];
    const origin = factor.origin === "mined"
      ? `<span class="factor-origin mined">挖掘·${escapeHtml(factor.operatorLabel || "组合")} · ${escapeHtml(factor.retired ? "已淘汰" : minedValidationLabels[factor.validationStatus] || factor.validationStatus)}</span>`
      : '<span class="factor-origin">内置</span>';
    return `<tr data-factor-id="${escapeHtml(factor.id)}" class="${factor.archived ? "is-archived" : ""}">
      <td><input class="factor-select" type="checkbox" ${state.selected.has(factor.id) ? "checked" : ""} ${factor.retired ? "disabled" : ""} aria-label="选择${escapeHtml(factor.name)}" /></td>
      <td><div class="factor-name">${escapeHtml(factor.name)} ${origin}</div><code>${escapeHtml(factor.id)}</code><p>${escapeHtml(factor.description)}</p>${factor.formula ? `<small>${escapeHtml(factor.formula)}</small>` : ""}${factor.retiredAt ? `<small>淘汰于 ${escapeHtml(time(factor.retiredAt))} · 证据已压缩归档且禁止重复挖掘</small>` : ""}</td>
      <td><strong>${escapeHtml(factor.category)}</strong><span>${escapeHtml(factor.source)}</span><small>覆盖 ${(Number(factor.availability?.coverage || 0) * 100).toFixed(0)}%</small></td>
      <td><input class="factor-enabled" type="checkbox" ${factor.enabled ? "checked" : ""} ${factor.archived ? "disabled" : ""} /></td>
      <td><input class="factor-decision" type="checkbox" ${factor.useInDecision ? "checked" : ""} ${factor.archived || factor.role !== "direction" ? "disabled" : ""} /></td>
      <td><input class="factor-weight" type="number" min="0" max="100" step="0.1" value="${escapeHtml(factor.weight)}" ${factor.archived ? "disabled" : ""} /><small>当前决策占比 ${number(factor.effectiveWeight * 100, 1)}%</small></td>
      <td><strong>${number(metric?.meanIc)}</strong><span>ICIR ${number(metric?.icir)}</span><small>n=${metric?.samples || 0} · 历史 ${metric?.historySamples || 0} / 实时 ${metric?.realtimeSamples || 0}</small></td>
      <td><span class="factor-evidence ${escapeHtml(factor.evidenceStatus)}">${escapeHtml(evidenceLabels[factor.evidenceStatus] || factor.evidenceStatus)}</span></td>
    </tr>`;
  }).join("") || '<tr><td colspan="8" class="empty-state">当前筛选条件下没有因子</td></tr>';
}

function render() {
  renderSummary();
  renderCategories();
  renderFactors();
}

async function loadFactors({ quiet = false } = {}) {
  if (quiet && state.dirty) return;
  try {
    const response = await fetch("/api/factors", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render();
    if (!quiet) $("#factorSaveNotice").textContent = "因子状态已刷新";
  } catch (error) {
    $("#factorSaveNotice").textContent = `读取失败：${error.message}`;
  }
}

function factorUpdates() {
  return [...document.querySelectorAll("#factorList tr[data-factor-id]")].map((row) => ({
    id: row.dataset.factorId,
    enabled: row.querySelector(".factor-enabled")?.checked === true,
    useInDecision: row.querySelector(".factor-decision")?.checked === true,
    weight: Number(row.querySelector(".factor-weight")?.value || 0)
  }));
}

async function save(patch = {}) {
  $("#factorSaveNotice").textContent = "正在保存…";
  try {
    const response = await fetch("/api/factors/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("#factorLibraryEnabled").checked,
        intelligentAdjustment: $("#factorIntelligentAdjustment").checked,
        miningEnabled: $("#factorMiningEnabled").checked,
        decisionInfluence: Number($("#factorDecisionInfluence").value || 0) / 100,
        factorUpdates: factorUpdates(),
        ...patch
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    state.data = result;
    state.selected.clear();
    state.dirty = false;
    render();
    $("#factorSaveNotice").textContent = "保存成功；下一轮监控开始使用新配置";
  } catch (error) {
    $("#factorSaveNotice").textContent = `保存失败：${error.message}`;
  }
}

function updateSelected(action) {
  const updates = [...state.selected].map((id) => {
    const factor = state.data.factors.find((item) => item.id === id);
    if (action === "enable") return { id, enabled: true };
    if (action === "decision") return { id, enabled: true, useInDecision: factor?.role === "direction" };
    if (action === "restore") return { id, archived: false };
    return null;
  }).filter(Boolean);
  if (action === "archive") return save({ archiveIds: [...state.selected] });
  return save({ factorUpdates: updates });
}

$("#saveFactorConfig").addEventListener("click", () => save());
$("#refreshButton").addEventListener("click", () => loadFactors());
for (const selector of ["#factorLibraryEnabled", "#factorIntelligentAdjustment", "#factorMiningEnabled", "#factorDecisionInfluence"]) {
  $(selector).addEventListener("change", markDirty);
}
$("#factorDecisionInfluence").addEventListener("input", markDirty);
for (const selector of ["#factorSearch", "#factorCategory", "#factorEvidence", "#factorShowArchived"]) {
  $(selector).addEventListener(selector === "#factorSearch" ? "input" : "change", renderFactors);
}
$("#factorSelectAll").addEventListener("change", (event) => {
  for (const factor of filteredFactors().filter((item) => !item.retired)) event.target.checked ? state.selected.add(factor.id) : state.selected.delete(factor.id);
  renderFactors();
});
$("#factorList").addEventListener("change", (event) => {
  if (event.target.classList.contains("factor-select")) {
    const id = event.target.closest("tr").dataset.factorId;
    event.target.checked ? state.selected.add(id) : state.selected.delete(id);
    const selectableFactors = filteredFactors().filter((factor) => !factor.retired);
    $("#factorSelectAll").checked = selectableFactors.length > 0 && selectableFactors.every((factor) => state.selected.has(factor.id));
    return;
  }
  if (event.target.matches(".factor-enabled, .factor-decision, .factor-weight")) {
    markDirty();
  }
});
$("#factorList").addEventListener("input", (event) => {
  if (event.target.classList.contains("factor-weight")) markDirty();
});
$("#factorBulkEnable").addEventListener("click", () => updateSelected("enable"));
$("#factorBulkDecision").addEventListener("click", () => updateSelected("decision"));
$("#factorBulkArchive").addEventListener("click", () => updateSelected("archive"));
$("#factorBulkRestore").addEventListener("click", () => updateSelected("restore"));

loadFactors();
setInterval(() => loadFactors({ quiet: true }), 5_000);
