-- Persist reservation policy so late settlement remains correct after changing the server switch.
alter table public.inference_usage add column if not exists estimated_reserved boolean not null default true;
