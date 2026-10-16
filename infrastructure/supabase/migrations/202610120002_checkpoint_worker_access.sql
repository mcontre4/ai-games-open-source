-- The production API/worker uses a dedicated trusted role, not the migration owner.
-- BYPASSRLS does not imply SQL table privileges. Keep browser roles excluded.
do $$
begin
  if exists(select 1 from pg_roles where rolname = 'ai_games_app') then
    grant select,insert,update on public.generation_checkpoints to ai_games_app;
    grant select,insert on public.generation_calls to ai_games_app;
    grant usage on sequence public.generation_calls_id_seq to ai_games_app;
    if not (
      has_table_privilege('ai_games_app','public.generation_checkpoints','SELECT') and
      has_table_privilege('ai_games_app','public.generation_checkpoints','INSERT') and
      has_table_privilege('ai_games_app','public.generation_checkpoints','UPDATE') and
      has_table_privilege('ai_games_app','public.generation_calls','SELECT') and
      has_table_privilege('ai_games_app','public.generation_calls','INSERT') and
      has_sequence_privilege('ai_games_app','public.generation_calls_id_seq','USAGE')
    ) then
      raise exception 'Apply checkpoint access migration as the table owner or a superuser';
    end if;
  end if;
end $$;
