-- Read-only operational summary for authenticated administrators.
-- No participant identifiers, profile URLs, or worker tokens are returned.
create function public.admin_get_latest_auto_progress_job()
returns table (
  job_id uuid,
  trigger_source text,
  job_status text,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  total_count integer,
  fetched_count integer,
  validated_count integer,
  saved_count integer,
  unchanged_count integer,
  failed_count integer,
  skipped_count integer,
  error_category text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;

  return query
  select j.id, j.trigger_source, j.status, j.created_at, j.started_at, j.completed_at,
    j.total_count, j.fetched_count, j.validated_count, j.saved_count, j.unchanged_count,
    j.failed_count, j.skipped_count, j.error_category
  from public.participant_auto_refresh_jobs j
  order by j.created_at desc, j.id desc
  limit 1;
end;
$$;
revoke all on function public.admin_get_latest_auto_progress_job() from public, anon;
grant execute on function public.admin_get_latest_auto_progress_job() to authenticated;
