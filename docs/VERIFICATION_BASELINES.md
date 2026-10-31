# Historical verification rounds

This file preserves earlier iteration records. Counts and latency below are historical; see [current verification](VERIFICATION.md) for the final schema and workload.

# Verification

Verified locally on October 26, 2026.

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed on Windows and in Docker's Linux build stage |
| Frontend automated tests | 32 passed: tolerance boundaries, unilateral limits, invalid readings, audit export, geometry dimensions, animation progress, optional reference behavior, server-only inspection persistence, mechanical guide anchors, and MIN/MAX limits |
| Backend automated tests | 98 passed: employee sessions and roles, job scoping, active-revision lifecycle, bounded summaries, optional references, immutable snapshots, administrator writes, sequence conflicts, MIN/MAX limits, migrations, and existing inspection integrity |
| Dependency audit | No vulnerabilities reported by npm after updating Vitest |
| Docker Compose | Web, API, and PostgreSQL built and running with healthy checks |
| Live PostgreSQL | Migration/seed, inclusive boundaries, correction history, direct-write guards, simultaneous appends, and completion/write races passed |
| Schema drift | Alembic check passed against PostgreSQL |
| Browser | Instructions-only job start/completion, job-number archive search, retained version-0 historical sheet after a new sketch publication, and new version-1 sketch display, plus part-number search, sketch callouts, 3D expansion, keyboard entry, pass/fail, corrected values, clearing safeguards, completion locks, shared history discovery, and saved-run restoration verified |
| Final 100-client workload | 100/100 completed sheets, 1,400 requests, zero errors; overall p95 244.11 ms; save p95 198.89 ms, with expectedSequence on every measurement save and completion |
| Live administrator references | Authentication, PNG signature/read/checksum, immutable PostgreSQL asset/version guards, stale-version rejection, old-run snapshot retention, and writable nonroot asset volume passed |

The live PostgreSQL check intentionally retains labeled synthetic inspections. Invalid SQL probes run inside rolled-back transactions. The bounded load tests also retain their labeled jobs and sheets. No database reset is required. See [the measured workload and its limits](PERFORMANCE.md) and [full final report](load-test-results.json).

Deployment remains local-only. No remote repository or public deployment has been created. Automatic Pages publication is disabled; the optional workflow requires an explicit manual publication input.

Individual operator identity, production approval, approved CAD, calibration tracking, repeated-feature sampling, and regulated audit validation are outside the demo's verified scope; administrator reference writes are protected by a server credential. See [architecture](ARCHITECTURE.md).

Local adoption check: a basic JPEG sketch was stored only on the local Docker server, published as reference version 1 for RD-4200, and the completed JOB-ADOPTION-001 retained its original instructions-only reference snapshot. The diagram and 3D guide remain optional.

The final local browser check reopened JOB-ADOPTION-001 with its saved reference version 0, then started JOB-ADOPTION-002 using reference version 1. The added sketch is served from /api/reference-assets on the same local server; no diagram or animation is required. Administrator access and file selection were checked in the browser; the corrected JPEG upload and publication were verified directly against the local API.

## Employee and revision update

The expanded fixture contains ten active part numbers and 74 characteristics across gears, differential cases, bearing caps, flanges, shafts, threaded manifolds, rings, and housings. Additional inactive released and draft manifold revisions are available only in administration. A local UI-created DF-8100 demonstration part is also retained.

Browser verification covered operator 1234, administrator 0000 with the configured server credential, no admin actions in the operator navigation, a thread-depth failure at 17.999 and pass at 18.500 against MIN18, and the dedicated full-thread/drill-floor/gauge-lead section.

The full admin pipeline created DF-8100 revision A, saved requirements and a visual family, reviewed/released/activated A, and started JOB-REVISION-A-001. A new B draft changed a bearing-bore nominal from 68.000 to 68.010 and was released/activated. Deactivation and reactivation passed. Operator 5678 then saw only B in part lookup; the saved A job still showed 68.000 and its original 68.005 passing reading.

The post-authentication 100-client test completed 100 sheets and 1,400 measured requests with zero errors. Overall p95 was 275.59 ms; measurement save p95 was 184.94 ms. Sign-in was outside the clock, while session verification and employee-stamp checks were included. See [authenticated report](load-test-authenticated-results.json) and [scenario limits](PERFORMANCE.md).

Final magnitude regression: negative geometric readings (including maximum-only flatness/runout) are recorded as failures. Signed dimensional and angular readings retain their valid signed limits. Forward migration 0007 passed on local PostgreSQL without changing historical events; forged direct-database passing results were rejected. Final automated total: 32 frontend + 98 backend = 130 passing tests.
