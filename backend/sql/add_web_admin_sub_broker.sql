-- Adds the ownership fields used by the separate Trade Axis web console.
-- Existing APK endpoints continue to work; these columns are only used by /api/web-admin.

alter table if exists users
  add column if not exists created_by uuid null references users(id) on delete set null;

create index if not exists idx_users_created_by on users(created_by);
create index if not exists idx_users_role on users(role);

-- If your database has a strict role check constraint, replace it so sub brokers can log in.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'users'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';

  if constraint_name is not null then
    execute format('alter table users drop constraint %I', constraint_name);
  end if;
end $$;

alter table users
  add constraint users_role_check
  check (role in ('admin', 'sub_broker', 'user'));

comment on column users.created_by is
  'For web console scoping: sub_broker users can manage clients where users.created_by equals their user id.';
