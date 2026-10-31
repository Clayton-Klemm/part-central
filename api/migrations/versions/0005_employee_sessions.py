"""Local employee sessions and server-stamped inspection identity.

Revision ID: 0005_employee_sessions
Revises: 0004_reference_versions
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_employee_sessions"
down_revision = "0004_reference_versions"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    sqlite = connection.dialect.name == "sqlite"
    triggers = []
    if sqlite:
        triggers = connection.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger'")).all()
        quote = connection.dialect.identifier_preparer.quote
        for name, _ in triggers:
            op.execute(f"DROP TRIGGER {quote(name)}")
    digits = "number"
    for digit in "0123456789":
        digits = f"replace({digits}, '{digit}', '')"
    op.create_table("employees",
        sa.Column("number", sa.String(4), primary_key=True),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(f"length(number) = 4 AND {digits} = ''", name="employee_number_format"),
        sa.CheckConstraint("(number = '0000' AND role = 'admin') OR (number <> '0000' AND role = 'operator')", name="reserved_administrator"),
    )
    op.create_table("employee_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("employee_number", sa.String(4), sa.ForeignKey("employees.number"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(token_hash) = 64", name="session_token_hash_length"),
        sa.CheckConstraint("expires_at > created_at", name="session_expiry_after_creation"),
    )
    op.create_index("ix_employee_sessions_employee", "employee_sessions", ["employee_number"])
    op.create_index("ix_employee_sessions_expiry", "employee_sessions", ["expires_at"])
    for table in ("inspection_runs", "measurements"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("employee_number", sa.String(4), nullable=True))
            batch.create_foreign_key(f"fk_{table}_employee", "employees", ["employee_number"], ["number"])
    if sqlite:
        for _, statement in triggers:
            op.execute(statement)
        op.execute("""CREATE TRIGGER runs_employee_identity_guard BEFORE UPDATE ON inspection_runs
          WHEN NEW.employee_number IS NOT OLD.employee_number
          BEGIN SELECT RAISE(ABORT, 'Inspection employee identity is immutable'); END""")
        op.execute("""CREATE TRIGGER employee_identity_guard BEFORE UPDATE ON employees
          WHEN NEW.number IS NOT OLD.number OR NEW.role IS NOT OLD.role
          BEGIN SELECT RAISE(ABORT, 'Employee number and role are immutable'); END""")
    else:
        op.execute("""CREATE FUNCTION protect_run_employee_identity() RETURNS trigger AS $$
          BEGIN
            IF NEW.employee_number IS DISTINCT FROM OLD.employee_number THEN
              RAISE EXCEPTION 'Inspection employee identity is immutable';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER runs_employee_identity_guard BEFORE UPDATE ON inspection_runs FOR EACH ROW EXECUTE FUNCTION protect_run_employee_identity()")
        op.execute("""CREATE FUNCTION protect_employee_identity() RETURNS trigger AS $$
          BEGIN
            IF NEW.number IS DISTINCT FROM OLD.number OR NEW.role IS DISTINCT FROM OLD.role THEN
              RAISE EXCEPTION 'Employee number and role are immutable';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER employee_identity_guard BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION protect_employee_identity()")


def downgrade():
    raise RuntimeError("Downgrading would discard employee audit identity; restore a verified backup instead.")
