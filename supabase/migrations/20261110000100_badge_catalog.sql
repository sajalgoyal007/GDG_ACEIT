-- Managed Badge Catalog.
--
-- Identity is the structural modal target seen on the public Google Skills
-- profile, never the award-scoped /badges/<id> URL:
--   /course_templates/<id> -> course_template:<id>
--   /games/<id>            -> game:<id>
--
-- Categories:
--   skill | arcade | ignored | unclassified
--
-- Unknown structural signals are inserted by the staging RPC as
-- `unclassified`. Only an explicit, audited admin category update can change
-- a catalog category. Rows referenced by badge sync staging cannot be deleted,
-- and no client role receives insert/update/delete privileges.
--
-- Seed provenance: data/raw_profiles-2026-11-09/badge-classification.csv
--   324 verified award rows -> 64 distinct structural definitions
--   47 Skill + 17 Arcade + 0 Unknown
-- Re-generate with: node scripts/badge-catalog-seed.mjs

create table public.badge_catalog (
  badge_key text primary key,
  display_name text not null,
  category text not null default 'unclassified',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint badge_catalog_key_format check (
    badge_key ~ '^(course_template|game):[1-9][0-9]{0,19}$'
  ),
  constraint badge_catalog_name_format check (
    length(btrim(display_name)) between 1 and 200
    and display_name !~ '[[:cntrl:]]'
  ),
  constraint badge_catalog_source_format check (
    length(btrim(source)) between 1 and 120
  ),
  constraint badge_catalog_category_check check (
    category in ('skill', 'arcade', 'ignored', 'unclassified')
  ),
  -- A structural identity can never become the opposite award type. It can
  -- still be ignored or remain unclassified until an admin classifies it.
  constraint badge_catalog_structural_category check (
    (badge_key like 'course_template:%' and category in ('skill', 'ignored', 'unclassified'))
    or (badge_key like 'game:%' and category in ('arcade', 'ignored', 'unclassified'))
  )
);

create table public.badge_catalog_audit_events (
  id uuid primary key default gen_random_uuid(),
  badge_key text not null references public.badge_catalog(badge_key) on delete restrict,
  previous_category text,
  new_category text not null,
  previous_display_name text,
  new_display_name text not null,
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint badge_catalog_audit_previous_category_check check (
    previous_category is null or previous_category in ('skill', 'arcade', 'ignored', 'unclassified')
  ),
  constraint badge_catalog_audit_new_category_check check (
    new_category in ('skill', 'arcade', 'ignored', 'unclassified')
  ),
  constraint badge_catalog_audit_reason_check check (
    reason is null or length(btrim(reason)) between 1 and 1000
  ),
  constraint badge_catalog_audit_change_shape check (
    previous_category is distinct from new_category
    or previous_display_name is distinct from new_display_name
  )
);

create index badge_catalog_category_idx on public.badge_catalog (category);
create index badge_catalog_audit_key_created_idx
  on public.badge_catalog_audit_events (badge_key, created_at desc);

create trigger badge_catalog_set_updated_at
before update on public.badge_catalog
for each row execute function private.set_updated_at();

alter table public.badge_catalog enable row level security;
alter table public.badge_catalog_audit_events enable row level security;

revoke all on table public.badge_catalog from anon, authenticated;
revoke all on table public.badge_catalog_audit_events from anon, authenticated;

grant select on public.badge_catalog, public.badge_catalog_audit_events to authenticated;
create policy badge_catalog_admin_read
  on public.badge_catalog for select to authenticated
  using ((select private.is_admin()));
create policy badge_catalog_audit_admin_read
  on public.badge_catalog_audit_events for select to authenticated
  using ((select private.is_admin()));

-- ------------------------------------------------------------------
-- Admin-only catalog writes. There is deliberately no delete RPC.
-- ------------------------------------------------------------------
create or replace function public.admin_upsert_badge_catalog_entries(p_rows jsonb)
returns table(badge_key text, category text, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_key text;
  v_name text;
  v_category text;
  v_source text;
  v_existing public.badge_catalog%rowtype;
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
    raise exception using errcode = '22023', message = 'Catalog batch must contain 1 to 500 rows';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows) as items(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Catalog row must be an object';
    end if;
    v_key := v_item ->> 'badge_key';
    v_name := btrim(coalesce(v_item ->> 'display_name', ''));
    v_category := coalesce(v_item ->> 'category', 'unclassified');
    v_source := btrim(coalesce(v_item ->> 'source', 'manual'));

    if coalesce(v_key, '') !~ '^(course_template|game):[1-9][0-9]{0,19}$' then
      raise exception using errcode = '22023', message = 'Catalog key must be course_template:<id> or game:<id>';
    end if;
    if length(v_name) < 1 or length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'Catalog display name must be 1 to 200 printable characters';
    end if;
    if v_category not in ('skill', 'arcade', 'ignored', 'unclassified') then
      raise exception using errcode = '22023', message = 'Catalog category is invalid';
    end if;
    if (v_key like 'course_template:%' and v_category = 'arcade')
      or (v_key like 'game:%' and v_category = 'skill') then
      raise exception using errcode = '22023', message = 'Catalog category conflicts with the structural badge type';
    end if;
    if length(v_source) < 1 or length(v_source) > 120 then
      raise exception using errcode = '22023', message = 'Catalog source must be 1 to 120 characters';
    end if;

    select catalog.* into v_existing
    from public.badge_catalog as catalog
    where catalog.badge_key = v_key
    for update;
    if found then
      if v_existing.category is distinct from v_category then
        raise exception using errcode = '22023',
          message = 'Catalog category changes require an explicit audited category update';
      end if;
      if v_existing.display_name is distinct from v_name or v_existing.source is distinct from v_source then
        update public.badge_catalog as catalog
        set display_name = v_name,
            source = v_source,
            updated_by = v_actor
        where catalog.badge_key = v_key;
      end if;
      badge_key := v_key;
      category := v_category;
      inserted := false;
      return next;
    else
      insert into public.badge_catalog (badge_key, display_name, category, source, updated_by)
      values (v_key, v_name, v_category, v_source, v_actor);
      insert into public.badge_catalog_audit_events (
        badge_key, previous_category, new_category,
        previous_display_name, new_display_name, reason, actor_user_id
      ) values (
        v_key, null, v_category, null, v_name, 'Catalog entry created', v_actor
      );
      badge_key := v_key;
      category := v_category;
      inserted := true;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.admin_upsert_badge_catalog_entries(jsonb) from public, anon;
grant execute on function public.admin_upsert_badge_catalog_entries(jsonb) to authenticated;

create or replace function public.admin_update_badge_catalog_category(
  p_badge_key text,
  p_category text,
  p_display_name text,
  p_reason text
)
returns table(
  badge_key text,
  previous_category text,
  category text,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := btrim(coalesce(p_badge_key, ''));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing public.badge_catalog%rowtype;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Admin session required';
  end if;
  if v_key !~ '^(course_template|game):[1-9][0-9]{0,19}$' then
    raise exception using errcode = '22023', message = 'Catalog key must be course_template:<id> or game:<id>';
  end if;
  if p_category is null or p_category not in ('skill', 'arcade', 'ignored', 'unclassified') then
    raise exception using errcode = '22023', message = 'Catalog category is invalid';
  end if;
  if (v_key like 'course_template:%' and p_category = 'arcade')
    or (v_key like 'game:%' and p_category = 'skill') then
    raise exception using errcode = '22023', message = 'Catalog category conflicts with the structural badge type';
  end if;
  if length(v_reason) < 1 or length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Category change reason must be 1 to 1000 characters';
  end if;

  select catalog.* into v_existing
  from public.badge_catalog as catalog
  where catalog.badge_key = v_key
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Catalog entry not found';
  end if;

  if v_existing.category = p_category
    and (length(v_name) = 0 or v_existing.display_name = v_name) then
    badge_key := v_key;
    previous_category := v_existing.category;
    category := v_existing.category;
    changed := false;
    return next;
    return;
  end if;

  update public.badge_catalog as catalog
  set category = p_category,
      display_name = case when length(v_name) > 0 then v_name else catalog.display_name end,
      updated_by = v_actor
  where catalog.badge_key = v_key;

  insert into public.badge_catalog_audit_events (
    badge_key, previous_category, new_category,
    previous_display_name, new_display_name, reason, actor_user_id
  ) values (
    v_key, v_existing.category, p_category,
    v_existing.display_name,
    case when length(v_name) > 0 then v_name else v_existing.display_name end,
    v_reason, v_actor
  );

  badge_key := v_key;
  previous_category := v_existing.category;
  category := p_category;
  changed := true;
  return next;
end;
$$;
revoke all on function public.admin_update_badge_catalog_category(text, text, text, text) from public, anon;
grant execute on function public.admin_update_badge_catalog_category(text, text, text, text) to authenticated;

-- ------------------------------------------------------------------
-- Verified seed (2026-11-09). Do not add identities by title keyword.
-- ------------------------------------------------------------------
insert into public.badge_catalog (badge_key, display_name, category, source)
values
  ('course_template:1080', 'Machine Learning Operations (MLOps) with Agent Platform: Model Evaluation', 'skill', 'evidence:2026-11-09'),
  ('course_template:1171', 'Build a Certification Study Guide: PMLE', 'skill', 'evidence:2026-11-09'),
  ('course_template:1426', 'Develop AI-Powered Prototypes in Google AI Studio', 'skill', 'evidence:2026-11-09'),
  ('course_template:1449', 'AI Boost Bites: Your Personal Feedback Agent', 'skill', 'evidence:2026-11-09'),
  ('course_template:1585', 'Build Agents with Agent Development Kit (ADK)', 'skill', 'evidence:2026-11-09'),
  ('course_template:1586', 'Create Your First Gemini Enterprise Application', 'skill', 'evidence:2026-11-09'),
  ('course_template:388', 'Responsible AI: Applying AI Principles with Google Cloud', 'skill', 'evidence:2026-11-09'),
  ('course_template:536', 'Introduction to Generative AI', 'skill', 'evidence:2026-11-09'),
  ('course_template:539', 'Introduction to Large Language Models', 'skill', 'evidence:2026-11-09'),
  ('course_template:554', '[DEPRECATED]Introduction to Responsible AI', 'skill', 'evidence:2026-11-09'),
  ('course_template:624', 'Build a Data Warehouse with BigQuery', 'skill', 'evidence:2026-11-09'),
  ('course_template:626', 'Create ML Models with BigQuery ML', 'skill', 'evidence:2026-11-09'),
  ('course_template:631', 'Prepare Data for ML APIs on Google Cloud', 'skill', 'evidence:2026-11-09'),
  ('course_template:633', 'Analyze Images with the Cloud Vision API', 'skill', 'evidence:2026-11-09'),
  ('course_template:634', 'Analyze Speech and Language with Google APIs', 'skill', 'evidence:2026-11-09'),
  ('course_template:635', 'App Building with AppSheet', 'skill', 'evidence:2026-11-09'),
  ('course_template:638', 'Build a Website on Google Cloud', 'skill', 'evidence:2026-11-09'),
  ('course_template:641', 'Set Up a Google Cloud Network', 'skill', 'evidence:2026-11-09'),
  ('course_template:643', 'Create and Manage Cloud Spanner Instances', 'skill', 'evidence:2026-11-09'),
  ('course_template:647', '[Deprecated] Get Started with Looker', 'skill', 'evidence:2026-11-09'),
  ('course_template:658', 'Store, Process, and Manage Data on Google Cloud - Console', 'skill', 'evidence:2026-11-09'),
  ('course_template:659', 'Store, Process, and Manage Data on Google Cloud - Command Line', 'skill', 'evidence:2026-11-09'),
  ('course_template:662', 'Deploy and Secure Serverless APIs with API Gateway', 'skill', 'evidence:2026-11-09'),
  ('course_template:671', 'Deploy and Manage Applications on Google App Engine', 'skill', 'evidence:2026-11-09'),
  ('course_template:674', 'Automate Data Capture at Scale with Document AI', 'skill', 'evidence:2026-11-09'),
  ('course_template:676', 'Implement Cloud Collaboration and Productivity Workflows', 'skill', 'evidence:2026-11-09'),
  ('course_template:696', 'Build Serverless Applications with Cloud Run Functions', 'skill', 'evidence:2026-11-09'),
  ('course_template:700', 'Implement Speech and Language Solutions with Pre-trained APIs', 'skill', 'evidence:2026-11-09'),
  ('course_template:702', 'Configure Service Accounts and IAM Roles for Google Cloud', 'skill', 'evidence:2026-11-09'),
  ('course_template:715', 'Develop with Apps Script and AppSheet', 'skill', 'evidence:2026-11-09'),
  ('course_template:725', 'Implement Cloud Storage and Data Protection Solutions', 'skill', 'evidence:2026-11-09'),
  ('course_template:726', 'Organize and Govern Data with Knowledge Catalog', 'skill', 'evidence:2026-11-09'),
  ('course_template:728', 'Implement Event-Driven Messaging and Automation Workflows', 'skill', 'evidence:2026-11-09'),
  ('course_template:737', 'Integrate BigQuery Data and Google Workspace using Apps Script', 'skill', 'evidence:2026-11-09'),
  ('course_template:747', 'Monitoring in Google Cloud', 'skill', 'evidence:2026-11-09'),
  ('course_template:749', 'Monitor and Log with Google Cloud Observability', 'skill', 'evidence:2026-11-09'),
  ('course_template:754', 'The Basics of Google Cloud Compute', 'skill', 'evidence:2026-11-09'),
  ('course_template:755', 'Use APIs to Work with Cloud Storage', 'skill', 'evidence:2026-11-09'),
  ('course_template:756', 'Using the Google Cloud Speech API', 'skill', 'evidence:2026-11-09'),
  ('course_template:77', 'Build a Certification Study Guide: ACE Exam Prep', 'skill', 'evidence:2026-11-09'),
  ('course_template:783', 'Manage Kubernetes in Google Cloud', 'skill', 'evidence:2026-11-09'),
  ('course_template:927', 'Machine Learning Operations (MLOps) for Generative AI', 'skill', 'evidence:2026-11-09'),
  ('course_template:959', 'Explore Generative AI in Agent Platform', 'skill', 'evidence:2026-11-09'),
  ('course_template:976', 'Prompt Design in Agent Platform', 'skill', 'evidence:2026-11-09'),
  ('course_template:978', 'Develop Gen AI Apps with Gemini and Streamlit', 'skill', 'evidence:2026-11-09'),
  ('course_template:981', 'Inspect Rich Documents with Gemini Multimodality and Multimodal RAG', 'skill', 'evidence:2026-11-09'),
  ('course_template:985', 'Responsible AI for Developers: Fairness & Bias', 'skill', 'evidence:2026-11-09'),
  ('game:102804', 'Arcade Adventure: Google Cloud ML APIs', 'arcade', 'evidence:2026-11-09'),
  ('game:112152', 'Diwali in the Cloud', 'arcade', 'evidence:2026-11-09'),
  ('game:112153', 'Arcade Simulator: Cloud Infrastructure Engineer', 'arcade', 'evidence:2026-11-09'),
  ('game:1388', 'Level 3: GenAIus Registries', 'arcade', 'evidence:2026-11-09'),
  ('game:32788', 'Skills Boost Arcade Base Camp October 2025', 'arcade', 'evidence:2026-11-09'),
  ('game:32790', 'Level 2: Cloud Operations and Application Management', 'arcade', 'evidence:2026-11-09'),
  ('game:32800', 'Level 3: Generative AI', 'arcade', 'evidence:2026-11-09'),
  ('game:32818', 'Skills Boost Arcade Trivia October 2025 Week 1', 'arcade', 'evidence:2026-11-09'),
  ('game:32846', 'Level 1: Scalable Systems', 'arcade', 'evidence:2026-11-09'),
  ('game:33945', 'Diwali Dialogues', 'arcade', 'evidence:2026-11-09'),
  ('game:37018', 'Google Skills Arcade Certification Zone October 2025', 'arcade', 'evidence:2026-11-09'),
  ('game:39758', 'Google Skills Arcade Trivia November 2025 Week 1', 'arcade', 'evidence:2026-11-09'),
  ('game:39760', 'Google Skills Arcade Trivia November 2025 Week 3', 'arcade', 'evidence:2026-11-09'),
  ('game:76266', 'Arcade Base Camp July 2026', 'arcade', 'evidence:2026-11-09'),
  ('game:76267', 'Arcade Adventure: Low-Code Development', 'arcade', 'evidence:2026-11-09'),
  ('game:76271', 'Safe Spaces', 'arcade', 'evidence:2026-11-09'),
  ('game:80653', 'Arcade Base Camp August 2026', 'arcade', 'evidence:2026-11-09')
on conflict (badge_key) do nothing;
