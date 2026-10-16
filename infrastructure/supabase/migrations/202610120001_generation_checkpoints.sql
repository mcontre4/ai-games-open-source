-- Checkpoints and provider conversations are private worker data, not playable content.
alter table public.generation_jobs add column if not exists retry_of text references public.generation_jobs(id) on delete set null;
create unique index if not exists generation_retry_once on public.generation_jobs(retry_of) where retry_of is not null;
create table if not exists public.generation_checkpoints (
  generation_id text primary key references public.generation_jobs(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.generation_calls (
  id bigint generated always as identity primary key,
  generation_id text not null references public.generation_jobs(id) on delete cascade,
  input jsonb not null,
  output jsonb,
  created_at timestamptz not null default now()
);
create index if not exists generation_calls_job on public.generation_calls(generation_id,id);
alter table public.generation_checkpoints enable row level security;
alter table public.generation_calls enable row level security;
revoke all on public.generation_checkpoints,public.generation_calls from anon,authenticated;
-- The existing trusted worker uses the same privileged database role as generation_jobs.
