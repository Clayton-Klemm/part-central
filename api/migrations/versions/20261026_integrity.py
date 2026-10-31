"""Freeze released definitions and enforce append-only measurements.

Revision ID: 20261026_integrity
Revises: e99369553572
"""
from alembic import op

revision = "20261026_integrity"
down_revision = "e99369553572"
branch_labels = None
depends_on = None


def upgrade():
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        _postgres()
    elif dialect == "sqlite":
        _sqlite()


def _postgres():
    op.execute("""
        CREATE FUNCTION protect_measurement_event() RETURNS trigger AS $$
        DECLARE target_run inspection_runs%ROWTYPE;
                target_feature characteristics%ROWTYPE;
                expected_status text;
        BEGIN
          IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION 'Measurement events are append-only';
          END IF;
          SELECT * INTO target_run FROM inspection_runs WHERE id = NEW.run_id FOR UPDATE;
          SELECT * INTO target_feature FROM characteristics WHERE id = NEW.feature_id;
          IF target_run.status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'Inspection must be a draft';
          END IF;
          IF target_feature.operation_id IS DISTINCT FROM target_run.operation_id THEN
            RAISE EXCEPTION 'Characteristic belongs to another operation';
          END IF;
          IF NEW.value BETWEEN
            target_feature.nominal - target_feature.tolerance_minus AND
            target_feature.nominal + target_feature.tolerance_plus THEN
            expected_status := 'pass';
          ELSE
            expected_status := 'fail';
          END IF;
          IF NEW.status IS DISTINCT FROM expected_status THEN
            RAISE EXCEPTION 'Measurement status disagrees with the released tolerance';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("CREATE TRIGGER measurement_event_guard BEFORE INSERT OR UPDATE OR DELETE ON measurements FOR EACH ROW EXECUTE FUNCTION protect_measurement_event()")
    op.execute("""
        CREATE FUNCTION protect_released_definition() RETURNS trigger AS $$
        DECLARE revision_status text;
                old_revision_status text;
        BEGIN
          IF TG_TABLE_NAME = 'part_revisions' THEN
            IF OLD.status <> 'draft' THEN
              RAISE EXCEPTION 'Released revisions are immutable; create a new revision';
            END IF;
          ELSIF TG_TABLE_NAME IN ('operations', 'operation_sketches') THEN
            IF TG_OP <> 'INSERT' THEN
              SELECT status INTO old_revision_status FROM part_revisions WHERE id = OLD.revision_id;
            END IF;
            IF TG_OP <> 'DELETE' THEN
              SELECT status INTO revision_status FROM part_revisions WHERE id = NEW.revision_id;
            END IF;
          ELSIF TG_TABLE_NAME = 'characteristics' THEN
            IF TG_OP <> 'INSERT' THEN
              SELECT r.status INTO old_revision_status FROM part_revisions r JOIN operations o ON o.revision_id = r.id WHERE o.id = OLD.operation_id;
            END IF;
            IF TG_OP <> 'DELETE' THEN
              SELECT r.status INTO revision_status FROM part_revisions r JOIN operations o ON o.revision_id = r.id WHERE o.id = NEW.operation_id;
            END IF;
          ELSIF TG_TABLE_NAME = 'feature_guides' THEN
            SELECT r.status INTO old_revision_status FROM part_revisions r JOIN operations o ON o.revision_id = r.id JOIN characteristics c ON c.operation_id = o.id WHERE c.guide_id = OLD.id;
          END IF;
          IF coalesce(old_revision_status, 'draft') <> 'draft' OR coalesce(revision_status, 'draft') <> 'draft' THEN
            RAISE EXCEPTION 'Released definitions are immutable; create a new revision';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    for table in ("operations", "operation_sketches", "characteristics"):
        op.execute(f"CREATE TRIGGER released_definition_guard BEFORE INSERT OR UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION protect_released_definition()")
    for table in ("part_revisions", "feature_guides"):
        op.execute(f"CREATE TRIGGER released_definition_guard BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION protect_released_definition()")
    op.execute("""
        CREATE FUNCTION protect_inspection_run() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.status <> 'draft' OR NEW.completed_at IS NOT NULL OR
               (SELECT status FROM part_revisions WHERE id = NEW.revision_id) IS DISTINCT FROM 'released' THEN
              RAISE EXCEPTION 'Inspections must start as drafts against a released revision';
            END IF;
            RETURN NEW;
          END IF;
          IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Inspection runs cannot be deleted'; END IF;
          IF OLD.status = 'completed' OR NEW.id IS DISTINCT FROM OLD.id OR
             NEW.revision_id IS DISTINCT FROM OLD.revision_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
             NEW.inspector IS DISTINCT FROM OLD.inspector OR NEW.lot_number IS DISTINCT FROM OLD.lot_number OR
             NEW.sample_number IS DISTINCT FROM OLD.sample_number OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
             RAISE EXCEPTION 'Inspection identity and completed runs are immutable';
          END IF;
          IF NEW.status = 'completed' AND (NEW.completed_at IS NULL OR NOT EXISTS (SELECT 1 FROM characteristics WHERE operation_id = NEW.operation_id) OR EXISTS (
            SELECT 1 FROM characteristics c WHERE c.operation_id = NEW.operation_id AND NOT EXISTS
              (SELECT 1 FROM measurements m WHERE m.run_id = NEW.id AND m.feature_id = c.id)
          )) THEN RAISE EXCEPTION 'Every characteristic must be measured before completion'; END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("CREATE TRIGGER inspection_run_guard BEFORE INSERT OR UPDATE OR DELETE ON inspection_runs FOR EACH ROW EXECUTE FUNCTION protect_inspection_run()")


def _sqlite():
    for event in ("UPDATE", "DELETE"):
        op.execute(f"CREATE TRIGGER measurements_no_{event.lower()} BEFORE {event} ON measurements BEGIN SELECT RAISE(ABORT, 'Measurement events are append-only'); END")
    op.execute("""
        CREATE TRIGGER measurements_validate BEFORE INSERT ON measurements BEGIN
          SELECT RAISE(ABORT, 'Inspection must be a draft') WHERE
            coalesce((SELECT status FROM inspection_runs WHERE id = NEW.run_id), '') <> 'draft';
          SELECT RAISE(ABORT, 'Characteristic belongs to another operation') WHERE
            (SELECT operation_id FROM characteristics WHERE id = NEW.feature_id) IS NOT
            (SELECT operation_id FROM inspection_runs WHERE id = NEW.run_id);
        END
    """)
    for table in ("operations", "operation_sketches", "characteristics", "part_revisions", "feature_guides"):
        for event in ("INSERT", "UPDATE", "DELETE"):
            if table in ("part_revisions", "feature_guides") and event == "INSERT":
                continue
            conditions = []
            for ref in (["NEW"] if event == "INSERT" else ["OLD"] if event == "DELETE" else ["OLD", "NEW"]):
                if table == "part_revisions":
                    if ref == "OLD":
                        conditions.append("OLD.status <> 'draft'")
                elif table in ("operations", "operation_sketches"):
                    conditions.append(f"(SELECT status FROM part_revisions WHERE id = {ref}.revision_id) <> 'draft'")
                elif table == "characteristics":
                    conditions.append(f"(SELECT r.status FROM part_revisions r JOIN operations o ON o.revision_id = r.id WHERE o.id = {ref}.operation_id) <> 'draft'")
                else:
                    conditions.append(f"EXISTS (SELECT 1 FROM characteristics c JOIN operations o ON o.id = c.operation_id JOIN part_revisions r ON r.id = o.revision_id WHERE c.guide_id = {ref}.id AND r.status <> 'draft')")
            op.execute(f"CREATE TRIGGER {table}_guard_{event.lower()} BEFORE {event} ON {table} WHEN {' OR '.join(conditions)} BEGIN SELECT RAISE(ABORT, 'Released definitions are immutable'); END")
    op.execute("CREATE TRIGGER runs_no_delete BEFORE DELETE ON inspection_runs BEGIN SELECT RAISE(ABORT, 'Inspection runs cannot be deleted'); END")
    op.execute("""
        CREATE TRIGGER runs_guard_insert BEFORE INSERT ON inspection_runs WHEN
          NEW.status <> 'draft' OR NEW.completed_at IS NOT NULL OR
          coalesce((SELECT status FROM part_revisions WHERE id = NEW.revision_id), '') <> 'released'
        BEGIN SELECT RAISE(ABORT, 'Inspections must start as drafts against a released revision'); END
    """)
    op.execute("""
        CREATE TRIGGER runs_guard_update BEFORE UPDATE ON inspection_runs BEGIN
          SELECT RAISE(ABORT, 'Inspection identity and completed runs are immutable') WHERE
            OLD.status = 'completed' OR NEW.id IS NOT OLD.id OR NEW.revision_id IS NOT OLD.revision_id OR
            NEW.operation_id IS NOT OLD.operation_id OR NEW.inspector IS NOT OLD.inspector OR
            NEW.lot_number IS NOT OLD.lot_number OR NEW.sample_number IS NOT OLD.sample_number OR NEW.created_at IS NOT OLD.created_at;
          SELECT RAISE(ABORT, 'Every characteristic must be measured before completion') WHERE
            NEW.status = 'completed' AND (NEW.completed_at IS NULL OR NOT EXISTS (SELECT 1 FROM characteristics WHERE operation_id = NEW.operation_id) OR EXISTS (
              SELECT 1 FROM characteristics c WHERE c.operation_id = NEW.operation_id AND NOT EXISTS
                (SELECT 1 FROM measurements m WHERE m.run_id = NEW.id AND m.feature_id = c.id)
            ));
        END
    """)


def downgrade():
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("DROP TRIGGER measurement_event_guard ON measurements")
        op.execute("DROP FUNCTION protect_measurement_event()")
        for table in ("operations", "operation_sketches", "characteristics", "part_revisions", "feature_guides"):
            op.execute(f"DROP TRIGGER released_definition_guard ON {table}")
        op.execute("DROP FUNCTION protect_released_definition()")
        op.execute("DROP TRIGGER inspection_run_guard ON inspection_runs")
        op.execute("DROP FUNCTION protect_inspection_run()")
    elif dialect == "sqlite":
        for name in ("measurements_no_update", "measurements_no_delete", "measurements_validate", "runs_no_delete", "runs_guard_insert", "runs_guard_update"):
            op.execute(f"DROP TRIGGER {name}")
        for table in ("operations", "operation_sketches", "characteristics", "part_revisions", "feature_guides"):
            for event in ("insert", "update", "delete"):
                if table in ("part_revisions", "feature_guides") and event == "insert":
                    continue
                op.execute(f"DROP TRIGGER {table}_guard_{event}")
