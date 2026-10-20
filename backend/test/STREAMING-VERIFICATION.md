# Streaming regression verification

Run `npm test` from `backend`. Tests use mocks and never connect to production.

The regression suite reproduces these failures in the pre-fix services:

- A database response capped at 1,000 rows silently excludes subscription
  contracts beyond that response, even though the dashboard paginates.
- A closing snapshot requesting `limit(10000)` still loses rows when the
  database server enforces a smaller cap.
- REST recovery accepts an old exchange quote and stamps it with request time,
  making a stale value appear fresh.

Tests cover complete pagination, current/next expiry isolation, page failures,
REST timestamp freshness, delayed responses, DB flush identity, quote-time
preservation, holiday session boundaries and ordinary F&O/MCX hours.

## Production validation after deployment

1. Inspect `Token map built from ... database rows` in runtime logs. The
   `/health` response now reports `subscriptionRowCount` and `cachedTokenCount`.
   Compare the actual subscribed token identities with visible contracts; a
   healthy socket alone does not prove complete coverage.
2. During an open session, sample `/api/market/symbols` repeatedly. Confirm that
   every expected contract has a recent exchange quote, then compare exact
   trading symbols/tokens and prices with the broker. Unchanged LTP alone is
   not proof of a failure; timestamp updates from REST alone are not proof of
   WebSocket delivery.
3. Check October and November independently for NIFTY, CUMMINSIND, CANBK,
   AXISBANK and ONGC. Check both raw symbols and series aliases.
4. After close, compare captured prices and a representative position's P&L
   across APK, user web and admin web. This patch does not recalculate stored
   executions or settlements.

20 October 2026 is an NSE/F&O holiday; live F&O movement cannot be validated
that day. MCX opens at 17:00 IST per the cited notice in exchangeCalendar.js.
The bundled NSE calendar covers 2026 only; later annual calendars and special
sessions require maintained calendar data. Manual holiday controls remain.

The capped-query failures are reproduced locally. Their contribution to every
previously reported production failure remains to be confirmed after deployment.
