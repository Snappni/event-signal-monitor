import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 28997;
const runtime = path.join(root, ".runtime", `factor-ui-review-${Date.now()}`);
fs.mkdirSync(runtime, { recursive: true });
const child = spawn(process.execPath, ["./scripts/serve-dashboard.mjs"], {
  cwd: root,
  env: { ...process.env, SIGNAL_DASHBOARD_PORT: String(port), SIGNAL_RUNTIME_DIR: runtime, SIGNAL_DASHBOARD_AUTO_START_SERVICE: "false" },
  stdio: "ignore"
});

async function waitFor(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The dashboard is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dashboard did not start: ${url}`);
}

try {
  const page = await waitFor(`http://127.0.0.1:${port}/factors.html`);
  const apiResponse = await fetch(`http://127.0.0.1:${port}/api/factors`);
  const api = await apiResponse.json();
  assert.equal(page.status, 200);
  assert.equal(apiResponse.status, 200);
  assert.ok(api.counts.total >= 50);
  const payload = {
    decisionInfluence: 0.33,
    miningEnabled: true,
    factorUpdates: [{ id: "return_1m", enabled: false, useInDecision: false, weight: 2 }]
  };
  const saveResponse = await fetch(`http://127.0.0.1:${port}/api/factors/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const saved = await saveResponse.json();
  assert.equal(saveResponse.status, 200);
  assert.equal(saved.config.decisionInfluence, 0.33);
  assert.equal(saved.config.factorSettings.return_1m.enabled, false);
  console.log(JSON.stringify({ passed: true, pageStatus: page.status, factorCount: api.counts.total, savedInfluence: saved.config.decisionInfluence }));
} finally {
  child.kill();
}

