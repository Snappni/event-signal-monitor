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
  const pageHtml = await page.text();
  assert.equal(page.status, 200);
  assert.match(pageHtml, /id="factorMiningDetails"/);
  assert.match(pageHtml, /id="factorAutoGovernanceEnabled"/);
  assert.match(pageHtml, /id="factorSaveBar"[^>]*hidden/);
  assert.match(pageHtml, /id="discardFactorConfig"/);
  assert.match(pageHtml, />保存更改</);
  assert.match(pageHtml, /id="factorIcSort"/);
  assert.match(pageHtml, /普通方向因子组合最大融合权重/);
  assert.match(pageHtml, /方向因子只融合方向；情景因子只收缩概率置信度；风险因子只调整止损尺度/);
  assert.match(pageHtml, /4 个有效因子开始参与，默认到 10 个才达到完整强度/);
  assert.doesNotMatch(pageHtml, /参与原决策的最大占比/);
  assert.doesNotMatch(pageHtml, /保存全部设置/);
  assert.doesNotMatch(pageHtml, /href="\/models\.html"/);
  assert.doesNotMatch(pageHtml, />指标口径</);
  assert.doesNotMatch(pageHtml, /内置目录已通过机制来源/);
  assert.equal(apiResponse.status, 200);
  assert.equal(api.counts.builtIn, 108);
  assert.equal(api.counts.modelFactors, 6);
  assert.deepEqual(Object.keys(api.decisionReadiness.layers), ["direction", "context", "risk"]);
  assert.equal(api.decisionReadiness.layers.direction.minimumActiveFactors, 4);
  assert.equal(api.decisionReadiness.layers.direction.fullStrengthFactors, 10);
  assert.equal(api.catalogAudit.passed, true);
  assert.equal(api.samplingPolicy.observationRetention.sourcePartitioned, true);
  const payload = {
    decisionInfluence: 0.33,
    miningEnabled: true,
    autoGovernanceEnabled: true,
    factorUpdates: [
      { id: "return_1m", enabled: false, useInDecision: false, weight: 2 },
      { id: "volume_zscore", enabled: true, useInDecision: true, weight: 1 },
      { id: "realized_volatility", enabled: true, useInDecision: true, weight: 1 }
    ]
  };
  const saveResponse = await fetch(`http://127.0.0.1:${port}/api/factors/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const saved = await saveResponse.json();
  assert.equal(saveResponse.status, 200);
  assert.equal(saved.config.decisionInfluence, 0.33);
  assert.equal(saved.config.autoGovernanceEnabled, true);
  assert.equal(saved.config.factorSettings.return_1m.enabled, false);
  assert.equal(saved.config.factorSettings.volume_zscore.useInDecision, true);
  assert.equal(saved.config.factorSettings.realized_volatility.useInDecision, true);
  console.log(JSON.stringify({ passed: true, pageStatus: page.status, factorCount: api.counts.total, savedInfluence: saved.config.decisionInfluence }));
} finally {
  child.kill();
}
