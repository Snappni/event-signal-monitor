import "./beijing-clock.js";
import "./navigation.js";

const state = { data: null, selected: new Set(), dirty: false, icSort: "default" };
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
const miningAlgorithmLabels = {
  deterministic_typed_beam_search_v1: "确定性类型束搜索 v1",
  deterministic_typed_beam_search_v2: "最多四因子类型束搜索 v2"
};
const icSortModes = {
  default: { label: "默认", next: "desc" },
  desc: { label: "高 → 低", next: "asc" },
  asc: { label: "低 → 高", next: "default" }
};
const factorRoleLabels = { direction: "方向层", context: "情景层", risk: "风险层" };
const decisionChannelLabels = {
  model_direction_path: "方向模型路径",
  model_probability_path: "概率模型路径",
  model_risk_path: "风险模型路径",
  model_sizing_path: "仓位模型路径",
  direction_head: "方向因子头",
  context_head: "情景因子头",
  risk_head: "风险因子头"
};

function setSaveBar({ visible = state.dirty, saving = false, error = "" } = {}) {
  const bar = $("#factorSaveBar");
  bar.hidden = !visible;
  bar.classList.toggle("is-saving", saving);
  bar.classList.toggle("is-error", Boolean(error));
  document.body.classList.toggle("factor-save-bar-visible", visible);
  $("#factorSaveMessage").textContent = error || (saving ? "正在写入因子配置…" : "保存后将在下一轮监控中应用");
  $("#saveFactorConfig").disabled = saving;
  $("#discardFactorConfig").disabled = saving;
  $("#saveFactorConfig").textContent = saving ? "保存中…" : "保存更改";
}

function markDirty() {
  state.dirty = true;
  $("#factorSaveNotice").textContent = "存在未保存的修改；自动刷新已暂停";
  setSaveBar({ visible: true });
}

function discardChanges() {
  state.dirty = false;
  render();
  setSaveBar({ visible: false });
  $("#factorSaveNotice").textContent = "已放弃未保存的修改";
}

function effectiveIcForSort(factor) {
  if (!["effective", "inverse_effective"].includes(factor.evidenceStatus)) return null;
  const value = Number(factor.metrics?.[15]?.meanIc);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

function updateIcSortButton() {
  const mode = icSortModes[state.icSort];
  const button = $("#factorIcSort");
  $("#factorIcSortDirection").textContent = mode.label;
  button.classList.toggle("is-active", state.icSort !== "default");
  button.setAttribute("aria-pressed", String(state.icSort !== "default"));
  button.setAttribute("aria-label", `按有效IC排序：${mode.label}`);
}

function filteredFactors() {
  const search = $("#factorSearch").value.trim().toLowerCase();
  const category = $("#factorCategory").value;
  const evidence = $("#factorEvidence").value;
  const showArchived = $("#factorShowArchived").checked;
  const factors = (state.data?.factors || []).filter((factor) => {
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
  if (state.icSort === "default") return factors;
  const direction = state.icSort === "desc" ? -1 : 1;
  return factors.map((factor, index) => ({ factor, index, value: effectiveIcForSort(factor) }))
    .sort((left, right) => {
      if (left.value == null && right.value == null) return left.index - right.index;
      if (left.value == null) return 1;
      if (right.value == null) return -1;
      return (left.value - right.value) * direction || left.index - right.index;
    })
    .map((item) => item.factor);
}

function renderSummary() {
  const data = state.data;
  $("#factorCount").textContent = `${data.counts.builtIn || 0} / ${data.counts.total}`;
  $("#factorEnabledCount").textContent = data.counts.enabled;
  $("#factorDecisionCount").textContent = `${data.counts.empiricalValidatedBuiltIn || 0} / ${data.counts.decisionEligible || 0}`;
  $("#factorMinedCount").textContent = `${data.counts.mined} / ${data.counts.validatedMined}`;
  $("#factorWeightVersion").textContent = `v${data.weightVersion}`;
  $("#factorGeneratedAt").textContent = time(data.generatedAt);
  const history = data.historicalBackfill || {};
  $("#factorRuntimeState").lastChild.textContent = history.status === "complete"
    ? `因子引擎独立运行 · 已回填${history.lookbackMonths || 3}个月历史`
    : "因子引擎独立运行 · 等待历史回填";
  $("#factorLibraryEnabled").checked = data.config.enabled;
  $("#factorIntelligentAdjustment").checked = data.config.intelligentAdjustment;
  $("#factorAutoGovernanceEnabled").checked = data.config.autoGovernanceEnabled;
  $("#factorMiningEnabled").checked = data.config.miningEnabled;
  $("#factorDecisionInfluence").value = Math.round(data.config.decisionInfluence * 100);
  const readiness = data.decisionReadiness?.layers || {};
  const layerSummary = ["direction", "context", "risk"].map((role) => {
    const layer = readiness[role] || {};
    return `${factorRoleLabels[role]} ${layer.eligibleFactors || 0}/${layer.minimumActiveFactors || 0} · 强度 ${Math.round(Number(layer.strength || 0) * 100)}%`;
  }).join(" · ");
  $("#factorMiningActivity").textContent = data.decisionReadiness?.ready
    ? `${data.mining.currentActivity || "idle"} · ${layerSummary}`
    : `分层未就绪：${layerSummary}`;
  const governance = data.autoGovernance || {};
  $("#factorAutoGovernanceStatus").textContent = data.config.autoGovernanceEnabled
    ? `方向因子自动治理运行 ${governance.runCount || 0} 次 · 最近检查 ${time(governance.lastRunAt)} · 最近切换 ${time(governance.lastActionAt)}`
    : "自动治理未启用；当前只对有平仓反事实证据的方向因子执行自动切换。";
  $("#factorMiningDetails").innerHTML = [
    ["算法", miningAlgorithmLabels[data.mining.algorithm] || data.mining.algorithm || "受限 DSL"], ["运行次数", data.mining.runCount], ["活跃池", `${data.counts.mined}/${data.mining.activeLimit || 20}`],
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
  updateIcSortButton();
  const sortLabel = state.icSort === "default" ? "" : ` · 有效 IC ${icSortModes[state.icSort].label}`;
  $("#factorFilteredCount").textContent = `${factors.length} 项${sortLabel}`;
  $("#factorSelectAll").checked = selectableFactors.length > 0 && selectableFactors.every((factor) => state.selected.has(factor.id));
  $("#factorList").innerHTML = factors.map((factor) => {
    const metric = factor.metrics?.[15];
    const origin = factor.origin === "mined"
      ? `<span class="factor-origin mined">挖掘·${escapeHtml(factor.operatorLabel || "组合")} · ${escapeHtml(factor.retired ? "已淘汰" : minedValidationLabels[factor.validationStatus] || factor.validationStatus)}</span>`
      : `<span class="factor-origin">内置·${factor.governanceOnly ? "模型治理" : factor.empiricalStage === "out_of_sample_validated" ? "样本外通过" : "观察中"}</span>`;
    const holdout = metric?.holdout;
    const holdoutLine = holdout?.hasHoldout
      ? `<small>训练 ${number(holdout.train?.meanIc)} / 验证 ${number(holdout.validation?.meanIc)} / 测试 ${number(holdout.test?.meanIc)}</small>`
      : '<small>尚未形成完整时间样本外切分</small>';
    const referenceId = Array.isArray(factor.referenceIds) ? factor.referenceIds[0] : null;
    const reference = state.data?.researchReferences?.[referenceId];
    const tradeEvidence = factor.autoGovernanceState?.tradeEvidence;
    const governanceLine = factor.autoGovernanceEligible
      ? `<small>自动治理：${escapeHtml(factor.autoGovernanceState?.evidence || "collecting")} · 平仓 n=${tradeEvidence?.overall?.samples || 0} · 贡献R ${number(tradeEvidence?.overall?.meanBenefitR)}</small>`
      : "";
    return `<tr data-factor-id="${escapeHtml(factor.id)}" class="${factor.archived ? "is-archived" : ""}">
      <td><input class="factor-select" type="checkbox" ${state.selected.has(factor.id) ? "checked" : ""} ${factor.retired ? "disabled" : ""} aria-label="选择${escapeHtml(factor.name)}" /></td>
      <td><div class="factor-name">${escapeHtml(factor.name)} ${origin}</div><code>${escapeHtml(factor.id)}</code><p>${escapeHtml(factor.description)}</p>${factor.formula ? `<small>${escapeHtml(factor.formula)}</small>` : ""}${factor.retiredAt ? `<small>淘汰于 ${escapeHtml(time(factor.retiredAt))} · 证据已压缩归档且禁止重复挖掘</small>` : ""}</td>
      <td><strong>${escapeHtml(factor.category)}</strong><span>${escapeHtml(factor.source)}</span><small>层：${escapeHtml(factor.decisionLayer === "probability" ? "概率层" : factor.decisionLayer === "sizing" ? "仓位层" : factorRoleLabels[factor.decisionLayer] || factor.decisionLayer || factorRoleLabels[factor.role] || factor.role)}</small><small>数据：${escapeHtml((factor.dataRequirements || []).join(" + "))}</small><small>覆盖 ${(Number(factor.availability?.coverage || 0) * 100).toFixed(0)}%</small></td>
      <td><input class="factor-enabled" type="checkbox" ${factor.enabled ? "checked" : ""} ${factor.archived ? "disabled" : ""} /></td>
      <td><input class="factor-decision" type="checkbox" ${factor.useInDecision ? "checked" : ""} ${factor.archived ? "disabled" : ""} /><small>${escapeHtml(decisionChannelLabels[factor.decisionChannel] || factorRoleLabels[factor.role] || "仅观察")}</small></td>
      <td><input class="factor-weight" type="number" min="0" max="100" step="0.1" value="${escapeHtml(factor.weight)}" ${factor.archived ? "disabled" : ""} /><small>当前层绝对占比 ${number(factor.effectiveWeight * 100, 1)}%</small></td>
      <td><strong>${number(metric?.meanIc)}</strong><span>ICIR ${number(metric?.icir)}</span><small>n=${metric?.samples || 0} · 历史 ${metric?.historySamples || 0} / 实时 ${metric?.realtimeSamples || 0}</small>${holdoutLine}</td>
      <td><span class="factor-evidence ${escapeHtml(factor.evidenceStatus)}">${escapeHtml(evidenceLabels[factor.evidenceStatus] || factor.evidenceStatus)}</span><small>目录：机制已校验</small>${governanceLine}${reference ? `<small title="${escapeHtml(reference.scope)}">依据：<a href="${escapeHtml(reference.url)}" target="_blank" rel="noreferrer">${escapeHtml(reference.title)}</a></small>` : ""}</td>
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
  setSaveBar({ visible: true, saving: true });
  try {
    const response = await fetch("/api/factors/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("#factorLibraryEnabled").checked,
        intelligentAdjustment: $("#factorIntelligentAdjustment").checked,
        autoGovernanceEnabled: $("#factorAutoGovernanceEnabled").checked,
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
    setSaveBar({ visible: false });
    $("#factorSaveNotice").textContent = "保存成功；下一轮监控开始使用新配置";
  } catch (error) {
    $("#factorSaveNotice").textContent = `保存失败：${error.message}`;
    setSaveBar({ visible: state.dirty, error: `保存失败：${error.message}` });
  }
}

function updateSelected(action) {
  const updates = [...state.selected].map((id) => {
    const factor = state.data.factors.find((item) => item.id === id);
    if (action === "enable") return { id, enabled: true };
    if (action === "decision") return { id, enabled: true, useInDecision: Boolean(factor) };
    if (action === "restore") return { id, archived: false };
    return null;
  }).filter(Boolean);
  if (action === "archive") return save({ archiveIds: [...state.selected] });
  return save({ factorUpdates: updates });
}

$("#saveFactorConfig").addEventListener("click", () => save());
$("#discardFactorConfig").addEventListener("click", discardChanges);
$("#refreshButton").addEventListener("click", () => loadFactors());
$("#factorIcSort").addEventListener("click", () => {
  state.icSort = icSortModes[state.icSort].next;
  renderFactors();
});
for (const selector of ["#factorLibraryEnabled", "#factorIntelligentAdjustment", "#factorAutoGovernanceEnabled", "#factorMiningEnabled", "#factorDecisionInfluence"]) {
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
