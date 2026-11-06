-- Safe, audited participant removal.
--
-- This migration adds a terminal `removed` registration status instead of
-- deleting participant rows. Historical badge observations, audit events and
-- leaderboard history are preserved. Public leaderboard/summary projections
-- already filter on `registration_status = 'registered'`, so a removed record
-- immediately stops consuming a public rank or contributing to public totals.
--
-- The removal RPC is admin-only, idempotent, and refuses to remove a profile
-- URL that appears in the supplied authoritative roster. Re-import and Google
-- Form sync are hardened so a removed participant cannot silently re-enter.

-- ----------------------------------------------------------------
-- 1. Registration status + removal metadata
-- ----------------------------------------------------------------
alter table public.participants
  drop constraint if exists participants_registration_status_check;

alter table public.participants
  add constraint participants_registration_status_check
  check (registration_status in ('registered', 'pending', 'removed'));

alter table public.participants
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id) on delete set null,
  add column if not exists removal_reason text;

alter table public.participants
  drop constraint if exists participants_removal_metadata_check;

alter table public.participants
  add constraint participants_removal_metadata_check check (
    (registration_status = 'removed'
      and removed_at is not null
      and removal_reason is not null
      and length(btrim(removal_reason)) between 8 and 1000)
    or (registration_status <> 'removed'
      and removed_at is null
      and removed_by is null
      and removal_reason is null)
  );

create index if not exists participants_removed_at_idx
  on public.participants (removed_at desc)
  where registration_status = 'removed';

-- Removal metadata is deliberately not exposed to anonymous readers.
grant select (removed_at)
  on public.participants to authenticated;

-- ----------------------------------------------------------------
-- 2. Audit constraints: record the actor, time and reason
-- ----------------------------------------------------------------
alter table public.participant_audit_events
  drop constraint if exists participant_audit_events_event_type_check;
alter table public.participant_audit_events
  add constraint participant_audit_events_event_type_check
  check (event_type in (
    'participant_imported',
    'badge_count_updated',
    'participant_synced',
    'participant_removed'
  ));

alter table public.participant_audit_events
  drop constraint if exists participant_audit_events_source_check;
alter table public.participant_audit_events
  add constraint participant_audit_events_source_check
  check (source in ('csv_import', 'admin_manual', 'google_sheets_sync'));

alter table public.participant_audit_events
  drop constraint if exists participant_audit_count_shape;
alter table public.participant_audit_events
  add constraint participant_audit_count_shape check (
    (event_type = 'participant_imported'
      and previous_badge_count is null
      and new_badge_count = 0
      and verified_at is null)
    or (event_type = 'badge_count_updated'
      and previous_badge_count is not null
      and new_badge_count is not null
      and verified_at is not null)
    or (event_type = 'participant_synced'
      and previous_badge_count is not null
      and new_badge_count = previous_badge_count
      and verified_at is null)
    or (event_type = 'participant_removed'
      and previous_badge_count is not null
      and new_badge_count = previous_badge_count
      and verified_at is null)
  );

-- ----------------------------------------------------------------
-- 3. Admin-only, audited, idempotent removal
-- ----------------------------------------------------------------
create or replace function public.admin_remove_participants(
  p_participant_ids uuid[],
  p_reason text,
  p_authoritative_profile_urls text[] default array[]::text[]
)
returns table(
  participant_id uuid,
  result text,
  previous_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
  v_participant public.participants%rowtype;
  v_previous_status text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_participant_ids is null
    or array_length(p_participant_ids, 1) is null
    or array_length(p_participant_ids, 1) < 1
    or array_length(p_participant_ids, 1) > 100 then
    raise exception using errcode = '22023', message = 'Removal request must contain 1 to 100 participants';
  end if;
  if length(v_reason) < 8 or length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Removal reason must be 8 to 1000 characters';
  end if;
  if p_authoritative_profile_urls is null
    or coalesce(array_length(p_authoritative_profile_urls, 1), 0) < 1 then
    raise exception using errcode = '22023',
      message = 'An authoritative profile URL set is required to prevent accidental removal';
  end if;
  if exists (
    select 1 from unnest(p_participant_ids) as ids(id)
    group by ids.id having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Removal request contains duplicate participants';
  end if;

  -- Stable ordering keeps concurrent batches from deadlocking.
  for v_id in select ids.id from unnest(p_participant_ids) as ids(id) order by ids.id
  loop
    select participants.* into v_participant
    from public.participants as participants
    where participants.id = v_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Participant not found';
    end if;

    if v_participant.profile_url is null then
      raise exception using errcode = '22023',
        message = 'Cannot safely remove a participant without a public profile URL';
    end if;
    if v_participant.profile_url = any(p_authoritative_profile_urls) then
      raise exception using errcode = '22023',
        message = 'Refusing to remove a participant present in the authoritative roster';
    end if;

    participant_id := v_participant.id;
    previous_status := v_participant.registration_status;
    if v_participant.registration_status = 'removed' then
      result := 'already_removed';
      return next;
      continue;
    end if;

    update public.participants as participants
    set registration_status = 'removed',
        removed_at = pg_catalog.now(),
        removed_by = v_actor,
        removal_reason = v_reason
    where participants.id = v_id;

    insert into public.participant_audit_events (
      participant_id, event_type, previous_badge_count, new_badge_count,
      note, source, actor_user_id, verified_at
    ) values (
      v_id,
      'participant_removed',
      v_participant.verified_badge_count,
      v_participant.verified_badge_count,
      v_reason,
      'admin_manual',
      v_actor,
      null
    );

    result := 'removed';
    return next;
  end loop;
end;
$$;

revoke all on function public.admin_remove_participants(uuid[], text, text[]) from public, anon;
grant execute on function public.admin_remove_participants(uuid[], text, text[]) to authenticated;

-- ----------------------------------------------------------------
-- 4. Prevent removed participants from re-entering through roster import
-- ----------------------------------------------------------------
create or replace function public.admin_import_participants(p_rows jsonb)
returns table(csv_row_number integer, participant_id uuid, result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_row_number integer;
  v_key text;
  v_profile_url text;
  v_inserted integer;
  v_existing_status text;
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
    v_key := v_row ->> 'participantKey';
    v_profile_url := nullif(v_row ->> 'profileUrl', '');

    if v_profile_url is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_profile_url, 0));
      if exists (
        select 1
        from public.participants as participants
        where participants.profile_url = v_profile_url
          and participants.participant_key <> v_key
      ) then
        select participants.id into participant_id
        from public.participants as participants
        where participants.profile_url = v_profile_url
          and participants.participant_key <> v_key
        limit 1;
        result := 'duplicate_profile';
        csv_row_number := v_row_number;
        return next;
        continue;
      end if;
    end if;

    insert into public.participants (participant_key, display_name, profile_url, registration_status, verified_badge_count)
    values (
      v_key,
      v_row ->> 'displayName',
      v_profile_url,
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
      select participants.id, participants.registration_status
        into participant_id, v_existing_status
      from public.participants as participants
      where participants.participant_key = v_key;
      result := case when v_existing_status = 'removed' then 'removed' else 'duplicate' end;
    end if;
    csv_row_number := v_row_number;
    return next;
  end loop;
end;
$$;
revoke all on function public.admin_import_participants(jsonb) from public, anon;
grant execute on function public.admin_import_participants(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 5. Prevent removed participants from re-entering through form sync
-- ----------------------------------------------------------------
create or replace function public.admin_sync_google_form_participants(p_rows jsonb)
returns table(row_number integer, participant_id uuid, result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_row_number integer;
  v_key text;
  v_display_name text;
  v_profile_url text;
  v_existing public.participants%rowtype;
  v_badge_count integer;
  v_seen_keys text[] := array[]::text[];
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'Sync rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Sync is limited to 500 participant rows';
  end if;

  for v_row in select item.value from jsonb_array_elements(p_rows) as item(value)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception using errcode = '22023', message = 'Each sync row must be an object';
    end if;
    v_row_number := (v_row ->> 'rowNumber')::integer;
    v_key := v_row ->> 'participantKey';
    v_display_name := btrim(v_row ->> 'displayName');
    v_profile_url := nullif(v_row ->> 'profileUrl', '');
    if v_row_number is null or v_row_number < 1 or v_key is null or v_key !~ '^form:[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'Sync row identity is invalid';
    end if;
    if v_key = any(v_seen_keys) then
      raise exception using errcode = '22023', message = 'Duplicate matching identities in sync request';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_key);
    if v_display_name is null or length(v_display_name) not between 1 and 80 or v_display_name ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'Participant display name is invalid';
    end if;
    if v_profile_url is not null then
      perform pg_advisory_xact_lock(hashtextextended(v_profile_url, 0));
      if exists (
        select 1 from public.participants as participants
        where participants.profile_url = v_profile_url
          and participants.participant_key <> v_key
      ) then
        raise exception using errcode = '22023', message = 'Google Skills profile URL already belongs to another participant';
      end if;
    end if;

    participant_id := null;
    insert into public.participants (participant_key, display_name, profile_url, registration_status, verified_badge_count)
    values (v_key, v_display_name, v_profile_url, 'registered', 0)
    on conflict (participant_key) do nothing
    returning id into participant_id;

    if participant_id is not null then
      insert into public.participant_audit_events (
        participant_id, event_type, new_badge_count, note, source, actor_user_id
      ) values (
        participant_id, 'participant_imported', 0,
        'Registered through Google Form response sync; badge progress was initialized to zero.',
        'google_sheets_sync', (select auth.uid())
      );
      result := 'imported';
    else
      select participants.* into v_existing
      from public.participants as participants
      where participants.participant_key = v_key
      for update;
      if not found then
        raise exception using errcode = '40001', message = 'Participant row changed during synchronization; retry the sync';
      end if;
      participant_id := v_existing.id;

      -- A removed participant is terminal. Sync must never revive the record
      -- or overwrite its preserved registration/badge history.
      if v_existing.registration_status = 'removed' then
        result := 'removed';
        row_number := v_row_number;
        return next;
        continue;
      end if;

      v_badge_count := v_existing.verified_badge_count;
      if v_existing.display_name is distinct from v_display_name or v_existing.profile_url is distinct from v_profile_url then
        update public.participants as participants
        set display_name = v_display_name,
            profile_url = v_profile_url
        where participants.id = participant_id;
        insert into public.participant_audit_events (
          participant_id, event_type, previous_badge_count, new_badge_count,
          note, source, actor_user_id
        ) values (
          participant_id, 'participant_synced', v_badge_count, v_badge_count,
          'Name or public profile URL updated from Google Form response sync; verified badge progress was preserved.',
          'google_sheets_sync', (select auth.uid())
        );
        result := 'updated';
      else
        result := 'unchanged';
      end if;
    end if;
    row_number := v_row_number;
    return next;
  end loop;
end;
$$;
revoke all on function public.admin_sync_google_form_participants(jsonb) from public, anon;
grant execute on function public.admin_sync_google_form_participants(jsonb) to authenticated;
