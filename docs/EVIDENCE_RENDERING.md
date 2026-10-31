# Reproduce the database evidence

All rendering and load generation run locally. The application has no Manim
runtime dependency; the finished compact GIFs appear in the supporting
[design rationale](DATABASE_PROOF.md) and [performance evidence](PERFORMANCE.md).

## Run the correctness and workload gate

On an idle local Docker test stack, with the API Python environment installed:

```powershell
./scripts/verify_database.ps1
```

The default is 100 signed-in clients, three samples on each client's job,
zero unexpected errors, and an overall/save p95 budget of 1,000 ms. All
synthetic jobs remain stored. The script must be run on a quiescent test
database for before/after migration fingerprints to be comparable; a hash is
not a transaction lock on other operators' activity.

When an operator is already using the local stack, run the same gate components
individually and also capture `scripts/history_preservation.py` immediately
before and after the migration. Save its hash-only snapshots in an ignored
local directory and compare them with `--compare BEFORE AFTER`. It checks each
pre-existing immutable event/reference, each sheet's original pinned facts,
and every already-completed signoff. New appends and draft completions are
allowed and explicitly counted; they cannot conceal changes to protected
facts. Whole-database fingerprints remain recorded, but equality is claimed
only when concurrent activity has not changed that whole set. The helper's
`--self-test` covers append/completion acceptance and event/signoff/pinned-fact
tampering or deletion rejection. This supplements isolated migration tests;
it does not replace them or pause an operator's work.

To run only the measured workload, preserving a separate report:

```powershell
api/.venv/Scripts/python.exe scripts/load_test.py --users 100 --iterations 3 --output docs/load-test-shifts-results.json
```

The load script exits unsuccessfully on any unexpected HTTP error, missing
employee/shift stamp, incorrect exact-job history, incomplete scenario, or
exceeded p95 budget. Expected concurrency conflicts are exercised separately
in the PostgreSQL smoke tests, where exactly one competing guarded save
must succeed and one must return 409.

Capture the deployed schema, current-state invariants, physical table/index
sizes and representative query plans without exporting inspection values:

```powershell
Get-Content scripts/database_audit.py -Raw | docker compose exec -T api python -
```

The canonical history fingerprint helper selects original inspection facts
and, when present, shift/completion attribution. It omits newly added optional
NULL values from the canonical map so the 0007→0008 addition remains comparable;
every non-NULL shift and completion author is protected in subsequent hashes.
Each newly introduced audit column must be added to the fingerprint policy
and receive an explicit preservation test. Fingerprints demonstrate equality
of selected facts, not a backup, adversarial-security proof, or substitute
for migration tests.

## Render the actual Manim GIFs

Use Python 3.13 with FFmpeg available on PATH. The scenes use text objects
and vector shapes, so TeX is not required.

```powershell
python -m venv .tools-venv
.tools-venv/Scripts/python.exe -m pip install -r scripts/requirements-evidence.txt
.tools-venv/Scripts/python.exe scripts/build_evidence.py
```

On other platforms, activate that virtual environment and use `python`.
Manim renders 960 × 540 frames at 12 fps. FFmpeg makes a shared palette
without noisy dithering; the two GIFs total roughly 1 MiB. The build writes
`docs/assets/evidence-manifest.json` with SHA-256 hashes of scene source,
build helper, raw report and finished GIFs. This ties the chart to the exact
JSON used to render it.

`LatencyReport` reads endpoint p95 and scenario counts directly from the
successful report. It refuses to render an unsuccessful run. Update the
performance documentation's plain-text table alongside new results for accessible review.
`NormalizationProof` labels its storage arithmetic as an illustration,
with explicit byte assumptions; it does not present that example as a disk
benchmark. The exact algebra and lossless-join checks can run without Manim:

```sh
python scripts/prove_design.py
```

The local tools environment and intermediate movies are ignored by Git and
Docker. The committed GIFs and raw reports require no remote image service.
