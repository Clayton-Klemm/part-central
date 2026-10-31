# Run Part Central locally

Choose the browser demo for an individual walkthrough, or the Docker
shared-server version for a common database across workstations.

## Browser demo

Requires Node.js 24 or later:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Enter a sample employee number such as
**1234**, open **Part library**, and select a part to explore.

This mode runs without an API server or database. Example parts and dimensions
are synthetic, and inspection progress stays in that browser. It does not
provide shared records, administrator catalog management, or durable employee
sessions. A static browser demonstration is not an access-control boundary.

For the animated gear example, select **DG-1042 → Ramp start height** and expand
the feature guide. **MF-6100** demonstrates full-form thread depth separately
from drilled-hole depth. See [example coverage and controls](EXAMPLE_PARTS.md).

## Docker shared server

Requires Docker Desktop or Docker Engine with Compose.

1. Copy `.env.example` to `.env` in the project root.
2. Replace `POSTGRES_PASSWORD` with a strong URL-safe password. Use letters,
   numbers, underscores, and hyphens because it is part of `DATABASE_URL`.
3. To enable administrator reference uploads, set a separate random
   `ADMIN_TOKEN` of at least 32 characters. Leave it empty to disable admin
   writes. Keep `.env` local and out of Git.
4. Start the stack from the project root:

```sh
docker compose up --build -d
```

Open [Part Central](http://127.0.0.1:8080) or the
[interactive API documentation](http://127.0.0.1:8080/api/docs).

The stack includes the web app, four configurable API worker processes, and
PostgreSQL 17. Migrations and sample seeding run before the workers start.
PostgreSQL and uploaded reference files use separate persistent volumes.

To view API logs or stop the stack:

```sh
docker compose logs -f api
docker compose down
```

Stopping with `docker compose down` preserves the database and uploaded files.
Adding `-v` deletes those volumes, including inspection history; do not use it
to reset an operator's system or make verification easier.

The web port binds to this computer only by default. `HOST_BIND` and `WEB_PORT`
can select a server interface and port when preparing a deployment.

## Using the shared workspace

Sign in with a four-digit employee number. Open an existing job to continue,
or select a part and start a new inspection sheet. Lot/batch and sample remain
separate identifiers. Choose **1st (1)**, **2nd (2)**, or **Weekend (71)** before
saving readings. Earlier readings retain their original employee and shift.

After saving, **New sample inspection** opens a blank sheet under the same job
and lot and requires a fresh shift choice. It uses the active part revision;
the earlier sample retains its readings and status. Starting another sample
does not complete the earlier one. Sample labels are editable display
identifiers and may repeat; each sheet has its own unique run ID. The suggested
label considers the latest 50 summaries and is not a reserved unique number.

Use **Sample history** to reopen sheets and review progress and attribution.
Choose **Complete inspection** after recording every characteristic to lock a
finished sample with its completion signer and shift. The current sheet can
be exported as CSV and its audit trail as JSON.

For part administration, sign in as **0000** with the server's administrator
credential and open **Part management**. Prepare draft requirements, add
optional references, review, and release a revision. Changes to released
requirements go into a new draft instead of rewriting historical sheets.
Reference uploads support PDF, PNG, or JPEG up to 10 MiB; older sheets retain
their original reference snapshot. See [employee access and revisions](AUTH_AND_REVISIONS.md).

## Development checks

Frontend checks from the project root:

```sh
npm test
npm run build
```

Backend checks require Python 3.13 or later:

```sh
cd api
python -m venv .venv
# Activate .venv using your shell's command.
python -m pip install -r requirements.txt
python -m pytest tests -q
```

The database-backed web build uses `VITE_DATA_MODE=api`; the default is `demo`.
API requests use the same origin under `/api/`.

Persistence and database changes must follow the
[database work contract](../api/AGENTS.md). Run its complete gate against an idle
local test stack, preserving raw reports and clearly labeled synthetic jobs.
See [contributing](../CONTRIBUTING.md), [verification](VERIFICATION.md), and
[evidence reproduction](EVIDENCE_RENDERING.md) for the required checks.

## Pilot boundaries

Four-digit employee identification does not verify that a person owns the
claimed number. Administrator **0000** additionally requires the server
credential. Add TLS and verified organizational identity before broad
production access.

Production deployment also needs approved inspection procedures and drawings,
calibrated-gauge traceability, approval workflows, backups, and validation on
representative hardware, histories, and networks. The recorded synthetic
workload is not a production capacity guarantee. See [performance and rollout](PERFORMANCE.md).

Public demo releases are separate from local operation; follow the
[GitHub Pages publishing guide](PUBLISHING.md) when a release is intended.
