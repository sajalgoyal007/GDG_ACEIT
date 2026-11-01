-- Isolated, unverified public-profile progress. This migration does not touch
-- participants.verified_badge_count, last_verified_at, or manual audit events.

alter table public.participants
  add column auto_profile_revision bigint not null default 1
    check (auto_profile_revision > 0);

create table public.participant_auto_progress (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  normalized_profile_url text,
  profile_revision bigint not null check (profile_revision > 0),
  status text not null default 'unavailable'
    check (status in (
      'ok', 'private', 'not_found', 'rate_limited', 'blocked', 'timeout',
      'upstream_error', 'parse_error', 'incomplete', 'duplicate_profile', 'unavailable'
    )),
  eligible_badge_count integer check (eligible_badge_count between 0 and 10000),
  attempted_at timestamptz,
  next_fetch_allowed_at timestamptz,
  last_successful_check_at timestamptz,
  last_progress_change_at timestamptz,
  snapshot_id text,
  parser_version text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  error_category text,
  updated_at timestamptz not null default now(),
  claim_token uuid,
  claim_expires_at timestamptz,
  constraint participant_auto_progress_ok_shape check (
    status <> 'ok' or (eligible_badge_count is not null and last_successful_check_at is not null)
  ),
  constraint participant_auto_progress_claim_shape check (
    (claim_token is null and claim_expires_at is null)
    or (claim_token is not null and claim_expires_at is not null)
  )
);

create unique index participant_auto_progress_profile_idx
  on public.participant_auto_progress (normalized_profile_url)
  where normalized_profile_url is not null;
create index participant_auto_progress_due_idx
  on public.participant_auto_progress (attempted_at, participant_id);
create index participant_auto_progress_public_order_idx
  on public.participant_auto_progress (eligible_badge_count desc, last_progress_change_at desc, participant_id);

create table public.participant_auto_badges (
  participant_id uuid not null references public.participants(id) on delete cascade,
  badge_key text not null check (length(btrim(badge_key)) between 1 and 200),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  is_current boolean not null default true,
  primary key (participant_id, badge_key)
);
create index participant_auto_badges_current_idx
  on public.participant_auto_badges (participant_id, badge_key) where is_current;

create table public.participant_auto_milestones (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  milestone text not null default 'ten_badges' check (milestone = 'ten_badges'),
  first_observed_at timestamptz not null,
  finish_rank integer unique check (finish_rank between 1 and 10)
);

create table public.participant_auto_rank_allocator (
  singleton boolean primary key default true check (singleton),
  next_rank integer not null check (next_rank between 1 and 11)
);
insert into public.participant_auto_rank_allocator (singleton, next_rank)
values (true, 1);

create function private.normalize_auto_profile_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    p_url,
    '^https://(www\.)?(skills\.google|cloudskillsboost\.google)(/public_profiles/[A-Za-z0-9_-]+)/?$',
    'https://skills.google\3',
    'i'
  );
$$;
revoke all on function private.normalize_auto_profile_url(text) from public, anon, authenticated;

create function private.is_registered_auto_progress_participant(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
    where p.id = p_participant_id and p.registration_status = 'registered'
  );
$$;
revoke all on function private.is_registered_auto_progress_participant(uuid) from public, authenticated;
grant execute on function private.is_registered_auto_progress_participant(uuid) to anon;

create function private.invalidate_auto_progress_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_url text;
  v_new_url text;
  v_lock_key bigint;
  v_duplicate_count integer;
begin
  if tg_op = 'UPDATE' and old.profile_url is not distinct from new.profile_url then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.auto_profile_revision := old.auto_profile_revision + 1;
    v_old_url := private.normalize_auto_profile_url(old.profile_url);
  end if;
  v_new_url := private.normalize_auto_profile_url(new.profile_url);

  -- Stable order serializes aliases/reassignments without advisory-lock deadlocks.
  for v_lock_key in
    select distinct hashtextextended(urls.url, 0)
    from unnest(array[v_old_url, v_new_url]) as urls(url)
    where urls.url is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  if tg_op = 'UPDATE' then
    update public.participant_auto_progress ap
    set normalized_profile_url = null,
        profile_revision = new.auto_profile_revision,
        status = 'unavailable',
        eligible_badge_count = null,
        last_successful_check_at = null,
        last_progress_change_at = null,
        snapshot_id = null,
        parser_version = null,
        claim_token = null,
        claim_expires_at = null,
        consecutive_failures = 0,
        error_category = null,
        updated_at = clock_timestamp()
    where ap.participant_id = new.id;
    update public.participant_auto_badges
    set is_current = false
    where participant_id = new.id and is_current;
  end if;

  if new.registration_status = 'registered' and v_new_url is not null then
    select count(*)::integer into v_duplicate_count
    from public.participants p
    where p.registration_status = 'registered'
      and p.id <> new.id
      and private.normalize_auto_profile_url(p.profile_url) = v_new_url;
    if v_duplicate_count > 0 then
      update public.participant_auto_progress ap
      set normalized_profile_url = null,
          status = 'duplicate_profile',
          claim_token = null,
          claim_expires_at = null,
          error_category = 'duplicate_profile',
          updated_at = clock_timestamp()
      where ap.normalized_profile_url = v_new_url;
      update public.participant_auto_badges b
      set is_current = false
      where b.participant_id in (
        select p.id from public.participants p
        where p.registration_status = 'registered'
          and private.normalize_auto_profile_url(p.profile_url) = v_new_url
      ) and b.is_current;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.invalidate_auto_progress_on_profile_change() from public, anon, authenticated;
create trigger participants_auto_profile_identity_insert
before insert on public.participants
for each row execute function private.invalidate_auto_progress_on_profile_change();
create trigger participants_auto_profile_identity_update
before update of profile_url on public.participants
for each row execute function private.invalidate_auto_progress_on_profile_change();

alter table public.participant_auto_progress enable row level security;
alter table public.participant_auto_badges enable row level security;
alter table public.participant_auto_milestones enable row level security;
alter table public.participant_auto_rank_allocator enable row level security;

revoke all on table public.participant_auto_progress from public, anon, authenticated, service_role;
revoke all on table public.participant_auto_badges from public, anon, authenticated, service_role;
revoke all on table public.participant_auto_milestones from public, anon, authenticated, service_role;
revoke all on table public.participant_auto_rank_allocator from public, anon, authenticated, service_role;

grant select (participant_id, status, eligible_badge_count, last_successful_check_at, last_progress_change_at)
  on public.participant_auto_progress to anon;
grant select (participant_id, first_observed_at, finish_rank)
  on public.participant_auto_milestones to anon;

create policy participant_auto_progress_public_registered_read
  on public.participant_auto_progress for select to anon
  using (private.is_registered_auto_progress_participant(participant_id));
create policy participant_auto_milestones_public_registered_read
  on public.participant_auto_milestones for select to anon
  using (private.is_registered_auto_progress_participant(participant_id));

create view public.public_auto_progress_leaderboard
with (security_invoker = true)
as
select
  p.id as participant_id,
  p.display_name,
  ap.status,
  ap.eligible_badge_count,
  ap.last_successful_check_at,
  ap.last_progress_change_at,
  am.first_observed_at as ten_badge_first_observed_at,
  am.finish_rank as ten_badge_finish_rank
from public.participants p
left join public.participant_auto_progress ap on ap.participant_id = p.id
left join public.participant_auto_milestones am on am.participant_id = p.id;
grant select on public.public_auto_progress_leaderboard to anon;
revoke all on public.public_auto_progress_leaderboard from public, authenticated;

-- Worker claims are acquired before any profile network request. Claims are
-- database-issued, expire, and are invalidated by profile URL revision changes.
create function public.claim_participant_auto_fetch(
  p_participant_id uuid,
  p_lease_seconds integer default 120
)
returns table(claim_status text, claim_token uuid, profile_url text, profile_revision bigint, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_progress public.participant_auto_progress%rowtype;
  v_normalized_url text;
  v_duplicate_count integer;
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 5 and 600 then
    raise exception using errcode = '22023', message = 'Fetch lease must be from 5 to 600 seconds';
  end if;

  select p.* into v_participant
  from public.participants p
  where p.id = p_participant_id and p.registration_status = 'registered'
  for update;
  if not found then
    return query select 'no_participant'::text, null::uuid, null::text, null::bigint, null::timestamptz;
    return;
  end if;
  if v_participant.profile_url is null
    or v_participant.profile_url !~* '^https://(www\.)?(skills\.google|cloudskillsboost\.google)/public_profiles/[A-Za-z0-9_-]+/?$' then
    return query select 'no_profile'::text, null::uuid, null::text, v_participant.auto_profile_revision, null::timestamptz;
    return;
  end if;

  v_normalized_url := private.normalize_auto_profile_url(v_participant.profile_url);
  perform pg_advisory_xact_lock(hashtextextended(v_normalized_url, 0));
  select count(*)::integer into v_duplicate_count
  from public.participants p
  where p.registration_status = 'registered'
    and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url;

  insert into public.participant_auto_progress (
    participant_id, normalized_profile_url, profile_revision, status
  ) values (
    p_participant_id, v_normalized_url, v_participant.auto_profile_revision, 'unavailable'
  ) on conflict (participant_id) do nothing;

  select ap.* into v_progress
  from public.participant_auto_progress ap
  where ap.participant_id = p_participant_id
  for update;
  if v_progress.profile_revision <> v_participant.auto_profile_revision then
    update public.participant_auto_badges b
    set is_current = false
    where b.participant_id = p_participant_id and b.is_current;
    update public.participant_auto_progress ap
    set normalized_profile_url = null,
        profile_revision = v_participant.auto_profile_revision,
        status = 'unavailable',
        eligible_badge_count = null,
        last_successful_check_at = null,
        last_progress_change_at = null,
        snapshot_id = null,
        parser_version = null,
        claim_token = null,
        claim_expires_at = null,
        consecutive_failures = 0,
        error_category = null,
        updated_at = v_now
    where ap.participant_id = p_participant_id;
    v_progress.profile_revision := v_participant.auto_profile_revision;
    v_progress.claim_token := null;
    v_progress.claim_expires_at := null;
  end if;

  if v_duplicate_count > 1 then
    update public.participant_auto_progress ap
    set normalized_profile_url = null,
        status = 'duplicate_profile',
        claim_token = null,
        claim_expires_at = null,
        error_category = 'duplicate_profile',
        updated_at = v_now
    where ap.normalized_profile_url = v_normalized_url
       or ap.participant_id = p_participant_id;
    update public.participant_auto_badges b
    set is_current = false
    where b.participant_id in (
      select p.id from public.participants p
      where p.registration_status = 'registered'
        and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url
    ) and b.is_current;
    insert into public.participant_auto_progress (
      participant_id, normalized_profile_url, profile_revision, status, attempted_at, error_category
    ) values (
      p_participant_id, null, v_participant.auto_profile_revision, 'duplicate_profile', v_now, 'duplicate_profile'
    ) on conflict (participant_id) do update set
      normalized_profile_url = null,
      profile_revision = excluded.profile_revision,
      status = 'duplicate_profile',
      attempted_at = excluded.attempted_at,
      claim_token = null,
      claim_expires_at = null,
      error_category = 'duplicate_profile',
      updated_at = v_now;
    return query select 'duplicate_profile'::text, null::uuid, v_participant.profile_url,
      v_participant.auto_profile_revision, null::timestamptz;
    return;
  end if;

  if v_progress.claim_token is not null and v_progress.claim_expires_at > v_now then
    return query select 'busy'::text, null::uuid, v_participant.profile_url,
      v_participant.auto_profile_revision, v_progress.claim_expires_at;
    return;
  end if;

  -- A participant may request at most one fetch per minute. This timestamp is
  -- written in the row-locked claim transaction and is retained across fetch
  -- failures, claim expiry, and profile URL revisions. The existing result
  -- timestamp column carries the retry time for the `cooldown` status.
  if v_progress.next_fetch_allowed_at is not null
    and v_progress.next_fetch_allowed_at > v_now then
    return query select 'cooldown'::text, null::uuid, v_participant.profile_url,
      v_participant.auto_profile_revision, v_progress.next_fetch_allowed_at;
    return;
  end if;

  update public.participant_auto_progress ap
  set normalized_profile_url = v_normalized_url,
      profile_revision = v_participant.auto_profile_revision,
      attempted_at = v_now,
      next_fetch_allowed_at = v_now + interval '60 seconds',
      claim_token = v_token,
      claim_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
  where ap.participant_id = p_participant_id;
  return query select 'claimed'::text, v_token, v_participant.profile_url,
    v_participant.auto_profile_revision, v_now + make_interval(secs => p_lease_seconds);
end;
$$;
revoke all on function public.claim_participant_auto_fetch(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_participant_auto_fetch(uuid, integer) to service_role;

create function public.record_participant_auto_fetch(
  p_participant_id uuid,
  p_profile_url text,
  p_claim_token uuid,
  p_profile_revision bigint,
  p_fetch_status text,
  p_badges jsonb,
  p_snapshot_id text,
  p_parser_version text,
  p_error_category text
)
returns table(result_status text, eligible_badge_count integer, finish_rank integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_progress public.participant_auto_progress%rowtype;
  v_normalized_url text;
  v_duplicate_count integer;
  v_count integer;
  v_changed boolean;
  v_rank integer;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Automatic progress worker access required';
  end if;
  if p_fetch_status is null or p_fetch_status not in (
    'ok', 'private', 'not_found', 'rate_limited', 'blocked', 'timeout',
    'upstream_error', 'parse_error', 'incomplete'
  ) then
    raise exception using errcode = '22023', message = 'Automatic fetch status is invalid';
  end if;
  if p_error_category is not null and length(p_error_category) > 80 then
    raise exception using errcode = '22023', message = 'Error category is too long';
  end if;
  if p_profile_url is null
    or p_profile_url !~* '^https://(www\.)?(skills\.google|cloudskillsboost\.google)/public_profiles/[A-Za-z0-9_-]+/?$'
    or p_claim_token is null or p_profile_revision is null then
    return query select 'stale_claim'::text, null::integer, null::integer;
    return;
  end if;

  select p.* into v_participant
  from public.participants p
  where p.id = p_participant_id and p.registration_status = 'registered'
  for update;
  if not found or v_participant.profile_url is distinct from p_profile_url then
    return query select 'stale_claim'::text, null::integer, null::integer;
    return;
  end if;

  v_normalized_url := private.normalize_auto_profile_url(p_profile_url);
  perform pg_advisory_xact_lock(hashtextextended(v_normalized_url, 0));
  select ap.* into v_progress
  from public.participant_auto_progress ap
  where ap.participant_id = p_participant_id
  for update;
  if not found
    or v_progress.claim_token is distinct from p_claim_token
    or v_progress.profile_revision <> p_profile_revision
    or v_participant.auto_profile_revision <> p_profile_revision
    or v_progress.claim_expires_at is null
    or v_progress.claim_expires_at <= v_now
    or v_progress.profile_revision <> v_participant.auto_profile_revision
    or v_progress.normalized_profile_url is distinct from v_normalized_url then
    return query select 'stale_claim'::text, null::integer, null::integer;
    return;
  end if;

  select count(*)::integer into v_duplicate_count
  from public.participants p
  where p.registration_status = 'registered'
    and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url;
  if v_duplicate_count > 1 then
    update public.participant_auto_progress ap
    set normalized_profile_url = null,
        status = 'duplicate_profile',
        claim_token = null,
        claim_expires_at = null,
        error_category = 'duplicate_profile',
        updated_at = v_now
    where ap.normalized_profile_url = v_normalized_url
       or ap.participant_id = p_participant_id;
    update public.participant_auto_badges b
    set is_current = false
    where b.participant_id in (
      select p.id from public.participants p
      where p.registration_status = 'registered'
        and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url
    ) and b.is_current;
    return query select 'duplicate_profile'::text, v_progress.eligible_badge_count, null::integer;
    return;
  end if;

  if p_fetch_status = 'ok' then
    if p_badges is null or pg_catalog.jsonb_typeof(p_badges) <> 'array'
      or pg_catalog.jsonb_array_length(p_badges) > 10000
      or p_snapshot_id is null or length(btrim(p_snapshot_id)) = 0
      or p_parser_version is null or length(btrim(p_parser_version)) = 0 then
      raise exception using errcode = '22023', message = 'A complete snapshot, identifier, and parser version are required';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_badges) b(value)
      where pg_catalog.jsonb_typeof(b.value) is distinct from 'object'
        or pg_catalog.jsonb_typeof(b.value -> 'key') is distinct from 'string'
        or coalesce(length(btrim(b.value ->> 'key')) not between 1 and 200, true)
    ) then
      raise exception using errcode = '22023', message = 'Snapshot badge identifiers are invalid';
    end if;
    select count(distinct b.value ->> 'key')::integer into v_count
    from pg_catalog.jsonb_array_elements(p_badges) b(value);

    v_changed := v_progress.last_successful_check_at is null and v_count > 0;
    if v_progress.last_successful_check_at is not null then
      v_changed := v_progress.eligible_badge_count is distinct from v_count
        or exists (
          select 1 from public.participant_auto_badges old_badge
          where old_badge.participant_id = p_participant_id and old_badge.is_current
            and not exists (
              select 1 from pg_catalog.jsonb_array_elements(p_badges) b(value)
              where b.value ->> 'key' = old_badge.badge_key
            )
        )
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(p_badges) b(value)
          where not exists (
            select 1 from public.participant_auto_badges old_badge
            where old_badge.participant_id = p_participant_id
              and old_badge.is_current and old_badge.badge_key = b.value ->> 'key'
          )
        );
    end if;

    update public.participant_auto_badges
    set is_current = false
    where participant_id = p_participant_id and is_current;
    insert into public.participant_auto_badges (participant_id, badge_key, first_seen_at, last_seen_at, is_current)
    select p_participant_id, b.value ->> 'key', v_now, v_now, true
    from (
      select distinct on (value ->> 'key') value
      from pg_catalog.jsonb_array_elements(p_badges) as badge(value)
      order by value ->> 'key'
    ) b
    on conflict (participant_id, badge_key) do update set
      last_seen_at = excluded.last_seen_at,
      is_current = true;

    update public.participant_auto_progress ap
    set status = 'ok',
        eligible_badge_count = v_count,
        attempted_at = v_now,
        last_successful_check_at = v_now,
        last_progress_change_at = case when v_changed then v_now else ap.last_progress_change_at end,
        snapshot_id = p_snapshot_id,
        parser_version = p_parser_version,
        consecutive_failures = 0,
        error_category = null,
        claim_token = null,
        claim_expires_at = null,
        updated_at = v_now
    where ap.participant_id = p_participant_id;

    if v_count >= 10 then
      insert into public.participant_auto_milestones (participant_id, first_observed_at, finish_rank)
      values (p_participant_id, v_now, null)
      on conflict (participant_id) do nothing;
      if exists (
        select 1 from public.participant_auto_milestones am
        where am.participant_id = p_participant_id and am.finish_rank is null
      ) then
        select a.next_rank into v_rank
        from public.participant_auto_rank_allocator a
        where a.singleton
        for update;
        if v_rank between 1 and 10 then
          update public.participant_auto_milestones am
          set finish_rank = v_rank
          where am.participant_id = p_participant_id and am.finish_rank is null;
          if found then
            update public.participant_auto_rank_allocator a
            set next_rank = v_rank + 1 where a.singleton;
          end if;
        end if;
      end if;
    end if;
    select am.finish_rank into v_rank
    from public.participant_auto_milestones am where am.participant_id = p_participant_id;
    return query select 'ok'::text, v_count, v_rank;
    return;
  end if;

  update public.participant_auto_progress ap
  set status = p_fetch_status,
      attempted_at = v_now,
      consecutive_failures = ap.consecutive_failures + 1,
      error_category = coalesce(nullif(p_error_category, ''), p_fetch_status),
      claim_token = null,
      claim_expires_at = null,
      updated_at = v_now
  where ap.participant_id = p_participant_id;
  select am.finish_rank into v_rank
  from public.participant_auto_milestones am
  where am.participant_id = p_participant_id;
  return query select p_fetch_status, v_progress.eligible_badge_count, v_rank;
end;
$$;
revoke all on function public.record_participant_auto_fetch(uuid, text, uuid, bigint, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_participant_auto_fetch(uuid, text, uuid, bigint, text, jsonb, text, text, text)
  to service_role;
