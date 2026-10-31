"""Normalized master data and immutable measurement events.

Requirements belong to an operation of one released part revision. A run
references that same operation/revision pair, never a mutable part number.
"""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint, false, text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Part(Base):
    __tablename__ = "parts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)


class PartRevision(Base):
    __tablename__ = "part_revisions"
    __table_args__ = (
        UniqueConstraint("part_id", "code"),
        CheckConstraint("status IN ('draft', 'released', 'obsolete')", name="revision_status"),
        CheckConstraint("NOT is_active OR status = 'released'", name="active_revision_released"),
        Index("uq_part_revision_active", "part_id", unique=True, postgresql_where=text("is_active"), sqlite_where=text("is_active = 1")),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    material: Mapped[str] = mapped_column(String(200))
    finish: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    geometry_family: Mapped[str | None] = mapped_column(String(80), nullable=True)
    change_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str | None] = mapped_column(String(4), nullable=True)
    released_by: Mapped[str | None] = mapped_column(String(4), nullable=True)


class Sketch(Base):
    __tablename__ = "operation_sketches"
    __table_args__ = (UniqueConstraint("id", "revision_id"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("part_revisions.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    asset_path: Mapped[str] = mapped_column(String(500))


class Operation(Base):
    __tablename__ = "operations"
    __table_args__ = (
        UniqueConstraint("revision_id", "code"),
        UniqueConstraint("id", "revision_id"),
        ForeignKeyConstraint(["sketch_id", "revision_id"], ["operation_sketches.id", "operation_sketches.revision_id"]),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("part_revisions.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    setup: Mapped[str] = mapped_column(Text)
    sketch_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class FeatureGuide(Base):
    __tablename__ = "feature_guides"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    animation_key: Mapped[str] = mapped_column(String(80))
    zone: Mapped[str] = mapped_column(String(80))


class Feature(Base):
    __tablename__ = "characteristics"
    __table_args__ = (
        UniqueConstraint("operation_id", "number"),
        CheckConstraint("tolerance_minus >= 0 AND tolerance_plus >= 0", name="positive_tolerances"),
        CheckConstraint("unit IN ('mm', 'deg')", name="measurement_units"),
        CheckConstraint("type IN ('dimensional', 'angular', 'geometric')", name="characteristic_type"),
        CheckConstraint("limit_type IN ('bilateral', 'minimum', 'maximum')", name="characteristic_limit_type"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation_id: Mapped[str] = mapped_column(ForeignKey("operations.id"), index=True)
    guide_id: Mapped[str | None] = mapped_column(ForeignKey("feature_guides.id"), unique=True, nullable=True)
    number: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(30))
    limit_type: Mapped[str] = mapped_column(String(20), default="bilateral", server_default="bilateral")
    nominal: Mapped[Decimal] = mapped_column(Numeric(14, 6))
    tolerance_minus: Mapped[Decimal] = mapped_column(Numeric(14, 6))
    tolerance_plus: Mapped[Decimal] = mapped_column(Numeric(14, 6))
    unit: Mapped[str] = mapped_column(String(10))
    method: Mapped[str] = mapped_column(String(200))
    datum: Mapped[str] = mapped_column(String(100))
    instruction: Mapped[str] = mapped_column(Text)
    sketch_ref: Mapped[str] = mapped_column(String(80))
    critical: Mapped[bool] = mapped_column(Boolean, default=False)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (CheckConstraint("length(number) BETWEEN 1 AND 80 AND number = trim(number)", name="job_number"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InspectionRun(Base):
    __tablename__ = "inspection_runs"
    __table_args__ = (
        ForeignKeyConstraint(["operation_id", "revision_id"], ["operations.id", "operations.revision_id"]),
        CheckConstraint("status IN ('draft', 'completed')", name="run_status"),
        CheckConstraint("length(sample_number) BETWEEN 1 AND 40 AND length(trim(sample_number)) > 0", name="sample_identifier"),
        CheckConstraint("completed_shift IS NULL OR completed_shift IN ('1', '2', '3', '71')", name="completion_shift_domain"),
        CheckConstraint("(completed_shift IS NULL AND completed_by_employee_number IS NULL) OR (status = 'completed' AND completed_shift IS NOT NULL AND completed_by_employee_number IS NOT NULL)", name="completion_attribution_pair"),
        Index("ix_runs_revision_created", "revision_id", "created_at"),
        Index("ix_runs_job_created", "job_id", "created_at"),
        Index("ix_runs_created_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("part_revisions.id"))
    operation_id: Mapped[str] = mapped_column(String(64))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"))
    references_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    inspector: Mapped[str] = mapped_column(String(120))
    employee_number: Mapped[str | None] = mapped_column(ForeignKey("employees.number"), nullable=True)
    lot_number: Mapped[str] = mapped_column(String(120))
    sample_number: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_employee_number: Mapped[str | None] = mapped_column(ForeignKey("employees.number"), nullable=True)
    completed_shift: Mapped[str | None] = mapped_column(String(2), nullable=True)


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        CheckConstraint("status IN ('pass', 'fail')", name="measurement_status"),
        CheckConstraint("shift IS NULL OR shift IN ('1', '2', '3', '71')", name="measurement_shift_domain"),
        UniqueConstraint("run_id", "sequence"),
        Index("ix_measurements_run_feature_time", "run_id", "feature_id", "recorded_at"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[str] = mapped_column(ForeignKey("inspection_runs.id"))
    feature_id: Mapped[str] = mapped_column(ForeignKey("characteristics.id"))
    value: Mapped[Decimal] = mapped_column(Numeric(14, 6))
    status: Mapped[str] = mapped_column(String(10))
    notes: Mapped[str] = mapped_column(Text, default="")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    employee_number: Mapped[str | None] = mapped_column(ForeignKey("employees.number"), nullable=True)
    shift: Mapped[str | None] = mapped_column(String(2), nullable=True)


# Register the optional, separately versioned documentation module for Alembic.
from . import reference_models  # noqa: E402,F401
from . import auth_models  # noqa: E402,F401
