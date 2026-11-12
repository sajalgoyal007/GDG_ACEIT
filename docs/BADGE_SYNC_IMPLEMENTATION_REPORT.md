# Badge Sync System — Local Implementation and Safety-Fix Report

**Date:** 2026-11-09
**Verdict:** Local implementation is complete and **fully verified against a local Supabase/PostgreSQL database** (Phase 1.4). **READY FOR A SEPARATE DEPLOYMENT-READINESS REVIEW — NOT YET DEPLOYED.**
**Production project ref:** `fyuuvdsfxnytaumoehkx`
**Production URL:** `https://gdg-aceit.vercel.app`

Nothing in this change set has been applied to a production database, committed, staged, pushed, or deployed. No Google profile fetch, cron, worker, feature flag, or production participant change was made. All database execution in Phase 1.4 used an explicit `--local` target.

---

## 1. Executive status

Phase 1.3 addressed the critical audit findings in the badge-sync design:

- Rollback is now current-state-aware, atomic per batch, removed-participant aware, later-run aware, and idempotent.
- Preview totals now count only the rows Apply will actually write. SQL and TypeScript use the same eligibility rule.
- A same-total but different Skill/Arcade split is rejected with `40001`.
- Apply and rollback now have a durable, per-participant operation ledger keyed by `(run_id, participant_id, operation_type)`.
- The bulk classified writer and rollback RPC remain backward compatible with the legacy nine-key and seven-key manual CSV payloads.
- Authorization is explicitly documented as a shared-admin operations policy with server-side admin checks.

**Verification status (after Phase 1.4 local database execution):**

| Check | Result |
| :--- | :--- |
| Local Supabase stack | **running** — DB `127.0.0.1:54322`, API `127.0.0.1:54321`; `supabase status` confirms local |
| `npx supabase db reset --local` | **pass** — all 22 migrations applied in order |
| pgTAP SQL suites (`npx supabase test db --local`) | **PASS** — 16 files, **383 assertions, 0 failures** |
| Two-session concurrency script (`npm run test:badge-sync-concurrency`) | **PASS** — different-request-id and same-request-id applies each wrote once, replayed, no duplicate audit/ledger rows |
| Post-test integrity | **clean** — see section 11.5 |
| `npm test` | **269 passing, 0 failing, 0 skipped** |
| `npm run typecheck` | **pass** |
| Targeted ESLint on changed/new files | **clean** |
| `npm run lint` | **2 pre-existing errors** in `scripts/parse_saved_profiles.ts` (`no-explicit-any`), unrelated to this work |
| `node scripts/badge-catalog-seed.mjs` | **pass** — 324 awards → 64 definitions (47 Skill + 17 Arcade) |
| Production DB / deploy / Git commit | **untouched** |

---

## 2. Scope and hard constraints

Local implementation only. The following were deliberately not performed:

- No connection to the production database and no writes, migrations, repairs, or `supabase db push`.
- No Vercel deployment, Git commit, stage, or push.
- No Google profile fetching, cron, workers, or feature-flag changes.
- No production participant changes and no deletion of audit history.
- No direct writes to `frozen_rank`, `rank_frozen_at`, or `finish_rank`.
- No Supabase project-ref change and no migration-history reconciliation.
- No migration renaming.

Existing functionality and existing tests were preserved. No test was weakened to pass.

---

## 3. Files created

| File | Purpose |
| :--- | :--- |
| `supabase/migrations/20261110000100_badge_catalog.sql` | Managed catalog, audited category changes, delete protection, RLS, verified seed. NULL category now returns `22023`. |
| `supabase/migrations/20261110000200_badge_sync_staging.sql` | Persistent runs, participant staging, staged badges, applied snapshot columns, eligible-only aggregates, fingerprint/recompute, preview/approve/stage RPCs, classified-run RPC. |
| `supabase/migrations/20261110000300_badge_sync_apply.sql` | Replacement bulk setter, durable operation ledger, idempotent apply/rollback wrappers, replacement current-state-aware bulk rollback RPC. |
| `supabase/rollbacks/20261110000300_badge_sync_apply_schema_rollback.sql` | Restores the exact `20261105000100` function bodies and drops every object introduced by migration 3. |
| `supabase/tests/badge_sync.test.sql` | Expanded pgTAP coverage for the new behavior. Written, **not executed**. |
| `scripts/badge-catalog-seed.mjs` | Verifies the evidence CSV and regenerates the 64-definition seed. |
| `scripts/test-badge-sync-concurrency.mjs` | Reproducible two-session PostgreSQL concurrency check. Written, **not executed**. |
| `src/lib/badges/identity.ts` | Structural identity parsing/normalization. |
| `src/lib/badges/catalog.ts` | Category model, classification rules, catalog helpers. |
| `src/lib/badges/run-state.ts` | Lifecycle state machine. |
| `src/lib/badges/preview.ts` | Deterministic preview and eligible-only totals. |
| `src/lib/badges/snapshot.ts` | RPC transport types; preserves NULL counts. |
| `src/lib/badges/observations.ts` | Observation staging model. |
| `src/lib/badges/rpc-error.ts` | Shared clean mapper for stale (`40001`), reused request id (`22023`), and non-admin (`42501`) RPC failures. |
| `src/lib/badges/*.test.ts` | Unit tests for the above. |
| `src/app/admin/badge-sync-actions.ts` | Admin server actions for catalog and observation runs. |
| `src/app/admin/badge-sync-state.ts` | Action state types. |
| `docs/BADGE_SYNC_IMPLEMENTATION_REPORT.md` | This report. |

---

## 4. Files modified

| File | Change |
| :--- | :--- |
| `src/app/admin/actions.ts` | Preview/apply are run-based; snapshot eligibility, authoritative totals, NULL blocked counts, clean RPC error mapping. |
| `src/app/admin/classified-badge-import-state.ts` | Count fields widened to `number \| null` so blocked rows are not shown as zero. |
| `src/components/classified-badge-csv-import.tsx` | Blocked rows render `Not applied (status)` and `—`; CSV export writes `Not applied` for NULL counts. |
| `src/lib/participants/classified-badge-csv.ts` | Review notes reject every C0 control and DEL. |
| `src/lib/participants/classified-badge-csv.test.ts` | Added control-character regression test. |
| `src/lib/badges/preview.test.ts` | Added eligible-only total tests. |
| `src/lib/badges/snapshot.test.ts` | Added NULL-count preservation test. |
| `supabase/tests/classified_badge_counts.test.sql` | Added legacy payload, stale-split, and repeated-rollback tests; added `finish()`/`rollback`; plan raised to 34. |
| `package.json` | Added badge tests to `npm test`; added `test:badge-sync-concurrency`. |

---

## 5. Migration order, dependencies, and replacement notice

Apply in this order:

1. `supabase/migrations/20261110000100_badge_catalog.sql`
2. `supabase/migrations/20261110000200_badge_sync_staging.sql`
3. `supabase/migrations/20261110000300_badge_sync_apply.sql`

Required pre-existing migrations:

- `20261026000100_leaderboard.sql` — `private.is_admin()`, participant audit schema.
- `20261104000100_classified_badge_counts.sql` — original classified bulk setter/rollback and Skill/Arcade columns.
- `20261104000200_remove_five_badge_summary.sql` — current `get_public_summary()` shape.
- `20261105000100_ten_skill_badge_rank_freeze.sql` — frozen-rank columns, triggers, and the immediately previous bulk setter/rollback bodies.
- `20261106000100_participant_soft_removal.sql` — `registration_status = 'removed'`, `removed_at`, `removal_reason`, and constraints.

**Migration 3 is not purely additive.** It replaces:

- `public.admin_bulk_set_classified_badge_counts(jsonb)`
- `public.admin_bulk_rollback_classified_badge_counts(jsonb)`

The replacement is deliberate because the already-deployed manual CSV client calls those exact function names. The legacy nine-key setter payload and seven-key rollback payload still work unchanged. Migration 3 also adds `public.admin_apply_badge_sync_run`, `public.admin_rollback_badge_sync_run`, the `badge_sync_operation_ledger` table, and request-id uniqueness indexes.

`20261110000200` depends on `20261110000100`. `20261110000300` depends on both staging and the `20261105000100` frozen-rank functions.

This work does **not** assume `20261102000200_idempotent_manual_badge_verification.sql` exists in production. The sync path does not call the old single-badge verification RPC.

---

## 6. Critical safety fixes (P0)

### 6.1 Current-state-aware rollback

`admin_rollback_badge_sync_run` and `admin_bulk_rollback_classified_badge_counts` now enforce:

- The run must be `applied`; rollback happens at most once.
- The run row is locked `FOR UPDATE`; a duplicate request returns the stored result.
- Every participant row is locked in stable UUID order and the whole batch is validated **before** the first write.
- The live participant state must still equal the post-apply snapshot: total, Skill, Arcade, timestamp, and source.
- A removed participant is rejected with `22023`.
- A changed participant is rejected with `40001`, and the whole batch aborts atomically.
- A later applied run that touched the same participant blocks an older rollback with `40001`, even when the later run wrote an identical value.
- A participant already at the target is returned without a new audit event, so retries are idempotent.
- Audit history is appended, never deleted. Frozen ranks are never cleared.

The apply wrapper records `applied_total`, `applied_skill`, `applied_arcade`, `applied_verified_at`, `applied_source`, `applied_at`, and `applied_by` on every written staging row. Rollback refuses to proceed for an applied run with no post-apply snapshot.

### 6.2 Preview/Apply total parity

SQL and TypeScript now use the same eligible filter:

```text
status = 'approved'
AND observation_status = 'complete'
AND NOT is_removed
AND skill_count IS NOT NULL
AND arcade_count IS NOT NULL
AND total_count IS NOT NULL
```

- `total_participants`, `total_skill`, `total_arcade`, and `total_badges` count only applicable rows.
- `blocked_participant_count` counts every staged row that is not applicable.
- The UI reads the run aggregate, not a client-side recount.
- Blocked rows display `Not applied` / `—`, never `0`.

---

## 7. High-priority fixes (P1)

### 7.1 Same-total split race

The apply path sends optional `expected_skill_count` and `expected_arcade_count`. The bulk setter compares them with the locked live row. If the total matches but the split changed after preview, it raises `40001` and writes nothing. The fields are optional so old manual CSV payloads remain valid.

### 7.2 Durable audit idempotency

`public.badge_sync_operation_ledger` has:

- `unique (run_id, participant_id, operation_type)`
- `operation_type in ('apply', 'rollback')`
- request id, actor, previous and new total/split/timestamp/source, and the per-row result JSON.

Apply and rollback retries return the stored run result and never duplicate ledger rows. A later legitimate run creates new rows because `run_id` differs. Manual CSV calls that bypass the run wrapper are unaffected.

### 7.3 Authorization and run ownership

The policy is now explicit: **shared-admin operations**.

- Any current admin may preview, approve, apply, or roll back any run.
- `created_by`, `approved_by`, `applied_by`, and `rolled_back_by` are recorded for accountability, not as an ownership restriction.
- Every RPC re-checks `private.is_admin()` and a non-null `auth.uid()` server-side.
- Non-admin authenticated callers are rejected with `42501`.
- Anonymous clients cannot execute the RPCs or write the ledger.

If a future policy change requires per-admin ownership, enforce it against `created_by`/`approved_by` in addition to the existing admin check; do not remove the admin check.

### 7.4 Migration 3 replacement compatibility

- The legacy manual CSV setter payload (nine keys) is accepted and tested.
- The legacy manual rollback payload (seven keys) is accepted and tested.
- New optional keys are validated against a strict allowed-key set; unknown keys are rejected.
- The complete previous function bodies are available in the schema rollback file.

---

## 8. Medium/low fixes (P2/P3)

- **Original staging row number preserved.** Apply results carry `staging.row_number` for written and blocked rows.
- **Blocked rows are explicit.** Apply returns `blocking_reason` and the UI/CSV never turns a blocked row into zero.
- **Unknown catalog identities are audited.** When staging auto-creates a structural identity, it writes a `badge_catalog_audit_events` row with `previous_category = null`, `new_category = 'unclassified'`, and an auto-create reason.
- **Review-note control characters rejected.** SQL rejects `[[:cntrl:]]`; TypeScript rejects `[\u0000-\u001F\u007F]` in the CSV parser, staged observations, and classified runs.
- **NULL catalog category returns `22023`.** No ambiguous NULL comparison can reach the catalog update.
- **Duplicate request UUIDs map to a clean domain error.** Cross-run reuse raises `22023` instead of exposing `23505`; a same-run replay returns the stored result.
- **Report inaccuracies corrected.** See section 11.4.

---

## 9. SQL implementation details

### 9.1 Catalog (`20261110000100`)

- Identity is `course_template:<id>` or `game:<id>`, never `/badges/<id>`.
- Categories: `skill | arcade | ignored | unclassified`.
- Structural `skill`/`arcade` flips are rejected.
- Category changes write `badge_catalog_audit_events`.
- Referenced catalog rows are delete-protected.
- Clients receive no direct writes.
- Verified seed: 64 definitions (47 Skill, 17 Arcade).

### 9.2 Staging (`20261110000200`)

- `badge_sync_runs` stores lifecycle, source metadata, fingerprint, approval/apply/rollback identity, and stored results.
- `badge_sync_participant_staging` stores the previous snapshot, current classification, blocking reason, observation state, and the post-apply snapshot.
- `badge_sync_staged_badges` stores per-award evidence with a catalog FK.
- `private.badge_sync_recompute` is mode-aware and clears the applied snapshot when the run is recomputed or re-staged.
- `Skill + Arcade = Total` is enforced per participant and for run totals.
- Snapshot RPC exposes the applied-snapshot fields for diagnostics.

### 9.3 Apply (`20261110000300`)

- Locks the run, replays `applied`, re-reads live state, recomputes the fingerprint, and aborts on any drift with `40001`.
- Builds the eligible row set, calls the single bulk setter, records the post-apply snapshot, writes the ledger, and stores the result.
- Returns blocked rows with the original row numbers.
- Rollback validates the whole batch, writes the ledger, and stores the rollback result.
- Frozen ranks are not directly assigned by this path. Existing threshold triggers can still allocate a **new** frozen rank when a participant crosses 10 Skill badges during apply; rollback never clears the allocated rank. This is corrected wording from the earlier report.

---

## 10. TypeScript and UI details

- `preview.ts` exports `isApplicablePreviewRow` and filters all totals through it.
- `snapshot.ts` keeps NULL counts instead of coalescing to zero and exposes the applied-snapshot fields.
- `classified-badge-import-state.ts` allows NULL counts on rows and results.
- `actions.ts`:
  - uses the authoritative run totals;
  - derives issues from every non-applicable participant;
  - returns NULL counts for blocked results with a `Not applied:` reason;
  - maps `40001`, `42501`, and reused request ids to clean messages.
- `rpc-error.ts` is the single shared mapper used by both `actions.ts` (classified preview/apply) and `badge-sync-actions.ts` (observation apply/rollback), so stale, reused-request, and non-admin failures read identically in every admin path.
- `classified-badge-csv-import.tsx` renders `—` and `Not applied (status)`, and CSV export writes `Not applied` for NULL counts.

---

## 11. Test coverage and results

### 11.1 Node tests

`npm test` → **269 tests, 269 passing, 0 failing.**

New coverage includes:

- eligible-only preview totals;
- exclusion of incomplete, unclassified, pending, rejected, and removed rows;
- NULL-count preservation from snapshots;
- control-character rejection in review notes;
- existing identity, catalog, staging, lifecycle, snapshot, and leaderboard suites.

`npm run typecheck` → **pass**.

### 11.2 Lint

Targeted ESLint on every changed/new TypeScript and script file → **clean**.

Full `npm run lint` → **2 pre-existing errors**:

- `scripts/parse_saved_profiles.ts:228` — `@typescript-eslint/no-explicit-any`
- `scripts/parse_saved_profiles.ts:276` — `@typescript-eslint/no-explicit-any`

These files were not touched by this work.

### 11.3 SQL tests — executed, passing

Phase 1.4 ran the full pgTAP suite against a freshly reset **local** database:

```text
npx supabase db reset --local   # all 22 migrations applied in order
npx supabase test db --local    # Files=16, Tests=383
Result: PASS
```

**16 files, 383 assertions, 0 failures, 0 skipped, `Result: PASS`.**

`supabase/tests/badge_sync.test.sql` covers, among others:

- catalog seed/count/identity rules and NULL-category rejection;
- anon/non-admin RPC rejection and ledger write denial;
- unknown catalog identity audit;
- control-character rejection in staging;
- eligible-only run totals and preview/apply parity;
- post-apply snapshot and ledger rows;
- blocked-row row-number preservation;
- current-state rollback rejection, later-run protection, removed-participant rejection;
- same-total split `40001`;
- sequential rollback of a later then older run;
- frozen-rank preservation.

`supabase/tests/classified_badge_counts.test.sql` (`plan(34)`) keeps the legacy manual workflow and adds:

- stale same-total split rejection;
- legacy nine-key setter compatibility;
- legacy seven-key rollback compatibility;
- repeated rollback with no duplicate audit event.

The other 14 files (catalog, frozen rank, participant removal, leaderboard RLS, Google Form sync, automatic badge jobs, etc.) also pass unchanged.

### 11.4 Report corrections

The earlier report stated or implied:

- “265 passing” → now **269**.
- “The three migrations are additive” → **incorrect**; migration 3 replaces two existing function bodies.
- “Rollback restores the staged snapshot” → the new rollback additionally verifies live state and later runs before restoring.
- “Frozen ranks are never written by the sync path” → true for direct assignment, but threshold triggers can allocate a **new** frozen rank during apply. Rollback never clears it.
- “SQL tests written, not executed” → now **executed and passing**.

### 11.5 Post-test integrity (local database)

After the full pgTAP run, the concurrency script, and its automatic cleanup:

| Check | Result |
| :--- | :--- |
| Catalog total / Skill / Arcade / unclassified | **64 / 47 / 17 / 0** |
| `/badges/` keys in catalog | **0** |
| `participants` rows | **0** (tests rolled back) |
| `badge_sync_runs` / `badge_sync_participant_staging` / `badge_sync_operation_ledger` | **0 / 0 / 0** |
| Duplicate ledger keys `(run_id, participant_id, operation_type)` | **0** |
| `Skill + Arcade ≠ Total` mismatches | **0** |
| Removed participants with badge counts | **0** |
| `participant_audit_events` UPDATE/DELETE/INSERT for `anon` and `authenticated` | **false / false / false** |
| Ledger direct INSERT for `authenticated` | **false** |
| Ledger SELECT for `authenticated` / `anon` | **true / false** |

Audit tables remain append-only and the ledger has no direct client write path.

### 11.6 Phase 1.4 defects found and fixed (D1–D11)

Every defect below was found by executing the tests. Each fix was reported and approved before it was applied. No test was weakened to make it pass.

| # | Type | Fix |
| :--- | :--- | :--- |
| D1 | Migration | Staging count constraint corrected so staged totals are validated consistently. |
| D2 | Script | Concurrency script resolves its own path via `fileURLToPath` so the default `npm run` invocation works on Windows. |
| D3/D4 | Tests | Correct `jsonb` summary access via `->>` casts (`get_public_summary()` returns `jsonb`, not a table). |
| D5 | Test | Anonymous-projection assertions use `id` / `count(id)` because `anon` has no column privilege on `participant_key`. |
| D6 | Migration | Staging row numbers now follow the manual-CSV contract: `base + ordinality`, starting at 2 and continuing above the current max. Prevents `(run_id, row_number)` collisions and invalid row 1 forwarded to the bulk setter. |
| D7 | Migration | Expected Skill/Arcade split is enforced even when the live row already equals the target, so a same-total split change is rejected as stale. |
| D8 | Test | Frozen-rank removed fixture now supplies `removed_at`/`removal_reason` and clears the metadata on reactivation. |
| D9 | Test | Removed-participant Google Form fixture now uses a valid `form:<64 hex>` key and its own profile URL. |
| D10 | Test | Rollback fixture expected values aligned to the intervening applied total (3), removing an off-by-one. |
| D11 | Migration | `applied_at` uses `pg_catalog.clock_timestamp()` so later-run ordering is real even when two applies happen inside one transaction. |

---

## 12. Rollback strategy

### 12.1 Data rollback

Use `public.admin_rollback_badge_sync_run(run_id, request_id)`.

It is atomic, current-state-aware, later-run-aware, removed-participant-aware, idempotent, and audit-preserving. A stale or conflicting batch aborts entirely with `40001`; nothing is partially restored.

Manual CSV callers can continue to use `public.admin_bulk_rollback_classified_badge_counts(jsonb)` with the legacy seven-key payload. When the five `expected_*` keys are supplied, the same current-state checks apply.

### 12.2 Schema rollback for migration 3

Run `supabase/rollbacks/20261110000300_badge_sync_apply_schema_rollback.sql` only if migration 3 itself must be undone.

It:

- drops `admin_apply_badge_sync_run` and `admin_rollback_badge_sync_run`;
- drops `badge_sync_operation_ledger` (and its indexes/policy);
- drops the apply/rollback request-id uniqueness indexes;
- restores the exact `20261105000100` bodies of the bulk setter and bulk rollback functions.

It deliberately does **not** undo migration 2 (runs, staging, preview, approval, applied-snapshot columns) or migration 1 (catalog). It never deletes participant audit history, catalog audit history, or frozen-rank columns.

---

## 13. Residual risks and unverified items

1. **Concurrency coverage is partial.** The two-session script passes for concurrent applies with different and identical request ids. It does **not** yet exercise: two runs touching the same participant, a same-total split race, concurrent apply + rollback, or repeated rollback across two live sessions. These paths are covered by single-transaction pgTAP tests but not by independent concurrent sessions.
2. **Migration 3 schema rollback is unexercised.** `supabase/rollbacks/20261110000300_badge_sync_apply_schema_rollback.sql` is written but has not been run against a reset database.
3. **Observation UI is not built.** Observation staging exists at the database, engine, and server-action layers only.
4. **Production migration-history drift is unresolved.** Do not use `--include-all` blindly; verify actual objects before any repair.
5. **Local CLI is linked to production.** The local CLI project ref and `.env.local` still point at production (`fyuuvdsfxnytaumoehkx`). Every command in Phase 1.4 used an explicit `--local` target, but deployment must pass `--project-ref fyuuvdsfxnytaumoehkx` explicitly and never rely on the default.
6. **`20261102000200` is absent in production.** This work does not depend on it, but historical manual verification behavior there remains non-idempotent.
7. **Shared-admin policy is intentional.** If per-admin ownership is later required, add an explicit policy and tests; do not rely on UI ownership.
8. **No commits.** All work remains uncommitted/untracked locally.

---

## 14. Deployment runbook and approval gate

> Do not run any command in this section without explicit approval. Nothing below has been executed.

### 14.1 Preflight

```powershell
npx supabase --version
npx supabase migration list --project-ref fyuuvdsfxnytaumoehkx
```

Take a database backup/PITR checkpoint. Verify dependencies:

```sql
select to_regprocedure('private.is_admin()');
select to_regprocedure('public.admin_bulk_set_classified_badge_counts(jsonb)');
select to_regprocedure('public.admin_bulk_rollback_classified_badge_counts(jsonb)');
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'participants'
  and column_name in (
    'removed_at','removed_by','removal_reason',
    'skill_badge_count','arcade_game_badge_count',
    'frozen_rank','rank_frozen_at'
  );
```

Every query must return a row.

### 14.2 Apply locally first

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
npm run test:badge-sync-concurrency
npm test
npm run typecheck
```

Do not proceed until the SQL tests and the concurrency script pass.

### 14.3 Dry run, then apply in order

```powershell
npx supabase db push --project-ref fyuuvdsfxnytaumoehkx --dry-run
```

If the dry run lists only the three badge-sync migrations:

```powershell
npx supabase db push --project-ref fyuuvdsfxnytaumoehkx
```

If unrelated history blocks the push, apply the three files individually against a direct connection, then record the versions so history matches reality. Do not guess migration versions.

### 14.4 Post-apply verification

```sql
select count(*) from public.badge_catalog;                        -- 64
select category, count(*) from public.badge_catalog group by 1;   -- 47 skill, 17 arcade
select count(*) from public.badge_catalog where badge_key like '/badges/%'; -- 0

select to_regprocedure('public.admin_create_classified_badge_sync_run(jsonb,text,text)');
select to_regprocedure('public.admin_apply_badge_sync_run(uuid,text,uuid)');
select to_regprocedure('public.admin_rollback_badge_sync_run(uuid,uuid)');

select has_function_privilege('anon', 'public.admin_apply_badge_sync_run(uuid,text,uuid)', 'EXECUTE'); -- false
```

### 14.5 First live run

1. Import the classified CSV as an admin; inspect preview totals, deltas, and blocked count.
2. Confirm the run is `previewed` and the fingerprint is present.
3. Apply once; confirm `applied`, stored `apply_result`, and one ledger row per participant.
4. Re-apply; confirm the stored result replays with no duplicate audit or ledger row.
5. Roll back only if needed; confirm live state matches the post-apply snapshot, the previous state is restored, and history remains.

### 14.6 Approval gate

Phase 1.4 local verification is complete. Before any production apply, a separate deployment-readiness review must confirm:

- [x] `supabase test db --local` passes against a local reset database (16 files / 383 assertions / 0 failures).
- [x] The two-session concurrency script passes against the same database.
- [x] Node tests, typecheck, targeted ESLint, and the catalog seed pass.
- [ ] Migration-history drift is reviewed and resolved deliberately.
- [ ] A backup/PITR checkpoint exists.
- [ ] A human approves the production apply.

**No production database, deployment, or Git history was modified by this work.**

---

## 15. Phase 1.5 — Production Deployment Readiness Review

**Review date:** 2026-11-09  
**Production project:** `fyuuvdsfxnytaumoehkx` (`gdg-aceit-leaderboard`, `ap-south-1`, `ACTIVE_HEALTHY`)  
**Mode:** Investigation and reporting only. No production migration, no `supabase db push`, no `migration repair`, no `--include-all`, no Vercel deployment, no Git commit/stage/push, no Google fetching, cron, worker, or automation activation.

### 15.1 Verdict summary

| Question | Answer |
| :--- | :--- |
| Is Phase 1.5 complete? | Yes, as a read-only review. |
| Is the local implementation green? | Yes. Phase 1.4 results remain valid (16 pgTAP files / 383 assertions, concurrency PASS, integrity clean, 269 unit tests, typecheck, targeted ESLint, catalog seed 324 awards → 64 definitions). |
| Are the three new migrations schema-compatible with production? | Yes for their declared prerequisites. Migration 3's replaced RPCs exist with compatible signatures; no prerequisite object is missing. |
| Is production deployment safe today? | **No.** |
| Overall verdict | **CONDITIONALLY READY — NOT APPROVED FOR PRODUCTION.** The Badge Sync schema is compatible, but deployment is blocked by recovery, migration-history, rollback-verification, and production-data-reconciliation gaps. |

This review did not assume a migration is safe because it passed locally. Every production statement below is based on a read-only inspection performed during this phase, or is explicitly marked as not verifiable.

### 15.2 Commands used and read-only classification

The CLI was invoked with stdin closed (`$null |`) so an interactive prompt could not read a password. Every remote command used the explicit production reference `--project-ref fyuuvdsfxnytaumoehkx`. The locally linked project and `.env.local` were not used as an implicit target, and no environment-variable value or secret was printed.

| Command | Purpose | Read-only? | Notes |
| :--- | :--- | :--- | :--- |
| `git branch --show-current`, `git status --porcelain`, `git log --oneline -8` | Local audit | Yes | Local repository only. |
| `git grep ... HEAD -- src` | Check committed references | Yes | Local repository only. |
| `Get-ChildItem`, `Get-Content`, `Select-String`, `ConvertFrom-Json`, Node body-comparison script | Inspect migrations, rollback SQL, app code, dumps | Yes | Local files and temporary dumps. |
| `npx supabase projects list --output json` | Confirm target project identity/status | Yes | Management API read. No secret printed. |
| `npx supabase migration list --project-ref fyuuvdsfxnytaumoehkx` | Read remote migration history | Yes | Read-only history query. |
| `npx supabase db dump --schema public --project-ref fyuuvdsfxnytaumoehkx --file <temp>` | Read production `public` schema | Yes | `pg_dump` read. Temporary file, not committed. |
| `npx supabase db dump --schema private --project-ref fyuuvdsfxnytaumoehkx --file <temp>` | Read production `private` schema | Yes | `pg_dump` read. Temporary file, not committed. |
| `npx supabase backups list --project-ref fyuuvdsfxnytaumoehkx` | Read backup/PITR availability | Yes | Explicitly `backups_read`. |
| `npx supabase ... --help` (`db push`, `migration repair`, `backups`, `inspect db`) | Confirm CLI capabilities and permissions | Yes | Help output only. |
| `supabase db push` (including `--dry-run`) | Determine exactly what a push would apply | **Not run** | Prohibited by the Phase 1.5 safety rules. The push conclusion is derived from `migration list` plus the schema dump. |
| `supabase migration repair` | Reconcile history | **Not run** | Prohibited. Proposed only. |
| `supabase backups restore` | Restore/PITR | **Not run** | Prohibited. Proposed only. |
| Any `INSERT` / `UPDATE` / `DELETE` / DDL against production | Test compatibility | **Not run** | No production write was performed. |
| Vercel deploy, Git commit/stage/push, Google fetch/cron/worker enablement | Deployment/automation | **Not run** | Prohibited. |

Production data (participant rows, audit rows, `admin_users` membership) was **not dumped or printed**, because it contains personal data and the review did not require it. Any conclusion that depends on production row values is marked as requiring a separate approved preflight.

### 15.3 Task 1 — Local repository audit

**Branch and working tree.** Branch is `main`. All uncommitted changes are Badge Sync or classified-badge related:

- Modified: `package.json`, `src/app/admin/actions.ts`, `src/app/admin/classified-badge-import-state.ts`, `src/components/classified-badge-csv-import.tsx`, `src/lib/participants/classified-badge-csv.ts`, `src/lib/participants/classified-badge-csv.test.ts`, `supabase/tests/classified_badge_counts.test.sql`, `supabase/tests/frozen_rank.test.sql`, `supabase/tests/participant_removal.test.sql`.
- Untracked: `docs/BADGE_SYNC_IMPLEMENTATION_REPORT.md`, `scripts/badge-catalog-seed.mjs`, `scripts/test-badge-sync-concurrency.mjs`, `src/app/admin/badge-sync-actions.ts`, `src/app/admin/badge-sync-state.ts`, `src/lib/badges/`, `supabase/migrations/20261110000100_badge_catalog.sql`, `supabase/migrations/20261110000200_badge_sync_staging.sql`, `supabase/migrations/20261110000300_badge_sync_apply.sql`, `supabase/rollbacks/`, `supabase/tests/badge_sync.test.sql`.

No unrelated change was found.

**Migration ordering.** Local order is chronological and valid: `20261026000100` → `20261027000100` → `20261028000100` → `20261030000100` → `20261031000100`…`20261031000500` → `20261101000100` → `20261102000100`…`20261102000300` → `20261103000100`…`20261103000200` → `20261104000100` → `20261104000200` → `20261105000100` → `20261106000100` → `20261110000100` → `20261110000200` → `20261110000300`.

**Dependency map of the three new migrations.**

| Migration | Hard prerequisites | Effect on production |
| :--- | :--- | :--- |
| `20261110000100_badge_catalog.sql` | `20261026000100` (`private.set_updated_at`, `private.is_admin`, `auth.users`) | Creates `badge_catalog`, `badge_catalog_audit_events`, helper RPCs, and seeds 64 structural definitions. Purely additive. |
| `20261110000200_badge_sync_staging.sql` | `20261110000100`, `20261026000100`, `20261104000100` (`skill_badge_count`, `arcade_game_badge_count`), `20261106000100` (`registration_status = 'removed'`, `removed_at`) | Creates run/staging/staged-badge tables, preview/approval RPCs, indexes, RLS policies, and a delete-protection trigger on `badge_catalog`. Purely additive. |
| `20261110000300_badge_sync_apply.sql` | `20261110000200`, `20261105000100` (the two bulk RPCs being replaced), `20261026000100` (`admin_set_verified_badge_count`) | Replaces `admin_bulk_set_classified_badge_counts(jsonb)` and `admin_bulk_rollback_classified_badge_counts(jsonb)`; creates the operation ledger, apply/rollback RPCs, and request-id unique indexes. |

None of the three new migrations depends on the absent `20261031000100`–`20261103000200` group.

**Migration 3 replacement.** It replaces exactly two existing production RPCs. Signatures and return columns are unchanged, so existing callers remain type-compatible. It does not drop or alter `admin_set_verified_badge_count`; it delegates to it.

**Rollback exactness.** A programmatic comparison extracted both restored function definitions from `supabase/rollbacks/20261110000300_badge_sync_apply_schema_rollback.sql` and the corresponding definitions in `supabase/migrations/20261105000100_ten_skill_badge_rank_freeze.sql`. Both were **byte-identical**, including whitespace, after newline normalization. The rollback re-issues `REVOKE ALL ... FROM public, anon` and `GRANT EXECUTE ... TO authenticated`; the production `service_role` grant is preserved by PostgreSQL when a function is replaced. The rollback script has **not been executed**, so it remains unverified in practice.

**Configuration mismatch.** `supabase/config.toml` uses `project_id = "gdg-aceit-learn-communities"`, while `supabase/.temp/project-ref` points at production `fyuuvdsfxnytaumoehkx`. The mismatch is real and is why every remote command in this review passed `--project-ref` explicitly. It must remain that way for deployment.

### 15.4 Task 2 — Production migration reconciliation

Production history contains exactly four recorded versions. All four are also present in the schema. Eighteen local migrations are unrecorded: four of them are already applied in the schema, and fourteen are genuinely pending. This contradicts the earlier note that `20261026000100`–`20261030000100` might be recorded but unapplied; those four are recorded and their schema exists.

| Version | Local file | Remote history | Schema in production | Depends on | Risk | Recommended action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `20261026000100` | `leaderboard.sql` | Recorded | Applied | — | Low | None. |
| `20261027000100` | `leaderboard_tie_order.sql` | Recorded | Applied; effect superseded by `20261104000100` | `20261026000100` | Low | None. |
| `20261028000100` | `google_form_sync.sql` | Recorded | Applied | `20261026000100` | Low | None. |
| `20261030000100` | `allow_skills_google_profile_url.sql` | Recorded | Applied | `20261026000100` | Low | None. |
| `20261031000100` | `automatic_badge_progress.sql` | Unrecorded | **Absent** | `20261026000100`, `20261030000100` | High | Do not push. Decide full catch-up vs leave pending. |
| `20261031000200` | `auto_progress_refresh_job_lock.sql` | Unrecorded | **Absent** | `20261031000100` | Medium | Same decision. |
| `20261031000300` | `durable_auto_progress_jobs.sql` | Unrecorded | **Absent** | `20261031000100`, `20261031000200` | High | Same decision. |
| `20261031000400` | `unverified_progress_csv_import.sql` | Unrecorded | **Absent** | `20261031000100` | Medium | Same decision. |
| `20261031000500` | `admin_auto_progress_job_status.sql` | Unrecorded | **Absent** | `20261031000300` | Low | Same decision. |
| `20261101000100` | `progress_observations.sql` | Unrecorded | **Absent** | `20261026000100` | Medium | Same decision. |
| `20261102000100` | `durable_progress_observation_refresh.sql` | Unrecorded | **Absent** | `20261101000100` | Medium | Same decision. |
| `20261102000200` | `idempotent_manual_badge_verification.sql` | Unrecorded | **Absent** | `20261026000100` | Medium | Same decision. Production manual retries remain non-idempotent. |
| `20261102000300` | `secure_progress_observation_projection.sql` | Unrecorded | **Absent** | `20261101000100` | Medium | Same decision. Would expose a new anon view if applied. |
| `20261103000100` | `admin_bulk_verified_badge_counts.sql` | Unrecorded | **Absent** | `20261026000100` | Medium | Same decision. Current app code calls this RPC. |
| `20261103000200` | `restore_auto_progress_cooldown_column.sql` | Unrecorded | **Absent** | `20261031000100` | Low | Same decision. Would abort if applied alone because the table is missing. |
| `20261104000100` | `classified_badge_counts.sql` | Unrecorded | **Applied** | `20261026000100`, `20261030000100` | Low | `migration repair --status applied` only (after approval). |
| `20261104000200` | `remove_five_badge_summary.sql` | Unrecorded | **Applied** | `20261104000100` | Low | Record as applied. |
| `20261105000100` | `ten_skill_badge_rank_freeze.sql` | Unrecorded | **Applied** | `20261104000100` | Low | Record as applied. |
| `20261106000100` | `participant_soft_removal.sql` | Unrecorded | **Applied** | `20261105000100` | Low | Record as applied. |
| `20261110000100` | `badge_catalog.sql` | Unrecorded | **Absent** | `20261026000100` | Medium | Apply through the controlled path after blockers clear. |
| `20261110000200` | `badge_sync_staging.sql` | Unrecorded | **Absent** | `20261110000100`, `20261104000100`, `20261106000100` | High | Apply through the controlled path after blockers clear. |
| `20261110000300` | `badge_sync_apply.sql` | Unrecorded | **Absent** | `20261110000200`, `20261105000100`, `20261026000100` | High | Apply through the controlled path after blockers clear. |

**Push consequence.** A normal `supabase db push` would see all eighteen unrecorded local migrations — the fourteen genuinely pending files plus the four already applied but unrecorded — and would attempt to apply or re-apply them in order. Even if the four re-runs happen to be idempotent, the eleven legacy pending files and the three new files would be applied in one uncontrolled sequence. That is a large, unapproved scope expansion: it would create auto-progress and progress-observation tables/functions, expose a new anon view, change manual-verification behavior, and add verified-bulk/auto-progress RPCs. It would also mix in migration files that have never been reviewed as a production deployment. This review did not run `db push`, even with `--dry-run`, because the safety rules prohibit invoking `db push`. The conclusion is derived from the history and schema evidence.

The four applied-but-unrecorded versions must not be guessed at. Their schema effects were observed directly: `skill_badge_count`/`arcade_game_badge_count`, `frozen_rank`/`rank_frozen_at`, the frozen-rank triggers, the `removed` status and removal metadata, the current `get_public_summary()` shape (`ten_badge_count`, no `five_badge_count`), the audit constraint including `participant_removed`, and the two bulk RPCs with the `20261105000100` bodies.

### 15.5 Task 3 — Production schema compatibility

**Prerequisites present.** Production `public` has `participants`, `participant_audit_events`, `participant_badge_observations`, and `admin_users`. Production `private` has `is_admin`, `set_updated_at`, `allocate_frozen_ranks`, `capture_frozen_ranks`, and `protect_frozen_rank`. The `participants` table has `skill_badge_count`, `arcade_game_badge_count`, `removed_at`, `removed_by`, `removal_reason`, `frozen_rank`, and `rank_frozen_at`. The frozen-rank triggers `participants_capture_frozen_ranks`, `participants_capture_frozen_ranks_insert`, and `participants_protect_frozen_rank` exist. The `participants_frozen_rank_key` unique index exists.

**Objects that will be replaced.** Production `admin_bulk_set_classified_badge_counts(jsonb)` and `admin_bulk_rollback_classified_badge_counts(jsonb)` are the `20261105000100` bodies (no `expected_skill_count`/`expected_arcade_count` guard). Migration 3 replaces them with the guarded bodies. The return signatures are unchanged. Production `admin_set_verified_badge_count` is the older non-idempotent body from `20261026000100`, because `20261102000200` is absent; migration 3 does not replace it.

**Audit idempotency nuance.** The new bulk setter checks whether live total, Skill, and Arcade already equal the requested classification. If they do, it returns the stored result and does **not** call `admin_set_verified_badge_count`, so no duplicate audit event is appended. This makes an identical re-apply safe even against production's older, non-idempotent verifier. The run-level retry path also returns the stored `apply_result`; the ledger has a unique `(run_id, participant_id, operation_type)` key. Manual retries of the older `admin_set_verified_badge_count` outside Badge Sync remain non-idempotent in production; that is a pre-existing gap, not a regression introduced by these migrations.

**Trigger side effects.** The new bulk setter delegates the total update to `admin_set_verified_badge_count` per row, then updates Skill and Arcade for the whole batch in one statement. The statement-level `participants_capture_frozen_ranks` trigger fires once for that statement and allocates ranks deterministically. `private.protect_frozen_rank` only blocks changes to `frozen_rank`/`rank_frozen_at`; it does not block badge-count updates. Therefore Badge Sync can update an already-frozen participant, but the rank itself remains permanently frozen.

**Permissions and RLS.** `anon` has column-level `SELECT` on `participants` for public columns only; `removed_at` is granted only to `authenticated`, and `removed_by`/`removal_reason` are not granted to either. `participants_public_registered_read` restricts `anon` to `registration_status = 'registered'`; `participants_admin_read` gates authenticated reads through `private.is_admin()`. Admin RPCs are revoked from `PUBLIC`/`anon` and granted to `authenticated`; `service_role` holds its grants through the schema default privileges. The new tables revoke all from `anon` and `authenticated`, then grant `SELECT` to `authenticated` with admin-only RLS policies. The new catalog is not readable by `anon`. These are compatible with the new migrations' grants.

**Manual CSV compatibility.** The existing classified CSV UI no longer calls the bulk setter directly; `previewClassifiedBadgeCsvAction` sends the existing nine-key row shape to `admin_create_classified_badge_sync_run`, and the apply action calls `admin_apply_badge_sync_run`. The local 324-award → 64-definition seed is reproducible. Preview is read-only and stores NULL for incomplete/failed observations rather than zero. The main production risk is data, not shape: participant IDs, current counts, and badge identities must be reconciled by a production preview before any apply. The legacy seven-key rollback payload remains accepted by the new rollback RPC, so old rollback callers are shape-compatible.

**Data conflicts.** The new catalog and Badge Sync tables do not exist in production, so there is no key collision. The catalog seed is `INSERT ... ON CONFLICT (badge_key) DO NOTHING`, so it is re-runnable. The staging tables are empty at creation. The only production data conflicts would come from the CSV itself (unknown identities, removed participants, stale counts), which the preview and apply guards are designed to reject.

**Cross-cutting application finding.** Current `main` references production-absent RPCs in committed code: `admin_import_unverified_progress`, `admin_record_progress_observation`, `claim_google_skills_observation_cooldown`, `admin_bulk_set_verified_badge_counts`, `admin_get_latest_auto_progress_job`, and the auto-progress RPCs. The admin page tolerates the missing job-status RPC and the observation summary query, but the corresponding actions will fail if used. This is a pre-existing schema/application mismatch caused by the eleven absent migrations. It does not prevent the Badge Sync RPCs from working, but it means the application and database are not fully in sync and a full production deployment must account for it.

### 15.6 Task 4 — Backup and recovery readiness

Read-only command:

```powershell
npx supabase backups list --project-ref fyuuvdsfxnytaumoehkx
```

Result (no secrets):

```json
{"region":"ap-south-1","walg_enabled":true,"pitr_enabled":false,"backups":[],"physical_backup_data":{},"message":""}
```

| Finding | Status |
| :--- | :--- |
| PITR availability | **Not available.** `pitr_enabled` is `false`. |
| Physical backups | **None listed.** `backups` is empty. |
| WAL-G | Enabled, but no recoverable physical backup is offered by the read-only API. |
| Usable recovery point | **No.** There is no confirmed backup or PITR target to restore to. |
| `backups restore` capability | The CLI exposes it, but it requires a PITR timestamp and `backups_write`; it was not run. With PITR disabled, it is not a usable recovery path. |
| Tested restore | **No.** No restore drill exists. |
| Tested schema rollback | **No.** The migration-3 rollback script is byte-verified but has never been executed. |
| Rollback for migrations 1 and 2 | **Not provided.** They are additive and can be left in place, but there is no script to drop them. |
| Data rollback | `admin_rollback_badge_sync_run` exists and is locally tested, but production has not exercised it. It cannot reverse a frozen-rank allocation. |

**Required pre-deployment checkpoint.** Before any production DDL, either (a) enable PITR/physical backups on a plan that supports them and wait until `backups list` reports a recovery point, or (b) take a full logical dump to an encrypted, access-controlled location and restore it into a scratch environment to prove it is usable. The dump must not be committed to Git. A schema-only dump is not a recovery point.

### 15.7 Task 5 — Deployment risk assessment

| # | Risk | Severity | Evidence | Required mitigation | Blocks deployment? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Production migration-history drift | **Critical** | 4 recorded, 18 unrecorded; 4 of the 18 are applied in schema; 11 are genuinely absent. A normal push would attempt all 18 unrecorded migrations (14 genuinely pending + 4 re-runs). | Take a recovery point; repair only the four observed-applied versions; choose full catch-up or a surgical three-file apply; never use `--include-all` blindly. | **Yes** |
| 2 | Migration 3 replaces existing RPCs | **High** | Two production RPCs are replaced. Signatures match and the rollback bodies are byte-identical to `20261105000100`, but the rollback script is unexecuted and there is no backup. | Rehearse migration 3 + schema rollback on a local reset database; take a recovery point; deploy in a maintenance window; verify both RPC bodies and grants immediately. | **Yes** |
| 3 | Audit event idempotency | **Medium** | The new bulk setter no-ops when total/Skill/Arcade already match; the run wrapper replays stored results; the ledger is unique per run/participant/operation. Production lacks `20261102000200`, so only the older manual verifier is non-idempotent. | Keep the no-op guard; verify re-apply produces no second audit row or ledger row; document that manual `admin_set_verified_badge_count` retries remain non-idempotent. | No |
| 4 | Rollback safety | **High** | Data rollback restores counts, but frozen ranks allocated by an apply cannot be cleared because `protect_frozen_rank` forbids changing them. The schema rollback is unverified, and migrations 1/2 have no rollback script. | Define and test a rank-repair procedure for erroneous allocations, or explicitly accept permanent rank allocation; rehearse the schema rollback locally; take a recovery point. | **Yes** |
| 5 | Frozen-rank trigger behavior | **High** | The statement-level trigger allocates ranks for all eligible participants after a Skill-count update. Allocation is deterministic by Skill/Arcade/Total/UUID, but it is permanent and not reversed by count rollback. | Snapshot `frozen_rank`/`rank_frozen_at` before apply; compare after; require explicit business acceptance that any erroneous promotion leaves a permanent rank unless manually repaired. | **Yes**, unless the permanence is explicitly accepted |
| 6 | Existing manual CSV compatibility | **Medium** | The classified UI now uses `admin_create_classified_badge_sync_run` with the existing nine-key payload. Local 324→64 mapping is verified; preview is read-only; row numbers start at 2. | Run a production preview-only regression with the real CSV; reconcile total/blocked/unclassified counts and participant IDs; do not apply until the preview matches expectations. | **Yes** (preview evidence required) |
| 7 | Shared-admin authorization | **Medium** | All admin RPCs call `private.is_admin()`; RLS is admin-read; grants to `authenticated` are gated by the function check. Any admin can operate any run by design. | Verify `admin_users` membership; confirm the shared-admin policy is acceptable; test a non-admin authenticated session is rejected with `42501`. | No |
| 8 | Duplicate requests and concurrent operations | **Medium** | Run row is locked `FOR UPDATE`; status transitions and request-id unique indexes exist; ledger is unique; local two-session tests pass. Coverage is partial (same participant across two runs, apply+rollback). | Run the missing concurrency scenarios; accept residual risk explicitly; monitor duplicate request IDs and ledger conflicts. | No |
| 9 | Production data integrity | **High** | Production participant/audit data was not dumped. Preview re-reads live state and rejects stale rows with `40001`, rejects removed participants, and enforces Skill+Arcade=Total. The 2026-11-09 snapshot may be stale. | Production preview-only reconciliation; compare totals, deltas, blocked rows, removed participants, and unknown identities; take a pre-apply snapshot for rollback comparison. | **Yes** |
| 10 | Deployment and recovery procedure | **Critical** | No PITR, no listed backup, no tested restore, no tested schema rollback, no rollback scripts for migrations 1/2, and `db push` is unsafe under the drift. | Execute the gated sequence in §15.8, including backup/restore drill, history repair, surgical apply, verification, canary run, and rollback criteria. | **Yes** |
| 11 | Application/schema mismatch (additional finding) | **High** | `main` references multiple production-absent legacy RPCs (verified-bulk, progress-import, progress-observation, and auto-progress paths). Admin page degrades gracefully, but those actions fail if used. | Either authorize and deploy the missing legacy migrations as a separate reviewed change, or remove/guard the affected actions before a full app deployment. | No for Badge Sync DB; **Yes** for full application readiness |

**Severity scale.** Critical = can cause unrecoverable production damage or an unsafe partial deployment. High = can corrupt counts, leave permanent rank side effects, or break a core admin path. Medium = can produce wrong results or operational confusion under specific inputs. Low = cosmetic or easily reversible.

### 15.8 Task 6 — Proposed deployment sequence (NOT EXECUTED)

> Every step below requires explicit approval. Nothing in this section has been run. The sequence is written for the **surgical Badge-Sync-only** path, which is the smallest safe change. A full legacy catch-up is a separate decision.

#### A. Preconditions and recovery

1. **Freeze writes.** Announce a maintenance window. Stop admin CSV imports, Google Form sync, any cron/worker, and Vercel deployments. Do not enable any automation flag.
2. **Create a recovery point.** Either enable PITR/physical backups and wait for `backups list` to show a restore point, or take a full logical dump and prove it restores into a scratch environment. A schema-only dump is not sufficient.
3. **Snapshot production state.** Record:
   - `migration list` output (already captured read-only: 4 recorded, 18 unrecorded).
   - `participants` count, `verified_badge_count`/`skill_badge_count`/`arcade_game_badge_count` aggregates, `frozen_rank` count, `registration_status` counts, `participant_audit_events` count.
   - `admin_users` membership count (not the identities).
   - `to_regprocedure(...)` for every prerequisite.
   - Current grants for the two RPCs and the participants columns.
4. **Local rehearsal.** On a clean local database: `supabase db reset`, `supabase test db`, the concurrency script, `npm test`, `npm run typecheck`, and targeted ESLint. Then apply the three migrations, execute the migration-3 schema rollback, assert the restored bodies/grants are identical, and re-apply. Separately rehearse data rollback, including a frozen-rank allocation case.
5. **Decide legacy disposition.** Choose one:
   - **Surgical (recommended for Badge Sync):** leave the eleven absent legacy migrations pending; never run `db push`; apply only the three new files and record them. Accept that `db push` remains unusable until the legacy backlog is resolved.
   - **Full catch-up:** separately review and authorize all eleven legacy migrations, including their data/trigger/grant effects, before applying them. This is a much larger change and is not approved by this review.

#### B. History reconciliation (schema-neutral, but still requires approval)

6. Record only the four already-applied versions:
   ```powershell
   npx supabase migration repair --status applied `
     20261104000100 20261104000200 20261105000100 20261106000100 `
     --project-ref fyuuvdsfxnytaumoehkx
   ```
7. Re-run `npx supabase migration list --project-ref fyuuvdsfxnytaumoehkx` and confirm the four moved from blank to recorded. Do **not** mark the eleven absent migrations as applied.

#### C. Surgical apply of the three new migrations

8. **Preflight (read-only SELECTs).** Confirm every prerequisite returns a row and every new object is absent:
   ```sql
   select to_regprocedure('private.is_admin()');
   select to_regprocedure('private.set_updated_at()');
   select to_regprocedure('public.admin_bulk_set_classified_badge_counts(jsonb)');
   select to_regprocedure('public.admin_bulk_rollback_classified_badge_counts(jsonb)');
   select to_regprocedure('public.admin_set_verified_badge_count(uuid,integer,text)');
   select to_regclass('public.badge_catalog');            -- must be null
   select to_regclass('public.badge_sync_runs');          -- must be null
   select to_regclass('public.badge_sync_operation_ledger'); -- must be null
   ```
   Also verify the participants columns, frozen-rank triggers, and RLS/grants from §15.5.
9. **Apply `20261110000100` in one explicit transaction** through the dashboard SQL editor or a supervised `psql` session using operator-supplied credentials. Do not use the local CLI link as the target.
   Verify: 2 tables, 2 functions, 2 indexes, 1 trigger, 2 policies; catalog count = 64; category counts = 47 Skill / 17 Arcade; zero `/badges/` keys; zero unclassified rows; `anon` has no catalog access.
10. **Apply `20261110000200` in one explicit transaction.**
    Verify: 3 tables, 11 functions, 4 indexes, 4 triggers, 3 policies; RLS enabled on all three tables; `anon` has no access; `authenticated` has `SELECT` only; every admin RPC exists with the expected signature; `anon` has no `EXECUTE`.
11. **Apply `20261110000300` in one explicit transaction.**
    Verify: ledger table/indexes/policy; both request-id unique indexes; 4 functions; the setter and rollback signatures are unchanged; `anon` cannot execute; the setter body now includes `expected_skill_count`/`expected_arcade_count`; the rollback body includes the expected-state guards.
12. Record the three versions:
    ```powershell
    npx supabase migration repair --status applied `
      20261110000100 20261110000200 20261110000300 `
      --project-ref fyuuvdsfxnytaumoehkx
    ```
13. Re-run `migration list` and confirm the recorded set matches the objects that actually exist.

#### D. Verification after each migration

14. **RPC permission matrix.** Assert:
    - `anon` cannot execute any `admin_*` RPC.
    - `authenticated` can execute the admin RPCs, and a non-admin session receives `42501`.
    - `service_role` can execute.
    - `get_public_summary()` remains executable by `anon`/`authenticated`.
    - `anon` column grants on `participants` are unchanged; `removed_at` remains authenticated-only.
15. **Manual CSV regression (preview only).** Upload the real classified CSV as an admin. Compare the preview's definitions, totals, per-row deltas, blocked count, and unclassified count against the local 324→64 result. Do not apply until the preview is reconciled. This is the production data-integrity gate.
16. **Canary apply.** Apply a run whose target counts equal the current live counts (a no-op run) or a single explicitly chosen participant. Confirm:
    - `applied` status and stored `apply_result`;
    - one ledger row per participant;
    - no duplicate `participant_audit_events` row on re-apply;
    - no unexpected `frozen_rank` allocation.
17. **Rollback drill.** Roll back the canary run. Confirm counts return to the pre-apply snapshot and audit history remains. Record whether any frozen rank was allocated; if yes, confirm the accepted permanence policy.
18. **Public smoke tests.** Leaderboard loads, summary totals match, removed participants are hidden, `anon` cannot read admin tables/RPCs.
19. **Monitor.** Watch Postgres logs, API errors, audit volume, ledger conflicts, and frozen-rank changes for 24–48 hours before a full live run.

#### E. Rollback decision criteria

Abort or roll back if any of the following occurs:

- A migration errors, or any object is missing/extra after a step.
- Catalog count is not 64, category totals are not 47/17, or any `/badges/` key or unclassified row appears.
- Any `anon` role can execute an admin RPC or read a new admin table.
- Preview totals do not match the expected 324→64 classification.
- Apply writes a removed participant, a stale row, or violates Skill+Arcade=Total.
- A re-apply appends a duplicate audit or ledger row.
- A frozen rank is allocated that was not expected and the permanence policy has not been accepted.
- Public summary/leaderboard results change unexpectedly.

**Data rollback:** `public.admin_rollback_badge_sync_run(run_id, request_id)`. It is atomic and current-state-aware, but it cannot clear a frozen rank.  
**Schema rollback:** `supabase/rollbacks/20261110000300_badge_sync_apply_schema_rollback.sql`. It restores the exact `20261105000100` bodies and drops the migration-3 objects. It is unverified until rehearsed. It does not undo migrations 1 or 2.  
**Recovery:** with PITR disabled and no listed backup, the only recovery is the logical dump. That is why §A.2 is a hard gate.

#### F. Operations requiring explicit approval

- Enabling PITR/physical backups, creating a full data dump, or performing any restore.
- `supabase migration repair` (history write).
- Any production SQL/DDL apply, including the three migrations.
- `supabase db push`, with or without `--include-all`.
- Vercel deployment.
- Git commit, stage, or push.
- Enabling Google profile fetching, cron, workers, or automation flags.
- Any data rollback or schema rollback.

### 15.9 Explicit blockers

| ID | Blocker | Why it blocks | Clearance condition |
| :--- | :--- | :--- | :--- |
| B1 | No usable backup/PITR recovery point | `pitr_enabled:false`, `backups:[]`; no tested restore. A failed DDL or bad apply would have no reliable recovery. | A PITR/physical recovery point exists, or a full logical dump has been restored and verified in a scratch environment. |
| B2 | Unresolved migration-history drift | 18 unrecorded; 4 applied, 11 genuinely pending. A normal push would attempt all 18 unrecorded migrations (14 pending + 4 re-runs) and expand scope far beyond Badge Sync. | Repair only the four observed-applied versions; choose and document surgical vs full catch-up; prohibit `db push` until the legacy backlog is resolved. |
| B3 | Schema rollback unverified | The migration-3 rollback has never been executed; migrations 1/2 have no rollback script. | Rehearse migration 3 + rollback + re-apply locally; explicitly accept forward-only for the additive migrations 1/2. |
| B4 | Frozen-rank permanence is not covered by rollback | An apply can allocate a permanent rank; count rollback cannot remove it. | Accept the permanence policy in writing, or provide and test a privileged, audited rank-repair procedure. |
| B5 | No production data reconciliation | The CSV was validated locally, not against live participant rows. Production data was deliberately not dumped. | Run a production preview-only regression and reconcile totals, blocked rows, removed participants, and unknown identities. |
| B6 | Application/schema mismatch | Current `main` calls multiple RPCs that production does not have; affected admin features fail if invoked. | Separately authorize/deploy the missing legacy migrations, or remove/guard the affected actions before a full app deployment. |
| B7 | Work is uncommitted | There is no traceable deployment artifact; the three migrations, rollback, UI, and tests are untracked/modified. | Commit the reviewed work on a deployment branch after approval, then deploy that exact revision. |

### 15.10 Final verdict

**Overall Phase 1.5 verdict: CONDITIONALLY READY — NOT APPROVED FOR PRODUCTION.**

The Badge Sync implementation is locally sound and the three migrations are schema-compatible with the current production database. The rollback SQL for the two replaced RPCs is byte-identical to the production bodies. None of the three new migrations depends on the absent legacy group.

Production deployment is **not safe today** because:

1. There is no usable backup/PITR recovery point.
2. Migration-history drift makes a normal `db push` unsafe and would expand the change to fourteen migrations.
3. The schema rollback is unverified, and the two additive migrations have no rollback script.
4. Count rollback cannot reverse a frozen-rank allocation.
5. There is no production preview/data reconciliation for the CSV.
6. The application and database are already out of sync because eleven legacy migrations are absent.
7. The work is not committed, so the deployed artifact would not be traceable.

**Safe to deploy:** No.  
**Safe only after the blockers are cleared:** Yes, via the surgical three-file path in §15.8, with a recovery point, history repair, local rollback rehearsal, production preview reconciliation, and explicit human approval.  
**Current safe actions:** Local development, local tests, read-only production inspection, and documentation. No production write, deployment, or automation is authorized by this review.

### 15.11 What Phase 1.5 did not do

- No production migration, `db push`, `migration repair`, or `--include-all`.
- No production DDL/DML, backup, restore, or PITR change.
- No Vercel deployment.
- No Git commit, stage, or push.
- No Google profile fetching, cron, worker, or automation activation.
- No production participant/audit/admin data dump or secret exposure.
- No use of the local CLI link or `.env.local` as an implicit production target.
- No code changes; this section is the only file modified by Phase 1.5.

**Phase 1.5 stops here and waits for explicit approval before any further action.**

---

## 16. Phase 1.6 — Local Verification, Restore Drill, and 10 November 2026 Import Gate

**Review date:** 2026-11-10  
**Production project:** `fyuuvdsfxnytaumoehkx` (`gdg-aceit-leaderboard`, `ap-south-1`, `ACTIVE_HEALTHY`)  
**Local target:** `supabase_db_gdg-aceit-learn-communities` (`gdg-aceit-learn-communities`, PostgreSQL 17.11)  
**Mode:** Local verification and documentation only. No production database write, no production SQL mutation, no import, no apply, no `db push`, no `migration repair`, no deployment, no Git stage/commit/push, and no Google fetch/cron/worker activation.

### 16.1 Verdict summary

| Question | Answer |
| :--- | :--- |
| Is Phase 1.6 verification complete? | Yes for Tasks 1–4 and Task 6; Task 5 passed with documented local-environment limitations. |
| Was the migration-3 schema rollback rehearsed? | Yes. It was executed, verified, and followed by a clean re-apply and the full pgTAP suite. |
| Is the expanded concurrency suite green? | Yes. All nine scenarios passed three consecutive full runs. |
| Is the frozen-rank policy tested? | Yes. `badge_sync_frozen_rank_policy.test.sql` passed 32 assertions. |
| Is the local backup/restore drill usable as a production recovery point? | **No.** It proves the local artifact is restorable, but it is not a production backup and did not exercise non-empty participant data. |
| Is the 10 November 2026 CSV available? | **No.** The expected file was not found anywhere in the accessible workspace or the searched user folders. |
| Has any 10 November data been validated, previewed, or applied? | **No.** No participant counts were generated, reconstructed, or assumed. |
| Is production safe to touch today? | **No.** |
| Overall verdict | **LOCALLY VERIFIED — 10 NOVEMBER IMPORT BLOCKED — NO PRODUCTION CHANGE AUTHORIZED.** |

The Phase 1.6 work reduces the local verification gap. It does not clear the production recovery, migration-history, data-reconciliation, application-schema, or traceability blockers. The missing 10 November CSV is an additional, independent blocker for today's badge update.

### 16.2 Task 1 — Migration-3 rollback and re-apply rehearsal

The migration-3 rollback was exercised against a disposable local database, not inferred from source inspection.

| Step | Command / assertion | Result |
| :--- | :--- | :--- |
| 1. Reset local database | `npx supabase db reset --local` | Pass. All 22 migrations applied in order. |
| 2. Run schema rollback | `supabase/rollbacks/20261110000300_badge_sync_apply_schema_rollback.sql` | Pass. Exit code 0. |
| 3. Verify migration-3 objects | Apply/rollback RPCs, ledger table, request-id indexes absent | Pass. |
| 4. Verify migration-2 objects | Runs, staging, staged-badge tables, preview/approval RPCs still present | Pass. |
| 5. Verify restored RPC bodies | Compared with the canonical `20261105000100` definitions | Pass. Bodies matched exactly, including whitespace after newline normalization. |
| 6. Verify restored ACLs | `REVOKE ALL ... FROM public, anon` and `GRANT EXECUTE ... TO authenticated` | Pass. Effective privileges matched the expected state. |
| 7. Verify unrelated objects | No unrelated table, function, trigger, policy, or index changed | Pass. |
| 8. Re-apply migration 3 | `supabase/migrations/20261110000300_badge_sync_apply.sql` | Pass. |
| 9. Full SQL suite | `npx supabase test db --local` | **Files=16, Tests=383, Result: PASS.** |

**Effect on blocker B3.** The local half of B3 is resolved. The rollback is no longer merely written; it has been executed, compared, and followed by a successful re-apply. The production half of B3 remains open because the script has not been run against production and migrations 1 and 2 remain forward-only by design (they are additive and have no rollback script).

### 16.3 Task 2 — Migration inventory and forward-only strategy

The three Badge Sync migrations were inventoried directly from their SQL definitions.

| Migration | Objects created or replaced | Seed/data effect | Dependencies |
| :--- | :--- | :--- | :--- |
| `20261110000100_badge_catalog.sql` | 2 tables (`badge_catalog`, `badge_catalog_audit_events`), 2 indexes, 1 trigger, 2 RLS policies, 2 admin catalog RPCs | 64 structural catalog definitions (47 Skill, 17 Arcade) | `20261026000100` (`private.set_updated_at`, `private.is_admin`, `auth.users`) |
| `20261110000200_badge_sync_staging.sql` | 3 tables, 4 indexes, 4 triggers, 3 RLS policies, 11 functions (8 public, 3 private) | None; staging starts empty | `20261110000100`, `20261026000100`, `20261104000100`, `20261106000100` |
| `20261110000300_badge_sync_apply.sql` | Ledger table and indexes, apply/rollback RPCs, request-id uniqueness indexes; replaces 2 existing bulk RPCs | None directly; writes ledger and audit rows only when a run is applied | `20261110000200`, `20261105000100`, `20261026000100` |

**Forward-only decision.** Migrations 1 and 2 are additive and intentionally have no schema rollback script. If they must be removed, that is a separately reviewed destructive operation, not part of this runbook. Migration 3 has a schema rollback because it replaces existing production RPC bodies. The inventory confirms that none of the three migrations depends on the absent legacy migration group (`20261031000100`–`20261103000200`).

### 16.4 Task 3 — Expanded concurrency verification

`scripts/test-badge-sync-concurrency.mjs` was expanded from the original partial coverage to nine scenarios. The suite was run three consecutive times against the same local database; every run passed.

| # | Scenario | Result |
| :--- | :--- | :--- |
| 1 | Concurrent applies with different request IDs | Pass. Wrote once; the second session replayed the stored result. |
| 2 | Concurrent applies with the same request ID | Pass. Wrote once; no duplicate audit or ledger rows. |
| 3 | Two independent runs touching one participant | Pass. Serialized; the stale run failed with `40001` and wrote nothing. |
| 4 | Same-total Skill/Arcade split race | Pass. Rejected with `40001`; only the winning split was written. |
| 5 | Apply waiting on a rollback lock | Pass. Rejected with `40001`; rollback restored the snapshot once. |
| 6 | Rollback waiting on an apply lock | Pass. Rejected with `40001`; did not overwrite the later run. |
| 7 | Two simultaneous rollbacks | Pass. Replayed one stored result; audit and ledger rows were not duplicated. |
| 8 | Duplicate apply request ID across independent sessions | Pass. Rejected with `22023` before any write. |
| 9 | Duplicate rollback request ID | Pass. Rejected with `22023`; the partial rollback was rolled back atomically. |

**Effect on Section 13 item 1.** The previously partial two-session concurrency coverage is now closed for the enumerated scenarios. Residual risk remains for untested interleavings and for production timing under real load; the suite is evidence, not a proof of all possible schedules.

### 16.5 Task 4 — Frozen-rank preservation policy

`supabase/tests/badge_sync_frozen_rank_policy.test.sql` was added and passed **32 assertions**.

The existing frozen-rank implementation already provides the required controls:

- `private.capture_frozen_ranks` is statement-level and allocates newly eligible ranks deterministically by Skill, Arcade, Total, and participant UUID.
- `private.allocate_frozen_ranks` uses an advisory transaction lock so concurrent statements cannot interleave allocation.
- `private.protect_frozen_rank` rejects updates to `frozen_rank` or `rank_frozen_at` with SQLSTATE `42501`.
- A unique index (`participants_frozen_rank_key`) prevents duplicate frozen ranks.
- Badge Sync does not directly write `frozen_rank` or `rank_frozen_at`; it updates counts only.

**Effect on blocker B4.** B4 is technically satisfied: an apply can allocate a **new** permanent rank when a participant crosses a threshold, but Badge Sync cannot clear or overwrite an existing frozen rank. Count rollback does not reverse a new allocation. The permanent-preservation policy is therefore the recommended acceptance position. Any future rank repair must be a separately authorized, audited, privileged procedure; it is not part of Badge Sync, and no repair process currently exists.

### 16.6 Task 5 — Local backup and restore drill

A logical backup of the local database was taken and restored into disposable local databases. This proves the artifact and the restore procedure; it is **not** a production recovery point.

| Item | Value |
| :--- | :--- |
| Artifact | `C:\Users\Sajal Goyal\AppData\Local\Temp\opencode\phase16\phase16_local_backup.dump` |
| Size | 793,432 bytes |
| SHA-256 | `78E4B7FAB8566257E9C633C3AA365F7BA59F47DA79DFF6ECC9D844BB9C9B1F3C` |
| Source state | 15 MB database; `participants=0`, `audit=0`, `catalog=64`, `migrations=22`, `runs=0` |
| Restore role that succeeded | `supabase_admin`, with privileges |
| Catalog hash after restore | `7d94664286687a664b2c959a1c058709` (matched source) |
| Migration-history hash after restore | `9d206178a363f412040700a8539cc91b` (matched source) |
| Schema counts after restore | 25 tables, 63 indexes, 183 constraints, 51 functions, 11 triggers, 18 policies (matched source) |
| Effective privileges and RLS | Matched source exactly when restored with privileges |

**Documented limitations.**

1. The source database contained zero `participants` and zero `participant_audit_events` rows. The drill verified empty-state plus catalog/migration round-trip, not a non-empty participant or audit data round-trip.
2. Restoring the full cluster as `postgres` failed at `realtime.list_changes` with `permission denied to set parameter "log_min_messages"`.
3. `--clean --if-exists` failed on an empty target because `public.participants` did not exist.
4. `--no-privileges` did not preserve grants; the successful restore required privileges and the `supabase_admin` role.
5. Disposable databases `phase16_restore_test`, `phase16_restore_acl`, and any `phase16_restore_data` were left behind when Docker became unavailable during the original run. Docker was restored on 10 November 2026 and all three were dropped as their owner `supabase_admin`; the local baseline was then re-verified (participants=0, participant audit=0, catalog=64, catalog audit=0, runs=0, staging=0, ledger=0, migrations=22).

**Effect on blocker B1.** None. B1 requires a production recovery point, not a local dump. A full logical production dump restored and verified in a scratch environment, or an enabled PITR/physical backup with a confirmed restore point, is still required before production DDL.

### 16.7 Task 6 — B6 application/schema mismatch investigation

The production-absent RPCs were traced from application call sites to their defining migrations.

| Application path | RPC | Defining migration | Production status | Behavior when absent |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/admin/actions.ts` → `applyUnverifiedProgressAction` | `admin_import_unverified_progress` | `20261031000400` | Absent | Action fails if invoked. |
| `src/app/admin/actions.ts` → `recordProgressObservationAction`, `fetchProgressObservationAction` | `admin_record_progress_observation` | `20261101000100` | Absent | Actions fail if invoked. |
| `src/app/admin/actions.ts` → `fetchProgressObservationAction` | `claim_google_skills_observation_cooldown` | `20261102000100` | Absent | Action fails if invoked. |
| `src/app/admin/actions.ts` → `applyVerifiedBadgeCsvAction` | `admin_bulk_set_verified_badge_counts` | `20261103000100` | Absent | Action fails if invoked. |
| `src/app/admin/page.tsx` | `admin_get_latest_auto_progress_job` | `20261031000500` | Absent | Page degrades gracefully with a fallback. |
| `src/lib/auto-progress/` | Auto-progress job/observation RPCs | `20261031000100`–`20261031000300`, `20261102000100`, `20261102000300` | Absent | Worker/durable-job paths fail if invoked. |

All new Badge Sync server actions call only migration 1, 2, or 3 RPCs. Deploying Badge Sync therefore does **not** by itself resolve B6, and the new migrations do not depend on the missing legacy group. B6 remains a full-application readiness blocker, not a Badge Sync database blocker. The safe disposition is either a separately reviewed legacy catch-up or guarding/removing the affected actions before a full application deployment.

### 16.8 10 November 2026 import workflow (documented, not executed)

This is the exact workflow to use once the source file exists. None of it has been run for 10 November 2026.

1. **Obtain the final CSV.** The expected file is `gdg-aceit-badge-update-2026-11-10.csv`. Do not generate, reconstruct, or infer it from the 7 November or 9 November files.
2. **Place it in the import directory.** The intended path is `data/imports/gdg-aceit-badge-update-2026-11-10.csv`. Do not overwrite `data/classified-badge-import.csv`, and do not upload an intermediate or non-final artifact (`data/README.md` restrictions still apply).
3. **Validate before upload.** Run the file through the same parser contract used by the admin UI. A local dry parse must produce zero invalid, duplicate, conflict, unknown, sum-mismatch, or removed issues before the file is considered preview-ready.
4. **Open the admin importer.** Sign in as an administrator, open `Admin Workspace → Classified Badge Data Import`, and select the 10 November file.
5. **Preview only.** Submit the preview. The server validates the CSV, resolves each UUID against the live roster, captures the expected current state, creates a preview run, and computes a server-side fingerprint. Do not approve or apply at this stage.
6. **Reconcile the preview.** Review eligible rows, blocked rows, totals, per-participant deltas, source filename, source SHA-256, run status, and fingerprint. Stop if any value is unexpected or if the preview does not match the approved source.
7. **Request explicit approval.** Send the run ID, fingerprint, source SHA-256, eligible count, blocked count, Skill/Arcade/Total totals, and the exact proposed deltas. Wait for approval that names those values.
8. **Apply once, only after approval.** Apply through the audited run path, then execute the post-apply verification in §16.13.
9. **Roll back only if necessary.** Use the run-level rollback RPC. A count rollback does not reverse a newly allocated frozen rank.

### 16.9 CSV validation requirements

The importer enforces the following contract before a row can be staged:

| Requirement | Rule |
| :--- | :--- |
| File size | Greater than 0 bytes and no more than 1,000,000 bytes. |
| Row limit | No more than 500 data rows; the row limit is enforced during parsing and staging. |
| Encoding | UTF-8; a leading byte-order mark is tolerated. |
| Header | Exactly the five columns `participant_id`, `skill_badge_count`, `arcade_game_badge_count`, `total_badge_count`, `review_note`. Order is flexible; names are trimmed and case-insensitive; duplicate or missing names are rejected. |
| Column count | Every data row must contain exactly five values. |
| Participant ID | Canonical UUID, case-insensitive on input and normalized to lowercase. |
| Counts | Non-negative base-10 integers from 0 to 10,000. Leading zeroes beyond `0`, signs, decimals, whitespace-only values, and unsafe integers are rejected. |
| Sum invariant | `skill_badge_count + arcade_game_badge_count` must equal `total_badge_count`. Unclassified/unknown badges must be resolved before import. |
| Review note | Trimmed length 1–1,000 printable characters. Control characters (`U+0000`–`U+001F`, `U+007F`) are rejected. |
| Duplicates | A participant may appear only once. All rows for a duplicated participant are excluded; conflicting counts are reported as a conflict. |
| Roster match | Every UUID must exist in the current roster. Unknown UUIDs are excluded. |
| Removed participants | Participants with `registration_status = 'removed'` are excluded and cannot receive counts. |
| Stale state | The preview stores the expected total, last-verified timestamp, and verification source per row. Apply re-reads live state and rejects a stale or conflicting row with `40001`; nothing is partially written. |
| Source identity | The source filename and SHA-256 are recorded on the run. The SHA-256 must be 64 lowercase hex characters. |

A CSV that fails any of these checks is not eligible for approval. Fix the source file and create a new preview; do not edit staged rows or bypass the parser.

### 16.10 Preview-only execution

For the classified CSV path, “preview-only” means:

- `previewClassifiedBadgeCsvAction` parses the file and resolves rows against the live roster.
- It calls `admin_create_classified_badge_sync_run` with the row-number, participant, counts, review note, and expected-state fields. That RPC creates a draft run and staged classified rows and returns a snapshot with a stable fingerprint.
- It does **not** call `admin_apply_badge_sync_run`, `admin_bulk_set_classified_badge_counts`, `admin_bulk_set_verified_badge_counts`, or `admin_set_verified_badge_count`.
- It does **not** change `participants`, `participant_audit_events`, `frozen_rank`, `rank_frozen_at`, or leaderboard-visible counts.
- It does persist the preview run and staging rows. Those are audited workflow records, not participant count changes.

A preview review must confirm all of the following before approval is requested:

- [ ] Run status is `previewed`, and a fingerprint is present.
- [ ] Source filename is the 10 November file and the recorded SHA-256 matches the file being approved.
- [ ] Eligible count equals the number of rows the operator expects.
- [ ] Blocked count is zero or every blocked row has an accepted explanation.
- [ ] Skill + Arcade = Total for the run aggregate.
- [ ] Per-participant deltas match the reviewed source.
- [ ] No unknown, removed, duplicate, conflicting, or sum-mismatch issue is unresolved.
- [ ] No removed participant and no frozen-rank field appears in the proposed changes.

If live state changes after the preview, the fingerprint or expected-state checks will make the preview stale. Re-preview; do not force an apply.

### 16.11 Production safety controls

| Control | Behavior |
| :--- | :--- |
| Admin authorization | Every action calls the admin authorization path and the SQL admin RPCs call `private.is_admin()`. |
| RPC-only writes | The UI does not write participant tables directly; counts flow through audited RPCs. |
| RLS and grants | Badge Sync tables revoke `anon`/`authenticated` writes, enable RLS, and grant admin reads through policies. Ledger direct writes are denied. |
| Server-side identity | The client submits only the run ID and fingerprint. Client-side rows, flags, and `window.confirm` are not authorization. |
| Fingerprint revalidation | Approval and apply revalidate the preview fingerprint under a row lock. |
| Request idempotency | The server generates a request UUID per apply/rollback. Unique request-id indexes and the ledger `(run_id, participant_id, operation_type)` key prevent duplicate writes. |
| Atomicity | Apply and rollback are transactional; a stale or conflicting row aborts the whole batch. |
| No-op re-apply | A run whose live counts already equal the target replays the stored result without a duplicate audit event. |
| Removed-participant guard | Removed participants are rejected by preview and apply. |
| Frozen-rank guard | Badge Sync never writes rank fields; `private.protect_frozen_rank` rejects direct rank changes with `42501`. |
| Catalog protection | Catalog rows are delete-protected; catalog changes are audited. |
| Audit preservation | Rollback restores counts but preserves audit history. |
| No automation | Import, apply, deployment, Google fetching, cron, and workers remain manual and approval-gated. |

### 16.12 Approval requirements

No production import may proceed until all of the following are true:

1. The final 10 November CSV exists at a verified path and has not been fabricated or reconstructed.
2. The local parser reports zero unresolved issues, and the file's SHA-256 is recorded.
3. A production preview has been generated and reconciled against live roster state.
4. The operator has submitted the run ID, fingerprint, source SHA-256, eligible count, blocked count, and Skill/Arcade/Total totals.
5. A human has explicitly approved those exact values and authorized the apply.
6. The production recovery point and migration-deployment blockers relevant to the environment are cleared, or the apply is limited to the already-deployed Badge Sync schema under a separately approved procedure.
7. No approval is inferred from a previous day, a previous run, a UI confirmation alone, or a conversation summary.

Separate explicit approval remains required for enabling PITR/physical backups, creating a production dump, performing a restore, running `migration repair`, applying DDL, using `db push`, deploying the application, staging/committing/pushing Git, or enabling Google fetch/cron/worker paths.

### 16.13 Post-apply verification procedure

After an approved apply, verify in this order:

1. **Run status and result.** Confirm the run is `applied`, a stored `apply_result` exists, and the request ID is the one generated for this apply.
2. **Fingerprint and source.** Confirm the applied fingerprint equals the approved fingerprint and the recorded source SHA-256 equals the approved file.
3. **Per-participant counts.** Compare each participant's live `verified_badge_count`, `skill_badge_count`, and `arcade_game_badge_count` with the approved preview rows.
4. **Run aggregates.** Confirm Skill, Arcade, Total, applied count, blocked count, and unclassified/pending counts match the preview.
5. **Ledger.** Confirm exactly one ledger row per applied participant for the operation type; confirm no duplicate `(run_id, participant_id, operation_type)` rows.
6. **Audit.** Confirm the expected audit events exist for changed participants and that an identical re-apply does not append duplicates.
7. **Frozen ranks.** Compare the pre-apply `frozen_rank`/`rank_frozen_at` snapshot with live state. Confirm no existing rank changed; confirm any newly allocated rank was expected and the permanence policy is accepted.
8. **Removed participants and mappings.** Confirm no removed participant received counts and no participant mapping changed.
9. **Public output.** Confirm the leaderboard loads, public summary totals match the database, and removed participants remain hidden.
10. **Rollback readiness.** If a rollback drill is part of the approved run, roll back a canary/no-op run and confirm live state returns to the snapshot while audit history remains.
11. **Monitoring.** Watch Postgres logs, API errors, audit volume, ledger conflicts, and frozen-rank changes for 24–48 hours before a broader live run.

If any check fails, stop, preserve evidence, and use the run-level rollback only after confirming its current-state guards. Do not manually edit counts or frozen ranks.

### 16.14 Current blocked status — 10 November 2026 CSV not located

The required source file was searched for across the entire accessible workspace and the relevant user folders.

| Search | Result |
| :--- | :--- |
| Exact filename `gdg-aceit-badge-update-2026-11-10.csv` | **Not found.** |
| Filename patterns `2026-11-10`, `20261110`, `nov10`, `10nov` | No CSV match. Only Badge Sync migration/rollback files dated in their names. |
| CSV/XLSX files modified on or after 2026-11-09 | Only the 7 November and 9 November import artifacts exist; no 10 November artifact. |
| `Downloads`, `Desktop`, `Documents` | No matching file. |
| `data/imports/` contents | `gdg-aceit-badge-update-2026-11-07.csv`, its preview JSON, `gdg-aceit-badge-update-2026-11-09.csv`, its preview JSON, and `gdg-aceit-badge-update-2026-11-09-report.md`. |

**Consequence.** There is no 10 November CSV to validate, preview, or apply. The 7 November and 9 November files are historical artifacts and must not be reused as today's update. No participant badge counts were generated, reconstructed, or assumed.

A reported 10 November baseline (195 registered, 7 soft-removed, 304 Skill, 20 Arcade, 324 Total, 16 frozen ranks) is recorded only as an expectation to be tested. It is not CSV data and was not used to create rows. The preview must independently prove or disprove it from live state before any approval.

**Local environment note.** Docker Desktop was unavailable during the original Phase 1.6 run (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`), which blocked cleanup of the disposable `phase16_restore_*` databases. Docker was restored on 10 November 2026. The databases `phase16_restore_test`, `phase16_restore_acl`, and `phase16_restore_data` (the last did not exist) were dropped as owner `supabase_admin`, and the local baseline was re-verified: participants=0, participant audit=0, catalog=64, catalog audit=0, badge sync runs=0, staging=0, staged badges=0, ledger=0, frozen ranks=0, migrations=22. This closes the local cleanup item only. It does not affect the missing-CSV conclusion and does not authorize a production workaround.

### 16.15 Phase 1.6 results matrix

| Item | Scope | Result | Evidence / limitation |
| :--- | :--- | :--- | :--- |
| Task 1 | Migration-3 rollback, restore, re-apply, full pgTAP | **PASS** | Rollback exit 0; exact RPC/ACL match; migration-2 intact; re-apply clean; 16 files / 383 tests. |
| Task 2 | Migration inventory and dependency map | **PASS** | Object counts, seed effect, prerequisites, and forward-only decision documented. |
| Task 3 | Expanded concurrency suite | **PASS** | Nine scenarios passed three consecutive runs. |
| Task 4 | Frozen-rank policy tests | **PASS** | `badge_sync_frozen_rank_policy.test.sql`: 32 assertions. |
| Task 5 | Local backup and restore drill | **PASS WITH LIMITATIONS** | Artifact and schema/ACL round-trip verified; zero-row participant source; `postgres`/`--clean`/`--no-privileges` limitations documented. |
| Task 6 | B6 application/schema mismatch investigation | **PASS** | Call sites mapped to absent legacy migrations; Badge Sync has no dependency on them. |
| 10 November CSV validation | Parse and roster resolution | **BLOCKED** | Source file absent. |
| 10 November preview | Production preview-only reconciliation | **BLOCKED** | No validated file; no preview generated. |
| 10 November apply | Audited count write | **NOT RUN — BLOCKED** | No approval is possible without a validated preview. |
| Production deployment | Migrations, app, Git | **BLOCKED** | B1, B2, B5, B6, B7 remain open; B3/B4 require production-level acceptance. |
| Local cleanup | Drop `phase16_restore_*` databases | **PASS** | Docker restored 10 November 2026; all disposable databases dropped as `supabase_admin`; local baseline re-verified (participants=0, audit=0, catalog=64, runs=0, migrations=22). |

### 16.16 Remaining blockers and recommended next phase

| ID | Status after Phase 1.6 | Remaining clearance condition |
| :--- | :--- | :--- |
| B1 | **Open** | A production PITR/physical recovery point, or a full logical production dump restored and verified in a scratch environment. The local Task 5 dump does not satisfy this. |
| B2 | **Open** | Repair only the four observed-applied versions; document the surgical three-file path; keep `db push` prohibited until the legacy backlog is deliberately resolved. Task 2 is inventory evidence, not a history repair. |
| B3 | **Locally resolved; production open** | The migration-3 rollback is rehearsed locally. Before production, either accept forward-only for the additive migrations 1/2 in writing and retain the migration-3 rollback, or provide a separately reviewed full rollback plan. |
| B4 | **Technically resolved** | Accept permanent frozen-rank preservation in writing, or authorize and test a privileged, audited rank-repair procedure outside Badge Sync. No repair process exists today. |
| B5 | **Open — now blocked by missing CSV** | Supply the 10 November CSV, validate it, generate a production preview-only run, and reconcile totals, blocked rows, removed participants, and unknown identities. |
| B6 | **Open** | Separately authorize/deploy the missing legacy migrations, or guard/remove the affected admin actions before a full application deployment. Badge Sync alone does not resolve B6. |
| B7 | **Open** | Commit the reviewed work on a deployment branch after approval, then deploy that exact revision. Nothing has been staged, committed, or pushed. |
| B8 | **New — open** | Provide the final `data/imports/gdg-aceit-badge-update-2026-11-10.csv`. Do not fabricate or reuse historical data. |

**Recommended next phase.** Phase 1.7 should be a **10 November CSV validation and preview-only reconciliation** once the file is supplied. That phase should parse the exact file, record its SHA-256, generate one preview run, and report the eligible/blocked counts, totals, and deltas without applying. Production deployment and the 10 November apply should remain separate, later approvals after B1, B2, B5, B6, and B7 are cleared and B3/B4 are accepted at the production level.

### 16.17 What Phase 1.6 did not do

- No production database write, DDL, DML, migration, `db push`, or `migration repair`.
- No production backup, restore, PITR change, or recovery-point claim.
- No 10 November import, preview, apply, rollback, or approval.
- No fabricated, reconstructed, or assumed participant counts.
- No reuse of the 7 November or 9 November CSV as 10 November data.
- No change to frozen ranks, soft-removed participants, or existing participant mappings.
- No Vercel deployment.
- No Git stage, commit, or push.
- No Google profile fetching, cron, worker, or automation activation.
- No production participant/audit/admin data dump or secret exposure.

**Phase 1.6 stops at a locally verified, documented, and blocked 10 November import gate. It waits for the missing CSV and explicit approval before any further action.**

## 17. Phase 2 - One-click "Sync All Badges" bridge (local only)

### 17.1 Verdict summary

| Task | Result | Evidence |
| :--- | :--- | :--- |
| Run-scoped fetch queue migration | **PASS (local)** | `20261110000400_badge_sync_fetch_queue.sql` applied by `supabase db reset --local`. |
| Strict structural identity extraction | **PASS** | Modal hrefs only; `/badges/<id>` and titles never decide category or completeness. |
| Batched route and pause/resume semantics | **PASS** | Admin/origin/2-gate checks, 20 items, concurrency 6, ~15 s timeout, 400 ms pacing default, `maxDuration = 60`. |
| One-click admin UI | **PASS** | `#badge-sync` nav item, progress bar, pause/resume, classifier, preview, apply, rollback, disabled state. |
| Node tests | **PASS** | 298/298. |
| SQL tests | **PASS (local)** | 18 files / 484 assertions, including 69 in the new queue suite. |
| TypeScript / ESLint | **PASS** | `npm run typecheck` clean; no ESLint findings on changed files. |
| Production database / deployment | **NOT TOUCHED** | No migration applied remotely, no push, no deploy, no secret change. |

Phase 2 is complete as a **local, reviewable implementation**. It is not deployed and both live-fetch gates remain `false`.

### 17.2 What the bridge does

The one-click flow connects two previously separate systems without reusing the undelivered legacy auto-progress tables:

1. `POST /api/admin/badge-sync/batch` with `action: "start"` calls `admin_create_badge_sync_fetch_run`, producing a `badge_observations` run with `source = 'profile_evidence'`.
2. The first claim seeds `badge_sync_fetch_queue` with one row per **active, non-removed** participant.
3. Each invocation claims up to 8 rows with `FOR UPDATE SKIP LOCKED`, fetches up to 4 profiles concurrently with a ~15 s timeout, parses structural identities, stages observations, and finishes every claimed item.
4. The client repeats `action: "continue"` until the queue is complete; the route then prepares staging, auto-approves catalog-classified `skill`/`arcade` badges, and returns a deterministic preview.
5. Apply and rollback continue to use the existing audited Badge Sync server actions and fingerprint/ledger writers. Phase 2 adds no new count writer.

The queue is deliberately independent of `automatic_badge_*` durable-job tables. Only the shared `runDurableBatch`/safe-fetch primitives are reused for bounded concurrency and timeouts.

### 17.3 Structural identity rules

Identity comes exclusively from the badge modal target:

| Rendered target | Canonical key |
| :--- | :--- |
| `/course_templates/<id>` | `course_template:<id>` |
| `/games/<id>` | `game:<id>` |

`/badges/<id>` (award-scoped) and badge titles are ignored for classification and completeness. The parser returns an explicit reason, which maps to an observation status:

| Situation | Observation | Counts |
| :--- | :--- | :--- |
| Unique, resolved cards | `complete` | Catalog classification decides Skill/Arcade |
| Zero cards / empty container / ambiguous container | `incomplete` | `[]`; previous counts preserved |
| Unresolved or duplicate card identity | `incomplete` | `[]`; previous counts preserved |
| Identity mismatch, challenge, access denied, malformed HTML, error, timeout | `failed` | `[]`; previous counts preserved |

A single untrustworthy profile can only block itself. It can never turn into a zero write for that participant.

### 17.4 Migration `20261110000400_badge_sync_fetch_queue.sql`

- Adds `fetch_paused_at` and `fetch_pause_reason` to `badge_sync_runs` with a trimmed-length check.
- Creates `public.badge_sync_fetch_queue` with `(run_id, participant_id)` uniqueness, `pending | claimed | staged | failed | skipped` statuses, lease token/expiry, attempt count, retry backoff, and outcome metadata.
- `admin_create_badge_sync_fetch_run(text)` creates a `profile_evidence` observation run.
- `admin_claim_badge_sync_fetch_batch(uuid, integer, integer)` seeds missing active participants, retires mid-run removed participants as `skipped`, recovers expired leases, and claims with `FOR UPDATE SKIP LOCKED`.
- `admin_finish_badge_sync_fetch_item(...)` fences every write by `lease_token`, supports `staged | failed | skipped | pending`, and clears leases on terminal states.
- `admin_set_badge_sync_fetch_pause(uuid, boolean, text)` pauses/resumes and clears pending `retry_after` on resume.
- `admin_badge_sync_progress(uuid)` returns total/claimed/staged/failed/skipped/processed/remaining/completeness/pause state.
- `admin_prepare_badge_sync_staging(uuid)` clears an unapplied preview, recomputes from the current catalog, and returns the run to `staged`.
- `admin_preview_badge_sync_run(uuid)` is replaced with a queue-aware completeness guard: a run that owns queue rows cannot preview while any item is `pending`/`claimed` or while any active participant lacks a staging row. Manually staged runs and classified-count runs keep the original behavior.

All queue RPCs are `SECURITY DEFINER`, use a fixed empty `search_path`, check `private.is_admin()`, and are revoked from `public`/`anon`. `authenticated` has no direct INSERT/UPDATE/DELETE on the queue table.

### 17.5 Route contract

`src/app/api/admin/badge-sync/batch/route.ts`:

- `dynamic = "force-dynamic"`, `maxDuration = 60`.
- Rejects missing/mismatched `Origin`, non-admin sessions, and disabled fetch gates.
- Constants live in `fetch-batch.ts`: batch 20 (clamped 1-32, matching the queue RPC's `least(32, ...)`), concurrency 6 (clamped 1-8), ~15 s timeout, pacing from `BADGE_SYNC_FETCH_PACING_MS` (default 400 ms, clamped 0-10 000).
- `POST` actions: `start`, `continue`, `pause`, `resume`, `preview`, `repreview`.
- On HTTP 403/429 the route halts the current batch, leaves unattempted items `pending`, pauses the run, and returns `status: "paused"`. It does not burn through the roster.
- A batch with `claimed === 0` while incomplete returns `paused` so the client backs off instead of hot-looping.
- `GET ?runId=` returns queue progress for reloads.
- Unexpected RPC/network failures return `temporarily_unavailable`; no counts are written.

### 17.6 UI

`src/components/badge-sync-sync-all.tsx` and the `#badge-sync` section in `src/components/admin-workspace.tsx` provide:

- **Sync All Badges** with an explicit disabled state and message when either gate is off.
- Progress bar and staged/failed/skipped/remaining statistics.
- Pause/resume, with rate-limit halt messaging.
- Unclassified identity list scoped to `course_template`/`game` choices, an audited reason field, and catalog classification.
- Deterministic preview summary and participant table with explicit `—` for NULL counts (never a fake zero).
- **Confirm and apply** only when a fingerprint exists; **Roll back this run** only after apply.
- Re-preview after classification.

Apply/rollback are the existing `applyBadgeSyncRunAction`/`rollbackBadgeSyncRunAction` server actions, so audit, fingerprint validation, idempotency, frozen-rank preservation, and rollback semantics are unchanged.

### 17.7 Tests and verification

| Command | Result |
| :--- | :--- |
| `npm test` | 298/298 pass |
| `npm run typecheck` | clean |
| `npx eslint <changed files>` | clean |
| `npx supabase db reset --local` | all 23 migrations apply |
| `npx supabase test db` | 18 files / 484 assertions pass |

New Node coverage:

- `src/lib/badges/structural-identities.test.ts` - strict mapping, NULL preservation, reason-to-status behavior.
- `src/lib/badges/fetch-batch.test.ts` - claim/fetch/stage/finish, 403/429 halt, untouched pending work.
- `src/lib/badges/batch-state.test.ts` - reducer, progress percentage, unclassified aggregation, loop termination.
- `src/lib/auto-progress/parser.test.ts` - structural modal extraction, including a real `game:` sample and an empty-container sample.

New SQL coverage (`supabase/tests/badge_sync_fetch_queue.test.sql`, 69 assertions): privileges, admin/non-admin, seeding, active-only roster, claims, lease fencing, retry backoff, pause/resume, expired-lease recovery, mid-run removal, finish transitions, progress, completeness guard, prepare/re-preview, apply, non-observation rejection, and RLS.

### 17.8 Local-only status and remaining gates

- No migration was applied to production `fyuuvdsfxnytaumoehkx`.
- No `git push`, `vercel deploy`, cron change, or secret change was made.
- `AUTO_PROGRESS_ENABLED` and `GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED` remain `false` by default; `BADGE_SYNC_FETCH_PACING_MS` was added to `.env.example`.
- Production deployment is still blocked by the Phase 1.6 items: no verified PITR/recovery point (B1), migration-history drift (B2), production rollback acceptance (B3), frozen-rank policy acceptance (B4), the missing 10 November CSV/preview (B5), legacy migration mismatch (B6), and an uncommitted/unpushed revision (B7).
- Live fetching additionally requires written Google Skills authorization for the intended retrieval.

**Phase 2 stops at a locally tested, committed-only bridge. Enabling either gate, applying the migration remotely, or deploying the route remains a separate production approval.**
