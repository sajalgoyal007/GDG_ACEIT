-- No participant email addresses are stored in this schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  participant_key text not null unique,
  display_name text not null,
  profile_url text,
  registration_status text not null default 'registered'
    check (registration_status in ('registered', 'pending')),
  verified_badge_count integer not null default 0
    check (verified_badge_count between 0 and 10000),
  last_verified_at timestamptz,
  verification_source text,
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participants_key_format check (
    participant_key = lower(participant_key)
    and participant_key ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
  ),
  constraint participants_name_format check (
    length(btrim(display_name)) between 1 and 80
    and display_name !~ '[[:cntrl:]]'
  ),
  constraint participants_public_profile_url check (
    profile_url is null or profile_url ~ '^https://(www\.)?cloudskillsboost\.google/public_profiles/[A-Za-z0-9_-]+/?$'
  )
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.participant_audit_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  event_type text not null check (event_type in ('participant_imported', 'badge_count_updated')),
  previous_badge_count integer check (previous_badge_count between 0 and 10000),
  new_badge_count integer check (new_badge_count between 0 and 10000),
  note text check (note is null or length(note) <= 1000),
  source text not null check (source in ('csv_import', 'admin_manual')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint participant_audit_count_shape check (
    (event_type = 'participant_imported' and previous_badge_count is null and new_badge_count = 0 and verified_at is null)
    or (event_type = 'badge_count_updated' and previous_badge_count is not null and new_badge_count is not null and verified_at is not null)
  )
);

-- Itemized evidence is optional. Never infer earned_at from verified_at.
-- Aggregate count updates do not create badge-level records.
create table public.participant_badge_observations (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  badge_key text not null check (length(btrim(badge_key)) between 1 and 200),
  badge_name text not null check (length(btrim(badge_name)) between 1 and 200),
  earned_at timestamptz,
  verified_at timestamptz not null,
  source text not null check (length(btrim(source)) between 1 and 120),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (participant_id, badge_key)
);

create index participants_public_rank_idx
  on public.participants (verified_badge_count desc, display_name asc)
  where registration_status = 'registered';
create index participant_audit_events_participant_created_idx
  on public.participant_audit_events (participant_id, created_at desc);
create index participant_badge_observations_participant_idx
  on public.participant_badge_observations (participant_id, verified_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger participants_set_updated_at
before update on public.participants
for each row execute function private.set_updated_at();

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users as admins
    where admins.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

alter table public.participants enable row level security;
alter table public.admin_users enable row level security;
alter table public.participant_audit_events enable row level security;
alter table public.participant_badge_observations enable row level security;

revoke all on table public.participants from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.participant_audit_events from anon, authenticated;
revoke all on table public.participant_badge_observations from anon, authenticated;

-- Anonymous readers can select only public columns and only registered rows.
grant select (id, display_name, profile_url, verified_badge_count, last_verified_at, verification_source, updated_at)
  on public.participants to anon;
create policy participants_public_registered_read
  on public.participants for select to anon
  using (registration_status = 'registered');

-- Authenticated admins can read full participant rows; writes go only through checked RPCs.
grant select on public.participants to authenticated;
create policy participants_admin_read
  on public.participants for select to authenticated
  using ((select private.is_admin()));

grant select on public.admin_users to authenticated;
create policy admin_users_self_read
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.participant_audit_events, public.participant_badge_observations to authenticated;
create policy participant_audit_admin_read
  on public.participant_audit_events for select to authenticated
  using ((select private.is_admin()));
create policy participant_badges_admin_read
  on public.participant_badge_observations for select to authenticated
  using ((select private.is_admin()));

create function public.get_public_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registered_count', count(*)::integer,
    'total_verified_badges', coalesce(sum(participants.verified_badge_count), 0)::integer,
    'five_badge_count', count(*) filter (where participants.verified_badge_count >= 5)::integer,
    'ten_badge_count', count(*) filter (where participants.verified_badge_count >= 10)::integer,
    'last_updated_at', coalesce(max(participants.updated_at), now())
  )
  from public.participants
  where participants.registration_status = 'registered';
$$;
revoke all on function public.get_public_summary() from public;
grant execute on function public.get_public_summary() to anon, authenticated;

create function public.admin_import_participants(p_rows jsonb)
returns table(csv_row_number integer, participant_id uuid, result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_row_number integer;
  v_inserted integer;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'Import rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Import must contain at most 500 rows';
  end if;

  for v_row, v_row_number in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality)
  loop
    participant_id := null;
    insert into public.participants (participant_key, display_name, profile_url, registration_status, verified_badge_count)
    values (
      v_row ->> 'participantKey',
      v_row ->> 'displayName',
      nullif(v_row ->> 'profileUrl', ''),
      'registered',
      0
    )
    on conflict (participant_key) do nothing
    returning id into participant_id;

    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      insert into public.participant_audit_events (
        participant_id, event_type, new_badge_count, note, source, actor_user_id
      ) values (
        participant_id, 'participant_imported', 0,
        'Registered through CSV import; no prior verified badge progress was changed.',
        'csv_import', (select auth.uid())
      );
      result := 'imported';
    else
      select participants.id into participant_id
      from public.participants
      where participants.participant_key = v_row ->> 'participantKey';
      result := 'duplicate';
    end if;
    csv_row_number := v_row_number;
    return next;
  end loop;
end;
$$;
revoke all on function public.admin_import_participants(jsonb) from public, anon;
grant execute on function public.admin_import_participants(jsonb) to authenticated;

create function public.admin_set_verified_badge_count(p_participant_id uuid, p_badge_count integer, p_note text)
returns table(previous_badge_count integer, new_badge_count integer, verified_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_count integer;
  v_verified_at timestamptz := now();
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if p_badge_count is null or p_badge_count < 0 or p_badge_count > 10000 then
    raise exception using errcode = '22023', message = 'Badge count must be an integer from 0 to 10000';
  end if;
  if length(v_note) < 1 or length(v_note) > 1000 then
    raise exception using errcode = '22023', message = 'Verification note must be 1 to 1000 characters';
  end if;

  select participants.verified_badge_count into v_previous_count
  from public.participants
  where participants.id = p_participant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Participant not found';
  end if;

  update public.participants
  set verified_badge_count = p_badge_count,
      last_verified_at = v_verified_at,
      verification_source = 'admin_manual'
  where id = p_participant_id;

  insert into public.participant_audit_events (
    participant_id, event_type, previous_badge_count, new_badge_count,
    note, source, actor_user_id, verified_at
  ) values (
    p_participant_id, 'badge_count_updated', v_previous_count, p_badge_count,
    v_note, 'admin_manual', (select auth.uid()), v_verified_at
  );

  return query select v_previous_count, p_badge_count, v_verified_at;
end;
$$;
revoke all on function public.admin_set_verified_badge_count(uuid, integer, text) from public, anon;
grant execute on function public.admin_set_verified_badge_count(uuid, integer, text) to authenticated;
