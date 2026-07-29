export const DEFAULT_RISK_POLICY = Object.freeze({
  version: 1,
  targetDrawdownPct: 0.15,
  criticalDrawdownPct: 0.2,
  maxOpenRiskPct: 0.02,
  maxClusterRiskPct: 0.008,
  maxMarginUsagePct: 0.4,
  minimumOrderScale: 0.05
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clusterKey(symbol) {
  const value = String(symbol || "").toUpperCase();
  if (value.startsWith("BTC")) return "btc";
  if (value.startsWith("ETH")) return "eth";
  if (["BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOTUSDT", "AVAXUSDT"].includes(value)) return "large_alt";
  return "other_alt";
}

export function currentDrawdownPct(account) {
  const curve = Array.isArray(account?.equityCurve) ? account.equityCurve : [];
  let peak = Math.max(safeNumber(account?.startingCapital), 0);
  for (const point of curve) {
    const equity = safeNumber(point?.equity);
    peak = Math.max(peak, equity);
  }
  const equity = safeNumber(account?.equity, peak);
  return peak > 0 ? Math.min(0, equity / peak - 1) : 0;
}

export function riskThrottleForDrawdown(drawdownPct, policy = DEFAULT_RISK_POLICY) {
  const drawdown = Math.min(0, safeNumber(drawdownPct));
  const target = Math.max(0.001, safeNumber(policy.targetDrawdownPct, 0.15));
  const critical = Math.max(target, safeNumber(policy.criticalDrawdownPct, 0.2));
  if (drawdown <= -critical) return 0;
  if (drawdown <= -target) return 0.5 * (1 - clamp((Math.abs(drawdown) - target) / Math.max(critical - target, 0.001), 0, 1));
  return 1;
}

function remainingFraction(position) {
  const initial = safeNumber(position?.initialQuantity, position?.quantity);
  const current = safeNumber(position?.quantity, initial);
  return initial > 0 ? clamp(current / initial, 0, 1) : 1;
}

export function portfolioRiskSnapshot(account, policy = DEFAULT_RISK_POLICY) {
  const startingCapital = Math.max(safeNumber(account?.startingCapital), 1e-9);
  const positions = Object.values(account?.positions || {});
  const byCluster = {};
  let openRiskAmount = 0;
  for (const position of positions) {
    const risk = Math.max(0, safeNumber(position.initialMaxLossAmount, position.maxLossAmount)) * remainingFraction(position);
    const cluster = clusterKey(position.symbol);
    byCluster[cluster] = safeNumber(byCluster[cluster]) + risk;
    openRiskAmount += risk;
  }
  const marginUsed = Math.max(0, safeNumber(account?.marginUsed));
  const equity = Math.max(0, safeNumber(account?.equity, startingCapital));
  return {
    policyVersion: policy.version,
    openPositions: positions.length,
    openRiskAmount,
    openRiskPct: openRiskAmount / startingCapital,
    byCluster,
    largestClusterRiskPct: Object.values(byCluster).length ? Math.max(...Object.values(byCluster)) / startingCapital : 0,
    marginUsed,
    equity,
    marginUsagePct: equity > 0 ? marginUsed / equity : 1,
    drawdownPct: currentDrawdownPct(account),
    drawdownThrottle: riskThrottleForDrawdown(currentDrawdownPct(account), policy)
  };
}

export function riskBudgetForNewPosition(account, signal, policy = DEFAULT_RISK_POLICY) {
  const snapshot = portfolioRiskSnapshot(account, policy);
  const startingCapital = Math.max(safeNumber(account?.startingCapital), 1e-9);
  const candidateRisk = Math.max(
    safeNumber(signal?.accountControl?.maxLossAmount),
    startingCapital * Math.max(0, safeNumber(signal?.positionRiskPct))
  );
  const cluster = clusterKey(signal?.symbol);
  const riskCapital = Math.min(startingCapital, snapshot.equity);
  const totalBudget = riskCapital * safeNumber(policy.maxOpenRiskPct, 0.02) * snapshot.drawdownThrottle;
  const clusterBudget = riskCapital * safeNumber(policy.maxClusterRiskPct, 0.008) * snapshot.drawdownThrottle;
  const riskScale = candidateRisk > 0 ? clamp((totalBudget - snapshot.openRiskAmount) / candidateRisk, 0, 1) : 0;
  const clusterScale = candidateRisk > 0 ? clamp((clusterBudget - safeNumber(snapshot.byCluster[cluster])) / candidateRisk, 0, 1) : 0;
  const marginBudget = Math.max(0, snapshot.equity * safeNumber(policy.maxMarginUsagePct, 0.4) - snapshot.marginUsed);
  const candidateMargin = Math.max(0, safeNumber(signal?.accountControl?.marginRequired));
  const marginScale = candidateMargin > 0 ? clamp(marginBudget / candidateMargin, 0, 1) : 1;
  const scale = Math.min(snapshot.drawdownThrottle, riskScale, clusterScale, marginScale);
  return {
    allowed: scale >= safeNumber(policy.minimumOrderScale, 0.05),
    scale,
    candidateRisk,
    candidateMargin,
    totalBudget,
    clusterBudget,
    marginBudget,
    cluster,
    snapshot,
    reason: snapshot.drawdownThrottle <= 0
      ? "达到关键回撤阈值，暂停新增纸面仓位。"
      : scale < safeNumber(policy.minimumOrderScale, 0.05)
        ? "组合风险、同簇风险或保证金预算不足。"
        : null
  };
}

