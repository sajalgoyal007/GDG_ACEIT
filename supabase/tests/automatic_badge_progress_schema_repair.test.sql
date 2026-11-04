begin;
select plan(2);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'participant_auto_progress'
       and column_name = 'next_fetch_allowed_at'
       and data_type = 'timestamp with time zone'
  ),
  'automatic progress cooldown column exists with the expected type'
);

select ok(
  to_regprocedure('public.claim_participant_auto_fetch(uuid,integer)') is not null,
  'participant claim RPC remains installed after schema repair'
);

select * from finish();
rollback;
