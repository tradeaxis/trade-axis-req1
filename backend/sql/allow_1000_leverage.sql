-- Run this once in Supabase SQL editor only if you want to support 1:1000 leverage.
-- The app now defaults to the DB-safe leverage list, so this migration is optional.

alter table if exists public.accounts
  drop constraint if exists accounts_leverage_check;

alter table if exists public.accounts
  add constraint accounts_leverage_check
  check (leverage in (1, 2, 5, 10, 20, 25, 30, 40, 50, 100, 200, 300, 500, 1000));
