-- Durable administrator-triggered refresh jobs for explicitly unverified
-- public-profile observations. These tables never write verified counts.
create table public.participant_progress_observation_jobs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(btrim(dedupe_key)) between 1 and 160),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'running' check (status in ('running', 'completed', 'partial')),
  total_count integer not null default 0 check (total_count >= 0),
  observed_count integer not null default 0 check (observed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  active_lock_token uuid,
  lease_expires_at timestamptz,
  constraint progress_observation_job_lease_shape check (
    (active_lock_token is null and lease_expires_at is null)
    or (active_lock_token is not null and lease_expires_at is not null)
  ),
  constraint progress_observation_job_counts_shape check (
    observed_count + failed_count + skipped_count <= total_count
  )
);
create unique index progress_observation_jobs_one_active_idx
  on public.participant_progress_observation_jobs ((true)) where status = 'running';

create table public.participant_progress_observation_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.participant_progress_observation_jobs(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'processing', 'observed', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  error_category text check (error_category is null or error_category ~ '^[a-z0-9_]{1,80}$'),
  updated_at timestamptz not null default clock_timestamp(),
  unique (job_id, participant_id),
  constraint progress_observation_item_claim_shape check (
    (status = 'processing' and claim_token is not null and claim_expires_at is not null)
    or (status <> 'processing' and claim_token is null and claim_expires_at is null)
  )
);
create index progress_observation_item_claim_idx
  on public.participant_progress_observation_job_items (job_id, status, next_attempt_at, participant_id);
create table public.participant_progress_observation_cooldowns (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  next_allowed_at timestamptz not null default '-infinity'::timestamptz
);
alter table public.participant_progress_observation_cooldowns enable row level security;
revoke all on public.participant_progress_observation_cooldowns from public, anon, authenticated, service_role;
alter table public.participant_progress_observation_jobs enable row level security;
alter table public.participant_progress_observation_job_items enable row level security;
revoke all on public.participant_progress_observation_jobs, public.participant_progress_observation_job_items
  from public, anon, authenticated, service_role;

create function private.refresh_progress_observation_job_counts(p_job_id uuid, p_now timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.participant_progress_observation_jobs j
  set total_count = (select count(*)::integer from public.participant_progress_observation_job_items i where i.job_id = p_job_id),
      observed_count = (select count(*)::integer from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status = 'observed'),
      failed_count = (select count(*)::integer from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status = 'failed'),
      skipped_count = (select count(*)::integer from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status = 'skipped'),
      status = case when exists (select 1 from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status in ('pending', 'processing')) then 'running'
        when exists (select 1 from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status in ('failed', 'skipped')) then 'partial' else 'completed' end,
      completed_at = case when exists (select 1 from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status in ('pending', 'processing')) then null else coalesce(j.completed_at, p_now) end,
      active_lock_token = case when exists (select 1 from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status in ('pending', 'processing')) then j.active_lock_token else null end,
      lease_expires_at = case when exists (select 1 from public.participant_progress_observation_job_items i where i.job_id = p_job_id and i.status in ('pending', 'processing')) then j.lease_expires_at else null end
  where j.id = p_job_id;
end;
$$;
revoke all on function private.refresh_progress_observation_job_counts(uuid, timestamptz) from public, anon, authenticated, service_role;

create function public.start_or_resume_progress_observation_job(p_lock_token uuid, p_actor_user_id uuid, p_dedupe_key text)
returns table(job_id uuid, job_status text, total_count integer, observed_count integer, failed_count integer, skipped_count integer, is_complete boolean)
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_lock public.participant_auto_refresh_job_lock%rowtype; v_job public.participant_progress_observation_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception using errcode = '42501', message = 'Worker access required'; end if;
  if p_lock_token is null or p_actor_user_id is null or coalesce(p_dedupe_key, '') !~ '^admin:[0-9a-f-]{36}:[0-9a-f-]{36}$' then raise exception using errcode = '22023', message = 'Job arguments are invalid'; end if;
  if not exists (select 1 from public.admin_users a where a.user_id = p_actor_user_id) then raise exception using errcode = '42501', message = 'Administrator required'; end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then
    return query select null::uuid, 'stale_lease'::text, 0, 0, 0, 0, false; return;
  end if;
  select j.* into v_job from public.participant_progress_observation_jobs j where j.status = 'running' for update;
  if found then
    if v_job.actor_user_id <> p_actor_user_id then return query select null::uuid, 'busy'::text, 0, 0, 0, 0, false; return; end if;
    update public.participant_progress_observation_job_items i set status = 'pending', claim_token = null, claim_expires_at = null, updated_at = v_now
      where i.job_id = v_job.id and i.status = 'processing' and i.claim_expires_at <= v_now;
    update public.participant_progress_observation_jobs j set active_lock_token = p_lock_token, lease_expires_at = v_lock.lease_expires_at where j.id = v_job.id returning * into v_job;
  else
    select j.* into v_job from public.participant_progress_observation_jobs j where j.dedupe_key = p_dedupe_key for update;
    if found then
      return query select v_job.id, v_job.status, v_job.total_count, v_job.observed_count, v_job.failed_count, v_job.skipped_count, v_job.status <> 'running'; return;
    end if;
    insert into public.participant_progress_observation_jobs(dedupe_key, actor_user_id, active_lock_token, lease_expires_at)
      values (p_dedupe_key, p_actor_user_id, p_lock_token, v_lock.lease_expires_at) returning * into v_job;
    insert into public.participant_progress_observation_job_items(job_id, participant_id)
      select v_job.id, p.id from public.participants p where p.registration_status = 'registered' order by p.id;
    insert into public.participant_progress_observation_cooldowns(participant_id)
      select p.id from public.participants p where p.registration_status = 'registered' on conflict (participant_id) do nothing;
  end if;
  perform private.refresh_progress_observation_job_counts(v_job.id, v_now);
  select j.* into v_job from public.participant_progress_observation_jobs j where j.id = v_job.id;
  return query select v_job.id, v_job.status, v_job.total_count, v_job.observed_count, v_job.failed_count, v_job.skipped_count, v_job.status <> 'running';
end;
$$;
revoke all on function public.start_or_resume_progress_observation_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_or_resume_progress_observation_job(uuid, uuid, text) to service_role;

create function public.claim_progress_observation_batch(p_job_id uuid, p_lock_token uuid, p_batch_size integer default 8)
returns table(item_id uuid, participant_id uuid, item_claim_token uuid, attempt_count integer)
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_lock public.participant_auto_refresh_job_lock%rowtype; v_job public.participant_progress_observation_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception using errcode = '42501', message = 'Worker access required'; end if;
  if p_job_id is null or p_lock_token is null or p_batch_size not between 1 and 12 then raise exception using errcode = '22023', message = 'Batch arguments are invalid'; end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then return; end if;
  select j.* into v_job from public.participant_progress_observation_jobs j where j.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.active_lock_token is distinct from p_lock_token then return; end if;
  update public.participant_progress_observation_job_items i set status = 'pending', claim_token = null, claim_expires_at = null, updated_at = v_now
    where i.job_id = p_job_id and i.status = 'processing' and i.claim_expires_at <= v_now;
  return query with candidates as (
    select i.id, i.participant_id from public.participant_progress_observation_job_items i
      join public.participant_progress_observation_cooldowns c on c.participant_id = i.participant_id
      where i.job_id = p_job_id and i.status = 'pending' and i.next_attempt_at <= v_now and c.next_allowed_at <= v_now
      order by i.participant_id limit p_batch_size for update of i, c skip locked
  ), claimed as (
    update public.participant_progress_observation_job_items i set status = 'processing', claim_token = gen_random_uuid(),
      claim_expires_at = least(v_lock.lease_expires_at, v_now + interval '120 seconds'), attempt_count = i.attempt_count + 1, updated_at = v_now
      from candidates c where i.id = c.id returning i.id, i.participant_id, i.claim_token, i.attempt_count
  ), cooled as (
    update public.participant_progress_observation_cooldowns c set next_allowed_at = v_now + interval '60 seconds'
      from claimed i where c.participant_id = i.participant_id returning c.participant_id
  ) select i.id, i.participant_id, i.claim_token, i.attempt_count from claimed i join cooled c on c.participant_id = i.participant_id order by i.participant_id;
end;
$$;
revoke all on function public.claim_progress_observation_batch(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_progress_observation_batch(uuid, uuid, integer) to service_role;

create function public.claim_google_skills_observation_cooldown(p_participant_key text, p_profile_url text)
returns table(claim_status text, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_actor uuid := auth.uid(); v_participant public.participants%rowtype; v_norm text; v_until timestamptz;
begin
  if not private.is_admin() or v_actor is null then raise exception using errcode = '42501', message = 'Admin access required'; end if;
  if coalesce(p_participant_key, '') !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
    or coalesce(p_profile_url, '') !~* '^https://(www\.)?(skills\.google|cloudskillsboost\.google)/public_profiles/[A-Za-z0-9_-]+/?$' then
    raise exception using errcode = '22023', message = 'Profile arguments are invalid';
  end if;
  select p.* into v_participant from public.participants p where p.participant_key = p_participant_key and p.registration_status = 'registered' for update;
  if not found then return query select 'profile_changed'::text, 0; return; end if;
  v_norm := private.normalize_auto_profile_url(p_profile_url);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_norm, 0));
  if private.normalize_auto_profile_url(v_participant.profile_url) is distinct from v_norm or
    (select count(*) from public.participants p where p.registration_status='registered' and private.normalize_auto_profile_url(p.profile_url)=v_norm) <> 1 then
    return query select 'profile_changed'::text, 0; return;
  end if;
  insert into public.participant_progress_observation_cooldowns(participant_id) values (v_participant.id) on conflict (participant_id) do nothing;
  select c.next_allowed_at into v_until from public.participant_progress_observation_cooldowns c where c.participant_id = v_participant.id for update;
  if v_until > v_now then return query select 'cooldown'::text, greatest(1, ceil(extract(epoch from (v_until - v_now)))::integer); return; end if;
  update public.participant_progress_observation_cooldowns c set next_allowed_at = v_now + interval '60 seconds' where c.participant_id = v_participant.id;
  return query select 'claimed'::text, 0;
end;
$$;
revoke all on function public.claim_google_skills_observation_cooldown(text, text) from public, anon;
grant execute on function public.claim_google_skills_observation_cooldown(text, text) to authenticated;

create function public.finish_progress_observation_item(
  p_job_id uuid, p_lock_token uuid, p_item_id uuid, p_item_claim_token uuid, p_actor_user_id uuid,
  p_status text, p_error_category text, p_retry_after_seconds integer default null,
  p_participant_key text default null, p_profile_url text default null, p_profile_revision bigint default null,
  p_http_status integer default null, p_retrieved_at timestamptz default null, p_reported_total integer default null, p_detail_count integer default null
)
returns table(item_status text, job_status text, total_count integer, observed_count integer, failed_count integer, skipped_count integer)
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_lock public.participant_auto_refresh_job_lock%rowtype; v_job public.participant_progress_observation_jobs%rowtype; v_item public.participant_progress_observation_job_items%rowtype; v_participant public.participants%rowtype; v_norm text; v_profile_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception using errcode = '42501', message = 'Worker access required'; end if;
  if p_status is null or p_status not in ('observed','failed','skipped','pending') or p_error_category is not null and p_error_category !~ '^[a-z0-9_]{1,80}$'
    or (p_status = 'pending' and (p_retry_after_seconds is null or p_retry_after_seconds not between 1 and 3600))
    or (p_status <> 'pending' and p_retry_after_seconds is not null) then raise exception using errcode = '22023', message = 'Item result is invalid'; end if;
  if p_status = 'observed' and (p_participant_key is null or p_profile_url is null or p_profile_revision is null or p_http_status is null or p_http_status not between 200 and 299
    or p_retrieved_at is null or p_retrieved_at > v_now + interval '5 minutes' or p_reported_total is null or p_reported_total not between 1 and 10000 or p_detail_count is null or p_detail_count not between 1 and 10000 or p_reported_total <> p_detail_count
    or p_profile_url !~* '^https://(www\.)?(skills\.google|cloudskillsboost\.google)/public_profiles/[A-Za-z0-9_-]+/?$') then
    raise exception using errcode = '22023', message = 'Observation fields are invalid';
  end if;
  select l.* into v_lock from public.participant_auto_refresh_job_lock l where l.singleton for update;
  if not found or v_lock.lock_token is distinct from p_lock_token or v_lock.lease_expires_at <= v_now then return query select 'stale'::text,'running'::text,0,0,0,0; return; end if;
  select j.* into v_job from public.participant_progress_observation_jobs j where j.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.active_lock_token is distinct from p_lock_token or v_job.actor_user_id <> p_actor_user_id
    or not exists (select 1 from public.admin_users a where a.user_id = p_actor_user_id) then return query select 'stale'::text,'running'::text,0,0,0,0; return; end if;
  select i.* into v_item from public.participant_progress_observation_job_items i where i.id = p_item_id and i.job_id = p_job_id for update;
  if not found or v_item.status <> 'processing' or v_item.claim_token is distinct from p_item_claim_token or v_item.claim_expires_at <= v_now then return query select 'stale'::text,v_job.status,0,0,0,0; return; end if;
  if p_status = 'observed' then
    select p.* into v_participant from public.participants p where p.id = v_item.participant_id and p.registration_status = 'registered' for update;
    v_norm := private.normalize_auto_profile_url(p_profile_url);
    v_profile_id := (pg_catalog.regexp_match(v_norm, '/public_profiles/([A-Za-z0-9_-]+)$'))[1];
    if not found or v_profile_id is null or v_participant.participant_key <> p_participant_key or v_participant.profile_url is null
      or v_participant.auto_profile_revision <> p_profile_revision or private.normalize_auto_profile_url(v_participant.profile_url) is distinct from v_norm then
      p_status := 'skipped'; p_error_category := 'profile_changed';
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_norm, 0));
      if (select count(*) from public.participants p where p.registration_status='registered' and private.normalize_auto_profile_url(p.profile_url)=v_norm) <> 1 then
        p_status := 'skipped'; p_error_category := 'duplicate_profile';
      else
        insert into public.participant_progress_observations(participant_id, profile_id, normalized_profile_url, profile_revision, source_name, retrieved_at, http_status, reported_total, detail_count, unique_badge_count, completeness_status, summary_note, actor_user_id)
        values (v_participant.id, v_profile_id, v_norm, p_profile_revision, 'google_skills_public_html', p_retrieved_at, p_http_status, p_reported_total, p_detail_count, null, 'unverified', 'Observed rendered badge-card count; completeness remains unverified.', p_actor_user_id);
      end if;
    end if;
  end if;
  update public.participant_progress_observation_job_items i set status = p_status, error_category = p_error_category,
    next_attempt_at = case when p_status='pending' then v_now + make_interval(secs=>p_retry_after_seconds) else v_now end,
    claim_token = null, claim_expires_at = null, updated_at = v_now where i.id = p_item_id;
  perform private.refresh_progress_observation_job_counts(p_job_id, v_now);
  select j.* into v_job from public.participant_progress_observation_jobs j where j.id = p_job_id;
  return query select p_status, v_job.status, v_job.total_count, v_job.observed_count, v_job.failed_count, v_job.skipped_count;
end;
$$;
revoke all on function public.finish_progress_observation_item(uuid,uuid,uuid,uuid,uuid,text,text,integer,text,text,bigint,integer,timestamptz,integer,integer) from public, anon, authenticated;
grant execute on function public.finish_progress_observation_item(uuid,uuid,uuid,uuid,uuid,text,text,integer,text,text,bigint,integer,timestamptz,integer,integer) to service_role;
