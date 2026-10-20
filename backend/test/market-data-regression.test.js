const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { readAllRows } = require('../src/utils/readAllRows');
const { kiteQuoteTime } = require('../src/utils/kiteQuoteTime');

const quiet = { log() {}, warn() {}, error() {} };
const fixedTime = Date.parse('2026-10-21T04:30:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedTime])); }
  static now() { return fixedTime; }
}

function loadService(file, stubs = {}, date = FixedDate) {
  const filename = path.resolve(__dirname, '../src', file);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: (id) => id in stubs ? stubs[id] : nativeRequire(id),
    console: quiet, process: { env: { KITE_CLOSE_SNAPSHOT_BATCH_DELAY_MS: '0' } },
    Date: date, setTimeout: (fn) => { fn(); return 0; },
    setInterval: () => 1, clearInterval() {},
  }, { filename });
  return module.exports;
}

function database(tables, cap = 1000) {
  return {
    from(table) {
      let start = 0, end = Infinity, order;
      const query = {
        select() { return this; }, eq() { return this; }, not() { return this; },
        in() { return this; },
        limit(n) { end = n - 1; return this; },
        order(key) { order = key; return this; },
        range(a, b) { start = a; end = b; return this; },
        then(resolve, reject) {
          let rows = [...(tables[table] || [])];
          if (order) rows.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
          return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, start + cap)), error: null }).then(resolve, reject);
        },
        async upsert(rows) { tables.writes.push(...rows); return { error: null }; },
      };
      return query;
    },
  };
}

function symbol(symbol, token, underlying = symbol, expiry = '2026-10-27') {
  return { symbol, underlying, kite_instrument_token: token, kite_tradingsymbol: symbol,
    kite_exchange: 'NFO', instrument_type: 'FUT', expiry_date: expiry, tick_size: 0.05 };
}

function stream(db, kite = {}, open = true) {
  return loadService('services/kiteStreamService.js', {
    kiteconnect: { KiteTicker: class {} },
    '../config/supabase': { supabase: db },
    './kiteService': { getKiteInstance: () => kite },
    '../config/allowedKiteUniverse': { isAllowedSymbolRow: () => true },
    './marketStatus': { isAnyMarketOpen: () => open, isMarketOpen: () => open },
  });
}

test('reads every row even when the server cap is smaller than the requested page', async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({ symbol: `S${String(i).padStart(5, '0')}` }));
  const db = database({ symbols: rows }, 137);
  const result = await readAllRows(() => db.from('symbols').select('*'));
  assert.equal(result.length, rows.length);
  assert.equal(new Set(result.map(r => r.symbol)).size, rows.length);
});

test('subscriptions include current expiry beyond the first database page', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => symbol(`FILL${i}`, i + 1));
  rows.push(symbol('CUMMINSIND26OCTFUT', 5001, 'CUMMINSIND'));
  rows.push(symbol('CUMMINSIND26NOVFUT', 5002, 'CUMMINSIND', '2026-11-24'));
  const svc = stream(database({ symbols: rows, trades: [], pending_orders: [] }));
  await svc.buildTokenMap();
  assert.ok(svc.tokenToSymbols.has(5001), 'October contract must be subscribed');
  assert.ok(svc.tokenToSymbols.has(5002), 'November contract must be subscribed');
  svc.handleTicks([{ instrument_token: 5001, last_price: 100 }, { instrument_token: 5002, last_price: 200 }]);
  assert.equal(svc.getPriceForSymbolRow(rows[1000]).last, 100);
  assert.equal(svc.getPriceForSymbolRow(rows[1001]).last, 200);
});

test('closing snapshots include rows beyond the database cap and all aliases', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => symbol(`FILL${i}`, i + 1));
  const tables = { symbols: rows, writes: [] };
  const quoteClient = { getQuote: async keys => Object.fromEntries(keys.map(key => {
    const row = rows.find(r => `NFO:${r.symbol}` === key);
    return [key, { instrument_token: row.kite_instrument_token, last_price: 123 }];
  })) };
  const svc = loadService('services/closePriceSnapshotService.js', {
    '../config/supabase': { supabase: database(tables) },
    './kiteService': { init: async () => {}, isSessionReady: () => true, getKiteInstance: () => quoteClient },
    './marketStatus': { isCommoditySymbol: () => false },
  });
  const result = await svc.capture('equity');
  assert.equal(result.requested, 1001);
  assert.equal(result.updated, 1001);
  assert.equal(tables.writes.length, 1001);
});

test('REST recovery rejects old quotes instead of making them fresh', async () => {
  const svc = stream({}, { getQuote: async () => ({
    'NFO:NIFTY26OCTFUT': { instrument_token: 42, last_price: 100, timestamp: '2026-10-19 15:30:00' },
  }) });
  svc.running = true;
  svc.ticker = { subscribe() {}, setMode() {} };
  svc.tokenToSymbols.set(42, { symbols: ['NIFTY26OCTFUT'], exchange: 'NFO', tradingSymbol: 'NIFTY26OCTFUT' });
  const result = await svc.repairStaleTokenQuotes();
  assert.equal(result.repaired, 0);
  assert.equal(svc.tokenPriceCache.has(42), false);
});

test('exchange timestamps are independent of server timezone', () => {
  assert.equal(kiteQuoteTime('2026-10-21 10:00:00'), fixedTime);
  assert.equal(kiteQuoteTime('2026-10-21T04:30:00Z'), fixedTime);
  assert.equal(kiteQuoteTime(new Date(fixedTime)), fixedTime);
  assert.equal(kiteQuoteTime('invalid'), 0);
});

test('REST recovery accepts fresh exact-token quotes and retains exchange time', async () => {
  const svc = stream({}, { getQuote: async () => ({
    'unexpected-key': { instrument_token: 42, last_price: 100, timestamp: '2026-10-21 09:59:59' },
  }) });
  svc.running = true;
  svc.ticker = { subscribe() {}, setMode() {} };
  svc.tokenToSymbols.set(42, { symbols: ['NIFTY26OCTFUT'], exchange: 'NFO', tradingSymbol: 'NIFTY26OCTFUT' });
  const result = await svc.repairStaleTokenQuotes();
  assert.equal(result.repaired, 1);
  assert.equal(svc.tokenPriceCache.get(42).timestamp, fixedTime - 1000);
  assert.equal(svc.lastTickAt, null, 'REST must not update the websocket heartbeat');
});

test('late REST responses cannot overwrite a newer websocket price', () => {
  const svc = stream({});
  svc.tokenToSymbols.set(42, { symbols: ['NIFTY26OCTFUT'], exchange: 'NFO' });
  svc.handleTicks([{ instrument_token: 42, last_price: 200, exchange_timestamp: new Date(fixedTime) }]);
  svc.handleTicks([{ instrument_token: 42, last_price: 100, timestamp: '2026-10-21 09:59:59' }], 'full', 'rest');
  assert.equal(svc.tokenPriceCache.get(42).last, 200);
});

test('quote recovery does not poll a closed market', async () => {
  let requests = 0;
  const svc = stream({}, { getQuote: async () => { requests++; return {}; } }, false);
  svc.running = true;
  svc.ticker = {};
  assert.equal((await svc.repairStaleTokenQuotes()).skipped, true);
  assert.equal(requests, 0);
});

function calendarAt(iso) {
  class CalendarDate extends Date {
    constructor(...args) { super(...(args.length ? args : [iso])); }
    static now() { return Date.parse(iso); }
  }
  return loadService('services/marketStatus.js', {
    '../config/supabase': { supabase: {} },
    './kiteService': {
      init: async () => {}, isSessionReady: () => true,
      getKiteInstance: () => ({}),
    },
  }, CalendarDate);
}

test('Dussehra closes equity all day and opens MCX only from 17:00 IST', () => {
  const morning = calendarAt('2026-10-20T04:30:00Z');
  assert.equal(morning.isMarketOpen('NIFTY', 'NFO'), false);
  assert.equal(morning.isMarketOpen('GOLD', 'MCX'), false);
  assert.equal(morning.isAnyMarketOpen(), false);
  assert.equal(morning.getHolidayStatus().message, 'Dussehra');
  const evening = calendarAt('2026-10-20T11:30:00Z');
  assert.equal(evening.isMarketOpen('NIFTY', 'NFO'), false);
  assert.equal(evening.isMarketOpen('GOLD', 'MCX'), true);
  assert.equal(evening.isAnyMarketOpen(), true);
});

test('normal F&O and MCX hours and dated manual closures still work', () => {
  const normal = calendarAt('2026-10-21T04:30:00Z');
  assert.equal(normal.isMarketOpen('NIFTY', 'NFO'), true);
  normal.setHoliday(true, 'expired override', '2026-10-19');
  assert.equal(normal.isAnyMarketOpen(), true);
  normal.setHoliday(true, 'equity closure', '2026-10-21', { nseBseClosed: true, mcxClosed: false });
  assert.equal(normal.isMarketOpen('NIFTY', 'NFO'), false);
  assert.equal(normal.isMarketOpen('GOLD', 'MCX'), true);
  assert.equal(calendarAt('2026-10-21T10:10:00Z').isMarketOpen('NIFTY', 'NFO'), true);
  assert.equal(calendarAt('2026-10-21T10:11:00Z').isMarketOpen('NIFTY', 'NFO'), false);
  assert.equal(calendarAt('2026-10-21T18:00:00Z').isMarketOpen('GOLD', 'MCX'), true);
  assert.equal(calendarAt('2026-10-21T18:01:00Z').isMarketOpen('GOLD', 'MCX'), false);
});

test('missing Kite holiday method falls back without requesting the invalid route', async () => {
  const svc = calendarAt('2026-10-20T04:30:00Z');
  const dates = await svc.fetchHolidaysFromKite();
  assert.ok(dates.includes('2026-10-20'));
});

test('database errors abort a refresh without replacing existing subscriptions', async () => {
  const db = { from() { return {
    select() { return this; }, eq() { return this; }, not() { return this; }, order() { return this; },
    range() { return Promise.resolve({ error: new Error('database unavailable') }); },
  }; } };
  const svc = stream(db);
  svc.tokenToSymbols.set(42, { symbols: ['NIFTY26OCTFUT'] });
  await assert.rejects(svc.buildTokenMap(), /database unavailable/);
  assert.ok(svc.tokenToSymbols.has(42));
});

test('DB flush rejects a cached alias after its contract token changes', async () => {
  const tables = { symbols: [symbol('NIFTY-I', 99, 'NIFTY')], writes: [] };
  const svc = stream(database(tables));
  svc.priceCache.set('NIFTY-I', { instrumentToken: 42, timestamp: fixedTime, last: 100 });
  svc.dirtySymbols.add('NIFTY-I');
  await svc.flushToDB();
  assert.equal(tables.writes.length, 0);
});

test('DB flush preserves quote time instead of the flush time', async () => {
  const tables = { symbols: [symbol('NIFTY-I', 42, 'NIFTY')], writes: [] };
  const svc = stream(database(tables));
  svc.priceCache.set('NIFTY-I', { instrumentToken: 42, timestamp: fixedTime - 10000, last: 100 });
  svc.dirtySymbols.add('NIFTY-I');
  await svc.flushToDB();
  assert.equal(tables.writes.length, 1);
  assert.equal(tables.writes[0].last_update, new Date(fixedTime - 10000).toISOString());
});
