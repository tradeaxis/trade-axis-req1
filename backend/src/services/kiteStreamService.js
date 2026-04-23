// backend/src/services/kiteStreamService.js  ── FIXED VERSION
//
// KEY FIXES:
// 1. bid/ask: when mode != 'full', depth is empty → use last ± tick_size spread
// 2. Symbol room emission: emit to BOTH the raw kite symbol AND all alias symbols
// 3. Correct OHLC field mapping (dayHigh/dayLow from t.ohlc, NOT confused with prevClose)
// 4. Added tick_size per symbol for spread calculation fallback

const { KiteTicker } = require('kiteconnect');
const { supabase } = require('../config/supabase');
const kiteService = require('./kiteService');
const { isAllowedSymbolRow } = require('../config/allowedKiteUniverse');

// Default spread per segment when depth is unavailable (mode != 'full')
// These are conservative estimates; actual spread depends on liquidity
const DEFAULT_TICK_SIZES = {
  NFO:  0.05,   // Equity futures
  MCX:  1.00,   // Commodity futures (varies by contract)
  BFO:  0.05,   // BSE futures
  NSE:  0.05,
  BSE:  0.05,
  MCX_SX: 0.25,
};

const getPreferredContractRow = (rows = [], now = new Date()) => {
  if (!rows.length) return null;

  const today = now.toISOString().slice(0, 10);
  const rollToNextMonth = now.getDate() >= 20;
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const sorted = [...rows].sort((a, b) => {
    const aExpiry = String(a.expiry_date || '9999-12-31');
    const bExpiry = String(b.expiry_date || '9999-12-31');
    if (aExpiry !== bExpiry) return aExpiry.localeCompare(bExpiry);

    const aSeries = String(a.series || '');
    const bSeries = String(b.series || '');
    if (aSeries && !bSeries) return -1;
    if (!aSeries && bSeries) return 1;
    return String(a.symbol || '').localeCompare(String(b.symbol || ''));
  });

  const upcoming = sorted.filter((row) => !row.expiry_date || row.expiry_date >= today);
  if (upcoming.length === 0) return sorted[0];

  if (!rollToNextMonth) return upcoming[0];

  const nextMonthRow = upcoming.find((row) => {
    if (!row.expiry_date) return false;
    const expiry = new Date(row.expiry_date);
    return expiry.getFullYear() > currentYear || expiry.getMonth() > currentMonth;
  });

  return nextMonthRow || upcoming[0];
};

class KiteStreamService {
  constructor() {
    this.ticker      = null;
    this.io          = null;
    this.running     = false;
    this.lastTickAt  = null;

    // token → { symbols: string[], tickSize: number, exchange: string }
    this.tokenToSymbols = new Map();

    // Live price cache: symbol (uppercase) → priceData
    this.priceCache = new Map();
    this.lastEmitAt = new Map();
    this.underlyingCount = 0;
    this.mappedSymbolCount = 0;

    // Dirty symbols for DB flush
    this.dirtySymbols   = new Set();
    this.dbFlushInterval= null;
    this.DB_FLUSH_MS    = 3000;
    this.EMIT_INTERVAL_MS = 3000;
  }

  isRunning() { return this.running; }

  getPrice(symbol) {
    return this.priceCache.get(String(symbol).toUpperCase()) || null;
  }

  getPrices(symbols) {
    const out = {};
    for (const s of symbols) {
      const k = String(s).toUpperCase();
      const c = this.priceCache.get(k);
      if (c) out[k] = c;
    }
    return out;
  }

  // ── Build token → symbol(s) map ──────────────────────────────────────────
  // Each instrument_token maps to:
  //   • The raw Kite tradingsymbol (e.g. "NIFTY26MARFUT")
  //   • Any series aliases pointing to the same token (e.g. "NIFTY-I")
  // We need to emit price updates to ALL of them.
  async buildTokenMap() {
    const { data, error } = await supabase
      .from('symbols')
      .select('symbol, kite_instrument_token, kite_exchange, tick_size, underlying, kite_tradingsymbol, display_name, instrument_type, expiry_date, series')
      .eq('is_active', true)
      .eq('instrument_type', 'FUT')
      .not('kite_instrument_token', 'is', null);

    if (error) throw error;

    const allowedRows = (data || []).filter(isAllowedSymbolRow);

    const [openTradesRes, pendingOrdersRes] = await Promise.all([
      supabase.from('trades').select('symbol').eq('status', 'open'),
      supabase.from('pending_orders').select('symbol').eq('status', 'pending'),
    ]);

    const forcedSymbols = new Set(
      [...(openTradesRes.data || []), ...(pendingOrdersRes.data || [])]
        .map((row) => String(row.symbol || '').toUpperCase())
        .filter(Boolean),
    );

    const rowsByUnderlying = new Map();
    for (const row of allowedRows) {
      const key = String(row.underlying || row.symbol || '').toUpperCase();
      if (!rowsByUnderlying.has(key)) rowsByUnderlying.set(key, []);
      rowsByUnderlying.get(key).push(row);
    }

    const now = new Date();
    const selectedTokens = new Set();
    const selectedUnderlyingKeys = new Set();

    for (const [underlyingKey, rows] of rowsByUnderlying.entries()) {
      const preferred = getPreferredContractRow(rows, now);

      if (!preferred?.kite_instrument_token) continue;
      selectedTokens.add(Number(preferred.kite_instrument_token));
      selectedUnderlyingKeys.add(underlyingKey);
    }

    for (const row of allowedRows) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (forcedSymbols.has(symbol) && row.kite_instrument_token) {
        selectedTokens.add(Number(row.kite_instrument_token));
      }
    }

    const map = new Map(); // token → { symbols: [], tickSize, exchange }
    for (const row of allowedRows) {
      const token    = Number(row.kite_instrument_token);
      if (!selectedTokens.has(token)) continue;

      const tickSize = Number(row.tick_size || 0.05);
      const exchange = String(row.kite_exchange || 'NFO').toUpperCase();

      if (!map.has(token)) {
        map.set(token, { symbols: [], tickSize, exchange });
      }
      const symbol = row.symbol.toUpperCase();
      if (!map.get(token).symbols.includes(symbol)) {
        map.get(token).symbols.push(symbol);
      }
    }

    this.tokenToSymbols = map;
    this.underlyingCount = selectedUnderlyingKeys.size;
    this.mappedSymbolCount = [...map.values()].reduce((n, v) => n + v.symbols.length, 0);
    console.log(`🗺️  Token map built: ${map.size} unique tokens → covering ${this.mappedSymbolCount} symbols across ${this.underlyingCount} underlyings`);
    return map;
  }

  async start(io) {
    this.io = io;

    // DON'T call init(true) here — it re-reads from DB which may have stale data
    // due to async write race condition. Instead, just check if kiteService 
    // already has a valid in-memory token (set by generateSession).
    if (!kiteService.isSessionReady()) {
      // Only try DB fallback if no in-memory token exists (e.g., server restart)
      await kiteService.init(true);
      if (!kiteService.isSessionReady()) {
        console.log('ℹ️ Kite session not ready. Stream not started.');
        return { started: false, reason: 'kite session not ready' };
      }
    }

    await this.buildTokenMap();

    const tokens = Array.from(this.tokenToSymbols.keys());
    if (tokens.length === 0) {
      console.log('ℹ️ No kite instrument tokens found.');
      return { started: false, reason: 'no tokens' };
    }

    const apiKey      = process.env.KITE_API_KEY;
    const accessToken = kiteService.accessToken;

    if (!accessToken) {
      console.log('❌ No access token available for stream.');
      return { started: false, reason: 'no access token' };
    }
    
    console.log('🔑 Stream using token (first 10):', accessToken.substring(0, 10) + '...');

    this.ticker  = new KiteTicker({ api_key: apiKey, access_token: accessToken });
    this.running = true;

    // ── Tick mode ────────────────────────────────────────────────────────────
    // 'full'  → LTP + OHLC + depth (best for bid/ask)
    // 'quote' → LTP + OHLC, no depth (bid = ask = LTP, we add ½ tick spread)
    // 'ltp'   → only LTP
    // Recommendation: use 'full' for accurate bid/ask
    const mode = String(process.env.KITE_TICK_MODE || 'full').toLowerCase();

    this.ticker.on('connect', () => {
      console.log(`✅ KiteTicker connected. Subscribing ${tokens.length} tokens [mode: ${mode}]`);
      this.ticker.subscribe(tokens);
      this.ticker.setMode(mode, tokens);
    });

    this.ticker.on('ticks', (ticks) => {
      this.lastTickAt = new Date().toISOString();
      this.handleTicks(ticks, mode);
    });

    // Track if we've received a 403 — prevents reconnect loop
    let sessionExpired = false;

    this.ticker.on('error', (err) => {
      const msg = err?.message || String(err);
      console.error('❌ KiteTicker error:', msg);
      
      if (msg.includes('403') || msg.includes('Forbidden')) {
        if (sessionExpired) return; // Already handled, don't spam logs
        sessionExpired = true;
        
        console.error('🔴 ═══════════════════════════════════════════════════');
        console.error('🔴 KITE SESSION EXPIRED — Prices will NOT update!');
        console.error('🔴 Go to Admin Panel → Kite Setup → Create new session');
        console.error('🔴 ═══════════════════════════════════════════════════');
        this.running = false;
        
        // Forcefully stop — set autoReconnect to false before disconnecting
        try {
          if (this.ticker) {
            this.ticker.autoReconnect = false;  // Prevent KiteTicker from auto-reconnecting
            this.ticker.disconnect();
            this.ticker = null;
          }
        } catch (e) {
          // ignore disconnect errors
        }

        // Clear flush interval since no prices will come
        if (this.dbFlushInterval) {
          clearInterval(this.dbFlushInterval);
          this.dbFlushInterval = null;
        }
        
        if (this.io) {
          this.io.emit('kite:session:expired', {
            message: 'Kite session expired. Prices are stale. Admin must re-authenticate.',
            timestamp: Date.now(),
          });
        }
      }
    });

    this.ticker.on('close', () => {
      console.log('❌ KiteTicker closed');
      this.running = false;
    });

    this.ticker.on('reconnect', () => {
      if (sessionExpired) {
        console.log('🚫 Blocking reconnect — session expired. Create new session first.');
        try {
          if (this.ticker) {
            this.ticker.autoReconnect = false;
            this.ticker.disconnect();
            this.ticker = null;
          }
        } catch (e) {}
        return;
      }
      console.log('🔄 KiteTicker reconnecting...');
      this.running = true;
    });

    this.ticker.connect();
    this.startDBFlush();

    return {
      started: true,
      tokens: tokens.length,
      underlyingCount: this.underlyingCount,
      mappedSymbolCount: this.mappedSymbolCount,
      emitIntervalSeconds: Math.round(this.EMIT_INTERVAL_MS / 1000),
      dbFlushSeconds: Math.round(this.DB_FLUSH_MS / 1000),
      mode,
    };
  }

  async stop() {
    try {
      if (this.dbFlushInterval) { clearInterval(this.dbFlushInterval); this.dbFlushInterval = null; }
      await this.flushToDB();
      if (this.ticker) {
        try {
          this.ticker.autoReconnect = false;
        } catch (e) {}
        try {
          this.ticker.disconnect();
        } catch (e) {}
        this.ticker = null;
      }
    } finally {
      this.running = false;
      // Clear all cached prices — they're stale now
      this.priceCache.clear();
      this.dirtySymbols.clear();
      this.tokenToSymbols.clear();
      this.lastEmitAt.clear();
      this.underlyingCount = 0;
      this.mappedSymbolCount = 0;
    }
    console.log('🛑 KiteStreamService fully stopped. Price cache cleared.');
    return { stopped: true };
  }

  // ── Main tick handler ─────────────────────────────────────────────────────
  handleTicks(ticks, mode = 'full') {
    if (!ticks || ticks.length === 0) return;

    // DEBUG: Log tick batches (sample every 50 to avoid spam)
    if (!this._tickCounter) this._tickCounter = 0;
    this._tickCounter++;
    
    if (this._tickCounter % 50 === 1) {
      const now = new Date().toISOString().slice(11, 19);
      const samples = ticks.slice(0, 3).map(t => {
        const syms = this.tokenToSymbols.get(Number(t.instrument_token))?.symbols || ['?'];
        return `${syms[0]}:${t.last_price}`;
      }).join(', ');
      console.log(`[${now}] 📊 Batch #${this._tickCounter}: ${ticks.length} ticks (${samples}...)`);
    }

    for (const t of ticks) {
      const token    = Number(t.instrument_token);
      const entry    = this.tokenToSymbols.get(token);
      if (!entry || entry.symbols.length === 0) continue;

      const last = Number(t.last_price || 0);
      if (last <= 0) continue;

      // ── OHLC ─────────────────────────────────────────────────────────────
      // Kite tick OHLC structure (confirmed from Kite docs):
      //   t.ohlc.open  = today's open
      //   t.ohlc.high  = today's high
      //   t.ohlc.low   = today's low
      //   t.ohlc.close = PREVIOUS DAY's close (not today's close)
      const ohlc      = t.ohlc || {};
      const dayOpen   = Number(ohlc.open  || 0);
      const dayHigh   = Number(ohlc.high  || 0);
      const dayLow    = Number(ohlc.low   || 0);
      const prevClose = Number(ohlc.close || 0);   // previous day close

      const chgVal    = prevClose > 0 ? last - prevClose : 0;
      const chgPct    = prevClose > 0 ? (chgVal / prevClose) * 100 : 0;

      // ── Bid / Ask resolution ─────────────────────────────────────────────
      // 'full' mode: use market depth (most accurate)
      // 'quote'/'ltp' mode: no depth available → simulate spread using tick_size
      let bid, ask;

      const hasDepth = mode === 'full' && t.depth?.buy?.length && t.depth?.sell?.length;

      if (hasDepth) {
        const depthBid = Number(t.depth.buy[0].price  || 0);
        const depthAsk = Number(t.depth.sell[0].price || 0);
        // Use depth only if valid and within 1% of last (guards against stale depth)
        const bidValid = depthBid > 0 && Math.abs(depthBid - last) / last < 0.01;
        const askValid = depthAsk > 0 && Math.abs(depthAsk - last) / last < 0.01;
        bid = bidValid ? depthBid : last;
        ask = askValid ? depthAsk : last;
      } else {
        // Spread simulation: 1 tick on each side
        const tickSize = entry.tickSize > 0 ? entry.tickSize
          : (DEFAULT_TICK_SIZES[entry.exchange] || 0.05);
        bid = parseFloat((last - tickSize).toFixed(2));
        ask = parseFloat((last + tickSize).toFixed(2));
        if (bid <= 0) bid = last;
      }

      const priceData = {
        last,
        bid,
        ask,
        open:      dayOpen   > 0 ? dayOpen   : last,
        high:      dayHigh   > 0 ? dayHigh   : last,
        low:       dayLow    > 0 ? dayLow    : last,
        prevClose: prevClose || last,
        change:    parseFloat(chgVal.toFixed(2)),
        changePct: parseFloat(chgPct.toFixed(2)),
        volume:    Number(t.volume_traded || t.volume || 0),
        timestamp: Date.now(),
      };

      // ── Emit to ALL alias symbols for this token ─────────────────────────
      for (const sym of entry.symbols) {
        // Update cache
        this.priceCache.set(sym, priceData);
        this.dirtySymbols.add(sym);

        // Emit to socket room for this symbol (frontend subscribes to symbol name)
        if (this.io) {
          const emitTs = Date.now();
          const lastEmitAt = this.lastEmitAt.get(sym) || 0;
          if (emitTs - lastEmitAt < this.EMIT_INTERVAL_MS) continue;
          this.lastEmitAt.set(sym, emitTs);

          const room = `symbol:${sym}`;
          
          // Sample logging: 1% of emissions when debugging
          if (this._tickCounter % 100 === 1 && Math.random() < 0.1) {
            const roomSize = this.io.sockets.adapter.rooms.get(room)?.size || 0;
            if (roomSize > 0) {
              console.log(`📤 ${sym}: ${last} → ${roomSize} client(s)`);
            }
          }
          
          this.io.to(room).emit('price:update', {
            symbol:        sym,
            bid,
            ask,
            last,
            open:          priceData.open,
            high:          priceData.high,
            low:           priceData.low,
            change:        priceData.change,
            changePercent: priceData.changePct,
            volume:        priceData.volume,
            timestamp:     emitTs,
            source:        'kite',
          });
        }
      }
    }
  }

  startDBFlush() {
    if (this.dbFlushInterval) clearInterval(this.dbFlushInterval);
    this.dbFlushInterval = setInterval(() => {
      this.flushToDB().catch(err => console.error('DB flush error:', err.message));
    }, this.DB_FLUSH_MS);
    console.log(`💾 DB price flush every ${this.DB_FLUSH_MS / 1000}s`);
  }

  async flushToDB() {
    if (this.dirtySymbols.size === 0) return;

    const toFlush = [...this.dirtySymbols];
    this.dirtySymbols.clear();
    const now = new Date().toISOString();

    // Batch by identical price data to minimise DB round-trips
    const groups = new Map();
    for (const sym of toFlush) {
      const p = this.priceCache.get(sym);
      if (!p) continue;
      const key = `${p.last}|${p.bid}|${p.ask}`;
      if (!groups.has(key)) groups.set(key, { price: p, symbols: [] });
      groups.get(key).symbols.push(sym);
    }

    const promises = [];
    for (const [, { price, symbols }] of groups) {
      promises.push(
        supabase.from('symbols').update({
          last_price:     price.last,
          bid:            price.bid,
          ask:            price.ask,
          open_price:     price.open,
          high_price:     price.high,
          low_price:      price.low,
          previous_close: price.prevClose,
          change_value:   price.change,
          change_percent: price.changePct,
          volume:         price.volume,
          last_update:    now,
        }).in('symbol', symbols)
      );
    }

    await Promise.all(promises);
  }

  status() {
    const now = Date.now();
    const lastTick = this.lastTickAt ? new Date(this.lastTickAt).getTime() : 0;
    const tickAge = lastTick > 0 ? Math.round((now - lastTick) / 1000) : null;
    
    return {
      running:           this.running,
      lastTickAt:        this.lastTickAt,
      tickAgeSeconds:    tickAge,
      sessionExpired:    this.lastTickAt === null && !this.running,
      tokenCount:        this.tokenToSymbols?.size || 0,
      underlyingCount:   this.underlyingCount || 0,
      mappedSymbolCount: this.mappedSymbolCount || 0,
      cachedPrices:      this.priceCache.size,
      pendingDBWrites:   this.dirtySymbols.size,
      emitIntervalSeconds: Math.round(this.EMIT_INTERVAL_MS / 1000),
      dbFlushSeconds:    Math.round(this.DB_FLUSH_MS / 1000),
      warning:           this.lastTickAt === null 
        ? '⚠️ No ticks received — Kite session may be expired. Re-authenticate in Admin Panel.'
        : (tickAge && tickAge > 60 ? `⚠️ Last tick was ${tickAge}s ago — stream may be stalled` : null),
    };
  }

  async refreshSubscriptions() {
    if (!this.ticker || !this.running) {
      console.log('ℹ️ Ticker not running, skip refresh');
      return { refreshed: false };
    }

    const previousTokens = Array.from(this.tokenToSymbols.keys());
    const oldCount = previousTokens.length;
    await this.buildTokenMap();
    const newCount = this.tokenToSymbols.size;

    const tokens = Array.from(this.tokenToSymbols.keys());
    const mode   = String(process.env.KITE_TICK_MODE || 'full').toLowerCase();

    const removedTokens = previousTokens.filter((token) => !this.tokenToSymbols.has(token));
    if (removedTokens.length > 0 && typeof this.ticker.unsubscribe === 'function') {
      this.ticker.unsubscribe(removedTokens);
    }

    this.ticker.subscribe(tokens);
    this.ticker.setMode(mode, tokens);

    console.log(`🔄 Refreshed subscriptions: ${oldCount} → ${newCount} tokens`);
    return { refreshed: true, oldCount, newCount, removedCount: removedTokens.length };
  }
}

module.exports = new KiteStreamService();
