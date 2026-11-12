-- Phase 2: run-scoped fetch queue for the one-click "Sync All Badges" bridge.
--
-- This queue is deliberately independent of the (never deployed) auto-progress
-- durable-job tables. It stores one row per active participant per badge sync
-- run, hands out short leases with FOR UPDATE SKIP LOCKED, and lets a Vercel
-- function process Vercel-safe batches across multiple invocations.
--
-- Nothing here fetches a profile. The route does that; these RPCs only fence
-- claims, record outcomes, and expose progress. All writes are security definer
-- with a fixed empty search_path and an explicit private.is_admin() check.

alter table public.badge_sync_runs
  add column if not exists fetch_paused_at timestamptz,
  add column if not exists fetch_pause_reason text;

alter table public.badge_sync_runs
  drop constraint if exists badge_sync_runs_fetch_pause_reason_check;
alter table public.badge_sync_runs
  add constraint badge_sync_runs_fetch_pause_reason_check check (
    fetch_pause_reason is null or length(btrim(fetch_pause_reason)) between 1 and 500
  );

create table public.badge_sync_fetch_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.badge_sync_runs(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_key text not null,
  display_name text not null,
  profile_url text,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_category text,
  retry_after timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, participant_id),
  constraint badge_sync_fetch_queue_status_check check (
    status in ('pending', 'claimed', 'staged', 'failed', 'skipped')
  ),
  constraint badge_sync_fetch_queue_attempt_check check (attempt_count >= 0),
  constraint badge_sync_fetch_queue_claim_shape check (
    (status = 'claimed' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'claimed' and lease_token is null and lease_expires_at is null)
  ),
  constraint badge_sync_fetch_queue_error_check check (
    error_category is null or length(btrim(error_category)) between 1 and 120
  )
);

create index badge_sync_fetch_queue_run_status_idx
  on public.badge_sync_fetch_queue (run_id, status);
create index badge_sync_fetch_queue_run_lease_idx
  on public.badge_sync_fetch_queue (run_id, lease_expires_at);
create index badge_sync_fetch_queue_run_retry_idx
  on public.badge_sync_fetch_queue (run_id, retry_after);

create trigger badge_sync_fetch_queue_set_updated_at
before update on public.badge_sync_fetch_queue
for each row execute function private.set_updated_at();

alter table public.badge_sync_fetch_queue enable row level security;
revoke all on table public.badge_sync_fetch_queue from anon, authenticated;
grant select on public.badge_sync_fetch_queue to authenticated;
create policy badge_sync_fetch_queue_admin_read
  on public.badge_sync_fetch_queue for select to authenticated
  using ((select private.is_admin()));

-- ------------------------------------------------------------------
-- Create a profile-evidence run (never labelled as an admin CSV import).
-- ------------------------------------------------------------------
create or replace function public.admin_create_badge_sync_fetch_run(
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
  if p_note is not null and length(btrim(p_note)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Run note must be 1 to 1000 characters';
  end if;

  insert into public.badge_sync_runs (mode, status, source, note, created_by)
  values ('badge_observations', 'draft', 'profile_evidence', nullif(btrim(p_note), ''), v_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_create_badge_sync_fetch_run(text) from public, anon;
grant execute on function public.admin_create_badge_sync_fetch_run(text) to authenticated;

-- ------------------------------------------------------------------
-- Claim a bounded batch.
--
-- Seeds any active participant missing from this run (so a participant added
-- mid-run is still processed), retires removed participants, recovers expired
-- leases, and only then hands out new claims.
-- ------------------------------------------------------------------
create or replace function public.admin_claim_badge_sync_fetch_batch(
  p_run_id uuid,
  p_batch_size integer default 8,
  p_lease_seconds integer default 120
)
returns table(
  item_id uuid,
  participant_id uuid,
  participant_key text,
  display_name text,
  profile_url text,
  item_claim_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_batch integer := greatest(1, least(32, coalesce(p_batch_size, 8)));
  v_lease integer := greatest(30, least(600, coalesce(p_lease_seconds, 120)));
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
    raise exception using errcode = '22023', message = 'This run does not accept live profile evidence';
  end if;
  if v_run.fetch_paused_at is not null then
    return;
  end if;
  if v_run.status not in ('draft', 'staged') then
    return;
  end if;

  -- Removed participants never contribute a count. Retire any queued work and
  -- remove their staging rows so the completeness guard only sees active peers.
  update public.badge_sync_fetch_queue as queue
  set status = 'skipped',
      lease_token = null,
      lease_expires_at = null,
      completed_at = now(),
      error_category = 'participant_removed'
  from public.participants as participant
  where queue.run_id = p_run_id
    and queue.participant_id = participant.id
    and participant.registration_status = 'removed'
    and queue.status in ('pending', 'claimed', 'failed');

  delete from public.badge_sync_participant_staging as staging
  using public.participants as participant
  where staging.run_id = p_run_id
    and staging.participant_id = participant.id
    and participant.registration_status = 'removed';

  -- Seed (or top up) the queue with every active participant.
  insert into public.badge_sync_fetch_queue (
    run_id, participant_id, participant_key, display_name, profile_url
  )
  select p_run_id, participant.id, participant.participant_key, participant.display_name,
         participant.profile_url
  from public.participants as participant
  where participant.registration_status <> 'removed'
    and not exists (
      select 1 from public.badge_sync_fetch_queue as existing
      where existing.run_id = p_run_id
        and existing.participant_id = participant.id
    )
  on conflict on constraint badge_sync_fetch_queue_run_id_participant_id_key do nothing;

  -- Recover leases that expired while a previous invocation died.
  update public.badge_sync_fetch_queue as queue
  set status = 'pending',
      lease_token = null,
      lease_expires_at = null
  where queue.run_id = p_run_id
    and queue.status = 'claimed'
    and queue.lease_expires_at < now();

  return query
  with picked as (
    select queue.id
    from public.badge_sync_fetch_queue as queue
    where queue.run_id = p_run_id
      and queue.status = 'pending'
      and (queue.retry_after is null or queue.retry_after <= now())
    order by queue.created_at, queue.id
    for update skip locked
    limit v_batch
  ), claimed as (
    update public.badge_sync_fetch_queue as queue
    set status = 'claimed',
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease),
        attempt_count = queue.attempt_count + 1,
        last_attempt_at = now()
    from picked
    where queue.id = picked.id
    returning queue.*
  )
  select claimed.id,
         claimed.participant_id,
         claimed.participant_key,
         claimed.display_name,
         claimed.profile_url,
         claimed.lease_token,
         claimed.attempt_count
  from claimed
  order by claimed.participant_key;
end;
$$;
revoke all on function public.admin_claim_badge_sync_fetch_batch(uuid, integer, integer) from public, anon;
grant execute on function public.admin_claim_badge_sync_fetch_batch(uuid, integer, integer) to authenticated;

-- ------------------------------------------------------------------
-- Finish one claimed item.
--
--   staged  -> observation (complete/incomplete/failed) was written
--   failed  -> processed, but no trustworthy observation could be written
--   skipped -> participant vanished or is removed
--   pending -> retry later; the lease is released
-- ------------------------------------------------------------------
create or replace function public.admin_finish_badge_sync_fetch_item(
  p_run_id uuid,
  p_item_id uuid,
  p_item_claim_token uuid,
  p_item_status text,
  p_error_category text default null,
  p_retry_after_seconds integer default null
)
returns table(item_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
  v_item public.badge_sync_fetch_queue%rowtype;
  v_delay integer := greatest(1, least(3600, coalesce(p_retry_after_seconds, 60)));
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_item_status is null or p_item_status not in ('staged', 'failed', 'skipped', 'pending') then
    raise exception using errcode = '22023', message = 'Fetch item status is invalid';
  end if;
  if p_error_category is not null and length(btrim(p_error_category)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Fetch error category must be 1 to 120 characters';
  end if;

  select runs.* into v_run
  from public.badge_sync_runs as runs
  where runs.id = p_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  select queue.* into v_item
  from public.badge_sync_fetch_queue as queue
  where queue.id = p_item_id
    and queue.run_id = p_run_id
  for update;
  if not found then
    item_status := 'stale';
    return next;
    return;
  end if;
  if v_item.status <> 'claimed'
    or v_item.lease_token is distinct from p_item_claim_token
    or v_item.lease_expires_at is null
    or v_item.lease_expires_at < now() then
    item_status := 'stale';
    return next;
    return;
  end if;

  if p_item_status = 'pending' then
    update public.badge_sync_fetch_queue as queue
    set status = 'pending',
        lease_token = null,
        lease_expires_at = null,
        error_category = nullif(btrim(p_error_category), ''),
        retry_after = now() + make_interval(secs => v_delay)
    where queue.id = v_item.id;
    item_status := 'pending';
    return next;
    return;
  end if;

  update public.badge_sync_fetch_queue as queue
  set status = p_item_status,
      lease_token = null,
      lease_expires_at = null,
      error_category = nullif(btrim(p_error_category), ''),
      retry_after = null,
      completed_at = now()
  where queue.id = v_item.id;
  item_status := p_item_status;
  return next;
end;
$$;
revoke all on function public.admin_finish_badge_sync_fetch_item(uuid, uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.admin_finish_badge_sync_fetch_item(uuid, uuid, uuid, text, text, integer) to authenticated;

-- ------------------------------------------------------------------
-- Pause / resume. A pause survives invocations and is cleared explicitly.
-- ------------------------------------------------------------------
create or replace function public.admin_set_badge_sync_fetch_pause(
  p_run_id uuid,
  p_paused boolean,
  p_reason text default null
)
returns table(paused boolean, pause_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_paused is null then
    raise exception using errcode = '22023', message = 'Pause state is required';
  end if;
  if p_paused and (p_reason is null or length(btrim(p_reason)) not between 1 and 500) then
    raise exception using errcode = '22023', message = 'A pause reason of 1 to 500 characters is required';
  end if;

  select runs.* into v_run
  from public.badge_sync_runs as runs
  where runs.id = p_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  update public.badge_sync_runs as runs
  set fetch_paused_at = case when p_paused then now() else null end,
      fetch_pause_reason = case when p_paused then btrim(p_reason) else null end
  where runs.id = p_run_id;

  -- An explicit resume also clears retry backoff so the next claim can run
  -- immediately instead of waiting out a rate-limit delay.
  if not p_paused then
    update public.badge_sync_fetch_queue as queue
    set retry_after = null
    where queue.run_id = p_run_id
      and queue.status = 'pending';
  end if;

  paused := p_paused;
  pause_reason := case when p_paused then btrim(p_reason) else null end;
  return next;
end;
$$;
revoke all on function public.admin_set_badge_sync_fetch_pause(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_badge_sync_fetch_pause(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------------
-- Progress for the client loop.
-- ------------------------------------------------------------------
create or replace function public.admin_badge_sync_progress(p_run_id uuid)
returns table(
  run_id uuid,
  run_status text,
  total integer,
  processed integer,
  remaining integer,
  pending_count integer,
  claimed_count integer,
  staged_count integer,
  failed_count integer,
  skipped_count integer,
  complete boolean,
  paused boolean,
  pause_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;

  select runs.* into v_run
  from public.badge_sync_runs as runs
  where runs.id = p_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  run_id := v_run.id;
  run_status := v_run.status;
  paused := v_run.fetch_paused_at is not null;
  pause_reason := v_run.fetch_pause_reason;

  select
    count(*)::integer,
    count(*) filter (where queue.status in ('staged', 'failed', 'skipped'))::integer,
    count(*) filter (where queue.status in ('pending', 'claimed'))::integer,
    count(*) filter (where queue.status = 'pending')::integer,
    count(*) filter (where queue.status = 'claimed')::integer,
    count(*) filter (where queue.status = 'staged')::integer,
    count(*) filter (where queue.status = 'failed')::integer,
    count(*) filter (where queue.status = 'skipped')::integer
  into total, processed, remaining, pending_count, claimed_count, staged_count,
       failed_count, skipped_count
  from public.badge_sync_fetch_queue as queue
  where queue.run_id = p_run_id;

  complete := total > 0 and remaining = 0;
  return next;
end;
$$;
revoke all on function public.admin_badge_sync_progress(uuid) from public, anon;
grant execute on function public.admin_badge_sync_progress(uuid) to authenticated;

-- ------------------------------------------------------------------
-- Prepare staging for approval and (re)preview.
--
-- Catalog classifications made after a preview must be aligned into the staged
-- badge rows before bulk approval. Preview locks badge decisions, so this RPC
-- clears the previous preview (never an applied run), recomputes categories
-- from the managed catalog, and leaves the run `staged` for the caller to
-- approve and preview again. Apply always needs the new fingerprint.
-- ------------------------------------------------------------------
create or replace function public.admin_prepare_badge_sync_staging(p_run_id uuid)
returns table(prepared boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.badge_sync_runs%rowtype;
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
  if v_run.status not in ('staged', 'previewed') then
    raise exception using errcode = '22023', message = 'Only a staged or previewed run can be prepared';
  end if;

  if v_run.status = 'previewed' then
    update public.badge_sync_runs as runs
    set status = 'staged',
        preview_fingerprint = null,
        previewed_at = null,
        approved_at = null,
        approved_by = null
    where runs.id = p_run_id;
  end if;

  perform private.badge_sync_recompute(p_run_id);

  prepared := true;
  return next;
end;
$$;
revoke all on function public.admin_prepare_badge_sync_staging(uuid) from public, anon;
grant execute on function public.admin_prepare_badge_sync_staging(uuid) to authenticated;

-- ------------------------------------------------------------------
-- Completeness guard for bridge-created runs.
--
-- The original preview function accepts any staged subset. A live-run could
-- therefore be previewed while some active participants were never fetched,
-- silently leaving their previous counts untouched. Runs that own a fetch queue
-- must now prove every active participant is staged and no work remains.
--
-- Manually staged runs (no queue rows) keep the original behaviour.
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

  if v_run.mode = 'badge_observations'
    and exists (
      select 1 from public.badge_sync_fetch_queue as queue
      where queue.run_id = p_run_id
    ) then
    if exists (
      select 1 from public.badge_sync_fetch_queue as queue
      where queue.run_id = p_run_id
        and queue.status in ('pending', 'claimed')
    ) then
      raise exception using
        errcode = '22023',
        message = 'Badge sync fetch is incomplete: remaining participants must be processed before preview';
    end if;
    if exists (
      select 1
      from public.participants as participant
      where participant.registration_status <> 'removed'
        and not exists (
          select 1 from public.badge_sync_participant_staging as staging
          where staging.run_id = p_run_id
            and staging.participant_id = participant.id
        )
    ) then
      raise exception using
        errcode = '22023',
        message = 'Badge sync run is incomplete: every active participant must be staged before preview';
    end if;
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
