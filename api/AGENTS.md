# Database integrity and performance contract

The user explicitly requires rigorous testing for every database design change.
For changes to models, migrations, constraints, indexes, transaction behavior,
query shapes, or persistence contracts:

1. State the invariant and workload affected. Update `docs/DATABASE_PROOF.md`
   when functional dependencies, keys, exceptions to normalization, or index
   reasoning change. Never claim universally optimal performance.
2. Add an explicit forward migration; preserve released definitions and
   historical events. Keep unknown historical identity/shift unknown.
3. Run the complete backend suite, including upgrade-from-previous-schema
   preservation, invalid direct writes, decimal boundaries, author/shift
   attribution, append-only history and completed-sheet immutability.
4. Verify the actual PostgreSQL migration and `alembic check`, idempotent
   seeding, concurrent saves and completion/append races. SQLite alone does
   not validate PostgreSQL locks or triggers.
5. Capture `scripts/database_audit.py` before and after the repeatable
   authenticated 100-client load. Retain raw reports and explain dataset,
   hardware, exclusions and any changed latency. Unexpected errors must be
   zero; overall/save p95 must meet the declared regression budget.
6. Regenerate the supporting documentation's Manim evidence from the successful
   report when its displayed numbers change. Never fabricate or silently
   relabel a benchmark.

The local Windows gate is `./scripts/verify_database.ps1`. Use an idle local
test stack for migration fingerprint comparisons. CI runs migration, full
backend tests, PostgreSQL guards/races, algebra examples, integrity audits,
and 100 clients on every push/pull request; make the `postgres` check required
in repository branch protection when a remote repository is configured.

Do not weaken a correctness test or raise a budget merely to hide a regression.
Do not reset/delete inspection data to make a test pass. All generated test
jobs must be clearly synthetic and may be retained for review.
