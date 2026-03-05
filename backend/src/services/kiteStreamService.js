// backend/src/services/kiteStreamService.js
const { KiteTicker } = require('kiteconnect');
const { supabase } = require('../config/supabase');
const kiteService = require('./kiteService');

class KiteStreamService {
  constructor() {
    this.ticker = null;
    this.io = null;
    this.running = false;
    this.tokenToSymbols = new Map(); // token -> [symbolRows]
    this.lastTickAt = null;
  }

  isRunning() {
    return this.running;
  }

  async buildTokenMap() {
    const { data, error } = await supabase
      .from('symbols')
      .select('symbol, kite_instrument_token')
      .eq('is_active', true)
      .not('kite_instrument_token', 'is', null);

    if (error) throw error;

    const map = new Map();
    for (const row of data || []) {
      const token = Number(row.kite_instrument_token);
      if (!map.has(token)) map.set(token, []);
      map.get(token).push(row.symbol);
    }

    this.tokenToSymbols = map;
    return map;
  }

  async start(io) {
    this.io = io;

    await kiteService.init();
    if (!kiteService.isSessionReady()) {
      console.log('ℹ️ Kite session not ready. Stream not started.');
      return { started: false, reason: 'kite session not ready' };
    }

    await this.buildTokenMap();

    const tokens = Array.from(this.tokenToSymbols.keys());
    if (tokens.length === 0) {
      console.log('ℹ️ No kite instrument tokens found in symbols table.');
      return { started: false, reason: 'no tokens' };
    }

    // Create ticker
    const apiKey = process.env.KITE_API_KEY;
    const accessToken = kiteService.accessToken;

    this.ticker = new KiteTicker({ api_key: apiKey, access_token: accessToken });
    this.running = true;

    const mode = String(process.env.KITE_TICK_MODE || 'full').toLowerCase(); // full | quote | ltp

    this.ticker.on('connect', () => {
      console.log('✅ KiteTicker connected. Subscribing tokens:', tokens.length);
      this.ticker.subscribe(tokens);
      this.ticker.setMode(mode, tokens);
    });

    this.ticker.on('ticks', async (ticks) => {
      this.lastTickAt = new Date().toISOString();
      await this.handleTicks(ticks);
    });

    this.ticker.on('error', (err) => {
      console.error('❌ KiteTicker error:', err?.message || err);
    });

    this.ticker.on('close', () => {
      console.log('❌ KiteTicker closed');
      this.running = false;
    });

    this.ticker.connect();

    return { started: true, tokens: tokens.length, mode };
  }

  async stop() {
    try {
      if (this.ticker) {
        this.ticker.disconnect();
        this.ticker = null;
      }
    } finally {
      this.running = false;
    }
    return { stopped: true };
  }

  async handleTicks(ticks) {
    if (!ticks || ticks.length === 0) return;

    // Batch DB updates (but per-symbol upsert is fine here because count is limited by subscriptions)
    for (const t of ticks) {
      const token = Number(t.instrument_token);
      const symbols = this.tokenToSymbols.get(token);
      if (!symbols || symbols.length === 0) continue;

      const last = Number(t.last_price || 0);
      const ohlc = t.ohlc || {};
      const prevClose = Number(ohlc.close || 0);
      const chgVal = prevClose ? (last - prevClose) : 0;
      const chgPct = prevClose ? (chgVal / prevClose) * 100 : 0;

      let bid = last;
      let ask = last;

      // FULL mode provides depth
      if (t.depth?.buy?.length) bid = Number(t.depth.buy[0].price || last);
      if (t.depth?.sell?.length) ask = Number(t.depth.sell[0].price || last);

      const updatePayload = {
        last_price: last,
        bid,
        ask,
        open_price: Number(ohlc.open || last),
        high_price: Number(ohlc.high || last),
        low_price: Number(ohlc.low || last),
        previous_close: prevClose || last,
        change_value: chgVal,
        change_percent: chgPct,
        last_update: new Date().toISOString(),
      };

      // Update ALL app symbols that map to this token (actual + aliases I/II/III)
      const { error } = await supabase
        .from('symbols')
        .update(updatePayload)
        .in('symbol', symbols);

      if (error) {
        console.error('symbols update error:', error.message);
        continue;
      }

      // Emit to each symbol room
      for (const s of symbols) {
        this.io?.to(`symbol:${s}`).emit('price:update', {
          symbol: s,
          bid,
          ask,
          last,
          change: chgVal,
          changePercent: chgPct,
          timestamp: Date.now(),
          source: 'kite',
        });
      }
    }
  }

  status() {
    return {
      running: this.running,
      lastTickAt: this.lastTickAt,
      tokenCount: this.tokenToSymbols?.size || 0,
    };
  }
}

module.exports = new KiteStreamService();