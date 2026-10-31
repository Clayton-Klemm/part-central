# Example part families and inspection coverage

All names, dimensions, materials, revisions, and instructions in the demo fixture are synthetic educational examples. They are not approved requirements for an actual differential, fastener, pressure component, or other manufactured part.

The starter library has ten distinct active part numbers and 74 active inspection characteristics. Every active starter now has an operation sketch, a companion measurement-setup diagram, and a supported feature animation for every row. Each family has a different visual template; a manifold, shaft, and differential are never shown as the original dog clutch gear. Locally created active parts, including the additional DF-8100 differential, can receive the same visual enrichment from their exact saved requirements.

| Part | Family | Examples covered |
| --- | --- | --- |
| DG-1042 | Dog clutch gear | Dog height, ramp start, ramp angle, pitch circle, bore, face runout |
| DG-2080 | Transfer clutch gear | Alternate material/revision within a gear family |
| DG-3105 | Indexing clutch gear | Alternate gear release and separately versioned references |
| RD-4200 | Spacer ring | Outside diameter, bore, and thickness; revision B adds sketches and all three animated guides |
| DF-5200 | Differential carrier case | Bearing bore, ring-gear pilot, cross-pin bore, bolt circle, shoulder span, ligament, blind thread |
| BC-5300 | Split bearing cap | Assembled bore, crown wall, crown height, mounting centers, split-face flatness, blind thread |
| AF-5400 | Axle companion flange | Locating bore, flange thickness, bolt circle, counterbore, face runout, blind thread |
| SS-5500 | Stepped differential shaft | Ground journal, axial shoulders, radial step, keyway, pilot bore, axial thread, runout |
| MF-6100 | Hydraulic manifold block | Full-form thread depth, separate drilled floor, counterbore seat, intersecting ports, ligament, sealing face |
| PH-7200 | Pump bearing housing | Bearing pocket, locating spigot, flange, cavity wall, seal face, cover threads and counterbores |

The manifold illustrates revision handling: released **A** is inactive with a 16 mm minimum full-form thread depth; released **B** is active at 18 mm; draft **C** proposes 20 mm and is unavailable to operators. Each revision has new characteristic and operation IDs. This lets saved inspections retain their original definitions when another revision becomes active.

The ring retains its original instructions-only **A** as an inactive historical revision. **B** has unchanged dimensions and separate feature/operation IDs with ring-specific visuals. Existing A inspections stay pinned and can continue while new sheets use B. Optional references remain supported: the adoption tests explicitly remove visual metadata from a fixture and complete a job using written instructions alone.

## Thread depth is a separate requirement

The active manifold example specifies **18.000 mm minimum full-form thread depth**, **24.000 ± 0.300 mm drilled-hole floor depth**, and **3.000 ± 0.100 mm counterbore depth**. These are three different contact/reference planes. A minimum requirement accepts values at or above its limit; it does not acquire an invented finite upper tolerance.

The cutaway highlights the calibrated full-form plane and shows the gage lead extending farther into the available clearance. Its depth arrow never uses the physical gage tip or drill-point floor as the thread-depth datum. The surrounding shape and clearance are illustrative and not to scale; only the selected characteristic is dimensioned. The fixture does not define a universal insertion distance for a screw or thread gage.

An actual depth-reading instrument needs its approved zero/reference convention and any entry-face, lead, or first-full-thread correction. The tool manufacturer's instructions and controlled drawing determine that setup. Leitech describes a calibrated telescoping sleeve that contacts the face while its GO member verifies the thread; it also distinguishes usable functional thread depth from the drilled-hole depth. [Leitech thread-depth gage guidance](https://leitech.com/)

Thread size and GO/NO-GO acceptance are not modeled as a fake numeric diameter or a universal turn count. They remain separate approved-procedure checks in these sample instructions. The sample requires clean holes and light engagement and warns against forcing a gage against the blind-hole bottom.

## Interactive feature guides

The seven additional families now have their own local Three.js models alongside the original DG dog clutch: differential carrier, bearing cap, axle flange, stepped shaft, threaded manifold, bearing housing, and spacer ring. Drag to rotate, scroll or pinch to zoom, and select a numbered feature marker to update the highlighted surface and measurement guide. The expanded guide also offers a labeled feature selector.

Use **Fit part** to restore the complete view, **Focus** to center the selected measurement, **Top** for an overhead view, and **Section** to inspect internal bores and depth planes. Animations support pause and replay. Thread guides show the calibrated full-form plane, separate drill floor, and gauge lead; shaft guides distinguish radial shoulder height from diameter difference and show a journal runout sweep. Port-axis and mounting-hole spacing use separate contact locations.

The models are illustrative and **not to scale**. Their drawing coordinates explain measurement intent; the numeric value, unit, limit rule, and instructions in the inspection sheet and information panel come from the exact pinned feature requirement. Animation panes show feature callouts, highlights, and measurement paths without a nominal-value overlay. The bearing cap's assembled-bore requirement still needs its matched component and approved assembly/torque condition. Select **2D diagram** for the existing animated SVG guide; that guide also remains available when 3D rendering is unavailable. Reduced-motion preferences are respected.

This rendering update reuses the existing visual-family metadata and feature keys. Database schemas, released requirements, reference-edition IDs, stored assets, and historical inspection snapshots retain their existing definitions. The models and guides run in the browser using bundled code and require no external model service.

## Operation sketches and visual templates

`MechanicalOpSketch` uses the same family geometry for an interactive operation sheet: numbered callouts select the corresponding feature, and the drawing's requirement table uses that exact revision's values. Port-axis spacing and mounting-hole spacing use different locations in the manifold. The shaft runout indicator contacts the journal. Ring thickness, bore, and OD have separate locations.

`public/examples/` contains locally rendered SVG and PNG copies of the sketches and companion diagrams. The PNG copies are suitable for the normal administrator upload workflow; the SVG source remains reviewable. The renderer rejects a placeholder in place of a full drawing and escapes inserted SVG text.

The templates are a quick way to prepare an understandable feature reference during adoption. Production visuals still need comparison with approved CAD/sketches, verified feature anchors, and an approved measurement method. Uploaded diagrams can supplement or replace a template through the reference-version workflow.

`data/generate_examples.py` rebuilds the synthetic additions while preserving the original four part IDs. `data/demo.json` is the bundled/seed fixture; it does not overwrite released definitions already in a live database.

## Rebuild and publish local demonstration references

```powershell
python data/generate_examples.py
node scripts/render_example_visuals.mjs
python scripts/populate_example_visuals.py
# After reviewing the dry-run report, apply documentation through the local admin API:
python scripts/populate_example_visuals.py --apply
```

PNG generation uses the optional `sharp` development renderer: run `node scripts/render_example_visuals.mjs --png` with that module installed, or set `PARTCENTRAL_SHARP_MODULE` to its local module file. This dependency is only needed for rebuilding raster copies, not for running the application. `--render-discovered` on the import command also renders exact-current references for other active supported-family parts, such as a differential created through Part management. Their captured definitions are in `data/additional_visual_examples.json`; they are not added to the database seed.

The importer defaults to a dry run, targets a loopback server, reads the local administrator credential into memory, and never prints it. It verifies uploaded checksums, preserves already selected reference files, records an import report, and appends new documentation editions. Ring B activation preserves ongoing A sheets and verifies their reference snapshots. Repeating the import leaves complete references selected without publishing another version. Released dimensions, prior editions, and saved measurements are never rewritten by this process.

The completed local import verified **11 active parts**, **82 guided characteristics**, and **13 complete revision reference sets**. Six sampled historical inspections retained identical revision/reference snapshot hashes. Downloaded reference checksums matched their saved metadata. A second applied import found all 13 reference sets complete and left every documentation edition ID and version unchanged. See the [import report](visual-import-report.json), [idempotency report](visual-import-idempotency-report.json), and [historical snapshot and asset verification](visual-library-verification.json). These local counts include the administrator-created DF-8100 example; the portable starter fixture retains its ten seeded part numbers.
