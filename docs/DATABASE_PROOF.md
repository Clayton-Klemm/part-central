# Database design: explicit guarantees and measured costs

This document separates a proof about allowed data states from a measurement
of one running implementation. There is no honest proof that a database is
the fastest possible for every dataset, workload, cache state and machine.
The objective here is precise history, enforceable relationships, bounded
interactive queries and repeatable performance evidence.

## 1. Functional dependencies and normalization

For the engineering definition, the declared dependencies are:

| Relation | Candidate keys / dependencies | Why it is separate |
| --- | --- | --- |
| `parts` | `id → number, name, description`; unique `number → id` | One business part identity |
| `part_revisions` | `id → part_id, code, material, finish, …`; `(part_id, code) → id` | A revision's requirements do not overwrite another revision |
| `operations` | `id → revision_id, code, setup, …`; `(revision_id, code) → id` | Setup and requirements share one controlled revision |
| `characteristics` | `id → operation_id, number, nominal, limits, …`; `(operation_id, number) → id` | Requirements are defined once per operation |
| `jobs` | `id → number, created_at`; unique `number → id` | A multi-day job groups many independent sheets |
| `measurements` | `id → event facts`; `(run_id, sequence) → id` | Re-measurements append evidence instead of replacing it |
| `employees` | `number → display_name, role, …` | A recorded author references a valid local employee |

Under these declared dependencies, the master-data projections have only
key determinants and satisfy BCNF. This is a statement about those
dependencies, not a blanket BCNF claim for the entire physical schema.
Business rules that introduce another dependency require reassessment.

Deliberate exceptions are documented rather than hidden:

- `inspection_runs` repeats `revision_id`, although `operation_id` determines
  it. The composite foreign key `(operation_id, revision_id)` makes an
  inconsistent pair unrepresentable. This is controlled redundancy for an
  explicit revision boundary, not strict 3NF under that dependency.
- A measurement stores `status`, although the immutable requirement and
  value determine its result. API decimal evaluation and a database trigger
  reject a contradictory result. This is auditable derived data.
- `references_snapshot` and the historical inspector label intentionally
  preserve what a sheet used at creation time. They are immutable historical
  snapshots, not copies maintained as current master data.
- The local employee number identifies a claimed operator; it does not
  prove that the human owns that number. Database integrity cannot establish
  real-world identity or gauge calibration.

## 2. Why the definition joins are lossless

Let `F` be a characteristic definition and `O` its operation. Their shared
attribute is `operation_id`, which is a key of `O`:

$$
F \cap O = \{operation\_id\},\qquad operation\_id \rightarrow O.
$$

Each legal `F` row has exactly one matching `O` row: the foreign key ensures
existence and the primary key ensures uniqueness. Joining cannot lose the
characteristic or multiply it. The same argument applies from operation to
revision and revision to part. Equivalently, the binary lossless-join
criterion is `(R1 ∩ R2) → R1` or `(R1 ∩ R2) → R2`.

`python scripts/prove_design.py` checks attribute closures and these three
decompositions for the explicit dependency set. It proves those implications;
`scripts/database_audit.py` separately checks the actual live keys and foreign
keys. PostgreSQL's own constraints protect future legal states, and adverse
direct-write tests verify the enforcement boundary. See the [PostgreSQL
constraint documentation](https://www.postgresql.org/docs/17/ddl-constraints.html).

## 3. A numeric example of avoiding repeated definitions

Let `T` be the number of inspected samples, `F` the feature count, `R` the
bytes of requirement text per feature, and `M` the bytes of reading facts.
Ignoring IDs, tuple headers, indexes, compression and snapshots:

$$
S_{repeated}=TF(R+M),\quad S_{separated}=FR+TFM
$$

$$
S_{repeated}-S_{separated}=(T-1)FR.
$$

For `T = 10,000`, `F = 20`, `R = 256 B`, `M = 64 B`, this illustration is
64,000,000 B versus 12,805,120 B: **51,194,880 B (48.82 MiB)** less repeated
requirement text. This is an algebraic example, not measured PostgreSQL disk
savings or a claim that every normalized query is faster. The audit report
records actual table-plus-index sizes separately.

![Manim illustration of separating requirements from inspection events](assets/normalization-proof.gif)

## 4. Revision and measurement invariants

For every part `p`:

$$
\sum_{r:\,r.part\_id=p.id}\mathbf{1}[r.is\_active] \le 1.
$$

A partial unique index on `part_id WHERE is_active` enforces this across
concurrent transactions. A check requires an active revision to be released.
Zero active revisions is valid: an administrator can temporarily withdraw a
part. Released requirements and prior reference editions are immutable.
Starting a new sheet checks the active revision while holding the part lock;
continuing an old sheet uses its pinned revision.

For a run with current maximum sequence `s`, a save takes the run-row lock
before checking the supplied expected sequence. Two clients both expecting
`s` cannot both append: the first commits `s + 1`; the second then sees
`s + 1` and receives **409 Conflict**. The unique `(run_id, sequence)` key
also prevents duplicate event numbers. An intentional server-side append
without an expectation is serialized, but cannot detect a stale user's
intent; the application always supplies the expectation. Completion takes
the same lock and requires every characteristic. After completion, triggers
reject changes and additions. The live PostgreSQL tests exercise both save
races and completion-versus-save races.

For a bilateral requirement, acceptance is:

$$
n-t_- \le x \le n+t_+.
$$

Minimum-only and maximum-only limits use `x ≥ n` and `x ≤ n`, respectively.
Geometric magnitudes also require `x ≥ 0`. Signed dimensional/angular
coordinates remain legal. `NUMERIC(14,6)` represents the supported values
on an exact decimal lattice. For `12.500000 ± 0.025000`, `12.475000` passes
and `12.474999` fails. API boundary tests and direct database writes verify
the same rule; binary floating-point equality is not the database decision.

Each new event requires an existing employee number and shift `1`, `2` or
`71` (weekend); the API supplies the employee from the authenticated session. Completion
stores its own signer and shift. A shift belongs to the event, so a later
operator can continue the same job without rewriting earlier attribution.
Legacy events retain NULL shift when none was recorded. Migration 0008
preserved the canonical fingerprints of **3,247 events and 413 sheets**;
[before](migration-0008-before-fingerprint.json) and
[after](migration-0008-after-fingerprint.json) contain hashes, not row data.

The historical storage domain is `{NULL, 1, 2, 3, 71}`; the current write
domain is `{1, 2, 71}`. Migration 0010 widens the shift columns to two
characters without relabeling existing `3` records. Insert guards and the
draft-to-completed transition enforce the current write domain, while
append-only/completed-sheet guards protect the larger historical domain.
Thus storing a legacy fact does not authorize creating another such fact.
These are business-domain constraints, not a change in functional dependencies
or justification for a new index.
The isolated PostgreSQL upgrade retained identical [before](migration-0010-verification-before-fingerprint.json)
and [after](migration-0010-verification-after-fingerprint.json) hashes for
**8,147 events, 1,024 sheets, 26 assets, and 21 reference editions**. The
subsequent operator-stack upgrade retained the same whole-set hashes and
passed a separate [per-row protected-fact comparison](migration-0010-preservation.json).
No shift was relabeled, including recorded `3` or unknown NULL attribution.

Native sketches have a relational ownership rule as well. If a reference
edition selects a built-in sketch, it must select the exact sketch assigned
to that edition's operation, the operation and sketch must share a revision,
the sketch path must be `generated://operation-sketch`, and an uploaded sketch
cannot also be selected. No part-number or ID-prefix pattern establishes
ownership. Migration 0009 generalized this rule to all eight supported
families while preserving **5,701 events, 718 sheets, 6 assets and 8 reference
editions**. Its [before](migration-0009-before-fingerprint.json) and
[after](migration-0009-after-fingerprint.json) hashes include existing non-NULL
shift and completion attribution. Live opaque-ID and cross-ownership probes
verify the predicate independently of the example naming convention.

## 5. Costs, indexes and bounded payloads

For an indexed equality lookup with `N` entries, a B-tree provides
`O(log_B N + K)` index work to locate and return `K` matching entries under
the usual balanced-tree model. It does not guarantee an end-to-end latency:
heap reads, cache misses, locks, sorting, joins and network time still matter.
The composite `inspection_runs(job_id, created_at)` index follows the exact
job filter. The unique measurement `(run_id, sequence)` index supports a
run's ordered event history. Leading equality columns matter for
[PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html).

The summary query first selects a bounded sheet page, then aggregates events
only for those run IDs in one batch. It does not load all job events into the
browser and does not issue one query for each returned sheet. Event work is
still proportional to the selected runs' histories; append-only records
need a future archival/pagination strategy if individual sheets grow large.
Offset pagination also becomes more expensive at very deep offsets; adopt
keyset pagination when actual history sizes justify it.

Catalog name/material prefix searches use case-insensitive predicates and
windowed operation selection. The current small catalog does not prove that
those searches will remain fast with millions of parts; a suitable search
index and simpler query may be warranted after representative measurement.

`database-audit-after.json` records actual `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)` plans for representative job-page and event-history access paths.
These plans are deliberately not presented as the entire API summary query.
Sequential scans can be optimal for small tables; forcing an index is not
evidence of a faster design. [PostgreSQL EXPLAIN documentation](https://www.postgresql.org/docs/17/using-explain.html).

Connection pools obey the explicit configured bound:

$$
C_{API}\le containers\times workers\times(pool+overflow)
=1\times4\times(5+5)=40.
$$

One hundred signed-in browsers do not imply one hundred open DB connections.
For a stable workload with finite means, Little's law is `L = λW`. If 100
operators each save once every 10 seconds, `λ = 10 saves/s`; if the **mean**
request residence time were `W = 0.2 s`, `L = 2` average in-flight save
requests. This is a hypothetical workload calculation, not a capacity proof,
and p95 cannot be substituted for the mean. The synchronized burst benchmark
is transient, so it is not used to infer a steady-state pool size.
[Little's original paper](https://pubsonline.informs.org/doi/10.1287/opre.9.3.383).

## 6. The required change gate

`api/AGENTS.md` records the user's requirement for future work. On an idle
local test stack, run:

```powershell
./scripts/verify_database.ps1
```

It runs the full backend suite, relational examples, pre/post migration
fingerprints, PostgreSQL migration/model agreement, adversarial direct-write
and concurrency checks, integrity/plan snapshots, and 100 signed-in clients
with three samples per job. It retains synthetic jobs and raw evidence.
The current regression budget requires zero unexpected errors and overall
and save p95 no greater than **1,000 ms**. This is a chosen local regression
budget, not a claim about the eventual production service agreement.

The `postgres` CI job runs on every push and pull request, with no schema
path filter that could miss a persistence change. It uploads raw reports.
The independent backend CI job runs the entire SQLite regression/migration
suite. Once the user creates a remote repository, configure `postgres` as a
required branch-protection check; no remote settings were changed locally.

When a design changes, update its dependencies/invariants, add preservation
and failure cases, rerun the gate, compare raw plans and timings against an
appropriate baseline, and regenerate the Manim report from the successful
JSON. Do not raise a budget solely to conceal a regression. Schema shape,
current-state audits, transaction tests and workload measurements supply
different evidence; none replaces the others.
