"""Treat negative geometric magnitudes as failed readings, retaining signed coordinates.

Revision ID: 0007_geometric_magnitudes
Revises: 0006_catalog_lifecycle
"""
from alembic import op

revision = "0007_geometric_magnitudes"
down_revision = "0006_catalog_lifecycle"
branch_labels = None
depends_on = None


def upgrade():
    _replace_measurement_outcome(require_nonnegative=True)


def downgrade():
    # Revert the outcome rule only. Events stay append-only and no history is
    # rewritten; a downgrade cannot retroactively change stored results.
    _replace_measurement_outcome(require_nonnegative=False)


def _replace_measurement_outcome(require_nonnegative):
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        domain = "(target_feature.type <> 'geometric' OR NEW.value >= 0) AND" if require_nonnegative else ""
        op.execute(f"""CREATE OR REPLACE FUNCTION protect_measurement_event() RETURNS trigger AS $$
          DECLARE target_run inspection_runs%ROWTYPE; target_feature characteristics%ROWTYPE; expected_status text;
          BEGIN
            IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Measurement events are append-only'; END IF;
            SELECT * INTO target_run FROM inspection_runs WHERE id=NEW.run_id FOR UPDATE;
            SELECT * INTO target_feature FROM characteristics WHERE id=NEW.feature_id;
            IF target_run.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Inspection must be a draft'; END IF;
            IF target_feature.operation_id IS DISTINCT FROM target_run.operation_id THEN RAISE EXCEPTION 'Characteristic belongs to another operation'; END IF;
            IF {domain} ((target_feature.limit_type='minimum' AND NEW.value>=target_feature.nominal) OR
               (target_feature.limit_type='maximum' AND NEW.value<=target_feature.nominal) OR
               (target_feature.limit_type='bilateral' AND NEW.value BETWEEN target_feature.nominal-target_feature.tolerance_minus AND target_feature.nominal+target_feature.tolerance_plus))
              THEN expected_status:='pass'; ELSE expected_status:='fail'; END IF;
            IF NEW.status IS DISTINCT FROM expected_status THEN RAISE EXCEPTION 'Measurement status disagrees with the released tolerance'; END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
    elif dialect == "sqlite":
        domain = "(c.type <> 'geometric' OR NEW.value >= 0) AND" if require_nonnegative else ""
        op.execute("DROP TRIGGER measurement_limit_outcome")
        op.execute(f"""CREATE TRIGGER measurement_limit_outcome BEFORE INSERT ON measurements
          WHEN NEW.status IS NOT (SELECT CASE WHEN {domain} (
            (c.limit_type='minimum' AND NEW.value >= c.nominal) OR
            (c.limit_type='maximum' AND NEW.value <= c.nominal) OR
            (c.limit_type='bilateral' AND NEW.value BETWEEN c.nominal-c.tolerance_minus AND c.nominal+c.tolerance_plus))
            THEN 'pass' ELSE 'fail' END FROM characteristics c WHERE c.id=NEW.feature_id)
          BEGIN SELECT RAISE(ABORT, 'Measurement status disagrees with the released tolerance'); END""")
