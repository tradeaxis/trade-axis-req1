import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const parseContractMonth ='), source.indexOf('const findScrollableParent ='));
const context = { isMarketOpenNow: () => false };
vm.runInNewContext(`${source.match(/const CONTRACT_MONTHS = .*;/)[0]}\n${helpers}\nglobalThis.helpers = { formatDisplaySymbol, getTradeQuotePrice, getTradeLivePnl };`, context);
const { formatDisplaySymbol, getTradeQuotePrice, getTradeLivePnl } = context.helpers;

const examples = [
  { base: 'NATURALGAS', open: 284.8, qty: 2000, nov: 285.2, dec: 326.9, profit: 800 },
  { base: 'PIIND', open: 1744, qty: 50, nov: 1751, dec: 1740, profit: 350 },
  { base: 'LUPIN', open: 1998.9, qty: 80, nov: 1998.5, dec: 2012.2, profit: -32 },
];
// Prices from the supplied audit are fixed test fixtures, not current market quotes.
for (const fixture of examples) {
  test(`${fixture.base}: an explicit November position uses November even when -II means December`, () => {
    const novSymbol = `${fixture.base}26NOVFUT`;
    const rows = [
      { symbol: `${fixture.base}-II`, underlying: fixture.base, expiry_date: '2026-12-29', close_price: fixture.dec },
      { symbol: `${fixture.base}26DECFUT`, underlying: fixture.base, expiry_date: '2026-12-29', close_price: fixture.dec },
      { symbol: novSymbol, underlying: fixture.base, expiry_date: '2026-11-23', close_price: fixture.nov },
    ];
    const trade = { symbol: novSymbol, open_price: fixture.open, quantity: fixture.qty, trade_type: 'buy', brokerage: 0 };
    const price = getTradeQuotePrice(trade, {}, rows);
    assert.equal(price, fixture.nov);
    assert.equal(formatDisplaySymbol(trade.symbol, rows), `${fixture.base}-NOV`);
    assert.equal(Math.round(getTradeLivePnl(trade, price) * 100) / 100, fixture.profit);
    // A code rollback cannot recover an old expiry from a rolling alias.
    assert.equal(formatDisplaySymbol(`${fixture.base}-II`, rows), `${fixture.base}-DEC`);
    assert.equal(getTradeQuotePrice({ ...trade, symbol: `${fixture.base}-II` }, {}, rows), fixture.dec);
  });
}
