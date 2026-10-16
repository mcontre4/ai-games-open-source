-- Authoritative account events, including signups outside the mobile app.
-- Payloads contain only UUIDs and a confirmation boolean, never profile contents.
create table if not exists public.analytics_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event text not null check (event in ('account_created','account_updated','account_deleted')),
  email_confirmed boolean not null,
  created_at timestamptz not null default now()
);
alter table public.analytics_outbox enable row level security;
revoke all on public.analytics_outbox from anon, authenticated;
create index if not exists analytics_outbox_created on public.analytics_outbox(created_at);
create or replace function public.record_account_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.analytics_outbox(user_id,event,email_confirmed)
      values(new.id,'account_created',new.email_confirmed_at is not null);
  elsif TG_OP = 'UPDATE' then
    if new.raw_user_meta_data is distinct from old.raw_user_meta_data
      or new.email_confirmed_at is distinct from old.email_confirmed_at
      or new.email is distinct from old.email then
      insert into public.analytics_outbox(user_id,event,email_confirmed)
        values(new.id,'account_updated',new.email_confirmed_at is not null);
    end if;
  else
    insert into public.analytics_outbox(user_id,event,email_confirmed)
      values(old.id,'account_deleted',old.email_confirmed_at is not null);
  end if;
  return null;
end $$;
revoke all on function public.record_account_analytics() from public;
drop trigger if exists record_account_analytics on auth.users;
create trigger record_account_analytics after insert or update or delete on auth.users
for each row execute function public.record_account_analytics();
