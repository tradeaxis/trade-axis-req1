alter table if exists public.trades
  add column if not exists original_quantity numeric;

update public.trades
set original_quantity = case
  when regexp_match(coalesce(comment, ''), 'Partial close:\s*([0-9.]+)\s+of\s+([0-9.]+)', 'i') is not null
    then ((regexp_match(coalesce(comment, ''), 'Partial close:\s*([0-9.]+)\s+of\s+([0-9.]+)', 'i'))[2])::numeric
  else quantity
end
where original_quantity is null;

notify pgrst, 'reload schema';
