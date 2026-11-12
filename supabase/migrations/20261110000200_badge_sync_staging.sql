-- Badge identity staging, deterministic preview, and run state.
--
-- Lifecycle: draft -> staged -> previewed -> approved -> applying -> applied
-- A failed apply rolls back the whole transaction, so the run remains in its
-- prior state. `rolled_back` is terminal after an audited rollback.
--
-- Counts are never inferred from titles. A badge identity is resolved through
-- public.badge_catalog. Unknown structural identities are inserted as
-- `unclassified` and block their participant from count application until an
-- admin explicitly classifies them.
--
-- Incomplete or failed observations always store NULL counts, never zero.
--
-- Run totals are eligible-only: `total_participants`, `total_skill`,
-- `total_arcade` and `total_badges` count exactly the rows the apply RPC will
-- write (approved, complete, not removed, all three counts present).
-- `blocked_participant_count` counts every staged row that is not eligible.
-- This keeps preview totals and apply totals byte-for-byte identical.

create table public.badge_sync_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'badge_observations',
  status text not null default 'draft',
  source text not null default 'admin_import',
  source_filename text,
  source_sha256 text,
  note text,
  preview_fingerprint text,
  previewed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  applying_started_at timestamptz,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  apply_request_id uuid,
  apply_result jsonb,
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete set null,
  rollback_request_id uuid,
  rollback_result jsonb,
  total_participants integer not null default 0,
  total_skill integer not null default 0,
  total_arcade integer not null default 0,
  total_badges integer not null default 0,
  unclassified_participant_count integer not null default 0,
  pending_participant_count integer not null default 0,
  blocked_participant_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint badge_sync_runs_mode_check check (mode in ('badge_observations', 'classified_counts')),
  constraint badge_sync_runs_status_check check (
    status in ('draft', 'staged', 'previewed', 'approved', 'applying', 'applied', 'rolled_back', 'failed', 'cancelled')
  ),
  constraint badge_sync_runs_source_check check (source in ('admin_import', 'profile_evidence', 'manual')),
  constraint badge_sync_runs_filename_check check (
    source_filename is null or length(btrim(source_filename)) between 1 and 255
  ),
  constraint badge_sync_runs_sha_check check (
    source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint badge_sync_runs_note_check check (
    note is null or length(btrim(note)) between 1 and 1000
  ),
  constraint badge_sync_runs_fingerprint_check check (
    preview_fingerprint is null or preview_fingerprint ~ '^[0-9a-f]{32}$'
  ),
  constraint badge_sync_runs_total_check check (
    total_participants >= 0
    and total_skill >= 0
    and total_arcade >= 0
    and total_badges = total_skill + total_arcade
  ),
  constraint badge_sync_runs_approved_shape check (
    status <> 'approved'
    or (preview_fingerprint is not null and approved_at is not null and approved_by is not null)
  ),
  constraint badge_sync_runs_applied_shape check (
    status <> 'applied'
    or (applied_at is not null and applied_by is not null and apply_result is not null)
  ),
  constraint badge_sync_runs_rolled_back_shape check (
    status <> 'rolled_back'
    or (rolled_back_at is not null and rollback_result is not null)
  )
);

create table public.badge_sync_participant_staging (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.badge_sync_runs(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  participant_key text not null,
  display_name text not null,
  registration_status text not null,
  is_removed boolean not null default false,
  observation_status text not null default 'complete',
  status text not null default 'pending',
  skill_count integer,
  arcade_count integer,
  total_count integer,
  previous_verified_total integer not null,
  previous_skill_count integer,
  previous_arcade_count integer,
  previous_last_verified_at timestamptz,
  previous_verification_source text,
  delta integer,
  pending_badge_count integer not null default 0,
  unclassified_badge_count integer not null default 0,
  is_regression boolean not null default false,
  is_stale boolean not null default false,
  blocking_reason text,
  review_note text,
  row_number integer not null,
  -- Post-apply snapshot. Rollback verifies the live participant still equals
  -- this exact state before restoring the previous_* snapshot above. This is
  -- what prevents an older run from overwriting a later applied run.
  applied_total integer,
  applied_skill integer,
  applied_arcade integer,
  applied_verified_at timestamptz,
  applied_source text,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, participant_id),
  unique (run_id, row_number),
  constraint badge_sync_participant_registration_check check (
    registration_status in ('registered', 'pending', 'removed')
  ),
  constraint badge_sync_participant_removed_check check (
    is_removed = (registration_status = 'removed')
  ),
  constraint badge_sync_participant_observation_check check (
    observation_status in ('complete', 'incomplete', 'failed')
  ),
  constraint badge_sync_participant_status_check check (
    status in ('pending', 'approved', 'rejected', 'ignored', 'unclassified')
  ),
  constraint badge_sync_participant_counts_check check (
    -- Counts are either wholly unknown (NULL while staging, incomplete, or
    -- removed) or a complete valid split. Staging inserts a complete
    -- observation before badge evidence is recomputed, so observation_status
    -- must not force counts to be present at insert time. Preview/apply
    -- eligibility still requires all three counts to be present.
    (skill_count is null and arcade_count is null and total_count is null)
    or (skill_count is not null and skill_count between 0 and 10000
      and arcade_count is not null and arcade_count between 0 and 10000
      and total_count is not null and total_count between 0 and 10000
      and skill_count + arcade_count = total_count)
  ),
  constraint badge_sync_participant_review_note_check check (
    review_note is null or length(btrim(review_note)) between 1 and 1000
  ),
  constraint badge_sync_participant_blocking_reason_check check (
    blocking_reason is null or length(btrim(blocking_reason)) between 1 and 500
  ),
  constraint badge_sync_participant_applied_check check (
    (applied_at is null
      and applied_total is null
      and applied_skill is null
      and applied_arcade is null
      and applied_verified_at is null
      and applied_source is null
      and applied_by is null)
    or (applied_at is not null
      and applied_total is not null
      and applied_skill is not null
      and applied_arcade is not null
      and applied_total = applied_skill + applied_arcade)
  )
);

create table public.badge_sync_staged_badges (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.badge_sync_runs(id) on delete cascade,
  participant_staging_id uuid not null references public.badge_sync_participant_staging(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  badge_key text not null references public.badge_catalog(badge_key) on delete restrict,
  badge_title text not null,
  source_badge_id text,
  category text not null,
  status text not null default 'pending',
  observed_at timestamptz,
  earned_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, participant_id, badge_key),
  constraint badge_sync_staged_title_check check (
    length(btrim(badge_title)) between 1 and 200 and badge_title !~ '[[:cntrl:]]'
  ),
  constraint badge_sync_staged_source_badge_check check (
    source_badge_id is null or source_badge_id ~ '^[1-9][0-9]{0,19}$'
  ),
  constraint badge_sync_staged_category_check check (
    category in ('skill', 'arcade', 'ignored', 'unclassified')
  ),
  constraint badge_sync_staged_status_check check (
    status in ('pending', 'approved', 'rejected', 'ignored', 'unclassified')
  ),
  constraint badge_sync_staged_category_status_check check (
    (category = 'unclassified' and status = 'unclassified')
    or (category = 'ignored' and status in ('ignored', 'rejected'))
    or (category in ('skill', 'arcade') and status in ('pending', 'approved', 'rejected'))
  )
);

create index badge_sync_runs_status_created_idx
  on public.badge_sync_runs (status, created_at desc);
create index badge_sync_participant_run_status_idx
  on public.badge_sync_participant_staging (run_id, status);
create index badge_sync_staged_badges_run_participant_idx
  on public.badge_sync_staged_badges (run_id, participant_id);
create index badge_sync_staged_badges_catalog_idx
  on public.badge_sync_staged_badges (badge_key);

create trigger badge_sync_runs_set_updated_at
before update on public.badge_sync_runs
for each row execute function private.set_updated_at();
create trigger badge_sync_participant_set_updated_at
before update on public.badge_sync_participant_staging
for each row execute function private.set_updated_at();
create trigger badge_sync_staged_badges_set_updated_at
before update on public.badge_sync_staged_badges
for each row execute function private.set_updated_at();

-- A catalog identity used by any staged badge (or any catalog audit record)
-- is permanently referenced and cannot be deleted.
create or replace function private.protect_badge_catalog_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.badge_sync_staged_badges as staged
    where staged.badge_key = old.badge_key
    limit 1
  ) or exists (
    select 1 from public.badge_catalog_audit_events as audit
    where audit.badge_key = old.badge_key
    limit 1
  ) then
    raise exception using
      errcode = '23503',
      message = 'Referenced badge catalog entries cannot be deleted';
  end if;
  return old;
end;
$$;
revoke all on function private.protect_badge_catalog_delete() from public;
drop trigger if exists badge_catalog_protect_delete on public.badge_catalog;
create trigger badge_catalog_protect_delete
before delete on public.badge_catalog
for each row execute function private.protect_badge_catalog_delete();

alter table public.badge_sync_runs enable row level security;
alter table public.badge_sync_participant_staging enable row level security;
alter table public.badge_sync_staged_badges enable row level security;

revoke all on table public.badge_sync_runs from anon, authenticated;
revoke all on table public.badge_sync_participant_staging from anon, authenticated;
revoke all on table public.badge_sync_staged_badges from anon, authenticated;

grant select on public.badge_sync_runs, public.badge_sync_participant_staging, public.badge_sync_staged_badges
  to authenticated;
create policy badge_sync_runs_admin_read
  on public.badge_sync_runs for select to authenticated
  using ((select private.is_admin()));
create policy badge_sync_participant_admin_read
  on public.badge_sync_participant_staging for select to authenticated
  using ((select private.is_admin()));
create policy badge_sync_staged_badges_admin_read
  on public.badge_sync_staged_badges for select to authenticated
  using ((select private.is_admin()));

-- ------------------------------------------------------------------
-- Deterministic preview fingerprint.
-- Timestamps are rendered in UTC so the value does not depend on the
-- caller's session timezone. JSONB sorts object keys canonically.
-- ------------------------------------------------------------------
create or replace function private.badge_sync_fingerprint(p_run_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(
    jsonb_build_object(
      'run_id', run.id,
      'mode', run.mode,
      'participants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participant_id', staging.participant_id,
          'row_number', staging.row_number,
          'registration_status', staging.registration_status,
          'is_removed', staging.is_removed,
          'observation_status', staging.observation_status,
          'status', staging.status,
          'skill', staging.skill_count,
          'arcade', staging.arcade_count,
          'total', staging.total_count,
          'previous_total', staging.previous_verified_total,
          'previous_skill', staging.previous_skill_count,
          'previous_arcade', staging.previous_arcade_count,
          'previous_verified_at', case when staging.previous_last_verified_at is null then null
            else to_char(staging.previous_last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
          'previous_source', staging.previous_verification_source,
          'pending', staging.pending_badge_count,
          'unclassified', staging.unclassified_badge_count,
          'regression', staging.is_regression,
          'blocking_reason', staging.blocking_reason
        ) order by staging.participant_id)
        from public.badge_sync_participant_staging as staging
        where staging.run_id = run.id
      ), '[]'::jsonb),
      'badges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participant_id', staged.participant_id,
          'badge_key', staged.badge_key,
          'category', staged.category,
          'status', staged.status
        ) order by staged.participant_id, staged.badge_key)
        from public.badge_sync_staged_badges as staged
        where staged.run_id = run.id
      ), '[]'::jsonb)
    )::text
  )
  from public.badge_sync_runs as run
  where run.id = p_run_id;
$$;
revoke all on function private.badge_sync_fingerprint(uuid) from public;

-- ------------------------------------------------------------------
-- Recompute participant counts from approved catalog identities.
-- Caller must hold the run row lock.
-- ------------------------------------------------------------------
create or replace function private.badge_sync_recompute(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_participant public.badge_sync_participant_staging%rowtype;
  v_skill integer;
  v_arcade integer;
  v_pending integer;
  v_unclassified integer;
  v_total integer;
  v_status text;
  v_reason text;
begin
  select runs.mode into v_mode
  from public.badge_sync_runs as runs
  where runs.id = p_run_id;
  if v_mode is null then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  -- Refresh the previous-state snapshot from the live participant row. This is
  -- what makes a later apply detect a stale preview.
  update public.badge_sync_participant_staging as staging
  set participant_key = participant.participant_key,
      display_name = participant.display_name,
      registration_status = participant.registration_status,
      is_removed = (participant.registration_status = 'removed'),
      previous_verified_total = participant.verified_badge_count,
      previous_skill_count = participant.skill_badge_count,
      previous_arcade_count = participant.arcade_game_badge_count,
      previous_last_verified_at = participant.last_verified_at,
      previous_verification_source = participant.verification_source,
      -- Recomputing a preview invalidates any previous apply snapshot. The
      -- snapshot is only meaningful for the immediately preceding apply.
      applied_total = null,
      applied_skill = null,
      applied_arcade = null,
      applied_verified_at = null,
      applied_source = null,
      applied_at = null,
      applied_by = null
  from public.participants as participant
  where staging.run_id = p_run_id
    and staging.participant_id = participant.id;

  -- Badge-level decisions only exist for observation runs. Classified-count
  -- runs carry explicit, already-validated counts and must never be zeroed by
  -- recomputing from an empty staged-badge set.
  if v_mode = 'badge_observations' then
    -- Align staged categories with explicit catalog decisions. A changed
    -- catalog category invalidates a prior approval through the fingerprint.
    update public.badge_sync_staged_badges as staged
    set category = catalog.category,
        status = case
          when catalog.category = 'unclassified' then 'unclassified'
          when catalog.category = 'ignored' then case when staged.status = 'rejected' then 'rejected' else 'ignored' end
          when staged.status in ('ignored', 'unclassified') then 'pending'
          else staged.status
        end
    from public.badge_catalog as catalog
    where staged.run_id = p_run_id
      and staged.badge_key = catalog.badge_key
      and (
        staged.category is distinct from catalog.category
        or (catalog.category = 'ignored' and staged.status not in ('ignored', 'rejected'))
        or (catalog.category in ('skill', 'arcade') and staged.status in ('ignored', 'unclassified'))
      );
  end if;

  for v_participant in
    select staging.*
    from public.badge_sync_participant_staging as staging
    where staging.run_id = p_run_id
    order by staging.participant_id
  loop
    -- A participant removed after staging becomes an explicitly failed,
    -- count-less observation. It is never silently applied.
    if v_participant.is_removed then
      update public.badge_sync_participant_staging as staging
      set observation_status = 'failed',
          skill_count = null,
          arcade_count = null,
          total_count = null,
          delta = null,
          status = 'rejected',
          pending_badge_count = 0,
          unclassified_badge_count = 0,
          is_regression = false,
          is_stale = false,
          blocking_reason = 'Participant is removed; no count may be applied.'
      where staging.id = v_participant.id;
      continue;
    end if;

    if v_mode = 'classified_counts' then
      if v_participant.observation_status <> 'complete'
        or v_participant.skill_count is null
        or v_participant.arcade_count is null
        or v_participant.total_count is null then
        v_skill := null;
        v_arcade := null;
        v_total := null;
        v_pending := 0;
        v_unclassified := 0;
        v_status := 'rejected';
        v_reason := 'Observation is not complete; counts are unknown, not zero.';
      else
        v_skill := v_participant.skill_count;
        v_arcade := v_participant.arcade_count;
        v_total := v_participant.total_count;
        v_pending := 0;
        v_unclassified := 0;
        if v_total < v_participant.previous_verified_total then
          v_status := 'rejected';
          v_reason := 'Regression: the proposed total is below the previous verified total.';
        else
          v_status := 'approved';
          v_reason := null;
        end if;
      end if;
    elsif v_participant.observation_status <> 'complete' then
      v_skill := null;
      v_arcade := null;
      v_total := null;
      v_pending := 0;
      v_unclassified := 0;
      v_status := 'rejected';
      v_reason := case
        when v_participant.observation_status = 'incomplete' then 'Observation is incomplete; counts are unknown, not zero.'
        else 'Observation failed; counts are unknown, not zero.'
      end;
    else
      select
        count(*) filter (where staged.category = 'skill' and staged.status = 'approved'),
        count(*) filter (where staged.category = 'arcade' and staged.status = 'approved'),
        count(*) filter (where staged.status = 'pending'),
        count(*) filter (where staged.category = 'unclassified' or staged.status = 'unclassified')
      into v_skill, v_arcade, v_pending, v_unclassified
      from public.badge_sync_staged_badges as staged
      where staged.run_id = p_run_id
        and staged.participant_id = v_participant.participant_id;

      v_total := v_skill + v_arcade;
      if v_unclassified > 0 then
        v_status := 'unclassified';
        v_reason := 'Unclassified badge identities must be classified in the managed catalog.';
      elsif v_pending > 0 then
        v_status := 'pending';
        v_reason := 'Pending badge identities require explicit admin approval.';
      elsif v_total < v_participant.previous_verified_total then
        v_status := 'rejected';
        v_reason := 'Regression: the proposed total is below the previous verified total.';
      else
        v_status := 'approved';
        v_reason := null;
      end if;
    end if;

    update public.badge_sync_participant_staging as staging
    set skill_count = v_skill,
        arcade_count = v_arcade,
        total_count = v_total,
        delta = case when v_total is null then null else v_total - staging.previous_verified_total end,
        status = v_status,
        pending_badge_count = v_pending,
        unclassified_badge_count = v_unclassified,
        is_regression = (v_total is not null and v_total < staging.previous_verified_total),
        is_stale = false,
        blocking_reason = v_reason
    where staging.id = v_participant.id;
  end loop;

  update public.badge_sync_runs as run
  set total_participants = aggregates.participant_count,
      total_skill = aggregates.skill_total,
      total_arcade = aggregates.arcade_total,
      total_badges = aggregates.skill_total + aggregates.arcade_total,
      unclassified_participant_count = aggregates.unclassified_count,
      pending_participant_count = aggregates.pending_count,
      blocked_participant_count = aggregates.blocked_count
  from (
    select
      count(*) filter (where evaluated.is_eligible)::integer as participant_count,
      coalesce(sum(evaluated.skill_count) filter (where evaluated.is_eligible), 0)::integer as skill_total,
      coalesce(sum(evaluated.arcade_count) filter (where evaluated.is_eligible), 0)::integer as arcade_total,
      count(*) filter (where evaluated.status = 'unclassified')::integer as unclassified_count,
      count(*) filter (where evaluated.status = 'pending')::integer as pending_count,
      count(*) filter (where not evaluated.is_eligible)::integer as blocked_count
    from (
      select
        staging.*,
        (staging.status = 'approved'
          and staging.observation_status = 'complete'
          and not staging.is_removed
          and staging.skill_count is not null
          and staging.arcade_count is not null
          and staging.total_count is not null) as is_eligible
      from public.badge_sync_participant_staging as staging
      where staging.run_id = p_run_id
    ) as evaluated
  ) as aggregates
  where run.id = p_run_id;
end;
$$;
revoke all on function private.badge_sync_recompute(uuid) from public;

-- ------------------------------------------------------------------
-- Read model for the admin UI and server actions.
-- ------------------------------------------------------------------
create or replace function public.admin_get_badge_sync_snapshot(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.badge_sync_runs%rowtype;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  select runs.* into v_run from public.badge_sync_runs as runs where runs.id = p_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id,
      'mode', v_run.mode,
      'status', v_run.status,
      'source', v_run.source,
      'source_filename', v_run.source_filename,
      'source_sha256', v_run.source_sha256,
      'note', v_run.note,
      'preview_fingerprint', v_run.preview_fingerprint,
      'previewed_at', case when v_run.previewed_at is null then null
        else to_char(v_run.previewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'approved_at', case when v_run.approved_at is null then null
        else to_char(v_run.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'approved_by', v_run.approved_by,
      'applied_at', case when v_run.applied_at is null then null
        else to_char(v_run.applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'apply_request_id', v_run.apply_request_id,
      'apply_result', v_run.apply_result,
      'rolled_back_at', case when v_run.rolled_back_at is null then null
        else to_char(v_run.rolled_back_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'rollback_result', v_run.rollback_result,
      'total_participants', v_run.total_participants,
      'total_skill', v_run.total_skill,
      'total_arcade', v_run.total_arcade,
      'total_badges', v_run.total_badges,
      'unclassified_participant_count', v_run.unclassified_participant_count,
      'pending_participant_count', v_run.pending_participant_count,
      'blocked_participant_count', v_run.blocked_participant_count,
      'created_at', to_char(v_run.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', staging.id,
        'participant_id', staging.participant_id,
        'participant_key', staging.participant_key,
        'display_name', staging.display_name,
        'row_number', staging.row_number,
        'registration_status', staging.registration_status,
        'is_removed', staging.is_removed,
        'observation_status', staging.observation_status,
        'status', staging.status,
        'skill_count', staging.skill_count,
        'arcade_count', staging.arcade_count,
        'total_count', staging.total_count,
        'previous_verified_total', staging.previous_verified_total,
        'previous_skill_count', staging.previous_skill_count,
        'previous_arcade_count', staging.previous_arcade_count,
        'previous_last_verified_at', case when staging.previous_last_verified_at is null then null
          else to_char(staging.previous_last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'previous_verification_source', staging.previous_verification_source,
        'delta', staging.delta,
        'pending_badge_count', staging.pending_badge_count,
        'unclassified_badge_count', staging.unclassified_badge_count,
        'is_regression', staging.is_regression,
        'is_stale', staging.is_stale,
        'blocking_reason', staging.blocking_reason,
        'review_note', staging.review_note,
        'applied_total', staging.applied_total,
        'applied_skill_count', staging.applied_skill,
        'applied_arcade_count', staging.applied_arcade,
        'applied_verified_at', case when staging.applied_verified_at is null then null
          else to_char(staging.applied_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'applied_source', staging.applied_source,
        'applied_at', case when staging.applied_at is null then null
          else to_char(staging.applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
      ) order by staging.row_number)
      from public.badge_sync_participant_staging as staging
      where staging.run_id = v_run.id
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', staged.id,
        'participant_id', staged.participant_id,
        'participant_staging_id', staged.participant_staging_id,
        'badge_key', staged.badge_key,
        'badge_title', staged.badge_title,
        'source_badge_id', staged.source_badge_id,
        'category', staged.category,
        'status', staged.status,
        'observed_at', case when staged.observed_at is null then null
          else to_char(staged.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'earned_on', staged.earned_on
      ) order by staged.participant_id, staged.badge_key)
      from public.badge_sync_staged_badges as staged
      where staged.run_id = v_run.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_get_badge_sync_snapshot(uuid) from public, anon;
grant execute on function public.admin_get_badge_sync_snapshot(uuid) to authenticated;

-- ------------------------------------------------------------------
-- Run creation and staging.
-- ------------------------------------------------------------------
create or replace function public.admin_create_badge_sync_run(
  p_mode text default 'badge_observations',
  p_source_filename text default null,
  p_source_sha256 text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_mode not in ('badge_observations', 'classified_counts') then
    raise exception using errcode = '22023', message = 'Badge sync mode is invalid';
  end if;
  if p_source_filename is not null and length(btrim(p_source_filename)) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'Source filename must be 1 to 255 characters';
  end if;
  if p_source_sha256 is not null and p_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Source SHA-256 must be 64 lowercase hex characters';
  end if;
  if p_note is not null and length(btrim(p_note)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Run note must be 1 to 1000 characters';
  end if;

  insert into public.badge_sync_runs (mode, status, source, source_filename, source_sha256, note, created_by)
  values (
    p_mode, 'draft', 'admin_import', nullif(btrim(p_source_filename), ''),
    lower(nullif(btrim(p_source_sha256), '')), nullif(btrim(p_note), ''), v_actor
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_create_badge_sync_run(text, text, text, text) from public, anon;
grant execute on function public.admin_create_badge_sync_run(text, text, text, text) to authenticated;

create or replace function public.admin_stage_badge_sync_observations(
  p_run_id uuid,
  p_participants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_item jsonb;
  v_ordinality bigint;
  v_participant public.participants%rowtype;
  v_participant_id uuid;
  v_observation_status text;
  v_staging_id uuid;
  v_badge jsonb;
  v_badge_key text;
  v_badge_title text;
  v_source_badge_id text;
  v_observed_at timestamptz;
  v_earned_on date;
  v_category text;
  v_badge_status text;
  v_seen_keys text[];
  v_badge_count integer;
  v_removed boolean;
  v_catalog_inserted integer;
  v_row_base integer;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  select runs.* into v_run
  from public.badge_sync_runs as runs
  where runs.id = p_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;
  if v_run.mode <> 'badge_observations' then
    raise exception using errcode = '22023', message = 'This run does not accept badge observations';
  end if;
  if v_run.status not in ('draft', 'staged') then
    raise exception using errcode = '22023', message = 'Badge observations can only be staged before preview';
  end if;
  if jsonb_typeof(p_participants) is distinct from 'array'
    or jsonb_array_length(p_participants) < 1
    or jsonb_array_length(p_participants) > 500 then
    raise exception using errcode = '22023', message = 'Staging batch must contain 1 to 500 participants';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_participants) as items(value)
    group by (items.value ->> 'participant_id')
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Staging batch contains duplicate participants';
  end if;

  -- Row numbers follow the same contract as the manual classified CSV: row 1 is
  -- the header, so staged rows start at 2. Incremental staging calls continue
  -- above the current maximum, which keeps (run_id, row_number) unique and
  -- lets apply forward valid spreadsheet-style row numbers.
  select coalesce(max(staging.row_number), 1) into v_row_base
  from public.badge_sync_participant_staging as staging
  where staging.run_id = p_run_id;

  for v_item, v_ordinality in
    select items.value, items.ordinality
    from jsonb_array_elements(p_participants) with ordinality as items(value, ordinality)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Each staged participant must be an object';
    end if;
    if coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Staged participant ID is invalid';
    end if;
    v_participant_id := (v_item ->> 'participant_id')::uuid;
    v_observation_status := coalesce(v_item ->> 'observation_status', 'complete');
    if v_observation_status not in ('complete', 'incomplete', 'failed') then
      raise exception using errcode = '22023', message = 'Observation status is invalid';
    end if;
    if jsonb_typeof(v_item -> 'badges') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Each staged participant must include a badges array';
    end if;
    if v_observation_status <> 'complete' and jsonb_array_length(v_item -> 'badges') > 0 then
      raise exception using errcode = '22023', message = 'Incomplete or failed observations cannot include badge identities';
    end if;
    if nullif(btrim(coalesce(v_item ->> 'review_note', '')), '') is not null
      and (length(btrim(v_item ->> 'review_note')) not between 1 and 1000
        or btrim(v_item ->> 'review_note') ~ '[[:cntrl:]]') then
      raise exception using errcode = '22023', message = 'Review note must be 1 to 1000 printable characters';
    end if;

    select participant.* into v_participant
    from public.participants as participant
    where participant.id = v_participant_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'A staged participant is not in the roster';
    end if;

    v_removed := v_participant.registration_status = 'removed';

    insert into public.badge_sync_participant_staging (
      run_id, participant_id, participant_key, display_name, registration_status,
      is_removed, observation_status, status,
      previous_verified_total, previous_skill_count, previous_arcade_count,
      previous_last_verified_at, previous_verification_source, row_number, review_note
    ) values (
      p_run_id, v_participant.id, v_participant.participant_key, v_participant.display_name,
      v_participant.registration_status, v_removed,
      case when v_removed then 'failed' else v_observation_status end,
      case when v_removed then 'rejected' else 'pending' end,
      v_participant.verified_badge_count, v_participant.skill_badge_count,
      v_participant.arcade_game_badge_count, v_participant.last_verified_at,
      v_participant.verification_source, v_row_base + v_ordinality::integer,
      nullif(btrim(coalesce(v_item ->> 'review_note', '')), '')
    )
    on conflict (run_id, participant_id) do update
    set participant_key = excluded.participant_key,
        display_name = excluded.display_name,
        registration_status = excluded.registration_status,
        is_removed = excluded.is_removed,
        observation_status = excluded.observation_status,
        status = excluded.status,
        previous_verified_total = excluded.previous_verified_total,
        previous_skill_count = excluded.previous_skill_count,
        previous_arcade_count = excluded.previous_arcade_count,
        previous_last_verified_at = excluded.previous_last_verified_at,
        previous_verification_source = excluded.previous_verification_source,
        row_number = excluded.row_number,
        review_note = excluded.review_note,
        skill_count = null,
        arcade_count = null,
        total_count = null,
        delta = null,
        pending_badge_count = 0,
        unclassified_badge_count = 0,
        is_regression = false,
        is_stale = false,
        blocking_reason = null,
        applied_total = null,
        applied_skill = null,
        applied_arcade = null,
        applied_verified_at = null,
        applied_source = null,
        applied_at = null,
        applied_by = null
    returning id into v_staging_id;

    delete from public.badge_sync_staged_badges as staged
    where staged.run_id = p_run_id
      and staged.participant_id = v_participant_id;

    v_seen_keys := array[]::text[];
    v_badge_count := 0;
    for v_badge in select value from jsonb_array_elements(v_item -> 'badges') as badges(value)
    loop
      v_badge_count := v_badge_count + 1;
      if jsonb_typeof(v_badge) is distinct from 'object' then
        raise exception using errcode = '22023', message = 'Each staged badge must be an object';
      end if;
      v_badge_key := btrim(coalesce(v_badge ->> 'badge_key', ''));
      v_badge_title := btrim(coalesce(v_badge ->> 'badge_title', ''));
      v_source_badge_id := nullif(btrim(coalesce(v_badge ->> 'source_badge_id', '')), '');
      if v_badge_key !~ '^(course_template|game):[1-9][0-9]{0,19}$' then
        raise exception using errcode = '22023',
          message = 'Badge identity must be course_template:<id> or game:<id>; /badges/<id> is award-scoped and invalid';
      end if;
      if length(v_badge_title) < 1 or length(v_badge_title) > 200 or v_badge_title ~ '[[:cntrl:]]' then
        raise exception using errcode = '22023', message = 'Badge title must be 1 to 200 printable characters';
      end if;
      if v_source_badge_id is not null and v_source_badge_id !~ '^[1-9][0-9]{0,19}$' then
        raise exception using errcode = '22023', message = 'Award-scoped badge id is invalid';
      end if;
      if v_badge_key = any(v_seen_keys) then
        raise exception using errcode = '22023', message = 'Duplicate badge identity in the staged participant';
      end if;
      v_seen_keys := array_append(v_seen_keys, v_badge_key);

      begin
        v_observed_at := nullif(v_badge ->> 'observed_at', '')::timestamptz;
        v_earned_on := nullif(v_badge ->> 'earned_on', '')::date;
      exception when others then
        raise exception using errcode = '22023', message = 'Badge observation date is invalid';
      end;

      insert into public.badge_catalog (badge_key, display_name, category, source, updated_by)
      values (v_badge_key, v_badge_title, 'unclassified', 'staged:unknown', v_actor)
      on conflict (badge_key) do nothing;
      get diagnostics v_catalog_inserted = row_count;
      if v_catalog_inserted = 1 then
        -- Auto-created identities are still explicit, reviewable catalog
        -- records. They must never appear without an audit trail.
        insert into public.badge_catalog_audit_events (
          badge_key, previous_category, new_category,
          previous_display_name, new_display_name, reason, actor_user_id
        ) values (
          v_badge_key, null, 'unclassified', null, v_badge_title,
          'Auto-created from staged badge evidence; classify before approving', v_actor
        );
      end if;

      select catalog.category into v_category
      from public.badge_catalog as catalog
      where catalog.badge_key = v_badge_key;

      v_badge_status := case
        when v_category = 'unclassified' then 'unclassified'
        when v_category = 'ignored' then 'ignored'
        else 'pending'
      end;

      insert into public.badge_sync_staged_badges (
        run_id, participant_staging_id, participant_id, badge_key, badge_title,
        source_badge_id, category, status, observed_at, earned_on
      ) values (
        p_run_id, v_staging_id, v_participant_id, v_badge_key, v_badge_title,
        v_source_badge_id, v_category, v_badge_status, v_observed_at, v_earned_on
      );
    end loop;

    if v_removed and v_badge_count > 0 then
      raise exception using errcode = '22023', message = 'Removed participants cannot stage badge observations';
    end if;
  end loop;

  update public.badge_sync_runs as runs
  set status = 'staged',
      preview_fingerprint = null,
      previewed_at = null,
      approved_at = null,
      approved_by = null,
      applying_started_at = null
  where runs.id = p_run_id;

  return public.admin_get_badge_sync_snapshot(p_run_id);
end;
$$;
revoke all on function public.admin_stage_badge_sync_observations(uuid, jsonb) from public, anon;
grant execute on function public.admin_stage_badge_sync_observations(uuid, jsonb) to authenticated;

create or replace function public.admin_set_staged_badge_status(
  p_run_id uuid,
  p_participant_id uuid,
  p_badge_key text,
  p_status text
)
returns table(staged_badge_id uuid, category text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_badge public.badge_sync_staged_badges%rowtype;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  select runs.* into v_run from public.badge_sync_runs as runs where runs.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;
  if v_run.status <> 'staged' then
    raise exception using errcode = '22023', message = 'Badge decisions can only change before preview';
  end if;
  if p_status not in ('approved', 'rejected', 'ignored') then
    raise exception using errcode = '22023', message = 'Badge decision status is invalid';
  end if;

  select staged.* into v_badge
  from public.badge_sync_staged_badges as staged
  where staged.run_id = p_run_id
    and staged.participant_id = p_participant_id
    and staged.badge_key = p_badge_key
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Staged badge not found';
  end if;
  if v_badge.category = 'unclassified' then
    raise exception using errcode = '22023', message = 'Classify the badge in the managed catalog before approving it';
  end if;
  if v_badge.category = 'ignored' and p_status <> 'ignored' then
    raise exception using errcode = '22023', message = 'Ignored catalog badges can only be ignored or rejected';
  end if;
  if v_badge.category in ('skill', 'arcade') and p_status = 'ignored' then
    raise exception using errcode = '22023', message = 'Only catalog-ignored badges can be ignored';
  end if;

  update public.badge_sync_staged_badges as staged
  set status = p_status
  where staged.id = v_badge.id;

  staged_badge_id := v_badge.id;
  category := v_badge.category;
  status := p_status;
  return next;
end;
$$;
revoke all on function public.admin_set_staged_badge_status(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_set_staged_badge_status(uuid, uuid, text, text) to authenticated;

create or replace function public.admin_bulk_set_staged_badge_status(
  p_run_id uuid,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  select runs.* into v_run from public.badge_sync_runs as runs where runs.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;
  if v_run.status <> 'staged' then
    raise exception using errcode = '22023', message = 'Badge decisions can only change before preview';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Bulk badge decision must be approved or rejected';
  end if;

  update public.badge_sync_staged_badges as staged
  set status = p_status
  where staged.run_id = p_run_id
    and staged.category in ('skill', 'arcade')
    and staged.status <> p_status;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.admin_bulk_set_staged_badge_status(uuid, text) from public, anon;
grant execute on function public.admin_bulk_set_staged_badge_status(uuid, text) to authenticated;

-- ------------------------------------------------------------------
-- Deterministic preview.
-- ------------------------------------------------------------------
create or replace function public.admin_preview_badge_sync_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_fingerprint text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  select runs.* into v_run from public.badge_sync_runs as runs where runs.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;
  if v_run.status not in ('staged', 'previewed') then
    raise exception using errcode = '22023', message = 'Only staged runs can be previewed';
  end if;

  perform private.badge_sync_recompute(p_run_id);
  v_fingerprint := private.badge_sync_fingerprint(p_run_id);
  if v_fingerprint is null then
    raise exception using errcode = 'P0002', message = 'Badge sync preview could not be fingerprinted';
  end if;

  update public.badge_sync_runs as runs
  set status = 'previewed',
      preview_fingerprint = v_fingerprint,
      previewed_at = now(),
      approved_at = null,
      approved_by = null
  where runs.id = p_run_id;

  return public.admin_get_badge_sync_snapshot(p_run_id);
end;
$$;
revoke all on function public.admin_preview_badge_sync_run(uuid) from public, anon;
grant execute on function public.admin_preview_badge_sync_run(uuid) to authenticated;

create or replace function public.admin_approve_badge_sync_run(p_run_id uuid, p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_fingerprint text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  select runs.* into v_run from public.badge_sync_runs as runs where runs.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;
  if v_run.status <> 'previewed' then
    raise exception using errcode = '22023', message = 'Only a previewed run can be approved';
  end if;
  if coalesce(p_fingerprint, '') !~ '^[0-9a-f]{32}$'
    or v_run.preview_fingerprint is distinct from p_fingerprint then
    raise exception using errcode = '40001', message = 'The preview fingerprint is stale; preview again';
  end if;
  v_fingerprint := private.badge_sync_fingerprint(p_run_id);
  if v_fingerprint is distinct from p_fingerprint then
    raise exception using errcode = '40001', message = 'The badge sync preview changed; preview again';
  end if;

  update public.badge_sync_runs as runs
  set status = 'approved',
      approved_at = now(),
      approved_by = v_actor
  where runs.id = p_run_id;

  return public.admin_get_badge_sync_snapshot(p_run_id);
end;
$$;
revoke all on function public.admin_approve_badge_sync_run(uuid, text) from public, anon;
grant execute on function public.admin_approve_badge_sync_run(uuid, text) to authenticated;

-- ------------------------------------------------------------------
-- Existing classified CSV preview: create + stage + preview in one call.
-- Removed participants are rejected server-side, never silently skipped.
-- ------------------------------------------------------------------
create or replace function public.admin_create_classified_badge_sync_run(
  p_rows jsonb,
  p_source_filename text default null,
  p_source_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run_id uuid;
  v_item jsonb;
  v_participant_id uuid;
  v_row_number integer;
  v_skill integer;
  v_arcade integer;
  v_total integer;
  v_note text;
  v_expected_total integer;
  v_expected_verified_at timestamptz;
  v_expected_source text;
  v_participant public.participants%rowtype;
  v_status text;
  v_reason text;
  v_fingerprint text;
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
    raise exception using errcode = '22023', message = 'Classified badge sync must contain 1 to 500 rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as items(value)
    group by items.value ->> 'participant_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Classified badge sync contains duplicate participants';
  end if;

  insert into public.badge_sync_runs (
    mode, status, source, source_filename, source_sha256, created_by
  ) values (
    'classified_counts', 'staged', 'admin_import',
    nullif(btrim(coalesce(p_source_filename, '')), ''),
    lower(nullif(btrim(coalesce(p_source_sha256, '')), '')),
    v_actor
  ) returning id into v_run_id;

  for v_item in select value from jsonb_array_elements(p_rows) as items(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'row_number', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_item ->> 'skill_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'arcade_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'total_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'expected_total_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or jsonb_typeof(v_item -> 'review_note') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Classified badge sync row is malformed';
    end if;

    v_participant_id := (v_item ->> 'participant_id')::uuid;
    v_row_number := (v_item ->> 'row_number')::integer;
    v_skill := (v_item ->> 'skill_count')::integer;
    v_arcade := (v_item ->> 'arcade_count')::integer;
    v_total := (v_item ->> 'total_count')::integer;
    v_note := btrim(v_item ->> 'review_note');
    v_expected_total := (v_item ->> 'expected_total_count')::integer;
    v_expected_verified_at := nullif(v_item ->> 'expected_last_verified_at', '')::timestamptz;
    v_expected_source := nullif(v_item ->> 'expected_verification_source', '');

    if v_row_number < 2 or v_row_number > 501
      or v_skill > 10000 or v_arcade > 10000 or v_total > 10000
      or v_expected_total > 10000
      or v_skill + v_arcade <> v_total
      or length(v_note) not between 1 and 1000
      or v_note ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'Classified badge sync row is outside allowed limits';
    end if;

    select participant.* into v_participant
    from public.participants as participant
    where participant.id = v_participant_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'A participant is no longer available; preview the CSV again';
    end if;
    if v_participant.registration_status = 'removed' then
      raise exception using errcode = '22023', message = 'Removed participants cannot be included in a badge sync run';
    end if;
    if (v_participant.verified_badge_count is distinct from v_expected_total
        or v_participant.last_verified_at is distinct from v_expected_verified_at
        or v_participant.verification_source is distinct from v_expected_source)
      and v_participant.verified_badge_count is distinct from v_total then
      raise exception using errcode = '40001', message = 'Participant verification changed after preview; preview the CSV again';
    end if;

    if v_total < v_participant.verified_badge_count then
      v_status := 'rejected';
      v_reason := 'Regression: the proposed total is below the previous verified total.';
    else
      v_status := 'approved';
      v_reason := null;
    end if;

    insert into public.badge_sync_participant_staging (
      run_id, participant_id, participant_key, display_name, registration_status,
      is_removed, observation_status, status,
      skill_count, arcade_count, total_count,
      previous_verified_total, previous_skill_count, previous_arcade_count,
      previous_last_verified_at, previous_verification_source,
      delta, is_regression, blocking_reason, review_note, row_number
    ) values (
      v_run_id, v_participant.id, v_participant.participant_key, v_participant.display_name,
      v_participant.registration_status, false, 'complete', v_status,
      v_skill, v_arcade, v_total,
      v_participant.verified_badge_count, v_participant.skill_badge_count,
      v_participant.arcade_game_badge_count, v_participant.last_verified_at,
      v_participant.verification_source,
      v_total - v_participant.verified_badge_count,
      (v_total < v_participant.verified_badge_count), v_reason, v_note, v_row_number
    );
  end loop;

  perform private.badge_sync_recompute(v_run_id);
  v_fingerprint := private.badge_sync_fingerprint(v_run_id);
  update public.badge_sync_runs as runs
  set status = 'previewed',
      preview_fingerprint = v_fingerprint,
      previewed_at = now()
  where runs.id = v_run_id;

  return public.admin_get_badge_sync_snapshot(v_run_id);
end;
$$;
revoke all on function public.admin_create_classified_badge_sync_run(jsonb, text, text) from public, anon;
grant execute on function public.admin_create_classified_badge_sync_run(jsonb, text, text) to authenticated;
