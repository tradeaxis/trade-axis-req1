import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/store/marketStore.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default useMarketStore;', 'globalThis.store = useMarketStore;');
const now = Date.parse('2026-11-08T09:00:00Z');
const symbol = { symbol: 'NIFTY26NOVFUT', kite_instrument_token: 12345,
  expiry_date: '2026-11-23', last_price: 100, close_price: 90, last_update: new Date(now - 30000).toISOString() };
const tick = { symbol: symbol.symbol, instrumentToken: 12345, expiryDate: symbol.expiry_date,
  contractMonth: 'NOV', last: 119, bid: 118, ask: 120, source: 'kite' };

function setup() {
  let state;
  let time = now;
  const storage = new Map();
  const api = { get: async () => ({ data: { success: true, symbols: [symbol] } }) };
  const context = {
    console, api, Intl,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    create: init => {
      const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
      state = init(set, () => state);
      return { getState: () => state };
    },
  };
  vm.runInNewContext(source, context);
  return { api, get: context.store.getState, setTime: value => { time = value; } };
}

test('catalogue refresh preserves a newer live quote and its original age', async () => {
  const { api, get } = setup();
  await get().fetchSymbols();
  get().updatePrice(tick);
  const timestamp = get().quotes[symbol.symbol].timestamp;
  await get().refreshSymbols();
  assert.equal(get().quotes[symbol.symbol].last, 119);
  assert.equal(get().quotes[symbol.symbol].timestamp, timestamp);
  api.get = async () => ({ data: { success: true, symbols: [{ ...symbol, last_update: null }] } });
  await get().refreshSymbols();
  assert.equal(get().quotes[symbol.symbol].last, 119);
  assert.equal(get().quotes[symbol.symbol].timestamp, timestamp);
});

test('a tick arriving during a pending REST request wins over the older response', async () => {
  const { api, get, setTime } = setup();
  await get().fetchSymbols();
  let complete;
  api.get = () => new Promise(resolve => { complete = resolve; });
  const pending = get().getQuote(symbol.symbol);
  setTime(now + 1000);
  get().updatePrice(tick);
  complete({ data: { success: true, quote: { ...tick, last: 100, timestamp: now, source: 'api' } } });
  await pending;
  assert.equal(get().quotes[symbol.symbol].last, 119);
  assert.equal(get().quotes[symbol.symbol].timestamp, now + 1000);
});

test('refresh accepts a newer database quote and never retains a different instrument', async () => {
  const { api, get } = setup();
  await get().fetchSymbols();
  get().updatePrice(tick);
  api.get = async () => ({ data: { success: true, symbols: [{ ...symbol, last_price: 121, last_update: new Date(now + 1000).toISOString() }] } });
  await get().refreshSymbols();
  assert.equal(get().quotes[symbol.symbol].last, 121);
  get().updatePrice(tick);
  api.get = async () => ({ data: { success: true, symbols: [{ ...symbol, kite_instrument_token: 99999 }] } });
  await get().refreshSymbols();
  assert.equal(get().quotes[symbol.symbol].instrumentToken, 99999);
  assert.equal(get().quotes[symbol.symbol].last, 100);
});

test('after closing time the closing snapshot replaces the live quote', async () => {
  const { get, setTime } = setup();
  await get().fetchSymbols();
  get().updatePrice(tick);
  setTime(Date.parse('2026-11-08T10:11:00Z'));
  await get().refreshSymbols();
  assert.equal(get().quotes[symbol.symbol].last, 90);
  get().updatePrice(tick);
  assert.equal(get().quotes[symbol.symbol].last, 90);
});
