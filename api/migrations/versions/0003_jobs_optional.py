"""Jobs, optional visual references, and pinned documentation snapshots.

Revision ID: 0003_jobs_optional
Revises: 20261026_sample_id
"""
from datetime import datetime, timezone
from hashlib import sha256
from uuid import NAMESPACE_URL, uuid5

from alembic import op
import sqlalchemy as sa

revision = "0003_jobs_optional"
down_revision = "20261026_sample_id"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    dialect = connection.dialect.name
    triggers = []
    if dialect == "sqlite":
        triggers = connection.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger'")).all()
        quote = connection.dialect.identifier_preparer.quote
        for name, _ in triggers:
            op.execute(f"DROP TRIGGER {quote(name)}")
    else:
        op.execute("ALTER TABLE inspection_runs DISABLE TRIGGER inspection_run_guard")
    op.create_table("jobs", sa.Column("id", sa.String(64), primary_key=True), sa.Column("number", sa.String(80), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.CheckConstraint("length(number) BETWEEN 1 AND 80 AND number = trim(number)", name="job_number"))
    op.create_index("ix_jobs_number", "jobs", ["number"], unique=True)
    with op.batch_alter_table("operations") as batch:
        batch.alter_column("sketch_id", existing_type=sa.String(64), nullable=True)
    with op.batch_alter_table("characteristics") as batch:
        batch.alter_column("guide_id", existing_type=sa.String(64), nullable=True)
    with op.batch_alter_table("inspection_runs") as batch:
        batch.add_column(sa.Column("job_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("references_snapshot", sa.JSON(), nullable=False, server_default="{}"))
    # Old records never acquire guessed job numbers or today's reference version.
    jobs = {}
    legacy_rows = connection.execute(sa.text("""SELECT r.id, r.lot_number, o.id, o.sketch_id, s.title, s.asset_path,
      EXISTS (SELECT 1 FROM characteristics c JOIN feature_guides g ON g.id=c.guide_id WHERE c.operation_id=o.id)
      FROM inspection_runs r JOIN operations o ON o.id=r.operation_id
      LEFT JOIN operation_sketches s ON s.id=o.sketch_id""")).all()
    for run_id, lot, operation_id, sketch_id, sketch_title, asset_path, has_guide in legacy_rows:
        legacy = str(lot).strip().upper() or "UNASSIGNED"
        if legacy not in jobs:
            job_id = str(uuid5(NAMESPACE_URL, "part-central:legacy-job:" + legacy))
            number = "LEGACY-" + legacy
            if len(number) > 80:
                number = number[:69] + "-" + sha256(legacy.encode()).hexdigest()[:10].upper()
            connection.execute(sa.text("INSERT INTO jobs (id, number, created_at) VALUES (:id, :number, :created)"), {"id": job_id, "number": number, "created": datetime.now(timezone.utc)})
            jobs[legacy] = job_id
        baseline = {"id": None, "version": 0, "sketch": None, "diagram": None, "modelAvailable": bool(operation_id.startswith("op-dg") and has_guide), "notes": "Legacy inspection reference baseline"}
        if operation_id.startswith("op-dg") and sketch_id and asset_path == "generated://operation-sketch":
            baseline["sketch"] = {"id": sketch_id, "name": sketch_title, "mediaType": "application/x-partcentral-sketch", "url": None, "sha256": None}
        statement = sa.text("UPDATE inspection_runs SET job_id=:job, references_snapshot=:snapshot WHERE id=:id").bindparams(sa.bindparam("snapshot", type_=sa.JSON()))
        connection.execute(statement, {"job": jobs[legacy], "snapshot": baseline, "id": run_id})
    with op.batch_alter_table("inspection_runs") as batch:
        batch.alter_column("job_id", existing_type=sa.String(64), nullable=False)
        batch.create_foreign_key("fk_runs_job", "jobs", ["job_id"], ["id"])
        batch.create_index("ix_runs_job_created", ["job_id", "created_at"])
        batch.create_index("ix_runs_created_id", ["created_at", "id"])
        batch.alter_column("references_snapshot", existing_type=sa.JSON(), server_default=None)
    if dialect == "sqlite":
        for _, sql in triggers:
            op.execute(sql)
        op.execute("""CREATE TRIGGER runs_job_identity_guard BEFORE UPDATE ON inspection_runs
          WHEN NEW.job_id IS NOT OLD.job_id OR NEW.references_snapshot IS NOT OLD.references_snapshot
          BEGIN SELECT RAISE(ABORT, 'Inspection job and reference snapshot are immutable'); END""")
        for event in ("UPDATE", "DELETE"):
            op.execute(f"CREATE TRIGGER jobs_no_{event.lower()} BEFORE {event} ON jobs BEGIN SELECT RAISE(ABORT, 'Job identities are immutable'); END")
    else:
        op.execute("ALTER TABLE inspection_runs ENABLE TRIGGER inspection_run_guard")
        op.execute("""CREATE FUNCTION protect_run_job_snapshot() RETURNS trigger AS $$
          BEGIN
            IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.references_snapshot::text IS DISTINCT FROM OLD.references_snapshot::text THEN
              RAISE EXCEPTION 'Inspection job and reference snapshot are immutable';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER run_job_snapshot_guard BEFORE UPDATE ON inspection_runs FOR EACH ROW EXECUTE FUNCTION protect_run_job_snapshot()")
        op.execute("""CREATE FUNCTION protect_job_identity() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'Job identities are immutable'; END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER job_identity_guard BEFORE UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION protect_job_identity()")


def downgrade():
    raise RuntimeError("Downgrading would discard job identity and pinned references; restore from a verified backup instead.")
