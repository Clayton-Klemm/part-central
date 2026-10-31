"""Validate native operation sketches by ownership, never identifier prefixes.

Revision ID: 0009_native_sketch_scope
Revises: 0008_shift_attribution

Only guard definitions change. Published editions, assets, run snapshots and
measurements remain byte-for-byte unchanged.
"""
from alembic import op

revision = "0009_native_sketch_scope"
down_revision = "0008_shift_attribution"
branch_labels = None
depends_on = None


def upgrade():
    family_check = "(SELECT r.geometry_family FROM part_revisions r JOIN operations o ON o.revision_id=r.id WHERE o.id=NEW.operation_id) IN ('dog-clutch','differential-case','bearing-cap','flange','shaft','threaded-block','housing','ring')"
    animations = "'dog-height','ramp-height','ramp-angle','dog-width','pitch-diameter','bore-diameter','face-runout','overall-thickness','outside-diameter','bearing-bore','thread-depth','drill-depth','counterbore-depth','hole-spacing','bolt-circle','wall-thickness','overall-length','shoulder-height','flatness','slot-width','flange-thickness'"
    model_check = f"coalesce(({family_check}),false) AND EXISTS (SELECT 1 FROM characteristics c JOIN feature_guides g ON g.id=c.guide_id WHERE c.operation_id=NEW.operation_id AND g.animation_key IN ({animations}))"
    # The operation's composite FK already pins the sketch to its revision;
    # explicitly recheck all three identities at publication as well.
    builtin_check = """EXISTS (SELECT 1 FROM operations o JOIN operation_sketches s
      ON s.id=o.sketch_id AND s.revision_id=o.revision_id
      WHERE o.id=NEW.operation_id AND s.id=NEW.builtin_sketch_id
        AND s.asset_path='generated://operation-sketch')"""
    if op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER visual_reference_insert_guard")
        op.execute(f"""CREATE TRIGGER visual_reference_insert_guard BEFORE INSERT ON operation_reference_versions BEGIN
          SELECT RAISE(ABORT,'Visual reference versions must be sequential') WHERE NEW.version <> coalesce((SELECT max(version) FROM operation_reference_versions WHERE operation_id=NEW.operation_id),0)+1;
          SELECT RAISE(ABORT,'Sketch asset belongs to another operation or kind') WHERE NEW.sketch_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reference_assets WHERE id=NEW.sketch_asset_id AND operation_id=NEW.operation_id AND kind='sketch');
          SELECT RAISE(ABORT,'Diagram asset belongs to another operation or kind') WHERE NEW.diagram_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reference_assets WHERE id=NEW.diagram_asset_id AND operation_id=NEW.operation_id AND kind='diagram');
          SELECT RAISE(ABORT,'Built-in sketch does not belong to this operation') WHERE NEW.builtin_sketch_id IS NOT NULL AND (NEW.sketch_asset_id IS NOT NULL OR NOT ({builtin_check}));
          SELECT RAISE(ABORT,'Operation has no supported feature guide') WHERE NEW.model_available AND NOT ({model_check});
          END""")
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
            IF NEW.builtin_sketch_id IS NOT NULL AND (NEW.sketch_asset_id IS NOT NULL OR NOT ({builtin_check})) THEN RAISE EXCEPTION 'Built-in sketch does not belong to this operation'; END IF;
            IF NEW.model_available AND NOT ({model_check}) THEN RAISE EXCEPTION 'Operation has no supported feature guide'; END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql""")


def downgrade():
    raise RuntimeError("Downgrading would reject valid native sketch editions; restore a verified backup instead.")
