-- Serialize administrator-triggered Refresh All jobs across application instances.
-- This lock is separate from participant claim tokens and does not mutate badge data.
create table public.participant_auto_refresh_job_lock (
  singleton boolean primary key default true check (singleton),
  lock_token uuid,
  lease_expires_at timestamptz,
  constraint participant_auto_refresh_job_lock_shape check (
    (lock_token is null and lease_expires_at is null)
    or (lock_token is not null and lease_expires_at is not null)
  )
);
insert into public.participant_auto_refresh_job_lock (singleton) values (true);
alter table public.participant_auto_refresh_job_lock enable row level security;
revoke all on table public.participant_auto_refresh_job_lock from public, anon, authenticated, service_role;

create function public.claim_participant_auto_refresh_job(p_lease_seconds integer default 300)
returns table(job_status text, lock_token uuid, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock public.participant_auto_refresh_job_lock%rowtype;
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception using errcode = '22023', message = 'Refresh job lease must be from 30 to 300 seconds';
  end if;
  select l.* into v_lock
  from public.participant_auto_refresh_job_lock l
  where l.singleton
  for update;
  if v_lock.lock_token is not null and v_lock.lease_expires_at > v_now then
    return query select 'busy'::text, null::uuid, v_lock.lease_expires_at;
    return;
  end if;
  update public.participant_auto_refresh_job_lock l
  set lock_token = v_token,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds)
  where l.singleton;
  return query select 'claimed'::text, v_token, v_now + make_interval(secs => p_lease_seconds);
end;
$$;
revoke all on function public.claim_participant_auto_refresh_job(integer) from public, anon, authenticated;
grant execute on function public.claim_participant_auto_refresh_job(integer) to service_role;

create function public.renew_participant_auto_refresh_job(p_lock_token uuid, p_lease_seconds integer default 300)
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
  return query select 'renewed'::text, v_expiry;
end;
$$;
revoke all on function public.renew_participant_auto_refresh_job(uuid, integer) from public, anon, authenticated;
grant execute on function public.renew_participant_auto_refresh_job(uuid, integer) to service_role;

create function public.release_participant_auto_refresh_job(p_lock_token uuid)
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
