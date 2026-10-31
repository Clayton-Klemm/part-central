"""Allow weekend shift 71 without relabeling historical shift 3.

Revision ID: 0010_weekend_shift
Revises: 0009_native_sketch_scope

Stored history may retain 3. New measurement events and completion transitions
accept only 1, 2 and 71. Widening the columns does not transform any row values.
"""
from alembic import op
import sqlalchemy as sa


revision = "0010_weekend_shift"
down_revision = "0009_native_sketch_scope"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    sqlite = connection.dialect.name == "sqlite"
    preserved_triggers = []
    if sqlite:
        # Rebuilding either table invalidates guards that reference it. Keep
        # every unrelated guard verbatim and replace only attribution guards.
        triggers = connection.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger'")).all()
        quote = connection.dialect.identifier_preparer.quote
        for name, statement in triggers:
            op.execute(f"DROP TRIGGER {quote(name)}")
            if name not in {"measurement_attribution_guard", "completion_attribution_guard"}:
                preserved_triggers.append(statement)

    with op.batch_alter_table("measurements") as batch:
        batch.drop_constraint("measurement_shift_domain", type_="check")
        batch.alter_column("shift", existing_type=sa.String(1), type_=sa.String(2), existing_nullable=True)
        batch.create_check_constraint("measurement_shift_domain", "shift IS NULL OR shift IN ('1', '2', '3', '71')")
    with op.batch_alter_table("inspection_runs") as batch:
        batch.drop_constraint("completion_shift_domain", type_="check")
        batch.alter_column("completed_shift", existing_type=sa.String(1), type_=sa.String(2), existing_nullable=True)
        batch.create_check_constraint("completion_shift_domain", "completed_shift IS NULL OR completed_shift IN ('1', '2', '3', '71')")

    if sqlite:
        for statement in preserved_triggers:
            op.execute(statement)
        op.execute("""CREATE TRIGGER measurement_attribution_guard BEFORE INSERT ON measurements
          WHEN NEW.shift IS NULL OR NEW.shift NOT IN ('1', '2', '71') OR NEW.employee_number IS NULL
          BEGIN SELECT RAISE(ABORT, 'New measurement events require employee and shift attribution (1, 2 or 71)'); END""")
        op.execute("""CREATE TRIGGER completion_attribution_guard BEFORE UPDATE ON inspection_runs
          WHEN OLD.status = 'draft' AND NEW.status = 'completed' AND
            (NEW.completed_by_employee_number IS NULL OR NEW.completed_shift IS NULL OR NEW.completed_shift NOT IN ('1', '2', '71'))
          BEGIN SELECT RAISE(ABORT, 'Inspection completion requires employee and shift attribution (1, 2 or 71)'); END""")
    else:
        op.execute("""CREATE OR REPLACE FUNCTION protect_measurement_attribution() RETURNS trigger AS $$
          BEGIN
            IF NEW.shift IS NULL OR NEW.shift NOT IN ('1', '2', '71') OR NEW.employee_number IS NULL THEN
              RAISE EXCEPTION 'New measurement events require employee and shift attribution (1, 2 or 71)';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("""CREATE OR REPLACE FUNCTION protect_completion_attribution() RETURNS trigger AS $$
          BEGIN
            IF OLD.status = 'draft' AND NEW.status = 'completed' AND
              (NEW.completed_by_employee_number IS NULL OR NEW.completed_shift IS NULL OR NEW.completed_shift NOT IN ('1', '2', '71')) THEN
              RAISE EXCEPTION 'Inspection completion requires employee and shift attribution (1, 2 or 71)';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")


def downgrade():
    raise RuntimeError("Downgrading would truncate weekend shift audit identity; restore a verified backup instead.")
