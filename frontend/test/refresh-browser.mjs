import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(process.env.TEST_BUILD === '1' ? ['preview'] : []), '--host', '127.0.0.1', '--port', '4176', '--strictPort'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server timed out')), 20000);
    server.stdout.on('data', (data) => { if (String(data).includes('4176')) { clearTimeout(timer); resolve(); } });
    server.on('error', reject);
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR:', error.stack); });
  await page.clock.setFixedTime(new Date('2026-11-09T09:00:00Z'));
  const user = { id: 'test-user', role: 'user', loginId: 'TEST', firstName: 'Test' };
  const accounts = [{ id: 'test-account', account_number: 'TEST', is_demo: false, balance: 10000, leverage: 5 }];
  const symbols = [{ symbol: 'NIFTY26NOVFUT', display_name: 'NIFTY NOV26 FUT', underlying: 'NIFTY',
    expiry_date: '2026-11-24', kite_instrument_token: 12345, category: 'index_futures',
    exchange: 'NSE', instrument_type: 'FUT', lot_size: 1, bid: 101, ask: 102, last_price: 101 },
    { symbol: 'NIFTY26DECFUT', display_name: 'NIFTY DEC26 FUT', underlying: 'NIFTY',
      expiry_date: '2026-12-29', kite_instrument_token: 67890, category: 'index_futures',
      exchange: 'NSE', instrument_type: 'FUT', lot_size: 1, bid: 183, ask: 184, last_price: 183 }];
  const position = {
    id: 'fixture-trade', account_id: accounts[0].id, symbol: symbols[0].symbol,
    status: 'open', trade_type: 'buy', quantity: 1000, open_price: 99, current_price: 101,
    profit: 2000, brokerage: 0, open_time: '2026-11-06T08:50:00Z',
  };
  const assertPosition = async () => {
    await page.getByRole('button', { name: 'Trade', exact: true }).click();
    assert.ok(await page.getByText('Positions (1)', { exact: true }).isVisible());
    assert.match(await page.getByText(/^Current:/).textContent(), /101\.00/);
    assert.ok(await page.getByText(/^\+.*2,000\.00$/).first().isVisible());
    assert.ok(await page.getByText('NIFTY-NOV', { exact: true }).first().isVisible());
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trade_axis_trading_cache')).openTrades);
    assert.equal(saved.length, 1);
    for (const field of ['id', 'symbol', 'quantity', 'open_price', 'open_time', 'trade_type']) {
      assert.equal(saved[0][field], position[field], `${field} remains intact through refresh/offline recovery`);
    }
  };
  let authCount = 0;
  let apiUnavailable = false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      if (apiUnavailable) return route.fulfill({ status: 503, json: { success: false, message: 'Test outage' } });
      let body = { success: true, data: [] };
      if (url.pathname.endsWith('/auth/login') || url.pathname.endsWith('/auth/me')) {
        authCount++;
        body.data = { user, accounts, token: 'fixture-only-token' };
      } else if (url.pathname.endsWith('/market/symbols')) body.symbols = symbols;
      else if (url.pathname.includes('/trading/positions/')) body.data = [position];
      else if (url.pathname.includes('/market/quote/')) body.quote = { ...symbols[0], timestamp: Date.now() };
      else if (url.pathname.endsWith('/market/status')) body.data = { isHoliday: false, marketOpen: true };
      else if (url.pathname === '/api/watchlists') body.data = [{ id: 'test-watchlist', name: 'Default', is_default: true }];
      else if (url.pathname.endsWith('/symbols')) body.data = symbols;
      else if (url.pathname.includes('/market/candles/')) body.candles = [];
      await route.fulfill({ json: body });
    } else if (url.hostname === '127.0.0.1' && url.port === '4176') await route.continue();
    else await route.abort();
  });
  await page.goto('http://127.0.0.1:4176/login');
  await page.locator('input').first().fill('TEST');
  await page.locator('input[type=password]').fill('fixture-password');
  await page.locator('button[type=submit]').click();
  await page.getByTitle('Refresh', { exact: true }).waitFor();
  console.log('Logged in; refreshing');
  for (let i = 0; i < 3; i++) {
    await page.getByTitle('Refresh', { exact: true }).click();
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, []);
    assert.ok(await page.getByTitle('Refresh', { exact: true }).isVisible());
    await assertPosition();
  }
  await page.reload();
  await page.getByTitle('Refresh', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok(authCount >= 4);
  apiUnavailable = true;
  await page.getByTitle('Refresh', { exact: true }).click();
  await page.getByRole('button', { name: 'Download positions', exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  await page.reload();
  await page.getByRole('button', { name: 'Download positions', exact: true }).first().waitFor();
  assert.ok(await page.getByTitle('Refresh', { exact: true }).isVisible());
  await assertPosition();
  await page.context().setOffline(true);
  await page.getByText('Offline mode.', { exact: false }).waitFor();
  await page.getByTitle('Refresh', { exact: true }).click();
  assert.deepEqual(errors, []);
  await page.context().setOffline(false);
  apiUnavailable = false;
  await page.getByTitle('Refresh', { exact: true }).click();
  await page.waitForTimeout(1000);
  assert.deepEqual(errors, []);
  assert.ok(await page.getByTitle('Refresh', { exact: true }).isVisible());
  await assertPosition();
  console.log('PASS login, repeated refresh, reload, API outage, cached startup, offline recovery; November position identity and 2,000 P&L preserved beside December 84,000 fixture');
} finally {
  if (browser) await browser.close();
  server.kill();
}
