-- Official 10-Badge Campaign Syllabus enforcement.
--
-- This migration is intentionally data-safe:
--   * it changes only public.badge_catalog categories and sync staging metadata;
--   * it never writes participant badge counts and never calls
--     admin_apply_badge_sync_run;
--   * frozen ranks are only cleared later, inside a real apply transaction.
--
-- Rules:
--   1. Exactly 10 course_template identities may be `skill`.
--   2. Every other course_template is `ignored`, with an audited reason, and is
--      logged as "Non-syllabus course (ignored)" in preview details.
--   3. Unknown game:* identities keep the original unclassified behaviour.
--   4. Arcade catalog entries are never modified.
--   5. A verified Skill count can never exceed 10.
--   6. On explicit admin apply only, a participant with a frozen rank and a
--      verified syllabus Skill count below 10 has the false rank cleared. A
--      participant at 10+ keeps the rank permanently locked.

begin;

-- ------------------------------------------------------------------
-- 1. Database copy of the whitelist. No client role may write it.
-- ------------------------------------------------------------------
create table if not exists public.official_campaign_syllabus (
  badge_key text primary key,
  display_name text not null unique,
  source text not null default 'official:campaign_syllabus',
  created_at timestamptz not null default now(),
  constraint official_campaign_syllabus_key_format check (
    badge_key ~ '^course_template:[1-9][0-9]{0,19}$'
  ),
  constraint official_campaign_syllabus_name_format check (
    length(btrim(display_name)) between 1 and 200
    and display_name !~ '[[:cntrl:]]'
  )
);

alter table public.official_campaign_syllabus enable row level security;
revoke all on table public.official_campaign_syllabus from anon, authenticated;

insert into public.official_campaign_syllabus (badge_key, display_name)
values
  ('course_template:633', 'Analyze Images with the Cloud Vision API'),
  ('course_template:638', 'Build a Website on Google Cloud'),
  ('course_template:702', 'Configure Service Accounts and IAM Roles for Google Cloud'),
  ('course_template:1586', 'Create Your First Gemini Enterprise Application'),
  ('course_template:1426', 'Develop AI-Powered Prototypes in Google AI Studio'),
  ('course_template:959', 'Explore Generative AI in Agent Platform'),
  ('course_template:700', 'Implement Speech and Language Solutions with Pre-trained APIs'),
  ('course_template:658', 'Store, Process, and Manage Data on Google Cloud - Console'),
  ('course_template:754', 'The Basics of Google Cloud Compute'),
  ('course_template:756', 'Using the Google Cloud Speech API')
on conflict (badge_key) do update
set display_name = excluded.display_name,
    source = 'official:campaign_syllabus';

-- ------------------------------------------------------------------
-- 2. Catalog reclassification. Idempotent and fully audited.
-- ------------------------------------------------------------------
do $$
declare
  v_syllabus record;
  v_course record;
begin
  -- Restore/create any missing official row.
  for v_syllabus in
    select syllabus.badge_key, syllabus.display_name
    from public.official_campaign_syllabus as syllabus
    where not exists (
      select 1 from public.badge_catalog as catalog
      where catalog.badge_key = syllabus.badge_key
    )
  loop
    insert into public.badge_catalog (badge_key, display_name, category, source)
    values (v_syllabus.badge_key, v_syllabus.display_name, 'skill', 'official:campaign_syllabus');

    insert into public.badge_catalog_audit_events (
      badge_key, previous_category, new_category,
      previous_display_name, new_display_name, reason, actor_user_id
    ) values (
      v_syllabus.badge_key, null, 'skill', null, v_syllabus.display_name,
      'Official 10-badge campaign syllabus', null
    );
  end loop;

  -- The only ten skill rows must match the exact key and title.
  for v_syllabus in
    select catalog.badge_key, catalog.display_name as previous_display_name,
           catalog.category as previous_category, syllabus.display_name
    from public.badge_catalog as catalog
    join public.official_campaign_syllabus as syllabus
      on syllabus.badge_key = catalog.badge_key
    where catalog.category is distinct from 'skill'
       or catalog.display_name is distinct from syllabus.display_name
  loop
    insert into public.badge_catalog_audit_events (
      badge_key, previous_category, new_category,
      previous_display_name, new_display_name, reason, actor_user_id
    ) values (
      v_syllabus.badge_key, v_syllabus.previous_category, 'skill',
      v_syllabus.previous_display_name, v_syllabus.display_name,
      'Official 10-badge campaign syllabus', null
    );

    update public.badge_catalog as catalog
    set category = 'skill',
        display_name = v_syllabus.display_name,
        source = 'official:campaign_syllabus'
    where catalog.badge_key = v_syllabus.badge_key;
  end loop;

  -- Every other course template, including stale unclassified rows, is ignored.
  for v_course in
    select catalog.badge_key, catalog.display_name, catalog.category as previous_category
    from public.badge_catalog as catalog
    where catalog.badge_key like 'course_template:%'
      and not exists (
        select 1 from public.official_campaign_syllabus as syllabus
        where syllabus.badge_key = catalog.badge_key
      )
      and catalog.category is distinct from 'ignored'
  loop
    insert into public.badge_catalog_audit_events (
      badge_key, previous_category, new_category,
      previous_display_name, new_display_name, reason, actor_user_id
    ) values (
      v_course.badge_key, v_course.previous_category, 'ignored',
      v_course.display_name, v_course.display_name,
      'Outside official 10-badge campaign syllabus', null
    );

    update public.badge_catalog as catalog
    set category = 'ignored',
        source = case
          when catalog.source like 'staged:%' then 'staged:non_syllabus'
          else catalog.source
        end
    where catalog.badge_key = v_course.badge_key;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 3. Permanently enforce the catalog lock. Inserts auto-classify course
--    templates; updates reject any attempt to change the locked membership.
-- ------------------------------------------------------------------
create or replace function private.enforce_official_campaign_syllabus_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_syllabus boolean;
  v_syllabus_name text;
  v_is_course boolean := new.badge_key like 'course_template:%';
begin
  if v_is_course then
    select true, syllabus.display_name
      into v_is_syllabus, v_syllabus_name
    from public.official_campaign_syllabus as syllabus
    where syllabus.badge_key = new.badge_key;

    v_is_syllabus := coalesce(v_is_syllabus, false);

    if tg_op = 'INSERT' then
      if v_is_syllabus then
        -- A fresh environment can recreate a syllabus row safely.
        new.display_name := v_syllabus_name;
        new.category := 'skill';
        new.source := 'official:campaign_syllabus';
      else
        new.category := 'ignored';
        if new.source like 'staged:%' then
          new.source := 'staged:non_syllabus';
        end if;
      end if;
    else
      if v_is_syllabus then
        if new.display_name is distinct from v_syllabus_name
          or new.category is distinct from 'skill' then
          raise exception using
            errcode = '22023',
            message = 'An official 10-badge campaign syllabus course must remain skill with its exact title';
        end if;
      elsif new.category is distinct from 'ignored' then
        raise exception using
          errcode = '22023',
          message = 'Non-syllabus course templates are always ignored';
      end if;
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_official_campaign_syllabus_catalog() from public;

drop trigger if exists badge_catalog_enforce_official_syllabus on public.badge_catalog;
create trigger badge_catalog_enforce_official_syllabus
before insert or update on public.badge_catalog
for each row execute function private.enforce_official_campaign_syllabus_catalog();

-- Keep auto-created non-syllabus audit records accurate and consistent.
create or replace function private.normalize_syllabus_catalog_audit_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.badge_key like 'course_template:%'
    and not exists (
      select 1 from public.official_campaign_syllabus as syllabus
      where syllabus.badge_key = new.badge_key
    ) then
    -- Auto-created audit rows are written before the catalog trigger result is
    -- visible to the staging RPC, so normalize both fields here.
    new.new_category := 'ignored';
    if new.reason is distinct from 'Outside official 10-badge campaign syllabus' then
      new.reason := 'Outside official 10-badge campaign syllabus';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.normalize_syllabus_catalog_audit_reason() from public;

drop trigger if exists badge_catalog_audit_normalize_syllabus_reason on public.badge_catalog_audit_events;
create trigger badge_catalog_audit_normalize_syllabus_reason
before insert on public.badge_catalog_audit_events
for each row execute function private.normalize_syllabus_catalog_audit_reason();

-- ------------------------------------------------------------------
-- 4. Staging metadata for clean preview details.
-- ------------------------------------------------------------------
alter table public.badge_sync_staged_badges
  add column if not exists detail_note text;
alter table public.badge_sync_staged_badges
  drop constraint if exists badge_sync_staged_detail_note_check;
alter table public.badge_sync_staged_badges
  add constraint badge_sync_staged_detail_note_check check (
    detail_note is null or length(btrim(detail_note)) between 1 and 200
  );

alter table public.badge_sync_participant_staging
  add column if not exists preview_details text[] not null default '{}'::text[];
alter table public.badge_sync_participant_staging
  drop constraint if exists badge_sync_participant_preview_details_check;
alter table public.badge_sync_participant_staging
  add constraint badge_sync_participant_preview_details_check check (
    cardinality(preview_details) <= 20
    and array_position(preview_details, null) is null
  );

-- Any insert path (including older staging RPCs) auto-ignores non-syllabus
-- courses and records the exact preview log line. game:* rows are untouched.
create or replace function private.auto_ignore_non_syllabus_staged_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.badge_key like 'course_template:%'
    and not exists (
      select 1 from public.official_campaign_syllabus as syllabus
      where syllabus.badge_key = new.badge_key
    ) then
    new.category := 'ignored';
    if new.status <> 'rejected' then
      new.status := 'ignored';
    end if;
    new.detail_note := 'Non-syllabus course (ignored)';
  end if;
  return new;
end;
$$;
revoke all on function private.auto_ignore_non_syllabus_staged_badge() from public;

drop trigger if exists badge_sync_staged_badges_auto_ignore_non_syllabus on public.badge_sync_staged_badges;
create trigger badge_sync_staged_badges_auto_ignore_non_syllabus
before insert on public.badge_sync_staged_badges
for each row execute function private.auto_ignore_non_syllabus_staged_badge();

-- Align already-staged rows from pre-migration runs without touching counts.
update public.badge_sync_staged_badges as staged
set category = 'ignored',
    status = case when staged.status = 'rejected' then 'rejected' else 'ignored' end,
    detail_note = 'Non-syllabus course (ignored)'
where staged.badge_key like 'course_template:%'
  and not exists (
    select 1 from public.official_campaign_syllabus as syllabus
    where syllabus.badge_key = staged.badge_key
  )
  and (
    staged.category is distinct from 'ignored'
    or staged.detail_note is distinct from 'Non-syllabus course (ignored)'
  );

-- ------------------------------------------------------------------
-- 5. Database-level cap on new verified Skill writes. Existing legacy rows are
--    deliberately left untouched here; they are corrected only when an admin
--    explicitly applies a syllabus preview.
-- ------------------------------------------------------------------
create or replace function private.enforce_official_syllabus_skill_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.skill_badge_count is not null
    and new.skill_badge_count > 10
    and (tg_op = 'INSERT' or new.skill_badge_count is distinct from old.skill_badge_count) then
    raise exception using
      errcode = '22023',
      message = 'Verified Skill count cannot exceed the official 10-badge syllabus cap';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_official_syllabus_skill_cap() from public;

drop trigger if exists participants_enforce_official_syllabus_skill_cap on public.participants;
create trigger participants_enforce_official_syllabus_skill_cap
before insert or update on public.participants
for each row execute function private.enforce_official_syllabus_skill_cap();

-- ------------------------------------------------------------------
-- 6. Frozen rank protection gains a narrow, apply-only reset path.
-- ------------------------------------------------------------------
create or replace function private.protect_frozen_rank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.frozen_rank is not null then
    if new.frozen_rank is not distinct from old.frozen_rank
      and new.rank_frozen_at is not distinct from old.rank_frozen_at then
      return new;
    end if;

    -- Set only by private.clear_false_frozen_ranks_on_apply(), inside the
    -- explicit admin apply transaction. Preview, migration and rollback never
    -- set this flag, so a legitimate frozen rank stays permanently locked.
    if coalesce(current_setting('badge_sync.allow_frozen_rank_reset', true), '') = 'on'
      and new.frozen_rank is null
      and new.rank_frozen_at is null then
      return new;
    end if;

    raise exception using
      errcode = '42501',
      message = 'A frozen rank cannot be changed once captured';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_frozen_rank() from public;

create or replace function private.clear_false_frozen_ranks_on_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared integer := 0;
  v_participants uuid[] := array[]::uuid[];
begin
  if new.status is distinct from 'applied' or old.status = 'applied' then
    return new;
  end if;

  -- Runs through an audited count writer have just finished. This is the only
  -- moment a false rank may be removed, and only for rows this run applied
  -- with a verified syllabus Skill count below 10.
  perform set_config('badge_sync.allow_frozen_rank_reset', 'on', true);

  with cleared as (
    update public.participants as participant
    set frozen_rank = null,
        rank_frozen_at = null
    from public.badge_sync_participant_staging as staging
    where staging.run_id = new.id
      and staging.participant_id = participant.id
      and staging.status = 'approved'
      and staging.observation_status = 'complete'
      and not staging.is_removed
      and staging.skill_count is not null
      and staging.skill_count < 10
      and participant.frozen_rank is not null
    returning participant.id
  )
  select count(*)::integer, coalesce(array_agg(cleared.id order by cleared.id), array[]::uuid[])
    into v_cleared, v_participants
  from cleared;

  perform set_config('badge_sync.allow_frozen_rank_reset', 'off', true);

  if jsonb_typeof(new.apply_result) = 'object' then
    new.apply_result := new.apply_result || jsonb_build_object(
      'frozen_ranks_cleared', v_cleared,
      'frozen_rank_cleared_participants', to_jsonb(v_participants)
    );
  end if;

  return new;
end;
$$;
revoke all on function private.clear_false_frozen_ranks_on_apply() from public;

drop trigger if exists badge_sync_runs_clear_false_frozen_ranks on public.badge_sync_runs;
create trigger badge_sync_runs_clear_false_frozen_ranks
before update on public.badge_sync_runs
for each row execute function private.clear_false_frozen_ranks_on_apply();

-- ------------------------------------------------------------------
-- 7. Fingerprint includes the new preview detail metadata.
-- ------------------------------------------------------------------
create or replace function private.badge_sync_fingerprint(p_run_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(
    jsonb_build_object(
      'run_id', run.id,
      'mode', run.mode,
      'participants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participant_id', staging.participant_id,
          'row_number', staging.row_number,
          'registration_status', staging.registration_status,
          'is_removed', staging.is_removed,
          'observation_status', staging.observation_status,
          'status', staging.status,
          'skill', staging.skill_count,
          'arcade', staging.arcade_count,
          'total', staging.total_count,
          'previous_total', staging.previous_verified_total,
          'previous_skill', staging.previous_skill_count,
          'previous_arcade', staging.previous_arcade_count,
          'previous_verified_at', case when staging.previous_last_verified_at is null then null
            else to_char(staging.previous_last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
          'previous_source', staging.previous_verification_source,
          'pending', staging.pending_badge_count,
          'unclassified', staging.unclassified_badge_count,
          'regression', staging.is_regression,
          'blocking_reason', staging.blocking_reason,
          'preview_details', staging.preview_details
        ) order by staging.participant_id)
        from public.badge_sync_participant_staging as staging
        where staging.run_id = run.id
      ), '[]'::jsonb),
      'badges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participant_id', staged.participant_id,
          'badge_key', staged.badge_key,
          'category', staged.category,
          'status', staged.status,
          'detail_note', staged.detail_note
        ) order by staged.participant_id, staged.badge_key)
        from public.badge_sync_staged_badges as staged
        where staged.run_id = run.id
      ), '[]'::jsonb)
    )::text
  )
  from public.badge_sync_runs as run
  where run.id = p_run_id;
$$;
revoke all on function private.badge_sync_fingerprint(uuid) from public;

-- ------------------------------------------------------------------
-- 8. Preview recompute mirrors the pure TypeScript engine.
-- ------------------------------------------------------------------
create or replace function private.badge_sync_recompute(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_participant public.badge_sync_participant_staging%rowtype;
  v_skill integer;
  v_arcade integer;
  v_pending integer;
  v_unclassified integer;
  v_preview_details text[];
  v_total integer;
  v_status text;
  v_reason text;
  v_is_regression boolean;
  v_corrects_invalid_skill boolean;
begin
  select runs.mode into v_mode
  from public.badge_sync_runs as runs
  where runs.id = p_run_id;
  if v_mode is null then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  update public.badge_sync_participant_staging as staging
  set participant_key = participant.participant_key,
      display_name = participant.display_name,
      registration_status = participant.registration_status,
      is_removed = (participant.registration_status = 'removed'),
      previous_verified_total = participant.verified_badge_count,
      previous_skill_count = participant.skill_badge_count,
      previous_arcade_count = participant.arcade_game_badge_count,
      previous_last_verified_at = participant.last_verified_at,
      previous_verification_source = participant.verification_source,
      applied_total = null,
      applied_skill = null,
      applied_arcade = null,
      applied_verified_at = null,
      applied_source = null,
      applied_at = null,
      applied_by = null
  from public.participants as participant
  where staging.run_id = p_run_id
    and staging.participant_id = participant.id;

  if v_mode = 'badge_observations' then
    -- Force non-syllabus course templates to ignored even if a stale catalog
    -- row still says otherwise. This path never blocks a valid syllabus badge.
    update public.badge_sync_staged_badges as staged
    set category = 'ignored',
        status = case when staged.status = 'rejected' then 'rejected' else 'ignored' end,
        detail_note = 'Non-syllabus course (ignored)'
    where staged.run_id = p_run_id
      and staged.badge_key like 'course_template:%'
      and not exists (
        select 1 from public.official_campaign_syllabus as syllabus
        where syllabus.badge_key = staged.badge_key
      )
      and (
        staged.category is distinct from 'ignored'
        or staged.detail_note is distinct from 'Non-syllabus course (ignored)'
      );

    -- Align remaining staged categories with explicit catalog decisions.
    update public.badge_sync_staged_badges as staged
    set category = catalog.category,
        status = case
          when catalog.category = 'unclassified' then 'unclassified'
          when catalog.category = 'ignored' then case when staged.status = 'rejected' then 'rejected' else 'ignored' end
          when staged.status in ('ignored', 'unclassified') then 'pending'
          else staged.status
        end,
        detail_note = null
    from public.badge_catalog as catalog
    where staged.run_id = p_run_id
      and staged.badge_key = catalog.badge_key
      and not (
        staged.badge_key like 'course_template:%'
        and not exists (
          select 1 from public.official_campaign_syllabus as syllabus
          where syllabus.badge_key = staged.badge_key
        )
      )
      and (
        staged.category is distinct from catalog.category
        or (catalog.category = 'ignored' and staged.status not in ('ignored', 'rejected'))
        or (catalog.category in ('skill', 'arcade') and staged.status in ('ignored', 'unclassified'))
        or staged.detail_note is not null
      );
  end if;

  for v_participant in
    select staging.*
    from public.badge_sync_participant_staging as staging
    where staging.run_id = p_run_id
    order by staging.participant_id
  loop
    if v_participant.is_removed then
      update public.badge_sync_participant_staging as staging
      set observation_status = 'failed',
          skill_count = null,
          arcade_count = null,
          total_count = null,
          delta = null,
          status = 'rejected',
          pending_badge_count = 0,
          unclassified_badge_count = 0,
          preview_details = array[]::text[],
          is_regression = false,
          is_stale = false,
          blocking_reason = 'Participant is removed; no count may be applied.'
      where staging.id = v_participant.id;
      continue;
    end if;

    if v_mode = 'classified_counts' then
      if v_participant.observation_status <> 'complete'
        or v_participant.skill_count is null
        or v_participant.arcade_count is null
        or v_participant.total_count is null then
        v_skill := null;
        v_arcade := null;
        v_total := null;
        v_pending := 0;
        v_unclassified := 0;
        v_preview_details := array[]::text[];
        v_status := 'rejected';
        v_reason := 'Observation is not complete; counts are unknown, not zero.';
      else
        -- The official syllabus has exactly ten identities.
        v_skill := least(v_participant.skill_count, 10);
        v_arcade := v_participant.arcade_count;
        v_total := v_skill + v_arcade;
        v_pending := 0;
        v_unclassified := 0;
        v_preview_details := array[]::text[];
        v_is_regression := v_total < v_participant.previous_verified_total;
        v_corrects_invalid_skill := v_participant.previous_skill_count is not null
          and v_participant.previous_skill_count > 10
          and v_skill <= 10;
        if v_is_regression and not v_corrects_invalid_skill then
          v_status := 'rejected';
          v_reason := 'Regression: the proposed total is below the previous verified total.';
        else
          v_status := 'approved';
          v_reason := null;
          if v_is_regression and v_corrects_invalid_skill then
            v_preview_details := array['Official syllabus correction; previous Skill total exceeded 10.']::text[];
          end if;
        end if;
      end if;
    elsif v_participant.observation_status <> 'complete' then
      v_skill := null;
      v_arcade := null;
      v_total := null;
      v_pending := 0;
      v_unclassified := 0;
      v_preview_details := array[]::text[];
      v_status := 'rejected';
      v_reason := case
        when v_participant.observation_status = 'incomplete' then 'Observation is incomplete; counts are unknown, not zero.'
        else 'Observation failed; counts are unknown, not zero.'
      end;
    else
      select
        least(count(*) filter (where staged.category = 'skill' and staged.status = 'approved'), 10)::integer,
        count(*) filter (where staged.category = 'arcade' and staged.status = 'approved'),
        count(*) filter (where staged.status = 'pending'),
        count(*) filter (where staged.category = 'unclassified' or staged.status = 'unclassified'),
        coalesce(
          array_agg(distinct staged.detail_note order by staged.detail_note)
            filter (where staged.detail_note is not null),
          array[]::text[]
        )
      into v_skill, v_arcade, v_pending, v_unclassified, v_preview_details
      from public.badge_sync_staged_badges as staged
      where staged.run_id = p_run_id
        and staged.participant_id = v_participant.participant_id;

      v_total := v_skill + v_arcade;
      v_is_regression := v_total < v_participant.previous_verified_total;
      v_corrects_invalid_skill := v_participant.previous_skill_count is not null
        and v_participant.previous_skill_count > 10
        and v_skill <= 10;

      if v_unclassified > 0 then
        v_status := 'unclassified';
        v_reason := 'Unclassified badge identities must be classified in the managed catalog.';
      elsif v_pending > 0 then
        v_status := 'pending';
        v_reason := 'Pending badge identities require explicit admin approval.';
      elsif v_is_regression and not v_corrects_invalid_skill then
        v_status := 'rejected';
        v_reason := 'Regression: the proposed total is below the previous verified total.';
      else
        v_status := 'approved';
        v_reason := null;
        if v_is_regression and v_corrects_invalid_skill then
          v_preview_details := v_preview_details
            || array['Official syllabus correction; previous Skill total exceeded 10.']::text[];
          select coalesce(array_agg(detail order by detail), array[]::text[])
            into v_preview_details
          from unnest(v_preview_details) as details(detail);
        end if;
      end if;
    end if;

    update public.badge_sync_participant_staging as staging
    set skill_count = v_skill,
        arcade_count = v_arcade,
        total_count = v_total,
        delta = case when v_total is null then null else v_total - staging.previous_verified_total end,
        status = v_status,
        pending_badge_count = v_pending,
        unclassified_badge_count = v_unclassified,
        preview_details = v_preview_details,
        is_regression = (v_total is not null and v_total < staging.previous_verified_total),
        is_stale = false,
        blocking_reason = v_reason
    where staging.id = v_participant.id;
  end loop;

  update public.badge_sync_runs as run
  set total_participants = aggregates.participant_count,
      total_skill = aggregates.skill_total,
      total_arcade = aggregates.arcade_total,
      total_badges = aggregates.skill_total + aggregates.arcade_total,
      unclassified_participant_count = aggregates.unclassified_count,
      pending_participant_count = aggregates.pending_count,
      blocked_participant_count = aggregates.blocked_count
  from (
    select
      count(*) filter (where evaluated.is_eligible)::integer as participant_count,
      coalesce(sum(evaluated.skill_count) filter (where evaluated.is_eligible), 0)::integer as skill_total,
      coalesce(sum(evaluated.arcade_count) filter (where evaluated.is_eligible), 0)::integer as arcade_total,
      count(*) filter (where evaluated.status = 'unclassified')::integer as unclassified_count,
      count(*) filter (where evaluated.status = 'pending')::integer as pending_count,
      count(*) filter (where not evaluated.is_eligible)::integer as blocked_count
    from (
      select
        staging.*,
        (staging.status = 'approved'
          and staging.observation_status = 'complete'
          and not staging.is_removed
          and staging.skill_count is not null
          and staging.arcade_count is not null
          and staging.total_count is not null) as is_eligible
      from public.badge_sync_participant_staging as staging
      where staging.run_id = p_run_id
    ) as evaluated
  ) as aggregates
  where run.id = p_run_id;
end;
$$;
revoke all on function private.badge_sync_recompute(uuid) from public;

-- ------------------------------------------------------------------
-- 9. Snapshot exposes preview details and per-badge ignore notes.
-- ------------------------------------------------------------------
create or replace function public.admin_get_badge_sync_snapshot(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.badge_sync_runs%rowtype;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  select runs.* into v_run from public.badge_sync_runs as runs where runs.id = p_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Badge sync run not found';
  end if;

  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id,
      'mode', v_run.mode,
      'status', v_run.status,
      'source', v_run.source,
      'source_filename', v_run.source_filename,
      'source_sha256', v_run.source_sha256,
      'note', v_run.note,
      'preview_fingerprint', v_run.preview_fingerprint,
      'previewed_at', case when v_run.previewed_at is null then null
        else to_char(v_run.previewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'approved_at', case when v_run.approved_at is null then null
        else to_char(v_run.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'approved_by', v_run.approved_by,
      'applied_at', case when v_run.applied_at is null then null
        else to_char(v_run.applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'apply_request_id', v_run.apply_request_id,
      'apply_result', v_run.apply_result,
      'rolled_back_at', case when v_run.rolled_back_at is null then null
        else to_char(v_run.rolled_back_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'rollback_result', v_run.rollback_result,
      'total_participants', v_run.total_participants,
      'total_skill', v_run.total_skill,
      'total_arcade', v_run.total_arcade,
      'total_badges', v_run.total_badges,
      'unclassified_participant_count', v_run.unclassified_participant_count,
      'pending_participant_count', v_run.pending_participant_count,
      'blocked_participant_count', v_run.blocked_participant_count,
      'created_at', to_char(v_run.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', staging.id,
        'participant_id', staging.participant_id,
        'participant_key', staging.participant_key,
        'display_name', staging.display_name,
        'row_number', staging.row_number,
        'registration_status', staging.registration_status,
        'is_removed', staging.is_removed,
        'observation_status', staging.observation_status,
        'status', staging.status,
        'skill_count', staging.skill_count,
        'arcade_count', staging.arcade_count,
        'total_count', staging.total_count,
        'previous_verified_total', staging.previous_verified_total,
        'previous_skill_count', staging.previous_skill_count,
        'previous_arcade_count', staging.previous_arcade_count,
        'previous_last_verified_at', case when staging.previous_last_verified_at is null then null
          else to_char(staging.previous_last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'previous_verification_source', staging.previous_verification_source,
        'delta', staging.delta,
        'pending_badge_count', staging.pending_badge_count,
        'unclassified_badge_count', staging.unclassified_badge_count,
        'is_regression', staging.is_regression,
        'is_stale', staging.is_stale,
        'blocking_reason', staging.blocking_reason,
        'review_note', staging.review_note,
        'preview_details', staging.preview_details,
        'applied_total', staging.applied_total,
        'applied_skill_count', staging.applied_skill,
        'applied_arcade_count', staging.applied_arcade,
        'applied_verified_at', case when staging.applied_verified_at is null then null
          else to_char(staging.applied_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'applied_source', staging.applied_source,
        'applied_at', case when staging.applied_at is null then null
          else to_char(staging.applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
      ) order by staging.row_number)
      from public.badge_sync_participant_staging as staging
      where staging.run_id = v_run.id
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', staged.id,
        'participant_id', staged.participant_id,
        'participant_staging_id', staged.participant_staging_id,
        'badge_key', staged.badge_key,
        'badge_title', staged.badge_title,
        'source_badge_id', staged.source_badge_id,
        'category', staged.category,
        'status', staged.status,
        'observed_at', case when staged.observed_at is null then null
          else to_char(staged.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'earned_on', staged.earned_on,
        'detail_note', staged.detail_note
      ) order by staged.participant_id, staged.badge_key)
      from public.badge_sync_staged_badges as staged
      where staged.run_id = v_run.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_get_badge_sync_snapshot(uuid) from public, anon;
grant execute on function public.admin_get_badge_sync_snapshot(uuid) to authenticated;

commit;
