# One-date Muhurat session

Applies only to **8 November 2026**, using India time:

- F&O continuous trading: 14:20 inclusive to 15:40 exclusive.
- MCX trading: 14:20 inclusive to 15:30 exclusive.
- Pre-open is excluded. Other weekend and ordinary weekday rules are unchanged.

Sources:

- NSE F&O circular NSE/FAOP/76940:
  https://nsearchives.nseindia.com/content/circulars/FAOP76940.pdf
- MCX circular MCX/TRD/590/2026:
  https://www.mcxindia.com/docs/default-source/circulars/english/2026/october/circular-590-2026.pdf?sfvrsn=41cf74f3_1

Deploy the backend and webapp. Rebuild the frontend assets, sync Capacitor Android,
build the APK and install that updated APK on user devices. The old APK's local
Sunday checks cannot be changed by deploying the backend alone.

Authenticate Kite for the session and verify fresh prices for the exact selected
contract. All existing stale-quote, balance, account and order validation remains
active. An explicit admin holiday closure still takes priority.

Closing snapshots have additional date-guarded Sunday schedules after each
segment closes. Restart catch-up skips segments until their special session ends.
The exception expires automatically at the end of the IST date; no manual revert
is necessary and it does not recur next year.

Validation: `npm test` in backend covers all three client market-hours checks and
the backend at session boundaries, other weekends, Monday, cached holidays,
manual closure and restart snapshots. Webapp contract regression tests and both
Vite builds also passed. These are local tests, not a production trading test.
