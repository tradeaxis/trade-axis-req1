-- READ ONLY: inspect account 53208 before preparing any repair.
-- Run in the production Supabase SQL Editor. No UPDATE/DELETE/INSERT statements.
-- This includes the current symbol mapping and candidate contracts, not secrets.
SELECT
  u.login_id,
  a.account_number,
  to_jsonb(t) AS position,
  to_jsonb(s) AS current_symbol_mapping,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'symbol', candidate.symbol,
      'kite_tradingsymbol', candidate.kite_tradingsymbol,
      'instrument_token', candidate.kite_instrument_token,
      'expiry_date', candidate.expiry_date,
      'last_price', candidate.last_price,
      'close_price', candidate.close_price,
      'last_update', candidate.last_update
    ) ORDER BY candidate.expiry_date, candidate.symbol)
    FROM public.symbols candidate
    WHERE s.underlying IS NOT NULL AND candidate.underlying = s.underlying
  ) AS contracts_for_same_underlying,
  (
    SELECT to_jsonb(parent)
    FROM public.trades parent
    WHERE parent.id::text = to_jsonb(t)->>'settled_from_trade_id'
    LIMIT 1
  ) AS settlement_parent
FROM public.users u
JOIN public.accounts a ON a.user_id = u.id
JOIN public.trades t ON t.account_id = a.id
LEFT JOIN public.symbols s ON upper(s.symbol) = upper(t.symbol)
WHERE u.login_id::text = '53208' AND t.status = 'open'
ORDER BY a.account_number, t.open_time, t.id;
