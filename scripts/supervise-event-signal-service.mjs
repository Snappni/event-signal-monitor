#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.resolve(
  process.env.SIGNAL_RUNTIME_DIR || path.join(ROOT_DIR, ".runtime", "event-signal-monitor")
);
const PID_PATH = path.join(RUNTIME_DIR, "fast-loop.pid");
const LOG_PATH = path.join(RUNTIME_DIR, "fast-loop.log");
const SERVICE_PATH = path.resolve(
  process.env.SIGNAL_MONITOR_SERVICE_PATH || path.join(__dirname, "event-signal-monitor.mjs")
);
const RESTART_BASE_MS = Math.max(100, Number(process.env.SIGNAL_SERVICE_RESTART_BASE_MS || 1_000));
const RESTART_MAX_MS = Math.max(RESTART_BASE_MS, Number(process.env.SIGNAL_SERVICE_RESTART_MAX_MS || 30_000));

let child = null;
let restartTimer = null;
let restartDelayMs = RESTART_BASE_MS;
let stopping = false;

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function appendLog(message) {
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function acquireSupervisorPid() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(PID_PATH, "wx");
      fs.writeFileSync(fd, String(process.pid), "utf8");
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existingPid = Number(fs.readFileSync(PID_PATH, "utf8").trim());
      if (isProcessRunning(existingPid)) {
        console.log(`Event monitor supervisor already running pid=${existingPid}`);
        return false;
      }
      fs.rmSync(PID_PATH, { force: true });
    }
  }
  return false;
}

function releaseSupervisorPid() {
  try {
    if (Number(fs.readFileSync(PID_PATH, "utf8").trim()) === process.pid) {
      fs.rmSync(PID_PATH, { force: true });
    }
  } catch {
    // The stop command may already have removed the pid file.
  }
}

function scheduleRestart(startedAt, code, signal) {
  if (stopping) {
    releaseSupervisorPid();
    return;
  }
  const lifetimeMs = Date.now() - startedAt;
  if (lifetimeMs >= 30_000) restartDelayMs = RESTART_BASE_MS;
  const delayMs = restartDelayMs;
  restartDelayMs = Math.min(RESTART_MAX_MS, restartDelayMs * 2);
  appendLog(`monitor service exited code=${code ?? "null"} signal=${signal || "none"}; restarting in ${delayMs}ms`);
  restartTimer = setTimeout(launchService, delayMs);
}

function launchService() {
  if (stopping || child) return;
  const startedAt = Date.now();
  const logFd = fs.openSync(LOG_PATH, "a");
  appendLog(`monitor service starting supervisorPid=${process.pid}`);
  child = spawn(process.execPath, [SERVICE_PATH, "--service"], {
    cwd: ROOT_DIR,
    env: { ...process.env, SIGNAL_RUNTIME_DIR: RUNTIME_DIR },
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });
  fs.closeSync(logFd);
  let settled = false;
  const settle = (code, signal) => {
    if (settled) return;
    settled = true;
    child = null;
    scheduleRestart(startedAt, code, signal);
  };
  child.once("error", (error) => {
    appendLog(`monitor service spawn failed: ${error instanceof Error ? error.message : String(error)}`);
    settle(null, "spawn-error");
  });
  child.once("exit", settle);
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  if (child && child.exitCode === null) {
    child.kill();
  } else {
    releaseSupervisorPid();
  }
}

if (acquireSupervisorPid()) {
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", releaseSupervisorPid);
  appendLog(`event monitor supervisor started pid=${process.pid}`);
  launchService();
}
