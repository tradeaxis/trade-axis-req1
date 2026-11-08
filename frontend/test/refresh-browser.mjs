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
  await page.clock.setFixedTime(new Date('2026-11-08T09:00:00Z'));
  const user = { id: 'test-user', role: 'user', loginId: 'TEST', firstName: 'Test' };
  const accounts = [{ id: 'test-account', account_number: 'TEST', is_demo: false, balance: 10000, leverage: 5 }];
  const symbols = [{ symbol: 'NIFTY26NOVFUT', display_name: 'NIFTY NOV26 FUT', underlying: 'NIFTY',
    expiry_date: '2026-11-24', kite_instrument_token: 12345, category: 'index_futures',
    exchange: 'NSE', instrument_type: 'FUT', lot_size: 1, bid: 100, ask: 101, last_price: 100.5 }];
  let authCount = 0;
  let apiUnavailable = false;
  let positionsUnavailable = false;
  let positionsRequests = 0;
  let accountSubscriptions = 0;
  const sockets = new Set();
  await page.routeWebSocket(/\/socket\.io\//, ws => {
    ws.onMessage(message => {
      if (String(message).startsWith('40')) {
        sockets.add(ws);
        ws.send('40{"sid":"fixture-socket"}');
      }
      if (String(message).includes('subscribe:account')) accountSubscriptions++;
    });
    ws.onClose(() => sockets.delete(ws));
    ws.send('0{"sid":"fixture-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}');
  });
  const emit = (event, payload) => {
    for (const ws of sockets) ws.send(`42${JSON.stringify([event, payload])}`);
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      if (apiUnavailable) return route.fulfill({ status: 503, json: { success: false, message: 'Test outage' } });
      if (positionsUnavailable && url.pathname.includes('/trading/positions/')) {
        await new Promise(resolve => setTimeout(resolve, 300));
        return route.fulfill({ status: 503, json: { success: false, message: 'Positions outage' } });
      }
      let body = { success: true, data: [] };
      if (url.pathname.endsWith('/auth/login') || url.pathname.endsWith('/auth/me')) {
        authCount++;
        body.data = { user, accounts, token: 'fixture-only-token' };
      } else if (url.pathname.endsWith('/market/symbols')) body.symbols = symbols;
      else if (url.pathname.includes('/trading/positions/')) {
        positionsRequests++;
        await new Promise(resolve => setTimeout(resolve, 200));
        body.data = [{
        id: 'fixture-trade', account_id: accounts[0].id, symbol: symbols[0].symbol,
        status: 'open', trade_type: 'buy', quantity: 1, open_price: 99, current_price: 100,
        profit: 1, brokerage: 0, open_time: '2026-11-08T08:50:00Z',
        }];
      }
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
  await page.waitForTimeout(1000);
  assert.ok(sockets.size > 0, 'Mock market socket connected');
  await page.getByRole('button', { name: 'Trade', exact: true }).click();
  const positionLabel = page.getByText('Positions (1)', { exact: true });
  const positionTop = (await positionLabel.boundingBox()).y;
  const initialRequests = positionsRequests;
  const initialSubscriptions = accountSubscriptions;
  await page.evaluate(() => {
    window.snapshotFlashes = 0;
    new MutationObserver(() => {
      if (document.body.textContent.includes('Connection issue detected.')) window.snapshotFlashes++;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  for (let i = 0; i < 10; i++) {
    emit('price:update', { symbol: symbols[0].symbol, instrumentToken: 12345,
      expiryDate: '2026-11-24', contractMonth: 'NOV', source: 'kite', last: 110 + i, bid: 109 + i, ask: 111 + i });
    emit('trade:pnl', { tradeId: 'fixture-trade', currentPrice: 110 + i, profit: 11 + i });
    emit('account:update', { accountId: accounts[0].id, balance: 10000, equity: 10011 + i, profit: 11 + i });
    await page.waitForTimeout(100);
    assert.equal((await positionLabel.boundingBox()).y, positionTop, 'Live updates must not move the positions screen');
  }
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.snapshotFlashes), 0, 'Live ticks must not display the outage banner');
  assert.equal(positionsRequests, initialRequests, 'P&L updates must not refetch positions');
  assert.equal(accountSubscriptions, initialSubscriptions, 'P&L updates must not resubscribe accounts');
  const lastPrice = () => page.evaluate(() => JSON.parse(localStorage.getItem('trade_axis_market_cache')).quotes.NIFTY26NOVFUT.last);
  assert.equal(await lastPrice(), 119);
  assert.match(await page.getByText(/^Current:/).textContent(), /119\.00/);
  assert.ok(await page.getByText(/^\+.*20\.00$/).first().isVisible(), 'Displayed P&L follows the live price');
  emit('price:update', { symbol: symbols[0].symbol, instrumentToken: 99999,
    expiryDate: '2026-12-29', contractMonth: 'DEC', source: 'kite', last: 999 });
  await page.waitForTimeout(100);
  assert.equal(await lastPrice(), 119, 'Another contract must not overwrite the selected contract');
  console.log('Logged in; refreshing');
  for (let i = 0; i < 3; i++) {
    await page.getByTitle('Refresh', { exact: true }).click();
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, []);
    assert.ok(await page.getByTitle('Refresh', { exact: true }).isVisible());
    assert.equal(await lastPrice(), 119, 'Refresh must not replace a live tick with an older database price');
    assert.match(await page.getByText(/^Current:/).textContent(), /119\.00/);
    assert.equal(await page.evaluate(() => window.snapshotFlashes), 0, 'Healthy refresh must not display the outage banner');
  }
  await page.reload();
  await page.getByTitle('Refresh', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok(authCount >= 4);
  positionsUnavailable = true;
  await page.getByTitle('Refresh', { exact: true }).click();
  await page.getByText('Connection issue detected.', { exact: false }).waitFor();
  await page.evaluate(() => {
    window.outageGaps = 0;
    window.outageObserver = new MutationObserver(() => {
      if (!document.body.textContent.includes('Connection issue detected.')) window.outageGaps++;
    });
    window.outageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForTimeout(1000);
  await page.getByTitle('Refresh', { exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.outageGaps), 0, 'A failed retry must not hide the outage warning');
  await page.evaluate(() => window.outageObserver.disconnect());
  positionsUnavailable = false;
  await page.getByTitle('Refresh', { exact: true }).click();
  await page.getByText('Connection issue detected.', { exact: false }).waitFor({ state: 'hidden' });
  await page.waitForTimeout(1000);
  apiUnavailable = true;
  await page.getByTitle('Refresh', { exact: true }).click();
  await page.getByRole('button', { name: 'Download positions', exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  await page.reload();
  await page.getByRole('button', { name: 'Download positions', exact: true }).first().waitFor();
  assert.ok(await page.getByTitle('Refresh', { exact: true }).isVisible());
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
  console.log('PASS live account/P&L/price events, stable layout, exact contract, price/P&L display, refresh, reload, API outage, cached startup, offline and recovery');
} finally {
  if (browser) await browser.close();
  server.kill();
}
