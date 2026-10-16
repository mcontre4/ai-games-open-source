-- A new UTC-day row is created on demand; unused credits never roll over.
create table if not exists public.daily_credits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  spent_cost numeric(12,6) not null default 0 check(spent_cost >= 0),
  held_cost numeric(12,6) not null default 0 check(held_cost >= 0),
  primary key(user_id,day)
);
alter table public.daily_credits enable row level security;
revoke all on public.daily_credits from authenticated,anon;

alter table public.generation_jobs add column if not exists credit_day date;
update public.generation_jobs set credit_day=(created_at at time zone 'UTC')::date where credit_day is null;
alter table public.generation_jobs alter column credit_day set not null;
alter table public.generation_jobs alter column credit_day set default (now() at time zone 'UTC')::date;
alter table public.inference_usage add column if not exists settled_at timestamptz;
update public.inference_usage set settled_at=created_at where actual_cost is not null and settled_at is null;

-- Preserve existing charges when introducing credits, including active budgets.
insert into public.daily_credits(user_id,day,spent_cost,held_cost)
select user_id,credit_day,sum(charged_cost),
  sum(case when stage not in ('ready','failed','cancelled') then greatest(reserved_cost-charged_cost,0) else 0 end)
from public.generation_jobs group by user_id,credit_day on conflict do nothing;

-- Keep accounting atomic with every job transition, including maintenance and deletion.
-- Costs survive game deletion; only unspent holds can be released.
create or replace function public.account_generation_credits() returns trigger
language plpgsql set search_path=public as $$
declare
  old_hold numeric := 0;
  new_hold numeric := 0;
  spent_delta numeric := 0;
  balance public.daily_credits%rowtype;
begin
  if TG_OP <> 'INSERT' then
    if old.stage not in ('ready','failed','cancelled') then
      old_hold := greatest(old.reserved_cost-old.charged_cost,0);
    end if;
  end if;
  if TG_OP = 'DELETE' then
    update daily_credits set held_cost=held_cost-old_hold
      where user_id=old.user_id and day=old.credit_day;
    return old;
  end if;
  if TG_OP = 'UPDATE' and (old.user_id <> new.user_id or old.credit_day <> new.credit_day) then
    raise exception 'Generation credit ownership and day are immutable';
  end if;
  if new.stage not in ('ready','failed','cancelled') then
    new_hold := greatest(new.reserved_cost-new.charged_cost,0);
  end if;
  if TG_OP = 'INSERT' then
    insert into daily_credits(user_id,day) values(new.user_id,new.credit_day) on conflict do nothing;
    select * into balance from daily_credits
      where user_id=new.user_id and day=new.credit_day for update;
    if balance.spent_cost+balance.held_cost+new.charged_cost+new_hold > 15 then
      raise exception 'Daily credits exhausted';
    end if;
    spent_delta := new.charged_cost;
  else
    spent_delta := new.charged_cost-old.charged_cost;
  end if;
  if spent_delta <> 0 or new_hold <> old_hold then
    update daily_credits set spent_cost=spent_cost+spent_delta,held_cost=held_cost+new_hold-old_hold
      where user_id=new.user_id and day=new.credit_day;
  end if;
  return new;
end; $$;
revoke all on function public.account_generation_credits() from public,authenticated,anon;
drop trigger if exists generation_credit_accounting on public.generation_jobs;
create trigger generation_credit_accounting after insert or update or delete on public.generation_jobs
  for each row execute function public.account_generation_credits();
