import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual dashboard helpers without loading React or contacting production.
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const helpers = app.slice(app.indexOf('const monthAbbrs ='), app.indexOf('const readAuth ='));
const names = ['findPositionSymbol', 'getLivePositionPrice', 'getPositionPnl',
  'getTradeAxisSymbolLabel', 'filterTradableSymbols', 'dedupeTradableSymbols',
  'getPositionSymbolLabel', 'getPositionOrderSymbol', 'loadTradeSymbolCatalog'];
function dashboard(date = '2026-10-27T06:00:00Z', rows = []) {
  const time = Date.parse(date);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  const context = vm.createContext({ Date: Clock, api: { get: async () => ({ data: { symbols: rows } }) } });
  vm.runInContext(`${helpers}\nglobalThis.helpers = { ${names.join(',')} };`, context);
  return context.helpers;
}

function contracts(base, year = 2026, month = 9) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return [0, 1].flatMap((offset) => {
    const date = new Date(Date.UTC(year, month + offset, 27));
    const yy = String(date.getUTCFullYear()).slice(-2);
    const mon = months[date.getUTCMonth()];
    const dated = `${base}${yy}${mon}FUT`;
    const row = { symbol: dated, underlying: base, kite_tradingsymbol: dated,
      expiry_date: date.toISOString().slice(0, 10), kite_instrument_token: 100 + offset,
      display_name: `${base} ${mon}${yy} FUT`, category: 'stock_futures',
      last_price: 1000 + offset * 100, close_price: 990 + offset * 100 };
    return [row, { ...row, symbol: `${base}-${offset ? 'II' : 'I'}`,
      display_name: `${base} ${offset ? 'Next' : 'Near'} Month (${mon}${yy})` }];
  });
}

for (const base of ['SIEMENS', 'TMPV']) {
  test(`${base}: a missing next-month alias must not resolve to the current month`, () => {
    const h = dashboard();
    const picker = h.dedupeTradableSymbols(h.filterTradableSymbols(contracts(base)));
    const position = { symbol: `${base}-II`, current_price: 1101, open_price: 1050 };
    assert.equal(h.findPositionSymbol(position, picker), null);
    assert.equal(h.getLivePositionPrice(position, picker), 1101);
  });

  test(`${base}: existing alias and dated positions keep November labels, prices and P&L`, async () => {
    const rows = contracts(base);
    const h = dashboard(undefined, rows);
    const { symbols, positionSymbols } = await h.loadTradeSymbolCatalog();
    assert.equal(symbols.length, 2); // No duplicate aliases in the order picker.
    assert.equal(positionSymbols.length, 4);
    for (const symbol of [`${base}-II`, `${base}26NOVFUT`, `${base}-NOV`, `${base} NOV26 FUT`]) {
      const position = { symbol, open_price: 1050, quantity: 2, trade_type: 'buy', buy_brokerage: 10 };
      assert.equal(h.getPositionSymbolLabel(position, positionSymbols), `${base}-NOV`);
      assert.equal(h.getLivePositionPrice(position, positionSymbols), 1100);
      assert.equal(h.getPositionPnl(position, positionSymbols), 90);
      assert.equal(h.getPositionOrderSymbol(position, positionSymbols, symbols), `${base}26NOVFUT`);
      if (!symbol.includes(' ')) {
        assert.equal(h.getPositionSymbolLabel(position, []), symbol === `${base}-II` ? symbol : `${base}-NOV`);
      }
    }
    assert.equal(h.getPositionOrderSymbol({ symbol: `${base}-II` }, positionSymbols, [rows[0]]), null);
  });
}

test('all twelve month ends, including December/January, resolve by contract metadata', async () => {
  for (let month = 0; month < 12; month++) {
    for (const day of [20, 25, 28]) {
      for (const base of ['SIEMENS', 'TMPV', 'NIFTY', 'CRUDEOIL']) {
        const date = new Date(Date.UTC(2026, month, day, 6)).toISOString();
        const rows = contracts(base, 2026, month);
        const h = dashboard(date, rows);
        const { positionSymbols } = await h.loadTradeSymbolCatalog();
        for (const catalogue of [positionSymbols, [...positionSymbols].reverse()]) {
          for (const symbol of [`${base}-II`, rows[2].symbol]) {
            assert.equal(h.findPositionSymbol({ symbol }, catalogue).kite_tradingsymbol, rows[2].symbol);
            assert.equal(h.getPositionSymbolLabel({ symbol }, catalogue), `${base}-${rows[2].symbol.slice(-6, -3)}`);
          }
        }
      }
    }
  }
});

test('a held contract remains available even before day 20 or after picker expiry filtering', async () => {
  for (const date of ['2026-10-10T06:00:00Z', '2026-10-28T06:00:00Z', '2026-11-01T06:00:00Z']) {
    const rows = contracts('SIEMENS');
    const h = dashboard(date, rows);
    const result = await h.loadTradeSymbolCatalog();
    for (const symbol of ['SIEMENS26OCTFUT', 'SIEMENS26NOVFUT', 'SIEMENS-II']) {
      assert.ok(h.findPositionSymbol({ symbol }, result.positionSymbols));
    }
  }
});

test('missing, ambiguous and different-year contracts never borrow another contract price', () => {
  const h = dashboard();
  const rows = contracts('TMPV');
  for (const symbol of ['TMPV', 'TMPV-III', 'TMPV26DECFUT', 'TMPV27NOVFUT', 'UNKNOWN-II']) {
    assert.equal(h.findPositionSymbol({ symbol }, rows), null);
    assert.equal(h.getLivePositionPrice({ symbol, current_price: 1234 }, rows), 1234);
  }
  assert.equal(h.findPositionSymbol({ symbol: 'TMPV-NOV' }, [...rows, ...contracts('TMPV', 2027)]), null);
  const january = contracts('TMPV', 2026, 11);
  assert.equal(h.findPositionSymbol({ symbol: 'TMPV-JAN' }, january).kite_tradingsymbol, 'TMPV27JANFUT');
});

test('quote refreshes and closing prices remain attached to the same exact contract', () => {
  for (const date of ['2026-10-27T06:00:00Z', '2026-10-27T15:00:00Z']) {
    const h = dashboard(date);
    const rows = contracts('TMPV');
    const position = { symbol: 'TMPV-II', quantity: 2, trade_type: 'sell', open_price: 1200, brokerage: 10 };
    for (let poll = 0; poll < 8; poll++) {
      const refreshed = rows.map((row) => ({ ...row, last_price: row.last_price + poll, close_price: row.close_price + poll }));
      if (poll % 2) refreshed.reverse();
      const price = (date.includes('T06:') ? 1100 : 1090) + poll;
      assert.equal(h.getLivePositionPrice(position, refreshed), price);
      assert.equal(h.getPositionPnl(position, refreshed), (1200 - price) * 2 - 10);
      assert.equal(h.getPositionSymbolLabel(position, refreshed), 'TMPV-NOV');
    }
  }
});
