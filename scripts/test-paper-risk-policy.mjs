import assert from "node:assert/strict";
import {
  clusterKey,
  portfolioRiskSnapshot,
  riskBudgetForNewPosition,
  riskThrottleForDrawdown
} from "./paper-risk-policy.mjs";

assert.equal(clusterKey("BTCUSDT"), "btc");
assert.equal(clusterKey("SOLUSDT"), "large_alt");
assert.equal(riskThrottleForDrawdown(-0.1), 1);
assert.equal(riskThrottleForDrawdown(-0.15), 0.5);
assert.equal(riskThrottleForDrawdown(-0.2), 0);

const account = {
  startingCapital: 10_000,
  equity: 9_000,
  marginUsed: 2_000,
  equityCurve: [{ equity: 10_000 }, { equity: 9_000 }],
  positions: {
    one: { symbol: "SOLUSDT", initialMaxLossAmount: 50, initialQuantity: 10, quantity: 10 }
  }
};
const snapshot = portfolioRiskSnapshot(account);
assert.equal(snapshot.openRiskAmount, 50);
assert.ok(Math.abs(snapshot.drawdownPct + 0.1) < 1e-9);

const recovered = portfolioRiskSnapshot({
  ...account,
  equity: 10_200,
  equityCurve: [{ equity: 10_000 }, { equity: 8_000 }, { equity: 10_200 }]
});
assert.equal(recovered.drawdownPct, 0, "risk throttle must use current drawdown, not permanent historical drawdown");

const differentCluster = riskBudgetForNewPosition(account, {
  symbol: "BTCUSDT",
  positionRiskPct: 0.005,
  accountControl: { maxLossAmount: 50, marginRequired: 500 }
});
assert.equal(differentCluster.allowed, true);
assert.equal(differentCluster.scale, 1);

const sameCluster = riskBudgetForNewPosition(account, {
  symbol: "XRPUSDT",
  positionRiskPct: 0.005,
  accountControl: { maxLossAmount: 50, marginRequired: 500 }
});
assert.ok(sameCluster.scale < 1, "same-cluster exposure must be scaled down");

const stoppedAccount = {
  ...account,
  equity: 8_000,
  equityCurve: [{ equity: 10_000 }, { equity: 8_000 }]
};
const stopped = riskBudgetForNewPosition(stoppedAccount, {
  symbol: "BTCUSDT",
  positionRiskPct: 0.005,
  accountControl: { maxLossAmount: 50, marginRequired: 500 }
});
assert.equal(stopped.allowed, false);
assert.equal(stopped.scale, 0);

console.log(JSON.stringify({ passed: true, targetDrawdownPct: 0.15, hardStopDrawdownPct: 0.2 }));
