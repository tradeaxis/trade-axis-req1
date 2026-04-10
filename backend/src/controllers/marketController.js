// backend/src/controllers/marketController.js
const { supabase } = require('../config/supabase');
const kiteService = require('../services/kiteService');
const kiteStreamService = require('../services/kiteStreamService');
const marketDataService = require('../services/marketDataService');
const { isApprovedAliasSymbol } = require('../config/approvedFutures');

const ALLOWED_CATEGORIES = [
  'index_futures',
  'stock_futures',
  'sensex_futures',
  'commodity_futures',
];

/** Get all futures symbols */
/** Get all futures symbols */
exports.getSymbols = async (req, res) => {
  try {
    const { category, search, limit = 5000 } = req.query;

    let allSymbols = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('symbols')
        .select('*')
        .eq('is_active', true)
        .eq('instrument_type', 'FUT')
        .eq('series', 'I')
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

      const approvedBatch = (batch || []).filter((row) => isApprovedAliasSymbol(row.symbol));

      if (approvedBatch.length > 0) {
        allSymbols = allSymbols.concat(approvedBatch);
        offset += batchSize;
        if (batch.length < batchSize || allSymbols.length >= parseInt(limit))
          hasMore = false;
      } else {
        offset += batchSize;
        if (!batch || batch.length < batchSize || allSymbols.length >= parseInt(limit)) {
          hasMore = false;
        }
      }
      if (offset >= 10000) hasMore = false;
    }

    if (allSymbols.length > parseInt(limit)) {
      allSymbols = allSymbols.slice(0, parseInt(limit));
    }

    res.json({
      success: true,
      symbols: allSymbols,
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
    const quote = await marketDataService.getQuote(sym);

    if (!quote) {
      return res.status(404).json({ success: false, message: 'Symbol not found' });
    }

    res.json({
      success: true,
      quote,
      source: quote.source,
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
      .select('*')
      .eq('is_active', true)
      .eq('instrument_type', 'FUT')
      .eq('series', 'I')
      .in('category', ALLOWED_CATEGORIES)
      .or(
        `symbol.ilike.%${term}%,display_name.ilike.%${term}%,underlying.ilike.%${term}%`
      )
      .order('underlying', { ascending: true })
      .order('expiry_date', { ascending: true })
      .limit(parseInt(limit));

    if (error) throw error;

    const approvedSymbols = (symbols || []).filter((row) => isApprovedAliasSymbol(row.symbol));
    res.json({ success: true, symbols: approvedSymbols, total: approvedSymbols.length });
  } catch (error) {
    console.error('searchSymbols error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Sync missing instruments from Kite API */
exports.syncInstruments = async (req, res) => {
  try {
    const { syncApprovedKiteInstruments } = require('../utils/syncApprovedKiteInstruments');
    const result = await syncApprovedKiteInstruments();

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
