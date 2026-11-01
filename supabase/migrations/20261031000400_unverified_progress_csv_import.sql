-- Organizer-imported progress is unverified and isolated from automated
-- snapshots, manually verified counts, and the immutable automatic rank table.
create table public.participant_progress_imports (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source text not null default 'organizer_csv' check (source = 'organizer_csv'),
  created_at timestamptz not null default clock_timestamp(),
  item_count integer not null check (item_count between 1 and 500)
);

create table public.participant_progress_import_items (
  import_id uuid not null references public.participant_progress_imports(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  normalized_profile_url text not null,
  profile_revision bigint not null check (profile_revision > 0),
  reported_badge_count integer not null check (reported_badge_count between 0 and 10000),
  imported_at timestamptz not null,
  primary key (import_id, participant_id)
);
create index participant_progress_import_items_latest_idx
  on public.participant_progress_import_items (participant_id, imported_at desc);
create index participant_progress_import_items_profile_idx
  on public.participant_progress_import_items (normalized_profile_url, profile_revision);

alter table public.participant_progress_imports enable row level security;
alter table public.participant_progress_import_items enable row level security;
revoke all on table public.participant_progress_imports from public, anon, authenticated, service_role;
revoke all on table public.participant_progress_import_items from public, anon, authenticated, service_role;

grant select on public.participant_progress_imports to authenticated;
create policy participant_progress_imports_admin_read
  on public.participant_progress_imports for select to authenticated
  using ((select private.is_admin()));

create function private.is_current_progress_import_item(p_participant_id uuid, p_imported_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participant_progress_import_items i
    join public.participants p on p.id = i.participant_id
    where i.participant_id = p_participant_id
      and i.imported_at = p_imported_at
      and p.registration_status = 'registered'
      and p.auto_profile_revision = i.profile_revision
      and private.normalize_auto_profile_url(p.profile_url) = i.normalized_profile_url
      and (
        select count(*)
        from public.participants other
        where other.registration_status = 'registered'
          and private.normalize_auto_profile_url(other.profile_url) = i.normalized_profile_url
      ) = 1
  );
$$;
revoke all on function private.is_current_progress_import_item(uuid, timestamptz) from public;
grant execute on function private.is_current_progress_import_item(uuid, timestamptz) to anon, authenticated;

grant select (participant_id, reported_badge_count, imported_at)
  on public.participant_progress_import_items to anon;
grant select on public.participant_progress_import_items to authenticated;
create policy participant_progress_import_items_public_current_read
  on public.participant_progress_import_items for select to anon
  using (private.is_current_progress_import_item(participant_id, imported_at));
create policy participant_progress_import_items_admin_read
  on public.participant_progress_import_items for select to authenticated
  using ((select private.is_admin()));

-- RPC checks the session again, locks participants in stable order, validates
-- every row, then records the operation and all rows in one transaction.
create function public.admin_import_unverified_progress(p_rows jsonb)
returns table(import_id uuid, imported_count integer, imported_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_participant_id uuid;
  v_participant_key text;
  v_profile_url text;
  v_normalized_url text;
  v_badge_count integer;
  v_count integer;
  v_import_id uuid;
  v_imported_at timestamptz := clock_timestamp();
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Import must contain 1 to 500 valid rows';
  end if;

  -- Reject duplicate participant IDs or normalized profile identities.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as r(item)
    group by r.item ->> 'participant_id'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_rows) as r(item)
    group by private.normalize_auto_profile_url(r.item ->> 'profile_url')
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Duplicate participant or profile identity in import';
  end if;

  -- Lock each participant row so a profile URL change cannot race validation.
  perform p.id
  from public.participants p
  where p.id in (
    select (r.item ->> 'participant_id')::uuid
    from jsonb_array_elements(p_rows) as r(item)
    where (r.item ->> 'participant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  order by p.id
  for update;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or (select count(*) from jsonb_object_keys(v_item)) <> 4
      or not (v_item ?& array['participant_id', 'participant_key', 'profile_url', 'badge_count']) then
      raise exception using errcode = '22023', message = 'Import row shape is invalid';
    end if;
    if coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'participant_key', '') !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
      or jsonb_typeof(v_item -> 'badge_count') <> 'number'
      or coalesce(v_item ->> 'badge_count', '') !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = '22023', message = 'Import row contains invalid identity or badge count';
    end if;
    v_participant_id := (v_item ->> 'participant_id')::uuid;
    v_participant_key := v_item ->> 'participant_key';
    v_profile_url := v_item ->> 'profile_url';
    v_badge_count := (v_item ->> 'badge_count')::integer;
    v_normalized_url := private.normalize_auto_profile_url(v_profile_url);
    if v_badge_count < 0 or v_badge_count > 10000 or v_normalized_url is null then
      raise exception using errcode = '22023', message = 'Import row contains invalid profile URL or badge count';
    end if;
    if not exists (
      select 1 from public.participants p
      where p.id = v_participant_id
        and p.participant_key = v_participant_key
        and p.registration_status = 'registered'
        and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url
    ) then
      raise exception using errcode = '22023', message = 'Import identity no longer matches a registered profile';
    end if;
    if (
      select count(*) from public.participants p
      where p.registration_status = 'registered'
        and private.normalize_auto_profile_url(p.profile_url) = v_normalized_url
    ) <> 1 then
      raise exception using errcode = '22023', message = 'Registered profile URL is assigned more than once';
    end if;
  end loop;

  select jsonb_array_length(p_rows) into v_count;
  insert into public.participant_progress_imports (actor_user_id, item_count)
  values ((select auth.uid()), v_count)
  returning id into v_import_id;

  insert into public.participant_progress_import_items (
    import_id, participant_id, normalized_profile_url, profile_revision,
    reported_badge_count, imported_at
  )
  select
    v_import_id,
    p.id,
    private.normalize_auto_profile_url(r.item ->> 'profile_url'),
    p.auto_profile_revision,
    (r.item ->> 'badge_count')::integer,
    v_imported_at
  from jsonb_array_elements(p_rows) as r(item)
  join public.participants p on p.id = (r.item ->> 'participant_id')::uuid;

  get diagnostics v_count = row_count;
  return query select v_import_id, v_count, v_imported_at;
end;
$$;
revoke all on function public.admin_import_unverified_progress(jsonb) from public, anon;
grant execute on function public.admin_import_unverified_progress(jsonb) to authenticated;

create or replace view public.public_auto_progress_leaderboard
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
  am.finish_rank as ten_badge_finish_rank,
  imported.reported_badge_count as unverified_badge_count,
  imported.imported_at as unverified_imported_at,
  case when imported.imported_at is not null then 'organizer_csv'::text else null::text end as unverified_source
from public.participants p
left join public.participant_auto_progress ap on ap.participant_id = p.id
left join public.participant_auto_milestones am on am.participant_id = p.id
left join lateral (
  select i.reported_badge_count, i.imported_at
  from public.participant_progress_import_items i
  where i.participant_id = p.id
    and private.is_current_progress_import_item(i.participant_id, i.imported_at)
  order by i.imported_at desc
  limit 1
) imported on true;
grant select on public.public_auto_progress_leaderboard to anon;
revoke all on public.public_auto_progress_leaderboard from public, authenticated;
