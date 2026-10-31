"""Immutable visual reference editions, separate from released tolerances."""
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import utcnow


class ReferenceAsset(Base):
    __tablename__ = "reference_assets"
    __table_args__ = (
        CheckConstraint("kind IN ('sketch', 'diagram')", name="reference_asset_kind"),
        CheckConstraint("media_type IN ('image/png', 'image/jpeg', 'application/pdf')", name="reference_asset_media"),
        CheckConstraint("size_bytes > 0 AND size_bytes <= 10485760", name="reference_asset_size"),
        Index("ix_reference_assets_operation_created", "operation_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation_id: Mapped[str] = mapped_column(ForeignKey("operations.id"))
    kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    media_type: Mapped[str] = mapped_column(String(80))
    storage_key: Mapped[str] = mapped_column(String(100), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OperationReferenceVersion(Base):
    __tablename__ = "operation_reference_versions"
    __table_args__ = (
        UniqueConstraint("operation_id", "version"),
        CheckConstraint("version >= 1", name="positive_reference_version"),
        Index("ix_reference_versions_operation_version", "operation_id", "version"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation_id: Mapped[str] = mapped_column(ForeignKey("operations.id"))
    version: Mapped[int] = mapped_column(Integer)
    sketch_asset_id: Mapped[str | None] = mapped_column(ForeignKey("reference_assets.id"))
    diagram_asset_id: Mapped[str | None] = mapped_column(ForeignKey("reference_assets.id"))
    # A retained built-in sketch is a controlled baseline reference, not an upload.
    builtin_sketch_id: Mapped[str | None] = mapped_column(ForeignKey("operation_sketches.id"))
    model_available: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
