import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.join(__dirname, "serve-dashboard.mjs");
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-signal-dashboard-test-"));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForDashboard(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dashboard exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("dashboard did not become ready");
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [dashboardPath], {
  env: {
    ...process.env,
    SIGNAL_DASHBOARD_PORT: String(port),
    SIGNAL_RUNTIME_DIR: runtimeDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForDashboard(baseUrl, child);
  const requested = {
    initialCapital: 25_000,
    marketType: "futures",
    maxLeverage: 17,
    riskProfile: "aggressive"
  };
  const startResponse = await fetch(`${baseUrl}/api/account/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requested)
  });
  assert.equal(startResponse.status, 200);
  const started = await startResponse.json();
  assert.equal(started.config.initialCapital, requested.initialCapital);
  assert.equal(started.config.maxLeverage, requested.maxLeverage);
  assert.equal(started.config.riskProfile, requested.riskProfile);
  assert.equal(started.account.isActive, true);
  assert.equal(started.account.startingCapital, requested.initialCapital);
  assert.equal(started.account.equity, requested.initialCapital);
  assert.equal(started.account.configSnapshot.maxLeverage, requested.maxLeverage);

  const persistedResponse = await fetch(`${baseUrl}/api/account`);
  const persisted = await persistedResponse.json();
  assert.equal(persisted.config.maxLeverage, requested.maxLeverage);
  assert.equal(persisted.config.riskProfile, requested.riskProfile);
  assert.equal(persisted.account.isActive, true);

  const secondStartResponse = await fetch(`${baseUrl}/api/account/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const secondStart = await secondStartResponse.json();
  assert.equal(secondStart.config.maxLeverage, requested.maxLeverage);
  assert.equal(secondStart.account.sessionId, started.account.sessionId);

  console.log("dashboard account start configuration test passed");
} finally {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 2_000).unref();
  });
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  if (stderr.trim()) process.stderr.write(stderr);
}
