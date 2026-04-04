const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');  // ← ADD THIS LINE
const { supabase } = require('../config/supabase');  // ← ADD THIS TOO
const marketController = require('../controllers/marketController');
const authModule = require('../middleware/auth');

// Resolve middleware safely no matter how auth.js exports it
const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : authModule.auth ||
      authModule.authenticate ||
      authModule.protect ||
      authModule.verifyToken ||
      authModule.default ||
      ((req, res, next) => next());

// Public market routes
router.get('/symbols', marketController.getSymbols);
router.get('/quote/:symbol', marketController.getQuote);
router.get('/candles/:symbol', marketController.getCandles);
router.get('/search', marketController.searchSymbols);

// Protected/admin sync route
router.post('/sync-instruments', authMiddleware, marketController.syncInstruments);

// Add at the end, before module.exports

// Debug endpoint to check symbol price status
router.get('/debug/:symbol', protect, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const kiteStreamService = require('../services/kiteStreamService');
    
    // Get from cache
    const cached = kiteStreamService.getPrice(symbol);
    
    // Get from DB
    const { data: dbSymbol } = await supabase
      .from('symbols')
      .select('*')
      .eq('symbol', symbol)
      .single();
    
    // Check token map
    const tokenMap = kiteStreamService.tokenToSymbols;
    let tokenInfo = null;
    for (const [token, entry] of tokenMap.entries()) {
      if (entry.symbols.includes(symbol)) {
        tokenInfo = { token, allSymbols: entry.symbols };
        break;
      }
    }
    
    res.json({
      success: true,
      symbol,
      cached: cached ? {
        last: cached.last,
        bid: cached.bid,
        ask: cached.ask,
        timestamp: cached.timestamp,
        ageSeconds: cached.timestamp ? Math.round((Date.now() - cached.timestamp) / 1000) : null,
      } : null,
      database: dbSymbol ? {
        last_price: dbSymbol.last_price,
        bid: dbSymbol.bid,
        ask: dbSymbol.ask,
        kite_instrument_token: dbSymbol.kite_instrument_token,
        last_update: dbSymbol.last_update,
        is_active: dbSymbol.is_active,
        expiry_date: dbSymbol.expiry_date,
      } : null,
      tokenMap: tokenInfo,
      streamStatus: kiteStreamService.status(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  DEBUG ENDPOINTS (remove in production)
// ═════════════════════════════════════════════════════════════

// Debug endpoint to check symbol price status
router.get('/debug/:symbol', protect, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const kiteStreamService = require('../services/kiteStreamService');
    
    // Get from cache
    const cached = kiteStreamService.getPrice(symbol);
    
    // Get from DB
    const { data: dbSymbol } = await supabase
      .from('symbols')
      .select('*')
      .eq('symbol', symbol)
      .single();
    
    // Check token map
    const tokenMap = kiteStreamService.tokenToSymbols;
    let tokenInfo = null;
    for (const [token, entry] of tokenMap.entries()) {
      if (entry.symbols.includes(symbol)) {
        tokenInfo = { token, allSymbols: entry.symbols };
        break;
      }
    }
    
    res.json({
      success: true,
      symbol,
      cached: cached ? {
        last: cached.last,
        bid: cached.bid,
        ask: cached.ask,
        timestamp: cached.timestamp,
        ageSeconds: cached.timestamp ? Math.round((Date.now() - cached.timestamp) / 1000) : null,
      } : null,
      database: dbSymbol ? {
        last_price: dbSymbol.last_price,
        bid: dbSymbol.bid,
        ask: dbSymbol.ask,
        kite_instrument_token: dbSymbol.kite_instrument_token,
        last_update: dbSymbol.last_update,
        is_active: dbSymbol.is_active,
        expiry_date: dbSymbol.expiry_date,
      } : null,
      tokenMap: tokenInfo,
      streamStatus: kiteStreamService.status(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Direct quote from Kite API (bypasses stream)
router.get('/kite-quote/:symbol', protect, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const kiteService = require('../services/kiteService');
    
    if (!kiteService.isSessionReady()) {
      return res.status(503).json({ success: false, message: 'Kite session not ready' });
    }
    
    // Get symbol's exchange from DB
    const { data: dbSymbol } = await supabase
      .from('symbols')
      .select('kite_exchange, kite_tradingsymbol')
      .eq('symbol', symbol)
      .single();
    
    const exchange = dbSymbol?.kite_exchange || 'NFO';
    const tradingsymbol = dbSymbol?.kite_tradingsymbol || symbol;
    
    const kite = kiteService.getKiteInstance();
    const quotes = await kite.getQuote([`${exchange}:${tradingsymbol}`]);
    
    const quote = quotes[`${exchange}:${tradingsymbol}`];
    if (!quote) {
      return res.status(404).json({ success: false, message: 'Quote not found' });
    }
    
    res.json({
      success: true,
      symbol,
      exchange,
      tradingsymbol,
      quote: {
        last: quote.last_price,
        bid: quote.depth?.buy?.[0]?.price || quote.last_price,
        ask: quote.depth?.sell?.[0]?.price || quote.last_price,
        open: quote.ohlc?.open,
        high: quote.ohlc?.high,
        low: quote.ohlc?.low,
        close: quote.ohlc?.close,
        volume: quote.volume,
        timestamp: quote.last_trade_time,
      },
    });
  } catch (error) {
    console.error('Kite quote error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

module.exports = router;