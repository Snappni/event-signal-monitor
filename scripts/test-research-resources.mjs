import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve('.');
const python=process.env.FACTOR_RESEARCH_PYTHON || path.join(root,'.runtime/factor-research-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
// Environment overrides are limited to this test process and its isolated fixtures.
delete process.env.FACTOR_RESEARCH_PROFILE;
for(const script of ['research/test_resource_budget.py','research/test_server_research.py']) {
  const result=spawnSync(python,[script],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
  process.stdout.write(result.stdout || '');process.stderr.write(result.stderr || '');
  assert.equal(result.status,0,script);
}
const runtime=fs.mkdtempSync(path.join(root,'.runtime/resource-contract-'));
process.env.SIGNAL_RUNTIME_DIR=runtime;
process.env.FACTOR_RESEARCH_PYTHON=python;
const lib=await import('./factor-library.mjs');
const hostileEnv={HOME:'/home/admin',FACTOR_RESEARCH_PROFILE:'server-low',SECRET:'do-not-forward',LD_PRELOAD:'proxychains.so',
  PYTHONPATH:'/untrusted',PYTHON_JULIAPKG_EXE:'/julia',FACTOR_RESEARCH_SERVER_PYSR:'ready'};
const launch=lib.buildResearchLaunch('/python',['/supervisor','--root','/path with $literal'], 'fixture',
  {env:hostileEnv,platform:'linux',uid:1000,parentStart:'12345'});
assert.equal(launch.command,'/usr/bin/systemd-run');
assert.equal(launch.unit,'event-signal-research-fixture.service');
for(const flag of ['--user','--wait','--pipe','--collect','--expand-environment=no','MemoryMax=384M','MemorySwapMax=0',
  'CPUQuota=50%','TasksMax=32','RuntimeMaxSec=330','KillMode=control-group','OOMPolicy=kill','FACTOR_RESEARCH_PARENT_START=12345']) assert.ok(launch.args.includes(flag),flag);
assert.deepEqual(launch.args.slice(-4),['/python','/supervisor','--root','/path with $literal']);
assert.ok(launch.args.includes('-i'),'clear manager environment before starting Python');
assert.ok(!JSON.stringify(launch).includes('do-not-forward'));
assert.ok(!JSON.stringify(launch).includes('proxychains.so'));
assert.ok(!JSON.stringify(launch).includes('/untrusted'));
assert.equal(launch.env.DBUS_SESSION_BUS_ADDRESS,'unix:path=/run/user/1000/bus');
for(const platform of ['win32','linux']) {
  const standard=lib.buildResearchLaunch('/python',['/engine'],'fixture',{env:{SECRET:'standard-unchanged'},platform});
  assert.equal(standard.command,'/python');assert.equal(standard.unit,undefined);
  assert.equal(standard.env.SECRET,'standard-unchanged');
}
assert.equal(lib.readFactorResearch().executionProfile,'standard');
const c=lib.normalizeFactorLibraryConfig();
lib.enqueueResearchFrames([{t:1,symbols:{}}],c);
const research=path.join(runtime,'factor-research');
assert.equal(fs.existsSync(path.join(research,'config.json')),false,'capture does not mutate worker settings');
fs.writeFileSync(path.join(research,'worker.lock'),JSON.stringify({pid:process.pid}));
fs.writeFileSync(path.join(research,'config.json'),'frozen');
assert.equal(lib.startFactorResearch(c,'evaluate').reason,'worker_busy');
assert.equal(fs.readFileSync(path.join(research,'config.json'),'utf8'),'frozen');
fs.unlinkSync(path.join(research,'worker.lock'));
const previous='{"generatedAt":1,"factors":{"old":true}}';
fs.writeFileSync(path.join(research,'report.json'),previous);
process.env.FACTOR_RESEARCH_PROFILE='server-low';
assert.equal(lib.readFactorResearch().executionProfile,'server-low');
const start=lib.startFactorResearch(c,'evaluate');
assert.ok(start.started);
for(let i=0;i<200 && lib.readFactorResearch().worker.state==='running';i++) await new Promise(r=>setTimeout(r,50));
const result=lib.readFactorResearch();
assert.equal(result.worker.state,'deferred',JSON.stringify(result.worker));
assert.equal(result.userTask.outcome,'resource_deferred');
assert.ok(result.worker.retryAfter>Date.now()/1000);
assert.equal(fs.readFileSync(path.join(research,'report.json'),'utf8'),previous);
assert.equal(lib.startFactorResearch(c,'evaluate').reason,'resource_cooldown');
const reload=spawnSync(process.execPath,['--input-type=module','-e',"import {readFactorResearch} from './scripts/factor-library.mjs';console.log(JSON.stringify(readFactorResearch().userTask));"],{cwd:root,env:process.env,encoding:'utf8'});
assert.equal(JSON.parse(reload.stdout).outcome,'resource_deferred');
// Force an absent user bus (or missing systemd binary on Windows), never an uncapped fallback.
const failedRuntime=fs.mkdtempSync(path.join(root,'.runtime/user-bus-failure-'));
process.env.SIGNAL_RUNTIME_DIR=failedRuntime;
const platformDescriptor=Object.getOwnPropertyDescriptor(process,'platform');
const uidDescriptor=Object.getOwnPropertyDescriptor(process,'getuid');
try {
  Object.defineProperty(process,'platform',{value:'linux',configurable:true});
  Object.defineProperty(process,'getuid',{value:()=>2147483647,configurable:true});
  lib.enqueueResearchFrames([{t:1,symbols:{}}],c);
  const failedRoot=path.join(failedRuntime,'factor-research');
  fs.writeFileSync(path.join(failedRoot,'report.json'),previous);
  assert.ok(lib.startFactorResearch(c,'evaluate').started);
  for(let i=0;i<200 && lib.readFactorResearch().worker.state==='running';i++) await new Promise(r=>setTimeout(r,50));
  const failed=lib.readFactorResearch().worker;
  assert.equal(failed.state,'deferred',JSON.stringify(failed));
  assert.equal(failed.reason,'research_unit_failed');assert.ok(failed.launcherError);
  assert.ok(failed.retryAfter>Date.now()/1000+330);
  assert.equal(fs.readFileSync(path.join(failedRoot,'report.json'),'utf8'),previous);
  assert.equal(fs.existsSync(path.join(failedRoot,'research.sqlite3')),false,'no fallback numerical process');
  assert.equal(fs.existsSync(path.join(failedRoot,'worker.lock')),false);
} finally {
  Object.defineProperty(process,'platform',platformDescriptor);
  if(uidDescriptor) Object.defineProperty(process,'getuid',uidDescriptor); else delete process.getuid;
  process.env.SIGNAL_RUNTIME_DIR=runtime;
}
fs.writeFileSync(path.join(research,'worker.json'),'{}');
fs.writeFileSync(path.join(research,'worker.lock'),JSON.stringify({pid:process.pid}));
const now=Date.now(), snapshots=[{symbol:'FIXTURE',price:100,values:{return_1m:.1}}];
let run=lib.updateFactorLibraryRuntime({config:c,status:{},snapshots,now:new Date(now).toISOString()});
const attempt=run.status.lastResearchAttemptAt;
assert.ok(attempt);
run=lib.updateFactorLibraryRuntime({config:c,status:run.status,snapshots,now:new Date(now+60_000).toISOString()});
assert.equal(run.status.lastResearchAttemptAt,attempt,'server cadence does not reduce per-minute capture');
assert.equal(run.status.lastCaptureAt,new Date(now+60_000).toISOString());
delete process.env.FACTOR_RESEARCH_PROFILE;
assert.equal(lib.readFactorResearch().executionProfile,'standard');
run=lib.updateFactorLibraryRuntime({config:c,status:run.status,snapshots,now:new Date(now+120_000).toISOString()});
assert.equal(run.status.lastResearchAttemptAt,new Date(now+120_000).toISOString(),'standard cadence unchanged');
fs.unlinkSync(path.join(research,'worker.lock'));
assert.equal(fs.existsSync(path.join(runtime,'paper-account.json')),false);
console.log(JSON.stringify({passed:true,localDefaultUnchanged:true,explicitServerOnly:true,userServiceLaunchContract:true,environmentAllowlist:true,userBusFailureNoFallback:true,configurationFrozen:true,deferredPersisted:true,cooldown:true,oldReportRetained:true,accountUntouched:true,linuxProcessGroupTest:process.platform==='linux'?'executed':'pending_linux'}));
