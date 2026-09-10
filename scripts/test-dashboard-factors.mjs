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
  assert.match(pageHtml, /因子研究中心/);
  assert.match(pageHtml, /研究不依赖账户开仓/);
  assert.doesNotMatch(pageHtml, /参与原决策的最大占比/);
  assert.doesNotMatch(pageHtml, /保存全部设置/);
  assert.doesNotMatch(pageHtml, /href="\/models\.html"/);
  assert.doesNotMatch(pageHtml, />指标口径</);
  assert.doesNotMatch(pageHtml, /内置目录已通过机制来源/);
  assert.equal(apiResponse.status, 200);
  assert.equal(api.counts.builtIn, 108);
  assert.equal(api.counts.modelFactors, 6);
  assert.deepEqual(Object.keys(api.decisionReadiness.layers), ["direction", "context", "risk"]);
  assert.equal(api.decisionReadiness.layers.direction.minimumActiveFactors, 1);
  assert.equal(api.decisionReadiness.layers.direction.fullStrengthFactors, 1);
  assert.equal(api.engine, "causal_research_v1");
  assert.equal(api.counts.inDecision, 0);
  const payload = {
    decisionInfluence: 0.33,
    miningEnabled: true,
    autoGovernanceEnabled: true,
    factorSettings: {
      return_1m: { enabled: false, useInDecision: false, weight: 2 },
      volume_zscore: { enabled: true, useInDecision: true, weight: 1 },
      realized_volatility: { enabled: true, useInDecision: true, weight: 1 }
    }
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
  assert.equal(saved.config.factorSettings.volume_zscore.useInDecision, false);
  assert.equal(saved.config.factorSettings.realized_volatility.useInDecision, false);
  const bad = await fetch(`http://127.0.0.1:${port}/api/factors/research`, {
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"arbitrary_command"})
  });
  assert.equal(bad.status,400);
  const incomplete = await fetch(`http://127.0.0.1:${port}/api/factors/config`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decisionMode:'manual'}) });
  assert.equal(incomplete.status,400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'factor-library-config.json'))).decisionMode,'validated');
  const manual = await fetch(`http://127.0.0.1:${port}/api/factors/config`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decisionMode:'manual',factorSettings:{return_1m:{enabled:true,useInDecision:true},realized_volatility:{enabled:true,useInDecision:true},volume_zscore:{enabled:true,useInDecision:true}}}) });
  assert.equal(manual.status,200);const manualData=await manual.json();assert.equal(manualData.manualReadiness.ready,true);assert.equal(manualData.config.autoGovernanceEnabled,false);
  assert.equal(manualData.counts.inDecision,0,'selected factors without live data do not masquerade as active');
  assert.match(pageHtml,/id="manualLayerGuide"/);assert.match(pageHtml,/id="researchTaskPanel"/);
  const task=await fetch(`http://127.0.0.1:${port}/api/factors/research`);assert.equal(task.status,200);assert.equal((await task.json()).worker.state,'not_started');
  console.log(JSON.stringify({ passed: true, pageStatus: page.status, factorCount: api.counts.builtIn, savedInfluence: saved.config.decisionInfluence }));
} finally {
  child.kill();
}
