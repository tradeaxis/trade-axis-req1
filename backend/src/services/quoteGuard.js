const kiteStreamService = require('./kiteStreamService');

const QUOTE_FRESHNESS_MS = Number(process.env.QUOTE_FRESHNESS_MS || 15000);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toTimestampMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const getAgeMs = (value) => {
  const timestampMs = toTimestampMs(value);
  return timestampMs > 0 ? Math.max(0, Date.now() - timestampMs) : Number.POSITIVE_INFINITY;
};

const getSidePrice = (quote, side = 'buy') => {
  const last = toNumber(
    quote?.last
      ?? quote?.last_price
      ?? quote?.current_price
      ?? quote?.close_price
      ?? quote?.previous_close
      ?? 0,
  );
  const bid = toNumber(quote?.bid ?? last);
  const ask = toNumber(quote?.ask ?? last);

  if (side === 'sell') {
    return bid || last || ask;
  }

  return ask || last || bid;
};

const getClosedMarketPrice = (quote, side = 'buy') => {
  const last = toNumber(
    quote?.last
      ?? quote?.last_price
      ?? quote?.lastPrice
      ?? quote?.current_price
      ?? quote?.currentPrice
      ?? 0,
  );
  const close = toNumber(
    quote?.close_price
      ?? quote?.closePrice
      ?? quote?.ohlc?.close
      ?? quote?.previous_close
      ?? quote?.previousClose
      ?? 0,
  );
  const bid = toNumber(quote?.bid ?? 0);
  const ask = toNumber(quote?.ask ?? 0);

  if (side === 'sell') {
    return close || last || bid || ask;
  }

  return close || last || ask || bid;
};

const getDbFreshness = (symbolRow, maxAgeMs = QUOTE_FRESHNESS_MS) => {
  const ageMs = getAgeMs(symbolRow?.last_update);
  return {
    ageMs,
    isFresh: !!symbolRow && ageMs <= maxAgeMs,
  };
};

const resolveTradeablePrice = ({
  symbol,
  side = 'buy',
  symbolRow = null,
  liveQuote = null,
  maxAgeMs = QUOTE_FRESHNESS_MS,
  allowStaleDb = false,
} = {}) => {
  const normalizedSymbol = String(symbol || symbolRow?.symbol || '').toUpperCase();
  const live = liveQuote || kiteStreamService.getPriceForSymbolRow(symbolRow || { symbol: normalizedSymbol });
  const liveAgeMs = getAgeMs(live?.timestamp);
  const livePrice = getSidePrice(live, side);
  const hasFreshLive = livePrice > 0 && liveAgeMs <= maxAgeMs;

  const dbFreshness = getDbFreshness(symbolRow, maxAgeMs);
  const dbPrice = allowStaleDb
    ? getClosedMarketPrice(symbolRow, side)
    : getSidePrice(symbolRow, side);
  const hasUsableDb = dbPrice > 0 && (allowStaleDb || dbFreshness.isFresh);

  if (allowStaleDb && hasUsableDb) {
    return {
      symbol: normalizedSymbol,
      price: dbPrice,
      source: 'database',
      liveAgeMs,
      dbAgeMs: dbFreshness.ageMs,
      isFresh: dbFreshness.isFresh,
      isOffQuotes: !dbFreshness.isFresh,
    };
  }

  if (hasFreshLive) {
    return {
      symbol: normalizedSymbol,
      price: livePrice,
      source: 'live',
      liveAgeMs,
      dbAgeMs: dbFreshness.ageMs,
      isFresh: true,
      isOffQuotes: false,
    };
  }

  if (hasUsableDb) {
    return {
      symbol: normalizedSymbol,
      price: dbPrice,
      source: 'database',
      liveAgeMs,
      dbAgeMs: dbFreshness.ageMs,
      isFresh: dbFreshness.isFresh,
      isOffQuotes: !dbFreshness.isFresh,
    };
  }

  return {
    symbol: normalizedSymbol,
    price: 0,
    source: null,
    liveAgeMs,
    dbAgeMs: dbFreshness.ageMs,
    isFresh: false,
    isOffQuotes: true,
  };
};

const buildOffQuotesMessage = (symbol, state = {}) => {
  const parts = [];

  if (Number.isFinite(state.liveAgeMs)) {
    parts.push(`live ${Math.round(state.liveAgeMs / 1000)}s old`);
  }

  if (Number.isFinite(state.dbAgeMs)) {
    parts.push(`db ${Math.round(state.dbAgeMs / 1000)}s old`);
  }

  const ageSummary = parts.length > 0
    ? parts.join(', ')
    : 'no recent price updates';

  return `${String(symbol || state.symbol || 'This symbol').toUpperCase()} is off quotes. ${ageSummary}. Kite session may have expired. Please wait for live quotes or re-authenticate Kite.`;
};

module.exports = {
  QUOTE_FRESHNESS_MS,
  buildOffQuotesMessage,
  getAgeMs,
  getDbFreshness,
  getClosedMarketPrice,
  getSidePrice,
  resolveTradeablePrice,
};
