"""Attribute new inspection events and completion to employee and shift.

Revision ID: 0008_shift_attribution
Revises: 0007_geometric_magnitudes

Legacy provenance remains NULL: migration must not invent an employee or shift.
New rows and completion transitions require attribution at the database boundary.
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_shift_attribution"
down_revision = "0007_geometric_magnitudes"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    sqlite = connection.dialect.name == "sqlite"
    triggers = []
    if sqlite:
        # SQLite rebuilds tables when foreign keys/checks are added. Preserve
        # every existing guard, including guards referring to another table.
        triggers = connection.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger'")).all()
        quote = connection.dialect.identifier_preparer.quote
        for name, _ in triggers:
            op.execute(f"DROP TRIGGER {quote(name)}")
    with op.batch_alter_table("measurements") as batch:
        batch.add_column(sa.Column("shift", sa.String(1), nullable=True))
        batch.create_check_constraint("measurement_shift_domain", "shift IS NULL OR shift IN ('1', '2', '3')")
    with op.batch_alter_table("inspection_runs") as batch:
        batch.add_column(sa.Column("completed_by_employee_number", sa.String(4), nullable=True))
        batch.add_column(sa.Column("completed_shift", sa.String(1), nullable=True))
        batch.create_foreign_key("fk_runs_completed_employee", "employees", ["completed_by_employee_number"], ["number"])
        batch.create_check_constraint("completion_shift_domain", "completed_shift IS NULL OR completed_shift IN ('1', '2', '3')")
        batch.create_check_constraint("completion_attribution_pair", "(completed_shift IS NULL AND completed_by_employee_number IS NULL) OR (status = 'completed' AND completed_shift IS NOT NULL AND completed_by_employee_number IS NOT NULL)")
    if sqlite:
        for _, statement in triggers:
            op.execute(statement)
        op.execute("""CREATE TRIGGER measurement_attribution_guard BEFORE INSERT ON measurements
          WHEN NEW.shift IS NULL OR NEW.shift NOT IN ('1', '2', '3') OR NEW.employee_number IS NULL
          BEGIN SELECT RAISE(ABORT, 'New measurement events require employee and shift attribution'); END""")
        op.execute("""CREATE TRIGGER completion_attribution_guard BEFORE UPDATE ON inspection_runs
          WHEN OLD.status = 'draft' AND NEW.status = 'completed' AND
            (NEW.completed_by_employee_number IS NULL OR NEW.completed_shift IS NULL)
          BEGIN SELECT RAISE(ABORT, 'Inspection completion requires employee and shift attribution'); END""")
    else:
        op.execute("""CREATE FUNCTION protect_measurement_attribution() RETURNS trigger AS $$
          BEGIN
            IF NEW.shift IS NULL OR NEW.shift NOT IN ('1', '2', '3') OR NEW.employee_number IS NULL THEN
              RAISE EXCEPTION 'New measurement events require employee and shift attribution';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER measurement_attribution_guard BEFORE INSERT ON measurements FOR EACH ROW EXECUTE FUNCTION protect_measurement_attribution()")
        op.execute("""CREATE FUNCTION protect_completion_attribution() RETURNS trigger AS $$
          BEGIN
            IF OLD.status = 'draft' AND NEW.status = 'completed' AND
              (NEW.completed_by_employee_number IS NULL OR NEW.completed_shift IS NULL) THEN
              RAISE EXCEPTION 'Inspection completion requires employee and shift attribution';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER completion_attribution_guard BEFORE UPDATE ON inspection_runs FOR EACH ROW EXECUTE FUNCTION protect_completion_attribution()")


def downgrade():
    raise RuntimeError("Downgrading would discard shift audit identity; restore a verified backup instead.")
