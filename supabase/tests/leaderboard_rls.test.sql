begin;
select plan(10);

select set_config(
  'test.registered_before',
  (select count(*)::text from public.participants where registration_status = 'registered'),
  true
);
insert into public.participants (participant_key, display_name, registration_status, verified_badge_count)
values
  ('rls-test-public', 'RLS Test Public', 'registered', 5),
  ('rls-test-pending', 'RLS Test Pending', 'pending', 9);
insert into public.participant_audit_events (participant_id, event_type, new_badge_count, source)
select id, 'participant_imported', 0, 'csv_import'
from public.participants
where participant_key = 'rls-test-public';
select set_config(
  'test.public_participant_id',
  (select id::text from public.participants where participant_key = 'rls-test-public'),
  true
);

set local role anon;
select is(
  (select count(display_name) from public.participants where display_name like 'RLS Test%'),
  1::bigint,
  'anonymous users see registered rows only'
);
select throws_ok(
  $$select participant_key from public.participants where display_name = 'RLS Test Public'$$,
  '42501', null,
  'anonymous users cannot select stable participant keys'
);
select is(
  public.get_public_summary() ->> 'registered_count',
  (current_setting('test.registered_before')::integer + 1)::text,
  'public aggregate exposes only the registered participant count'
);
select throws_ok(
  $$select * from public.admin_import_participants('[]'::jsonb)$$,
  '42501', null,
  'anonymous users cannot execute participant import'
);
select throws_ok(
  $$select note from public.participant_audit_events$$,
  '42501', null,
  'anonymous users cannot read participant audit history'
);
select throws_ok(
  $$select * from public.admin_sync_google_form_participants('[]'::jsonb)$$,
  '42501', null,
  'anonymous users cannot execute Google Form synchronization'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (select count(display_name) from public.participants where display_name like 'RLS Test%'),
  0::bigint,
  'authenticated non-admin users cannot read participant rows'
);
select is(
  (select count(id) from public.participant_audit_events where participant_id = current_setting('test.public_participant_id')::uuid),
  0::bigint,
  'authenticated non-admin users cannot read participant audit history'
);
select throws_ok(
  $$select * from public.admin_set_verified_badge_count('00000000-0000-0000-0000-000000000002'::uuid, 4, 'test')$$,
  '42501', 'Admin access required',
  'authenticated non-admin users cannot change badge counts'
);
select throws_ok(
  $$select * from public.admin_sync_google_form_participants('[]'::jsonb)$$,
  '42501', 'Admin access required',
  'authenticated non-admin users cannot synchronize Google Form responses'
);

select * from finish();
rollback;
