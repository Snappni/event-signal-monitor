// Explicit Linux deployment acceptance only; never runs a numerical worker without server caps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function smokeFrames(now = Date.now()) {
  const t = Math.floor(now/300000)*300 - 60*300;
  return Array.from({ length: 60 }, (_, i) => ({ t: t+i*300, intervalSeconds: 300,
    symbols: Object.fromEntries(['BTC','ETH','SOL','XRP','DOGE','BNB','ADA','LTC'].map((s,j) => [s,
      { price: 100+i*(j+1)/100, values: { return_1m: (j-3)/10 }, cost: .0016 }])) }));
}
if (process.argv.includes('--check-fixture')) {
  for (const now of [1788960335226, 1788960300000, Date.now()]) {
    const frames = smokeFrames(now);
    assert.equal(frames.length,60);
    assert.equal(frames.flatMap(f=>Object.keys(f.symbols)).length,480);
    assert.ok(frames.every(f=>Number.isInteger(f.t) && f.t<now/1000 && f.intervalSeconds===300));
    assert.equal(frames.at(-1).t-frames[0].t,59*300);
    assert.ok(frames.every((f,i)=>!i || f.t-frames[i-1].t===f.intervalSeconds));
    assert.ok(now/1000-frames.at(-1).t>=300 && now/1000-frames.at(-1).t<600);
  }
  console.log(JSON.stringify({passed:true,pastTimestamps:true,intervalSeconds:300,observations:480}));
  process.exit(0);
}
assert.equal(process.platform, 'linux', 'requires Linux user systemd');
assert.equal(process.env.FACTOR_RESEARCH_PROFILE, 'server-low', 'explicit server opt-in required');
assert.ok(process.getuid() > 0, 'run as the production service user, not root');
const healthFile = process.argv[2];
assert.ok(healthFile && path.isAbsolute(healthFile), 'pass absolute production service-status.json path');
const health = () => JSON.parse(fs.readFileSync(healthFile, 'utf8'));
const serviceState = () => {
  const p = spawnSync('/usr/bin/systemctl', ['show', 'event-signal-monitor.service', 'event-signal-dashboard.service',
    '-p', 'Id', '-p', 'MainPID', '-p', 'NRestarts', '-p', 'ActiveState'], { encoding: 'utf8' });
  assert.equal(p.status, 0); return p.stdout.trim();
};
const before = health(), servicesBefore = serviceState();
const runtime = fs.mkdtempSync(path.resolve('.runtime/user-service-smoke-'));
fs.symlinkSync(healthFile, path.join(runtime, 'service-status.json'));
process.env.SIGNAL_RUNTIME_DIR = runtime;
const lib = await import('./factor-library.mjs');
const config = lib.normalizeFactorLibraryConfig();
lib.enqueueResearchFrames(smokeFrames(), config, 'test-fixture');
console.log(`TEST_RUNTIME=${runtime}`);
const busEnv = { ...process.env, XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` };
let peak = 0, events = null, report;
try {
  const start = lib.startFactorResearch(config, 'evaluate');
  assert.equal(start.started, true); assert.ok(start.worker.unit);
  console.log(`RESEARCH_UNIT=${start.worker.unit}`);
  for (let i=0; i<180; i++) {
    await new Promise(r => setTimeout(r, 2000));
    report = lib.readFactorResearch();
    const show = spawnSync('/usr/bin/systemctl', ['--user', 'show', start.worker.unit, '-p', 'ControlGroup', '--value'], {env: busEnv, encoding:'utf8', timeout:3000});
    const group = show.stdout?.trim();
    if (group?.startsWith(`/user.slice/user-${process.getuid()}.slice/`) && group.endsWith('/'+start.worker.unit)) {
      try {
        const cg='/sys/fs/cgroup'+group;
        peak=Math.max(peak,Number(fs.readFileSync(cg+'/memory.peak','utf8')));
        events=Object.fromEntries(fs.readFileSync(cg+'/memory.events','utf8').trim().split('\n').map(line=>{const [k,v]=line.split(' ');return [k,Number(v)];}));
      } catch (e) { if (e.code !== 'ENOENT') throw e; } // --collect may remove the completed cgroup.
    }
    console.log('USER_WORKER_SAMPLE='+JSON.stringify({state:report.worker.state,phase:report.worker.progress?.phase,peakMiB:peak/1048576,events}));
    if (report.worker.state !== 'running') break;
  }
  assert.equal(report.worker.state, 'idle', JSON.stringify(report.worker));
  assert.equal(report.counts.observations, 480);
  const isolation=report.resourcePolicy.isolation;
  assert.equal(isolation.memoryMax,384*1048576);assert.equal(isolation.swapMax,0);
  assert.deepEqual(isolation.cpuMax,[50000,100000]);assert.equal(isolation.tasksMax,32);
  assert.equal(report.publication.status,'shadow');
  assert.ok(!fs.existsSync(path.join(runtime,'paper-account.json')));
  const after=health();
  assert.ok(after.decisionCycles>before.decisionCycles,'production decisions must advance');
  assert.ok(Date.now()-Date.parse(after.heartbeatAt)<15000,'fresh production heartbeat');
  assert.equal(after.consecutiveDecisionFailures,0);
  assert.equal(serviceState(),servicesBefore,'production PID/restarts/state unchanged');
  assert.ok(events && events.oom===0 && events.oom_kill===0,'sampled cgroup must have no OOM');
  console.log('USER_RESEARCH_RESULT='+JSON.stringify({passed:true,isolation,peakMiB:peak/1048576,events,
    observations:report.counts.observations,cyclesBefore:before.decisionCycles,cyclesAfter:after.decisionCycles,productionUnchanged:true}));
} finally { lib.stopFactorResearch(); }
