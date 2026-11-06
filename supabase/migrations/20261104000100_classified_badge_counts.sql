-- Phase 6C: Add skill_badge_count and arcade_game_badge_count to participants table.
--
-- Strategy:
--   1. Add two nullable integer columns with [0, 10000] check constraints.
--   2. verified_badge_count REMAINS the canonical total (Skill + Arcade) and
--      is what all existing RPCs, audit rows, and leaderboard queries already use.
--   3. skill_badge_count drives the PRIMARY leaderboard rank (new).
--   4. arcade_game_badge_count is stored for display only.
--   5. skill_badge_count + arcade_game_badge_count = verified_badge_count is an
--      application-layer invariant enforced in admin_bulk_set_classified_badge_counts
--      before any write; the DB itself does not duplicate the constraint to avoid
--      a sum-check that would need to be relaxed for partial updates.
--   6. Both columns are null until a classified import is applied. null means
--      "classification not yet stored", not zero.
--   7. The public anon grant is extended to expose the two new columns.
--   8. The existing rank index is rebuilt to order by skill_badge_count DESC
--      (nulls last) then verified_badge_count DESC then id ASC.
--   9. get_public_summary now also returns classified Skill and Arcade totals.
--  10. This migration is fully additive; existing data is not modified.

-- ----------------------------------------------------------------
-- 1. New columns
-- ----------------------------------------------------------------
alter table public.participants
  add column if not exists skill_badge_count integer
    check (skill_badge_count between 0 and 10000),
  add column if not exists arcade_game_badge_count integer
    check (arcade_game_badge_count between 0 and 10000);

-- ----------------------------------------------------------------
-- 2. Extend anonymous read grant to include the new columns
-- ----------------------------------------------------------------
grant select (skill_badge_count, arcade_game_badge_count)
  on public.participants to anon;

-- ----------------------------------------------------------------
-- 3. Rebuild rank index to sort by skill_badge_count first
--    NULLS LAST ensures un-classified participants sort after classified ones.
-- ----------------------------------------------------------------
drop index if exists public.participants_public_rank_idx;
create index participants_public_rank_idx
  on public.participants (
    skill_badge_count desc nulls last,
    verified_badge_count desc,
    id asc
  )
  where registration_status = 'registered';

-- ----------------------------------------------------------------
-- 4. Replace get_public_summary to include classified badge totals
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
    'ten_badge_count',          count(*) filter (where participants.skill_badge_count >= 10)::integer,
    'last_updated_at',          coalesce(max(participants.updated_at), now())
  )
  from public.participants
  where participants.registration_status = 'registered';
$$;
revoke all on function public.get_public_summary() from public;
grant execute on function public.get_public_summary() to anon, authenticated;

-- ----------------------------------------------------------------
-- 5. New bulk RPC: admin_bulk_set_classified_badge_counts
--    Accepts rows with skill_count + arcade_count + total_count.
--    Validates sum invariant before any write.
--    Delegates each row to the existing admin_set_verified_badge_count
--    for the total (preserving all audit history), then sets the two
--    classification columns directly in the same transaction.
--    Admin-only, security definer, stable-UUID lock ordering.
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

    -- Write the two classification columns in the same transaction.
    update public.participants
      set skill_badge_count      = v_skill,
          arcade_game_badge_count = v_arcade
      where id = v_id;

    return query select
      v_row_number, v_id,
      v_prev_total, v_new_total,
      v_skill, v_arcade, v_verified_at;
  end loop;
end;
$$;

revoke all on function public.admin_bulk_set_classified_badge_counts(jsonb) from public, anon;
grant execute on function public.admin_bulk_set_classified_badge_counts(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 6. Dedicated rollback RPC: admin_bulk_rollback_classified_badge_counts
--    Safely restores previous verified_badge_count, skill_badge_count,
--    arcade_game_badge_count, last_verified_at, and verification_source
--    from recorded rollback snapshots in one atomic, audited transaction.
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
        skill_badge_count       = v_target_skill,
        arcade_game_badge_count = v_target_arcade,
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
end;
$$;

revoke all on function public.admin_bulk_rollback_classified_badge_counts(jsonb) from public, anon;
grant execute on function public.admin_bulk_rollback_classified_badge_counts(jsonb) to authenticated;

