"""Controlled draft revisions, one active engineering definition, and one-sided limits.

Revision ID: 0006_catalog_lifecycle
Revises: 0005_employee_sessions
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_catalog_lifecycle"
down_revision = "0005_employee_sessions"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    sqlite = connection.dialect.name == "sqlite"
    triggers = []
    if sqlite:
        triggers = connection.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger'")).all()
        for name, _ in triggers:
            op.execute(f'DROP TRIGGER "{name}"')
    else:
        op.execute("ALTER TABLE part_revisions DISABLE TRIGGER released_definition_guard")
    op.add_column("part_revisions", sa.Column("is_active", sa.Boolean(), sa.CheckConstraint("NOT is_active OR status = 'released'", name="active_revision_released"), nullable=False, server_default=sa.false()))
    op.add_column("part_revisions", sa.Column("geometry_family", sa.String(80), nullable=True))
    op.add_column("part_revisions", sa.Column("change_note", sa.Text(), nullable=False, server_default=""))
    op.add_column("part_revisions", sa.Column("created_by", sa.String(4), nullable=True))
    op.add_column("part_revisions", sa.Column("released_by", sa.String(4), nullable=True))
    op.add_column("characteristics", sa.Column("limit_type", sa.String(20), sa.CheckConstraint("limit_type IN ('bilateral', 'minimum', 'maximum')", name="characteristic_limit_type"), nullable=False, server_default="bilateral"))
    connection.execute(sa.text("""UPDATE part_revisions SET is_active=true WHERE id IN (
      SELECT id FROM (SELECT id, row_number() OVER(PARTITION BY part_id ORDER BY released_at DESC, id DESC) AS rank
      FROM part_revisions WHERE status='released') ranked WHERE rank=1)"""))
    connection.execute(sa.text("UPDATE part_revisions SET geometry_family='dog-clutch' WHERE part_id IN (SELECT id FROM parts WHERE number LIKE 'DG-%')"))
    connection.execute(sa.text("UPDATE part_revisions SET geometry_family='ring' WHERE part_id IN (SELECT id FROM parts WHERE number='RD-4200')"))
    op.create_index("uq_part_revision_active", "part_revisions", ["part_id"], unique=True, postgresql_where=sa.text("is_active"), sqlite_where=sa.text("is_active = 1"))
    if sqlite:
        for name, sql in triggers:
            if name != "part_revisions_guard_update":
                op.execute(sql)
        op.execute("""CREATE TRIGGER part_revisions_guard_update BEFORE UPDATE ON part_revisions
          WHEN OLD.status <> 'draft' AND (
            NEW.id IS NOT OLD.id OR NEW.part_id IS NOT OLD.part_id OR NEW.code IS NOT OLD.code OR
            NEW.status IS NOT OLD.status OR NEW.released_at IS NOT OLD.released_at OR
            NEW.material IS NOT OLD.material OR NEW.finish IS NOT OLD.finish OR
            NEW.geometry_family IS NOT OLD.geometry_family OR NEW.change_note IS NOT OLD.change_note OR
            NEW.created_by IS NOT OLD.created_by OR NEW.released_by IS NOT OLD.released_by)
          BEGIN SELECT RAISE(ABORT, 'Released definitions are immutable; create a new revision'); END""")
        # SQLite's original insert validation had no outcome check; enforce it now.
        op.execute("""CREATE TRIGGER measurement_limit_outcome BEFORE INSERT ON measurements
          WHEN NEW.status IS NOT (SELECT CASE WHEN
            (c.limit_type='minimum' AND NEW.value >= c.nominal) OR
            (c.limit_type='maximum' AND NEW.value <= c.nominal) OR
            (c.limit_type='bilateral' AND NEW.value BETWEEN c.nominal-c.tolerance_minus AND c.nominal+c.tolerance_plus)
            THEN 'pass' ELSE 'fail' END FROM characteristics c WHERE c.id=NEW.feature_id)
          BEGIN SELECT RAISE(ABORT, 'Measurement status disagrees with the released tolerance'); END""")
    else:
        _postgres()
        op.execute("ALTER TABLE part_revisions ENABLE TRIGGER released_definition_guard")
    _visual_and_start_guards(sqlite)


def _postgres():
    op.execute("""CREATE OR REPLACE FUNCTION protect_released_definition() RETURNS trigger AS $$
      DECLARE revision_status text; old_revision_status text;
      BEGIN
        IF TG_TABLE_NAME='part_revisions' THEN
          IF OLD.status <> 'draft' THEN
            IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'is_active')=(to_jsonb(OLD)-'is_active') THEN
              RETURN NEW;
            END IF;
            RAISE EXCEPTION 'Released revisions are immutable; create a new revision';
          END IF;
        ELSIF TG_TABLE_NAME IN ('operations','operation_sketches') THEN
          IF TG_OP <> 'INSERT' THEN SELECT status INTO old_revision_status FROM part_revisions WHERE id=OLD.revision_id; END IF;
          IF TG_OP <> 'DELETE' THEN SELECT status INTO revision_status FROM part_revisions WHERE id=NEW.revision_id; END IF;
        ELSIF TG_TABLE_NAME='characteristics' THEN
          IF TG_OP <> 'INSERT' THEN SELECT r.status INTO old_revision_status FROM part_revisions r JOIN operations o ON o.revision_id=r.id WHERE o.id=OLD.operation_id; END IF;
          IF TG_OP <> 'DELETE' THEN SELECT r.status INTO revision_status FROM part_revisions r JOIN operations o ON o.revision_id=r.id WHERE o.id=NEW.operation_id; END IF;
        ELSIF TG_TABLE_NAME='feature_guides' THEN
          SELECT r.status INTO old_revision_status FROM part_revisions r JOIN operations o ON o.revision_id=r.id JOIN characteristics c ON c.operation_id=o.id WHERE c.guide_id=OLD.id;
        END IF;
        IF coalesce(old_revision_status,'draft') <> 'draft' OR coalesce(revision_status,'draft') <> 'draft' THEN
          RAISE EXCEPTION 'Released definitions are immutable; create a new revision';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql""")
    op.execute("""CREATE OR REPLACE FUNCTION protect_measurement_event() RETURNS trigger AS $$
      DECLARE target_run inspection_runs%ROWTYPE; target_feature characteristics%ROWTYPE; expected_status text;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Measurement events are append-only'; END IF;
        SELECT * INTO target_run FROM inspection_runs WHERE id=NEW.run_id FOR UPDATE;
        SELECT * INTO target_feature FROM characteristics WHERE id=NEW.feature_id;
        IF target_run.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Inspection must be a draft'; END IF;
        IF target_feature.operation_id IS DISTINCT FROM target_run.operation_id THEN RAISE EXCEPTION 'Characteristic belongs to another operation'; END IF;
        IF (target_feature.limit_type='minimum' AND NEW.value>=target_feature.nominal) OR
           (target_feature.limit_type='maximum' AND NEW.value<=target_feature.nominal) OR
           (target_feature.limit_type='bilateral' AND NEW.value BETWEEN target_feature.nominal-target_feature.tolerance_minus AND target_feature.nominal+target_feature.tolerance_plus)
          THEN expected_status:='pass'; ELSE expected_status:='fail'; END IF;
        IF NEW.status IS DISTINCT FROM expected_status THEN RAISE EXCEPTION 'Measurement status disagrees with the released tolerance'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql""")


def downgrade():
    raise RuntimeError("Downgrading would discard controlled revision activation and limit semantics; restore a verified backup instead.")


def _visual_and_start_guards(sqlite):
    family_check = "(SELECT r.geometry_family FROM part_revisions r JOIN operations o ON o.revision_id=r.id WHERE o.id=NEW.operation_id) IN ('dog-clutch','differential-case','bearing-cap','flange','shaft','threaded-block','housing','ring')"
    animations = "'dog-height','ramp-height','ramp-angle','dog-width','pitch-diameter','bore-diameter','face-runout','overall-thickness','outside-diameter','bearing-bore','thread-depth','drill-depth','counterbore-depth','hole-spacing','bolt-circle','wall-thickness','overall-length','shoulder-height','flatness','slot-width','flange-thickness'"
    model_check = f"coalesce(({family_check}),false) AND EXISTS (SELECT 1 FROM characteristics c JOIN feature_guides g ON g.id=c.guide_id WHERE c.operation_id=NEW.operation_id AND g.animation_key IN ({animations}))"
    if sqlite:
        op.execute("DROP TRIGGER visual_reference_insert_guard")
        op.execute(f"""CREATE TRIGGER visual_reference_insert_guard BEFORE INSERT ON operation_reference_versions BEGIN
          SELECT RAISE(ABORT,'Visual reference versions must be sequential') WHERE NEW.version <> coalesce((SELECT max(version) FROM operation_reference_versions WHERE operation_id=NEW.operation_id),0)+1;
          SELECT RAISE(ABORT,'Sketch asset belongs to another operation or kind') WHERE NEW.sketch_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reference_assets WHERE id=NEW.sketch_asset_id AND operation_id=NEW.operation_id AND kind='sketch');
          SELECT RAISE(ABORT,'Diagram asset belongs to another operation or kind') WHERE NEW.diagram_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reference_assets WHERE id=NEW.diagram_asset_id AND operation_id=NEW.operation_id AND kind='diagram');
          SELECT RAISE(ABORT,'Built-in sketch does not belong to this operation') WHERE NEW.builtin_sketch_id IS NOT NULL AND (NEW.sketch_asset_id IS NOT NULL OR NEW.builtin_sketch_id IS NOT (SELECT sketch_id FROM operations WHERE id=NEW.operation_id) OR NEW.operation_id NOT LIKE 'op-dg%' OR NOT EXISTS (SELECT 1 FROM operation_sketches WHERE id=NEW.builtin_sketch_id AND asset_path='generated://operation-sketch'));
          SELECT RAISE(ABORT,'Operation has no supported feature guide') WHERE NEW.model_available AND NOT ({model_check});
          END""")
        op.execute("""CREATE TRIGGER runs_active_revision_insert BEFORE INSERT ON inspection_runs
          WHEN NOT coalesce((SELECT is_active FROM part_revisions WHERE id=NEW.revision_id),false)
          BEGIN SELECT RAISE(ABORT,'New inspections require an active revision'); END""")
    else:
        op.execute(f"""CREATE OR REPLACE FUNCTION protect_visual_reference() RETURNS trigger AS $$
          DECLARE target_operation operations%ROWTYPE;
          BEGIN
            IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Visual reference records are append-only'; END IF;
            IF TG_TABLE_NAME='reference_assets' THEN RETURN NEW; END IF;
            SELECT * INTO target_operation FROM operations WHERE id=NEW.operation_id FOR UPDATE;
            IF NEW.version <> coalesce((SELECT max(version) FROM operation_reference_versions WHERE operation_id=NEW.operation_id),0)+1 THEN RAISE EXCEPTION 'Visual reference versions must be sequential'; END IF;
            IF NEW.sketch_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reference_assets WHERE id=NEW.sketch_asset_id AND operation_id=NEW.operation_id AND kind='sketch') THEN RAISE EXCEPTION 'Sketch asset belongs to another operation or kind'; END IF;
            IF NEW.diagram_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reference_assets WHERE id=NEW.diagram_asset_id AND operation_id=NEW.operation_id AND kind='diagram') THEN RAISE EXCEPTION 'Diagram asset belongs to another operation or kind'; END IF;
            IF NEW.builtin_sketch_id IS NOT NULL AND (NEW.sketch_asset_id IS NOT NULL OR NEW.builtin_sketch_id IS DISTINCT FROM target_operation.sketch_id OR NEW.operation_id NOT LIKE 'op-dg%' OR NOT EXISTS (SELECT 1 FROM operation_sketches WHERE id=NEW.builtin_sketch_id AND asset_path='generated://operation-sketch')) THEN RAISE EXCEPTION 'Built-in sketch does not belong to this operation'; END IF;
            IF NEW.model_available AND NOT ({model_check}) THEN RAISE EXCEPTION 'Operation has no supported feature guide'; END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("""CREATE FUNCTION enforce_active_inspection_revision() RETURNS trigger AS $$
          BEGIN
            IF NOT coalesce((SELECT is_active FROM part_revisions WHERE id=NEW.revision_id),false) THEN RAISE EXCEPTION 'New inspections require an active revision'; END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER runs_active_revision_insert BEFORE INSERT ON inspection_runs FOR EACH ROW EXECUTE FUNCTION enforce_active_inspection_revision()")
