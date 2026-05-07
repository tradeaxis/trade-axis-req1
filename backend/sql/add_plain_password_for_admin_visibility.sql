-- Allows the admin dashboard to display the current password after it is
-- created, reset by admin, or changed by the user.
alter table public.users
  add column if not exists plain_password text;

