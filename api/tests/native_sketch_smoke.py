"""PostgreSQL native-sketch ownership probes; all fixture SQL rolls back.

Run inside API container: python tests/native_sketch_smoke.py
No inspection, asset, definition or reference edition from these probes persists.
"""
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import engine


def rejects(connection, statement, parameters, expected):
    savepoint = connection.begin_nested()
    try:
        connection.execute(text(statement), parameters)
    except DBAPIError as error:
        assert expected.lower() in str(error.orig).lower(), "Unexpected native-sketch guard reason"
    else:
        raise AssertionError("Native sketch guard accepted an invalid reference")
    finally:
        savepoint.rollback()


def main():
    assert engine.dialect.name == "postgresql", "Run native guard probes against PostgreSQL"
    families = ["dog-clutch", "differential-case", "bearing-cap", "flange", "shaft", "threaded-block", "housing", "ring"]
    with engine.connect() as connection:
        baseline = {table: connection.scalar(text(f"SELECT count(*) FROM {table}")) for table in ["parts", "part_revisions", "operation_sketches", "operations", "reference_assets", "operation_reference_versions"]}
        connection.rollback()
        transaction = connection.begin()
        try:
            part = str(uuid4())
            connection.execute(text("INSERT INTO parts(id,number,name,description) VALUES(:id,:number,'Rollback-only native sketch test','Synthetic guard probes')"), {"id": part, "number": "VERIFY-NATIVE-" + uuid4().hex[:12]})
            for index, family in enumerate(families):
                revision, sketch, operation, edition, unselected = (str(uuid4()) for _ in range(5))
                connection.execute(text("""INSERT INTO part_revisions(id,part_id,code,status,released_at,material,finish,is_active,geometry_family,change_note)
                  VALUES(:id,:part,:code,'draft',NULL,'Synthetic','Machined',false,:family,'Rollback-only guard fixture')"""), {"id": revision, "part": part, "code": f"NATIVE-{index}", "family": family})
                for identifier in [sketch, unselected]:
                    connection.execute(text("INSERT INTO operation_sketches(id,revision_id,title,asset_path) VALUES(:id,:revision,'Native operation sketch','generated://operation-sketch')"), {"id": identifier, "revision": revision})
                connection.execute(text("INSERT INTO operations(id,revision_id,code,name,setup,sketch_id) VALUES(:id,:revision,'010','Synthetic operation','Use the selected drawing',:sketch)"), {"id": operation, "revision": revision, "sketch": sketch})
                insert = """INSERT INTO operation_reference_versions(id,operation_id,version,builtin_sketch_id,model_available,notes,created_at)
                  VALUES(:id,:operation,:version,:sketch,:model,'Native sketch scope verification',CURRENT_TIMESTAMP)"""
                params = {"id": edition, "operation": operation, "version": 1, "sketch": sketch, "model": False}
                connection.execute(text(insert), params)
                assert connection.scalar(text("SELECT builtin_sketch_id FROM operation_reference_versions WHERE id=:id"), {"id": edition}) == sketch
                rejects(connection, insert, {**params, "id": str(uuid4()), "version": 2, "sketch": unselected}, "Built-in sketch")
                cross = connection.scalar(text("SELECT id FROM operation_sketches WHERE revision_id<>:revision LIMIT 1"), {"revision": revision})
                assert cross is not None
                rejects(connection, insert, {**params, "id": str(uuid4()), "version": 2, "sketch": cross}, "Built-in sketch")
                rejects(connection, insert, {**params, "id": str(uuid4()), "version": 3}, "sequential")
                rejects(connection, insert, {**params, "id": str(uuid4()), "version": 2, "model": True}, "supported feature guide")
                rejects(connection, "UPDATE operation_reference_versions SET notes='Invalid rewrite' WHERE id=:id", {"id": edition}, "append-only")
                rejects(connection, "DELETE FROM operation_reference_versions WHERE id=:id", {"id": edition}, "append-only")
                rejects(connection, "UPDATE operations SET sketch_id=:sketch WHERE id=:operation", {"sketch": cross, "operation": operation}, "foreign key")
                connection.execute(text("UPDATE operation_sketches SET asset_path='unapproved://native' WHERE id=:id"), {"id": sketch})
                rejects(connection, insert, {**params, "id": str(uuid4()), "version": 2}, "Built-in sketch")
                print(f"PASS {family}: opaque IDs, exact sketch/revision ownership, generated path, sequential editions and immutability")
        finally:
            transaction.rollback()
        after = {table: connection.scalar(text(f"SELECT count(*) FROM {table}")) for table in baseline}
        assert after == baseline, "Rollback-only native probes changed persistent table counts"
        print("PASS all native-sketch fixture writes rolled back; persistent table counts unchanged")


if __name__ == "__main__":
    main()
