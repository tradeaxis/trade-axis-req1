# Rollback refresh validation

The application source remains at pre-Diwali commit `4dc2d60` except for the
saved-position banner's border color. The rollback restored an undefined
`border` reference which crashed React on refresh. The browser test reproduced
that ReferenceError before the one-line fix.

`refresh-browser.mjs` intercepts all API traffic and uses a dummy account. It
checks login, three refreshes, reload, API outage, offline startup/recovery,
and preservation of a November position beside a December price which would
inflate its P&L. It does not trade, read production accounts, or test native
Android on a physical device.

Run `npm run build`, then set `TEST_BUILD=1` and run
`node test/refresh-browser.mjs`. Optional `PLAYWRIGHT_MODULE_PATH` and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` select an installed Playwright/browser.

Run `node --test test/restored-position-prices.test.mjs` for fixed audit-price
examples. These tests demonstrate that explicit November symbols stay attached
to November, but old rolling `-II` names follow their current December mapping.
They do not establish the original expiry of a legacy rolling position.

Production position restoration requires a pre-update symbol mapping or other
historical evidence. The read-only SQL audit is in
`backend/sql/audit-53208-open-positions.sql`. No production data repair has been
executed by these tests or by the APK build.
