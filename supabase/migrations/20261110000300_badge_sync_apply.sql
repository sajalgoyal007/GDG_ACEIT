-- Badge sync apply: persistent run identity, idempotent apply and rollback.
--
-- Apply rules:
--   1. Only an `approved` run with a matching preview fingerprint may apply.
--   2. The run row is locked `for update`; a concurrent apply waits, then sees
--      `applied` and returns the stored result without touching participants.
--   3. The live participant state is re-read and the fingerprint recomputed
--      inside the same transaction. Any change since approval is rejected as
--      stale (SQLSTATE 40001) before a single count is written.
--   4. Every approved count is written through
--      public.admin_bulk_set_classified_badge_counts. No second write path.
--   5. An identical re-apply (skill, arcade and total already match) appends no
--      audit event. This is what makes the 2026-11-09 double Preview -> Apply
--      cycle safe even when a second, independently-created run is submitted.
--
-- Rollback rules:
--   1. Only an `applied` run may be rolled back, exactly once.
--   2. Restores the snapshot captured in staging through
--      public.admin_bulk_rollback_classified_badge_counts.
--   3. The live participant is locked and must still equal the post-apply
--      snapshot recorded by apply. A changed total, split, timestamp or source
--      is rejected with SQLSTATE 40001 before any row is written.
--   4. A later applied run that changed the same participant blocks rollback,
--      even when the later run produced an identical value.
--   5. Removed participants are rejected server-side.
--   6. Frozen ranks are never cleared (the rollback RPC does not touch them).
--
-- Authorization: this system intentionally uses a shared-admin operations
-- policy. Any current admin may preview, approve, apply or roll back any run.
-- `created_by`, `approved_by`, `applied_by` and `rolled_back_by` are retained
-- for accountability, not as an ownership restriction. Every RPC still checks
-- private.is_admin() and a non-null auth.uid() server-side.

-- ------------------------------------------------------------------
-- Idempotent classified-count bulk write.
--
-- This REPLACES the 20261105000100 body of the same function name. The
-- signature and the nine legacy payload keys are unchanged for manual CSV
-- callers. Two optional keys, `expected_skill_count` and
-- `expected_arcade_count`, let the badge-sync apply path reject a same-total
-- split race. When the live classification already equals the requested one,
-- no audit event is appended.
-- ------------------------------------------------------------------
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
  v_expected_skill       integer;
  v_expected_arcade      integer;
  v_has_expected_skill   boolean;
  v_has_expected_arcade  boolean;
  v_already_target       boolean;
  v_current_total        integer;
  v_current_skill        integer;
  v_current_arcade       integer;
  v_current_verified_at  timestamptz;
  v_current_source       text;
  v_current_status       text;
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
        'expected_total_count', 'expected_last_verified_at', 'expected_verification_source',
        'expected_skill_count', 'expected_arcade_count'
      ]) <> '{}'::jsonb
      or coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'row_number', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_item ->> 'skill_count', '')  !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'arcade_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'total_count', '')  !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'expected_total_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or jsonb_typeof(v_item -> 'review_note') is distinct from 'string'
      or jsonb_typeof(v_item -> 'expected_last_verified_at') not in ('null', 'string')
      or jsonb_typeof(v_item -> 'expected_verification_source') not in ('null', 'string')
      or (v_item ? 'expected_skill_count'
        and jsonb_typeof(v_item -> 'expected_skill_count') not in ('null', 'string', 'number'))
      or (v_item ? 'expected_arcade_count'
        and jsonb_typeof(v_item -> 'expected_arcade_count') not in ('null', 'string', 'number'))
      or (jsonb_typeof(v_item -> 'expected_skill_count') in ('string', 'number')
        and (v_item ->> 'expected_skill_count') !~ '^(0|[1-9][0-9]{0,4})$')
      or (jsonb_typeof(v_item -> 'expected_arcade_count') in ('string', 'number')
        and (v_item ->> 'expected_arcade_count') !~ '^(0|[1-9][0-9]{0,4})$') then
      raise exception using errcode = '22023', message = 'Classified bulk import row is malformed';
    end if;
    if (v_item ->> 'row_number')::integer < 2
      or (v_item ->> 'row_number')::integer > 501
      or (v_item ->> 'skill_count')::integer  > 10000
      or (v_item ->> 'arcade_count')::integer > 10000
      or (v_item ->> 'total_count')::integer  > 10000
      or (v_item ->> 'expected_total_count')::integer > 10000
      or (jsonb_typeof(v_item -> 'expected_skill_count') in ('string', 'number')
        and (v_item ->> 'expected_skill_count')::integer > 10000)
      or (jsonb_typeof(v_item -> 'expected_arcade_count') in ('string', 'number')
        and (v_item ->> 'expected_arcade_count')::integer > 10000)
      or length(btrim(v_item ->> 'review_note')) not between 1 and 1000 then
      raise exception using errcode = '22023', message = 'Classified bulk import row is outside allowed limits';
    end if;
    if (v_item ->> 'review_note') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'Review note must be 1 to 1000 printable characters';
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
    v_has_expected_skill   := v_item ? 'expected_skill_count';
    v_has_expected_arcade  := v_item ? 'expected_arcade_count';
    v_expected_skill       := case when v_has_expected_skill
      then nullif(v_item ->> 'expected_skill_count', '')::integer end;
    v_expected_arcade      := case when v_has_expected_arcade
      then nullif(v_item ->> 'expected_arcade_count', '')::integer end;

    select p.verified_badge_count, p.skill_badge_count, p.arcade_game_badge_count,
           p.last_verified_at, p.verification_source, p.registration_status
      into v_current_total, v_current_skill, v_current_arcade,
           v_current_verified_at, v_current_source, v_current_status
    from public.participants p
    where p.id = v_id
    for update;
    if not found then
      raise exception using errcode = 'P0002',
        message = 'A participant is no longer available; preview the CSV again';
    end if;
    -- Removed participants must be rejected server-side even if a stale client
    -- preview still lists them.
    if v_current_status = 'removed' then
      raise exception using errcode = '22023',
        message = 'Removed participants cannot receive badge counts';
    end if;

    v_already_target := v_current_total = v_total
      and v_current_skill is not distinct from v_skill
      and v_current_arcade is not distinct from v_arcade;

    -- Reject any state that no longer matches the approved preview. Expected
    -- total/timestamp/source guard the whole row. Expected Skill/Arcade guard a
    -- same-total split race and are enforced even when the live row already
    -- equals the target: an approved split that no longer matches the live
    -- split is stale, not an idempotent replay. The total/timestamp/source
    -- shortcut only relaxes genuine no-op retries.
    if (v_has_expected_skill and v_current_skill is distinct from v_expected_skill)
      or (v_has_expected_arcade and v_current_arcade is distinct from v_expected_arcade)
      or (not v_already_target
        and (v_current_total is distinct from v_expected_total
          or v_current_verified_at is distinct from v_expected_verified_at
          or v_current_source is distinct from v_expected_source)) then
      raise exception using errcode = '40001',
        message = 'Participant verification changed after preview; preview the CSV again';
    end if;

    -- No-op re-apply: the stored classification already matches exactly.
    -- Return the stored result and do not append another audit event.
    if v_already_target then
      v_prev_total := v_current_total;
      v_new_total := v_current_total;
      v_verified_at := coalesce(v_current_verified_at, now());
      return query select
        v_row_number, v_id,
        v_prev_total, v_new_total,
        v_skill, v_arcade, v_verified_at;
      continue;
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

-- ------------------------------------------------------------------
-- Durable per-participant operation ledger.
--
-- `participant_audit_events` is an append-only human audit trail and has no
-- request identity. This ledger is the machine idempotency record:
--   * unique (run, participant, operation) makes apply and rollback retries
--     impossible to double-record;
--   * apply and rollback are separate operation types;
--   * a later legitimate run still creates new rows because run_id differs;
--   * manual CSV calls that bypass the run wrapper are unaffected.
-- ------------------------------------------------------------------
create table public.badge_sync_operation_ledger (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.badge_sync_runs(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  operation_type text not null,
  request_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  previous_total integer,
  previous_skill integer,
  previous_arcade integer,
  previous_verified_at timestamptz,
  previous_source text,
  new_total integer,
  new_skill integer,
  new_arcade integer,
  new_verified_at timestamptz,
  new_source text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, participant_id, operation_type),
  constraint badge_sync_operation_type_check check (operation_type in ('apply', 'rollback'))
);
create index badge_sync_operation_ledger_participant_idx
  on public.badge_sync_operation_ledger (participant_id, operation_type, created_at desc);
create index badge_sync_operation_ledger_run_idx
  on public.badge_sync_operation_ledger (run_id, operation_type);

alter table public.badge_sync_operation_ledger enable row level security;
revoke all on table public.badge_sync_operation_ledger from anon, authenticated;
grant select on table public.badge_sync_operation_ledger to authenticated;
create policy badge_sync_operation_ledger_admin_read
  on public.badge_sync_operation_ledger for select to authenticated
  using ((select private.is_admin()));

-- Request ids are single-use across all runs.
create unique index badge_sync_runs_apply_request_idx
  on public.badge_sync_runs (apply_request_id)
  where apply_request_id is not null;
create unique index badge_sync_runs_rollback_request_idx
  on public.badge_sync_runs (rollback_request_id)
  where rollback_request_id is not null;

-- ------------------------------------------------------------------
-- Apply an approved run.
-- ------------------------------------------------------------------
create or replace function public.admin_apply_badge_sync_run(
  p_run_id uuid,
  p_fingerprint text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_current_fingerprint text;
  v_rows jsonb;
  v_applied jsonb;
  v_blocked integer;
  v_blocked_rows jsonb;
  v_result jsonb;
  v_now_text text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Apply request id is required';
  end if;

  select runs.* into v_run
  from public.badge_sync_runs as runs
  where runs.id = p_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  -- Idempotent replay: never call the count RPC twice for one run.
  if v_run.status = 'applied' then
    return coalesce(
      v_run.apply_result,
      jsonb_build_object('run_id', v_run.id, 'status', 'applied')
    );
  end if;

  -- A request id belongs to exactly one operation across all runs. Reusing
  -- another run's request id is a clean domain conflict, not a raw 23505.
  if exists (
    select 1
    from public.badge_sync_runs as other
    where other.apply_request_id = p_request_id
      and other.id <> p_run_id
  ) then
    raise exception using errcode = '22023',
      message = 'This apply request id was already used by another badge sync run';
  end if;

  if v_run.status = 'rolled_back' then
    raise exception using errcode = '22023', message = 'This run has already been rolled back';
  end if;
  if v_run.status = 'applying' then
    raise exception using errcode = '40001', message = 'This run is already being applied';
  end if;
  if v_run.status <> 'approved' then
    raise exception using errcode = '22023', message = 'Only an approved run can be applied';
  end if;
  if coalesce(p_fingerprint, '') !~ '^[0-9a-f]{32}$'
    or v_run.preview_fingerprint is distinct from p_fingerprint then
    raise exception using errcode = '40001', message = 'The preview fingerprint is stale; preview and approve again';
  end if;

  -- Re-read live state. Any participant change since approval changes the
  -- fingerprint and aborts the whole transaction before a count is written.
  perform private.badge_sync_recompute(p_run_id);
  v_current_fingerprint := private.badge_sync_fingerprint(p_run_id);
  if v_current_fingerprint is distinct from p_fingerprint then
    raise exception using errcode = '40001', message = 'The badge sync preview changed; preview and approve again';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row_number', staging.row_number,
    'participant_id', staging.participant_id,
    'skill_count', staging.skill_count,
    'arcade_count', staging.arcade_count,
    'total_count', staging.total_count,
    'review_note', coalesce(staging.review_note, 'Badge sync run ' || p_run_id::text),
    'expected_total_count', staging.previous_verified_total,
    'expected_last_verified_at', case when staging.previous_last_verified_at is null then null
      else to_char(staging.previous_last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'expected_verification_source', staging.previous_verification_source,
    'expected_skill_count', staging.previous_skill_count,
    'expected_arcade_count', staging.previous_arcade_count
  ) order by staging.participant_id), '[]'::jsonb)
  into v_rows
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id
    and staging.status = 'approved'
    and staging.observation_status = 'complete'
    and not staging.is_removed
    and staging.skill_count is not null
    and staging.arcade_count is not null
    and staging.total_count is not null;

  if jsonb_array_length(v_rows) < 1 then
    raise exception using errcode = '22023',
      message = 'No approved participants are ready to apply; resolve blocked participants first';
  end if;

  begin
    update public.badge_sync_runs as runs
    set status = 'applying',
        applying_started_at = now(),
        apply_request_id = p_request_id
    where runs.id = p_run_id;
  exception when unique_violation then
    raise exception using errcode = '22023',
      message = 'This apply request id was already used by another badge sync run';
  end;

  select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
      'row_number', applied.row_number,
      'participant_id', applied.participant_id,
      'previous_total', applied.previous_total,
      'new_total', applied.new_total,
      'new_skill_count', applied.new_skill_count,
      'new_arcade_count', applied.new_arcade_count,
      'verified_at', to_char(applied.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by applied.row_number), '[]'::jsonb))
  into v_applied
  from public.admin_bulk_set_classified_badge_counts(v_rows) as applied;

  -- Record the exact post-apply state for every written participant. Rollback
  -- compares live state against this snapshot before restoring previous_*.
  update public.badge_sync_participant_staging as staging
  set applied_total = participant.verified_badge_count,
      applied_skill = participant.skill_badge_count,
      applied_arcade = participant.arcade_game_badge_count,
      applied_verified_at = participant.last_verified_at,
      applied_source = participant.verification_source,
      applied_at = now(),
      applied_by = v_actor
  from public.participants as participant
  where staging.run_id = p_run_id
    and staging.participant_id = participant.id
    and staging.status = 'approved'
    and staging.observation_status = 'complete'
    and not staging.is_removed
    and staging.skill_count is not null
    and staging.arcade_count is not null
    and staging.total_count is not null;

  -- Durable idempotency record. A retry of this run replays apply_result and
  -- never reaches this insert; the unique key is the second line of defence.
  insert into public.badge_sync_operation_ledger (
    run_id, participant_id, operation_type, request_id, actor_user_id,
    previous_total, previous_skill, previous_arcade, previous_verified_at, previous_source,
    new_total, new_skill, new_arcade, new_verified_at, new_source, result
  )
  select
    p_run_id, staging.participant_id, 'apply', p_request_id, v_actor,
    staging.previous_verified_total, staging.previous_skill_count,
    staging.previous_arcade_count, staging.previous_last_verified_at,
    staging.previous_verification_source,
    staging.applied_total, staging.applied_skill, staging.applied_arcade,
    staging.applied_verified_at, staging.applied_source,
    jsonb_build_object(
      'row_number', staging.row_number,
      'previous_total', staging.previous_verified_total,
      'new_total', staging.applied_total,
      'new_skill_count', staging.applied_skill,
      'new_arcade_count', staging.applied_arcade
    )
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id
    and staging.status = 'approved'
    and staging.observation_status = 'complete'
    and not staging.is_removed
    and staging.skill_count is not null
    and staging.arcade_count is not null
    and staging.total_count is not null
  on conflict (run_id, participant_id, operation_type) do nothing;

  select count(*)::integer into v_blocked
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id
    and not (staging.status = 'approved'
      and staging.observation_status = 'complete'
      and not staging.is_removed
      and staging.skill_count is not null
      and staging.arcade_count is not null
      and staging.total_count is not null);

  -- Blocked rows are returned so the admin UI can explain why a participant was
  -- skipped without trusting any client-side preview state.
  select coalesce(jsonb_agg(jsonb_build_object(
      'participant_id', staging.participant_id,
      'row_number', staging.row_number,
      'status', staging.status,
      'blocking_reason', staging.blocking_reason
    ) order by staging.row_number), '[]'::jsonb)
  into v_blocked_rows
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id
    and not (staging.status = 'approved'
      and staging.observation_status = 'complete'
      and not staging.is_removed
      and staging.skill_count is not null
      and staging.arcade_count is not null
      and staging.total_count is not null);

  v_now_text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_result := v_applied || jsonb_build_object(
    'run_id', p_run_id,
    'request_id', p_request_id,
    'status', 'applied',
    'applied_count', jsonb_array_length(v_rows),
    'blocked', v_blocked_rows,
    'blocked_count', v_blocked,
    'applied_at', v_now_text
  );

  update public.badge_sync_runs as runs
  set status = 'applied',
      -- now() is transaction-scoped, so two applies inside one transaction
      -- would share a timestamp and the later-run rollback guard could not
      -- order them. clock_timestamp() preserves real operation order.
      applied_at = pg_catalog.clock_timestamp(),
      applied_by = v_actor,
      apply_result = v_result
  where runs.id = p_run_id;

  return v_result;
end;
$$;
revoke all on function public.admin_apply_badge_sync_run(uuid, text, uuid) from public, anon;
grant execute on function public.admin_apply_badge_sync_run(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------------
-- Roll back an applied run exactly once.
-- ------------------------------------------------------------------
create or replace function public.admin_rollback_badge_sync_run(
  p_run_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_rows jsonb;
  v_restored jsonb;
  v_result jsonb;
  v_now_text text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Rollback request id is required';
  end if;

  select runs.* into v_run
  from public.badge_sync_runs as runs
  where runs.id = p_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  if v_run.status = 'rolled_back' then
    return coalesce(
      v_run.rollback_result,
      jsonb_build_object('run_id', v_run.id, 'status', 'rolled_back')
    );
  end if;
  if v_run.status <> 'applied' then
    raise exception using errcode = '22023', message = 'Only an applied run can be rolled back';
  end if;

  if exists (
    select 1
    from public.badge_sync_runs as other
    where other.rollback_request_id = p_request_id
      and other.id <> p_run_id
  ) then
    raise exception using errcode = '22023',
      message = 'This rollback request id was already used by another badge sync run';
  end if;

  -- A later applied run that touched the same participant makes this rollback
  -- unsafe even if the later value happens to equal this run's value. The run
  -- row lock above does not order runs, so this check is mandatory.
  if exists (
    select 1
    from public.badge_sync_operation_ledger as later
    join public.badge_sync_runs as later_run on later_run.id = later.run_id
    join public.badge_sync_participant_staging as staging
      on staging.run_id = p_run_id
      and staging.participant_id = later.participant_id
    where later.operation_type = 'apply'
      and later.run_id <> p_run_id
      and later_run.status <> 'rolled_back'
      and later_run.applied_at > v_run.applied_at
      and staging.status = 'approved'
      and staging.observation_status = 'complete'
      and not staging.is_removed
  ) then
    raise exception using errcode = '40001',
      message = 'A later applied badge sync run changed these participants; rollback is blocked';
  end if;

  -- Every applied row must have a recorded post-apply snapshot. A run without
  -- one cannot prove current state and must be rolled back manually.
  if exists (
    select 1
    from public.badge_sync_participant_staging as staging
    where staging.run_id = p_run_id
      and staging.status = 'approved'
      and staging.observation_status = 'complete'
      and not staging.is_removed
      and staging.applied_total is null
  ) then
    raise exception using errcode = '40001',
      message = 'This run has no recorded post-apply state; rollback is blocked';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'participant_id', staging.participant_id,
    'target_total', staging.previous_verified_total,
    'target_skill', staging.previous_skill_count,
    'target_arcade', staging.previous_arcade_count,
    'target_verified_at', case when staging.previous_last_verified_at is null then null
      else to_char(staging.previous_last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'target_source', staging.previous_verification_source,
    'rollback_note', 'Audited rollback of badge sync run ' || p_run_id::text,
    'expected_total', staging.applied_total,
    'expected_skill', staging.applied_skill,
    'expected_arcade', staging.applied_arcade,
    'expected_verified_at', case when staging.applied_verified_at is null then null
      else to_char(staging.applied_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'expected_source', staging.applied_source
  ) order by staging.participant_id), '[]'::jsonb)
  into v_rows
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id
    and staging.status = 'approved'
    and staging.observation_status = 'complete'
    and not staging.is_removed
    and staging.skill_count is not null
    and staging.arcade_count is not null
    and staging.total_count is not null;

  if jsonb_array_length(v_rows) < 1 then
    raise exception using errcode = '22023', message = 'This run has no applied participants to roll back';
  end if;

  select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
      'participant_id', restored.participant_id,
      'restored_total', restored.restored_total,
      'restored_skill', restored.restored_skill,
      'restored_arcade', restored.restored_arcade,
      'restored_at', to_char(restored.restored_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by restored.participant_id), '[]'::jsonb))
  into v_restored
  from public.admin_bulk_rollback_classified_badge_counts(v_rows) as restored;

  -- Durable idempotency record for the rollback operation. Apply and rollback
  -- have separate operation types, so a run always carries one of each.
  insert into public.badge_sync_operation_ledger (
    run_id, participant_id, operation_type, request_id, actor_user_id,
    previous_total, previous_skill, previous_arcade, previous_verified_at, previous_source,
    new_total, new_skill, new_arcade, new_verified_at, new_source, result
  )
  select
    p_run_id, staging.participant_id, 'rollback', p_request_id, v_actor,
    staging.applied_total, staging.applied_skill, staging.applied_arcade,
    staging.applied_verified_at, staging.applied_source,
    staging.previous_verified_total, staging.previous_skill_count,
    staging.previous_arcade_count, staging.previous_last_verified_at,
    staging.previous_verification_source,
    jsonb_build_object(
      'row_number', staging.row_number,
      'previous_total', staging.applied_total,
      'new_total', staging.previous_verified_total,
      'new_skill_count', staging.previous_skill_count,
      'new_arcade_count', staging.previous_arcade_count
    )
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id
    and staging.status = 'approved'
    and staging.observation_status = 'complete'
    and not staging.is_removed
    and staging.skill_count is not null
    and staging.arcade_count is not null
    and staging.total_count is not null
  on conflict (run_id, participant_id, operation_type) do nothing;

  v_now_text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_result := v_restored || jsonb_build_object(
    'run_id', p_run_id,
    'request_id', p_request_id,
    'status', 'rolled_back',
    'restored_count', jsonb_array_length(v_rows),
    'rolled_back_at', v_now_text
  );

  begin
    update public.badge_sync_runs as runs
    set status = 'rolled_back',
        rolled_back_at = now(),
        rolled_back_by = v_actor,
        rollback_request_id = p_request_id,
        rollback_result = v_result
    where runs.id = p_run_id;
  exception when unique_violation then
    raise exception using errcode = '22023',
      message = 'This rollback request id was already used by another badge sync run';
  end;

  return v_result;
end;
$$;
revoke all on function public.admin_rollback_badge_sync_run(uuid, uuid) from public, anon;
grant execute on function public.admin_rollback_badge_sync_run(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------
-- Current-state-aware classified-count rollback.
--
-- This REPLACES the 20261105000100 body of the same function name. The
-- legacy payload (participant_id, target_total, target_skill, target_arcade,
-- target_verified_at, target_source, rollback_note) still works unchanged so
-- manual CSV callers keep functioning.
--
-- When the five `expected_*` keys are supplied (the badge sync wrapper always
-- supplies them), the live participant is locked and must still equal the
-- post-apply snapshot before anything is restored. A changed total, split,
-- timestamp or source is rejected with SQLSTATE 40001 and the whole batch
-- aborts atomically. Removed participants are rejected. A participant already
-- at the target state is returned without a new audit event, which makes a
-- retry idempotent. Frozen ranks are never cleared.
-- ------------------------------------------------------------------
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
  v_expected_total   integer;
  v_expected_skill   integer;
  v_expected_arcade  integer;
  v_expected_verified_at timestamptz;
  v_expected_source  text;
  v_has_expected     boolean;
  v_current_total    integer;
  v_current_skill    integer;
  v_current_arcade   integer;
  v_current_verified_at timestamptz;
  v_current_source   text;
  v_current_status   text;
  v_already_target   boolean;
  v_prev_total       integer;
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

  -- Validate every row before the first write.
  for v_item in select value from jsonb_array_elements(p_rows) as items(value)
  loop
    v_has_expected := v_item ? 'expected_total';

    if jsonb_typeof(v_item) is distinct from 'object'
      or not (v_item ?& array['participant_id', 'target_total'])
      or (v_item - array[
        'participant_id', 'target_total', 'target_skill', 'target_arcade',
        'target_verified_at', 'target_source', 'rollback_note',
        'expected_total', 'expected_skill', 'expected_arcade',
        'expected_verified_at', 'expected_source'
      ]) <> '{}'::jsonb
      or coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'target_total', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or (v_item ? 'target_skill'
        and jsonb_typeof(v_item -> 'target_skill') not in ('null', 'string', 'number'))
      or (jsonb_typeof(v_item -> 'target_skill') in ('string', 'number')
        and (v_item ->> 'target_skill') !~ '^(0|[1-9][0-9]{0,4})$')
      or (v_item ? 'target_arcade'
        and jsonb_typeof(v_item -> 'target_arcade') not in ('null', 'string', 'number'))
      or (jsonb_typeof(v_item -> 'target_arcade') in ('string', 'number')
        and (v_item ->> 'target_arcade') !~ '^(0|[1-9][0-9]{0,4})$')
      or jsonb_typeof(v_item -> 'target_verified_at') not in ('null', 'string')
      or jsonb_typeof(v_item -> 'target_source') not in ('null', 'string')
      or (v_item ? 'rollback_note' and jsonb_typeof(v_item -> 'rollback_note') not in ('null', 'string'))
      or (v_has_expected and not (v_item ?& array[
        'expected_total', 'expected_skill', 'expected_arcade',
        'expected_verified_at', 'expected_source'
      ]))
      or (v_item ? 'expected_total'
        and coalesce(v_item ->> 'expected_total', '') !~ '^(0|[1-9][0-9]{0,4})$')
      or (v_item ? 'expected_skill'
        and jsonb_typeof(v_item -> 'expected_skill') not in ('null', 'string', 'number'))
      or (jsonb_typeof(v_item -> 'expected_skill') in ('string', 'number')
        and (v_item ->> 'expected_skill') !~ '^(0|[1-9][0-9]{0,4})$')
      or (v_item ? 'expected_arcade'
        and jsonb_typeof(v_item -> 'expected_arcade') not in ('null', 'string', 'number'))
      or (jsonb_typeof(v_item -> 'expected_arcade') in ('string', 'number')
        and (v_item ->> 'expected_arcade') !~ '^(0|[1-9][0-9]{0,4})$')
      or jsonb_typeof(v_item -> 'expected_verified_at') not in ('null', 'string')
      or jsonb_typeof(v_item -> 'expected_source') not in ('null', 'string') then
      raise exception using errcode = '22023', message = 'Rollback row is malformed';
    end if;

    if (v_item ->> 'target_total')::integer > 10000
      or (jsonb_typeof(v_item -> 'target_skill') in ('string', 'number')
        and (v_item ->> 'target_skill')::integer > 10000)
      or (jsonb_typeof(v_item -> 'target_arcade') in ('string', 'number')
        and (v_item ->> 'target_arcade')::integer > 10000)
      or (v_item ? 'expected_total' and (v_item ->> 'expected_total')::integer > 10000)
      or (jsonb_typeof(v_item -> 'expected_skill') in ('string', 'number')
        and (v_item ->> 'expected_skill')::integer > 10000)
      or (jsonb_typeof(v_item -> 'expected_arcade') in ('string', 'number')
        and (v_item ->> 'expected_arcade')::integer > 10000)
      or (v_item ? 'rollback_note'
        and length(btrim(coalesce(v_item ->> 'rollback_note', ''))) > 1000) then
      raise exception using errcode = '22023', message = 'Rollback row is outside allowed limits';
    end if;
    if v_item ? 'rollback_note' and (v_item ->> 'rollback_note') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'Rollback note must be printable characters';
    end if;
  end loop;

  -- First pass: lock every participant in stable UUID order and verify current
  -- state. No write happens until the whole batch has passed these checks, so
  -- one stale or removed row aborts the entire rollback atomically.
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
    v_has_expected   := v_item ? 'expected_total';
    v_expected_total := case when v_has_expected then (v_item ->> 'expected_total')::integer end;
    v_expected_skill := case when v_has_expected then nullif(v_item ->> 'expected_skill', '')::integer end;
    v_expected_arcade := case when v_has_expected then nullif(v_item ->> 'expected_arcade', '')::integer end;
    v_expected_verified_at := case when v_has_expected
      then nullif(v_item ->> 'expected_verified_at', '')::timestamptz end;
    v_expected_source := case when v_has_expected then nullif(v_item ->> 'expected_source', '') end;

    if v_target_skill is not null and v_target_arcade is not null
      and v_target_skill + v_target_arcade <> v_target_total then
      raise exception using errcode = '22023',
        message = 'Rollback target_skill + target_arcade must equal target_total';
    end if;

    select p.verified_badge_count, p.skill_badge_count, p.arcade_game_badge_count,
           p.last_verified_at, p.verification_source, p.registration_status
      into v_current_total, v_current_skill, v_current_arcade,
           v_current_verified_at, v_current_source, v_current_status
    from public.participants p
    where p.id = v_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Participant not found';
    end if;
    if v_current_status = 'removed' then
      raise exception using errcode = '22023',
        message = 'Removed participants cannot be rolled back';
    end if;

    v_already_target := v_current_total = v_target_total
      and v_current_skill is not distinct from v_target_skill
      and v_current_arcade is not distinct from v_target_arcade
      and v_current_verified_at is not distinct from v_target_verified_at
      and v_current_source is not distinct from v_target_source;

    if v_has_expected and not v_already_target then
      if v_current_total is distinct from v_expected_total
        or v_current_skill is distinct from v_expected_skill
        or v_current_arcade is distinct from v_expected_arcade
        or v_current_verified_at is distinct from v_expected_verified_at
        or v_current_source is distinct from v_expected_source then
        raise exception using errcode = '40001',
          message = 'Participant changed after apply; rollback is blocked';
      end if;
    end if;
  end loop;

  -- Second pass: write. Rows already at the target are no-op replays and do not
  -- append another audit event.
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

    select p.verified_badge_count, p.skill_badge_count, p.arcade_game_badge_count,
           p.last_verified_at, p.verification_source
      into v_prev_total, v_current_skill, v_current_arcade,
           v_current_verified_at, v_current_source
    from public.participants p
    where p.id = v_id
    for update;

    v_already_target := v_prev_total = v_target_total
      and v_current_skill is not distinct from v_target_skill
      and v_current_arcade is not distinct from v_target_arcade
      and v_current_verified_at is not distinct from v_target_verified_at
      and v_current_source is not distinct from v_target_source;

    if not v_already_target then
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
    end if;

    return query select v_id, v_target_total, v_target_skill, v_target_arcade, v_target_verified_at;
  end loop;

  -- Restore Skill/Arcade in one statement so any participant who returns to
  -- 10+ Skill Badges is frozen deterministically. Existing frozen ranks are
  -- deliberately never cleared.
  update public.participants p
  set skill_badge_count      = nullif(item.value ->> 'target_skill', '')::integer,
      arcade_game_badge_count = nullif(item.value ->> 'target_arcade', '')::integer
  from jsonb_array_elements(p_rows) as item(value)
  where p.id = (item.value ->> 'participant_id')::uuid;
end;
$$;

revoke all on function public.admin_bulk_rollback_classified_badge_counts(jsonb) from public, anon;
grant execute on function public.admin_bulk_rollback_classified_badge_counts(jsonb) to authenticated;
