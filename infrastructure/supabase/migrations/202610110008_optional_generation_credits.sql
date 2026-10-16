-- Store charging policy per job so changing the switch cannot charge paused jobs later.
alter table public.generation_jobs add column if not exists credits_enabled boolean not null default true;

create or replace function public.account_generation_credits() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  old_hold numeric := 0;
  new_hold numeric := 0;
  spent_delta numeric := 0;
  balance public.daily_credits%rowtype;
begin
  if TG_OP = 'UPDATE' and old.credits_enabled is distinct from new.credits_enabled then
    raise exception 'Generation credit policy is immutable';
  end if;
  if TG_OP = 'DELETE' and not old.credits_enabled then
    return old;
  end if;
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
  if TG_OP = 'UPDATE' and old.credit_day <> new.credit_day then
    raise exception 'Generation credit day is immutable';
  end if;
  if TG_OP = 'UPDATE' and old.user_id <> new.user_id then
    if old.stage is distinct from new.stage or old.reserved_cost is distinct from new.reserved_cost
       or old.charged_cost is distinct from new.charged_cost
       or not exists(select 1 from guest_account_claims c join auth.users u on u.id=c.guest_id
                     where c.guest_id=old.user_id and c.account_id=new.user_id and c.claimed_at is not null and u.is_anonymous) then
      raise exception 'Generation credit ownership is immutable except for an authorized guest claim';
    end if;
    return new;
  end if;
  if not new.credits_enabled then
    return new;
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
