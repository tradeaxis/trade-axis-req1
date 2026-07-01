const WebSocket = require('ws');
const { supabase } = require('../config/supabase');
const { isAllowedSymbolRow } = require('../config/allowedKiteUniverse');
const kiteStreamService = require('./kiteStreamService');

const MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';
const STREAM_URL = 'wss://smartapisocket.angelone.in/smart-stream';
const MASTER_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SUBSCRIPTIONS = 1000;
const EXCHANGE_TYPES = { NSE: 1, NFO: 2, BSE: 3, BFO: 4, MCX: 5, NCDEX: 7, CDS: 13 };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const cleanToken = (value) => String(value || '').replace(/^Bearer\s+/i, '').trim();
const normalizeUnderlying = (value) => String(value || '')
  .toUpperCase()
  .replace(/\s+/g, '')
  .replace(/[-_][IVX]+$/i, '')
  .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
  .replace(/\d{2}[A-Z]{3}FUT$/i, '')
  .replace(/FUT$/i, '')
  .replace(/[^A-Z0-9]/g, '');

const parseAngelExpiry = (value) => {
  const match = String(value || '').toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{4})$/);
  if (!match) return '';
  const month = MONTHS.indexOf(match[2]);
  if (month < 0) return '';
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1]}`;
};

const contractMonth = (expiry) => {
  const date = new Date(`${expiry}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : MONTHS[date.getUTCMonth()];
};

const safeBigInt = (buffer, offset, bytes = 8) => {
  if (buffer.length < offset + bytes) return 0;
  try {
    return Number(bytes === 4 ? buffer.readInt32LE(offset) : buffer.readBigInt64LE(offset));
  } catch (_) {
    return 0;
  }
};

const readPrice = (buffer, offset, bytes = 8) => safeBigInt(buffer, offset, bytes) / 100;

const parseSessionBundle = (input) => {
  if (input && typeof input === 'object') {
    return {
      jwtToken: cleanToken(input.jwtToken || input.authToken || input.auth_token),
      feedToken: cleanToken(input.feedToken || input.feed_token),
    };
  }

  const raw = String(input || '').trim();
  if (!raw) return { jwtToken: '', feedToken: '' };

  try {
    const parsed = JSON.parse(raw);
    return parseSessionBundle(parsed);
  } catch (_) {
    // Continue with URL or compact bundle parsing.
  }

  try {
    const url = new URL(raw);
    return {
      jwtToken: cleanToken(url.searchParams.get('auth_token') || url.searchParams.get('jwtToken')),
      feedToken: cleanToken(url.searchParams.get('feed_token') || url.searchParams.get('feedToken')),
    };
  } catch (_) {
    // A compact jwt|feed bundle is also accepted as one paste.
  }

  const separator = raw.includes('|') ? '|' : (raw.includes('\n') ? '\n' : '');
  if (separator) {
    const [jwtToken, feedToken] = raw.split(separator).map(cleanToken);
    return { jwtToken, feedToken };
  }

  return { jwtToken: cleanToken(raw), feedToken: '' };
};

class AngelOneStreamService {
  constructor() {
    this.ws = null;
    this.io = null;
    this.running = false;
    this.lastTickAt = null;
    this.lastError = null;
    this.tokenMap = new Map();
    this.masterCache = null;
    this.masterLoadedAt = 0;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.intentionalStop = false;
    this.session = null;
  }

  static parseSessionBundle(input) {
    return parseSessionBundle(input);
  }

  async fetchMaster() {
    if (this.masterCache && Date.now() - this.masterLoadedAt < MASTER_TTL_MS) {
      return this.masterCache;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(MASTER_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`Angel instrument master returned HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('Angel instrument master is empty');
      this.masterCache = rows;
      this.masterLoadedAt = Date.now();
      return rows;
    } finally {
      clearTimeout(timeout);
    }
  }

  async buildTokenMap() {
    const [masterRows, symbolsResult] = await Promise.all([
      this.fetchMaster(),
      supabase.from('symbols').select('*').eq('is_active', true).limit(10000),
    ]);
    if (symbolsResult.error) throw symbolsResult.error;

    const masterByKey = new Map();
    for (const row of masterRows) {
      const exchange = String(row.exch_seg || '').toUpperCase();
      if (!['NFO', 'BFO', 'MCX', 'NSE', 'BSE'].includes(exchange)) continue;
      const expiry = parseAngelExpiry(row.expiry);
      if (!expiry || !row.token) continue;
      const underlying = normalizeUnderlying(row.name || row.symbol);
      if (!underlying) continue;
      masterByKey.set(`${exchange}|${underlying}|${expiry}`, row);
    }

    const today = new Date().toISOString().slice(0, 10);
    const grouped = new Map();
    for (const row of symbolsResult.data || []) {
      if (!isAllowedSymbolRow(row) || !row.expiry_date || row.expiry_date < today) continue;
      const exchange = String(row.kite_exchange || row.exchange || '').toUpperCase() === 'NSE'
        ? 'NFO'
        : String(row.kite_exchange || row.exchange || '').toUpperCase();
      if (!EXCHANGE_TYPES[exchange]) continue;
      const underlying = normalizeUnderlying(row.underlying || row.kite_tradingsymbol || row.symbol);
      if (!underlying) continue;
      const groupKey = `${exchange}|${underlying}`;
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      grouped.get(groupKey).push({ row, exchange, underlying });
    }

    const selected = [];
    for (const rows of grouped.values()) {
      const expiries = [...new Set(rows.map(({ row }) => row.expiry_date))].sort().slice(0, 2);
      selected.push(...rows.filter(({ row }) => expiries.includes(row.expiry_date)));
    }

    const tokenMap = new Map();
    for (const { row, exchange, underlying } of selected) {
      const master = masterByKey.get(`${exchange}|${underlying}|${row.expiry_date}`);
      if (!master) continue;
      const token = Number(master.token);
      if (!Number.isFinite(token) || token <= 0) continue;

      if (!tokenMap.has(token)) {
        tokenMap.set(token, {
          symbols: [],
          tickSize: Number(master.tick_size || 0) / 100,
          exchange,
          exchangeType: EXCHANGE_TYPES[exchange],
          contractMonth: contractMonth(row.expiry_date),
          underlying,
          expiryDate: row.expiry_date,
          angelTradingSymbol: master.symbol,
        });
      }
      const entry = tokenMap.get(token);
      for (const alias of [row.symbol, row.kite_tradingsymbol, row.display_name]) {
        const normalized = String(alias || '').toUpperCase().trim();
        if (normalized && !entry.symbols.includes(normalized)) entry.symbols.push(normalized);
      }
    }

    if (tokenMap.size > MAX_SUBSCRIPTIONS) {
      const limited = new Map([...tokenMap.entries()]
        .sort((a, b) => a[1].expiryDate.localeCompare(b[1].expiryDate))
        .slice(0, MAX_SUBSCRIPTIONS));
      this.tokenMap = limited;
    } else {
      this.tokenMap = tokenMap;
    }

    if (this.tokenMap.size === 0) {
      throw new Error('No exact-expiry Angel instruments matched the Trade Axis symbol universe');
    }
    return this.tokenMap;
  }

  parseTick(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length < 51) return null;
    const mode = buffer.readUInt8(0);
    const token = Number(buffer.subarray(2, 27).toString('utf8').replace(/\0/g, '').trim());
    if (!token || !this.tokenMap.has(token)) return null;

    const last = mode === 1 ? readPrice(buffer, 43, 4) : readPrice(buffer, 43);
    if (!(last > 0)) return null;

    const open = mode >= 2 ? readPrice(buffer, 91) : last;
    const high = mode >= 2 ? readPrice(buffer, 99) : last;
    const low = mode >= 2 ? readPrice(buffer, 107) : last;
    const close = mode >= 2 ? readPrice(buffer, 115) : last;
    let bid = last;
    let ask = last;
    if (mode >= 3 && buffer.length >= 275) {
      const parsedBid = readPrice(buffer, 157);
      const parsedAsk = readPrice(buffer, 257);
      if (parsedBid > 0) bid = parsedBid;
      if (parsedAsk > 0) ask = parsedAsk;
    }

    return {
      instrument_token: token,
      last_price: last,
      ohlc: { open, high, low, close },
      volume_traded: mode >= 2 ? safeBigInt(buffer, 67) : 0,
      depth: { buy: [{ price: bid }], sell: [{ price: ask }] },
    };
  }

  subscribe() {
    const grouped = new Map();
    for (const [token, entry] of this.tokenMap.entries()) {
      if (!grouped.has(entry.exchangeType)) grouped.set(entry.exchangeType, []);
      grouped.get(entry.exchangeType).push(String(token));
    }

    let sequence = 0;
    for (const [exchangeType, tokens] of grouped.entries()) {
      for (let offset = 0; offset < tokens.length; offset += 200) {
        this.ws.send(JSON.stringify({
          correlationID: `trade-axis-${Date.now()}-${sequence += 1}`,
          action: 1,
          params: { mode: 3, tokenList: [{ exchangeType, tokens: tokens.slice(offset, offset + 200) }] },
        }));
      }
    }
  }

  async start({ io, apiKey, clientCode, jwtToken, feedToken }) {
    const session = {
      apiKey: String(apiKey || '').trim(),
      clientCode: String(clientCode || '').trim(),
      jwtToken: cleanToken(jwtToken),
      feedToken: cleanToken(feedToken),
    };
    if (!session.apiKey || !session.clientCode || !session.jwtToken || !session.feedToken) {
      throw new Error('Angel One requires API key, client code, JWT token and feed token');
    }

    await this.stop({ preservePrices: true });
    await this.buildTokenMap();
    this.io = io;
    this.session = session;
    this.intentionalStop = false;
    this.lastError = null;

    return new Promise((resolve, reject) => {
      let settled = false;
      const connectionTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { this.ws?.terminate(); } catch (_) {}
        reject(new Error('Angel One stream connection timed out'));
      }, 20000);

      this.ws = new WebSocket(STREAM_URL, {
        headers: {
          Authorization: session.jwtToken,
          'x-api-key': session.apiKey,
          'x-client-code': session.clientCode,
          'x-feed-token': session.feedToken,
        },
      });

      this.ws.on('open', async () => {
        try {
          clearTimeout(connectionTimeout);
          await kiteStreamService.stop();
          kiteStreamService.activateExternalSource('angelone', this.io, this.tokenMap);
          this.running = true;
          this.reconnectAttempts = 0;
          this.subscribe();
          if (!settled) {
            settled = true;
            resolve({
              started: true,
              provider: 'angelone',
              tokens: this.tokenMap.size,
              mappedSymbols: [...this.tokenMap.values()].reduce((n, item) => n + item.symbols.length, 0),
            });
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      });

      this.ws.on('message', (data) => {
        if (typeof data === 'string' || (Buffer.isBuffer(data) && data.length < 20)) return;
        const tick = this.parseTick(data);
        if (!tick) return;
        this.lastTickAt = new Date().toISOString();
        kiteStreamService.ingestExternalTicks('angelone', [tick], 'full');
      });

      this.ws.on('error', (error) => {
        this.lastError = error.message;
        if (!settled) {
          clearTimeout(connectionTimeout);
          settled = true;
          reject(new Error(`Angel One stream failed: ${error.message}`));
        }
      });

      this.ws.on('close', () => {
        this.running = false;
        if (!this.intentionalStop) this.scheduleReconnect();
      });
    });
  }

  scheduleReconnect() {
    if (!this.session || this.reconnectTimer || this.intentionalStop) return;
    const delay = Math.min(30000, 2000 * (2 ** this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start({ io: this.io, ...this.session }).catch((error) => {
        this.lastError = error.message;
        this.scheduleReconnect();
      });
    }, delay);
  }

  async stop({ preservePrices = false } = {}) {
    this.intentionalStop = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.running = false;
    if (!preservePrices) await kiteStreamService.releaseExternalSource('angelone');
    return { stopped: true, provider: 'angelone' };
  }

  status() {
    const age = this.lastTickAt ? Math.round((Date.now() - new Date(this.lastTickAt).getTime()) / 1000) : null;
    return {
      running: this.running,
      provider: 'angelone',
      lastTickAt: this.lastTickAt,
      tickAgeSeconds: age,
      tokenCount: this.tokenMap.size,
      lastError: this.lastError,
      sessionReady: Boolean(this.session?.jwtToken && this.session?.feedToken),
    };
  }
}

module.exports = new AngelOneStreamService();
module.exports.parseSessionBundle = parseSessionBundle;
