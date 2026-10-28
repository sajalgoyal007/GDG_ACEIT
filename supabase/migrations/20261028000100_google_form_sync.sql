-- Record registration-profile synchronization without touching verified badge counts.
alter table public.participant_audit_events
  drop constraint participant_audit_events_event_type_check;
alter table public.participant_audit_events
  add constraint participant_audit_events_event_type_check
  check (event_type in ('participant_imported', 'badge_count_updated', 'participant_synced'));

alter table public.participant_audit_events
  drop constraint participant_audit_events_source_check;
alter table public.participant_audit_events
  add constraint participant_audit_events_source_check
  check (source in ('csv_import', 'admin_manual', 'google_sheets_sync'));

alter table public.participant_audit_events
  drop constraint participant_audit_count_shape;
alter table public.participant_audit_events
  add constraint participant_audit_count_shape check (
    (event_type = 'participant_imported' and previous_badge_count is null and new_badge_count = 0 and verified_at is null)
    or (event_type = 'badge_count_updated' and previous_badge_count is not null and new_badge_count is not null and verified_at is not null)
    or (event_type = 'participant_synced' and previous_badge_count is not null and new_badge_count = previous_badge_count and verified_at is null)
  );

create function public.admin_sync_google_form_participants(p_rows jsonb)
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
