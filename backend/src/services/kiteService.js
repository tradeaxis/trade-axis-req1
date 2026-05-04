// backend/src/services/kiteService.js
const { KiteConnect } = require('kiteconnect');
const { DateTime } = require('luxon');
const { supabase } = require('../config/supabase');

class KiteService {
  constructor() {
    this.apiKey = process.env.KITE_API_KEY;
    this.apiSecret = process.env.KITE_API_SECRET;
    this.kc = null;
    this.accessToken = null;
    this.initialized = false;
  }

  isConfigured() {
    return !!(this.apiKey && this.apiSecret);
  }

  async init(forceRefresh = false) {
    if (this.initialized && !forceRefresh) return;
    
    if (!this.isConfigured()) {
      console.log('ℹ️ Kite not configured. Using simulated prices.');
      this.initialized = true;
      return;
    }

    try {
      // Always create a fresh KiteConnect instance on force refresh
      if (!this.kc || forceRefresh) {
        this.kc = new KiteConnect({ api_key: this.apiKey });
      }
      
      // Re-read token from DB (in case it was updated by another process)
      const dbToken = await this.getAccessTokenFromDB();
      
      if (dbToken) {
        this.accessToken = dbToken;
        this.kc.setAccessToken(this.accessToken);
        console.log(`✅ Kite access token loaded from DB (forceRefresh=${forceRefresh}).`);
      } else {
        console.log('ℹ️ Kite access token not set yet.');
      }
    } catch (error) {
      console.error('❌ Kite init error:', error.message);
    }

    this.initialized = true;
  }

  async getAccessTokenFromDB() {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'kite_access_token')
        .single();

      if (error) return null;
      const token = (data?.value || '').trim();
      return token || null;
    } catch {
      return null;
    }
  }

  async saveAccessTokenToDB(token) {
    try {
      const now = new Date().toISOString();
      
      const { error } = await supabase
        .from('app_settings')
        .upsert(
          { key: 'kite_access_token', value: token, updated_at: now },
          { onConflict: 'key' }
        );

      if (error) {
        console.error('❌ Upsert failed, trying update:', error.message);
        // Fallback to explicit update
        const { error: updateErr } = await supabase
          .from('app_settings')
          .update({ value: token, updated_at: now })
          .eq('key', 'kite_access_token');
        
        if (updateErr) throw updateErr;
      }
      
      // Verify the write
      const { data: verify } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'kite_access_token')
        .single();
      
      const savedToken = verify?.value || '';
      if (savedToken === token) {
        console.log('✅ Kite access token saved & verified in DB (first 10):', token.substring(0, 10) + '...');
      } else {
        console.error('❌ Token verification FAILED! DB has:', savedToken.substring(0, 10), 'Expected:', token.substring(0, 10));
      }
    } catch (err) {
      console.error('❌ Failed to save Kite token:', err.message);
    }
  }

  isSessionReady() {
    return !!(this.kc && this.accessToken);
  }

  /** Return the raw KiteConnect instance (used by syncKiteInstruments) */
  getKiteInstance() {
    return this.kc || null;
  }

  getLoginURL() {
    if (!this.kc) {
      if (this.isConfigured()) {
        this.kc = new KiteConnect({ api_key: this.apiKey });
      } else {
        return null;
      }
    }
    return this.kc.getLoginURL();
  }

  async generateSession(requestToken) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Kite API credentials not configured in .env');
    }

    if (!requestToken) {
      throw new Error('Request token is required');
    }

    const cleanToken = requestToken.trim().replace(/['"]/g, '');

    if (!cleanToken) {
      throw new Error('Invalid request token');
    }

    this.kc = new KiteConnect({ api_key: this.apiKey });

    console.log('🔄 Generating Kite session...');
    console.log('   API Key:', this.apiKey);
    console.log('   API Secret length:', this.apiSecret?.length);
    console.log('   Token (first 10 chars):', cleanToken.substring(0, 10) + '...');

    try {
      const session = await this.kc.generateSession(cleanToken, this.apiSecret);
      
      if (!session || !session.access_token) {
        throw new Error('Invalid session response from Kite');
      }

      this.accessToken = session.access_token;
      this.kc.setAccessToken(this.accessToken);
      this.initialized = true;

      // Save to DB and WAIT for completion
      await this.saveAccessTokenToDB(this.accessToken);

      console.log('✅ Kite session created successfully');
      console.log('   In-memory token (first 10):', this.accessToken.substring(0, 10) + '...');

      // Keep the previous close visible until fresh live ticks arrive.
      // The stream will overwrite these values as soon as Kite starts sending data.
      try {
        await supabase
          .from('symbols')
          .update({
            last_update: new Date().toISOString(),
          })
          .eq('is_active', true)
          .eq('instrument_type', 'FUT');
        console.log('✅ Preserved last prices until live stream refreshes them');
      } catch (clearErr) {
        console.warn('⚠️ Could not touch symbol timestamps:', clearErr.message);
      }

      return {
        accessToken: this.accessToken,
        userId: session.user_id,
        userName: session.user_name,
        email: session.email,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ Kite generateSession error:', error.message);
      
      if (error.message.includes('Invalid `request_token`')) {
        throw new Error('Invalid or expired request token. Tokens expire in ~2 minutes. Please login again.');
      }
      if (error.message.includes('checksum')) {
        throw new Error('Invalid API secret. Please verify KITE_API_SECRET in .env matches your Kite app settings.');
      }
      if (error.message.includes('used')) {
        throw new Error('This request token has already been used. Please login again.');
      }

      throw new Error(`Kite session failed: ${error.message}`);
    }
  }

  getMonthName(date) {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return months[new Date(date).getMonth()];
  }

  createShortDisplayName(instrument) {
    const name = String(instrument.name || '').toUpperCase();
    const expiry = instrument.expiry;

    if (!expiry) return `${name} FUT`;

    const month = this.getMonthName(expiry);
    const year = new Date(expiry).getFullYear().toString().slice(-2);

    return `${name} ${month}${year} FUT`;
  }

  async fetchFuturesInstruments() {
    await this.init();
    if (!this.isSessionReady()) {
      throw new Error('Kite session not ready. Please login first.');
    }

    console.log('📊 Fetching instruments from Kite...');

    const [nfo, mcx, bfo] = await Promise.all([
      this.kc.getInstruments('NFO').catch(() => []),
      this.kc.getInstruments('MCX').catch(() => []),
      this.kc.getInstruments('BFO').catch(() => []),
    ]);

    console.log(`   NFO: ${nfo.length}, MCX: ${mcx.length}, BFO: ${bfo.length}`);

    const all = [...nfo, ...mcx, ...bfo];

    // Filter: FUT only, not expired, has a valid underlying name
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return all.filter((i) => {
      if (String(i.instrument_type).toUpperCase() !== 'FUT') return false;
      if (!String(i.name || '').trim()) return false;          // skip if no underlying
      if (i.expiry) {
        const exp = new Date(i.expiry);
        exp.setHours(0, 0, 0, 0);
        if (exp < today) return false;                         // skip expired
      }
      return true;
    });
  }

  async syncSymbolsToDB() {
    const { syncKiteInstruments } = require('../utils/syncKiteInstruments');
    const result = await syncKiteInstruments();

    if (!result.success) {
      throw new Error(result.reason || 'Instrument sync failed');
    }

    return {
      count: result.upserted || 0,
      underlyings: result.underlyings || 0,
      contracts: result.contracts || 0,
      aliases: result.aliases || 0,
    };
  }

  async getHistoricalCandles(appSymbol, timeframe = '15m', count = 300) {
    await this.init();
    if (!this.isSessionReady()) return null;

    const { data: sym, error } = await supabase
      .from('symbols')
      .select('kite_instrument_token')
      .eq('symbol', String(appSymbol).toUpperCase())
      .single();

    if (error || !sym?.kite_instrument_token) return null;

    const intervalMap = {
      '1m': 'minute',
      '5m': '5minute',
      '15m': '15minute',
      '30m': '30minute',
      '1h': '60minute',
      '4h': '60minute',
      '1d': 'day',
      '1w': 'day',
      '1M': 'day',
    };

    const interval = intervalMap[timeframe] || '15minute';
    const now = DateTime.now().setZone('Asia/Kolkata');
    let from;

    switch (timeframe) {
      case '1m':
      case '5m':
        from = now.minus({ days: 5 });
        break;
      case '15m':
      case '30m':
        from = now.minus({ days: 15 });
        break;
      case '1h':
      case '4h':
        from = now.minus({ days: 60 });
        break;
      case '1d':
        from = now.minus({ days: 365 });
        break;
      default:
        from = now.minus({ days: 30 });
    }

    try {
      const raw = await this.kc.getHistoricalData(
        sym.kite_instrument_token,
        interval,
        from.toJSDate(),
        now.toJSDate(),
        false
      );

      return (raw || []).slice(-count).map((c) => ({
        time: ['1d', '1w', '1M'].includes(timeframe)
          ? DateTime.fromJSDate(new Date(c.date), { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM-dd')
          : Math.floor(new Date(c.date).getTime() / 1000),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume || 0),
      }));
    } catch (err) {
      console.error('getHistoricalCandles error:', err.message);
      return null;
    }
  }
}

module.exports = new KiteService();
