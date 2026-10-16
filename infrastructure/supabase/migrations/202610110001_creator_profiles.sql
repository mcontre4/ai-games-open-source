alter table public.profiles
  add column if not exists username text,
  add column if not exists avatar_id text not null default 'blob',
  add column if not exists bio text not null default '',
  add column if not exists profile_visible boolean not null default true,
  add column if not exists auto_sync boolean not null default true,
  add column if not exists leaderboard_visible boolean not null default true;
update public.profiles set username='p_' || left(replace(id::text,'-',''),23) where username is null;
update public.profiles set display_name=left(coalesce(nullif(trim(display_name),''),'Player'),40);
alter table public.profiles alter column username set not null;
do $$ begin
if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_username_key') then
alter table public.profiles add constraint profiles_username_key unique(username),
  add constraint profiles_username_format check(username ~ '^[a-z0-9_]{4,25}$'),
  add constraint profiles_username_reserved check(username not in ('admin','administrator','support','aigames','moderator')),
  add constraint profiles_avatar_id check(avatar_id in ('blob','sprout','noodle','puddle','crumb','wiggle','moss','pip','fizz','orbit')),
  add constraint profiles_bio_length check(length(bio)<=280),
  add constraint profiles_display_name_length check(length(trim(display_name)) between 1 and 40);
end if;
end; $$;
create or replace function public.new_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin
  insert into profiles(id,display_name,age_confirmed,username)
  values(new.id,left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Player'),40),
    coalesce(new.raw_user_meta_data->>'age_confirmed','false')='true',
    'p_' || left(replace(new.id::text,'-',''),23));
  return new;
end; $$;
