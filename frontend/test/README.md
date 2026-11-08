# Refresh blackout regression

The saved-data banner used a `border` variable outside its scope. Refreshing an
account hydrates its position snapshot, which can render that banner even while
online. The resulting ReferenceError unmounted the React app. The banner now
uses the current theme directly for its border color.

The browser regression reproduced `border is not defined` before the fix. It
tests dummy login, three refreshes, reload, a 503 API outage, cached-session
startup, offline refresh and reconnection. All API traffic is intercepted; it
does not use customer credentials or submit trades.

Run from frontend with Playwright installed:

```text
npm run build
node test/refresh-browser.mjs
```

Set `TEST_BUILD=1` to exercise the production bundle instead of the development
server. `PLAYWRIGHT_MODULE_PATH` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally
select an existing Playwright package and browser. Tests start and stop a local
server on port 4176. This validates mobile browser rendering, not a physical
Android device.

## Live-update and refresh regression

The test also simulates Socket.IO account, position P&L and exact-contract price
events. Before the fix, each account update hydrated the saved positions and
flashed the outage banner. After fixing that dependency, the test exposed a
second defect: refreshing replaced the streamed 119.00 quote with the older
100.50 catalogue price. Both failures were reproduced before their fixes.

Assertions cover screen position, rendered current price and P&L, no repeated
position requests/account subscriptions, rejection of a different contract,
retention of live prices during refresh, a stable warning through failed
position retries, and successful outage recovery. API and socket traffic are
mocked; these are not exchange-price or physical-device checks.

`node --test test/market-refresh.test.mjs` additionally checks delayed REST
responses, quote age preservation, newer database quotes, changed instrument
identity, and switching to the closing snapshot after trading hours.
