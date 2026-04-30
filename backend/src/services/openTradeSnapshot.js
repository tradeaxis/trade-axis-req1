const { supabase } = require('../config/supabase');
const { isMarketOpen } = require('./marketStatus');
const { resolveTradeablePrice } = require('./quoteGuard');

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundMoney = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
};

async function buildOpenTradeSnapshots(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return [];
  }

  const uniqueSymbols = [
    ...new Set(
      trades
        .map((trade) => String(trade.symbol || '').toUpperCase())
        .filter(Boolean),
    ),
  ];

  const symbolMap = new Map();

  if (uniqueSymbols.length > 0) {
    try {
      const { data: symbolRows, error } = await supabase
        .from('symbols')
        .select('symbol, bid, ask, last_price, last_update')
        .in('symbol', uniqueSymbols);

      if (error) {
        throw error;
      }

      for (const row of symbolRows || []) {
        symbolMap.set(String(row.symbol || '').toUpperCase(), row);
      }
    } catch (error) {
      console.warn('buildOpenTradeSnapshots symbol lookup failed:', error.message);
    }
  }

  return trades.map((trade) => {
    const symbolKey = String(trade.symbol || '').toUpperCase();
    const openPrice = toNumber(trade.open_price);
    const storedCurrentPrice = toNumber(trade.current_price, openPrice);
    const storedProfit = toNumber(trade.profit);
    const quantity = toNumber(trade.quantity);
    const direction = String(trade.trade_type || '').toLowerCase() === 'buy' ? 1 : -1;
    const entryBrokerage = toNumber(
      trade.buy_brokerage !== undefined ? trade.buy_brokerage : trade.brokerage,
    );

    let currentPrice = storedCurrentPrice;
    let profit = storedProfit;

    if (openPrice > 0 && quantity > 0 && isMarketOpen(trade.symbol, trade.exchange)) {
      const priceState = resolveTradeablePrice({
        symbol: trade.symbol,
        side: direction === 1 ? 'sell' : 'buy',
        symbolRow: symbolMap.get(symbolKey) || null,
      });

      if (!priceState.isOffQuotes && priceState.price > 0) {
        currentPrice = toNumber(priceState.price, storedCurrentPrice);
        profit = ((currentPrice - openPrice) * direction * quantity) - entryBrokerage;
      }
    }

    return {
      ...trade,
      current_price: roundMoney(currentPrice),
      profit: roundMoney(profit),
    };
  });
}

module.exports = {
  buildOpenTradeSnapshots,
};
