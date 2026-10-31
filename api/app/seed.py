"""Seed synthetic definitions without overwriting existing revisions.

Reflected insert mappings also support migration tests that seed older schemas.
"""
import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.orm import Session
from .database import SessionLocal

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "demo.json"


def seed(session: Session, path: Path = DATA_PATH):
    data = json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal)
    inspector = sa.inspect(session.get_bind())
    tables = {name: sa.table(name, *(sa.column(c["name"], c["type"]) for c in inspector.get_columns(name))) for name in ("parts", "part_revisions", "operation_sketches", "operations", "feature_guides", "characteristics")}

    def insert(name, values):
        table = tables[name]
        session.execute(table.insert().values(**{key: value for key, value in values.items() if key in table.c}))

    for part in [*data["parts"], *data.get("revisionExamples", [])]:
        revision = part["revision"]
        revisions = tables["part_revisions"]
        if session.scalar(sa.select(revisions.c.id).where(revisions.c.id == revision["id"])):
            continue
        masters = tables["parts"]
        master_id = session.scalar(sa.select(masters.c.id).where(masters.c.number == part["number"]))
        # An administrator may already have authored this business revision
        # using opaque UUIDs. A fixture's IDs do not outrank its controlled
        # (part number, revision code) identity, and must never overwrite it.
        if master_id is not None and session.scalar(sa.select(revisions.c.id).where(revisions.c.part_id == master_id, revisions.c.code == revision["code"])):
            continue
        if master_id is None:
            master_id = part["id"]
            insert("parts", {key: part[key] for key in ("id", "number", "name", "description")})
        released = revision.get("releasedAt")
        insert("part_revisions", {"id": revision["id"], "part_id": master_id, "code": revision["code"], "status": "draft", "released_at": datetime.fromisoformat(released.replace("Z", "+00:00")) if released else None, "material": part["material"], "finish": part["finish"], "is_active": False, "geometry_family": revision.get("geometryFamily", part.get("geometryFamily", "dog-clutch" if part["number"].startswith("DG-") else "ring" if part["number"] == "RD-4200" else None)), "change_note": revision.get("changeNote", "Synthetic example definition"), "created_by": None, "released_by": None})
        operation = part["operation"]
        if operation.get("sketchId"):
            insert("operation_sketches", {"id": operation["sketchId"], "revision_id": revision["id"], "title": f"{part['number']} / operation {operation['code']}", "asset_path": "generated://operation-sketch"})
        insert("operations", {"id": operation["id"], "revision_id": revision["id"], "code": operation["code"], "name": operation["name"], "setup": operation["setup"], "sketch_id": operation.get("sketchId")})
        for feature in part["features"]:
            guide_id = "guide-" + feature["id"] if feature.get("animationKey") else None
            if guide_id:
                insert("feature_guides", {"id": guide_id, "animation_key": feature["animationKey"], "zone": feature.get("zone", "Inspection")})
            insert("characteristics", {"id": feature["id"], "operation_id": operation["id"], "guide_id": guide_id, "number": feature["number"], "label": feature["label"], "type": feature["type"], "limit_type": feature.get("limitType", "bilateral"), "nominal": Decimal(str(feature["nominal"])), "tolerance_minus": Decimal(str(feature["toleranceMinus"])), "tolerance_plus": Decimal(str(feature["tolerancePlus"])), "unit": feature["unit"], "method": feature["method"], "datum": feature["datum"], "instruction": feature["instruction"], "sketch_ref": feature["sketchRef"], "critical": feature["critical"]})
        updates = {"status": revision["status"]}
        if "is_active" in revisions.c:
            requested_active = revision.get("isActive", revision["status"] == "released")
            already_active = session.scalar(sa.select(revisions.c.id).where(revisions.c.part_id == master_id, revisions.c.is_active.is_(True)))
            updates["is_active"] = bool(requested_active and revision["status"] == "released" and not already_active)
        session.execute(revisions.update().where(revisions.c.id == revision["id"]).values(**updates))


if __name__ == "__main__":
    with SessionLocal.begin() as session:
        seed(session)
    print("Synthetic example catalog ready; existing revisions retained.")
