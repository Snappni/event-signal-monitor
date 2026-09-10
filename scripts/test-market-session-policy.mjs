import assert from "node:assert/strict";
import { classifyMarketSession, limitSessionEntryCandidates } from "./market-session-policy.mjs";

const asia = classifyMarketSession("2026-07-22T02:00:00.000Z");
assert.equal(asia.policyKey, "asia");
assert.equal(asia.overlap, false);

const asiaEurope = classifyMarketSession("2026-07-22T07:30:00.000Z");
assert.equal(asiaEurope.policyKey, "asia_europe_overlap");
assert.equal(asiaEurope.overlap, true);
assert.equal(asiaEurope.activeSessions.length, 2);

const europeUs = classifyMarketSession("2026-07-22T14:00:00.000Z");
assert.equal(europeUs.policyKey, "europe_us_overlap");

const offHours = classifyMarketSession("2026-07-22T23:00:00.000Z");
assert.equal(offHours.policyKey, "off_hours");
assert.ok(offHours.policy.entryThresholdAdd > asia.policy.entryThresholdAdd);

const candidates = [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }, { symbol: "SOLUSDT" }];
assert.deepEqual(
  limitSessionEntryCandidates(candidates, ["BTCUSDT"], asia.policy.maxConcurrentPositions),
  [{ symbol: "ETHUSDT" }, { symbol: "SOLUSDT" }]
);
assert.deepEqual(
  limitSessionEntryCandidates(candidates, ["BTCUSDT", "ETHUSDT", "SOLUSDT"], asia.policy.maxConcurrentPositions),
  []
);

console.log("market session policy tests passed");
