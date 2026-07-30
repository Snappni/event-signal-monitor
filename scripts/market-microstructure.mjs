function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function eventTime(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeLevels(levels, descending) {
  return (Array.isArray(levels) ? levels : [])
    .map((level) => ({ price: finiteNumber(level?.[0]), quantity: finiteNumber(level?.[1]) }))
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((left, right) => descending ? right.price - left.price : left.price - right.price)
    .slice(0, 5);
}

function flowWindow(events, now, windowMs) {
  let buyQuoteVolume = 0;
  let sellQuoteVolume = 0;
  let tradeCount = 0;
  for (const event of events) {
    if (now - event.time > windowMs) continue;
    if (event.side > 0) buyQuoteVolume += event.quoteVolume;
    else sellQuoteVolume += event.quoteVolume;
    tradeCount += 1;
  }
  const totalQuoteVolume = buyQuoteVolume + sellQuoteVolume;
  return {
    buyQuoteVolume,
    sellQuoteVolume,
    totalQuoteVolume,
    tradeCount,
    imbalance: totalQuoteVolume > 0 ? (buyQuoteVolume - sellQuoteVolume) / totalQuoteVolume : 0
  };
}

function bookFlowWindow(events, now, windowMs) {
  const result = {
    bidAddedQuote: 0,
    bidCancelledQuote: 0,
    askAddedQuote: 0,
    askCancelledQuote: 0,
    eventCount: 0,
    imbalance: 0
  };
  for (const event of events) {
    if (now - event.time > windowMs) continue;
    result.bidAddedQuote += event.bidAddedQuote;
    result.bidCancelledQuote += event.bidCancelledQuote;
    result.askAddedQuote += event.askAddedQuote;
    result.askCancelledQuote += event.askCancelledQuote;
    result.eventCount += 1;
  }
  const bullish = result.bidAddedQuote + result.askCancelledQuote;
  const bearish = result.askAddedQuote + result.bidCancelledQuote;
  const total = bullish + bearish;
  result.imbalance = total > 0 ? (bullish - bearish) / total : 0;
  return result;
}

function levelChanges(previousLevels, nextLevels) {
  const previous = new Map(previousLevels.map((level) => [level.price, level.quantity]));
  const next = new Map(nextLevels.map((level) => [level.price, level.quantity]));
  let addedQuote = 0;
  let cancelledQuote = 0;
  for (const price of new Set([...previous.keys(), ...next.keys()])) {
    const delta = finiteNumber(next.get(price)) - finiteNumber(previous.get(price));
    if (delta > 0) addedQuote += price * delta;
    else cancelledQuote += price * Math.abs(delta);
  }
  return { addedQuote, cancelledQuote };
}

export function createMarketMicrostructure(options = {}) {
  const retentionMs = Math.max(30_000, finiteNumber(options.retentionMs, 35_000));
  const tradeStaleMs = Math.max(1_000, finiteNumber(options.tradeStaleMs, 5_000));
  const bookStaleMs = Math.max(500, finiteNumber(options.bookStaleMs, 2_000));
  const states = new Map();

  const stateFor = (symbol) => {
    const key = String(symbol || "").toUpperCase();
    if (!key) return null;
    if (!states.has(key)) states.set(key, { trades: [], bookEvents: [], book: null, topQuote: null, lastTradeAt: 0 });
    return states.get(key);
  };

  const prune = (state, now) => {
    const cutoff = now - retentionMs;
    let firstRetained = 0;
    while (firstRetained < state.trades.length && state.trades[firstRetained].time < cutoff) firstRetained += 1;
    if (firstRetained) state.trades.splice(0, firstRetained);
    let firstBookEvent = 0;
    while (firstBookEvent < state.bookEvents.length && state.bookEvents[firstBookEvent].time < cutoff) firstBookEvent += 1;
    if (firstBookEvent) state.bookEvents.splice(0, firstBookEvent);
  };

  return {
    updateTrade({ symbol, price, quantity, buyerIsMaker, time }) {
      const state = stateFor(symbol);
      const tradePrice = finiteNumber(price);
      const tradeQuantity = finiteNumber(quantity);
      if (!state || !(tradePrice > 0) || !(tradeQuantity > 0)) return false;
      const timestamp = eventTime(time);
      state.trades.push({
        time: timestamp,
        quoteVolume: tradePrice * tradeQuantity,
        side: buyerIsMaker === true ? -1 : 1
      });
      if (state.trades.length > 1 && timestamp < state.trades[state.trades.length - 2].time) {
        state.trades.sort((left, right) => left.time - right.time);
      }
      state.lastTradeAt = Math.max(state.lastTradeAt, timestamp);
      prune(state, timestamp);
      return true;
    },

    updateBook({ symbol, bids, asks, time }) {
      const state = stateFor(symbol);
      const normalizedBids = normalizeLevels(bids, true);
      const normalizedAsks = normalizeLevels(asks, false);
      if (!state || !normalizedBids.length || !normalizedAsks.length) return false;
      const timestamp = eventTime(time);
      if (state.book && timestamp >= state.book.time && timestamp - state.book.time <= bookStaleMs) {
        const bidChanges = levelChanges(state.book.bids, normalizedBids);
        const askChanges = levelChanges(state.book.asks, normalizedAsks);
        state.bookEvents.push({
          time: timestamp,
          bidAddedQuote: bidChanges.addedQuote,
          bidCancelledQuote: bidChanges.cancelledQuote,
          askAddedQuote: askChanges.addedQuote,
          askCancelledQuote: askChanges.cancelledQuote
        });
      }
      state.book = { bids: normalizedBids, asks: normalizedAsks, time: timestamp };
      prune(state, timestamp);
      return true;
    },

    updateTopQuote({ symbol, bid, bidQuantity, ask, askQuantity, time }) {
      const state = stateFor(symbol);
      const normalized = {
        bid: finiteNumber(bid),
        bidQuantity: finiteNumber(bidQuantity),
        ask: finiteNumber(ask),
        askQuantity: finiteNumber(askQuantity),
        time: eventTime(time)
      };
      if (!state || !(normalized.bid > 0) || !(normalized.ask > normalized.bid)) return false;
      state.topQuote = normalized;
      return true;
    },

    snapshot(symbol, nowValue = Date.now()) {
      const key = String(symbol || "").toUpperCase();
      const state = states.get(key);
      const now = eventTime(nowValue);
      if (!state) return { symbol: key, available: false, tradeAvailable: false, bookAvailable: false, signal: 0 };
      prune(state, now);

      const flow5s = flowWindow(state.trades, now, 5_000);
      const flow30s = flowWindow(state.trades, now, 30_000);
      const bookFlow5s = bookFlowWindow(state.bookEvents, now, 5_000);
      const bookFlow30s = bookFlowWindow(state.bookEvents, now, 30_000);
      const tradeAgeMs = state.lastTradeAt > 0 ? Math.max(0, now - state.lastTradeAt) : null;
      const tradeAvailable = tradeAgeMs !== null && tradeAgeMs <= tradeStaleMs && flow30s.tradeCount > 0;
      const freshBook = state.book && now - state.book.time <= bookStaleMs ? state.book : null;
      const freshTopQuote = state.topQuote && now - state.topQuote.time <= bookStaleMs ? state.topQuote : null;
      const bids = freshBook?.bids || (freshTopQuote ? [{ price: freshTopQuote.bid, quantity: freshTopQuote.bidQuantity }] : []);
      const asks = freshBook?.asks || (freshTopQuote ? [{ price: freshTopQuote.ask, quantity: freshTopQuote.askQuantity }] : []);
      const bestBid = bids[0] || null;
      const bestAsk = asks[0] || null;
      const bookAvailable = Boolean(bestBid && bestAsk && bestAsk.price > bestBid.price);
      const bookAgeMs = freshBook
        ? Math.max(0, now - freshBook.time)
        : freshTopQuote
          ? Math.max(0, now - freshTopQuote.time)
          : null;

      const bidDepthQuote = bids.reduce((sum, level) => sum + level.price * level.quantity, 0);
      const askDepthQuote = asks.reduce((sum, level) => sum + level.price * level.quantity, 0);
      const depthQuote = bidDepthQuote + askDepthQuote;
      const orderBookImbalance = depthQuote > 0 ? (bidDepthQuote - askDepthQuote) / depthQuote : 0;
      const topBidDepthQuote = finiteNumber(bestBid?.price) * finiteNumber(bestBid?.quantity);
      const topAskDepthQuote = finiteNumber(bestAsk?.price) * finiteNumber(bestAsk?.quantity);
      const topDepthQuote = topBidDepthQuote + topAskDepthQuote;
      const topBookImbalance = topDepthQuote > 0
        ? (topBidDepthQuote - topAskDepthQuote) / topDepthQuote
        : 0;
      const midPrice = bookAvailable ? (bestBid.price + bestAsk.price) / 2 : 0;
      const spreadBps = midPrice > 0 ? ((bestAsk.price - bestBid.price) / midPrice) * 10_000 : 0;
      const topQuantity = finiteNumber(bestBid?.quantity) + finiteNumber(bestAsk?.quantity);
      const microPrice = topQuantity > 0
        ? (bestAsk.price * bestBid.quantity + bestBid.price * bestAsk.quantity) / topQuantity
        : midPrice;
      const microPriceBiasBps = midPrice > 0 ? ((microPrice - midPrice) / midPrice) * 10_000 : 0;
      const depthSlope = (levels, descending) => {
        if (levels.length < 2 || midPrice <= 0) return 0;
        const weightedDistance = levels.reduce((sum, level) => {
          const distanceBps = Math.abs(level.price - midPrice) / midPrice * 10_000;
          return sum + distanceBps * level.price * level.quantity;
        }, 0);
        const quoteDepth = levels.reduce((sum, level) => sum + level.price * level.quantity, 0);
        if (quoteDepth <= 0) return 0;
        const averageDistance = weightedDistance / quoteDepth;
        return (descending ? 1 : -1) * quoteDepth / Math.max(1, averageDistance);
      };
      const bidSlope = Math.abs(depthSlope(bids, true));
      const askSlope = Math.abs(depthSlope(asks, false));
      const bookSlope = bidSlope + askSlope > 0 ? (bidSlope - askSlope) / (bidSlope + askSlope) : 0;
      const levelGapBps = (levels) => levels.slice(1).map((level, index) =>
        midPrice > 0 ? Math.abs(level.price - levels[index].price) / midPrice * 10_000 : 0
      );
      const gaps = [...levelGapBps(bids), ...levelGapBps(asks)];
      const averageGapBps = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0;
      const liquidityVoid = bookAvailable ? clamp((averageGapBps - spreadBps) / 10, 0, 1) : 0;
      const recentRate = flow5s.totalQuoteVolume / 5;
      const baselineRate = flow30s.totalQuoteVolume / 30;
      const volumeRateRatio = baselineRate > 0 ? clamp(recentRate / baselineRate, 0, 6) : 0;
      const tradeConfidence = tradeAvailable ? clamp(flow30s.tradeCount / 20, 0, 1) : 0;
      const bookFlowConfidence = bookAvailable ? clamp(bookFlow30s.eventCount / 10, 0, 1) : 0;

      let weightedSignal = 0;
      let signalWeight = 0;
      if (tradeAvailable) {
        weightedSignal += (flow5s.imbalance * 0.45 + flow30s.imbalance * 0.25) * tradeConfidence;
        signalWeight += 0.7;
      }
      if (bookAvailable) {
        weightedSignal +=
          orderBookImbalance * 0.12 +
          clamp(microPriceBiasBps / 2, -1, 1) * 0.08 +
          bookFlow5s.imbalance * 0.1 * bookFlowConfidence;
        signalWeight += 0.3;
      }

      return {
        symbol: key,
        available: tradeAvailable || bookAvailable,
        tradeAvailable,
        bookAvailable,
        capturedAt: new Date(now).toISOString(),
        signal: signalWeight > 0 ? clamp(weightedSignal / signalWeight, -1, 1) : 0,
        flow5s,
        flow30s,
        bookFlow5s,
        bookFlow30s,
        cumulativeVolumeDelta30s: flow30s.buyQuoteVolume - flow30s.sellQuoteVolume,
        volumeRateRatio,
        tradeConfidence,
        bookFlowConfidence,
        orderBookImbalance,
        topBookImbalance,
        bidDepthQuote,
        askDepthQuote,
        bookSlope,
        liquidityVoid,
        spreadBps,
        midPrice,
        microPrice,
        microPriceBiasBps,
        tradeAgeMs,
        bookAgeMs,
        retainedTradeEvents: state.trades.length
      };
    },

    clear() {
      states.clear();
    }
  };
}
