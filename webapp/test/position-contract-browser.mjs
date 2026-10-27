// Run after npm run build. Requires Playwright (or PLAYWRIGHT_MODULE_PATH).
// All API calls are intercepted; this never places a trade or uses a real account.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview server timed out')), 20000);
    server.stdout.on('data', (data) => { if (String(data).includes('4175')) { clearTimeout(timeout); resolve(); } });
    server.on('error', reject);
    server.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Preview exited: ${code}`)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  for (const [date, current, next, year, nextYear] of [
    ['2026-10-27', 'OCT', 'NOV', '26', '26'],
    ['2026-11-25', 'NOV', 'DEC', '26', '26'],
    ['2026-12-25', 'DEC', 'JAN', '26', '27'],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date(`${date}T06:00:00Z`));
    const account = { id: 'test-account', is_demo: true, balance: 10000 };
    const user = { id: 'test-user', role: 'user', login_id: 'TEST' };
    const session = { user, accounts: [account], selectedAccountId: account.id };
    await page.addInitScript((session) => {
      localStorage.setItem('trade_axis_web_auth', JSON.stringify(session));
      localStorage.setItem('trade_axis_web_token', 'local-test-only');
    }, session);
    let polls = 0;
    const rows = ['SIEMENS', 'TMPV'].flatMap((base, baseIndex) => [current, next].flatMap((mon, offset) => {
      const yy = offset ? nextYear : year;
      const monthNumber = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(mon) + 1;
      const row = { symbol: `${base}${yy}${mon}FUT`, underlying: base,
        kite_tradingsymbol: `${base}${yy}${mon}FUT`, display_name: `${base} ${mon}${yy} FUT`,
        expiry_date: `20${yy}-${String(monthNumber).padStart(2, '0')}-28`,
        kite_instrument_token: 100 + baseIndex * 10 + offset, category: 'stock_futures',
        last_price: offset ? 1100 : 1000, close_price: offset ? 1090 : 990,
      };
      return [row, { ...row, symbol: `${base}-${offset ? 'II' : 'I'}` }];
    }));
    const positions = ['SIEMENS-II', 'TMPV-II', `TMPV${nextYear}${next}FUT`].map((symbol, i) => ({
      id: `trade-${i}`, symbol, status: 'open', trade_type: 'buy', quantity: 2,
      open_price: 1050, current_price: 1100, buy_brokerage: 10,
    }));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      assert.equal(route.request().method(), 'GET');
      let body;
      if (path.endsWith('/auth/me')) body = { data: session };
      else if (path.endsWith('/market/symbols')) {
        polls++;
        const refreshed = rows.map((row) => ({ ...row, last_price: row.last_price + polls }));
        body = { symbols: polls % 2 ? refreshed : refreshed.reverse() };
      } else if (path.includes('/trading/positions/')) body = { data: positions };
      else if (path.includes('/trading/pending-orders/')) body = { data: [] };
      else throw new Error(`Unexpected API call: ${path}`);
      await route.fulfill({ json: { success: true, ...body } });
    });
    await page.goto('http://127.0.0.1:4175');
    await page.getByText('Current: 1104.00', { exact: true }).first().waitFor();
    const cards = await page.locator('.position-card').allTextContents();
    assert.equal(cards.length, 3);
    for (const card of cards) {
      assert.match(card, new RegExp(`(?:SIEMENS|TMPV)-${next}`));
      assert.doesNotMatch(card, new RegExp(`(?:SIEMENS|TMPV)-${current}`));
      const price = Number(card.match(/Current: (\d+\.\d{2})/)[1]);
      assert.ok(price >= 1104 && price < 1200, card);
      assert.ok(card.endsWith(((price - 1050) * 2 - 10).toFixed(2)), card);
    }
    // New Order from an APK alias must open the dated next-month ticket.
    const first = page.locator('.position-card').first();
    await first.locator('.position-card-main').click();
    await first.getByRole('button', { name: 'New Order', exact: true }).click();
    await page.getByText(`SIEMENS-${next}`, { exact: true }).last().waitFor();
    assert.equal(await page.locator('.locked-script-field').innerText(), `SIEMENS-${next}`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${date}: next-month labels, prices, P&L and order ticket after ${polls} polls`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
