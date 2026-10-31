"""Read-only PostgreSQL schema, integrity, and query-plan evidence.

Run with the API dependencies and DATABASE_URL set, or pipe into the API
container: docker compose exec -T api python - < scripts/database_audit.py
No row values, credentials, employee numbers, or uploaded files are exported.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from sqlalchemy import inspect, text

root = Path(__file__).resolve().parents[1] if "__file__" in globals() and __file__ != "<stdin>" else Path.cwd().parent
if (root / "api").exists():
    sys.path.insert(0, str(root / "api"))
from app.database import engine


INVARIANTS = {
    "at_most_one_active_revision_per_part": "SELECT count(*) FROM (SELECT part_id FROM part_revisions WHERE is_active GROUP BY part_id HAVING count(*) > 1) x",
    "active_revision_is_released": "SELECT count(*) FROM part_revisions WHERE is_active AND status <> 'released'",
    "run_operation_matches_pinned_revision": "SELECT count(*) FROM inspection_runs r JOIN operations o ON o.id=r.operation_id WHERE r.revision_id <> o.revision_id",
    "measurement_belongs_to_run_operation": "SELECT count(*) FROM measurements m JOIN inspection_runs r ON r.id=m.run_id JOIN characteristics c ON c.id=m.feature_id WHERE c.operation_id <> r.operation_id",
    "unique_event_sequence_per_run": "SELECT count(*) FROM (SELECT run_id, sequence FROM measurements GROUP BY run_id, sequence HAVING count(*) > 1) x",
    "valid_recorded_shift": "SELECT (SELECT count(*) FROM measurements WHERE shift IS NOT NULL AND shift NOT IN ('1','2','3','71')) + (SELECT count(*) FROM inspection_runs WHERE completed_shift IS NOT NULL AND completed_shift NOT IN ('1','2','3','71'))",
    "recorded_shift_has_employee": "SELECT count(*) FROM measurements WHERE shift IS NOT NULL AND employee_number IS NULL",
    "completion_provenance_is_paired": "SELECT count(*) FROM inspection_runs WHERE (completed_shift IS NULL) <> (completed_by_employee_number IS NULL)",
    "native_sketch_matches_exact_operation_and_revision": """SELECT count(*) FROM operation_reference_versions v WHERE v.builtin_sketch_id IS NOT NULL AND
      (v.sketch_asset_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM operations o JOIN operation_sketches s ON s.id=o.sketch_id AND s.revision_id=o.revision_id
      WHERE o.id=v.operation_id AND s.id=v.builtin_sketch_id AND s.asset_path='generated://operation-sketch'))""",
    "completed_run_has_every_characteristic": "SELECT count(*) FROM inspection_runs r WHERE r.status='completed' AND EXISTS (SELECT 1 FROM characteristics c WHERE c.operation_id=r.operation_id AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.run_id=r.id AND m.feature_id=c.id))",
    "stored_outcome_matches_exact_limits": """SELECT count(*) FROM measurements m JOIN characteristics c ON c.id=m.feature_id
      WHERE m.status <> CASE WHEN (c.type <> 'geometric' OR m.value >= 0) AND (
        (c.limit_type='minimum' AND m.value>=c.nominal) OR
        (c.limit_type='maximum' AND m.value<=c.nominal) OR
        (c.limit_type='bilateral' AND m.value BETWEEN c.nominal-c.tolerance_minus AND c.nominal+c.tolerance_plus))
        THEN 'pass' ELSE 'fail' END""",
}


def main():
    assert engine.dialect.name == "postgresql", "Evidence must use the deployed PostgreSQL engine"
    inspector = inspect(engine)
    tables = sorted(t for t in inspector.get_table_names() if t != "alembic_version")
    with engine.connect() as connection:
        # A repeatable-read, read-only snapshot avoids mixed before/after counts.
        connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        version = connection.scalar(text("SELECT version_num FROM alembic_version"))
        violations = {name: connection.scalar(text(query)) for name, query in INVARIANTS.items()}
        counts = {table: connection.scalar(text(f'SELECT count(*) FROM "{table}"')) for table in tables}
        sizes = {table: connection.scalar(text("SELECT pg_total_relation_size(CAST(:table AS regclass))"), {"table": table}) for table in tables}
        settings = {name: connection.scalar(text("SELECT current_setting(:name)"), {"name": name}) for name in ["server_version", "max_connections", "shared_buffers"]}
        # Bind only synthetic LOAD jobs in plans. Actual IDs/numbers are not output.
        job = connection.execute(text("SELECT id FROM jobs WHERE number LIKE 'LOAD-%' ORDER BY created_at DESC LIMIT 1")).scalar()
        run = connection.execute(text("SELECT id FROM inspection_runs WHERE job_id=:job ORDER BY created_at DESC LIMIT 1"), {"job": job}).scalar() if job else None
        plans = {}
        if job:
            plans["exact_job_sheet_page"] = connection.scalar(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, created_at, status FROM inspection_runs WHERE job_id=:job ORDER BY created_at DESC, id DESC LIMIT 50"), {"job": job})
        if run:
            plans["run_event_history"] = connection.scalar(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT sequence, feature_id, status, recorded_at FROM measurements WHERE run_id=:run ORDER BY sequence"), {"run": run})
        triggers = connection.execute(text("SELECT event_object_table, trigger_name FROM information_schema.triggers WHERE trigger_schema='public' GROUP BY event_object_table, trigger_name ORDER BY 1,2")).all()
    # EXPLAIN embeds parameter literals; replace even synthetic row IDs.
    for value in [job, run]:
        if value:
            plans = json.loads(json.dumps(plans).replace(value, "<synthetic-id>"))
    keys = {}
    for table in tables:
        keys[table] = {
            "primaryKey": inspector.get_pk_constraint(table)["constrained_columns"],
            "uniqueConstraints": [{"name": v["name"], "columns": v["column_names"]} for v in inspector.get_unique_constraints(table)],
            "foreignKeys": [{"columns": v["constrained_columns"], "targetTable": v["referred_table"], "targetColumns": v["referred_columns"]} for v in inspector.get_foreign_keys(table)],
            "indexes": [{"name": v["name"], "columns": v["column_names"], "unique": v["unique"], "predicate": str(v.get("dialect_options", {}).get("postgresql_where", ""))} for v in inspector.get_indexes(table)],
        }
    # These schema facts bind the documented key/lossless-join proof to DDL.
    assert any(v["columns"] == ["operation_id", "revision_id"] and v["targetTable"] == "operations" for v in keys["inspection_runs"]["foreignKeys"])
    assert any(v["columns"] == ["run_id", "sequence"] for v in keys["measurements"]["uniqueConstraints"])
    assert any(v["unique"] and v["columns"] == ["part_id"] and "is_active" in v["predicate"] for v in keys["part_revisions"]["indexes"])
    result = {
        "capturedAt": datetime.now(timezone.utc).isoformat(), "schemaVersion": version,
        "readOnly": True, "consistentSnapshot": "REPEATABLE READ", "settings": settings,
        "rowCounts": counts, "tableAndIndexBytes": sizes, "invariantViolations": violations,
        "passed": not any(violations.values()), "keysAndIndexes": keys,
        "triggerNames": [{"table": table, "name": name} for table, name in triggers],
        "queryPlans": plans,
        "limits": ["Present-state invariant checks complement constraints and adversarial tests; they do not prove untested programs correct.",
                   "Plans below cover representative indexed access paths, not the full API summary aggregate or end-to-end latency.",
                   "Legacy shifts remain NULL when no contemporaneous shift was recorded; recorded legacy code 3 remains unchanged. New writes accept only 1, 2 and 71 (weekends)."]}
    print(json.dumps(result, indent=2, default=str))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
