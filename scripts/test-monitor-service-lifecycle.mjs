import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const supervisorPath = path.join(__dirname, "supervise-event-signal-service.mjs");
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-signal-service-test-"));
const fakeServicePath = path.join(runtimeDir, "fake-service.mjs");
const startsPath = path.join(runtimeDir, "starts.txt");
const statusPath = path.join(runtimeDir, "service-status.json");

fs.writeFileSync(
  fakeServicePath,
  `import fs from "node:fs";
import path from "node:path";
const runtimeDir = process.env.SIGNAL_RUNTIME_DIR;
const startsPath = path.join(runtimeDir, "starts.txt");
const statusPath = path.join(runtimeDir, "service-status.json");
const starts = Number(fs.existsSync(startsPath) ? fs.readFileSync(startsPath, "utf8") : 0) + 1;
fs.writeFileSync(startsPath, String(starts), "utf8");
const persist = () => {
  const tempPath = statusPath + "." + process.pid + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify({
    mode: "event-driven-hybrid",
    pid: process.pid,
    heartbeatAt: new Date().toISOString()
  }), "utf8");
  fs.renameSync(tempPath, statusPath);
};
persist();
const heartbeat = setInterval(persist, 50);
const stop = () => { clearInterval(heartbeat); process.exit(0); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
if (starts === 1) setTimeout(() => process.exit(7), 100);
`,
  "utf8"
);

function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error("timed out waiting for service lifecycle"));
      setTimeout(poll, 50);
    };
    poll();
  });
}

const env = {
  ...process.env,
  SIGNAL_RUNTIME_DIR: runtimeDir,
  SIGNAL_MONITOR_SERVICE_PATH: fakeServicePath,
  SIGNAL_SERVICE_RESTART_BASE_MS: "100",
  SIGNAL_SERVICE_RESTART_MAX_MS: "250"
};
const supervisor = spawn(process.execPath, [supervisorPath], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "ignore"
});
let replacementSupervisor = null;

try {
  await waitFor(() => fs.existsSync(startsPath) && Number(fs.readFileSync(startsPath, "utf8")) >= 2);
  assert.equal(Number(fs.readFileSync(path.join(runtimeDir, "fast-loop.pid"), "utf8")), supervisor.pid);
  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.ok(status.pid > 0);

  const duplicate = spawnSync(process.execPath, [supervisorPath], {
    cwd: path.resolve(__dirname, ".."),
    env,
    encoding: "utf8",
    timeout: 2_000
  });
  assert.equal(duplicate.status, 0);
  assert.match(duplicate.stdout, /already running/);

  supervisor.kill("SIGTERM");
  await new Promise((resolve) => supervisor.once("exit", resolve));
  replacementSupervisor = spawn(process.execPath, [supervisorPath], {
    cwd: path.resolve(__dirname, ".."),
    env,
    stdio: "ignore"
  });
  await waitFor(
    () =>
      fs.existsSync(path.join(runtimeDir, "fast-loop.pid")) &&
      fs.existsSync(startsPath) &&
      Number(fs.readFileSync(path.join(runtimeDir, "fast-loop.pid"), "utf8")) === replacementSupervisor.pid &&
      Number(fs.readFileSync(startsPath, "utf8")) >= 3
  );
  replacementSupervisor.kill("SIGTERM");
  await new Promise((resolve) => replacementSupervisor.once("exit", resolve));
  console.log("monitor service lifecycle test passed");
} catch (error) {
  const logPath = path.join(runtimeDir, "fast-loop.log");
  if (fs.existsSync(logPath)) process.stderr.write(fs.readFileSync(logPath, "utf8"));
  throw error;
} finally {
  if (supervisor.exitCode === null) supervisor.kill("SIGTERM");
  if (replacementSupervisor?.exitCode === null) replacementSupervisor.kill("SIGTERM");
  try {
    const servicePid = Number(JSON.parse(fs.readFileSync(statusPath, "utf8")).pid);
    process.kill(servicePid, "SIGTERM");
  } catch {
    // The supervised fake service already stopped.
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
