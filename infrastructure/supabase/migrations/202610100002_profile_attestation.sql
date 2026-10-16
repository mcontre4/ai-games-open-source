create or replace function public.new_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into profiles(id,display_name,age_confirmed) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Player'),40),coalesce(new.raw_user_meta_data->>'age_confirmed','false')='true');
 return new;
end; $$;
update profiles p set age_confirmed=coalesce(u.raw_user_meta_data->>'age_confirmed','false')='true' from auth.users u where u.id=p.id;
