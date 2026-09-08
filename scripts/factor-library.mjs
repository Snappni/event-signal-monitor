// Compatibility boundary. Python owns labels, IC, mining and publications.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { FACTOR_DEFINITIONS } from './factor-features.mjs';
export { FACTOR_DEFINITIONS, FACTOR_RESEARCH_REFERENCES, FACTOR_CATALOG_AUDIT, discreteFourierFeatures, buildFactorSnapshots, buildHistoricalFactorFrames } from './factor-features.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = 9;
const VOLATILITY_ANCHORS = new Set(['realized_volatility','parkinson_volatility','garman_klass_volatility','rogers_satchell_volatility','yang_zhang_volatility','downside_semivolatility','upside_semivolatility']);
// These two catalog entries have no standalone numeric feature output.
const NO_MANUAL_VALUE = new Set(['model_bayesian_calibration','model_markowitz_allocator']);
const children = new Set();
function terminateWorker(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
  else child.kill();
}
export function stopFactorResearch() { for (const child of children) terminateWorker(child); }
export const FACTOR_HISTORICAL_SAMPLING_MODE = 'causal_research_v1';
export const DEFAULT_FACTOR_LIBRARY_CONFIG = Object.freeze({ version: VERSION, enabled: true, autoGovernanceEnabled: false, miningEnabled: false, decisionInfluence: .25, evaluationMinutes: 60, miningIntervalMinutes: 1440, captureIntervalSeconds: 60, horizonsMinutes: [5,15,60,240], adjustmentIntervalMinutes: 1440 });
const number = (x, fallback = 0) => x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : fallback;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const researchRoot = () => path.join(path.resolve(process.env.SIGNAL_RUNTIME_DIR || path.join(ROOT, '.runtime/event-signal-monitor')), 'factor-research');
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file);
}
export function normalizeFactorLibraryConfig(raw = {}) {
  raw ||= {};
  const migrated = number(raw.version) < VERSION;
  const decisionMode = raw.decisionMode === 'manual' ? 'manual' : 'validated';
  const factorSettings = Object.fromEntries(FACTOR_DEFINITIONS.map(d => {
    const s = raw.factorSettings?.[d.id] || {};
    const blocked = decisionMode !== 'manual' && (d.id === 'hmm_regime_signal' || (d.role === 'direction' && d.category === '成交量与成交流'));
    return [d.id, { enabled: blocked ? false : s.enabled !== false, archived: s.archived === true,
      useInDecision: !migrated && s.useInDecision === true && !blocked && (decisionMode === 'manual' ? !NO_MANUAL_VALUE.has(d.id) && ['direction','context','risk'].includes(d.role) : !d.governanceOnly && d.role === 'direction'), weight: clamp(number(s.weight, 1), 0, 100) }];
  }));
  return { ...DEFAULT_FACTOR_LIBRARY_CONFIG, enabled: raw.enabled !== false, decisionMode,
    autoGovernanceEnabled: decisionMode !== 'manual' && !migrated && raw.autoGovernanceEnabled === true,
    miningEnabled: raw.miningEnabled === true, intelligentAdjustment: false, autoPromoteMined: false,
    evaluationMinutes: clamp(number(raw.evaluationMinutes, 60), 60, 1440),
    miningIntervalMinutes: clamp(number(raw.miningIntervalMinutes, 1440), 1440, 10080),
    decisionInfluence: clamp(number(raw.decisionInfluence, .25), 0, .4), factorSettings };
}
export function updateFactorLibraryConfig(current, patch = {}) {
  const c = normalizeFactorLibraryConfig(current), settings = { ...c.factorSettings };
  for (const d of FACTOR_DEFINITIONS) if (patch.factorSettings?.[d.id]) settings[d.id] = { ...settings[d.id], ...patch.factorSettings[d.id] };
  return normalizeFactorLibraryConfig({ ...c, ...patch, version: VERSION, factorSettings: settings });
}
export function modelFactorGovernance(value) {
  const c = normalizeFactorLibraryConfig(value);
  return Object.fromEntries(FACTOR_DEFINITIONS.filter(d => d.governanceTarget).map(d => [d.governanceTarget,
    { factorId: d.id, calculated: c.enabled && c.factorSettings[d.id].enabled, useInDecision: false, shadow: true }]));
}
export function createFactorLibraryStatus() {
  return { version: VERSION, engine: FACTOR_HISTORICAL_SAMPLING_MODE, snapshots: [], minedFactors: [], metrics: {}, weightVersion: null, generatedAt: null, research: {}, autoGovernance: { enabled: false } };
}
export function normalizeFactorLibraryStatus(raw = {}) {
  return raw?.version === VERSION && raw.engine === FACTOR_HISTORICAL_SAMPLING_MODE ? { ...createFactorLibraryStatus(), ...raw } : createFactorLibraryStatus();
}
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
function taskStatus(root, task) {
  if (!task?.state) return { state: 'not_started' };
  const progress = read(path.join(root, 'progress.json'));
  const result = { ...task, ...(progress.taskId && progress.taskId === task.taskId ? { progress } : {}) };
  if (task.state === 'running' && !processAlive(task.pid)) return { ...result, state: 'interrupted', outcome: 'interrupted', error: '研究进程已退出，任务未确认完成；可重新启动。' };
  result.elapsedSeconds = Math.max(0, Math.floor(((Date.parse(task.finishedAt) || Date.now()) - Date.parse(task.startedAt)) / 1000)) || 0;
  result.heartbeatStale = task.state === 'running' && Date.now() - (Date.parse(result.progress?.heartbeatAt) || Date.parse(task.startedAt)) > 30000;
  return result;
}
export function readFactorResearch() {
  const root = researchRoot(), report = read(path.join(root, 'report.json')), failure = read(path.join(root, 'error.json'));
  const pointer = read(path.join(root, 'last-user-task.json'));
  const userTask = /^[a-f0-9-]{36}$/.test(pointer.taskId || '') ? taskStatus(root, read(path.join(root, 'tasks', `${pointer.taskId}.json`))) : null;
  return { ...report, worker: taskStatus(root, read(path.join(root, 'worker.json'))), userTask,
    lastRequest: read(path.join(root, 'last-request.json')),
    error: failure.at > (report.generatedAt || 0) ? failure.error : null };
}
function prepare(config) {
  const root = researchRoot(); fs.mkdirSync(path.join(root, 'inbox'), { recursive: true });
  const mined = readFactorResearch().mining?.candidates || [];
  write(path.join(root, 'catalog.json'), [...FACTOR_DEFINITIONS, ...mined.map(c => ({ ...c, role: 'direction', origin: 'mined' }))]); write(path.join(root, 'config.json'), normalizeFactorLibraryConfig(config));
  return root;
}
export function enqueueResearchFrames(frames, config, source = 'live') {
  const root = prepare(config); if (!frames.length) return;
  if (fs.readdirSync(path.join(root, 'inbox')).length >= 5000) throw new Error('research_backlog_full');
  write(path.join(root, 'inbox', `${Date.now()}-${randomUUID()}.json`), { schema: 1, source, frames });
}
export function startFactorResearch(config, action = 'update', { requestedBy = action === 'update' ? 'automatic' : 'user' } = {}) {
  if (!['update', 'evaluate', 'mine'].includes(action)) throw new Error('unknown_research_action');
  const root = prepare(config), lock = path.join(root, 'worker.lock');
  const requestedAt = new Date().toISOString();
  const respond = result => {
    const response = { ...result, requestedAction: action, requestedAt, queued: false };
    if (requestedBy === 'user') write(path.join(root, 'last-request.json'), response);
    return response;
  };
  try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = read(lock);
    if (!Number.isInteger(prior.pid) || prior.pid < 1) return respond({ started: false, reason: 'worker_lock_invalid', error: '任务锁缺少有效进程编号，未启动新任务。' });
    if (processAlive(prior.pid)) return respond({ started: false, reason: 'worker_busy', worker: readFactorResearch().worker });
    // Remove only the stale lock that was actually inspected.
    if (read(lock).pid === prior.pid) fs.unlinkSync(lock);
    return startFactorResearch(config, action, { requestedBy });
  }
  const taskId = randomUUID(), startedAt = requestedAt;
  const taskFile = path.join(root, 'tasks', `${taskId}.json`);
  const python = process.env.FACTOR_RESEARCH_PYTHON || path.join(ROOT, '.runtime/factor-research-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const args = [path.join(ROOT, 'research/engine.py'), '--root', root];
  if (action === 'evaluate') args.push('--evaluate'); if (action === 'mine') args.push('--mine');
  let stderr = '', finished = false, timedOut = false;
  const child = spawn(python, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', FACTOR_RESEARCH_TASK_ID: taskId } });
  children.add(child);
  write(lock, { pid: child.pid || process.pid, taskId });
  const task = { state: 'running', taskId, action, requestedBy, pid: child.pid || process.pid, startedAt };
  const persist = value => { write(taskFile, value); if (read(lock).taskId === taskId) write(path.join(root, 'worker.json'), value); };
  persist(task);
  if (requestedBy === 'user') write(path.join(root, 'last-user-task.json'), { taskId });
  const onExit = () => {
    terminateWorker(child);
    if (!finished && !processAlive(child.pid)) done(null, '启动进程已关闭', 'interrupted');
  };
  process.once('exit', onExit);
  child.stderr.on('data', x => { stderr = (stderr + x.toString()).slice(-8000); });
  const timeout = setTimeout(() => { timedOut = true; terminateWorker(child); }, action === 'mine' ? 30 * 60_000 : 10 * 60_000); timeout.unref();
  const done = (code, error = null, outcome = null) => {
    if (finished) return; finished = true; children.delete(child); clearTimeout(timeout); process.removeListener('exit', onExit);
    const report = read(path.join(root, 'report.json'));
    const miningError = action === 'mine' && report.mining?.status === 'error' ? report.mining.reason : null;
    const success = code === 0 && !miningError && !timedOut;
    const reason = timedOut ? '任务超过运行时限，已停止' : error || miningError || (success ? null : stderr || 'research_worker_failed');
    const progress = read(path.join(root, 'progress.json'));
    persist({ ...task, state: success ? 'idle' : outcome === 'interrupted' ? 'interrupted' : 'error', outcome: outcome || (timedOut ? 'timed_out' : success ? 'completed' : 'failed'),
      code, finishedAt: new Date().toISOString(), error: reason,
      progress: progress.taskId === taskId ? progress : null,
      result: success ? { counts: report.counts, miningStatus: action === 'mine' ? report.mining?.status : undefined, candidates: report.mining?.candidates?.length || 0 } : null });
    if (!success) write(path.join(root, 'error.json'), { at: Date.now() / 1000, taskId, error: reason });
    else if (fs.existsSync(path.join(root, 'error.json'))) fs.unlinkSync(path.join(root, 'error.json'));
    if (read(lock).taskId === taskId) fs.unlinkSync(lock);
  };
  child.once('error', e => done(-1, e.message)); child.once('close', code => done(code));
  return respond({ started: true, taskId, worker: task });
}
export function evaluateMinedAst(ast, values, depth = 0) {
  if (!ast || depth > 15) return null;
  if (ast.op === 'feature') return Number.isFinite(values[ast.id]) ? values[ast.id] : null;
  if (ast.op === 'constant') return Number.isFinite(ast.value) ? ast.value : null;
  if (!Array.isArray(ast.args) || ast.args.length > 15) return null;
  const args = ast.args.map(x => evaluateMinedAst(x, values, depth + 1));
  if (args.some(x => x == null)) return null;
  const result = ast.op === 'add' ? args.reduce((a,b)=>a+b,0) : ast.op === 'mul' ? args.reduce((a,b)=>a*b,1) : ast.op === 'tanh' && args.length === 1 ? Math.tanh(args[0]) : ast.op === 'pow' && args.length === 2 && Number.isInteger(args[1]) && Math.abs(args[1]) <= 8 ? args[0] ** args[1] : null;
  return Number.isFinite(result) ? result : null;
}
export function updateFactorLibraryRuntime({ config, status, snapshots = [], now = new Date().toISOString() }) {
  const c = normalizeFactorLibraryConfig(config), s = normalizeFactorLibraryStatus(status); let error = null;
  if (c.enabled && Date.parse(now) - (Date.parse(s.lastCaptureAt) || 0) >= 60_000 && snapshots.length) {
    try {
      const t = Math.floor(Date.parse(now) / 1000);
      const candidates = readFactorResearch().mining?.candidates || [];
      snapshots = snapshots.map(snapshot => ({ ...snapshot, values: { ...snapshot.values,
        ...Object.fromEntries(candidates.filter(c => t > c.trainedUntil).map(c => [c.id, evaluateMinedAst(c.ast, snapshot.values)])) } }));
      const symbols = Object.fromEntries(snapshots.filter(x => number(x.price) > 0).map(x => [x.symbol, { price: x.price, values: x.values, cost: number(x.roundTripCost, .0016) }]));
      enqueueResearchFrames([{ t, intervalSeconds: 60, symbols }], c); s.lastCaptureAt = now;
      const r = readFactorResearch(), mine = c.miningEnabled && t - (r.mining?.completedAt || 0) >= c.miningIntervalMinutes * 60;
      startFactorResearch(c, mine ? 'mine' : 'update', { requestedBy: 'automatic' });
    } catch (e) { error = e.message; }
  }
  const r = readFactorResearch();
  return { config: c, status: { ...s, snapshots, generatedAt: now, research: r, error, metrics: r.factors || {}, weightVersion: r.publication?.version || null, autoGovernance: { enabled: c.autoGovernanceEnabled }, minedFactors: [] } };
}
export function configDigest(config) {
  const c = normalizeFactorLibraryConfig(config);
  return createHash('sha256').update(JSON.stringify([c.enabled, c.autoGovernanceEnabled, c.decisionInfluence,
    FACTOR_DEFINITIONS.map(d => [d.id, c.factorSettings[d.id].enabled, c.factorSettings[d.id].useInDecision, c.factorSettings[d.id].archived, c.factorSettings[d.id].weight]), ...(c.decisionMode === 'manual' ? ['manual'] : [])])).digest('hex');
}
export function manualFactorReadiness(value, snapshot = null) {
  const c = normalizeFactorLibraryConfig(value);
  const layers = Object.fromEntries(['direction','risk','context'].map(role => {
    const selected = FACTOR_DEFINITIONS.filter(d => d.role === role && c.factorSettings[d.id].enabled && c.factorSettings[d.id].useInDecision && !c.factorSettings[d.id].archived && c.factorSettings[d.id].weight > 0);
    const available = snapshot ? selected.filter(d => Number.isFinite(snapshot.values?.[d.id])) : selected;
    const volatility = available.filter(d => VOLATILITY_ANCHORS.has(d.id)).length;
    return [role, { minimum: 1, selected: selected.length, available: snapshot ? available.length : null,
      volatility, ready: available.length >= 1 && (role !== 'risk' || volatility >= 1) }];
  }));
  return { layers, ready: c.enabled && c.decisionInfluence > 0 && Object.values(layers).every(x => x.ready), mode: c.decisionMode };
}
function publicationFor(config, report, now = Date.now()) {
  if (config.decisionMode === 'manual') {
    if (!config.enabled) return [];
    const selected = FACTOR_DEFINITIONS.filter(d => ['direction','context','risk'].includes(d.role)).filter(d => {
      const s = config.factorSettings[d.id]; return s.enabled && s.useInDecision && !s.archived && s.weight > 0;
    }).map(d => ({ id: d.id, role: d.role, orientation: 1, weight: config.factorSettings[d.id].weight, source: 'manual' }));
    const total = selected.reduce((sum, f) => sum + f.weight, 0);
    return selected.map(f => ({ ...f, weight: f.weight / total }));
  }
  const p = report?.publication;
  if (!config.enabled || !p?.version || p.status !== 'published' || !Array.isArray(p.factors) || !(p.expiresAt * 1000 > now) || p.configHash !== configDigest(config)) return [];
  const valid = p.factors.filter(f => {
    const d = FACTOR_DEFINITIONS.find(d => d.id === f.id), s = config.factorSettings[f.id];
    return d?.role === 'direction' && !d.governanceOnly && s?.enabled && !s.archived && s.weight > 0 && (s.useInDecision || config.autoGovernanceEnabled) && number(f.weight) > 0;
  });
  return valid.length === p.factors.length ? valid : [];
}
export function factorLayerHeadsForSnapshot(snapshot, value, statusValue) {
  const c = normalizeFactorLibraryConfig(value), s = normalizeFactorLibraryStatus(statusValue), published = publicationFor(c, s.research);
  const manualReady = c.decisionMode !== 'manual' || manualFactorReadiness(c,snapshot || {values:{}}).ready;
  return Object.fromEntries(['direction', 'context', 'risk'].map(role => {
    const requested = c.decisionMode === 'manual' ? published.filter(f => f.role === role) : role === 'direction' ? published : [];
    const activeFactors = requested.filter(f => snapshot?.values?.[f.id] != null && Number.isFinite(snapshot.values[f.id])).map(f => ({ ...f, value: snapshot.values[f.id], relativeWeight: f.weight, contribution: (f.id === 'model_garch_risk' && c.decisionMode === 'manual' ? 1 - clamp(snapshot.values[f.id], 0, 1) : clamp(snapshot.values[f.id], -1, 1)) * f.orientation * f.weight }));
    const manual = c.decisionMode === 'manual';
    const sufficient = manualReady && requested.length > 0 && (manual ? activeFactors.length > 0 : activeFactors.length === requested.length);
    if (manual && sufficient) {
      const total = activeFactors.reduce((sum, f) => sum + f.weight, 0);
      for (const f of activeFactors) { f.weight /= total; f.contribution /= total; }
    }
    return [role, { role, activeFactors: sufficient ? activeFactors : [], requestedFactors: requested.length, composite: sufficient ? clamp(activeFactors.reduce((a, f) => a + f.contribution, 0), -1, 1) : 0,
      influence: sufficient ? c.decisionInfluence : 0, strength: sufficient ? 1 : 0, configuredStrength: requested.length ? 1 : 0, confidence: sufficient ? 1 : 0, coverage: requested.length ? activeFactors.length / requested.length : 0, minimumActiveFactors: 1, fullStrengthFactors: 1, sufficient,
      mode: c.decisionMode, frameworkReady: manualReady, missingFactors: requested.filter(f => !activeFactors.some(a => a.id === f.id)).map(f => f.id),
      weightVersion: manual ? `manual-${configDigest(c).slice(0,16)}` : s.weightVersion }];
  }));
}
export const factorDecisionForSnapshot = (snapshot, c, s) => factorLayerHeadsForSnapshot(snapshot, c, s).direction;
export function publicFactorLibrary(value, statusValue) {
  const config = normalizeFactorLibraryConfig(value), status = normalizeFactorLibraryStatus(statusValue);
  const disk = readFactorResearch(), research = disk.generatedAt ? disk : { ...status.research, ...disk };
  const selected = publicationFor(config, research), manual = config.decisionMode === 'manual';
  const selectedIds = new Set(selected.map(f => f.id));
  const ids = manual ? new Set(status.snapshots.flatMap(snapshot => Object.values(factorLayerHeadsForSnapshot(snapshot, config, status)).flatMap(head => head.activeFactors.map(f => f.id)))) : selectedIds;
  const factors = FACTOR_DEFINITIONS.map(d => ({ ...d, ...config.factorSettings[d.id], volatilityAnchor: VOLATILITY_ANCHORS.has(d.id), manualSupported: !NO_MANUAL_VALUE.has(d.id), actualInDecision: ids.has(d.id), configuredForDecision: selectedIds.has(d.id), metrics: research.factors?.[d.id]?.metrics || {},
    eligibility: manual ? { reason: selectedIds.has(d.id) ? (ids.has(d.id) ? 'manual_active' : 'manual_waiting_data') : 'not_requested', passed: research.governance?.[d.id]?.passed || false } : research.governance?.[d.id] || { reason: 'collecting' },
    availability: { coverage: status.snapshots.length ? status.snapshots.filter(s => s.values?.[d.id] != null).length / status.snapshots.length : 0 } }));
  return { config, engine: FACTOR_HISTORICAL_SAMPLING_MODE, factors, research, generatedAt: status.generatedAt,
    weightVersion: manual ? `manual-${configDigest(config).slice(0,16)}` : research.publication?.version || null,
    counts: { builtIn: factors.length, enabled: factors.filter(f => f.enabled).length, selected: selectedIds.size, inDecision: ids.size, modelFactors: factors.filter(f => f.governanceOnly).length, mined: research.mining?.candidates?.length || 0 },
    manualReadiness: manualFactorReadiness(config),
    decisionReadiness: { layers: factorLayerHeadsForSnapshot(status.snapshots[0], config, { ...status, research }) } };
}
