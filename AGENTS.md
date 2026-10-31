# Part Central project requirements

Keep development and application data local unless the user explicitly requests
publication. Do not push to GitHub, create cloud resources, or expose the local
server as a side effect of routine development.

Data integrity and measured speed are core product requirements. Any change to
database models, migrations, constraints, indexes, query shapes, transaction
logic, reference persistence, API persistence contracts, or connection settings
must follow the rigorous change gate in [api/AGENTS.md](api/AGENTS.md), even when
the edited file lives outside `api/`. Run `scripts/verify_database.ps1` (or all
of its checks individually) against an idle local test stack and retain raw
reports. Explain meaningful regressions;
never relax a check merely to make a change pass.

Keep the README's mathematical assumptions, normalization exceptions, database
invariants, and measured latency evidence accurate. Regenerate its Manim GIFs
when the displayed evidence changes. A proof of declared relationships and a
workload benchmark are different kinds of evidence; neither establishes that a
schema is universally optimal.

Preserve released engineering definitions, historical reference snapshots,
append-only readings, and completed sheets. Keep unknown legacy authors/shifts
unknown. Use labeled synthetic examples for tests; do not reset the user's
database to make verification easier.
