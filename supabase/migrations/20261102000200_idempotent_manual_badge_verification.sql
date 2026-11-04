-- Make retries of the exact same manual verification request idempotent.
-- A genuinely new review (different note or actor) still appends a new audit row.
create or replace function public.admin_set_verified_badge_count(
  p_participant_id uuid,
  p_badge_count integer,
  p_note text
)
returns table(previous_badge_count integer, new_badge_count integer, verified_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_count integer;
  v_previous_verified_at timestamptz;
  v_previous_source text;
  v_actor uuid := (select auth.uid());
  v_verified_at timestamptz := now();
  v_note text := btrim(coalesce(p_note, ''));
  v_last_event_type text;
  v_last_event_source text;
  v_last_event_new_count integer;
  v_last_event_note text;
  v_last_event_actor uuid;
  v_last_event_verified_at timestamptz;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if p_badge_count is null or p_badge_count < 0 or p_badge_count > 10000 then
    raise exception using errcode = '22023', message = 'Badge count must be an integer from 0 to 10000';
  end if;
  if length(v_note) < 1 or length(v_note) > 1000 then
    raise exception using errcode = '22023', message = 'Badge verification note must be 1 to 1000 characters';
  end if;

  select p.verified_badge_count, p.last_verified_at, p.verification_source
    into v_previous_count, v_previous_verified_at, v_previous_source
  from public.participants p
  where p.id = p_participant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Participant not found';
  end if;

  select e.event_type, e.source, e.new_badge_count, e.note, e.actor_user_id, e.verified_at
    into v_last_event_type, v_last_event_source, v_last_event_new_count, v_last_event_note, v_last_event_actor, v_last_event_verified_at
  from public.participant_audit_events e
  where e.participant_id = p_participant_id
  order by e.created_at desc, e.id desc
  limit 1;

  if v_previous_count = p_badge_count
    and v_previous_source = 'admin_manual'
    and v_previous_verified_at is not null
    and v_last_event_type = 'badge_count_updated'
    and v_last_event_source = 'admin_manual'
    and v_last_event_new_count = p_badge_count
    and v_last_event_note = v_note
    and v_last_event_actor = v_actor
    and v_last_event_verified_at = v_previous_verified_at then
    return query select v_previous_count, p_badge_count, v_previous_verified_at;
    return;
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
    v_note, 'admin_manual', v_actor, v_verified_at
  );

  return query select v_previous_count, p_badge_count, v_verified_at;
end;
$$;
revoke all on function public.admin_set_verified_badge_count(uuid, integer, text) from public, anon;
grant execute on function public.admin_set_verified_badge_count(uuid, integer, text) to authenticated;
