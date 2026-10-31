"""Read-only, append-tolerant preservation evidence around a live migration.

Capture inside the API container; save the hash-only snapshots locally in an
ignored directory. Compare them using ``--compare BEFORE AFTER``. No actual
row values, employee numbers, file contents or raw row IDs leave the capture.
Every pre-existing measurement/reference and completed signoff is protected.
An existing draft may legitimately acquire new events or complete while an
operator works; its original pinned facts must still remain identical.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys


def digest(value):
    encoded = json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def capture():
    from sqlalchemy import text
    if (Path.cwd() / "api").exists():
        sys.path.insert(0, str(Path.cwd() / "api"))
    from app.database import engine
    assert engine.dialect.name == "postgresql", "Live evidence uses PostgreSQL"
    queries = {
        "measurements": "SELECT id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift FROM measurements ORDER BY id",
        "inspectionRuns": "SELECT id,revision_id,operation_id,job_id,references_snapshot,inspector,employee_number,lot_number,sample_number,status,created_at,completed_at,completed_by_employee_number,completed_shift FROM inspection_runs ORDER BY id",
        "referenceAssets": "SELECT id,operation_id,kind,name,media_type,storage_key,sha256,size_bytes,created_at FROM reference_assets ORDER BY id",
        "referenceVersions": "SELECT id,operation_id,version,sketch_asset_id,diagram_asset_id,builtin_sketch_id,model_available,notes,created_at FROM operation_reference_versions ORDER BY id",
    }
    result = {"capturedAt": datetime.now(timezone.utc).isoformat(), "tables": {}}
    with engine.connect() as connection:
        connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        result["schemaVersion"] = connection.scalar(text("SELECT version_num FROM alembic_version"))
        for name, query in queries.items():
            table = {}
            for row in connection.execute(text(query)).mappings():
                facts = dict(row)
                identity = digest([name, facts["id"]])
                if name == "inspectionRuns":
                    original = {key: value for key, value in facts.items() if key not in {"status", "completed_at", "completed_by_employee_number", "completed_shift"}}
                    table[identity] = {"core": digest(original), "status": facts["status"],
                                       "completed": digest(facts) if facts["status"] == "completed" else None}
                else:
                    table[identity] = {"facts": digest(facts)}
            result["tables"][name] = table
    return result


def compare(before, after):
    tables = {}
    all_passed = True
    for name, previous in before["tables"].items():
        current = after["tables"].get(name, {})
        missing, altered, completed_drafts = 0, 0, 0
        verified_before, verified_after = {}, {}
        for identity, facts in previous.items():
            next_facts = current.get(identity)
            if next_facts is None:
                missing += 1
                continue
            if name == "inspectionRuns":
                scope = {"core": facts["core"]}
                next_scope = {"core": next_facts["core"]}
                if facts["status"] == "completed":
                    scope["completed"] = facts["completed"]
                    next_scope["completed"] = next_facts["completed"]
                elif next_facts["status"] not in {"draft", "completed"}:
                    altered += 1
                elif next_facts["status"] == "completed":
                    completed_drafts += 1
            else:
                scope, next_scope = facts, next_facts
            altered += scope != next_scope
            verified_before[identity], verified_after[identity] = scope, next_scope
        passed = missing == 0 and altered == 0
        all_passed &= passed
        tables[name] = {"beforeRows": len(previous), "afterRows": len(current), "preExistingCompared": len(verified_before),
                        "additionalRows": len(current.keys() - previous.keys()), "legitimateDraftCompletions": completed_drafts,
                        "missingRows": missing, "alteredProtectedFacts": altered, "passed": passed,
                        "beforeProtectedSha256": digest(verified_before), "afterProtectedSha256": digest(verified_after)}
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "beforeSchema": before.get("schemaVersion"),
            "afterSchema": after.get("schemaVersion"), "passed": bool(all_passed), "tables": tables,
            "scope": "All pre-existing immutable measurements/references, all original draft-sheet pinned facts, and every pre-existing completed signoff. New appends and legitimate draft completions are permitted and counted, never relabeled.",
            "limits": "Hash equality demonstrates selected fact preservation, not a backup or a substitute for isolated migration and adverse-write tests."}


def self_test():
    before = {"tables": {"measurements": {"m": {"facts": "a"}}, "inspectionRuns": {"d": {"core": "d", "status": "draft", "completed": None}, "c": {"core": "c", "status": "completed", "completed": "old"}}}}
    after = deepcopy(before)
    after["tables"]["measurements"]["new"] = {"facts": "new"}
    after["tables"]["inspectionRuns"]["d"].update(status="completed", completed="new-signoff")
    assert compare(before, after)["passed"]
    changed = deepcopy(after); changed["tables"]["measurements"]["m"]["facts"] = "tampered"
    assert not compare(before, changed)["passed"]
    changed = deepcopy(after); changed["tables"]["inspectionRuns"]["c"]["completed"] = "rewritten"
    assert not compare(before, changed)["passed"]
    changed = deepcopy(after); changed["tables"]["inspectionRuns"]["d"]["core"] = "different-revision"
    assert not compare(before, changed)["passed"]
    changed = deepcopy(after); del changed["tables"]["measurements"]["m"]
    assert not compare(before, changed)["passed"]
    return {"passed": True, "cases": 5}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        result = self_test()
    elif args.compare:
        before, after = [json.loads(path.read_text(encoding="utf-8-sig")) for path in args.compare]
        result = compare(before, after)
    else:
        result = capture()
    print(json.dumps(result, indent=2))
    return 0 if result.get("passed", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
