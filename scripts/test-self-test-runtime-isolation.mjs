import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-signal-self-test-"));
try {
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts", "event-signal-monitor.mjs"), "--self-test-isolation-probe"],
    {
      cwd: path.resolve("."),
      env: { ...process.env, SIGNAL_RUNTIME_DIR: runtimeDir },
      encoding: "utf8"
    }
  );
  assert.notEqual(result.status, 0, "the isolation probe must fail deliberately");
  assert.match(result.stderr, /intentional self-test isolation probe/);
  assert.equal(
    fs.existsSync(path.join(runtimeDir, "latest-report.json")),
    false,
    "a self-test failure must never write a runtime report"
  );
  console.log("self-test runtime isolation test passed");
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
