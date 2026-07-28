import { compactArchivedTrade } from "./trade-history-store.mjs";

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function adverseExecutionPrice(referencePrice, side, action, slippageRate) {
  const isBuy = (action === "entry" && side === "long") || (action === "exit" && side === "short");
  return referencePrice * (isBuy ? 1 + slippageRate : 1 - slippageRate);
}

function positionGrossPnl(position, exitPrice) {
  if (!position || !exitPrice || !position.entry || !position.quantity) return 0;
  const priceDifference = position.side === "long" ? exitPrice - position.entry : position.entry - exitPrice;
  return priceDifference * position.quantity;
}

export function closePaperPosition(account, positionId, price, reason, now) {
  const position = account.positions[positionId];
  if (!position) return null;
  const exitPrice = adverseExecutionPrice(price, position.side, "exit", safeNumber(position.slippageRate));
  const exitNotional = Math.abs(position.quantity * exitPrice);
  const exitFee = exitNotional * safeNumber(position.feeRate);
  const exitSlippageCost = Math.abs(exitPrice - price) * position.quantity;
  const remainingGrossTradingPnl = positionGrossPnl(position, exitPrice);
  const closeSettlementPnl = remainingGrossTradingPnl - exitFee;
  const remainingRealizedPnl =
    remainingGrossTradingPnl - safeNumber(position.entryFee) - exitFee + safeNumber(position.fundingPnl);
  const totalQuantity = safeNumber(position.partialClosedQuantity) + safeNumber(position.quantity);
  const weightedExitPrice = totalQuantity > 0
    ? (safeNumber(position.partialExitPriceQuantitySum) + exitPrice * safeNumber(position.quantity)) / totalQuantity
    : exitPrice;
  const grossTradingPnl = safeNumber(position.partialGrossTradingPnl) + remainingGrossTradingPnl;
  const realizedPnl = safeNumber(position.partialRealizedPnl) + remainingRealizedPnl;
  const totalEntryFee = safeNumber(position.partialEntryFee) + safeNumber(position.entryFee);
  const totalExitFee = safeNumber(position.partialExitFee) + exitFee;
  const totalEntrySlippageCost = safeNumber(position.partialEntrySlippageCost) + safeNumber(position.entrySlippageCost);
  const totalExitSlippageCost = safeNumber(position.partialExitSlippageCost) + exitSlippageCost;
  const totalFundingPnl = safeNumber(position.partialFundingPnl) + safeNumber(position.fundingPnl);
  const initialMarginRequired = safeNumber(position.initialMarginRequired, position.marginRequired);
  const closed = {
    ...position,
    sessionId: account.sessionId,
    status: "closed",
    notional: safeNumber(position.initialNotional, position.notional),
    marginRequired: initialMarginRequired,
    quantity: safeNumber(position.initialQuantity, totalQuantity),
    exitReferencePrice: price,
    exitPrice: weightedExitPrice,
    entryFee: totalEntryFee,
    exitFee: totalExitFee,
    entrySlippageCost: totalEntrySlippageCost,
    exitSlippageCost: totalExitSlippageCost,
    fundingPnl: totalFundingPnl,
    grossTradingPnl,
    closedAt: now,
    closeReason: reason,
    exitFactorSnapshot: position.exitEvaluation
      ? {
          version: position.exitEvaluation.version,
          evaluatedAt: position.exitEvaluation.evaluatedAt,
          signals: position.exitEvaluation.signals,
          weights: position.exitEvaluation.weights,
          exitScore: position.exitEvaluation.exitScore,
          threshold: position.exitEvaluation.threshold,
          diagnostics: position.exitEvaluation.diagnostics
        }
      : null,
    realizedPnl,
    realizedReturnPct: initialMarginRequired > 0 ? realizedPnl / initialMarginRequired : 0,
    accountReturnPct: account.startingCapital > 0 ? realizedPnl / account.startingCapital : 0
  };
  if (
    ["ADAPTIVE_EXIT", "MAX_HOLDING_TIME", "CAPITAL_ROTATION", "DYNAMIC_SL", "TP_EXTENSION"].includes(reason) &&
    position.exitEvaluation
  ) {
    const horizonHours = safeNumber(position.exitEvaluation.counterfactualHorizonHours, 4);
    closed.exitCounterfactual = {
      status: "pending",
      horizonHours,
      dueAt: new Date(new Date(now).getTime() + horizonHours * 3_600_000).toISOString(),
      evaluatedAt: null,
      referenceExitPrice: exitPrice,
      replacementSymbol: position.capitalRotationReplacement?.symbol || null,
      replacementSide: position.capitalRotationReplacement?.side || null,
      replacementReferencePrice: position.capitalRotationReplacement?.entry || null,
      counterfactualPrice: null,
      counterfactualReturnPct: null,
      avoidedReturnPct: null,
      beneficial: null
    };
  }
  account.realizedPnl = safeNumber(account.realizedPnl) + closeSettlementPnl;
  account.tradingFees = safeNumber(account.tradingFees) + exitFee;
  account.slippageCost = safeNumber(account.slippageCost) + exitSlippageCost;
  account.lifetimeClosedTrades = Math.max(
    safeNumber(account.lifetimeClosedTrades),
    Array.isArray(account.tradeHistory) ? account.tradeHistory.length : 0
  ) + 1;
  if (realizedPnl > 0) {
    account.lifetimeWinningTrades = Math.max(
      safeNumber(account.lifetimeWinningTrades),
      (account.tradeHistory || []).filter((trade) => safeNumber(trade.realizedPnl) > 0).length
    ) + 1;
  }
  delete account.positions[positionId];
  account.tradeHistory = [
    ...(account.tradeHistory || []),
    compactArchivedTrade(closed)
  ].slice(-500);
  account.tradeHistorySchemaVersion = 2;
  return closed;
}
