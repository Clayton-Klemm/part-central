"""Rebuild the synthetic example additions without changing the original four IDs.

This fixture is educational. Its dimensions are not production specifications.
"""
import copy
import json
from pathlib import Path

PATH = Path(__file__).with_name("demo.json")


def feature(label, nominal, minus, plus, key, method, datum, instruction, *, limit="bilateral", critical=False, kind="dimensional", zone="Machined geometry"):
    return dict(label=label, type=kind, nominal=nominal, toleranceMinus=minus, tolerancePlus=plus,
                unit="mm", method=method, datum=datum, instruction=instruction, sketchRef="",
                animationKey=key, zone=zone, critical=critical, limitType=limit)


def thread(label, depth, designation, datum="A"):
    return feature(label, depth, 0, 0, "thread-depth", "Calibrated thread-depth GO gage", datum,
        f"Synthetic example: {designation}, {depth:.3f} mm minimum full-form thread depth from datum {datum}. "
        "Use the approved thread-depth GO gage and its calibrated entry-face/first-full-thread correction. "
        "Compare the indicated full-form thread plane with this requirement; the gage lead and the drilled-hole floor are different references. "
        "Use light hand engagement, keep the hole clean, and never force the gage against the blind-hole bottom. "
        "A random screw, overall gage-tip travel, or an assumed number of turns does not establish this depth. "
        "Thread size acceptance and NO-GO checks follow the separate approved inspection procedure.",
        limit="minimum", critical=True, zone="Threaded features")


def drilled(depth):
    return feature("Blind drilled-hole floor depth", depth, .3, .3, "drill-depth", "Depth micrometer / approved floor probe", "A",
        f"Measure {depth:.3f} mm to the drilled-hole floor from entry face A using the approved probe and contact geometry. "
        "This example explicitly references the floor at the drill point. Do not substitute full-diameter drill depth, tap travel, or full-form thread depth. "
        "Confirm the drawing's depth convention before production use.", zone="Threaded features")


def maximum(label, value, key, method, datum, instruction):
    return feature(label, value, 0, 0, key, method, datum, instruction, limit="maximum", kind="geometric")


def part(number, name, family, material, finish, features, *, revision="A", op="030", setup="", note="Synthetic initial release."):
    stem = number.lower().replace("-", "")
    revision_stem = f"{stem}-{revision.lower()}"
    for index, item in enumerate(features, 1):
        item.update(id=f"f-{revision_stem}-{index:02d}", number=index, sketchRef=f"{index:02d}")
    return {
        "id": f"p-{stem}", "number": number, "name": name,
        "description": "Synthetic inspection example with illustrative geometry; not an approved manufacturing definition.",
        "material": material, "finish": finish,
        "revision": {"id": f"rev-{revision_stem}", "code": revision, "status": "released", "releasedAt": "2026-10-01T14:00:00Z", "isActive": True, "geometryFamily": family, "changeNote": note},
        "operation": {"id": f"op-{revision_stem}-{op}", "code": op, "name": "Finish machining", "setup": setup or "Follow the approved job traveler. Datum A is the finished seating face; datum B is the primary bore axis.", "sketchId": None},
        "features": features,
        "references": {"id": None, "version": 0, "sketch": None, "diagram": None, "geometryFamily": family, "modelAvailable": True, "notes": "Illustrative visual template. Use controlled engineering documents for production."},
    }


def build():
    data = json.loads(PATH.read_text(encoding="utf-8"))
    originals = [p for p in data["parts"] if p["number"] in {"DG-1042", "DG-2080", "DG-3105", "RD-4200"}]
    for item in originals:
        family = "dog-clutch" if item["number"].startswith("DG-") else "ring"
        item["revision"].update(isActive=True, geometryFamily=family, changeNote="Existing synthetic demonstration revision.")
        if item.get("references"):
            item["references"]["geometryFamily"] = family
        for row in item["features"]:
            row.setdefault("limitType", "bilateral")

    # The original no-visual ring remains an immutable historical example.
    # Its visual enrichment is a new engineering revision, never an in-place edit.
    ring_index = next(index for index, item in enumerate(originals) if item["number"] == "RD-4200")
    existing_ring = originals[ring_index]
    ring_history = copy.deepcopy(next((item for item in data.get("revisionExamples", []) if item["number"] == "RD-4200" and item["revision"]["code"] == "A"), existing_ring))
    ring_history["revision"]["isActive"] = False
    ring_history["references"] = {"id": None, "version": 0, "sketch": None, "diagram": None, "geometryFamily": "ring", "modelAvailable": False, "notes": "Historical instructions-only revision. References were added in revision B."}
    ring_history["operation"]["sketchId"] = None
    for row in ring_history["features"]:
        row["animationKey"] = None
    ring = copy.deepcopy(existing_ring)
    ring["revision"].update(id="rev-rd4200-b", code="B", isActive=True, releasedAt="2026-10-26T14:00:00Z", changeNote="Adds synthetic operation sketch and feature animation references. Dimensional requirements unchanged from revision A.")
    ring["operation"]["id"] = "op-rd4200-b-020"
    for index, (row, key) in enumerate(zip(ring["features"], ["outside-diameter", "bore-diameter", "flange-thickness"]), 1):
        row.update(id=f"f-rd4200-b-{index:02d}", animationKey=key, sketchRef=f"{index:02d}")
    originals[ring_index] = ring

    differential = part("DF-5200", "Differential carrier case", "differential-case", "QT450 ductile iron", "Finish bored / deburred", [
        feature("Bearing journal bore", 68, 0, .025, "bearing-bore", "Three-point bore micrometer", "B", "Measure the bearing bore at two axial planes and perpendicular orientations, clear of the entry chamfer. Verify every required reading." , critical=True),
        feature("Ring-gear locating pilot", 112, .025, .025, "outside-diameter", "Outside micrometer", "B", "Measure the cylindrical locating pilot about datum axis B, clear of the shoulder radius."),
        maximum("Ring-gear face runout", .04, "face-runout", "Dial indicator / rotary fixture", "B", "Locate the carrier on datum axis B. Sweep the mounting face through one revolution and record total indicator reading, not a single height."),
        feature("Differential cross-pin bore", 20, 0, .018, "bore-diameter", "Bore gage / approved pin routine", "C", "Inspect the cross-pin bore in both accessible windows. Verify its size independently from its location to the bearing axis."),
        feature("Bearing shoulder span", 142, .05, .05, "overall-length", "CMM / length comparator", "A", "Measure between the two finished bearing shoulder planes along the primary axis. Avoid casting and corner reliefs."),
        feature("Ring-gear bolt circle", 96, .08, .08, "bolt-circle", "CMM bolt-pattern routine", "B", "Fit the approved bolt-hole pattern about axis B. Report the pitch-circle diameter; hole size and positional error are separate characteristics."),
        thread("M10 mounting thread full-form depth", 18, "M10 × 1.5-6H"),
        feature("Window ligament thickness", 6, 0, 0, "wall-thickness", "CMM / ball micrometer", "A", "Check the minimum ligament at the indicated carrier window. Record the lowest required reading, with the approved access method.", limit="minimum"),
    ])
    cap = part("BC-5300", "Split bearing cap", "bearing-cap", "42CrMo4 steel", "Quenched / tempered", [
        feature("Assembled bearing bore", 62, 0, .021, "bearing-bore", "Bore gage in approved assembled fixture", "B", "Inspect the bore only with its matched cap and approved assembly/torque condition. Do not infer the assembled diameter from the loose semicircle.", critical=True),
        feature("Mounting-hole center distance", 80, .04, .04, "hole-spacing", "CMM / center-distance fixture", "B", "Measure between the fitted mounting-hole axes. Do not substitute the distance between their nearest edges."),
        feature("Crown height", 42, .03, .03, "shoulder-height", "Height gage", "A", "Seat both split-plane feet on datum A and measure the indicated finished crown, clear of the edge break."),
        feature("Crown wall thickness", 8, 0, 0, "wall-thickness", "Ball micrometer / CMM", "B", "Measure minimum wall between the finished bore and crown using the approved contact locations.", limit="minimum"),
        thread("M12 retaining thread full-form depth", 22, "M12 × 1.75-6H"),
        drilled(28),
        maximum("Split-face flatness", .025, "flatness", "Surface plate / indicator sweep", "A", "Evaluate the complete specified split face with the approved flatness method. A flatness requirement is independent of a datum orientation."),
    ])
    flange = part("AF-5400", "Axle companion flange", "flange", "4140 alloy steel", "Machined / induction hardened pilot", [
        feature("Flange outside diameter", 138, .05, .05, "outside-diameter", "Outside micrometer", "B", "Measure the flange OD in perpendicular orientations, clear of the outer chamfer."),
        feature("Bearing locating bore", 52, 0, .018, "bearing-bore", "Three-point bore micrometer", "B", "Inspect the finished locating bore at the approved depths and angular positions.", critical=True),
        feature("Flange thickness", 12, .03, .03, "flange-thickness", "Outside micrometer", "A", "Measure between the seating and outer flange faces, away from the hub and bolt holes."),
        feature("Mounting bolt-circle diameter", 104, .08, .08, "bolt-circle", "CMM bolt-pattern routine", "B", "Fit the four mounting-hole axes to the specified pitch circle, referenced to the locating bore axis."),
        thread("M10 fixing thread full-form depth", 16, "M10 × 1.5-6H"),
        feature("Bolt counterbore depth", 3, .1, .1, "counterbore-depth", "Depth micrometer", "A", "Bridge entry face A and contact the annular flat counterbore seat. Do not contact the chamfer or the deeper threaded bore."),
        maximum("Flange face runout", .04, "face-runout", "Dial indicator / rotary fixture", "B", "Rotate about the approved locating axis and record maximum minus minimum indicator reading on the indicated annular face."),
    ])
    shaft = part("SS-5500", "Stepped differential shaft", "shaft", "4340 alloy steel", "Ground journals / shot peened reliefs", [
        feature("Bearing journal diameter", 35, .016, 0, "outside-diameter", "Outside micrometer", "B", "Measure the ground journal at two axial planes and perpendicular orientations. Keep clear of the relief and fillet.", critical=True),
        feature("Bearing shoulder spacing", 44, .05, .05, "hole-spacing", "CMM / length comparator", "A", "Measure axially between the indicated finished shoulders, using the controlled drawing's face definitions."),
        feature("Overall shaft length", 168, .1, .1, "overall-length", "Length comparator", "A", "Measure between the finished end planes, excluding center holes and edge breaks."),
        feature("Shoulder radial step", 8, .025, .025, "shoulder-height", "CMM / radial step routine", "B", "Evaluate the radial step between the two coaxial journal surfaces. Do not confuse radial height with the difference of the full diameters."),
        feature("Keyway width", 8, 0, .036, "slot-width", "Blade micrometer / slot gage", "C", "Inspect the straight keyway flanks above the cutter radius, at the prescribed axial positions."),
        feature("Axial pilot bore", 12, 0, .02, "bore-diameter", "Bore gage", "B", "Measure the axial pilot bore clear of its chamfer; its diameter is separate from its depth."),
        thread("M8 axial thread full-form depth", 20, "M8 × 1.25-6H"),
        maximum("Journal total runout", .02, "face-runout", "Indicator / approved center fixture", "B", "Use the approved journal runout setup and sweep the required journal length. Follow the controlled procedure for total runout evaluation."),
    ])
    manifold = part("MF-6100", "Hydraulic manifold block", "threaded-block", "6061-T6 aluminum", "Machined / cleaned before coating", [
        thread("M10 port full-form thread depth", 18, "M10 × 1.5-6H"),
        drilled(24),
        feature("Port counterbore depth", 3, .1, .1, "counterbore-depth", "Depth micrometer", "A", "Zero on entry face A, then contact the counterbore's flat annular seat. The seat, full-form thread plane, and drill floor are distinct levels.", zone="Threaded features"),
        feature("Cross-port bore diameter", 12, 0, .025, "bore-diameter", "Bore gage", "B", "Check the machined cross-port diameter at accessible approved stations, keeping the contact clear of intersecting holes."),
        feature("Port center distance", 36, .05, .05, "hole-spacing", "CMM axis-to-axis routine", "B", "Measure the distance between the two specified fitted port axes, not between visible thread crests."),
        feature("Block overall width", 96, .08, .08, "overall-length", "Outside micrometer", "A", "Measure between the finished opposing side faces at the approved locations."),
        feature("Port ligament thickness", 5, 0, 0, "wall-thickness", "Approved CMM / ultrasonic procedure", "B", "Check the minimum remaining material between intersecting ports and the outside wall using the validated access method.", limit="minimum", critical=True),
        maximum("Seal-face flatness", .03, "flatness", "Surface plate / indicator sweep", "A", "Evaluate the full defined seal face with the approved flatness method. Do not treat a single high point as the flatness result."),
        feature("Mounting-hole center distance", 64, .1, .1, "hole-spacing", "CMM center-distance routine", "C", "Fit the mounting-hole axes and report their center distance in the specified mounting direction."),
    ], revision="B", op="040", note="Rev B increases required full-form port thread depth from 16 to 18 mm and drill-floor depth from 22 to 24 mm.")
    housing = part("PH-7200", "Pump bearing housing", "housing", "A356-T6 aluminum casting", "Machined bearing and sealing interfaces", [
        feature("Bearing pocket diameter", 72, 0, .025, "bearing-bore", "Three-point bore micrometer", "B", "Measure the finished bearing pocket at the prescribed depths and angular positions, clear of the shoulder radius.", critical=True),
        feature("Locating spigot diameter", 104, .04, .04, "outside-diameter", "Outside micrometer", "B", "Measure the machined locating spigot rather than the surrounding cast surface."),
        feature("Mounting-flange thickness", 14, .04, .04, "flange-thickness", "Outside micrometer", "A", "Measure the finished flange between the indicated parallel planes, avoiding ribs and bolt bosses."),
        feature("Cavity wall thickness", 5, 0, 0, "wall-thickness", "Approved ultrasonic / CMM method", "B", "Check the minimum specified wall around the housing cavity; casting ribs are not the measurement location.", limit="minimum"),
        maximum("Sealing-face flatness", .03, "flatness", "Surface plate / indicator sweep", "A", "Evaluate the defined machined sealing face with the approved flatness method."),
        thread("M8 cover thread full-form depth", 14, "M8 × 1.25-6H"),
        feature("Cover bolt counterbore depth", 4, .1, .1, "counterbore-depth", "Depth micrometer", "A", "Contact the flat bolt-seat annulus below the machined entry face, excluding the chamfer."),
        feature("Cover-hole center distance", 70, .05, .05, "hole-spacing", "CMM hole-pattern routine", "B", "Measure the distance between the indicated fitted cover-hole axes using the approved datum alignment."),
    ])
    historical = copy.deepcopy(manifold)
    historical["revision"].update(id="rev-mf6100-a", code="A", isActive=False, releasedAt="2026-08-01T14:00:00Z", changeNote="Historical example: 16 mm minimum full-form thread depth. Retained for previous job records.")
    draft = copy.deepcopy(manifold)
    draft["revision"].update(id="rev-mf6100-c", code="C", status="draft", isActive=False, releasedAt=None, changeNote="Draft proposal: 20 mm minimum full-form thread depth; not visible to operators until reviewed and activated.")
    for revision, thread_depth, floor in [(historical, 16, 22), (draft, 20, 26)]:
        code = revision["revision"]["code"].lower()
        revision["operation"]["id"] = f"op-mf6100-{code}-040"
        revision["features"][0].update(thread("M10 port full-form thread depth", thread_depth, "M10 × 1.5-6H"))
        revision["features"][1].update(drilled(floor))
        for index, row in enumerate(revision["features"], 1):
            row.update(id=f"f-mf6100-{code}-{index:02d}", number=index, sketchRef=f"{index:02d}")
    data["parts"] = originals + [differential, cap, flange, shaft, manifold, housing]
    data["revisionExamples"] = [historical, draft, ring_history]
    for item in [*data["parts"], historical, draft]:
        code = item["revision"]["code"]
        sketch_id = f"SK-{item['number'].replace('-', '')}-{item['operation']['code']}-{code}"
        item["operation"]["sketchId"] = sketch_id
        item["references"] = {
            "id": None, "version": 0, "geometryFamily": item["revision"]["geometryFamily"],
            "sketch": {"id": sketch_id, "name": f"{item['number']} revision {code} synthetic operation sketch", "mediaType": "application/x-partcentral-sketch", "url": None, "sha256": None},
            "diagram": {"id": f"DIAGRAM-{item['number']}-{code}", "name": f"{item['number']} revision {code} measurement setup diagram", "mediaType": "image/svg+xml", "url": f"examples/{item['number']}-{code}-diagram.svg", "sha256": None},
            "modelAvailable": True, "notes": "Complete synthetic visual example. Illustrative geometry, not to scale; use controlled engineering documents for production.",
        }
    data["fixtureNotice"] = "All part identities, dimensions, revisions, and visual templates in this file are synthetic educational examples. They are not approved manufacturing requirements."
    temporary = PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(PATH)


if __name__ == "__main__":
    build()
