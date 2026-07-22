const SESSION_WINDOWS = Object.freeze({
  asia: Object.freeze({ startUtcHour: 0, endUtcHour: 9, label: "亚洲时段" }),
  europe: Object.freeze({ startUtcHour: 7, endUtcHour: 16, label: "欧洲时段" }),
  us: Object.freeze({ startUtcHour: 13, endUtcHour: 22, label: "美国时段" })
});

export const MARKET_SESSION_POLICIES = Object.freeze({
  asia: Object.freeze({
    key: "asia",
    label: "亚洲时段",
    strategy: "range-breakout-confirmed",
    riskMultiplier: 0.85,
    entryThresholdAdd: 0.01,
    maxConcurrentPositions: 3
  }),
  europe: Object.freeze({
    key: "europe",
    label: "欧洲时段",
    strategy: "trend-flow-confirmed",
    riskMultiplier: 1,
    entryThresholdAdd: 0,
    maxConcurrentPositions: 4
  }),
  us: Object.freeze({
    key: "us",
    label: "美国时段",
    strategy: "trend-flow-confirmed",
    riskMultiplier: 0.95,
    entryThresholdAdd: 0.01,
    maxConcurrentPositions: 4
  }),
  asia_europe_overlap: Object.freeze({
    key: "asia_europe_overlap",
    label: "亚洲/欧洲交会",
    strategy: "overlap-confirmed",
    riskMultiplier: 0.85,
    entryThresholdAdd: 0.02,
    maxConcurrentPositions: 3
  }),
  europe_us_overlap: Object.freeze({
    key: "europe_us_overlap",
    label: "欧洲/美国交会",
    strategy: "overlap-confirmed",
    riskMultiplier: 0.8,
    entryThresholdAdd: 0.025,
    maxConcurrentPositions: 3
  }),
  off_hours: Object.freeze({
    key: "off_hours",
    label: "非主要时段",
    strategy: "reduced-exposure",
    riskMultiplier: 0.65,
    entryThresholdAdd: 0.04,
    maxConcurrentPositions: 2
  })
});

export function limitSessionEntryCandidates(candidates = [], openSymbols = [], maxConcurrentPositions) {
  const maxPositions = Number(maxConcurrentPositions);
  if (!Number.isFinite(maxPositions) || maxPositions < 0) return candidates;
  const activeSymbols = new Set(openSymbols.filter(Boolean));
  const slots = Math.max(0, Math.floor(maxPositions) - activeSymbols.size);
  if (!slots) return [];
  const selected = [];
  for (const candidate of candidates) {
    if (!candidate?.symbol || activeSymbols.has(candidate.symbol)) continue;
    selected.push(candidate);
    if (selected.length >= slots) break;
  }
  return selected;
}

function utcHourFraction(date) {
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
}

export function classifyMarketSession(input = new Date()) {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid session timestamp");
  const utcHour = utcHourFraction(date);
  const active = Object.entries(SESSION_WINDOWS)
    .filter(([, window]) => utcHour >= window.startUtcHour && utcHour < window.endUtcHour)
    .map(([key]) => key);
  const policyKey = active.length === 2
    ? `${active[0]}_${active[1]}_overlap`
    : active[0] || "off_hours";
  const policy = MARKET_SESSION_POLICIES[policyKey] || MARKET_SESSION_POLICIES.off_hours;
  return {
    asOf: date.toISOString(),
    utcHour,
    activeSessions: active,
    overlap: active.length > 1,
    policyKey,
    policy,
    windows: SESSION_WINDOWS
  };
}
