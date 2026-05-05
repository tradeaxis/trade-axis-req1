// backend/src/controllers/marketController.js
const { supabase } = require('../config/supabase');
const kiteService = require('../services/kiteService');
const kiteStreamService = require('../services/kiteStreamService');
const { getHolidayStatus, isAnyMarketOpen } = require('../services/marketStatus');
const { isAllowedSymbolRow } = require('../config/allowedKiteUniverse');
const { QUOTE_FRESHNESS_MS, getDbFreshness } = require('../services/quoteGuard');

const ALLOWED_CATEGORIES = [
  'index_futures',
  'stock_futures',
  'sensex_futures',
  'commodity_futures',
];

const SYMBOL_SELECT_FIELDS = [
  'symbol',
  'display_name',
  'underlying',
  'category',
  'segment',
  'instrument_type',
  'series',
  'expiry_date',
  'exchange',
  'bid',
  'ask',
  'last_price',
  'previous_close',
  'open_price',
  'high_price',
  'low_price',
  'change_value',
  'change_percent',
  'volume',
  'lot_size',
  'tick_size',
  'last_update',
].join(', ');

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const withQuoteFallback = (symbol) => {
  const fallbackPrice = firstPositiveNumber(
    symbol?.last_price,
    symbol?.previous_close,
    symbol?.close_price,
    symbol?.bid,
    symbol?.ask,
  );

  return {
    ...symbol,
    last_price: fallbackPrice,
    bid: firstPositiveNumber(symbol?.bid, fallbackPrice),
    ask: firstPositiveNumber(symbol?.ask, fallbackPrice),
  };
};

const withLiveQuote = (symbol) => {
  const live = kiteStreamService.getPrice(symbol?.symbol);
  if (!live?.last || Number(live.last) <= 0) return withQuoteFallback(symbol);

  return {
    ...symbol,
    last_price: Number(live.last || 0),
    bid: firstPositiveNumber(live.bid, live.last),
    ask: firstPositiveNumber(live.ask, live.last),
    open_price: firstPositiveNumber(live.open, symbol?.open_price),
    high_price: firstPositiveNumber(live.high, symbol?.high_price),
    low_price: firstPositiveNumber(live.low, symbol?.low_price),
    previous_close: firstPositiveNumber(live.prevClose, symbol?.previous_close),
    change_value: Number(live.change || 0),
    change_percent: Number(live.changePct || 0),
    volume: Number(live.volume || symbol?.volume || 0),
    last_update: new Date(Number(live.timestamp || Date.now())).toISOString(),
    source: 'kite_live',
  };
};

// In-memory symbol list cache — avoids repeated full-table scans
let _symbolCache     = null;
let _symbolCacheTime = 0;
const SYMBOL_CACHE_TTL_MS = 60_000; // refresh every 60 seconds

/** Get all futures symbols */
exports.getSymbols = async (req, res) => {
  try {
    const { category, search, limit = 5000 } = req.query;

    // Serve from cache for unfiltered requests (most common case)
    const now = Date.now();
    const useCache = !search && !category && _symbolCache && (now - _symbolCacheTime < SYMBOL_CACHE_TTL_MS);
    if (useCache) {
      const cachedSymbols = _symbolCache.slice(0, parseInt(limit)).map(withLiveQuote);
      return res.json({
        success: true,
        symbols: cachedSymbols,
        source: 'cache',
        total: _symbolCache.length,
      });
    }

    let allSymbols = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('symbols')
        .select(SYMBOL_SELECT_FIELDS)
        .eq('is_active', true)
        .eq('instrument_type', 'FUT')
        .order('underlying', { ascending: true })
        .order('expiry_date', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (category && ALLOWED_CATEGORIES.includes(category)) {
        query = query.eq('category', category);
      } else {
        query = query.in('category', ALLOWED_CATEGORIES);
      }

      // ── FIX: chain .or() on existing query (preserves category filter) ──
      if (search && search.trim()) {
        const term = search.trim();
        query = query.or(
          `symbol.ilike.%${term}%,display_name.ilike.%${term}%,underlying.ilike.%${term}%`
        );
      }

      const { data: batch, error } = await query;
      if (error) throw error;

      if (batch && batch.length > 0) {
        allSymbols = allSymbols.concat(batch);
        offset += batchSize;
        if (batch.length < batchSize || allSymbols.length >= parseInt(limit))
          hasMore = false;
      } else {
        hasMore = false;
      }
      if (offset >= 10000) hasMore = false;
    }

    allSymbols = allSymbols.filter(isAllowedSymbolRow);

    // Always include Gift Nifty if present in DB
    const { data: giftRows } = await supabase
      .from('symbols')
      .select(SYMBOL_SELECT_FIELDS)
      .eq('is_active', true)
      .or('symbol.ilike.%GIFT%NIFTY%,display_name.ilike.%GIFT%NIFTY%,underlying.ilike.%GIFT%NIFTY%')
      .limit(10);

    if (giftRows && giftRows.length > 0) {
      const seenSymbols = new Set(allSymbols.map((s) => s.symbol));
      giftRows.filter(isAllowedSymbolRow).forEach((g) => {
        if (!seenSymbols.has(g.symbol)) {
          allSymbols.unshift(g);
          seenSymbols.add(g.symbol);
        }
      });
    }

    if (allSymbols.length > parseInt(limit)) {
      allSymbols = allSymbols.slice(0, parseInt(limit));
    }

    allSymbols = allSymbols.map(withQuoteFallback);

// Store in cache only for unfiltered full fetches
    if (!search && !category) {
      _symbolCache     = allSymbols;
      _symbolCacheTime = Date.now();
    }

    res.json({
      success: true,
        symbols: allSymbols.map(withLiveQuote),
      source: 'zerodha',
      total: allSymbols.length,
    });
  } catch (error) {
    console.error('getSymbols error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Get quote with live price from memory cache */
exports.getQuote = async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!symbol)
      return res.status(400).json({ success: false, message: 'Symbol required' });

    const sym = symbol.toUpperCase();

    const { data: dbSym, error } = await supabase
      .from('symbols')
      .select('*')
      .eq('symbol', sym)
      .single();

    if (error || !dbSym) {
      return res.status(404).json({ success: false, message: 'Symbol not found' });
    }

    const live = kiteStreamService.getPrice(sym);
    const liveAgeMs = live?.timestamp ? Date.now() - live.timestamp : Number.POSITIVE_INFINITY;
    const hasLive = !!live && live.last > 0 && liveAgeMs <= QUOTE_FRESHNESS_MS;
    const dbFreshness = getDbFreshness(dbSym);
    const fallbackPrice = firstPositiveNumber(
      dbSym.last_price,
      dbSym.previous_close,
      dbSym.close_price,
      dbSym.bid,
      dbSym.ask,
    );

    const quote = {
      ...dbSym,
      last_price: hasLive ? live.last : fallbackPrice,
      previous_close: Number(dbSym.previous_close || 0),
      bid: hasLive ? live.bid : firstPositiveNumber(dbSym.bid, fallbackPrice),
      ask: hasLive ? live.ask : firstPositiveNumber(dbSym.ask, fallbackPrice),
      open_price: hasLive ? live.open : Number(dbSym.open_price || 0),
      high_price: hasLive ? live.high : Number(dbSym.high_price || 0),
      low_price: hasLive ? live.low : Number(dbSym.low_price || 0),
      change_value: hasLive ? live.change : Number(dbSym.change_value || 0),
      change_percent: hasLive ? live.changePct : Number(dbSym.change_percent || 0),
      timestamp: hasLive
        ? Number(live.timestamp || Date.now())
        : (dbSym.last_update ? new Date(dbSym.last_update).getTime() : 0),
      off_quotes: !hasLive && !dbFreshness.isFresh,
    };

    res.json({
      success: true,
      quote,
      source: hasLive ? 'kite_live' : 'database',
    });
  } catch (error) {
    console.error('getQuote error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Historical candles — Kite only */
exports.getCandles = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '15m', count = 300 } = req.query;

    const candles = await kiteService.getHistoricalCandles(
      symbol,
      timeframe,
      parseInt(count)
    );

    res.json({
      success: true,
      candles: candles || [],
      source: candles && candles.length > 0 ? 'kite' : 'none',
    });
  } catch (error) {
    console.error('getCandles error:', error);
    res.json({ success: true, candles: [], source: 'error' });
  }
};

/** Search symbols */
exports.searchSymbols = async (req, res) => {
  try {
    const { q, limit = 100 } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json({ success: true, symbols: [] });
    }

    const term = q.trim();

    const { data: symbols, error } = await supabase
      .from('symbols')
      .select(SYMBOL_SELECT_FIELDS)
      .eq('is_active', true)
      .eq('instrument_type', 'FUT')
      .in('category', ALLOWED_CATEGORIES)
      .or(
        `symbol.ilike.%${term}%,display_name.ilike.%${term}%,underlying.ilike.%${term}%`
      )
      .order('underlying', { ascending: true })
      .order('expiry_date', { ascending: true })
      .limit(parseInt(limit));

    if (error) throw error;

    const filteredSymbols = (symbols || []).filter(isAllowedSymbolRow).map(withQuoteFallback).map(withLiveQuote);
    res.json({ success: true, symbols: filteredSymbols, total: filteredSymbols.length });
  } catch (error) {
    console.error('searchSymbols error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const holidayStatus = getHolidayStatus();

    res.json({
      success: true,
      data: {
        ...holidayStatus,
        marketOpen: isAnyMarketOpen(),
        timestamp: new Date().toISOString(),
        timezone: 'Asia/Kolkata',
      },
    });
  } catch (error) {
    console.error('getStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Sync missing instruments from Kite API */
exports.syncInstruments = async (req, res) => {
  try {
    const { syncKiteInstruments } = require('../utils/syncKiteInstruments');
    const result = await syncKiteInstruments();

    if (result.success && result.upserted > 0) {
      try {
        const refreshResult = await kiteStreamService.refreshSubscriptions();
        console.log('🔄 Stream refreshed after sync:', refreshResult);
      } catch (e) {
        console.warn('⚠️ Stream refresh failed:', e.message);
      }
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Sync instruments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
