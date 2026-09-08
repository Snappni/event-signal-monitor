const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const fmt = (n, digits = 3) => n != null && Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '—';
let data, draft, dirty = false, sorted = false, requestPending = false;
const messages = { manual_active:'手动参与', manual_waiting_data:'已选中，等待完整分层数据', manual_mode:'手动应用，不等待研究发布', collecting:'样本收集中', not_requested:'未申请', research_only_role:'仅研究', validation_failed:'验证未通过', probation_48h_100_labels:'48h / 100标签观察期', eligible:'可发布', no_validated_basket:'尚无合格组合', daily_write_limit:'每日调权限额', basket_ev_failed:'组合净EV未通过' };
async function api(url, body) {
  const r = await fetch(url, body === undefined ? {} : { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
  if (r.status === 401) { window.location.assign('/login.html'); throw new Error('需要登录'); }
  const value = await r.json(); if (!r.ok) throw new Error(value.error || `HTTP ${r.status}`); return value;
}
function markDirty() { dirty=true; $('factorSaveBar').hidden=false; renderMode(); }
function settings() {
  $('factorDecisionMode').value=draft.decisionMode || 'validated';
  $('factorLibraryEnabled').checked=draft.enabled; $('factorAutoGovernanceEnabled').checked=draft.autoGovernanceEnabled;
  $('factorMiningEnabled').checked=draft.miningEnabled; $('factorDecisionInfluence').value=Math.round(draft.decisionInfluence*100);
}
const roleNames={direction:'方向层',risk:'波动／风险层',context:'市场状态层'};
const actionNames={update:'自动采样与研究更新',evaluate:'立即评估',mine:'挖掘多因子表达式'};
const phaseNames={starting:'启动研究环境',ingesting:'写入观测',settling_labels:'生成成熟标签',evaluating_ic:'计算因子IC',qlib_model:'训练与评估Qlib模型',reuse_evaluation:'复用未过期评估',mining_expressions:'搜索多因子表达式',governance:'处理因子应用状态',saving_report:'保存研究结果',completed:'计算完成'};
function renderTask(r) {
  const w=r.worker || {}, task=r.userTask || w, p=task.progress || {}, active=w.state==='running';
  const names={running:'运行中',idle:'已完成',error:'失败',interrupted:'已中断',not_started:'尚未启动'};
  const state=task.outcome==='timed_out'?'已超时':names[task.state] || '等待状态';
  $('factorRuntimeState').textContent=active?'研究计算中':names[w.state] || '等待状态';
  $('researchTaskTitle').textContent=`${actionNames[task.action] || '研究任务'} · ${state}`;
  $('researchTaskIdentity').textContent=task.taskId?`任务编号：${task.taskId} · ${task.requestedBy==='automatic'?'自动触发':'用户触发'}`:'没有已记录的任务';
  $('researchTaskProgress').textContent=task.state==='running'?`阶段：${phaseNames[p.phase] || '等待进程报告阶段'}${p.total!=null?` · ${p.completed ?? 0}/${p.total}`:''}${p.detail?` · ${p.detail}`:''}`:'';
  $('researchTaskTiming').textContent=task.startedAt?`开始：${new Date(task.startedAt).toLocaleString()} · 耗时 ${task.elapsedSeconds || 0} 秒${p.heartbeatAt?` · 最近心跳：${new Date(p.heartbeatAt).toLocaleTimeString()}`:''}${task.finishedAt?` · 结束：${new Date(task.finishedAt).toLocaleString()}`:''}`:'';
  $('researchTaskResult').textContent=task.error || (task.heartbeatStale?'进程仍存在，但超过30秒没有心跳；尚未确认任务正常推进。':task.result?`完成：已结算标签 ${task.result.counts?.matured || 0}${task.action==='mine'?`；挖掘状态 ${task.result.miningStatus || '未知'}；隔离表达式 ${task.result.candidates}`:''}`:'');
  $('researchOtherTask').textContent=active&&w.taskId!==task.taskId?`另有后台任务：${actionNames[w.action] || w.action} · ${phaseNames[w.progress?.phase] || '启动中'}`:'';
  const request=r.lastRequest;
  if(request && !requestPending) $('researchActionState').textContent=request.started?`最近请求已受理，结果见任务面板。` : request.reason==='worker_busy'?`最近的${actionNames[request.requestedAction] || '请求'}未启动：已有任务占用，未排队。` : request.error || request.reason;
  for(const id of ['evaluateResearch','mineResearch']) $(id).disabled=active || requestPending;
}
function renderMode() {
  if(!data || !draft)return;
  const manual=draft.decisionMode==='manual';
  $('factorAutoGovernanceEnabled').disabled=manual;
  $('factorAutoGovernanceEnabled').checked=manual?false:draft.autoGovernanceEnabled;
  $('manualLayerGuide').hidden=!manual;
  $('factorModePolicy').textContent=manual?'手动模式：选中的因子按本层权重直接应用，不要求IC、q值、观察期或研究发布通过。每个标的均须有完整分层数据；缺失层时暂停新开仓，不影响已有持仓退出。':'自动验证流程：手选为申请，仍需统计验证及前向观察；自动治理开启后可自动挑选方向组合。HMM及成交量方向在此流程保持关闭。';
  const layers=Object.entries(roleNames).map(([role,label])=>{
    const selected=data.factors.filter(f=>f.role===role && f.manualSupported!==false && draft.factorSettings[f.id]?.enabled && draft.factorSettings[f.id]?.useInDecision && !draft.factorSettings[f.id]?.archived && draft.factorSettings[f.id]?.weight>0);
    const vol=selected.filter(f=>f.volatilityAnchor).length;
    return {role,label,count:selected.length,ready:selected.length>=1&&(role!=='risk'||vol>=1),vol};
  });
  const ready=layers.every(x=>x.ready)&&draft.decisionInfluence>0;
  $('manualLayerCards').innerHTML=layers.map(x=>`<button type="button" data-layer="${x.role}" class="manual-layer-card ${x.ready?'ready':''}"><strong>${x.label} ${x.ready?'✓':'待补齐'}</strong><span>已选 ${x.count} 个 / 至少1个${x.role==='risk'?`（波动估计 ${x.vol} 个）`:''}</span><small>点击筛选本层，勾选启用与参与判断</small></button>`).join('');
  $('manualLayerMessage').textContent=ready?'配置数量已齐全；保存后直接应用。每个标的仍需要各层有实时有效值，选齐不保证产生订单。':`待补齐：${layers.filter(x=>!x.ready).map(x=>x.label).join('、')}${draft.decisionInfluence<=0?'；方向融合权重须大于0':''}。未完成前不能保存启用的手动方案。`;
  $('saveFactorConfig').disabled=manual&&draft.enabled&&!ready;
  $('factorSaveHint').textContent=manual?'分层配置齐全后保存；直接应用，不等待研究验证':'保存会使旧发布失效，等待新的验证发布';
}
function render() {
  const r=data.research || {}, counts=r.counts || {};
  renderTask(r); renderMode();
  $('factorCount').textContent=data.counts.builtIn;
  $('observationCount').textContent=`${counts.observations || 0} / ${counts.timeBatches || 0}`;
  $('labelCount').textContent=`${counts.matured || 0} / ${counts.pending || 0}`;
  $('factorDecisionCount').textContent=data.counts.inDecision;
  $('factorWeightVersion').textContent=data.weightVersion || '尚未发布';
  $('factorGeneratedAt').textContent=r.evaluatedAt ? new Date(r.evaluatedAt*1000).toLocaleString() : '尚未评估';
  $('researchHealth').textContent=r.error || `排除标签 ${counts.excluded || 0}；中断区间 ${counts.gaps || 0}；${messages[r.publication?.reason] || r.publication?.reason || '尚无发布'}。手续费及滑点是估计；已核验历史按结算资金费处理，实时账本仍需区分。`;
  const model=r.model || {}, mining=r.mining || {};
  $('factorMiningDetails').innerHTML=`<div><strong>Qlib · Ridge研究基线</strong><p>${escape(model.status || '尚未计算')} · 样本外Rank IC ${fmt(model.rankIc)}</p><p>不接管入场概率或账户风控</p></div><div><strong>PySR · 多变量符号回归</strong><p>${escape(mining.status || '未运行')} ${escape(mining.reason || '')} · ${mining.candidates?.length || 0}个隔离表达式</p>${(mining.candidates || []).slice(0,8).map(c=>`<p><code>${escape(c.expression)}</code> · ${escape(c.id)} · 前向IC ${fmt(r.factors?.[c.id]?.metrics?.['60']?.meanIc)}</p>`).join('')}</div>`;
  const horizon=$('factorHorizon').value, term=$('factorSearch').value.toLowerCase(), filter=$('factorEvidence').value;
  let factors=data.factors.filter(f => `${f.name} ${f.id} ${f.description} ${f.formula}`.toLowerCase().includes(term));
  factors=factors.filter(f => !$('factorLayerFilter').value || f.role===$('factorLayerFilter').value);
  factors=factors.filter(f => !filter || (filter==='passed' ? f.eligibility.passed : filter==='active' ? f.actualInDecision : !f.metrics[horizon]));
  if (sorted) factors.sort((a,b) => ((b.metrics[horizon]?.meanIc == null ? -Infinity : Math.abs(b.metrics[horizon].meanIc)))-((a.metrics[horizon]?.meanIc == null ? -Infinity : Math.abs(a.metrics[horizon].meanIc))));
  $('factorFilteredCount').textContent=`${factors.length} 项`;
  $('factorList').innerHTML=factors.map(f => {
    const s=draft.factorSettings[f.id], m=f.metrics[horizon] || {}, blocked=draft.decisionMode==='manual' ? f.manualSupported===false : (f.role!=='direction' || f.governanceOnly || f.id==='hmm_regime_signal' || (f.role==='direction' && f.category==='成交量与成交流'));
    return `<tr data-id="${escape(f.id)}"><td><strong>${escape(f.name)}</strong><small>${escape(f.role)} · ${escape(f.id)}</small><small>${escape(f.formula || f.description)}</small>${draft.decisionMode==='manual'&&f.manualSupported===false?'<small>尚无独立数值输出，不计入分层配置</small>':''}</td><td><input aria-label="启用 ${escape(f.name)}" data-field="enabled" type="checkbox" ${s.enabled?'checked':''} ${(draft.decisionMode!=='manual'&&(f.id==='hmm_regime_signal'||(f.role==='direction'&&f.category==='成交量与成交流')))?'disabled':''}></td><td><input aria-label="交易判断 ${escape(f.name)}" data-field="useInDecision" type="checkbox" ${s.useInDecision?'checked':''} ${blocked?'disabled':''}></td><td><input aria-label="权重 ${escape(f.name)}" data-field="weight" type="number" min="0" max="100" step="0.1" value="${s.weight}"></td><td>${fmt(m.meanIc)}<small>[${fmt(m.lower95)}, ${fmt(m.upper95)}]</small></td><td>${fmt(m.nEff,1)} / ${fmt(m.q)}<small>${m.sameSignFolds ?? 0}/4 同号</small></td><td>${[7,30,90].map(d=>fmt(m.rollingIc?.[d])).join(' / ')}</td><td>${f.actualInDecision?(draft.decisionMode==='manual'?'手动参与':'已发布参与'):escape(messages[f.eligibility.reason] || f.eligibility.reason)}</td></tr>`;
  }).join('');
}
async function refresh() {
  try { data=await api('/api/factors'); if (!dirty) {draft=structuredClone(data.config);settings();} render(); }
  catch(e) { $('factorSaveNotice').textContent=e.message; }
}
$('factorList').addEventListener('change', e => {
  const id=e.target.closest('tr')?.dataset.id, field=e.target.dataset.field; if (!id || !field) return;
  draft.factorSettings[id][field]=field==='weight'?Math.min(100,Math.max(0,Number(e.target.value)||0)):e.target.checked; markDirty();
});
for (const [id,key] of [['factorLibraryEnabled','enabled'],['factorAutoGovernanceEnabled','autoGovernanceEnabled'],['factorMiningEnabled','miningEnabled']]) $(id).addEventListener('change', e=>{draft[key]=e.target.checked;markDirty();});
$('factorDecisionInfluence').addEventListener('change',e=>{draft.decisionInfluence=Math.min(.4,Math.max(0,Number(e.target.value)/100 || 0));markDirty();});
for (const id of ['factorSearch','factorHorizon','factorEvidence','factorLayerFilter']) $(id).addEventListener('input',()=>data&&render());
$('factorIcSort').addEventListener('click',()=>{sorted=!sorted;$('factorIcSort').setAttribute('aria-pressed',String(sorted));render();});
$('refreshButton').addEventListener('click',refresh);
$('discardFactorConfig').addEventListener('click',()=>{dirty=false;$('factorSaveBar').hidden=true;draft=structuredClone(data.config);settings();render();});
$('saveFactorConfig').addEventListener('click',async()=>{
  $('saveFactorConfig').disabled=true;
  try {data=await api('/api/factors/config',draft);draft=structuredClone(data.config);dirty=false;$('factorSaveBar').hidden=true;settings();render();$('factorSaveNotice').textContent='已保存';}
  catch(e){$('factorSaveNotice').textContent=e.message;} finally{renderMode();}
});
$('factorDecisionMode').addEventListener('change',e=>{draft.decisionMode=e.target.value;if(draft.decisionMode==='manual')draft.autoGovernanceEnabled=false;markDirty();render();});
$('manualLayerCards').addEventListener('click',e=>{const role=e.target.closest('[data-layer]')?.dataset.layer;if(role){$('factorLayerFilter').value=role;render();$('factorList').scrollIntoView({block:'start',behavior:'smooth'});}});
for (const [id,action] of [['evaluateResearch','evaluate'],['mineResearch','mine']]) $(id).addEventListener('click',async()=>{
  if(dirty){$('researchActionState').textContent='请先保存设置';return;}
  requestPending=true;renderTask(data.research || {});$('researchActionState').textContent='正在提交任务请求…';
  try{await api('/api/factors/research',{action});}
  catch(e){$('researchTaskResult').textContent=`提交结果未确认：${e.message}。正在查询后台任务状态，请勿重复点击。`;}
  finally{requestPending=false;try{renderTask(await api('/api/factors/research'));}catch(e){$('researchTaskResult').textContent=`状态读取失败：${e.message}`;}}
});
await refresh();
setInterval(async()=>{ if(document.hidden)return; try { const r=await api('/api/factors/research');renderTask(r); } catch(e) { $('researchTaskResult').textContent=`状态读取失败：${e.message}；保留上次结果，不代表任务已停止。`; } },3000);
setInterval(()=>{if(!document.hidden&&!dirty)refresh();},15000);
