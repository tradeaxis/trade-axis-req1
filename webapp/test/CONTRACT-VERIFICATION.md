# User web position contract regression

The order picker removes rolling aliases (`-I`, `-II`) and contracts outside its
visibility window. Previously the position lookup reused that filtered list and
fell back to the underlying name. For `SIEMENS-II` and `TMPV-II` this selected the
first October row even though the catalogue mapped `-II` to November.

The Trade view now retains the complete catalogue from the same existing request.
Position names and prices use exact contract lookup against that catalogue. An
unresolved position keeps its saved symbol and API price rather than selecting
another expiry. New Order resolves an alias to the dated contract in the picker.
The streaming transport, request interval, backend, database and APK are unchanged.

## Automated checks

From `webapp`:

```text
npm test
npm run build
node test/position-contract-browser.mjs
```

The browser test requires Playwright and Chromium. It uses an installed `playwright`
package, or `PLAYWRIGHT_MODULE_PATH` pointing to an existing package directory.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can specify an existing Chromium executable.
It starts and stops a local preview on port 4175 and intercepts every API request.
It uses dummy accounts and never submits an order.

Coverage includes both reported scripts, aliases and dated contracts, all twelve
month ends, December/January, reordered catalogues, missing contracts, different
years, picker visibility, prices during/after market hours and buy/sell P&L.
Browser checks cover October/November, November/December and December/January
through repeated quote refreshes and opening the New Order ticket.

## Deployment verification

Deploy the updated **webapp** and hard-refresh the user dashboard. No backend
deployment or APK rebuild is needed for this change. For an existing November
SIEMENS or TMPV position, compare the saved contract with the user-web card,
APK and admin view. Keep the user view open through several refreshes, then
reload it. The contract should remain November; its quote must belong to that
same expiry. Opening New Order should retain November without submitting a trade.

Local tests use fixture positions; they do not authenticate to a production user
account or prove a deployment has succeeded. Legacy alias positions still rely
on the server's alias metadata; this change does not rewrite saved trades or infer
a historical contract if that metadata is absent.
