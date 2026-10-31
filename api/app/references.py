"""Bounded admin uploads and immutable operation reference publication."""
import hashlib
import hmac
import os
import re
import zlib
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .database import get_db
from .auth import get_current_employee, require_admin as authorize_administrator
from .models import Feature, FeatureGuide, Operation, PartRevision, Sketch
from .reference_models import OperationReferenceVersion, ReferenceAsset


router = APIRouter(tags=["Reference administration"])
MAX_ASSET_BYTES = 10 * 1024 * 1024
SUPPORTED_ANIMATIONS = frozenset({"dog-height", "ramp-height", "ramp-angle", "dog-width", "pitch-diameter", "bore-diameter", "face-runout", "overall-thickness", "outside-diameter", "bearing-bore", "thread-depth", "drill-depth", "counterbore-depth", "hole-spacing", "bolt-circle", "wall-thickness", "overall-length", "shoulder-height", "flatness", "slot-width", "flange-thickness"})
AssetId = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class PublishReferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sketchAssetId: AssetId | None = None
    diagramAssetId: AssetId | None = None
    modelAvailable: bool = False
    notes: str = Field(default="", max_length=4000)
    expectedVersion: int = Field(ge=0)


def require_admin(request: Request, session: Session = Depends(get_db)):
    if not os.getenv("ADMIN_TOKEN", ""):
        raise HTTPException(503, "Reference administration is disabled until an administrator credential is configured")
    return authorize_administrator(get_current_employee(request, session))


def storage_root() -> Path:
    return Path(os.getenv("ASSET_STORAGE_DIR", str(Path(__file__).resolve().parents[1] / "assets"))).resolve()


def asset_dto(asset: ReferenceAsset):
    return {"id": asset.id, "name": asset.name, "mediaType": asset.media_type, "url": f"/api/reference-assets/{asset.id}", "sha256": asset.sha256}


def geometry_family(session: Session, operation: Operation):
    return session.scalar(select(PartRevision.geometry_family).where(PartRevision.id == operation.revision_id))


def has_model(session: Session, operation: Operation) -> bool:
    family = geometry_family(session, operation)
    if family not in {"dog-clutch", "differential-case", "bearing-cap", "flange", "shaft", "threaded-block", "housing", "ring"}:
        return False
    return session.scalar(select(Feature.id).join(FeatureGuide, Feature.guide_id == FeatureGuide.id).where(Feature.operation_id == operation.id, FeatureGuide.animation_key.in_(SUPPORTED_ANIMATIONS)).limit(1)) is not None


def builtin_sketch(session: Session, operation: Operation):
    if not operation.sketch_id:
        return None
    if geometry_family(session, operation) not in {"dog-clutch", "differential-case", "bearing-cap", "flange", "shaft", "threaded-block", "housing", "ring"}:
        return None
    sketch = session.get(Sketch, operation.sketch_id)
    if sketch is None or sketch.asset_path != "generated://operation-sketch":
        return None
    return {"id": sketch.id, "name": sketch.title, "mediaType": "application/x-partcentral-sketch", "url": None, "sha256": None}


def get_reference_bundle(session: Session, operation: Operation):
    edition = session.scalar(select(OperationReferenceVersion).where(OperationReferenceVersion.operation_id == operation.id).order_by(OperationReferenceVersion.version.desc()).limit(1))
    if edition is None:
        return {"id": None, "version": 0, "geometryFamily": geometry_family(session, operation), "sketch": builtin_sketch(session, operation), "diagram": None, "modelAvailable": has_model(session, operation), "notes": ""}
    assets = {value.id: value for value in session.scalars(select(ReferenceAsset).where(ReferenceAsset.id.in_([value for value in [edition.sketch_asset_id, edition.diagram_asset_id] if value])))}
    sketch = asset_dto(assets[edition.sketch_asset_id]) if edition.sketch_asset_id else builtin_sketch(session, operation) if edition.builtin_sketch_id else None
    diagram = asset_dto(assets[edition.diagram_asset_id]) if edition.diagram_asset_id else None
    return {"id": edition.id, "version": edition.version, "geometryFamily": geometry_family(session, operation), "sketch": sketch, "diagram": diagram, "modelAvailable": edition.model_available, "notes": edition.notes}


def require_operation(operation_id: str, session: Session, lock=False):
    query = select(Operation).where(Operation.id == operation_id)
    if lock:
        query = query.with_for_update()
    operation = session.scalar(query)
    if operation is None:
        raise HTTPException(404, "Inspection operation not found")
    return operation


@router.get("/api/admin/status")
def administration_status():
    return {"configured": bool(os.getenv("ADMIN_TOKEN", ""))}


@router.get("/api/admin/operations/{operation_id}/references", dependencies=[Depends(require_admin)])
def admin_references(operation_id: str, session: Session = Depends(get_db)):
    return get_reference_bundle(session, require_operation(operation_id, session))


def verified_media(data: bytes, supplied: str):
    supplied = supplied.split(";", 1)[0].strip().lower()
    if valid_png_structure(data):
        actual, suffix = "image/png", ".png"
    elif valid_jpeg_structure(data):
        actual, suffix = "image/jpeg", ".jpg"
    elif re.match(br"%PDF-[12]\.[0-9]", data) and b"%%EOF" in data[-1024:]:
        actual, suffix = "application/pdf", ".pdf"
    else:
        raise HTTPException(415, "Upload a PNG, JPEG, or PDF file with a valid file signature")
    if supplied != actual:
        raise HTTPException(415, "The file content does not match its declared media type")
    return actual, suffix


def valid_png_structure(data: bytes) -> bool:
    """Reject truncated or corrupt PNG containers without decoding pixel data.

    This is basic format validation, not a malware scan or a full image decoder.
    CRCs and chunk bounds prevent a magic-only payload from becoming an asset.
    """
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    cursor, first, pixels = 8, True, False
    while cursor + 12 <= len(data):
        length = int.from_bytes(data[cursor:cursor + 4], "big")
        end = cursor + length + 12
        if end > len(data):
            return False
        kind = data[cursor + 4:cursor + 8]
        content = data[cursor + 8:end - 4]
        if zlib.crc32(kind + content) != int.from_bytes(data[end - 4:end], "big"):
            return False
        if first:
            if kind != b"IHDR" or length != 13 or not int.from_bytes(content[:4], "big") or not int.from_bytes(content[4:8], "big"):
                return False
            first = False
        elif kind == b"IHDR":
            return False
        if kind == b"IDAT":
            pixels = True
        if kind == b"IEND":
            return length == 0 and pixels and end == len(data)
        cursor = end
    return False


def valid_jpeg_structure(data: bytes) -> bool:
    """Validate marker bounds, a frame, scan, and terminator; do not decode."""
    if not data.startswith(b"\xff\xd8\xff"):
        return False
    cursor, frame, scan = 2, False, False
    while cursor < len(data):
        if data[cursor] != 0xFF:
            return False
        while cursor < len(data) and data[cursor] == 0xFF:
            cursor += 1
        if cursor >= len(data):
            return False
        marker = data[cursor]
        cursor += 1
        if marker == 0xD9:
            return frame and scan and cursor == len(data)
        if marker in {0x00, 0xD8} or 0xD0 <= marker <= 0xD7:
            return False
        if marker == 0x01:
            continue
        if cursor + 2 > len(data):
            return False
        length = int.from_bytes(data[cursor:cursor + 2], "big")
        if length < 2 or cursor + length > len(data):
            return False
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if length < 8 or not int.from_bytes(data[cursor + 3:cursor + 5], "big") or not int.from_bytes(data[cursor + 5:cursor + 7], "big"):
                return False
            frame = True
        cursor += length
        if marker == 0xDA:
            if not frame:
                return False
            scan = True
            # Entropy scans escape literal FF and may contain restart markers.
            while cursor < len(data):
                if data[cursor] != 0xFF:
                    cursor += 1
                    continue
                marker_start = cursor
                while cursor < len(data) and data[cursor] == 0xFF:
                    cursor += 1
                if cursor >= len(data):
                    return False
                if data[cursor] == 0x00 or 0xD0 <= data[cursor] <= 0xD7:
                    cursor += 1
                    continue
                cursor = marker_start
                break
    return False


def store_asset(operation_id: str, kind: str, filename: str, content_type: str, data: bytes, session: Session):
    require_operation(operation_id, session)
    media_type, suffix = verified_media(data, content_type)
    # The display name never participates in filesystem lookup.
    filename = filename.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", filename).strip()[:190] or f"{kind}{suffix}"
    identifier = str(uuid4())
    key = identifier + suffix
    root = storage_root()
    root.mkdir(parents=True, exist_ok=True)
    path = root / key
    with path.open("xb") as output:
        output.write(data)
    asset = ReferenceAsset(id=identifier, operation_id=operation_id, kind=kind, name=name, media_type=media_type, storage_key=key, sha256=hashlib.sha256(data).hexdigest(), size_bytes=len(data))
    try:
        session.add(asset)
        session.flush()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return asset_dto(asset)


@router.post("/api/admin/operations/{operation_id}/assets", status_code=201, dependencies=[Depends(require_admin)])
async def upload_reference_asset(
    operation_id: str,
    request: Request,
    kind: Literal["sketch", "diagram"] = Query(),
    filename: str = Query(min_length=1, max_length=240),
    session: Session = Depends(get_db),
):
    declared = request.headers.get("content-length")
    if declared:
        try:
            length = int(declared)
        except ValueError:
            raise HTTPException(400, "Invalid upload length")
        if length < 1 or length > MAX_ASSET_BYTES:
            raise HTTPException(413, "Reference files must be between 1 byte and 10 MiB")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_ASSET_BYTES:
            raise HTTPException(413, "Reference files must be at most 10 MiB")
    if not data:
        raise HTTPException(422, "Choose a non-empty reference file")
    return await run_in_threadpool(store_asset, operation_id, kind, filename, request.headers.get("content-type", ""), bytes(data), session)


@router.post("/api/admin/operations/{operation_id}/references", status_code=201, dependencies=[Depends(require_admin)])
def publish_references(operation_id: str, body: PublishReferences, session: Session = Depends(get_db)):
    operation = require_operation(operation_id, session, lock=True)
    current = get_reference_bundle(session, operation)
    if current["version"] != body.expectedVersion:
        raise HTTPException(409, "References changed since they were opened. Reload before publishing.")
    baseline = builtin_sketch(session, operation)
    builtin_id = baseline["id"] if baseline and body.sketchAssetId == baseline["id"] else None
    for identifier, kind in [(body.sketchAssetId if not builtin_id else None, "sketch"), (body.diagramAssetId, "diagram")]:
        if identifier is None:
            continue
        asset = session.get(ReferenceAsset, identifier)
        if asset is None or asset.operation_id != operation_id or asset.kind != kind:
            raise HTTPException(422, "Each reference file must belong to this operation and match its reference type")
    if body.modelAvailable and not has_model(session, operation):
        raise HTTPException(422, "This operation does not have a supported 3D feature guide")
    edition = OperationReferenceVersion(id=str(uuid4()), operation_id=operation_id, version=current["version"] + 1, sketch_asset_id=body.sketchAssetId if not builtin_id else None, diagram_asset_id=body.diagramAssetId, builtin_sketch_id=builtin_id, model_available=body.modelAvailable, notes=body.notes.strip())
    session.add(edition)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "References were published concurrently. Reload before publishing.")
    return get_reference_bundle(session, operation)


@router.get("/api/reference-assets/{asset_id}", tags=["Reference assets"], dependencies=[Depends(get_current_employee)])
def read_reference_asset(asset_id: str, session: Session = Depends(get_db)):
    asset = session.get(ReferenceAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "Reference file not found")
    root = storage_root()
    path = (root / asset.storage_key).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(404, "Reference file is unavailable in storage")
    return FileResponse(path, media_type=asset.media_type, filename=asset.name, content_disposition_type="inline", headers={"Cache-Control": "private, max-age=3600, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "ETag": '"' + asset.sha256 + '"'})
