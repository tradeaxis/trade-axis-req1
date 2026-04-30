-- Run this once in Supabase SQL editor if your transactions table still rejects status = 'rejected'.
-- The backend now falls back to 'failed' automatically, but this keeps the DB aligned with the app label.

alter table if exists public.transactions
  drop constraint if exists transactions_status_check;

alter table if exists public.transactions
  add constraint transactions_status_check
  check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled', 'approved', 'processed', 'rejected'));
