create table if not exists public.app_integrity_challenges (
  nonce text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check(purpose in ('register','request')),
  expires_at timestamptz not null
);
create index if not exists integrity_challenge_expiry on public.app_integrity_challenges(expires_at);
create index if not exists integrity_challenge_user on public.app_integrity_challenges(user_id);
create table if not exists public.app_integrity_instances (
  key_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0 check(counter >= 0)
);
create table if not exists public.guest_account_claims (
  guest_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  account_id uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  game_ids text[] not null default '{}'
);
alter table public.app_integrity_challenges enable row level security;
alter table public.app_integrity_instances enable row level security;
alter table public.guest_account_claims enable row level security;
revoke all on public.app_integrity_challenges,public.app_integrity_instances,public.guest_account_claims from public,anon,authenticated;

-- Already-issued guest JWTs must stop working after account linking, including through PostgREST.
create or replace function public.active_game_identity() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from guest_account_claims where guest_id=auth.uid() and claimed_at is not null);
$$;
revoke all on function public.active_game_identity() from public;
grant execute on function public.active_game_identity() to authenticated;
do $$ declare t text; begin
  foreach t in array array['profiles','games','game_versions','share_invitations','game_members','player_saves','game_scores','generation_jobs','generation_events','game_reports','blocked_users','hidden_games'] loop
    execute format('drop policy if exists active_identity on public.%I',t);
    execute format('create policy active_identity on public.%I as restrictive for all to authenticated using(public.active_game_identity()) with check(public.active_game_identity())',t);
  end loop;
end $$;
