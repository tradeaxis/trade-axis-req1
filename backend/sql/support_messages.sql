create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  sender_role text not null default 'user' check (sender_role in ('user', 'admin', 'sub_broker', 'system')),
  title text not null default 'Support Query',
  content text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  user_read_at timestamptz,
  admin_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_messages_user_created_idx
  on public.support_messages (user_id, created_at desc);

create index if not exists support_messages_status_created_idx
  on public.support_messages (status, created_at desc);

alter table public.support_messages enable row level security;

drop policy if exists "support_messages_service_role_all" on public.support_messages;
create policy "support_messages_service_role_all"
  on public.support_messages
  for all
  to service_role
  using (true)
  with check (true);
