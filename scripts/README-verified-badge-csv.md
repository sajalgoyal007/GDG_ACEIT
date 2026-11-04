# Admin-reviewed verified badge-count CSV

This is an offline preparation helper plus an authenticated admin preview/apply workflow. It does not fetch profiles, read Google data, or update a database. The website records counts only after an admin reviews the complete preview and confirms the operation.

## CSV formats

Download the current UUID/profile roster from **Admin → Badge Verification → Download current participant UUID roster**. The endpoint is authenticated and exports only `participant_id,profile_url`.

Prepare a reviewed source CSV with exactly these columns:

```csv
profile_url,verified_badge_count,review_note
```

Counts are whole numbers from 0 through 10000. `review_note` is required and should identify the evidence and review context. The offline tool matches normalized Google Skills profile UUIDs from `skills.google` or `cloudskillsboost.google` against the current roster. Ambiguous, duplicate, conflicting, unknown, malformed, or invalid rows are excluded; no profile URL, name, or count is placed in the JSON report.

## Prepare locally (no network or database access)

From the repository root:

```powershell
python scripts\prepare_verified_badge_csv.py `
  --roster .\verified-badge-roster.csv `
  --source .\reviewed-badge-counts.csv `
  --output .\verified-badge-counts-import.csv `
  --report .\verified-badge-counts-report.json `
  --skipped .\verified-badge-counts-skipped.csv
```

Inspect the clean CSV and sanitized report locally. Do not treat scraper candidate counts as verified evidence. The preparation helper intentionally does not decide whether evidence is adequate.

## Apply in the admin UI

1. Sign in to `/admin` with an authorized admin account.
2. Download the current roster, prepare the CSV, and select `verified-badge-counts-import.csv` in **Bulk verify badge counts**.
3. Review every eligible participant UUID, current count, proposed count, and review note. Fix rows listed as skipped before retrying them.
4. Check the explicit confirmation and confirm the browser prompt.
5. Download the success, skipped, and failed reports. A failed database transaction is all-or-nothing for its eligible batch; preview again before retrying.

The browser action calls `admin_bulk_set_verified_badge_counts`, which validates the complete batch, locks participant records in stable UUID order, rejects stale/conflicting state, and delegates each write to `admin_set_verified_badge_count`. Thus the existing audit source remains `admin_manual`, and the existing RPC records the authenticated actor, verification timestamp, previous/new values, and supplied review note. Exact retries reuse the existing idempotency behavior. This workflow never promotes unverified HTML observations and never writes automatic snapshots or ranks.

Each import is limited to 500 data rows. The project’s current roster of 114 participants fits in one operation.

## Offline tests

```powershell
python -m unittest scripts.test_prepare_verified_badge_csv
```
