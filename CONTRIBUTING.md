# Contributing to Part Central

Part Central is a machining inspection demonstration with synthetic parts and
dimensions. Keep examples fictitious and clearly labeled. Do not submit employer
drawings, production inspection records, employee details, or credentials.

## Local development

Use Node.js 24 or later:

```sh
npm ci
npm run dev
npm test
npm run build
```

The default browser demo works without a database. The [README](README.md)
describes the separate Docker shared-server setup and its pilot limitations.

## Repository hygiene

Use `scripts/local/`, `.local/`, or `.tools/` for personal helpers, downloaded
tools, and scratch files. These folders are ignored by Git and Docker. Keep
credentials in ignored local configuration; `.env.example` contains placeholders
only. Databases, uploaded references, private backups, dependencies, and build
output must stay out of commits.

The maintained scripts directly under `scripts/` belong to the project. CI and
the documentation use them to reproduce database checks, synthetic drawings,
mathematical examples, and evidence GIFs. Keep published raw evidence alongside
its documented assumptions; put new unreviewed local reports in
`docs/local-evidence/` and review them before deliberately publishing evidence.

Before committing, inspect the staged file list and diff. Ignore rules do not
remove files that were already tracked.

## Data integrity and evidence

Read [AGENTS.md](AGENTS.md) and the [database change gate](api/AGENTS.md) before
changing persistence, query shapes, connection settings, or database design.
Run the complete gate on an idle local test stack and retain the raw reports.
Never reset an operator's data to make a check pass. Preserve released
definitions, reference snapshots, append-only readings, completed sheets, and
unknown historical authors or shifts.

Keep measured benchmarks separate from proofs of declared relationships. Update
the README and regenerate its evidence GIFs when displayed measurements change.

## Publishing the demonstration

Publication is a deliberate maintainer action. A normal push runs verification;
it does not deploy the site. See [GitHub Pages publishing](docs/PUBLISHING.md).
