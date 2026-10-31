param([ValidateRange(100,500)][int]$Users = 100, [ValidateRange(3,5)][int]$Iterations = 3, [ValidateRange(1,60000)][int]$MaxP95Ms = 1000)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskRoot
$taskPython = Join-Path $taskRoot 'api/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { $taskPython = 'python' }
function Assert-NativeSuccess([string]$Action) {
    if ($LASTEXITCODE -ne 0) { throw "$Action failed (exit $LASTEXITCODE). Preserve the report and investigate." }
}

& $taskPython -m pytest api/tests -q --basetemp api/.pytest-database-gate
Assert-NativeSuccess 'Backend regression tests'
& $taskPython scripts/prove_design.py
Assert-NativeSuccess 'Declared relational implications'

# Use an otherwise idle local test database. Hashing is not a lock; concurrent
# operator writes would invalidate a before/after migration comparison.
Get-Content scripts/history_fingerprint.py -Raw | docker compose exec -T api python - | Set-Content docs/migration-gate-before.json -Encoding utf8
Assert-NativeSuccess 'Historical fingerprint before migration'
docker compose up --build --wait -d api
Assert-NativeSuccess 'Local API build and migration'
Get-Content scripts/history_fingerprint.py -Raw | docker compose exec -T api python - | Set-Content docs/migration-gate-after.json -Encoding utf8
Assert-NativeSuccess 'Historical fingerprint after migration'
if ((Get-Content docs/migration-gate-before.json -Raw) -ne (Get-Content docs/migration-gate-after.json -Raw)) {
    throw 'Historical inspection facts changed during migration. Stop and inspect both fingerprints.'
}
docker compose exec -T api python -m alembic check
Assert-NativeSuccess 'ORM and migration agreement'
foreach ($taskSmoke in @('api/tests/postgres_smoke.py', 'api/tests/shift_smoke.py', 'api/tests/reference_smoke.py', 'api/tests/catalog_smoke.py', 'api/tests/native_sketch_smoke.py')) {
    Get-Content $taskSmoke -Raw | docker compose exec -T api python -
    Assert-NativeSuccess $taskSmoke
}
Get-Content scripts/database_audit.py -Raw | docker compose exec -T api python - | Set-Content docs/database-audit-before.json -Encoding utf8
Assert-NativeSuccess 'Integrity audit before load'
& $taskPython scripts/load_test.py --users $Users --iterations $Iterations --max-p95-ms $MaxP95Ms
Assert-NativeSuccess 'Concurrent inspection regression budget'
Get-Content scripts/database_audit.py -Raw | docker compose exec -T api python - | Set-Content docs/database-audit-after.json -Encoding utf8
Assert-NativeSuccess 'Integrity audit after load'
Write-Output 'PASS: historical facts, schema, integrity, races and latency budget. Synthetic inspection jobs are retained.'
