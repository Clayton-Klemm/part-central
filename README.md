# Part Central

A machining inspection workspace that brings part requirements, job sheets,
drawings, and interactive 3D guidance together.

[**Open the live demo**](https://clayton-klemm.github.io/part-central/) ·
[Local setup](docs/SETUP.md) · [Database overview](docs/DATABASE.md) ·
[Contributing](CONTRIBUTING.md)

## Try the demo

1. Enter sample employee number **1234**. No account is needed.
2. Open **Part library** and choose **DG-1042** or **MF-6100**.
3. Explore a feature guide, start a demo job, choose a shift, and save a reading.

All example parts, dimensions, and illustrations are synthetic. The public
demo saves entries in your browser. Use the shared-server version for a common
database across workstations and administrator workflows.

![Interactive manifold guide showing thread depth and inspection requirements](docs/interactive-manifold-3d.jpg)

## What it does

- **Connects the job:** keep separate sample inspections together under one job
  number, with lot and sample identifiers.
- **Keeps requirements clear:** each inspection stays linked to its part
  revision, operation, and original reference snapshot.
- **Explains the measurement:** open sketches, diagrams, and interactive 3D
  guides alongside the inspection sheet.
- **Records who and when:** readings retain their employee, shift, and time;
  corrections keep the earlier event.
- **Supports the next shift:** reopen saved sheets and review sample history.
- **Locks completed work:** complete a finished sample and export its report
  or audit trail.

Parts can start with written requirements alone. Drawings and visual guides
can be added gradually. See the [example library](docs/EXAMPLE_PARTS.md).

## How the database connects

The shared-server version uses PostgreSQL. Part definitions describe what to
inspect; jobs and sample sheets organize the work; measurement events record
the results. Employees and reference versions connect that history to its
authors and original guidance.

![Database overview connecting parts, revisions, operations, characteristics, jobs, inspection sheets, and readings](docs/assets/database-overview.png)

Released requirements, earlier readings, reference snapshots, and completed
sheets are preserved as work continues. The [database guide](docs/DATABASE.md)
shows the tables and relationships in more detail.

GitHub Pages runs the browser demonstration. It does not host PostgreSQL or
share inspection records between visitors.

## Run it locally

For the browser demo, install **Node.js 24 or later**, then run:

```sh
npm ci
npm run dev
```

For the shared-server version, use **Docker Compose**. Follow the
[setup guide](docs/SETUP.md) to configure local credentials, start the app and
database, and preserve inspection data when stopping the stack.

## More information

| Guide | What you will find |
| --- | --- |
| [Setup](docs/SETUP.md) | Browser demo, Docker server, and development checks |
| [Database](docs/DATABASE.md) | Visual map of the tables and their connections |
| [Parts and references](docs/EXAMPLE_PARTS.md) | Example coverage and guide controls |
| [Employee access and revisions](docs/AUTH_AND_REVISIONS.md) | Part management and reference publishing |
| [Architecture](docs/ARCHITECTURE.md) | Application structure and deployment boundaries |
| [Verification](docs/VERIFICATION.md) | Recorded checks and supporting evidence |
| [Technical design](docs/DATABASE_PROOF.md) · [Performance](docs/PERFORMANCE.md) | Detailed rationale and measured workload results |
| [Publishing](docs/PUBLISHING.md) | Deliberate GitHub Pages releases |

## Project scope

Built with React, TypeScript, Three.js, FastAPI, SQLAlchemy, Alembic, and
PostgreSQL. This is a technical demonstration: its visual models are
illustrative, not certified CAD or controlled engineering drawings.

Production use requires verified employee identity, approved inspection
procedures and references, calibrated-gauge traceability, and backups. See
the [setup guide](docs/SETUP.md#pilot-boundaries) for the local pilot's limits.

MIT licensed. See [LICENSE](LICENSE).
