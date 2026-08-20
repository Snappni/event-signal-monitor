import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const monitorPath = path.join(directory, "event-signal-monitor.mjs");
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "factor-worker-service-test-"));
const statusPath = path.join(runtimeDir, "service-status.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error("timed out waiting for isolated factor history service");
}

function status() {
  return JSON.parse(fs.readFileSync(statusPath, "utf8"));
}

const child = spawn(process.execPath, [monitorPath, "--self-test-factor-history-service-child"], {
  cwd: path.resolve(directory, ".."),
  env: {
    ...process.env,
    SIGNAL_RUNTIME_DIR: runtimeDir,
    SIGNAL_ACTIVE_DECISION_DELAY_MS: "50",
    SIGNAL_IDLE_DECISION_DELAY_MS: "50",
    SIGNAL_DECISION_CYCLE_TIMEOUT_MS: "2000",
    SIGNAL_SERVICE_SHUTDOWN_GRACE_MS: "250"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += String(chunk); });
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  await waitFor(() => {
    if (!fs.existsSync(statusPath)) return false;
    const current = status();
    return current.factorHistoryWorkerRunning === true && Number(current.decisionCycles) >= 1;
  });
  const first = status();
  await waitFor(() => Number(status().decisionCycles) > Number(first.decisionCycles), 1_500);
  const second = status();
  assert.equal(second.factorHistoryWorkerRunning, true);
  assert.notEqual(second.heartbeatAt, first.heartbeatAt, "service heartbeat must advance while history worker hangs");
  assert.ok(
    Number(second.decisionCycles) > Number(first.decisionCycles),
    `decision cycles must advance while history worker hangs: ${JSON.stringify({ first, second })}`
  );
  child.kill("SIGKILL");
  const exit = await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    sleep(3_000).then(() => ({ timeout: true }))
  ]);
  assert.equal(exit.timeout, undefined, "service isolation test process must be terminable");
  assert.equal(exit.signal, "SIGKILL", `unexpected service exit: ${JSON.stringify(exit)} stdout=${stdout} stderr=${stderr}`);
  console.log("factor history service isolation test passed");
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
