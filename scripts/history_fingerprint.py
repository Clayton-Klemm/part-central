"""Hash pre-existing audit facts before/after a migration; export no row values.

Pipe into the local API container with `python -`. Run again immediately
after migration, before traffic/tests append new events, and compare results.
"""
import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import inspect, text

if (Path.cwd() / "api").exists():
    sys.path.insert(0, str(Path.cwd() / "api"))
from app.database import engine

QUERIES = {
    "measurements": "SELECT id, sequence, run_id, feature_id, value, status, notes, recorded_at, employee_number FROM measurements ORDER BY id",
    "inspectionRuns": "SELECT id, revision_id, operation_id, job_id, references_snapshot, inspector, employee_number, lot_number, sample_number, status, created_at, completed_at FROM inspection_runs ORDER BY id",
    "referenceAssets": "SELECT id,operation_id,kind,name,media_type,storage_key,sha256,size_bytes,created_at FROM reference_assets ORDER BY id",
    "referenceVersions": "SELECT id,operation_id,version,sketch_asset_id,diagram_asset_id,builtin_sketch_id,model_available,notes,created_at FROM operation_reference_versions ORDER BY id",
}
TABLES = {"measurements": "measurements", "inspectionRuns": "inspection_runs", "referenceAssets": "reference_assets", "referenceVersions": "operation_reference_versions"}
OPTIONAL_COLUMNS = {
    "measurements": ["shift"],
    "inspectionRuns": ["completed_by_employee_number", "completed_shift"],
}
result = {}
inspector = inspect(engine)
with engine.connect() as connection:
    connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
    for name, query in QUERIES.items():
        table = TABLES[name]
        existing_columns = {column["name"] for column in inspector.get_columns(table)}
        optional = [column for column in OPTIONAL_COLUMNS.get(name, []) if column in existing_columns]
        if optional:
            query = query.replace(" FROM ", ", " + ", ".join(optional) + " FROM ", 1)
        fingerprint, count = hashlib.sha256(), 0
        for row in connection.execute(text(query)).mappings():
            facts = dict(row)
            # Newly added NULL means no fact was recorded. Omitting only those
            # optional NULL values keeps 0007→0008 comparable; non-NULL shift
            # and completion attribution is hashed for all later migrations.
            for column in optional:
                if facts[column] is None:
                    facts.pop(column)
            fingerprint.update((json.dumps(facts, sort_keys=True, default=str, separators=(",", ":")) + "\n").encode())
            count += 1
        result[name] = {"rows": count, "sha256": fingerprint.hexdigest()}
print(json.dumps(result, indent=2))
