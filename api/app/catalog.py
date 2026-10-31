"""Administrator-owned draft definitions and explicit revision activation."""
from decimal import Decimal
from datetime import timezone
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import require_admin
from .auth_models import Employee
from .database import get_db
from .models import Feature, FeatureGuide, InspectionRun, Operation, Part, PartRevision, utcnow
from .references import get_reference_bundle

router = APIRouter(prefix="/api/admin/catalog", tags=["Part and revision administration"], dependencies=[Depends(require_admin)])
Family = Literal["dog-clutch", "differential-case", "bearing-cap", "flange", "shaft", "threaded-block", "housing", "ring"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9._-]+$")]
Exact = Annotated[Decimal, Field(max_digits=14, decimal_places=6, allow_inf_nan=False)]


class OperationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Code
    name: Short
    setup: str = Field(default="", max_length=4000)


class FeatureInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = Field(default=None, max_length=64)
    number: int = Field(ge=1, le=1000)
    label: Short
    type: Literal["dimensional", "angular", "geometric"] = "dimensional"
    nominal: Exact
    toleranceMinus: Exact = Field(default=Decimal(0), ge=0)
    tolerancePlus: Exact = Field(default=Decimal(0), ge=0)
    limitType: Literal["bilateral", "minimum", "maximum"] = "bilateral"
    unit: Literal["mm", "deg"] = "mm"
    method: str = Field(default="", max_length=200)
    datum: str = Field(default="", max_length=100)
    instruction: str = Field(default="", max_length=4000)
    sketchRef: str = Field(default="", max_length=80)
    animationKey: str | None = Field(default=None, max_length=80)
    zone: str = Field(default="Inspection", max_length=80)
    critical: bool = False

    @model_validator(mode="after")
    def coherent_limits(self):
        if self.limitType != "bilateral" and (self.toleranceMinus or self.tolerancePlus):
            raise ValueError("Minimum/maximum requirements use the nominal limit and zero tolerance offsets")
        if self.type == "angular" and self.unit != "deg":
            raise ValueError("Angular characteristics use degrees")
        if self.unit == "deg" and self.type != "angular":
            raise ValueError("Degree measurements must be angular characteristics")
        return self


class CreatePart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
    name: Short
    description: str = Field(default="", max_length=4000)
    revisionCode: Code = "A"
    material: str = Field(default="", max_length=200)
    finish: str = Field(default="", max_length=200)
    geometryFamily: Family | None = None
    operation: OperationInput


class CloneRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Code
    sourceRevisionId: str | None = Field(default=None, max_length=64)
    changeNote: str = Field(default="", max_length=4000)


class UpdateRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    material: str = Field(default="", max_length=200)
    finish: str = Field(default="", max_length=200)
    geometryFamily: Family | None = None
    changeNote: str = Field(default="", max_length=4000)
    operation: OperationInput
    features: list[FeatureInput] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique_characteristics(self):
        if len({feature.number for feature in self.features}) != len(self.features):
            raise ValueError("Characteristic numbers must be unique within an operation")
        ids = [feature.id for feature in self.features if feature.id]
        if len(ids) != len(set(ids)):
            raise ValueError("Characteristic IDs must not be repeated")
        return self


class ReleaseRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    activate: bool = True


class ActivateRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active: bool


def revision_dto(revision):
    return {"id": revision.id, "code": revision.code, "status": revision.status, "releasedAt": revision.released_at.replace(tzinfo=revision.released_at.tzinfo or timezone.utc).isoformat().replace("+00:00", "Z") if revision.released_at else None, "isActive": revision.is_active, "geometryFamily": revision.geometry_family, "changeNote": revision.change_note, "material": revision.material, "finish": revision.finish, "createdBy": revision.created_by, "releasedBy": revision.released_by}


def definition_dto(session: Session, revision: PartRevision):
    part = session.get(Part, revision.part_id)
    operation = session.scalar(select(Operation).where(Operation.revision_id == revision.id).order_by(Operation.code, Operation.id).limit(1))
    if operation is None:
        raise HTTPException(409, "This revision has no inspection operation")
    rows = session.execute(select(Feature, FeatureGuide).outerjoin(FeatureGuide, Feature.guide_id == FeatureGuide.id).where(Feature.operation_id == operation.id).order_by(Feature.number)).all()
    features = [{"id": f.id, "number": f.number, "label": f.label, "type": f.type, "nominal": float(f.nominal), "toleranceMinus": float(f.tolerance_minus), "tolerancePlus": float(f.tolerance_plus), "limitType": f.limit_type, "unit": f.unit, "method": f.method, "datum": f.datum, "instruction": f.instruction, "sketchRef": f.sketch_ref, "animationKey": g.animation_key if g else None, "zone": g.zone if g else "Inspection", "critical": f.critical} for f, g in rows]
    return {"id": part.id, "number": part.number, "name": part.name, "description": part.description, "material": revision.material, "finish": revision.finish, "revision": revision_dto(revision), "geometryFamily": revision.geometry_family, "operation": {"id": operation.id, "code": operation.code, "name": operation.name, "setup": operation.setup, "sketchId": operation.sketch_id}, "features": features, "references": get_reference_bundle(session, operation)}


def revision_and_part(session, identifier, draft=False, lock=True):
    revision = session.get(PartRevision, identifier)
    if revision is not None and lock:
        session.scalar(select(Part).where(Part.id == revision.part_id).with_for_update())
        revision = session.scalar(select(PartRevision).where(PartRevision.id == identifier).with_for_update().execution_options(populate_existing=True))
    if revision is None:
        raise HTTPException(404, "Part revision not found")
    if draft and revision.status != "draft":
        raise HTTPException(409, "Released requirements are read-only. Create a new draft revision to make changes.")
    return revision, session.get(Part, revision.part_id)


def activate(session, revision, active):
    # All activators serialize on the business part, then clear the old active
    # flag before setting the new one. A partial unique index is the backstop.
    session.scalar(select(Part).where(Part.id == revision.part_id).with_for_update())
    if active and revision.status != "released":
        raise HTTPException(409, "Release and review this revision before making it active")
    if active:
        previous = session.scalars(select(PartRevision).where(PartRevision.part_id == revision.part_id, PartRevision.is_active.is_(True), PartRevision.id != revision.id)).all()
        for old in previous:
            old.is_active = False
        session.flush()
    revision.is_active = active
    session.flush()


@router.get("/parts")
def list_admin_parts(q: str = Query(default="", max_length=120), limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0), session: Session = Depends(get_db)):
    query = select(Part).order_by(Part.number)
    if q.strip():
        prefix = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(Part.number.ilike(prefix, escape="\\") | Part.name.ilike(prefix, escape="\\"))
    parts = session.scalars(query.offset(offset).limit(limit)).all()
    ids = [part.id for part in parts]
    counts = {part_id: (count, active_code) for part_id, count, active_code in session.execute(select(PartRevision.part_id, func.count(), func.max(case((PartRevision.is_active.is_(True), PartRevision.code), else_=None))).where(PartRevision.part_id.in_(ids)).group_by(PartRevision.part_id))} if ids else {}
    return [{"id": part.id, "number": part.number, "name": part.name, "description": part.description, "activeRevisionCode": counts.get(part.id, (0, None))[1], "revisionCount": counts.get(part.id, (0, None))[0]} for part in parts]


@router.get("/parts/{number}")
def get_admin_part(number: str, session: Session = Depends(get_db)):
    part = session.scalar(select(Part).where(Part.number == number.upper()))
    if part is None:
        raise HTTPException(404, "Part not found")
    revisions = session.scalars(select(PartRevision).where(PartRevision.part_id == part.id).order_by(PartRevision.code)).all()
    return {"part": {"id": part.id, "number": part.number, "name": part.name, "description": part.description}, "revisions": [revision_dto(r) for r in revisions]}


@router.post("/parts", status_code=201)
def create_part(body: CreatePart, employee: Employee = Depends(require_admin), session: Session = Depends(get_db)):
    if session.scalar(select(Part.id).where(Part.number == body.number.upper())):
        raise HTTPException(409, "This part number already exists. Add a revision to that part instead.")
    part = Part(id=str(uuid4()), number=body.number.upper(), name=body.name, description=body.description.strip())
    session.add(part)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "This part number was created by another administrator. Reopen the library.")
    revision = PartRevision(id=str(uuid4()), part_id=part.id, code=body.revisionCode.upper(), status="draft", material=body.material.strip(), finish=body.finish.strip(), geometry_family=body.geometryFamily, change_note="Initial draft", created_by=employee.number, is_active=False)
    session.add(revision)
    session.flush()
    session.add(Operation(id=str(uuid4()), revision_id=revision.id, code=body.operation.code, name=body.operation.name, setup=body.operation.setup.strip(), sketch_id=None))
    session.flush()
    return definition_dto(session, revision)


@router.post("/parts/{number}/revisions", status_code=201)
def clone_revision(number: str, body: CloneRevision, employee: Employee = Depends(require_admin), session: Session = Depends(get_db)):
    part = session.scalar(select(Part).where(Part.number == number.upper()).with_for_update())
    if part is None:
        raise HTTPException(404, "Part not found")
    if session.scalar(select(PartRevision.id).where(PartRevision.part_id == part.id, PartRevision.code == body.code.upper())):
        raise HTTPException(409, "This revision code already exists")
    source = session.get(PartRevision, body.sourceRevisionId) if body.sourceRevisionId else session.scalar(select(PartRevision).where(PartRevision.part_id == part.id).order_by(PartRevision.is_active.desc(), PartRevision.released_at.desc(), PartRevision.id).limit(1))
    if source is None or source.part_id != part.id:
        raise HTTPException(422, "Choose a source revision belonging to this part")
    operation = session.scalar(select(Operation).where(Operation.revision_id == source.id).order_by(Operation.code).limit(1))
    if operation is None:
        raise HTTPException(409, "Source revision has no operation to copy")
    revision = PartRevision(id=str(uuid4()), part_id=part.id, code=body.code.upper(), status="draft", material=source.material, finish=source.finish, geometry_family=source.geometry_family, change_note=body.changeNote.strip(), created_by=employee.number, is_active=False)
    session.add(revision)
    session.flush()
    new_operation = Operation(id=str(uuid4()), revision_id=revision.id, code=operation.code, name=operation.name, setup=operation.setup, sketch_id=None)
    session.add(new_operation)
    session.flush()
    for feature, guide in session.execute(select(Feature, FeatureGuide).outerjoin(FeatureGuide, Feature.guide_id == FeatureGuide.id).where(Feature.operation_id == operation.id).order_by(Feature.number)):
        guide_id = None
        if guide is not None:
            guide_id = str(uuid4())
            session.add(FeatureGuide(id=guide_id, animation_key=guide.animation_key, zone=guide.zone))
            session.flush()
        session.add(Feature(id=str(uuid4()), operation_id=new_operation.id, guide_id=guide_id, **{name: getattr(feature, name) for name in ("number", "label", "type", "nominal", "tolerance_minus", "tolerance_plus", "limit_type", "unit", "method", "datum", "instruction", "sketch_ref", "critical")}))
    session.flush()
    return definition_dto(session, revision)


@router.get("/revisions/{revision_id}")
def get_admin_revision(revision_id: str, session: Session = Depends(get_db)):
    revision, _ = revision_and_part(session, revision_id, lock=False)
    return definition_dto(session, revision)


@router.put("/revisions/{revision_id}")
def update_revision(revision_id: str, body: UpdateRevision, session: Session = Depends(get_db)):
    revision, _ = revision_and_part(session, revision_id, draft=True)
    operation = session.scalar(select(Operation).where(Operation.revision_id == revision.id).order_by(Operation.code).limit(1))
    if session.scalar(select(InspectionRun.id).where(InspectionRun.revision_id == revision.id).limit(1)):
        raise HTTPException(409, "A revision with recorded inspections cannot be changed")
    old = session.scalars(select(Feature).where(Feature.operation_id == operation.id)).all()
    owned = {f.id: f for f in old}
    if any(f.id and f.id not in owned for f in body.features):
        raise HTTPException(422, "Characteristic IDs must belong to this draft revision")
    old_guides = [f.guide_id for f in old if f.guide_id]
    # Replacing a draft can reorder/re-number rows. Remove then reinsert using
    # stable owned IDs; no inspection can reference a draft definition.
    session.execute(delete(Feature).where(Feature.operation_id == operation.id))
    session.flush()
    if old_guides:
        session.execute(delete(FeatureGuide).where(FeatureGuide.id.in_(old_guides)))
    for item in body.features:
        guide_id = str(uuid4()) if item.animationKey else None
        if guide_id:
            session.add(FeatureGuide(id=guide_id, animation_key=item.animationKey, zone=item.zone.strip() or "Inspection"))
            session.flush()
        session.add(Feature(id=item.id or str(uuid4()), operation_id=operation.id, guide_id=guide_id, number=item.number, label=item.label, type=item.type, nominal=item.nominal, tolerance_minus=item.toleranceMinus, tolerance_plus=item.tolerancePlus, limit_type=item.limitType, unit=item.unit, method=item.method.strip(), datum=item.datum.strip(), instruction=item.instruction.strip(), sketch_ref=item.sketchRef.strip() or f"{item.number:02d}", critical=item.critical))
    revision.material, revision.finish = body.material.strip(), body.finish.strip()
    revision.geometry_family, revision.change_note = body.geometryFamily, body.changeNote.strip()
    operation.code, operation.name, operation.setup = body.operation.code, body.operation.name, body.operation.setup.strip()
    session.flush()
    session.expire_all()
    return definition_dto(session, session.get(PartRevision, revision.id))


@router.post("/revisions/{revision_id}/release")
def release_revision(revision_id: str, body: ReleaseRevision, employee: Employee = Depends(require_admin), session: Session = Depends(get_db)):
    revision, _ = revision_and_part(session, revision_id, draft=True)
    operation = session.scalar(select(Operation).where(Operation.revision_id == revision.id).order_by(Operation.code).limit(1))
    features = session.scalars(select(Feature).where(Feature.operation_id == operation.id)).all() if operation else []
    if not features:
        raise HTTPException(409, "Add at least one inspection characteristic before releasing")
    if not revision.material.strip() or not operation.setup.strip() or any(not f.method.strip() or not f.instruction.strip() for f in features):
        raise HTTPException(409, "Complete the material, setup, measurement method, and instructions before release")
    revision.status, revision.released_at, revision.released_by = "released", utcnow(), employee.number
    session.flush()
    if body.activate:
        activate(session, revision, True)
    return definition_dto(session, revision)


@router.post("/revisions/{revision_id}/active")
def set_active_revision(revision_id: str, body: ActivateRevision, session: Session = Depends(get_db)):
    revision, _ = revision_and_part(session, revision_id)
    if revision.status != "released":
        raise HTTPException(409, "Only a released revision can be active or inactive")
    activate(session, revision, body.active)
    return definition_dto(session, revision)
