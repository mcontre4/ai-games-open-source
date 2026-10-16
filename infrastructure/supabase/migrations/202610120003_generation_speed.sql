-- Retain the deployed Ultrafast policy for existing jobs and their retries.
alter table public.generation_jobs
  add column if not exists speed text not null default 'ultra-fast'
  check (speed in ('regular','fast','ultra-fast'));
-- New clients and requests without a selection use ordinary model routing.
alter table public.generation_jobs alter column speed set default 'regular';
