# Shared-server performance and rollout

The initial capacity target is 100 or more connected workstations. A browser reads requirements, displays local animation, and sends short save requests; it does not hold a database connection while the operator studies a part. Capacity depends on active request rates, data size, assets, hardware, and network latency as well as the number of browsers.

The bounded workload below measures a specific 100-client scenario. It is not a promise that future deployments will have the same latency.

## Current measured result: schema 0010

On October 26, 2026, **100 signed-in clients completed 300 sheets across 100
jobs**, making **4,200 measured requests with zero unexpected request errors
and no failed clients**. Each client used one job number for three samples,
rotating the current shift codes **1, 2, and 71 (weekend)**. The workload
verified server-stamped employees, reading shifts, completion signers/shifts,
exact job-history membership, and archived provenance.

Overall p50/p95/p99 was **131.95 / 275.60 / 418.09 ms**, with **583.48 measured
requests/s** over a **7.198-second** synchronized burst and subsequent cycles.
Save p95 was **249.61 ms**. Overall/save p95 met the unchanged **1,000 ms**
local regression budget, with zero unexpected errors. This is a test criterion,
not a production service agreement.

The 101 employee sign-ins (one preflight plus 100 workstation sessions) occurred
before the timed barrier. Server session verification on every measured call
is included. Login latency, client construction, and readiness are excluded.

| Request | Count | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| Catalog search | 300 | 135.56 ms | 238.20 ms | 362.44 ms |
| Part requirements | 300 | 155.37 ms | 294.58 ms | 365.37 ms |
| Start job sheet | 300 | 244.80 ms | 473.70 ms | 515.33 ms |
| Save measurement | 2,400 | 130.80 ms | 249.61 ms | 359.46 ms |
| Complete sheet | 300 | 108.42 ms | 230.33 ms | 290.36 ms |
| Exact job history | 300 | 115.70 ms | 238.67 ms | 267.52 ms |
| Reopen saved sheet | 300 | 84.95 ms | 208.95 ms | 305.31 ms |

![Manim chart generated directly from the current raw report](assets/latency-report.gif)

The idle verification stack was a separate local Compose project,
`part-central-verify`, bound only to `127.0.0.1:8081`. It received a consistent
PostgreSQL dump and local copy of reference files from the operator's schema-0009
database. Its migration retained identical hashes for all **1,024 sheets,
8,147 events, 26 assets, and 21 reference editions**. Five PostgreSQL smoke
suites and the labeled browser example ran before the pre-load audit. There
was no other traffic to this clone during the timed burst. The operator's
separate `127.0.0.1:8080` stack remained available; no stress traffic targeted
it. Verification volumes and labeled jobs remain local for review.

The client and both Docker stacks shared one Windows 11 computer. Docker
29.8.2 had **32 logical CPUs and 20,967,440,384 bytes
(19.53 GiB)** available. The measured API used four workers,
pool size 5 plus overflow 5 per worker (40 API connections maximum).
PostgreSQL 17.11 allowed 100 connections for that database server.
The operator stack's idle processes were still on the host; these measurements
are not an isolated hardware comparison.

Immediately before the workload, the clone contained **16 parts,
24 revisions, 619 jobs, 1,029 sheets, and 8,187 events**.
Afterward it contained **719 jobs, 1,329 sheets, and 10,587 events**.
The [before audit](database-audit-before.json) and [after audit](database-audit-after.json)
each checked 11 invariants with zero violations. Existing shift `3` remains a
historical fact; new measurement and completion writes require `1`, `2`, or `71`.
Separate guarded-save race tests require one success and one 409 conflict.
Those expected conflicts are not errors in this independent-sheet load scenario.

The [raw report](load-test-shifts-results.json) retains statuses, percentiles,
schema, hardware, counts, shift codes, budget, and limitations. Representative
[query plans](database-audit-after.json) cover job-page/event-history paths,
not the full summary aggregate. Index usage and universal optimality cannot be
inferred from latency alone. Comparison with historical baselines does not
isolate the effect of this migration: the dataset, retained fixtures, and host
conditions differ.

### Retained baselines

The [schema-0009 baseline](load-test-shifts-0009-results.json) completed 300
sheets and 4,200 requests without errors; overall p95 was 279.15 ms and save
p95 was 256.83 ms. It used the earlier shift choices and a smaller retained
history. The original [before](database-audit-0009-before.json) and
[after](database-audit-0009-after.json) audits remain available.

The [schema-0008 shift baseline](load-test-shifts-0008-results.json) also completed
300 sheets and 4,200 requests without errors; overall p95 was 257.00 ms and
save p95 was 221.74 ms. It preceded the native-sketch guard migration and used
a smaller retained history. The [earlier authenticated baseline](load-test-authenticated-results.json)
completed 100 sheets and 1,400 requests, with overall p95 275.59 ms and save p95
184.94 ms. That earlier version did not record shifts.

The [pre-authentication baseline](load-test-results.json) completed 100 sheets
and 1,400 requests, with overall p95 244.11 ms and save p95 198.89 ms. It used
a smaller dataset and did not include session checks. These are historical
results with different conditions, not an isolated tuning experiment.

The [original localhost diagnostic](load-test-localhost-results.json) is also
retained. This computer resolved localhost to IPv6 before Compose's IPv4-only
binding, delaying connection attempts. The workload uses `127.0.0.1` to match
the local bound interface.

## Starting configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `API_WORKERS` | 4 | API processes sharing the listening port |
| `DB_POOL_SIZE` | 5 per worker | Retained database connections |
| `DB_MAX_OVERFLOW` | 5 per worker | Temporary burst connections |
| `DB_POOL_TIMEOUT` | 10 seconds | Bound the connection wait |
| `HOST_BIND` | `127.0.0.1` | Local-only access until server controls are ready |
| `WEB_PORT` | 8080 | Host web port |

Maximum API connection budget:

```text
containers × workers × (pool size + overflow)
1 × 4 × (5 + 5) = 40
```

Leave room for migrations, health checks, backups, monitoring, and administration. Increasing every pool and worker setting can exhaust the database limit rather than improve performance. Workers are separate processes with separate pools. [SQLAlchemy documentation](https://docs.sqlalchemy.org/en/20/core/pooling.html), [FastAPI worker documentation](https://fastapi.tiangolo.com/deployment/server-workers/).

Nginx serves the frontend and browsers cache versioned assets. Applicable JSON and static responses are compressed; upstream connections are reused. Uploads are bounded to 10 MiB in the application and 11 MiB at the proxy. Sketch/diagram files are not embedded in history JSON.

## Run the workload

Start Docker, then run from the repository root:

```powershell
api/.venv/Scripts/python.exe scripts/load_test.py --users 100 --iterations 3
```

On Unix, activate the backend environment and use `python scripts/load_test.py --users 100 --iterations 3`.

Preflight signs in an operator and validates the selected active part. Each workstation then signs in with its own four-digit employee number (`1000` upward), outside the timed phase. Clients meet at a synchronization barrier, search the catalog, load a part, start a labeled synthetic job, save every nominal reading with its expected sequence and selected shift, complete with its own signer/shift, search the exact job summary, and reopen the sheet. The workload verifies the server-stamped employee number on the sheet, each reading, completion, and archive response, as well as the selected shift and exact job-history membership. A failed sign-in aborts the barrier so peers are not left waiting.

Three cycles of the eight-characteristic sample produce 4,200 measured requests from 100 clients, with three sheets grouped under each client's job number. The 101 sign-in requests (one preflight plus one per workstation), client creation, and readiness checks are excluded from latency/throughput timing. Authentication checks performed by the server on every measured API call are included. The report includes request counts, errors, overall/per-endpoint p50/p95/p99, throughput, and the authentication scenario. Summary history must omit full event arrays.

The default script output is `docs/load-test-shifts-results.json`, preserving the earlier baseline reports. The overall and measurement-save p95 budget defaults to 1,000 ms and may be chosen explicitly with `--max-p95-ms`. A budget failure returns a nonzero exit code. Synthetic jobs and sheets remain for review. Nothing is deleted or reset. The target defaults to `http://127.0.0.1:8080` and remote targets require explicit `--allow-remote` for an authorized server.

`--users` is bounded to 1–500, `--iterations` to 1–5, and request timeout to 1–60 seconds. Additional cycles retain additional synthetic jobs; repeated testing belongs on a non-production database.

## Interpret results

Check errors before citing throughput. Use p95/p99 to assess slower operations; a fast average can hide delayed saves. Report hardware, dataset size, settings, and workload alongside latency numbers.

This is a synchronized burst against a small synthetic catalog, not 100 rendered browsers, an entire shift, real CAD files, wireless dead spots, backups, or the final production server. The load generator and Docker may compete for the same CPU. Client-host information is recorded; report server hardware separately if different.

Repeat on the intended server/network with representative histories and assets before rollout. Include read-heavy traffic, save bursts, and two operators sharing a sheet. Agree an acceptable save-latency/error-rate target and monitor it during adoption.

## Gradual rollout

Start with a small group of part families and retain established job numbers. Enter approved requirements and written instructions first; add basic sketches, diagrams, and validated animations later. Missing optional visuals do not block an inspection.

Existing paper/document systems can remain authoritative while definitions are reviewed and imported. Requirements, references, and job records are separate so a missing asset does not force an all-at-once migration.

Operators now identify themselves with four digits and receive local server sessions. This pilot does not verify ownership of a claimed employee number; administrator `0000` additionally needs the server credential. Before broad production exposure, add TLS, verified identity, backups/restore, and validated inspection procedures. Change `HOST_BIND` to a chosen server interface as part of that deployment decision.

## Required database-change gate

Run `./scripts/verify_database.ps1` on an idle local test stack after database
changes. It runs all backend tests, the declared relational implications,
before/after migration fingerprints, actual PostgreSQL migrations and model
agreement, five adversarial/race smoke suites, read-only integrity/query-plan
audits, and the 100-client three-cycle workload. CI runs equivalent PostgreSQL
checks on every push and pull request and preserves its raw reports.

See [database rationale and proofs](DATABASE_PROOF.md), [persistent work contract](../api/AGENTS.md),
and [Manim reproduction instructions](EVIDENCE_RENDERING.md). Keep correctness
and latency budgets separate: a failed invariant cannot be traded for a faster
save, and one passing short burst does not establish shift-long reliability.
