-- Repair local databases whose applied 20261031000100 migration predates the
-- cooldown column currently required by claim_participant_auto_fetch.
-- This is additive and does not modify participant rows or verified data.
do $$
declare
  v_type text;
begin
  if to_regclass('public.participant_auto_progress') is null then
    raise exception 'participant_auto_progress is missing; refusing partial repair';
  end if;

  select data_type
    into v_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'participant_auto_progress'
     and column_name = 'next_fetch_allowed_at';

  if v_type is null then
    alter table public.participant_auto_progress
      add column next_fetch_allowed_at timestamptz;
  elsif v_type <> 'timestamp with time zone' then
    raise exception 'participant_auto_progress.next_fetch_allowed_at has an unexpected type';
  end if;
end;
$$;
