import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monitorPath = path.join(__dirname, "event-signal-monitor.mjs");
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-signal-watchdog-test-"));
const statusPath = path.join(runtimeDir, "service-status.json");
const logPath = path.join(runtimeDir, "fast-loop.log");
const runtimeLockPath = path.join(runtimeDir, "run.lock");
const accountLockPath = path.join(runtimeDir, "account.lock");

function runStalledChild() {
  return spawnSync(process.execPath, [monitorPath, "--self-test-decision-watchdog-child"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      SIGNAL_RUNTIME_DIR: runtimeDir,
      SIGNAL_DECISION_CYCLE_TIMEOUT_MS: "250"
    },
    encoding: "utf8",
    timeout: 5_000
  });
}

try {
  const first = runStalledChild();
  assert.equal(first.error, undefined, first.error?.message);
  assert.equal(first.signal, null);
  assert.equal(first.status, 70, `unexpected watchdog exit: stdout=${first.stdout} stderr=${first.stderr}`);

  const firstStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(firstStatus.decisionHealth, "timed_out");
  assert.equal(firstStatus.decisionStage, "self-test-stall");
  assert.equal(firstStatus.decisionCycleTimeoutMs, 250);
  assert.equal(firstStatus.lastDecisionTimeoutMs, 250);
  assert.equal(firstStatus.decisionTimeouts, 1);
  assert.equal(firstStatus.consecutiveDecisionFailures, 1);
  assert.match(firstStatus.lastDecisionError, /decision cycle exceeded 250ms at stage=self-test-stall/);
  assert.ok(firstStatus.lastDecisionTimedOutAt);
  assert.ok(Number(firstStatus.lastDecisionDurationMs) >= 200);
  assert.match(fs.readFileSync(logPath, "utf8"), /exiting code=70 for service restart/);
  assert.equal(JSON.parse(fs.readFileSync(runtimeLockPath, "utf8")).pid, firstStatus.pid);
  assert.equal(JSON.parse(fs.readFileSync(accountLockPath, "utf8")).pid, firstStatus.pid);

  const firstPid = firstStatus.pid;
  const second = runStalledChild();
  assert.equal(second.error, undefined, second.error?.message);
  assert.equal(second.signal, null);
  assert.equal(second.status, 70, `stale service lock blocked restart: ${second.stderr}`);
  const secondStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.notEqual(secondStatus.pid, firstPid);
  assert.equal(secondStatus.decisionHealth, "timed_out");

  console.log("decision cycle watchdog test passed");
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
