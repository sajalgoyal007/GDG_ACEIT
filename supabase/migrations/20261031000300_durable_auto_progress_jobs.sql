-- Durable, resumable automatic-progress jobs. These records are isolated from
-- manually verified participant data and can only be mutated by service RPCs.

create table public.participant_auto_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(btrim(dedupe_key)) between 1 and 160),
  trigger_source text not null check (trigger_source in ('admin', 'scheduled')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial')),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  total_count integer not null default 0 check (total_count >= 0),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  validated_count integer not null default 0 check (validated_count >= 0),
  saved_count integer not null default 0 check (saved_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  active_lock_token uuid,
  lease_expires_at timestamptz,
  error_category text,
  constraint participant_auto_refresh_job_lease_shape check (
    (active_lock_token is null and lease_expires_at is null)
    or (active_lock_token is not null and lease_expires_at is not null)
  ),
  constraint participant_auto_refresh_job_counts_shape check (
    fetched_count <= total_count and validated_count <= fetched_count
    and saved_count + unchanged_count + failed_count + skipped_count <= total_count
  )
);
create index participant_auto_refresh_jobs_recent_idx
  on public.participant_auto_refresh_jobs (created_at desc);
create unique index participant_auto_refresh_jobs_one_active_idx
  on public.participant_auto_refresh_jobs ((true)) where status in ('queued', 'running');

create table public.participant_auto_refresh_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.participant_auto_refresh_jobs(id) on delete cascade,
  participant_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'saved', 'unchanged', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  fetched boolean not null default false,
  validated boolean not null default false,
  claim_token uuid,
  claim_expires_at timestamptz,
  error_category text check (error_category is null or error_category ~ '^[a-z0-9_]{1,80}$'),
  next_attempt_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint participant_auto_refresh_job_item_unique unique (job_id, participant_id),
  constraint participant_auto_refresh_job_item_claim_shape check (
    (status = 'processing' and claim_token is not null and claim_expires_at is not null)
    or (status <> 'processing' and claim_token is null and claim_expires_at is null)
  ),
  constraint participant_auto_refresh_job_item_validation_shape check (not validated or fetched)
);
create index participant_auto_refresh_job_items_claim_idx
  on public.participant_auto_refresh_job_items (job_id, status, participant_id);
create index participant_auto_refresh_job_items_expiry_idx
  on public.participant_auto_refresh_job_items (claim_expires_at) where status = 'processing';

alter table public.participant_auto_refresh_jobs enable row level security;
alter table public.participant_auto_refresh_job_items enable row level security;
revoke all on table public.participant_auto_refresh_jobs from public, anon, authenticated, service_role;
revoke all on table public.participant_auto_refresh_job_items from public, anon, authenticated, service_role;

create function private.refresh_auto_progress_job_counts(p_job_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
begin
  update public.participant_auto_refresh_jobs j
  set total_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id),
      fetched_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.fetched),
      validated_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.validated),
      saved_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.status = 'saved'),
      unchanged_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.status = 'unchanged'),
      failed_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.status = 'failed'),
      skipped_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.status = 'skipped'),
      error_category = (select min(i.error_category) from public.participant_auto_refresh_job_items i where i.job_id = p_job_id and i.status in ('failed', 'skipped')),
      status = case when exists (
        select 1 from public.participant_auto_refresh_job_items i
        where i.job_id = p_job_id and i.status in ('pending', 'processing')
      ) then 'running'
      when exists (
        select 1 from public.participant_auto_refresh_job_items i
        where i.job_id = p_job_id and i.status in ('failed', 'skipped')
      ) then 'partial' else 'completed' end,
      completed_at = case when exists (
        select 1 from public.participant_auto_refresh_job_items i
        where i.job_id = p_job_id and i.status in ('pending', 'processing')
      ) then null else coalesce(j.completed_at, p_now) end,
      active_lock_token = case when exists (
        select 1 from public.participant_auto_refresh_job_items i
        where i.job_id = p_job_id and i.status in ('pending', 'processing')
      ) then j.active_lock_token else null end,
      lease_expires_at = case when exists (
        select 1 from public.participant_auto_refresh_job_items i
        where i.job_id = p_job_id and i.status in ('pending', 'processing')
      ) then j.lease_expires_at else null end
  where j.id = p_job_id;
end;
$$;
revoke all on function private.refresh_auto_progress_job_counts(uuid, timestamptz) from public, anon, authenticated, service_role;

create function public.start_or_resume_participant_auto_refresh_job(
  p_lock_token uuid,
  p_trigger_source text,
  p_dedupe_key text
)
returns table(job_status text, job_id uuid, total_count integer, fetched_count integer,
  validated_count integer, saved_count integer, unchanged_count integer,
  failed_count integer, skipped_count integer, is_complete boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job public.participant_auto_refresh_jobs%rowtype;
  v_lock public.participant_auto_refresh_job_lock%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_lock_token is null or p_trigger_source is null or p_trigger_source not in ('admin', 'scheduled')
    or p_dedupe_key is null or length(btrim(p_dedupe_key)) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Refresh job arguments are invalid';
  end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then
    return query select 'stale_lease'::text, null::uuid, 0, 0, 0, 0, 0, 0, 0, false;
    return;
  end if;

  select j.* into v_job from public.participant_auto_refresh_jobs j
  where j.status in ('queued', 'running') order by j.created_at limit 1 for update;
  if not found then
    select j.* into v_job from public.participant_auto_refresh_jobs j
    where j.dedupe_key = p_dedupe_key for update;
  end if;
  if not found then
    insert into public.participant_auto_refresh_jobs (dedupe_key, trigger_source, status, started_at, active_lock_token, lease_expires_at)
    values (p_dedupe_key, p_trigger_source, 'running', v_now, p_lock_token, v_lock.lease_expires_at)
    returning * into v_job;
    insert into public.participant_auto_refresh_job_items (job_id, participant_id)
    select v_job.id, p.id from public.participants p
    where p.registration_status = 'registered'
    order by p.id;
    update public.participant_auto_refresh_jobs j
    set total_count = (select count(*)::integer from public.participant_auto_refresh_job_items i where i.job_id = v_job.id)
    where j.id = v_job.id returning * into v_job;
    perform private.refresh_auto_progress_job_counts(v_job.id, v_now);
    select j.* into v_job from public.participant_auto_refresh_jobs j where j.id = v_job.id;
  elsif v_job.status in ('queued', 'running') then
    update public.participant_auto_refresh_job_items i
    set status = 'pending', claim_token = null, claim_expires_at = null,
        error_category = null, updated_at = v_now
    where i.job_id = v_job.id and i.status = 'processing' and i.claim_expires_at <= v_now;
    update public.participant_auto_refresh_jobs j
    set status = 'running', started_at = coalesce(j.started_at, v_now),
        active_lock_token = p_lock_token, lease_expires_at = v_lock.lease_expires_at
    where j.id = v_job.id returning * into v_job;
  end if;
  return query select v_job.status, v_job.id, v_job.total_count, v_job.fetched_count,
    v_job.validated_count, v_job.saved_count, v_job.unchanged_count,
    v_job.failed_count, v_job.skipped_count, v_job.status in ('completed', 'partial');
end;
$$;
revoke all on function public.start_or_resume_participant_auto_refresh_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_or_resume_participant_auto_refresh_job(uuid, text, text) to service_role;

create function public.claim_participant_auto_refresh_job_batch(
  p_job_id uuid, p_lock_token uuid, p_batch_size integer default 8, p_item_lease_seconds integer default 120
)
returns table(item_id uuid, participant_id uuid, item_claim_token uuid, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lock public.participant_auto_refresh_job_lock%rowtype;
  v_job public.participant_auto_refresh_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_job_id is null or p_lock_token is null or p_batch_size not between 1 and 12
    or p_item_lease_seconds not between 5 and 180 then
    raise exception using errcode = '22023', message = 'Refresh job batch arguments are invalid';
  end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then
    return;
  end if;
  select j.* into v_job from public.participant_auto_refresh_jobs j
  where j.id = p_job_id for update;
  if not found or v_job.status not in ('queued', 'running') then return; end if;
  if v_job.active_lock_token is distinct from p_lock_token then return; end if;

  update public.participant_auto_refresh_job_items i
  set status = 'pending', claim_token = null, claim_expires_at = null,
      error_category = null, updated_at = v_now
  where i.job_id = p_job_id and i.status = 'processing' and i.claim_expires_at <= v_now;

  return query
  with candidates as (
    select i.id from public.participant_auto_refresh_job_items i
    where i.job_id = p_job_id and i.status = 'pending' and i.next_attempt_at <= v_now
    order by i.participant_id
    limit p_batch_size
    for update skip locked
  ), claimed as (
    update public.participant_auto_refresh_job_items i
    set status = 'processing', claim_token = gen_random_uuid(),
        claim_expires_at = least(v_lock.lease_expires_at, v_now + make_interval(secs => p_item_lease_seconds)),
        attempt_count = i.attempt_count + 1, updated_at = v_now
    from candidates c where i.id = c.id
    returning i.id, i.participant_id, i.claim_token, i.attempt_count
  )
  select c.id, c.participant_id, c.claim_token, c.attempt_count from claimed c order by c.participant_id;
end;
$$;
revoke all on function public.claim_participant_auto_refresh_job_batch(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_participant_auto_refresh_job_batch(uuid, uuid, integer, integer) to service_role;

create function public.finish_participant_auto_refresh_job_item(
  p_job_id uuid, p_lock_token uuid, p_item_id uuid, p_item_claim_token uuid,
  p_item_status text, p_error_category text default null, p_retry_after_seconds integer default null
)
returns table(item_status text, job_status text, total_count integer, fetched_count integer,
  validated_count integer, saved_count integer, unchanged_count integer, failed_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lock public.participant_auto_refresh_job_lock%rowtype;
  v_item public.participant_auto_refresh_job_items%rowtype;
  v_job public.participant_auto_refresh_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_job_id is null or p_lock_token is null or p_item_id is null or p_item_claim_token is null
    or p_item_status is null or p_item_status not in ('failed', 'skipped', 'pending')
    or p_error_category is not null and p_error_category !~ '^[a-z0-9_]{1,80}$'
    or (p_item_status = 'pending' and p_retry_after_seconds not between 1 and 3600)
    or (p_item_status <> 'pending' and p_retry_after_seconds is not null) then
    raise exception using errcode = '22023', message = 'Refresh item result is invalid';
  end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then
    return query select 'stale_lease'::text, 'running'::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  select j.* into v_job from public.participant_auto_refresh_jobs j where j.id = p_job_id for update;
  if not found or v_job.status not in ('queued', 'running') or v_job.active_lock_token is distinct from p_lock_token then
    return query select 'stale_job'::text, coalesce(v_job.status, 'running'), 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  update public.participant_auto_refresh_job_items i
  set status = p_item_status, error_category = p_error_category,
      next_attempt_at = case when p_item_status = 'pending' then v_now + make_interval(secs => p_retry_after_seconds) else v_now end,
      claim_token = null, claim_expires_at = null, updated_at = v_now
  where i.id = p_item_id and i.job_id = p_job_id and i.status = 'processing'
    and i.claim_token = p_item_claim_token and i.claim_expires_at > v_now;
  if not found then
    return query select 'stale_item'::text, 'running'::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  perform private.refresh_auto_progress_job_counts(p_job_id, v_now);
  select j.* into v_job from public.participant_auto_refresh_jobs j where j.id = p_job_id;
  return query select p_item_status, v_job.status, v_job.total_count, v_job.fetched_count,
    v_job.validated_count, v_job.saved_count, v_job.unchanged_count, v_job.failed_count, v_job.skipped_count;
end;
$$;
revoke all on function public.finish_participant_auto_refresh_job_item(uuid, uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.finish_participant_auto_refresh_job_item(uuid, uuid, uuid, uuid, text, text, integer) to service_role;

create function public.record_participant_auto_refresh_job_result(
  p_job_id uuid, p_lock_token uuid, p_item_id uuid, p_item_claim_token uuid,
  p_participant_id uuid, p_profile_url text, p_fetch_claim_token uuid, p_profile_revision bigint,
  p_fetch_status text, p_badges jsonb, p_snapshot_id text, p_parser_version text,
  p_error_category text, p_fetched boolean, p_validated boolean, p_retry_after_seconds integer default null
)
returns table(result_status text, eligible_badge_count integer, finish_rank integer,
  item_status text, job_status text, total_count integer, fetched_count integer,
  validated_count integer, saved_count integer, unchanged_count integer, failed_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lock public.participant_auto_refresh_job_lock%rowtype;
  v_job public.participant_auto_refresh_jobs%rowtype;
  v_item public.participant_auto_refresh_job_items%rowtype;
  v_previous_snapshot text;
  v_result record;
  v_item_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_validated and not p_fetched then
    raise exception using errcode = '22023', message = 'A validated result must have been fetched';
  end if;
  if p_retry_after_seconds is not null and p_retry_after_seconds not between 1 and 3600 then
    raise exception using errcode = '22023', message = 'Retry delay is invalid';
  end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then
    return query select 'stale_job'::text, null::integer, null::integer, 'skipped'::text, 'running'::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  select j.* into v_job from public.participant_auto_refresh_jobs j where j.id = p_job_id for update;
  if not found or v_job.status not in ('queued', 'running') or v_job.active_lock_token is distinct from p_lock_token then
    return query select 'stale_job'::text, null::integer, null::integer, 'skipped'::text, 'running'::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  select i.* into v_item from public.participant_auto_refresh_job_items i
  where i.id = p_item_id and i.job_id = p_job_id for update;
  if not found or v_item.status <> 'processing' or v_item.participant_id <> p_participant_id
    or v_item.claim_token is distinct from p_item_claim_token or v_item.claim_expires_at <= v_now then
    return query select 'stale_item'::text, null::integer, null::integer, 'skipped'::text, v_job.status,
      v_job.total_count, v_job.fetched_count, v_job.validated_count, v_job.saved_count,
      v_job.unchanged_count, v_job.failed_count, v_job.skipped_count;
    return;
  end if;
  select ap.snapshot_id into v_previous_snapshot
  from public.participant_auto_progress ap where ap.participant_id = p_participant_id for update;

  select * into v_result from public.record_participant_auto_fetch(
    p_participant_id, p_profile_url, p_fetch_claim_token, p_profile_revision,
    p_fetch_status, p_badges, p_snapshot_id, p_parser_version, p_error_category
  );
  if v_result.result_status = 'ok' then
    v_item_status := case when v_previous_snapshot is not distinct from p_snapshot_id then 'unchanged' else 'saved' end;
  elsif v_result.result_status in ('stale_claim', 'duplicate_profile') then
    v_item_status := 'skipped';
  elsif v_result.result_status in ('timeout', 'upstream_error', 'rate_limited') and v_item.attempt_count < 3 then
    v_item_status := 'pending';
  else
    v_item_status := 'failed';
  end if;
  update public.participant_auto_refresh_job_items i
  set status = v_item_status, fetched = p_fetched, validated = p_validated,
      error_category = case when v_item_status in ('failed', 'skipped', 'pending') then coalesce(p_error_category, v_result.result_status) else null end,
      next_attempt_at = case when v_item_status = 'pending' then v_now + make_interval(secs => coalesce(p_retry_after_seconds, case when v_result.result_status = 'rate_limited' then 60 else 15 end)) else v_now end,
      claim_token = null, claim_expires_at = null, updated_at = v_now
  where i.id = p_item_id;
  perform private.refresh_auto_progress_job_counts(p_job_id, v_now);
  select j.* into v_job from public.participant_auto_refresh_jobs j where j.id = p_job_id;
  return query select v_result.result_status, v_result.eligible_badge_count, v_result.finish_rank,
    v_item_status, v_job.status, v_job.total_count, v_job.fetched_count, v_job.validated_count,
    v_job.saved_count, v_job.unchanged_count, v_job.failed_count, v_job.skipped_count;
end;
$$;
revoke all on function public.record_participant_auto_refresh_job_result(uuid, uuid, uuid, uuid, uuid, text, uuid, bigint, text, jsonb, text, text, text, boolean, boolean, integer) from public, anon, authenticated;
grant execute on function public.record_participant_auto_refresh_job_result(uuid, uuid, uuid, uuid, uuid, text, uuid, bigint, text, jsonb, text, text, text, boolean, boolean, integer) to service_role;

-- Keep the job's lease metadata consistent with the existing global lease RPCs.
create or replace function public.renew_participant_auto_refresh_job(p_lock_token uuid, p_lease_seconds integer default 300)
returns table(job_status text, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expiry timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_lock_token is null or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception using errcode = '22023', message = 'Refresh job lease arguments are invalid';
  end if;
  update public.participant_auto_refresh_job_lock l
  set lease_expires_at = v_now + make_interval(secs => p_lease_seconds)
  where l.singleton and l.lock_token = p_lock_token and l.lease_expires_at > v_now
  returning l.lease_expires_at into v_expiry;
  if not found then
    return query select 'stale'::text, null::timestamptz;
    return;
  end if;
  update public.participant_auto_refresh_jobs j
  set lease_expires_at = v_expiry
  where j.active_lock_token = p_lock_token and j.status in ('queued', 'running');
  return query select 'renewed'::text, v_expiry;
end;
$$;
revoke all on function public.renew_participant_auto_refresh_job(uuid, integer) from public, anon, authenticated;
grant execute on function public.renew_participant_auto_refresh_job(uuid, integer) to service_role;

create or replace function public.release_participant_auto_refresh_job(p_lock_token uuid)
returns table(job_status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_lock_token is null then
    return query select 'stale'::text;
    return;
  end if;
  update public.participant_auto_refresh_jobs j
  set active_lock_token = null, lease_expires_at = null
  where j.active_lock_token = p_lock_token and j.status in ('queued', 'running');
  update public.participant_auto_refresh_job_lock l
  set lock_token = null, lease_expires_at = null
  where l.singleton and l.lock_token = p_lock_token;
  if not found then
    return query select 'stale'::text;
    return;
  end if;
  return query select 'released'::text;
end;
$$;
revoke all on function public.release_participant_auto_refresh_job(uuid) from public, anon, authenticated;
grant execute on function public.release_participant_auto_refresh_job(uuid) to service_role;
