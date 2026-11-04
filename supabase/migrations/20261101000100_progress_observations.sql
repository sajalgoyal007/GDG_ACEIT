-- Append-only diagnostic observations. These values are never verified badges,
-- automatic snapshots, rankings, or manual-verification audit events.
create table public.participant_progress_observations (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  profile_id text not null check (profile_id ~ '^[A-Za-z0-9_-]+$'),
  normalized_profile_url text not null,
  profile_revision bigint not null check (profile_revision > 0),
  source_name text not null check (source_name in ('arcadecalc_frontend', 'google_skills_public_html')),
  retrieved_at timestamptz not null,
  http_status integer not null check (http_status between 100 and 599),
  reported_total integer check (reported_total between 0 and 10000),
  detail_count integer check (detail_count between 0 and 10000),
  unique_badge_count integer check (unique_badge_count between 0 and 10000),
  completeness_status text not null check (completeness_status in ('unverified', 'partial', 'failed', 'blocked')),
  identity_status text not null default 'not_independently_verified'
    check (identity_status = 'not_independently_verified'),
  summary_note text check (summary_note is null or (length(summary_note) <= 500 and summary_note !~ '[[:cntrl:]]')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint participant_progress_observation_counts_shape check (
    (completeness_status in ('failed', 'blocked')
      and reported_total is null and detail_count is null and unique_badge_count is null)
    or (completeness_status in ('unverified', 'partial')
      and http_status between 200 and 299
      and reported_total is not null and detail_count is not null
      and (unique_badge_count is null or unique_badge_count <= detail_count))
  ),
  constraint participant_progress_observation_blocked_status check (
    completeness_status <> 'blocked' or http_status in (401, 403, 429)
  )
);
create index participant_progress_observations_latest_idx
  on public.participant_progress_observations (participant_id, recorded_at desc, id desc);
create index participant_progress_observations_reported_idx
  on public.participant_progress_observations (participant_id, retrieved_at desc, id desc)
  where reported_total is not null;

alter table public.participant_progress_observations enable row level security;
revoke all on table public.participant_progress_observations from public, anon, authenticated, service_role;

create function private.is_current_progress_observation(
  p_participant_id uuid, p_profile_revision bigint, p_normalized_profile_url text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants p
    where p.id = p_participant_id
      and p.registration_status = 'registered'
      and p.auto_profile_revision = p_profile_revision
      and private.normalize_auto_profile_url(p.profile_url) = p_normalized_profile_url
      and (
        select count(*)
        from public.participants other
        where other.registration_status = 'registered'
          and private.normalize_auto_profile_url(other.profile_url) = p_normalized_profile_url
      ) = 1
  );
$$;
revoke all on function private.is_current_progress_observation(uuid, bigint, text) from public;
grant execute on function private.is_current_progress_observation(uuid, bigint, text) to anon, authenticated;

grant select (participant_id, source_name,
  retrieved_at, http_status, reported_total, detail_count, unique_badge_count,
  completeness_status, identity_status, recorded_at)
  on public.participant_progress_observations to anon;
grant select on public.participant_progress_observations to authenticated;
create policy participant_progress_observations_public_current_read
  on public.participant_progress_observations for select to anon
  using (private.is_current_progress_observation(participant_id, profile_revision, normalized_profile_url));
create policy participant_progress_observations_admin_read
  on public.participant_progress_observations for select to authenticated
  using ((select private.is_admin()));

create function public.admin_record_progress_observation(
  p_participant_key text,
  p_profile_url text,
  p_source_name text,
  p_retrieved_at timestamptz,
  p_http_status integer,
  p_reported_total integer,
  p_detail_count integer,
  p_unique_badge_count integer,
  p_completeness_status text,
  p_summary_note text
)
returns table(observation_id uuid, recorded_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_participant_id uuid;
  v_profile_revision bigint;
  v_current_profile_url text;
  v_normalized_url text;
  v_profile_id text;
  v_profile_count integer;
  v_observation_id uuid;
  v_recorded_at timestamptz := clock_timestamp();
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if coalesce(p_participant_key, '') !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
    or coalesce(p_profile_url, '') !~* '^https://(www\.)?(skills\.google|cloudskillsboost\.google)/public_profiles/[A-Za-z0-9_-]+/?$'
    or p_source_name is null or p_source_name not in ('arcadecalc_frontend', 'google_skills_public_html')
    or p_completeness_status is null or p_completeness_status not in ('unverified', 'partial', 'failed', 'blocked')
    or p_http_status is null or p_http_status < 100 or p_http_status > 599
    or p_retrieved_at is null or p_retrieved_at > clock_timestamp() + interval '5 minutes'
    or (p_summary_note is not null and (length(p_summary_note) > 500 or p_summary_note ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'Observation fields are invalid';
  end if;
  if p_completeness_status in ('failed', 'blocked') then
    if p_reported_total is not null or p_detail_count is not null or p_unique_badge_count is not null then
      raise exception using errcode = '22023', message = 'Failed or blocked observations cannot include counts';
    end if;
    if p_completeness_status = 'blocked' and p_http_status not in (401, 403, 429) then
      raise exception using errcode = '22023', message = 'Blocked status requires an access-denied or rate-limit response';
    end if;
  else
    if p_http_status < 200 or p_http_status >= 300
      or p_reported_total is null or p_detail_count is null
      or p_reported_total < 0 or p_reported_total > 10000
      or p_detail_count < 0 or p_detail_count > 10000
      or (p_unique_badge_count is not null and (p_unique_badge_count < 0 or p_unique_badge_count > p_detail_count)) then
      raise exception using errcode = '22023', message = 'Successful observation counts are invalid';
    end if;
  end if;

  v_normalized_url := private.normalize_auto_profile_url(p_profile_url);
  v_profile_id := (pg_catalog.regexp_match(v_normalized_url, '/public_profiles/([A-Za-z0-9_-]+)$'))[1];
  if v_profile_id is null then
    raise exception using errcode = '22023', message = 'Profile URL is invalid';
  end if;

  select p.id, p.auto_profile_revision, p.profile_url
    into v_participant_id, v_profile_revision, v_current_profile_url
  from public.participants p
  where p.participant_key = p_participant_key and p.registration_status = 'registered'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Registered participant identity was not found';
  end if;

  -- Serialize an observation with concurrent profile reassignment/alias writes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_normalized_url, 0));
  select count(*) into v_profile_count
  from public.participants p
  where p.registration_status = 'registered'
    and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url;
  if v_profile_count <> 1
    or private.normalize_auto_profile_url(v_current_profile_url) is distinct from v_normalized_url then
    raise exception using errcode = '22023', message = 'Registered profile identity is changed or ambiguous';
  end if;

  insert into public.participant_progress_observations (
    participant_id, profile_id, normalized_profile_url, profile_revision,
    source_name, retrieved_at, http_status, reported_total, detail_count,
    unique_badge_count, completeness_status, summary_note, actor_user_id, recorded_at
  ) values (
    v_participant_id, v_profile_id, v_normalized_url, v_profile_revision,
    p_source_name, p_retrieved_at, p_http_status, p_reported_total, p_detail_count,
    p_unique_badge_count, p_completeness_status, nullif(btrim(p_summary_note), ''), v_actor, v_recorded_at
  ) returning id into v_observation_id;
  return query select v_observation_id, v_recorded_at;
end;
$$;
revoke all on function public.admin_record_progress_observation(text, text, text, timestamptz, integer, integer, integer, integer, text, text) from public, anon;
grant execute on function public.admin_record_progress_observation(text, text, text, timestamptz, integer, integer, integer, integer, text, text) to authenticated;

create view public.public_progress_observation_leaderboard
with (security_invoker = true)
as
select
  p.id as participant_id,
  p.display_name,
  latest.source_name as latest_source_name,
  latest.retrieved_at as latest_retrieved_at,
  latest.recorded_at as latest_recorded_at,
  latest.http_status as latest_http_status,
  latest.completeness_status as latest_status,
  report.reported_total,
  report.detail_count,
  report.unique_badge_count,
  report.source_name as report_source_name,
  report.retrieved_at as last_reported_at,
  latest.identity_status
from public.participants p
join lateral (
  select o.source_name, o.retrieved_at, o.recorded_at, o.http_status, o.completeness_status, o.identity_status
  from public.participant_progress_observations o
  where o.participant_id = p.id
  order by o.recorded_at desc, o.id desc
  limit 1
) latest on true
left join lateral (
  select o.reported_total, o.detail_count, o.unique_badge_count, o.source_name, o.retrieved_at
  from public.participant_progress_observations o
  where o.participant_id = p.id and o.reported_total is not null
  order by o.recorded_at desc, o.id desc
  limit 1
) report on true;
grant select on public.public_progress_observation_leaderboard to anon;
revoke all on public.public_progress_observation_leaderboard from public, authenticated;
