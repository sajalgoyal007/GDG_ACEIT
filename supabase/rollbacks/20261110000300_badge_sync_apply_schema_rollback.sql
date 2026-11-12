-- Schema rollback for 20261110000300_badge_sync_apply.sql.
--
-- This restores the database functions that migration 3 REPLACED to their exact
-- 20261105000100 bodies and drops every object that migration 3 introduced.
-- It does NOT reverse 20261110000200_badge_sync_staging.sql: the runs, staging
-- table, applied snapshot columns, recompute/fingerprint helpers, preview,
-- staging and approval RPCs intentionally remain. Rolling those back is a
-- separate operation.
--
-- What this file restores/removes:
--   * restores public.admin_bulk_set_classified_badge_counts(jsonb) to the
--     20261105000100 body (nine-key payload only, no expected split guard);
--   * restores public.admin_bulk_rollback_classified_badge_counts(jsonb) to the
--     20261105000100 body (unconditional rollback, no current-state guard);
--   * drops public.admin_apply_badge_sync_run(uuid, text, uuid);
--   * drops public.admin_rollback_badge_sync_run(uuid, uuid);
--   * drops public.badge_sync_operation_ledger (and its indexes/policy);
--   * drops the apply/rollback request-id uniqueness indexes.
--
-- Run only against a database where migration 3 was applied and where no
-- badge-sync apply/rollback is in progress. Existing participant audit history
-- and participant counts are never modified here.

begin;

-- 1. Remove the apply/rollback entry points introduced by migration 3.
drop function if exists public.admin_apply_badge_sync_run(uuid, text, uuid);
drop function if exists public.admin_rollback_badge_sync_run(uuid, uuid);

-- 2. Remove the durable operation ledger and its dependent indexes/policy.
drop table if exists public.badge_sync_operation_ledger;

-- 3. Remove the run-level request-id uniqueness indexes.
drop index if exists public.badge_sync_runs_apply_request_idx;
drop index if exists public.badge_sync_runs_rollback_request_idx;

-- 4. Restore the 20261105000100 bulk classified setter exactly.
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

-- 5. Restore the 20261105000100 bulk rollback function exactly.
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

commit;
