# Automatic-progress database harnesses

Both database-mutating concurrency harnesses require a fresh, disposable local Supabase project. They refuse to use the repository's normal project ID, an endpoint/key supplied directly by the caller, a non-temp project directory, containers with mismatched Supabase/Compose project labels or workdir, an API port that does not map to this project's Kong container, missing or ambiguous API services, incomplete migration history, or any nonempty participant/rank/job/import state.

Create a new temporary project for each run. Do not reuse a project after either harness runs: Top 10 ranks are intentionally permanent, including after fixture participants are deleted.

```powershell
$repo = 'C:\Users\Sajal Goyal\Projects\GDG_ACEIT'
$projectId = "gdg-aceit-ranktest-$([guid]::NewGuid().ToString('N'))"
$testProject = Join-Path $env:TEMP $projectId
$ports = @(58420, 58421, 58422)
if (Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue) {
  throw 'Choose a different free port block before starting the disposable project.'
}

New-Item -ItemType Directory -Path (Join-Path $testProject 'supabase') -Force | Out-Null
Copy-Item (Join-Path $repo 'supabase\config.toml') (Join-Path $testProject 'supabase\config.toml')
Copy-Item (Join-Path $repo 'supabase\migrations') (Join-Path $testProject 'supabase') -Recurse
Copy-Item (Join-Path $repo 'supabase\tests') (Join-Path $testProject 'supabase') -Recurse

$configPath = Join-Path $testProject 'supabase\config.toml'
$config = Get-Content -LiteralPath $configPath -Raw
$config = [regex]::Replace($config, '(?m)^project_id\s*=\s*"[^"]+"\s*$', "project_id = `"$projectId`"")
$config = [regex]::Replace($config, '(?m)^\[api\]\s*$', "[api]`r`nport = 58421")
$config = [regex]::Replace($config, '(?m)^\[db\]\s*$', "[db]`r`nport = 58422")
$config = [regex]::Replace($config, '(?m)^\[db\.migrations\]\s*$', "[db.shadow]`r`nport = 58420`r`n`r`n[db.migrations]")
[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

$supabase = Join-Path $repo 'node_modules\.bin\supabase.cmd'
& $supabase start --workdir $testProject --exclude gotrue,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
if ($LASTEXITCODE -ne 0) { throw 'Disposable Supabase startup failed.' }
& $supabase migration list --local --workdir $testProject
```

The REST-based concurrency harness requires both Kong and PostgREST, so do not exclude either service. The durable-job concurrency harness talks directly to PostgreSQL, but uses the same strict preflight. Confirm that the migration list shows the repository migration history as applied, then run a harness. The gate independently reads this temporary project's `config.toml` and `supabase status -o env`. It requires an explicit `[api].port`, checks that the status URL uses that port, then uses read-only Docker metadata to verify the exact database, Kong, and PostgREST containers: each must carry matching `com.supabase.cli.project` and `com.docker.compose.project` labels, the temporary project workdir, and exactly one attachment to `supabase_network_<project_id>` with nonempty Docker network and endpoint IDs. All three containers must report the same Docker network ID. The repository Supabase config defines no additional networks, so extra attachments are rejected. Kong's actual `8000/tcp` host port must uniquely match the configured API port and the address family of the exact `API_URL` hostname. IPv4 loopback URLs require an IPv4 loopback or IPv4 wildcard binding; IPv6 loopback URLs require an IPv6 loopback or IPv6 wildcard binding; `localhost` requires both families to be published on the same port. Wildcard URL hosts and other hostnames are rejected. PostgREST's `3000/tcp` must not be published to the host. It then checks that all repository migrations are applied, the participant and job/import tables are empty, and the persistent rank allocator is still at 1. Only selected labels, ports, and network metadata are read; container environment variables and status keys remain in process memory and are never printed.

```powershell
$env:AUTO_PROGRESS_TEST_PROJECT_DIR = $testProject
$env:AUTO_PROGRESS_TEST_EXPECTED_PROJECT_ID = $projectId
$env:AUTO_PROGRESS_ALLOW_DISPOSABLE_DB_MUTATION = 'I_ACCEPT_RANKS_ARE_CONSUMED'
npm run test:auto-progress-concurrency
# Or, instead, run the durable-job concurrency harness:
npm run test:auto-progress-jobs-concurrency

& $supabase stop --project-id $projectId --workdir $testProject --no-backup
```

Do not set the former `AUTO_PROGRESS_LOCAL_URL`, `AUTO_PROGRESS_LOCAL_SERVICE_KEY`, `AUTO_PROGRESS_LOCAL_ANON_KEY`, or `AUTO_PROGRESS_TEST_DB_CONTAINER` overrides. The harness derives its endpoint, keys, and database container from the verified temporary project. A failed identity, migration, or freshness check aborts before fixture writes.
