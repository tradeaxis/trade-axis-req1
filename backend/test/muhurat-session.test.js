const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');

function clock(ist) {
  const time = Date.parse(`${ist}+05:30`);
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  };
}
function service(file, ist, stubs = {}) {
  const filename = path.join(root, 'backend/src', file);
  const native = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Date: clock(ist),
    require: (id) => id in stubs ? stubs[id] : native(id),
    console: { log() {}, error() {}, warn() {} }, process: { env: {} },
    setTimeout, setInterval,
  });
  return module.exports;
}
function market(ist) {
  return service('services/marketStatus.js', ist, {
    '../config/supabase': { supabase: { from: () => ({ upsert: async () => ({}) }) } },
    './kiteService': { init: async () => {}, isSessionReady: () => true,
      getKiteInstance: () => ({ getHolidays: async () => [{ date: '2026-11-08' }] }) },
  });
}
function client(file, ist) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('const isMarketOpenNow =');
  const end = source.indexOf('\n};', start) + 3;
  return vm.runInNewContext(`${source.slice(start, end)}\nisMarketOpenNow;`, { Date: clock(ist) });
}
const clients = ['webapp/src/App.jsx', 'frontend/src/store/marketStore.js', 'frontend/src/pages/Dashboard.jsx'];

test('backend, web and APK agree at every special-session boundary', () => {
  for (const [time, equity, commodity] of [
    ['00:00:00', false, false], ['09:30:00', false, false],
    ['14:05:00', false, false], ['14:19:59', false, false],
    ['14:20:00', true, true], ['15:29:59', true, true],
    ['15:30:00', true, false], ['15:39:59', true, false],
    ['15:40:00', false, false], ['23:59:59', false, false],
  ]) {
    const ist = `2026-11-08T${time}`;
    const server = market(ist);
    for (const [symbol, exchange, expected] of [
      ['NIFTY26NOVFUT', 'NFO', equity], ['SIEMENS-II', 'NFO', equity],
      ['GOLD26DECFUT', 'MCX', commodity], ['CRUDEOIL-I', 'MCX', commodity],
    ]) {
      assert.equal(server.isMarketOpen(symbol, exchange), expected, `${ist} ${symbol} server`);
      for (const file of clients) assert.equal(client(file, ist)(symbol), expected, `${ist} ${symbol} ${file}`);
    }
    assert.equal(server.isAnyMarketOpen(), equity || commodity);
  }
});

test('exception expires: other weekends stay closed and Monday retains normal hours', () => {
  for (const date of ['2026-11-07', '2026-11-14', '2026-11-15', '2027-11-07']) {
    const ist = `${date}T14:30:00`;
    assert.equal(market(ist).isAnyMarketOpen(), false);
    for (const file of clients) assert.equal(client(file, ist)('NIFTY'), false);
  }
  const monday = market('2026-11-09T09:30:00');
  assert.equal(monday.isMarketOpen('NIFTY'), true);
  assert.equal(monday.isMarketOpen('GOLD'), true);
  assert.equal(market('2026-11-09T18:00:00').isMarketOpen('NIFTY'), false);
  assert.equal(market('2026-11-09T18:00:00').isMarketOpen('GOLD'), true);
  assert.equal(market('2026-11-10T14:30:00').isMarketOpen('NIFTY'), false);
});

test('cached Diwali holiday does not block session; explicit admin closure still wins', async () => {
  const server = market('2026-11-08T14:30:00');
  await server.fetchHolidaysFromKite();
  assert.equal(server.getHolidayStatus().isHoliday, false);
  assert.equal(server.getHolidayStatus().segments.nseBseClosed, false);
  assert.equal(server.isAnyMarketOpen(), true);
  server.setHoliday(true, 'Emergency closure', '2026-11-08', { nseBseClosed: true, mcxClosed: true });
  assert.equal(server.isAnyMarketOpen(), false);
  assert.equal(server.getHolidayStatus().isHoliday, true);
  server.setHoliday(false);
  assert.equal(server.isAnyMarketOpen(), true);
});

test('Sunday restart does not capture closing prices during trading', async () => {
  for (const [time, expected] of [
    ['14:10:00', []], ['14:30:00', []],
    ['15:30:20', ['commodity']], ['15:40:20', ['equity', 'commodity']],
  ]) {
    const snapshots = service('services/closePriceSnapshotService.js', `2026-11-08T${time}`, {
      '../config/supabase': {}, './kiteService': {}, './marketStatus': {},
    });
    const captured = [];
    snapshots.capture = async (segment) => { captured.push(segment); return {}; };
    await snapshots.captureClosedSegmentsNow();
    assert.deepEqual(captured, expected);
  }
});
