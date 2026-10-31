"""Add immutable, independently versioned operation visual references.

Revision ID: 0004_reference_versions
Revises: 0003_jobs_optional
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_reference_versions"
down_revision = "0003_jobs_optional"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("reference_assets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("operation_id", sa.String(64), sa.ForeignKey("operations.id"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("media_type", sa.String(80), nullable=False),
        sa.Column("storage_key", sa.String(100), nullable=False, unique=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('sketch', 'diagram')", name="reference_asset_kind"),
        sa.CheckConstraint("media_type IN ('image/png', 'image/jpeg', 'application/pdf')", name="reference_asset_media"),
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 10485760", name="reference_asset_size"),
    )
    op.create_index("ix_reference_assets_operation_created", "reference_assets", ["operation_id", "created_at"])
    op.create_table("operation_reference_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("operation_id", sa.String(64), sa.ForeignKey("operations.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("sketch_asset_id", sa.String(64), sa.ForeignKey("reference_assets.id")),
        sa.Column("diagram_asset_id", sa.String(64), sa.ForeignKey("reference_assets.id")),
        sa.Column("builtin_sketch_id", sa.String(64), sa.ForeignKey("operation_sketches.id")),
        sa.Column("model_available", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("operation_id", "version"),
        sa.CheckConstraint("version >= 1", name="positive_reference_version"),
    )
    op.create_index("ix_reference_versions_operation_version", "operation_reference_versions", ["operation_id", "version"])
    if op.get_bind().dialect.name == "postgresql":
        _postgres()
    elif op.get_bind().dialect.name == "sqlite":
        _sqlite()


def _postgres():
    op.execute("""
      CREATE FUNCTION protect_visual_reference() RETURNS trigger AS $$
      DECLARE target_operation operations%ROWTYPE;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          RAISE EXCEPTION 'Visual reference records are append-only';
        END IF;
        IF TG_TABLE_NAME = 'reference_assets' THEN
          RETURN NEW;
        END IF;
        SELECT * INTO target_operation FROM operations WHERE id=NEW.operation_id FOR UPDATE;
        IF NEW.version <> COALESCE((SELECT max(version) FROM operation_reference_versions WHERE operation_id=NEW.operation_id),0)+1 THEN
          RAISE EXCEPTION 'Visual reference versions must be sequential';
        END IF;
        IF NEW.sketch_asset_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM reference_assets WHERE id=NEW.sketch_asset_id AND operation_id=NEW.operation_id AND kind='sketch') THEN
          RAISE EXCEPTION 'Sketch asset belongs to another operation or kind';
        END IF;
        IF NEW.diagram_asset_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM reference_assets WHERE id=NEW.diagram_asset_id AND operation_id=NEW.operation_id AND kind='diagram') THEN
          RAISE EXCEPTION 'Diagram asset belongs to another operation or kind';
        END IF;
        IF NEW.builtin_sketch_id IS NOT NULL AND
          (NEW.sketch_asset_id IS NOT NULL OR NEW.builtin_sketch_id IS DISTINCT FROM target_operation.sketch_id OR NEW.operation_id NOT LIKE 'op-dg%' OR NOT EXISTS
            (SELECT 1 FROM operation_sketches WHERE id=NEW.builtin_sketch_id AND asset_path='generated://operation-sketch')) THEN
          RAISE EXCEPTION 'Built-in sketch does not belong to this operation';
        END IF;
        IF NEW.model_available AND (NEW.operation_id NOT LIKE 'op-dg%' OR NOT EXISTS
          (SELECT 1 FROM characteristics c JOIN feature_guides g ON g.id=c.guide_id WHERE c.operation_id=NEW.operation_id AND g.animation_key IN
          ('dog-height','ramp-height','ramp-angle','dog-width','pitch-diameter','bore-diameter','face-runout','overall-thickness'))) THEN
          RAISE EXCEPTION 'Operation has no supported 3D guide';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    """)
    for table in ["reference_assets", "operation_reference_versions"]:
        op.execute(f"CREATE TRIGGER {table}_immutable BEFORE INSERT OR UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION protect_visual_reference()")


def _sqlite():
    for table in ["reference_assets", "operation_reference_versions"]:
        for action in ["UPDATE", "DELETE"]:
            op.execute(f"CREATE TRIGGER {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT, 'Visual reference records are append-only'); END")
    op.execute("""
      CREATE TRIGGER visual_reference_insert_guard BEFORE INSERT ON operation_reference_versions
      BEGIN
        SELECT RAISE(ABORT,'Visual reference versions must be sequential')
          WHERE NEW.version <> COALESCE((SELECT max(version) FROM operation_reference_versions WHERE operation_id=NEW.operation_id),0)+1;
        SELECT RAISE(ABORT,'Sketch asset belongs to another operation or kind') WHERE NEW.sketch_asset_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM reference_assets WHERE id=NEW.sketch_asset_id AND operation_id=NEW.operation_id AND kind='sketch');
        SELECT RAISE(ABORT,'Diagram asset belongs to another operation or kind') WHERE NEW.diagram_asset_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM reference_assets WHERE id=NEW.diagram_asset_id AND operation_id=NEW.operation_id AND kind='diagram');
        SELECT RAISE(ABORT,'Built-in sketch does not belong to this operation') WHERE NEW.builtin_sketch_id IS NOT NULL AND
          (NEW.sketch_asset_id IS NOT NULL OR NEW.builtin_sketch_id IS NOT (SELECT sketch_id FROM operations WHERE id=NEW.operation_id)
            OR NEW.operation_id NOT LIKE 'op-dg%' OR NOT EXISTS
              (SELECT 1 FROM operation_sketches WHERE id=NEW.builtin_sketch_id AND asset_path='generated://operation-sketch'));
        SELECT RAISE(ABORT,'Operation has no supported 3D guide') WHERE NEW.model_available AND
          (NEW.operation_id NOT LIKE 'op-dg%' OR NOT EXISTS
            (SELECT 1 FROM characteristics c JOIN feature_guides g ON g.id=c.guide_id WHERE c.operation_id=NEW.operation_id AND g.animation_key IN
            ('dog-height','ramp-height','ramp-angle','dog-width','pitch-diameter','bore-diameter','face-runout','overall-thickness')));
      END
    """)


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        for table in ["reference_assets", "operation_reference_versions"]:
            op.execute(f"DROP TRIGGER {table}_immutable ON {table}")
        op.execute("DROP FUNCTION protect_visual_reference()")
    op.drop_table("operation_reference_versions")
    op.drop_table("reference_assets")
