// backend/src/services/marketDataService.js  ── FIXED VERSION
//
// KEY FIXES:
// 1. getQuote() returns correct field names that match what frontend expects
// 2. Falls back to DB price fields correctly (high_price, low_price, open_price)
// 3. No simulation anywhere — only Kite live or DB fallback

const { supabase } = require('../config/supabase');
const kiteService      = require('./kiteService');
const kiteStreamService= require('./kiteStreamService');

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

class MarketDataService {
  constructor() {
    this.metaCache = new Map();
    this.META_TTL  = 60000; // 60s for static symbol metadata
  }

  /**
   * Get quote: memory cache first → DB fallback
   * Returns fields that match what frontend marketStore.getQuote() expects.
   */
  async getQuote(symbol) {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return null;

    // 1. Live price from kiteStreamService memory (instant)
    const live = kiteStreamService.getPrice(sym);

    // 2. Static metadata (lot_size, tick_size, display_name, etc.)
    let meta = this.metaCache.get(sym);
    if (!meta || Date.now() - meta.ts > this.META_TTL) {
      const { data, error } = await supabase
        .from('symbols')
        .select('*')
        .eq('symbol', sym)
        .single();

      if (error || !data) return null;
      meta = { d: data, ts: Date.now() };
      this.metaCache.set(sym, meta);
    }

    const d = meta.d;

    // ── Resolve prices ────────────────────────────────────────────────────
    // DB columns: last_price, bid, ask, open_price, high_price, low_price,
    //             previous_close, change_value, change_percent
    const fallbackPrice = firstPositiveNumber(
      d.last_price,
      d.previous_close,
      d.close_price,
      d.bid,
      d.ask,
    );
    const lastPrice  = live ? live.last      : fallbackPrice;
    const bidPrice   = live ? live.bid       : firstPositiveNumber(d.bid, fallbackPrice);
    const askPrice   = live ? live.ask       : firstPositiveNumber(d.ask, fallbackPrice);
    const openPrice  = live ? live.open      : Number(d.open_price    || 0);
    const highPrice  = live ? live.high      : Number(d.high_price    || 0);
    const lowPrice   = live ? live.low       : Number(d.low_price     || 0);
    const prevClose  = live ? live.prevClose : firstPositiveNumber(d.previous_close, fallbackPrice);
    const changeVal  = live ? live.change    : Number(d.change_value  || 0);
    const changePct  = live ? live.changePct : Number(d.change_percent|| 0);
    const dbLastUpdate = d.last_update ? new Date(d.last_update).getTime() : 0;
    const isDbStale = !dbLastUpdate || (Date.now() - dbLastUpdate > 30 * 60 * 1000);

    return {
      // ── Identity ──
      symbol:      d.symbol,
      displayName: d.display_name,
      display_name:d.display_name,
      exchange:    d.exchange,
      category:    d.category,
      underlying:  d.underlying,
      expiryDate:  d.expiry_date,
      expiry_date: d.expiry_date,

      // ── Prices ── (both camelCase and snake_case for compatibility)
      lastPrice,
      last_price: lastPrice,
      last:       lastPrice,
      bid:        bidPrice,
      ask:        askPrice,

      // ── OHLC ──
      open:       openPrice,
      open_price: openPrice,
      high:       highPrice,
      high_price: highPrice,
      low:        lowPrice,
      low_price:  lowPrice,
      previousClose:  prevClose,
      previous_close: prevClose,

      // ── Change ──
      change:         changeVal,
      change_value:   changeVal,
      changePercent:  changePct,
      change_percent: changePct,

      // ── Volume & contract info ──
      volume:   live ? live.volume : Number(d.volume   || 0),
      lotSize:  Number(d.lot_size  || 1),
      lot_size: Number(d.lot_size  || 1),
      tickSize: Number(d.tick_size || 0.05),
      tick_size:Number(d.tick_size || 0.05),

      // ── Meta ──
      timestamp:  live ? live.timestamp : (dbLastUpdate || Date.now()),
      source:     live ? 'kite' : 'db',
      off_quotes: !live && (!fallbackPrice || fallbackPrice <= 0 || isDbStale),
    };
  }

  async getQuotes(symbols) {
    const out = {};
    for (const s of symbols || []) {
      const q = await this.getQuote(s);
      if (q) out[String(s).toUpperCase()] = q;
    }
    return out;
  }

  /** Candles from Kite historical API */
  async getCandles(symbol, timeframe = '15m', count = 300) {
    try {
      const candles = await kiteService.getHistoricalCandles(
        String(symbol).toUpperCase(), timeframe, Number(count) || 300
      );
      return candles || [];
    } catch (e) {
      console.error('getCandles error:', e.message);
      return [];
    }
  }
}

module.exports = new MarketDataService();
