-- Phase 6D: persistent 10-Skill-Badge rank freeze.
--
-- Rules implemented here:
--   1. A participant's leaderboard rank is frozen exactly once, the first time
--      their verified Skill Badge count reaches 10 or more.
--   2. Arcade Game Badges never contribute to the threshold, even when the
--      combined total is 10 or more.
--   3. The frozen rank is persisted in participants.frozen_rank together with
--      participants.rank_frozen_at. It is never recalculated or overwritten by
--      later badge gains or by later leaderboard reads.
--   4. Simultaneous crossings are allocated deterministically in one batch,
--      ordered by Skill Badges DESC, Arcade Game Badges DESC, Total Badges DESC,
--      then stable participant UUID ASC. Each allocation receives the next
--      distinct sequential rank above the current maximum frozen rank.
--   5. Existing participants who already have 10+ Skill Badges receive their
--      verified historical crossing position, reconstructed from the immutable
--      participant_audit_events trail. The backfill below is explicit because a
--      current-count ordering would assign the wrong historical rank to anyone
--      who gained badges after crossing.
--   6. Unfrozen participants remain dynamically ordered and receive the
--      distinct sequential ranks after all frozen ranks. Soft-removed
--      participants are never allocated a rank, so retained participants keep
--      a contiguous public leaderboard.
--
-- This migration is additive except for replacing get_public_summary(), which
-- drops the obsolete five_badge_count field and exposes frozen_rank_count.
-- It does not modify any participant badge counts.

-- ----------------------------------------------------------------
-- 1. Persistent frozen-rank columns
-- ----------------------------------------------------------------
alter table public.participants
  add column if not exists frozen_rank integer,
  add column if not exists rank_frozen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.participants'::regclass
      and conname = 'participants_frozen_rank_positive'
  ) then
    alter table public.participants
      add constraint participants_frozen_rank_positive
      check (frozen_rank is null or frozen_rank > 0) not valid;
    alter table public.participants validate constraint participants_frozen_rank_positive;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.participants'::regclass
      and conname = 'participants_frozen_rank_pair'
  ) then
    alter table public.participants
      add constraint participants_frozen_rank_pair
      check ((frozen_rank is null) = (rank_frozen_at is null)) not valid;
    alter table public.participants validate constraint participants_frozen_rank_pair;
  end if;
end $$;

-- Frozen ranks are unique. A deleted participant leaves a permanent gap; the
-- rank number is never reused or renumbered.
create unique index if not exists participants_frozen_rank_key
  on public.participants (frozen_rank)
  where frozen_rank is not null;

-- ----------------------------------------------------------------
-- 2. Public read access to the frozen-rank projection
-- ----------------------------------------------------------------
grant select (frozen_rank, rank_frozen_at)
  on public.participants to anon;

-- ----------------------------------------------------------------
-- 3. Deterministic, idempotent allocation
--    Allocates a rank only to eligible participants whose frozen_rank is null.
--    Safe to call repeatedly; it never rewrites an existing frozen rank.
-- ----------------------------------------------------------------
create or replace function private.allocate_frozen_ranks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocated integer;
begin
  -- Serialize concurrent threshold crossings so no two transactions can
  -- allocate the same next rank.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.participant_frozen_rank', 0)
  );

  with eligible as (
    select
      participants.id,
      pg_catalog.row_number() over (
        order by
          participants.skill_badge_count desc,
          participants.arcade_game_badge_count desc nulls last,
          participants.verified_badge_count desc,
          participants.id asc
      ) as position
    from public.participants
    where participants.skill_badge_count >= 10
      and participants.registration_status = 'registered'
      and participants.frozen_rank is null
  ),
  base as (
    select coalesce(max(participants.frozen_rank), 0) as max_rank
    from public.participants
    where participants.frozen_rank is not null
  )
  update public.participants as p
  set frozen_rank = (base.max_rank + eligible.position)::integer,
      rank_frozen_at = pg_catalog.now()
  from eligible, base
  where p.id = eligible.id
    and p.frozen_rank is null;

  get diagnostics v_allocated = row_count;
  return v_allocated;
end;
$$;
revoke all on function private.allocate_frozen_ranks() from public;

-- ----------------------------------------------------------------
-- 4. Capture once, never overwrite
-- ----------------------------------------------------------------
create or replace function private.capture_frozen_ranks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.allocate_frozen_ranks();
  return null;
end;
$$;
revoke all on function private.capture_frozen_ranks() from public;

drop trigger if exists participants_capture_frozen_ranks on public.participants;
create trigger participants_capture_frozen_ranks
after update of skill_badge_count on public.participants
for each statement
execute function private.capture_frozen_ranks();

drop trigger if exists participants_capture_frozen_ranks_insert on public.participants;
create trigger participants_capture_frozen_ranks_insert
after insert on public.participants
for each statement
execute function private.capture_frozen_ranks();

create or replace function private.protect_frozen_rank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.frozen_rank is not null then
    if new.frozen_rank is distinct from old.frozen_rank then
      raise exception using
        errcode = '42501',
        message = 'A frozen rank cannot be changed once captured';
    end if;
    if new.rank_frozen_at is distinct from old.rank_frozen_at then
      raise exception using
        errcode = '42501',
        message = 'A frozen rank timestamp cannot be changed once captured';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_frozen_rank() from public;

drop trigger if exists participants_protect_frozen_rank on public.participants;
create trigger participants_protect_frozen_rank
before update on public.participants
for each row
execute function private.protect_frozen_rank();

-- ----------------------------------------------------------------
-- 5. Backfill existing 10+ Skill Badge participants
--
-- Positions are the verified first-threshold-crossing order taken from
-- participant_audit_events, not the current badge totals:
--   2026-11-04 17:58:16.995195+00  (11 Skill then 10 Skill, UUID order)
--   2026-11-05 08:45:29.446274+00  (Navya shah)
--   2026-11-06 11:21:55.345770+00  (Riteek 19, Lokendra 14, Nikhil Tank 11,
--                                   Twinkle 10)
--
-- Chirag Bhavnani (64a6be93-7070-4b03-a491-10eef8c907ac) crossed first on
-- 2026-11-04 with 13 Skill Badges but is soft-removed, so he is deliberately
-- excluded from the public backfill. He remains unranked rather than being
-- given a fabricated position. Because he is removed, retained participants
-- hold contiguous public ranks 1-11.
-- ----------------------------------------------------------------
with historical (id, frozen_rank, rank_frozen_at) as (
  values
    ('41341f2f-68b2-4236-9473-3a583a570297'::uuid,  1, '2026-11-04 17:58:16.995195+00'::timestamptz),
    ('41dba7fd-af59-45d9-b53e-ccd9289cbb13'::uuid,  2, '2026-11-04 17:58:16.995195+00'::timestamptz),
    ('97bb1688-0d63-40de-b99c-928c345c3fc1'::uuid,  3, '2026-11-04 17:58:16.995195+00'::timestamptz),
    ('b387b164-f10e-473f-8a81-dff3ea824757'::uuid,  4, '2026-11-04 17:58:16.995195+00'::timestamptz),
    ('cb2a8c7d-bb9e-4a71-ba47-a560ef9f3b6d'::uuid,  5, '2026-11-04 17:58:16.995195+00'::timestamptz),
    ('f0fc08fc-8975-420b-84c3-0101a759688e'::uuid,  6, '2026-11-04 17:58:16.995195+00'::timestamptz),
    ('e38a50d0-3232-461e-924f-df2ccc997d53'::uuid,  7, '2026-11-05 08:45:29.446274+00'::timestamptz),
    ('99bcac48-d643-49d3-8eed-3d7adae6dc0e'::uuid,  8, '2026-11-06 11:21:55.345770+00'::timestamptz),
    ('69409dd8-f933-454f-b1e7-b519d3c29156'::uuid,  9, '2026-11-06 11:21:55.345770+00'::timestamptz),
    ('f9b8c9b7-04fa-41ec-864e-155c75cc78c3'::uuid, 10, '2026-11-06 11:21:55.345770+00'::timestamptz),
    ('b9aa17e1-0bff-4987-b2b5-cef9a037fc27'::uuid, 11, '2026-11-06 11:21:55.345770+00'::timestamptz)
)
update public.participants as p
set frozen_rank = historical.frozen_rank,
    rank_frozen_at = historical.rank_frozen_at
from historical
where p.id = historical.id
  and p.registration_status = 'registered'
  and p.skill_badge_count >= 10
  and p.frozen_rank is null
  and not exists (
    select 1 from public.participants as existing
    where existing.frozen_rank = historical.frozen_rank
  );

-- Allocate any remaining registered 10+ participant (for example a fresh
-- environment with no audit history) after the verified positions above.
select private.allocate_frozen_ranks();

-- ----------------------------------------------------------------
-- 6. Replace the public summary: drop five_badge_count, expose frozen ranks
-- ----------------------------------------------------------------
create or replace function public.get_public_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registered_count',         count(*)::integer,
    'total_verified_badges',    coalesce(sum(participants.verified_badge_count), 0)::integer,
    'total_skill_badges',       coalesce(sum(participants.skill_badge_count), 0)::integer,
    'total_arcade_badges',      coalesce(sum(participants.arcade_game_badge_count), 0)::integer,
    'frozen_rank_count',        count(*) filter (where participants.frozen_rank is not null)::integer,
    'ten_badge_count',          count(*) filter (where participants.skill_badge_count >= 10)::integer,
    'last_updated_at',          coalesce(max(participants.updated_at), now())
  )
  from public.participants
  where participants.registration_status = 'registered';
$$;
revoke all on function public.get_public_summary() from public;
grant execute on function public.get_public_summary() to anon, authenticated;

-- ----------------------------------------------------------------
-- 7. Bulk classified import: write all Skill/Arcade counts in one statement
--    so simultaneous threshold crossings are allocated in one deterministic
--    pass instead of in UUID lock order.
-- ----------------------------------------------------------------
create or replace function public.admin_bulk_set_classified_badge_counts(p_rows jsonb)
returns table(
  row_number          integer,
  participant_id      uuid,
  previous_total      integer,
  new_total           integer,
  new_skill_count     integer,
  new_arcade_count    integer,
  verified_at         timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_item       jsonb;
  v_id         uuid;
  v_row_number integer;
  v_skill      integer;
  v_arcade     integer;
  v_total      integer;
  v_note       text;
  v_audit_note text;
  v_expected_total      integer;
  v_expected_verified_at timestamptz;
  v_expected_source      text;
  v_current_total        integer;
  v_current_skill        integer;
  v_current_arcade       integer;
  v_current_verified_at  timestamptz;
  v_current_source       text;
  v_prev_total   integer;
  v_new_total    integer;
  v_verified_at  timestamptz;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Classified bulk import must contain 1 to 500 rows';
  end if;

  -- Validate every row before the first write.
  for v_item in select value from jsonb_array_elements(p_rows) as items(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or not (v_item ?& array[
        'row_number', 'participant_id', 'skill_count', 'arcade_count',
        'total_count', 'review_note',
        'expected_total_count', 'expected_last_verified_at', 'expected_verification_source'
      ])
      or (v_item - array[
        'row_number', 'participant_id', 'skill_count', 'arcade_count',
        'total_count', 'review_note',
        'expected_total_count', 'expected_last_verified_at', 'expected_verification_source'
      ]) <> '{}'::jsonb
      or coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'row_number', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_item ->> 'skill_count', '')  !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'arcade_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'total_count', '')  !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'expected_total_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or jsonb_typeof(v_item -> 'review_note') is distinct from 'string'
      or jsonb_typeof(v_item -> 'expected_last_verified_at') not in ('null', 'string')
      or jsonb_typeof(v_item -> 'expected_verification_source') not in ('null', 'string') then
      raise exception using errcode = '22023', message = 'Classified bulk import row is malformed';
    end if;
    if (v_item ->> 'row_number')::integer < 2
      or (v_item ->> 'row_number')::integer > 501
      or (v_item ->> 'skill_count')::integer  > 10000
      or (v_item ->> 'arcade_count')::integer > 10000
      or (v_item ->> 'total_count')::integer  > 10000
      or (v_item ->> 'expected_total_count')::integer > 10000
      or length(btrim(v_item ->> 'review_note')) not between 1 and 1000 then
      raise exception using errcode = '22023', message = 'Classified bulk import row is outside allowed limits';
    end if;
    -- Sum invariant: skill + arcade must equal total.
    if (v_item ->> 'skill_count')::integer + (v_item ->> 'arcade_count')::integer
       <> (v_item ->> 'total_count')::integer then
      raise exception using errcode = '22023',
        message = 'skill_count + arcade_count must equal total_count for every row';
    end if;
  end loop;

  -- Duplicate participant guard.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as items(value)
    group by (value ->> 'participant_id')::uuid
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Classified bulk import contains duplicate participants';
  end if;

  -- Stable lock ordering (UUID ascending) to avoid deadlocks.
  for v_item in
    select value from jsonb_array_elements(p_rows) as items(value)
    order by (value ->> 'participant_id')::uuid
  loop
    v_id         := (v_item ->> 'participant_id')::uuid;
    v_row_number := (v_item ->> 'row_number')::integer;
    v_skill      := (v_item ->> 'skill_count')::integer;
    v_arcade     := (v_item ->> 'arcade_count')::integer;
    v_total      := (v_item ->> 'total_count')::integer;
    v_note       := btrim(v_item ->> 'review_note');
    v_expected_total      := (v_item ->> 'expected_total_count')::integer;
    v_expected_verified_at := nullif(v_item ->> 'expected_last_verified_at', '')::timestamptz;
    v_expected_source      := nullif(v_item ->> 'expected_verification_source', '');

    select p.verified_badge_count, p.skill_badge_count, p.arcade_game_badge_count,
           p.last_verified_at, p.verification_source
      into v_current_total, v_current_skill, v_current_arcade,
           v_current_verified_at, v_current_source
    from public.participants p
    where p.id = v_id
    for update;
    if not found then
      raise exception using errcode = 'P0002',
        message = 'A participant is no longer available; preview the CSV again';
    end if;

    -- Allow idempotent retry if the total already matches the requested value.
    if (v_current_total is distinct from v_expected_total
        or v_current_verified_at is distinct from v_expected_verified_at
        or v_current_source is distinct from v_expected_source)
      and v_current_total is distinct from v_total then
      raise exception using errcode = '40001',
        message = 'Participant verification changed after preview; preview the CSV again';
    end if;

    -- Embed deterministic rollback metadata in the audit note so that previous
    -- classification and timestamps are never lost upon subsequent review or rollback.
    v_audit_note := substring(
      v_note || ' [rollback_state:' || jsonb_build_object(
        'prev_total', v_current_total,
        'prev_skill', v_current_skill,
        'prev_arcade', v_current_arcade,
        'prev_verified_at', v_current_verified_at,
        'prev_source', v_current_source
      )::text || ']',
      1, 1000
    );

    -- Delegate total update + audit to the existing single-row RPC.
    select result.previous_badge_count, result.new_badge_count, result.verified_at
      into v_prev_total, v_new_total, v_verified_at
    from public.admin_set_verified_badge_count(v_id, v_total, v_audit_note) as result;

    return query select
      v_row_number, v_id,
      v_prev_total, v_new_total,
      v_skill, v_arcade, v_verified_at;
  end loop;

  -- Apply every classification in one statement. The statement-level
  -- participants_capture_frozen_ranks trigger then allocates all simultaneous
  -- threshold crossings in one deterministic Skill/Arcade/Total/UUID pass.
  update public.participants p
  set skill_badge_count      = (item.value ->> 'skill_count')::integer,
      arcade_game_badge_count = (item.value ->> 'arcade_count')::integer
  from jsonb_array_elements(p_rows) as item(value)
  where p.id = (item.value ->> 'participant_id')::uuid;
end;
$$;

revoke all on function public.admin_bulk_set_classified_badge_counts(jsonb) from public, anon;
grant execute on function public.admin_bulk_set_classified_badge_counts(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 8. Rollback: restore classification in one statement as well, so any
--    participant who returns to 10+ Skill Badges is frozen deterministically.
--    Existing frozen ranks are deliberately never cleared.
-- ----------------------------------------------------------------
create or replace function public.admin_bulk_rollback_classified_badge_counts(p_rows jsonb)
returns table(
  participant_id     uuid,
  restored_total     integer,
  restored_skill     integer,
  restored_arcade    integer,
  restored_at        timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_item       jsonb;
  v_id         uuid;
  v_target_total   integer;
  v_target_skill   integer;
  v_target_arcade  integer;
  v_target_verified_at timestamptz;
  v_target_source  text;
  v_note           text;
  v_prev_total     integer;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Rollback batch must contain 1 to 500 rows';
  end if;

  -- Validate rows before execution
  for v_item in select value from jsonb_array_elements(p_rows) as items(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'target_total', '') !~ '^(0|[1-9][0-9]{0,4})$' then
      raise exception using errcode = '22023', message = 'Rollback row is malformed';
    end if;
  end loop;

  -- Stable lock ordering
  for v_item in
    select value from jsonb_array_elements(p_rows) as items(value)
    order by (value ->> 'participant_id')::uuid
  loop
    v_id := (v_item ->> 'participant_id')::uuid;
    v_target_total   := (v_item ->> 'target_total')::integer;
    v_target_skill   := nullif(v_item ->> 'target_skill', '')::integer;
    v_target_arcade  := nullif(v_item ->> 'target_arcade', '')::integer;
    v_target_verified_at := nullif(v_item ->> 'target_verified_at', '')::timestamptz;
    v_target_source  := nullif(v_item ->> 'target_source', '');
    v_note           := coalesce(btrim(v_item ->> 'rollback_note'), 'Audited rollback of classified badge import');

    select p.verified_badge_count into v_prev_total
    from public.participants p
    where p.id = v_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Participant not found';
    end if;

    update public.participants
    set verified_badge_count    = v_target_total,
        last_verified_at        = v_target_verified_at,
        verification_source     = v_target_source
    where id = v_id;

    insert into public.participant_audit_events (
      participant_id, event_type, previous_badge_count, new_badge_count,
      note, source, actor_user_id, verified_at
    ) values (
      v_id, 'badge_count_updated', v_prev_total, v_target_total,
      v_note, 'admin_manual', v_actor, coalesce(v_target_verified_at, now())
    );

    return query select v_id, v_target_total, v_target_skill, v_target_arcade, v_target_verified_at;
  end loop;

  update public.participants p
  set skill_badge_count      = nullif(item.value ->> 'target_skill', '')::integer,
      arcade_game_badge_count = nullif(item.value ->> 'target_arcade', '')::integer
  from jsonb_array_elements(p_rows) as item(value)
  where p.id = (item.value ->> 'participant_id')::uuid;
end;
$$;

revoke all on function public.admin_bulk_rollback_classified_badge_counts(jsonb) from public, anon;
grant execute on function public.admin_bulk_rollback_classified_badge_counts(jsonb) to authenticated;
