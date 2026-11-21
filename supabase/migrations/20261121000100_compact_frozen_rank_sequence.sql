-- One-time compaction of persisted Frozen Rank positions.
--
-- Production currently has 41 locked builders with ranks 1-7 and 9-42, leaving
-- a single gap at rank 8. Rank allocation already starts at
-- MAX(frozen_rank) + 1, so the gap causes in-progress builders to start at #43
-- while the public leaderboard shows only 41 locked builders.
--
-- This migration:
--   1. orders every non-null frozen_rank ascending;
--   2. renumbers them to 1..count without changing their relative order;
--   3. leaves rank_frozen_at, Skill, Arcade, and total counts untouched;
--   4. is idempotent: a compact sequence is a no-op;
--   5. restores the existing allocation rule (next rank = max + 1 = 42).
--
-- The protect_frozen_rank trigger normally rejects any non-null rank change.
-- It is disabled only inside this transaction, using a two-phase update that
-- never collides with the unique partial index on frozen_rank.

begin;

do $$
declare
  v_trigger_state "char";
  v_count integer;
  v_min integer;
  v_max integer;
  v_offset integer;
  v_final_max integer;
begin
  -- Same advisory key used by private.allocate_frozen_ranks(), so a concurrent
  -- threshold crossing cannot allocate a rank while positions are moving.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.participant_frozen_rank', 0)
  );

  select count(*), pg_catalog.min(frozen_rank), pg_catalog.max(frozen_rank)
    into v_count, v_min, v_max
  from public.participants
  where frozen_rank is not null;

  if v_count = 0 then
    return;
  end if;

  -- Unique positive ranks with min = 1 and max = count are already compact.
  if v_min = 1 and v_max = v_count then
    return;
  end if;

  select trigger_state.tgenabled
    into v_trigger_state
  from pg_catalog.pg_trigger as trigger_state
  where trigger_state.tgrelid = 'public.participants'::regclass
    and trigger_state.tgname = 'participants_protect_frozen_rank'
    and not trigger_state.tgisinternal;

  if v_trigger_state is null then
    raise exception using
      errcode = 'P0002',
      message = 'participants_protect_frozen_rank trigger is missing';
  end if;

  execute pg_catalog.format(
    'alter table public.participants disable trigger %I',
    'participants_protect_frozen_rank'
  );

  -- Phase 1 moves every locked rank above the current maximum. Because the
  -- offset is max + 1, no temporary value can collide with an existing rank.
  v_offset := v_max + 1;

  with ranked as (
    select
      participant.id,
      (pg_catalog.row_number() over (
        order by participant.frozen_rank asc, participant.id asc
      ))::integer as compact_rank
    from public.participants as participant
    where participant.frozen_rank is not null
  )
  update public.participants as participant
  set frozen_rank = ranked.compact_rank + v_offset
  from ranked
  where participant.id = ranked.id;

  -- Phase 2 writes the final contiguous 1..count sequence. All old values have
  -- been vacated, so the unique partial index is respected throughout.
  with ranked as (
    select
      participant.id,
      (pg_catalog.row_number() over (
        order by participant.frozen_rank asc, participant.id asc
      ))::integer as compact_rank
    from public.participants as participant
    where participant.frozen_rank is not null
  )
  update public.participants as participant
  set frozen_rank = ranked.compact_rank
  from ranked
  where participant.id = ranked.id;

  -- Restore the trigger to its exact prior state.
  case v_trigger_state
    when 'O' then
      execute pg_catalog.format(
        'alter table public.participants enable trigger %I',
        'participants_protect_frozen_rank'
      );
    when 'D' then
      execute pg_catalog.format(
        'alter table public.participants disable trigger %I',
        'participants_protect_frozen_rank'
      );
    when 'R' then
      execute pg_catalog.format(
        'alter table public.participants enable replica trigger %I',
        'participants_protect_frozen_rank'
      );
    when 'A' then
      execute pg_catalog.format(
        'alter table public.participants enable always trigger %I',
        'participants_protect_frozen_rank'
      );
    else
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('Unknown frozen rank trigger state: %', v_trigger_state);
  end case;

  select pg_catalog.max(frozen_rank)
    into v_final_max
  from public.participants
  where frozen_rank is not null;

  if v_final_max is distinct from v_count then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'Frozen rank compaction ended with max % but expected %',
        v_final_max,
        v_count
      );
  end if;

  if exists (
    select 1
    from pg_catalog.generate_series(1, v_count) as series(rank_number)
    where not exists (
      select 1
      from public.participants as participant
      where participant.frozen_rank = series.rank_number
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Frozen rank compaction left a gap';
  end if;
end $$;

-- private.allocate_frozen_ranks() already uses MAX(frozen_rank) + 1, so after
-- compaction the next locked builder receives rank 42 with no code change.

commit;
