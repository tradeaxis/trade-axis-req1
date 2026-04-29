-- Run in Supabase SQL editor.
-- This migration reduces hot-path scans and prevents duplicate watchlist rows.

create index if not exists trades_status_account_open_idx
  on public.trades (status, account_id, open_time desc);

create index if not exists trades_account_status_close_idx
  on public.trades (account_id, status, close_time desc);

create index if not exists trades_status_symbol_idx
  on public.trades (status, symbol);

create index if not exists pending_orders_status_account_created_idx
  on public.pending_orders (status, account_id, created_at desc);

create index if not exists pending_orders_status_symbol_idx
  on public.pending_orders (status, symbol);

create index if not exists accounts_user_active_idx
  on public.accounts (user_id, is_active);

create index if not exists watchlists_user_created_idx
  on public.watchlists (user_id, created_at);

create index if not exists watchlist_symbols_watchlist_sort_idx
  on public.watchlist_symbols (watchlist_id, sort_order);

create index if not exists symbols_active_lookup_idx
  on public.symbols (is_active, instrument_type, category, underlying, expiry_date);

create index if not exists symbols_symbol_lookup_idx
  on public.symbols (symbol);

create index if not exists users_login_lookup_idx
  on public.users (login_id);

create index if not exists users_email_lookup_idx
  on public.users (email);

create index if not exists app_settings_key_lookup_idx
  on public.app_settings (key);

with ranked_watchlist_symbols as (
  select
    ctid,
    row_number() over (
      partition by watchlist_id, symbol
      order by sort_order asc nulls last, added_at asc nulls last, ctid
    ) as row_num
  from public.watchlist_symbols
)
delete from public.watchlist_symbols ws
using ranked_watchlist_symbols ranked
where ws.ctid = ranked.ctid
  and ranked.row_num > 1;

create unique index if not exists watchlist_symbols_watchlist_symbol_uidx
  on public.watchlist_symbols (watchlist_id, symbol);
