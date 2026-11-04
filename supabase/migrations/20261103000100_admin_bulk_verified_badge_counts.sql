-- Batch the existing audited admin verification operation in one transaction.
-- The function never writes participant counts or audit rows directly: every row
-- delegates to admin_set_verified_badge_count after the batch is validated and
-- participant rows are locked in stable UUID order.
create or replace function public.admin_bulk_set_verified_badge_counts(p_rows jsonb)
returns table(
  row_number integer,
  participant_id uuid,
  previous_badge_count integer,
  new_badge_count integer,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_id uuid;
  v_row_number integer;
  v_count integer;
  v_note text;
  v_expected_count integer;
  v_expected_verified_at timestamptz;
  v_expected_source text;
  v_current_count integer;
  v_current_verified_at timestamptz;
  v_current_source text;
  v_previous_count integer;
  v_new_count integer;
  v_verified_at timestamptz;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Bulk verification must contain 1 to 500 rows';
  end if;

  -- Validate the complete request before the first write.
  for v_item in select value from jsonb_array_elements(p_rows) as items(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or not (v_item ?& array[
        'row_number', 'participant_id', 'badge_count', 'review_note',
        'expected_badge_count', 'expected_last_verified_at', 'expected_verification_source'
      ])
      or (v_item - array[
        'row_number', 'participant_id', 'badge_count', 'review_note',
        'expected_badge_count', 'expected_last_verified_at', 'expected_verification_source'
      ]) <> '{}'::jsonb
      or coalesce(v_item ->> 'participant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'row_number', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_item ->> 'badge_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or coalesce(v_item ->> 'expected_badge_count', '') !~ '^(0|[1-9][0-9]{0,4})$'
      or jsonb_typeof(v_item -> 'review_note') is distinct from 'string'
      or jsonb_typeof(v_item -> 'expected_last_verified_at') not in ('null', 'string')
      or jsonb_typeof(v_item -> 'expected_verification_source') not in ('null', 'string') then
      raise exception using errcode = '22023', message = 'Bulk verification row is malformed';
    end if;
    if (v_item ->> 'row_number')::integer < 2
      or (v_item ->> 'row_number')::integer > 501
      or (v_item ->> 'badge_count')::integer > 10000
      or (v_item ->> 'expected_badge_count')::integer > 10000
      or length(btrim(v_item ->> 'review_note')) not between 1 and 1000 then
      raise exception using errcode = '22023', message = 'Bulk verification row is outside allowed limits';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as items(value)
    group by (value ->> 'participant_id')::uuid
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Bulk verification contains duplicate participants';
  end if;

  -- Stable lock ordering avoids deadlocks when two admins submit overlapping files.
  for v_item in
    select value from jsonb_array_elements(p_rows) as items(value)
    order by (value ->> 'participant_id')::uuid
  loop
    v_id := (v_item ->> 'participant_id')::uuid;
    v_row_number := (v_item ->> 'row_number')::integer;
    v_count := (v_item ->> 'badge_count')::integer;
    v_note := btrim(v_item ->> 'review_note');
    v_expected_count := (v_item ->> 'expected_badge_count')::integer;
    v_expected_verified_at := nullif(v_item ->> 'expected_last_verified_at', '')::timestamptz;
    v_expected_source := nullif(v_item ->> 'expected_verification_source', '');

    select p.verified_badge_count, p.last_verified_at, p.verification_source
      into v_current_count, v_current_verified_at, v_current_source
    from public.participants p
    where p.id = v_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'A participant is no longer available; preview the CSV again';
    end if;

    -- A retry after this batch already wrote the requested count is safe: the
    -- underlying RPC deduplicates the exact actor/count/note audit event. Other
    -- concurrent changes require a fresh preview and cannot be overwritten.
    if (v_current_count is distinct from v_expected_count
        or v_current_verified_at is distinct from v_expected_verified_at
        or v_current_source is distinct from v_expected_source)
      and v_current_count is distinct from v_count then
      raise exception using errcode = '40001', message = 'Participant verification changed after preview; preview the CSV again';
    end if;

    select result.previous_badge_count, result.new_badge_count, result.verified_at
      into v_previous_count, v_new_count, v_verified_at
    from public.admin_set_verified_badge_count(v_id, v_count, v_note) as result;

    return query select v_row_number, v_id, v_previous_count, v_new_count, v_verified_at;
  end loop;
end;
$$;

revoke all on function public.admin_bulk_set_verified_badge_counts(jsonb) from public, anon;
grant execute on function public.admin_bulk_set_verified_badge_counts(jsonb) to authenticated;
