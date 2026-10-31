from datetime import timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from sqlalchemy import case, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_db
from .auth import get_current_employee, router as auth_router
from .auth_models import Employee
from .models import Feature, FeatureGuide, InspectionRun, Job, Measurement, Operation, Part, PartRevision, utcnow
from .schemas import CompletionCreate, MeasurementCreate, MeasurementResponse, PartResponse, PartSummaryResponse, RunCreate, RunResponse, RunSummaryResponse
from .references import get_reference_bundle, router as references_router

app = FastAPI(title="Part Central inspection API", version="1.1.0", description="Job-number inspections with revision-bound requirements and optional reference documents.", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
app.include_router(references_router)
app.include_router(auth_router)
protected = APIRouter(dependencies=[Depends(get_current_employee)])


def timestamp(value):
    return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def measurement_dto(value):
    return {"id": value.id, "sequence": value.sequence, "featureId": value.feature_id, "value": float(value.value), "status": value.status, "notes": value.notes, "recordedAt": timestamp(value.recorded_at), "employeeNumber": value.employee_number, "shift": value.shift}


def run_identity(session, run):
    return session.execute(select(Job.number, Part.number, PartRevision.code).join(InspectionRun, InspectionRun.job_id == Job.id).join(PartRevision, PartRevision.id == InspectionRun.revision_id).join(Part, Part.id == PartRevision.part_id).where(InspectionRun.id == run.id)).one()


def run_summary(run, identity, count=0, has_failure=False, recorded_at=None, recorded_by=None, recorded_shift=None):
    job_number, part_number, revision_code = identity
    return {"id": run.id, "partRevisionId": run.revision_id, "operationId": run.operation_id, "partNumber": part_number, "revisionCode": revision_code, "jobId": run.job_id, "jobNumber": job_number, "inspector": run.inspector, "lotNumber": run.lot_number, "sampleNumber": run.sample_number, "status": run.status, "createdAt": timestamp(run.created_at), "completedAt": timestamp(run.completed_at), "overallStatus": ("fail" if has_failure else "pass") if run.status == "completed" else None, "measurementCount": count, "employeeNumber": run.employee_number, "completedByEmployeeNumber": run.completed_by_employee_number, "completedShift": run.completed_shift, "lastActivityAt": timestamp(run.completed_at or recorded_at or run.created_at), "lastRecordedByEmployeeNumber": recorded_by, "lastRecordedShift": recorded_shift}


def run_dto(run, session, values=None, identity=None):
    if values is None:
        values = session.scalars(select(Measurement).where(Measurement.run_id == run.id).order_by(Measurement.sequence)).all()
    latest = {value.feature_id: value for value in values}
    last = values[-1] if values else None
    result = run_summary(run, identity or run_identity(session, run), len(latest), any(value.status == "fail" for value in latest.values()), last.recorded_at if last else None, last.employee_number if last else None, last.shift if last else None)
    result.update(references=run.references_snapshot, measurements=[measurement_dto(value) for value in values])
    return result


def locked_run(run_id, session):
    run = session.scalar(select(InspectionRun).where(InspectionRun.id == run_id).with_for_update())
    if run is None:
        raise HTTPException(404, "Inspection run not found")
    return run


def current_sequence(run_id, session, expected=None):
    sequence = session.scalar(select(func.max(Measurement.sequence)).where(Measurement.run_id == run_id)) or 0
    if expected is not None and expected != sequence:
        raise HTTPException(409, "This sheet changed on another workstation. Reopen it from the job archive before saving or completing.")
    return sequence


def feature_dto(feature, guide):
    return {"id": feature.id, "number": feature.number, "label": feature.label, "type": feature.type, "nominal": float(feature.nominal), "toleranceMinus": float(feature.tolerance_minus), "tolerancePlus": float(feature.tolerance_plus), "unit": feature.unit, "method": feature.method, "datum": feature.datum, "instruction": feature.instruction, "sketchRef": feature.sketch_ref, "animationKey": guide.animation_key if guide else None, "zone": guide.zone if guide else "Inspection", "critical": feature.critical, "limitType": feature.limit_type}


def part_dto(part, revision, operation, session, include_features=True):
    result = {"id": part.id, "number": part.number, "name": part.name, "description": part.description, "material": revision.material, "finish": revision.finish, "revision": {"id": revision.id, "code": revision.code, "status": revision.status, "releasedAt": timestamp(revision.released_at), "isActive": revision.is_active, "geometryFamily": revision.geometry_family, "changeNote": revision.change_note}, "geometryFamily": revision.geometry_family, "operation": {"id": operation.id, "code": operation.code, "name": operation.name, "setup": operation.setup, "sketchId": operation.sketch_id}}
    if include_features:
        rows = session.execute(select(Feature, FeatureGuide).outerjoin(FeatureGuide, Feature.guide_id == FeatureGuide.id).where(Feature.operation_id == operation.id).order_by(Feature.number)).all()
        result["features"] = [feature_dto(feature, guide) for feature, guide in rows]
        result["references"] = get_reference_bundle(session, operation)
    return result


def latest_released_operation(part, session, revision_id=None):
    query = select(PartRevision).where(PartRevision.part_id == part.id)
    query = query.where(PartRevision.id == revision_id, PartRevision.status.in_(["released", "obsolete"])) if revision_id else query.where(PartRevision.status == "released", PartRevision.is_active.is_(True))
    revision = session.scalar(query.order_by(PartRevision.released_at.desc(), PartRevision.id.desc()).limit(1))
    if revision is None:
        raise HTTPException(404, "Requested released part revision is not available")
    operation = session.scalar(select(Operation).where(Operation.revision_id == revision.id).order_by(Operation.code, Operation.id).limit(1))
    if operation is None:
        raise HTTPException(404, "No inspection operation available")
    return revision, operation


def literal_prefix(value):
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@app.get("/api/health")
def health(session: Session = Depends(get_db)):
    session.execute(text("SELECT 1"))
    return {"status": "ok", "mode": "database", "version": "1.1.0"}


@protected.get("/api/parts", response_model=list[PartSummaryResponse])
def list_parts(q: str = Query(default="", max_length=120), limit: int = Query(default=50, ge=1, le=50), offset: int = Query(default=0, ge=0), session: Session = Depends(get_db)):
    revisions = select(PartRevision.id.label("id"), func.row_number().over(partition_by=PartRevision.part_id, order_by=(PartRevision.released_at.desc(), PartRevision.id.desc())).label("rank")).where(PartRevision.status == "released", PartRevision.is_active.is_(True)).subquery()
    operations = select(Operation.id.label("id"), func.row_number().over(partition_by=Operation.revision_id, order_by=(Operation.code, Operation.id)).label("rank")).subquery()
    query = select(Part, PartRevision, Operation).join(PartRevision, PartRevision.part_id == Part.id).join(revisions, revisions.c.id == PartRevision.id).join(Operation, Operation.revision_id == PartRevision.id).join(operations, operations.c.id == Operation.id).where(revisions.c.rank == 1, operations.c.rank == 1)
    if q.strip():
        prefix = literal_prefix(q.strip())
        query = query.where(Part.number.ilike(prefix, escape="\\") | Part.name.ilike(prefix, escape="\\") | PartRevision.material.ilike(prefix, escape="\\"))
    rows = session.execute(query.order_by(Part.number, Part.id).offset(offset).limit(limit)).all()
    return [part_dto(part, revision, operation, session, include_features=False) for part, revision, operation in rows]


@protected.get("/api/parts/{number}", response_model=PartResponse)
def get_part(number: str, revision_id: str | None = Query(default=None, alias="revisionId", min_length=1, max_length=64), session: Session = Depends(get_db)):
    part = session.scalar(select(Part).where(Part.number == number.upper()))
    if part is None:
        raise HTTPException(404, "Part number not found")
    revision, operation = latest_released_operation(part, session, revision_id)
    return part_dto(part, revision, operation, session)


def get_or_create_job(session, number):
    normalized = number.strip().upper()
    job = session.scalar(select(Job).where(Job.number == normalized))
    if job is not None:
        return job
    try:
        with session.begin_nested():
            job = Job(id=str(uuid4()), number=normalized)
            session.add(job)
            session.flush()
    except IntegrityError:
        job = session.scalar(select(Job).where(Job.number == normalized))
        if job is None:
            raise
    return job


@protected.get("/api/jobs")
def list_jobs(q: str = Query(default="", max_length=80), limit: int = Query(default=50, ge=1, le=50), session: Session = Depends(get_db)):
    query = select(Job)
    if q.strip():
        query = query.where(Job.number.like(literal_prefix(q.strip().upper()), escape="\\"))
    return [{"id": job.id, "number": job.number, "createdAt": timestamp(job.created_at)} for job in session.scalars(query.order_by(Job.number).limit(limit))]


@protected.post("/api/runs", status_code=201, response_model=RunResponse)
def create_run(body: RunCreate, employee: Employee = Depends(get_current_employee), session: Session = Depends(get_db)):
    operation = session.get(Operation, body.operationId)
    revision = session.get(PartRevision, body.partRevisionId)
    if operation is None or revision is None or operation.revision_id != revision.id:
        raise HTTPException(422, "Operation does not belong to this part revision")
    session.scalar(select(Part).where(Part.id == revision.part_id).with_for_update(read=True))
    session.refresh(revision)
    if revision.status != "released" or not revision.is_active:
        raise HTTPException(409, "This revision is not active. Reopen the part to start a sheet against its active revision.")
    job = get_or_create_job(session, body.jobNumber)
    run = InspectionRun(id=str(uuid4()), revision_id=revision.id, operation_id=operation.id, job_id=job.id, references_snapshot=get_reference_bundle(session, operation), inspector=employee.display_name, employee_number=employee.number, lot_number=body.lotNumber, sample_number=body.sampleNumber)
    session.add(run)
    session.flush()
    return run_dto(run, session)


@protected.get("/api/runs", response_model=list[RunResponse | RunSummaryResponse])
def list_runs(limit: int = Query(default=100, ge=1, le=100), offset: int = Query(default=0, ge=0), part_revision_id: str | None = Query(default=None, alias="partRevisionId", min_length=1, max_length=64), job_number: str | None = Query(default=None, alias="jobNumber", min_length=1, max_length=80), search: str = Query(default="", max_length=80), summary: bool = False, session: Session = Depends(get_db)):
    query = select(InspectionRun, Job.number, Part.number, PartRevision.code).join(Job, InspectionRun.job_id == Job.id).join(PartRevision, PartRevision.id == InspectionRun.revision_id).join(Part, Part.id == PartRevision.part_id)
    if part_revision_id is not None:
        query = query.where(InspectionRun.revision_id == part_revision_id)
    if job_number is not None:
        query = query.where(Job.number == job_number.strip().upper())
    if search.strip():
        query = query.where(Job.number.like(literal_prefix(search.strip().upper()), escape="\\"))
    rows = session.execute(query.order_by(InspectionRun.created_at.desc(), InspectionRun.id.desc()).offset(offset).limit(limit)).all()
    if not rows:
        return []
    ids = [row[0].id for row in rows]
    if summary:
        # Both ranks are scoped to the bounded page. Aggregate provenance with
        # the latest-per-characteristic results, without loading full histories
        # or issuing one query for each sheet.
        latest = select(Measurement.run_id.label("run_id"), Measurement.status.label("status"), Measurement.recorded_at, Measurement.employee_number, Measurement.shift, func.row_number().over(partition_by=(Measurement.run_id, Measurement.feature_id), order_by=Measurement.sequence.desc()).label("rank"), func.row_number().over(partition_by=Measurement.run_id, order_by=Measurement.sequence.desc()).label("run_rank")).where(Measurement.run_id.in_(ids)).subquery()
        aggregates = {run_id: (count, bool(failures), recorded_at, employee_number, shift) for run_id, count, failures, recorded_at, employee_number, shift in session.execute(select(latest.c.run_id, func.count(), func.sum(case((latest.c.status == "fail", 1), else_=0)), func.max(case((latest.c.run_rank == 1, latest.c.recorded_at))), func.max(case((latest.c.run_rank == 1, latest.c.employee_number))), func.max(case((latest.c.run_rank == 1, latest.c.shift)))).where(latest.c.rank == 1).group_by(latest.c.run_id))}
        return [run_summary(run, (job, part, revision), *aggregates.get(run.id, (0, False))) for run, job, part, revision in rows]
    histories = {run_id: [] for run_id in ids}
    for value in session.scalars(select(Measurement).where(Measurement.run_id.in_(ids)).order_by(Measurement.run_id, Measurement.sequence)):
        histories[value.run_id].append(value)
    return [run_dto(run, session, histories[run.id], (job, part, revision)) for run, job, part, revision in rows]


@protected.get("/api/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: str, session: Session = Depends(get_db)):
    run = session.get(InspectionRun, run_id)
    if run is None:
        raise HTTPException(404, "Inspection run not found")
    return run_dto(run, session)


@protected.post("/api/runs/{run_id}/measurements", status_code=201, response_model=MeasurementResponse)
def append_measurement(run_id: str, body: MeasurementCreate, employee: Employee = Depends(get_current_employee), session: Session = Depends(get_db)):
    run = locked_run(run_id, session)
    if run.status != "draft":
        raise HTTPException(409, "Completed inspections are locked")
    last_sequence = current_sequence(run.id, session, body.expectedSequence)
    feature = session.get(Feature, body.featureId)
    if feature is None or feature.operation_id != run.operation_id:
        raise HTTPException(422, "Characteristic does not belong to this inspection operation")
    lower, upper = feature.nominal - feature.tolerance_minus, feature.nominal + feature.tolerance_plus
    within = body.value >= feature.nominal if feature.limit_type == "minimum" else body.value <= feature.nominal if feature.limit_type == "maximum" else lower <= body.value <= upper
    if feature.type == "geometric" and body.value < 0:
        within = False
    status = "pass" if within else "fail"
    sequence = last_sequence + 1
    measurement = Measurement(id=str(uuid4()), sequence=sequence, run_id=run.id, feature_id=feature.id, value=body.value, status=status, notes=body.notes, employee_number=employee.number, shift=body.shift)
    session.add(measurement)
    session.flush()
    return measurement_dto(measurement)


@protected.post("/api/runs/{run_id}/complete", response_model=RunResponse)
def complete_run(run_id: str, body: CompletionCreate, employee: Employee = Depends(get_current_employee), session: Session = Depends(get_db)):
    run = locked_run(run_id, session)
    if run.status == "completed":
        return run_dto(run, session)
    current_sequence(run.id, session, body.expectedSequence)
    required = set(session.scalars(select(Feature.id).where(Feature.operation_id == run.operation_id)))
    recorded = set(session.scalars(select(Measurement.feature_id).where(Measurement.run_id == run.id)))
    if not required or not required.issubset(recorded):
        raise HTTPException(409, "Record every characteristic before completing this inspection")
    run.status, run.completed_at = "completed", utcnow()
    run.completed_by_employee_number, run.completed_shift = employee.number, body.shift
    session.flush()
    return run_dto(run, session)


from .catalog import router as catalog_router
app.include_router(protected)
app.include_router(catalog_router)
