"""Publish local synthetic visual references through the normal admin APIs.

Default is a dry run. --apply creates immutable documentation editions. The
historical instructions-only RD-4200 A is retained; B adds its guide keys without
changing its dimensions. No released definition or saved run is overwritten.
"""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MARKER = "synthetic-visual-pack:v1"
FEATURE_KEYS = ("id", "number", "label", "type", "nominal", "toleranceMinus", "tolerancePlus", "limitType", "unit", "method", "datum", "instruction", "sketchRef", "animationKey", "zone", "critical")


def same_requirements(actual, expected):
    keys = ("number", "label", "nominal", "toleranceMinus", "tolerancePlus", "unit")
    return len(actual) == len(expected) and all(all(row[key] == source[key] for key in keys) for row, source in zip(actual, expected))


def credential():
    value = os.getenv("ADMIN_TOKEN")
    if value:
        return value
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("ADMIN_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("The local administrator credential is not configured.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Publish reviewed synthetic documentation editions")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--report", default="docs/visual-import-report.json")
    parser.add_argument("--render-discovered", action="store_true", help="Render exact-current SVG/PNG references for other active supported-family parts (requires Node.js and optional sharp renderer)")
    args = parser.parse_args()
    parsed = urlsplit(args.base_url)
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.scheme not in {"http", "https"}:
        raise SystemExit("This local fixture import only targets a loopback server.")
    token = credential()

    def api(route, body=None, *, method=None, raw=None, mime="application/json"):
        request = Request(args.base_url.rstrip("/") + "/api" + route,
            data=raw if raw is not None else json.dumps(body).encode() if body is not None else None,
            method=method or ("POST" if body is not None or raw is not None else "GET"),
            headers={"Authorization": f"Bearer {token}", "Content-Type": mime})
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read())

    fixture = json.loads((ROOT / "data/demo.json").read_text(encoding="utf-8"))
    examples = [*fixture["parts"], *[part for part in fixture["revisionExamples"] if part.get("references", {}).get("modelAvailable")]]
    report = {"apply": args.apply, "localServer": args.base_url, "marker": MARKER, "items": []}
    known = {example["number"] for example in examples}
    additional = []
    offset = 0
    while True:
        catalog = api("/parts?" + urlencode({"limit": 50, "offset": offset}))
        for summary in catalog:
            if summary["number"] not in known:
                current = api("/parts/" + quote(summary["number"]))
                if current["revision"].get("geometryFamily") in {"dog-clutch", "differential-case", "bearing-cap", "flange", "shaft", "threaded-block", "housing", "ring"}:
                    # The captured engineering values are used verbatim, never made up.
                    additional.append(current)
        if len(catalog) < 50:
            break
        offset += 50
    if additional:
        supplemental = ROOT / "data/additional_visual_examples.json"
        supplemental.write_text(json.dumps({"parts": additional, "revisionExamples": [], "fixtureNotice": "Exact-current definitions captured from this local synthetic demo for visual rendering. Not added to the database seed."}, indent=2) + "\n", encoding="utf-8")
        report["additionalActiveParts"] = [example["number"] for example in additional]
        if args.render_discovered:
            subprocess.run(["node", "scripts/render_example_visuals.mjs", "--png", "--data", str(supplemental)], cwd=ROOT, check=True)
        examples.extend(additional)

    def save_report():
        (ROOT / args.report).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    def ring_revision(example, catalog):
        revisions = catalog["revisions"]
        target = next((revision for revision in revisions if revision["code"] == "B"), None)
        active = next((revision for revision in revisions if revision.get("isActive")), None)
        source = next((revision for revision in revisions if revision["code"] == "A"), None)
        if target and target["status"] == "released" and target.get("isActive"):
            return target
        if not source or not active or active["code"] != "A":
            raise RuntimeError("RD-4200 activation differs from the original fixture; review its revision workflow manually.")
        source_detail = api(f"/admin/catalog/revisions/{quote(source['id'])}")
        if not same_requirements(source_detail["features"], example["features"]):
            raise RuntimeError("RD-4200 A differs from the original synthetic requirements; review it manually.")
        offset = 0
        open_sheets = []
        while True:
            rows = api("/runs?" + urlencode({"summary": "true", "partRevisionId": source["id"], "limit": 100, "offset": offset}))
            open_sheets.extend(row for row in rows if row["status"] == "draft")
            if len(rows) < 100:
                break
            offset += 100
        if not args.apply:
            report["ringRevisionTransition"] = {"historicalRevision": "A", "newRevision": "B", "openHistoricalSheetsRetained": len(open_sheets), "policy": "New sheets use B. Existing A sheets continue against their pinned requirements and reference snapshots."}
            save_report()
            return target
        snapshots = {row["id"]: api(f"/runs/{quote(row['id'])}").get("references") for row in open_sheets}
        if target is None:
            detail = api("/admin/catalog/parts/RD-4200/revisions", {"code": "B", "sourceRevisionId": source["id"], "changeNote": example["revision"]["changeNote"]})
            target = detail["revision"]
        else:
            detail = api(f"/admin/catalog/revisions/{quote(target['id'])}")
        if not same_requirements(detail["features"], example["features"]):
            raise RuntimeError("RD-4200 B has separately edited requirements; review its activation manually.")
        if target["status"] == "draft":
            # Never claim an unrelated administrator's draft merely because its code is B.
            if detail["revision"].get("changeNote") != example["revision"]["changeNote"]:
                raise RuntimeError("RD-4200 B is a separately edited draft. Review it manually before importing visuals.")
            features = []
            for row, desired in zip(detail["features"], example["features"]):
                feature = {key: row[key] for key in FEATURE_KEYS if key in row}
                feature["animationKey"] = desired["animationKey"]
                features.append(feature)
            api(f"/admin/catalog/revisions/{quote(target['id'])}", {"material": detail["material"], "finish": detail["finish"], "geometryFamily": "ring", "changeNote": example["revision"]["changeNote"], "operation": {key: detail["operation"][key] for key in ("code", "name", "setup")}, "features": features}, method="PUT")
            api(f"/admin/catalog/revisions/{quote(target['id'])}/release", {"activate": False})
        api(f"/admin/catalog/revisions/{quote(target['id'])}/active", {"active": True})
        unchanged = all(api(f"/runs/{quote(identifier)}").get("references") == snapshot for identifier, snapshot in snapshots.items())
        report["ringRevisionTransition"] = {"historicalRevision": "A", "newRevision": "B", "openHistoricalSheetsRetained": len(open_sheets), "historicalSnapshotsUnchanged": unchanged, "policy": "New sheets use B. Existing A sheets continue against their pinned requirements and reference snapshots."}
        save_report()
        if not unchanged:
            raise RuntimeError("A historical reference snapshot unexpectedly changed. Stop and investigate before any further import.")
        return target

    for example in examples:
        number, code = example["number"], example["revision"]["code"]
        catalog = api(f"/admin/catalog/parts/{quote(number)}")
        target = ring_revision(example, catalog) if number == "RD-4200" else next((revision for revision in catalog["revisions"] if revision["code"] == code), None)
        if target is None:
            report["items"].append({"part": number, "revision": code, "action": "would prepare ring B before documentation"})
            save_report()
            continue
        detail = api(f"/admin/catalog/revisions/{quote(target['id'])}")
        if not same_requirements(detail["features"], example["features"]):
            report["items"].append({"part": number, "revision": code, "action": "skipped: engineering definition differs from the synthetic fixture"})
            save_report()
            continue
        operation = detail["operation"]["id"]
        current = api(f"/admin/operations/{quote(operation)}/references")
        before = {"version": current["version"], "sketchId": (current.get("sketch") or {}).get("id"), "diagramId": (current.get("diagram") or {}).get("id")}
        identifiers = {}
        changed = not current["modelAvailable"]
        preserve_custom = current["version"] > 0 and MARKER not in current.get("notes", "")
        for kind in ("sketch", "diagram"):
            asset = current.get(kind)
            file = ROOT / "public/examples" / f"{number}-{code}-{kind}.png"
            if not file.is_file():
                raise RuntimeError(f"Missing local reference {file.name}. Run this import with --render-discovered and the optional local PNG renderer configured.")
            content = file.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            # Retain every already selected reference, including custom uploads.
            # Repeated imports fill omissions; they never replace an admin's files.
            if asset:
                identifiers[kind] = asset["id"]
                continue
            changed = True
            if args.apply:
                uploaded = api(f"/admin/operations/{quote(operation)}/assets?" + urlencode({"kind": kind, "filename": file.name}), raw=content, mime="image/png")
                if uploaded.get("sha256") != digest:
                    raise RuntimeError("The uploaded synthetic reference checksum differs from its local source.")
                identifiers[kind] = uploaded["id"]
        item = {"part": number, "revision": code, "operationId": operation, "before": before, "preservedCustomAssets": preserve_custom, "action": "already complete" if not changed else "publish documentation edition" if args.apply else "would publish documentation edition"}
        if args.apply and changed:
            notes = current.get("notes", "")
            if MARKER not in notes:
                notes = f"{notes}\n{MARKER}: local synthetic operation sketch and measurement-setup diagram. Illustrative geometry, not to scale; not a controlled manufacturing drawing.".strip()
            after = api(f"/admin/operations/{quote(operation)}/references", {"expectedVersion": current["version"], "sketchAssetId": identifiers.get("sketch"), "diagramAssetId": identifiers.get("diagram"), "modelAvailable": True, "notes": notes})
            item["after"] = {"version": after["version"], "sketchId": after["sketch"]["id"], "diagramId": after["diagram"]["id"]}
        report["items"].append(item)
        save_report()
    destination = ROOT / args.report
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"applied": args.apply, "items": len(report["items"]), "actions": {action: sum(item["action"] == action for item in report["items"]) for action in sorted({item["action"] for item in report["items"]})}, "report": str(destination)}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        raise SystemExit(f"Local API returned HTTP {error.code}; no administrator credential is included in this message.") from None
