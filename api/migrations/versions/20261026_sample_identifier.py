"""Preserve sample labels, including leading zeros and alphanumeric IDs.

Revision ID: 20261026_sample_id
Revises: 20261026_integrity
"""
from alembic import op
import sqlalchemy as sa

revision = "20261026_sample_id"
down_revision = "20261026_integrity"
branch_labels = None
depends_on = None


def _sqlite_triggers():
    # SQLite rebuilds a table to change its column type. Preserve both its
    # guards and dependent triggers that reference it during that rebuild.
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND (tbl_name='inspection_runs' OR sql LIKE '%inspection_runs%')")).all()
    quote = connection.dialect.identifier_preparer.quote
    for name, _ in rows:
        op.execute(f"DROP TRIGGER {quote(name)}")
    return [sql for _, sql in rows]


def upgrade():
    dialect = op.get_bind().dialect.name
    triggers = _sqlite_triggers() if dialect == "sqlite" else []
    with op.batch_alter_table("inspection_runs") as batch:
        batch.drop_constraint("positive_sample", type_="check")
        batch.alter_column("sample_number", existing_type=sa.Integer(), type_=sa.String(40), existing_nullable=False, postgresql_using="sample_number::varchar(40)")
        batch.create_check_constraint("sample_identifier", "length(sample_number) BETWEEN 1 AND 40 AND length(trim(sample_number)) > 0")
    for sql in triggers:
        op.execute(sql)


def downgrade():
    # A reversal must never silently strip leading zeros or alphanumeric IDs.
    for sample in op.get_bind().execute(sa.text("SELECT sample_number FROM inspection_runs")).scalars():
        if not sample.isdecimal() or str(int(sample)) != sample or not (1 <= int(sample) <= 2_147_483_647):
            raise RuntimeError("Cannot downgrade: sample identifiers would lose information. Keep the string identifier migration.")
    dialect = op.get_bind().dialect.name
    triggers = _sqlite_triggers() if dialect == "sqlite" else []
    with op.batch_alter_table("inspection_runs") as batch:
        batch.drop_constraint("sample_identifier", type_="check")
        batch.alter_column("sample_number", existing_type=sa.String(40), type_=sa.Integer(), existing_nullable=False, postgresql_using="sample_number::integer")
        batch.create_check_constraint("positive_sample", "sample_number >= 1")
    for sql in triggers:
        op.execute(sql)
