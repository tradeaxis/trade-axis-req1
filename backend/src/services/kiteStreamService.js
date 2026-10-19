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
const { isAnyMarketOpen } = require('./marketStatus');

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

const getSeriesPriority = (series = '') => {
  const value = String(series || '').toUpperCase();
  if (value === 'I') return 0;
  if (value === 'II') return 1;
  if (value === 'III') return 2;
  if (!value) return 3;
  return 4;
};

const getUpcomingContractRows = (rows = [], now = new Date(), maxContracts = 2) => {
  if (!rows.length) return [];

  const today = now.toISOString().slice(0, 10);

  const sorted = [...rows].sort((a, b) => {
    const aExpiry = String(a.expiry_date || '9999-12-31');
    const bExpiry = String(b.expiry_date || '9999-12-31');
    if (aExpiry !== bExpiry) return aExpiry.localeCompare(bExpiry);

    const aPriority = getSeriesPriority(a.series);
    const bPriority = getSeriesPriority(b.series);
    if (aPriority !== bPriority) return aPriority - bPriority;

    return String(a.symbol || '').localeCompare(String(b.symbol || ''));
  });

  const upcoming = sorted.filter((row) => !row.expiry_date || row.expiry_date >= today);
  const sourceRows = upcoming.length > 0 ? upcoming : sorted;
  const targetCount = Math.max(1, maxContracts);
  const selectedRows = [];
  const seenExpiryKeys = new Set();

  for (const row of sourceRows) {
    const expiryKey = String(row.expiry_date || row.kite_instrument_token || row.symbol || '');
    if (seenExpiryKeys.has(expiryKey)) continue;

    selectedRows.push(row);
    seenExpiryKeys.add(expiryKey);

    if (selectedRows.length >= targetCount) break;
  }

  return selectedRows;
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const getContractMonthKey = (value = '') => {
  const raw = String(value || '').toUpperCase().trim();
  if (!raw) return '';

  const monthPattern = MONTHS.join('|');
  const spaced = raw.replace(/\s+/g, '');
  const labelMatch = spaced.match(new RegExp(`[-_](${monthPattern})$`, 'i'));
  if (labelMatch) return labelMatch[1].toUpperCase();

  const compact = spaced.replace(/[-_]/g, '');
  const kiteMatch = compact.match(new RegExp(`\\d{2}(${monthPattern})(\\d{2})?FUT$`, 'i'));
  if (kiteMatch) return kiteMatch[1].toUpperCase();

  const displayMatch = compact.match(new RegExp(`(${monthPattern})(\\d{2})?FUT$`, 'i'));
  return displayMatch ? displayMatch[1].toUpperCase() : '';
};

const getRowContractMonthKey = (row = {}) => (
  getContractMonthKey(row.symbol) ||
  getContractMonthKey(row.kite_tradingsymbol) ||
  getContractMonthKey(row.display_name) ||
  (row.expiry_date ? MONTHS[new Date(row.expiry_date).getMonth()] || '' : '')
);

const getRowExpiryDateKey = (row = {}) => {
  const date = String(row.expiry_date || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date || '';
};

const quoteMatchesRowIdentity = (quote, row = {}) => {
  if (!quote) return false;

  const expectedMonth = getRowContractMonthKey(row);
  const expectedExpiry = getRowExpiryDateKey(row);
  if (expectedMonth && quote.contractMonth && quote.contractMonth !== expectedMonth) return false;
  if (expectedExpiry && quote.expiryDate && quote.expiryDate !== expectedExpiry) return false;
  return true;
};

const normalizePriceLookupKey = (value = '') =>
  String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-_](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i, '')
    .replace(/[-_][IVX]+$/i, '')
    .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[^A-Z0-9]/g, '');

const getRowPriceAliases = (row = {}) => {
  const aliases = new Set(
    [row.symbol, row.kite_tradingsymbol, row.display_name]
      .map((value) => String(value || '').toUpperCase().trim())
      .filter(Boolean)
  );

  const underlying = String(row.underlying || row.display_name || row.symbol || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-_][IVX]+$/i, '')
    .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[^A-Z0-9]/g, '');

  const month = getRowContractMonthKey(row);
  if (underlying && month) aliases.add(`${underlying}-${month}`);

  return [...aliases];
};

class KiteStreamService {
  constructor() {
    this.ticker      = null;
    this.io          = null;
    this.running     = false;
    this.lastTickAt  = null;
    this.activeSource = 'kite';

    // token → { symbols: string[], tickSize: number, exchange: string }
    this.tokenToSymbols = new Map();

    // Live price cache: symbol (uppercase) → priceData
    this.priceCache = new Map();
    this.tokenPriceCache = new Map();
    this.lastEmitAt = new Map();
    this.lastTickAtByToken = new Map();
    this.lastRepairAtByToken = new Map();
    this.underlyingCount = 0;
    this.mappedSymbolCount = 0;
    this.subscriptionMaintenanceInterval = null;
    this.subscriptionRefreshInterval = null;
    this.subscriptionRefreshInFlight = false;
    this.quoteRepairInFlight = false;
    this.lastSubscriptionRepairAt = null;

    // Dirty symbols for DB flush
    this.dirtySymbols   = new Set();
    this.dbFlushInterval= null;
    this.DB_FLUSH_MS      = Number(process.env.KITE_DB_FLUSH_MS || 30000);
    this.EMIT_INTERVAL_MS = Number(process.env.KITE_EMIT_INTERVAL_MS || 1000);
    // The dashboard marks a subscribed quote off-quotes after 15 seconds.
    // Keep the stream recovery window safely below that limit, even when a
    // stale value remains in the environment from an older deployment.
    const configuredStaleMs = Number(process.env.KITE_STALE_TOKEN_MS);
    const configuredCooldownMs = Number(process.env.KITE_TOKEN_REPAIR_COOLDOWN_MS);
    const configuredCheckMs = Number(process.env.KITE_TOKEN_REPAIR_CHECK_MS);
    this.STALE_TOKEN_MS = Number.isFinite(configuredStaleMs)
      ? Math.min(Math.max(configuredStaleMs, 2_000), 8_000)
      : 8_000;
    this.TOKEN_REPAIR_COOLDOWN_MS = Number.isFinite(configuredCooldownMs)
      ? Math.min(Math.max(configuredCooldownMs, 3_000), 8_000)
      : 5_000;
    this.TOKEN_REPAIR_CHECK_MS = Number.isFinite(configuredCheckMs)
      ? Math.min(Math.max(configuredCheckMs, 1_000), 3_000)
      : 3_000;
    this.SUBSCRIPTION_REFRESH_MS = Number(process.env.KITE_SUBSCRIPTION_REFRESH_MS || 300000);
  }

  isRunning() { return this.running; }

  getPrice(symbol) {
    const raw = String(symbol || '').toUpperCase();
    if (!raw) return null;

    const requestedMonth = getContractMonthKey(raw);
    const exact = this.priceCache.get(raw);
    if (exact && (!requestedMonth || exact.contractMonth === requestedMonth)) return exact;

    const lookupKey = normalizePriceLookupKey(raw);
    if (!lookupKey) return null;

    const matches = [];
    for (const [cachedSymbol, price] of this.priceCache.entries()) {
      if (normalizePriceLookupKey(cachedSymbol) !== lookupKey) continue;
      const cachedMonth = price.contractMonth || getContractMonthKey(cachedSymbol);
      if (requestedMonth && cachedMonth !== requestedMonth) continue;
      matches.push(price);
    }

    const uniqueTokens = new Set(matches.map((price) => price.instrumentToken || '').filter(Boolean));
    // A lookup by an underlying is only safe when it resolves to one token.
    // This also protects the month-qualified fallback from choosing the first
    // of two similarly-named rows during expiry rollover.
    return uniqueTokens.size === 1 ? matches[0] : null;
  }

  getPriceForSymbolRow(row = {}) {
    const token = Number(row.kite_instrument_token || 0);
    if (token > 0) {
      const tokenPrice = this.tokenPriceCache.get(token);
      // The Kite instrument token is the immutable contract identity. A quote
      // stored under this exact token has already been validated by
      // handleTicks()/the stale-quote repair, so optional display metadata
      // (month label or expiry formatting) must not discard it. That used to
      // incorrectly mark live contracts as off-quotes when those DB fields
      // differed in representation even though the token was identical.
      //
      // Do not fall back to a name lookup when the token is known: that could
      // cross an expiry at month-end. A missing or mismatched token remains
      // off-quotes until a quote for this exact contract arrives.
      return Number(tokenPrice?.instrumentToken || 0) === token ? tokenPrice : null;
    }

    const exactKeys = [row.symbol, row.kite_tradingsymbol, row.display_name]
      .map((value) => String(value || '').toUpperCase())
      .filter(Boolean);
    const requestedMonth = getRowContractMonthKey(row);

    for (const key of exactKeys) {
      const exact = this.priceCache.get(key);
      if (exact && !quoteMatchesRowIdentity(exact, row)) continue;
      if (exact) return exact;
    }

    if (requestedMonth) {
      for (const key of exactKeys) {
        const price = this.getPrice(key);
        if (price) return price;
      }
      return null;
    }

    // Never use an underlying-only fallback here. At month-end that can return
    // a valid tick for a different expiry, which is worse than showing an
    // off-quotes state until an exact quote arrives.
    return null;
  }

  getPrices(symbols) {
    const out = {};
    for (const s of symbols) {
      const k = String(s).toUpperCase();
      const c = this.getPrice(k);
      if (c) out[k] = c;
    }
    return out;
  }

  isCommoditySymbolRow(row = {}) {
    const source = [
      row.category,
      row.segment,
      row.exchange,
      row.kite_exchange,
      row.instrument_type,
      row.symbol,
      row.kite_tradingsymbol,
      row.display_name,
      row.underlying,
    ].join(' ').toUpperCase();

    return /MCX|COMMODITY|GOLD|SILVER|CRUDE|CRUDEOIL|NATURALGAS|COPPER|ZINC|ALUMINIUM|ALUMINI|LEAD|NICKEL|COTTON/.test(source);
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
    const validCacheAliases = new Set();
    for (const row of allowedRows) {
      const key = String(row.underlying || row.symbol || '').toUpperCase();
      if (!rowsByUnderlying.has(key)) rowsByUnderlying.set(key, []);
      rowsByUnderlying.get(key).push(row);
    }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const selectedTokens = new Set();
    const selectedUnderlyingKeys = new Set();

    for (const [underlyingKey, rows] of rowsByUnderlying.entries()) {
      const nextMonthDay = rows.some((row) => this.isCommoditySymbolRow(row)) ? 15 : 20;
      const preferredVisibleContracts = now.getDate() >= nextMonthDay ? 2 : 1;
      const selectedRows = getUpcomingContractRows(rows, now, preferredVisibleContracts);
      if (!selectedRows.length) continue;

      selectedRows.forEach((row) => {
        if (row?.kite_instrument_token) {
          selectedTokens.add(Number(row.kite_instrument_token));
        }
      });
      selectedUnderlyingKeys.add(underlyingKey);
    }

    for (const row of allowedRows) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (forcedSymbols.has(symbol) && row.kite_instrument_token) {
        selectedTokens.add(Number(row.kite_instrument_token));
      }
    }
    const aliasTokens = new Map();
    for (const row of allowedRows) {
      const token = Number(row.kite_instrument_token);
      if (!selectedTokens.has(token)) continue;
      for (const symbol of getRowPriceAliases(row)) {
        if (!aliasTokens.has(symbol)) aliasTokens.set(symbol, new Set());
        aliasTokens.get(symbol).add(token);
      }
    }
    const map = new Map();
    for (const row of allowedRows) {
      const token    = Number(row.kite_instrument_token);
      if (!selectedTokens.has(token)) continue;

      const tickSize = Number(row.tick_size || 0.05);
      const exchange = String(row.kite_exchange || 'NFO').toUpperCase();
      const contractMonth = getRowContractMonthKey(row);

      const expiryDate = getRowExpiryDateKey(row);
      if (!map.has(token)) {
        map.set(token, {
          symbols: [],
          tickSize,
          exchange,
          contractMonth,
          expiryDate,
          tradingSymbol: String(row.kite_tradingsymbol || row.symbol || '').toUpperCase(),
        });
      } else {
        if (!map.get(token).contractMonth && contractMonth) {
          map.get(token).contractMonth = contractMonth;
        }
        if (!map.get(token).expiryDate && expiryDate) {
          map.get(token).expiryDate = expiryDate;
        }
        if (!map.get(token).tradingSymbol && row.kite_tradingsymbol) {
          map.get(token).tradingSymbol = String(row.kite_tradingsymbol).toUpperCase();
        }
      }
      for (const symbol of getRowPriceAliases(row)) {
        if ((aliasTokens.get(symbol)?.size || 0) > 1) continue;
        validCacheAliases.add(symbol);
        if (!map.get(token).symbols.includes(symbol)) {
          map.get(token).symbols.push(symbol);
        }
      }
    }

    for (const cachedSymbol of this.priceCache.keys()) {
      if (!validCacheAliases.has(cachedSymbol)) {
        this.priceCache.delete(cachedSymbol);
        this.lastEmitAt.delete(cachedSymbol);
      }
    }

    for (const cachedToken of this.tokenPriceCache.keys()) {
      if (!map.has(cachedToken)) {
        this.tokenPriceCache.delete(cachedToken);
      }
    }
    for (const token of this.lastTickAtByToken.keys()) {
      if (!map.has(token)) this.lastTickAtByToken.delete(token);
    }
    for (const token of this.lastRepairAtByToken.keys()) {
      if (!map.has(token)) this.lastRepairAtByToken.delete(token);
    }

    this.tokenToSymbols = map;
    this.underlyingCount = selectedUnderlyingKeys.size;
    this.mappedSymbolCount = [...map.values()].reduce((n, v) => n + v.symbols.length, 0);
    console.log(`🗺️  Token map built: ${map.size} unique tokens → covering ${this.mappedSymbolCount} symbols across ${this.underlyingCount} underlyings`);
    return map;
  }

  async start(io) {
    this.io = io;
    this.activeSource = 'kite';

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
    this.startSubscriptionMaintenance();

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
      this.tokenPriceCache.clear();
      this.dirtySymbols.clear();
      this.tokenToSymbols.clear();
      this.lastEmitAt.clear();
      this.lastTickAtByToken.clear();
      this.lastRepairAtByToken.clear();
      this.stopSubscriptionMaintenance();
      this.underlyingCount = 0;
      this.mappedSymbolCount = 0;
      this.activeSource = 'kite';
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
        instrumentToken: token,
        contractMonth: entry.contractMonth || '',
        expiryDate: entry.expiryDate || '',
      };

      this.tokenPriceCache.set(token, priceData);
      this.lastTickAtByToken.set(token, priceData.timestamp);

      // ── Emit to ALL alias symbols for this token ─────────────────────────
      for (const sym of entry.symbols) {
        const contractMonth = getContractMonthKey(sym) || entry.contractMonth || '';
        const aliasPriceData = { ...priceData, contractMonth };
        // Update cache
        this.priceCache.set(sym, aliasPriceData);
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
            instrumentToken: token,
            contractMonth,
            expiryDate:    entry.expiryDate || '',
            timestamp:     emitTs,
            source:        this.activeSource || 'kite',
          });
        }
      }
    }
  }

  stopSubscriptionMaintenance() {
    if (this.subscriptionMaintenanceInterval) {
      clearInterval(this.subscriptionMaintenanceInterval);
      this.subscriptionMaintenanceInterval = null;
    }
    if (this.subscriptionRefreshInterval) {
      clearInterval(this.subscriptionRefreshInterval);
      this.subscriptionRefreshInterval = null;
    }
  }

  startSubscriptionMaintenance() {
    this.stopSubscriptionMaintenance();

    // A stream connection can remain healthy while a small number of valid
    // tokens silently stop ticking. Re-subscribe those exact tokens and use a
    // token-verified REST quote as a repair instead of showing stale prices.
    this.subscriptionMaintenanceInterval = setInterval(() => {
      this.repairStaleTokenQuotes().catch((error) =>
        console.warn('Stale token quote repair failed:', error.message),
      );
    }, this.TOKEN_REPAIR_CHECK_MS);

    // Contract visibility changes at rollover. Refreshing the subscription map
    // periodically removes any need for a manual sync or a server restart.
    this.subscriptionRefreshInterval = setInterval(() => {
      this.refreshSubscriptions().catch((error) =>
        console.warn('Scheduled subscription refresh failed:', error.message),
      );
    }, this.SUBSCRIPTION_REFRESH_MS);
  }

  async repairStaleTokenQuotes() {
    if (
      this.quoteRepairInFlight ||
      this.activeSource !== 'kite' ||
      !this.running ||
      !this.ticker ||
      !isAnyMarketOpen()
    ) return { repaired: 0, stale: 0, skipped: true };

    const now = Date.now();
    const staleEntries = [];
    for (const [token, entry] of this.tokenToSymbols.entries()) {
      const lastTickAt = this.lastTickAtByToken.get(token) || 0;
      const lastRepairAt = this.lastRepairAtByToken.get(token) || 0;
      if (now - lastTickAt < this.STALE_TOKEN_MS) continue;
      if (now - lastRepairAt < this.TOKEN_REPAIR_COOLDOWN_MS) continue;
      if (!entry?.tradingSymbol || !entry?.exchange || !entry?.symbols?.length) continue;
      staleEntries.push({ token, entry });
    }

    if (staleEntries.length === 0) return { repaired: 0, stale: 0 };

    this.quoteRepairInFlight = true;
    this.lastSubscriptionRepairAt = new Date(now).toISOString();
    try {
      const staleTokens = staleEntries.map(({ token }) => token);
      const mode = String(process.env.KITE_TICK_MODE || 'full').toLowerCase();
      try {
        this.ticker.subscribe(staleTokens);
        this.ticker.setMode(mode, staleTokens);
      } catch (error) {
        console.warn(`Could not re-subscribe ${staleTokens.length} stale Kite tokens:`, error.message);
      }

      const kite = kiteService.getKiteInstance?.();
      if (!kite || typeof kite.getQuote !== 'function') {
        return { repaired: 0, stale: staleEntries.length, reason: 'quote client unavailable' };
      }

      const repairedTicks = [];
      const QUOTE_BATCH_SIZE = 100;
      for (let index = 0; index < staleEntries.length; index += QUOTE_BATCH_SIZE) {
        const batch = staleEntries.slice(index, index + QUOTE_BATCH_SIZE);
        const quoteKeys = batch.map(({ entry }) => `${entry.exchange}:${entry.tradingSymbol}`);
        let quotes = {};
        try {
          quotes = await kite.getQuote(quoteKeys);
        } catch (error) {
          console.warn(`Kite stale-quote repair batch failed: ${error.message}`);
        }

        for (const { token, entry } of batch) {
          this.lastRepairAtByToken.set(token, now);
          const quoteKey = `${entry.exchange}:${entry.tradingSymbol}`;
          const quote = quotes?.[quoteKey];
          // The quote must prove it belongs to the expected instrument token.
          // This prevents a direct-quote repair from crossing expiries.
          if (Number(quote?.instrument_token || 0) !== Number(token)) continue;
          if (Number(quote?.last_price || 0) <= 0) continue;
          repairedTicks.push(quote);
        }
      }

      if (repairedTicks.length > 0) {
        this.handleTicks(repairedTicks, 'full');
        console.log(`🩹 Repaired ${repairedTicks.length}/${staleEntries.length} stale Kite token quote(s)`);
      }
      return { repaired: repairedTicks.length, stale: staleEntries.length };
    } finally {
      this.quoteRepairInFlight = false;
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

      // Collect all symbols into one flat update list
      const updates = [];
      for (const sym of toFlush) {
        const p = this.priceCache.get(sym);
        if (!p) continue;
        updates.push({ sym, price: p });
      }

      if (updates.length === 0) return;

      // Chunk into groups of 50 — single .in() call per chunk, serialized (not parallel)
      // This keeps connection usage to 1 at a time instead of N simultaneous
      const CHUNK_SIZE = Number(process.env.KITE_DB_FLUSH_CHUNK_SIZE || 100);
      for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        const chunk = updates.slice(i, i + CHUNK_SIZE);
        const symbols = chunk.map(u => u.sym);

        try {
          const { data: existingRows, error: existingError } = await supabase
            .from('symbols')
            .select('*')
            .in('symbol', symbols);

          if (existingError) throw existingError;

          const existingBySymbol = new Map(
            (existingRows || []).map((row) => [
              String(row.symbol || '').toUpperCase(),
              row,
            ]),
          );

          const rows = chunk
            .filter(({ sym }) => existingBySymbol.has(String(sym || '').toUpperCase()))
            .map(({ sym, price }) => {
              const existing = existingBySymbol.get(String(sym || '').toUpperCase());
              return {
                ...existing,
                symbol:         sym,
                last_price:     price.last,
                // Keep an exact-token rolling close candidate throughout the
                // session. At market close the final tick remains available
                // even if the scheduled REST snapshot or next token fails.
                close_price:    price.last,
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
              };
            });

          if (rows.length === 0) continue;

          const { error: upsertError } = await supabase
            .from('symbols')
            .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });
          if (upsertError) throw upsertError;

        } catch (err) {
          // Non-fatal — live prices still flowing via socket
          console.warn(`[FlushToDB] chunk ${i}-${i + CHUNK_SIZE} failed (non-fatal):`, err.message);
        }
      }
    }

  status() {
    const now = Date.now();
    const lastTick = this.lastTickAt ? new Date(this.lastTickAt).getTime() : 0;
    const tickAge = lastTick > 0 ? Math.round((now - lastTick) / 1000) : null;
    
    return {
      running:           this.running,
      source:            this.activeSource || 'kite',
      lastTickAt:        this.lastTickAt,
      tickAgeSeconds:    tickAge,
      sessionExpired:    this.lastTickAt === null && !this.running,
      tokenCount:        this.tokenToSymbols?.size || 0,
      underlyingCount:   this.underlyingCount || 0,
      mappedSymbolCount: this.mappedSymbolCount || 0,
      cachedPrices:      this.priceCache.size,
      staleTokenCount:   [...this.tokenToSymbols.keys()].filter((token) => (
        now - (this.lastTickAtByToken.get(token) || 0) >= this.STALE_TOKEN_MS
      )).length,
      lastSubscriptionRepairAt: this.lastSubscriptionRepairAt,
      pendingDBWrites:   this.dirtySymbols.size,
      emitIntervalSeconds: Math.round(this.EMIT_INTERVAL_MS / 1000),
      dbFlushSeconds:    Math.round(this.DB_FLUSH_MS / 1000),
      warning:           this.lastTickAt === null 
        ? '⚠️ No ticks received — Kite session may be expired. Re-authenticate in Admin Panel.'
        : (tickAge && tickAge > 60 ? `⚠️ Last tick was ${tickAge}s ago — stream may be stalled` : null),
    };
  }

  async refreshSubscriptions() {
    if (this.activeSource !== 'kite') {
      return { refreshed: false, reason: `${this.activeSource} is the active provider` };
    }
    if (!this.ticker || !this.running) {
      console.log('ℹ️ Ticker not running, skip refresh');
      return { refreshed: false };
    }

    if (this.subscriptionRefreshInFlight) {
      return { refreshed: false, reason: 'refresh already in progress' };
    }

    this.subscriptionRefreshInFlight = true;
    try {
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
    } finally {
      this.subscriptionRefreshInFlight = false;
    }
  }

  activateExternalSource(source, io, tokenMap) {
    this.stopSubscriptionMaintenance();
    this.io = io || this.io;
    this.activeSource = String(source || 'external').toLowerCase();
    this.running = true;
    this.lastTickAt = null;
    this.priceCache.clear();
    this.tokenPriceCache.clear();
    this.dirtySymbols.clear();
    this.lastEmitAt.clear();
    this.lastTickAtByToken.clear();
    this.lastRepairAtByToken.clear();
    this.tokenToSymbols = tokenMap instanceof Map ? tokenMap : new Map();
    this.underlyingCount = new Set(
      [...this.tokenToSymbols.values()].map((entry) => entry.underlying).filter(Boolean),
    ).size;
    this.mappedSymbolCount = [...this.tokenToSymbols.values()]
      .reduce((count, entry) => count + (entry.symbols?.length || 0), 0);
    this.startDBFlush();
  }

  ingestExternalTicks(source, ticks, mode = 'full') {
    if (String(source || '').toLowerCase() !== this.activeSource) return false;
    this.lastTickAt = new Date().toISOString();
    this.handleTicks(ticks, mode);
    return true;
  }

  async releaseExternalSource(source) {
    if (String(source || '').toLowerCase() !== this.activeSource) return;
    await this.stop();
  }
}

module.exports = new KiteStreamService();
