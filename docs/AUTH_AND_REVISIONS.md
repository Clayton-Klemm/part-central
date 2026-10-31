# Employee sign-in and the part revision workflow

The application and its records remain on the local Docker server. Employee sessions, catalog changes, inspection records, and reference files do not require a cloud identity service or public hosting.

## Employee identification

Operators enter exactly four digits, preserving leading zeros. A normal employee number receives an operator role from the server. The local pilot accepts and enrolls valid numbers; typing a number identifies the person operating that workstation but does not prove that person's identity. Use an approved employee directory and stronger authentication before treating these records as regulated electronic signatures.

`0000` is reserved for the administrator account. It also requires the server's `ADMIN_TOKEN` credential. Knowing the public number alone does not permit catalog or document changes. An empty administrator credential disables administrator sign-in. The role is determined on the server and cannot be selected by sending a client-side role field.

Successful shared-server sign-in creates an eight-hour server session. The browser receives an HttpOnly, SameSite=Strict cookie; PostgreSQL stores a SHA-256 hash of its random token. Signing out revokes that session. A later login on the same browser replaces its previous session. HTTPS deployments can pass `SESSION_COOKIE_SECURE=true` into the API container to require Secure cookies; the local HTTP demo uses the loopback address.

Run and measurement records receive the signed-in employee number from the server. A client-supplied inspector name cannot impersonate another employee. Historical records created before employee identification remain explicitly unassigned instead of being attributed to a guessed employee.

State-changing browser requests must originate from the application's own origin. The proxy preserves the browser-facing host and port for this check. Local service clients can continue to use the server's administrator bearer credential; that credential must stay out of frontend bundles, logs, and source control.

## Continuing a job across days and shifts

Sign-in opens **Jobs & inspections** with no part selected. Search by job number
to continue an existing inspection, or open the part library to start a new job.
The recent list is a bounded page of recently started sheets; searching and
loading earlier pages finds older jobs without loading the entire archive.

Enter readings, select **1st shift (1)**, **2nd shift (2)**, or **Weekend (71)**, then choose **Save
readings**. The shift has no default at sign-in. Each saved reading records its
own shift, employee number from the session, and server time. The employee who
started the sheet and the employee who makes a later reading may differ.
Correcting a value appends an event; it never replaces the original attribution.
Saving several readings submits them sequentially. A failed request leaves the
acknowledged readings saved and the remaining edits unsaved.

Inspection tabs on a job show earlier samples with their revision and author /
shift. Completed sheets show their completion signer and shift. Open **Run
details** to inspect every individual reading and correction. **New inspection**
prepares the next sample using the active part revision while retaining the job
number. Starting it is an explicit action.

Complete a sheet only after its readings are saved. Completion records the
signed-in employee and selected shift separately from the sheet's creator.
Historical records whose shift was never captured show **Shift unrecorded**.
The system does not infer a shift from a timestamp or assign a guessed employee.
Existing third-shift (`3`) records remain readable with their original code;
the current selector and new server writes accept only `1`, `2`, and `71`.
CSV exports include recording and completion attribution; JSON includes the
complete event trail. Save or discard edits before switching sheets, signing
out, or exporting.

## Part, revision, and job are separate identities

| Identity | Meaning |
| --- | --- |
| Part number | The business identity, such as a differential carrier or threaded housing |
| Engineering revision | The exact requirements, operation setup, limits, instructions, and visual family |
| Reference version | An independently published set of optional sketches and diagrams |
| Job number | The work order grouping inspection sheets |
| Inspection run | One sample sheet pinned to a revision and reference version |

Only one released revision of a part can be active at a time. A part can also have no active revision while it is being prepared or taken out of use. Normal part lookup shows the active revision only; draft and inactive revisions stay in the administrator workspace. Existing job sheets continue to open their saved revision even after a newer one becomes active.

## Add a new part

1. Sign in as administrator `0000` using the server credential.
2. Open **Part management** and create the part number, name, initial revision code, material, finish, and operation.
3. Add inspection characteristics: method, datum, written instruction, unit, limit type, and nominal/tolerance values. Choose the critical characteristics explicitly.
4. Choose an available visual family for an illustrative feature guide, or leave visuals absent. Add operation sketches and supporting diagrams when ready.
5. Save and review the draft. Release requires at least one characteristic and completed material, operation setup, measurement methods, and instructions.
6. Release the reviewed revision, then make it active. The combined release-and-activate action is available when appropriate. Operators can now find it and start job sheets.

Missing sketches, diagrams, or animation do not prevent release when the required written inspection definition is complete. Generated visual templates are teaching aids, not certified CAD or an engineering approval.

## Add a new engineering revision

1. Select the existing part and copy a source revision into a new revision code.
2. Enter the change note and adjust its operation and characteristic requirements in the new draft.
3. Review the visual family and references for the new operation. A cloned requirement is not evidence that an old sketch is approved for the new revision; attach or publish the appropriate references.
4. Review and release the draft. Released requirements become read-only.
5. Make the new revision active when it is ready for operators. The server deactivates the earlier active revision in the same transaction. A database unique constraint prevents two simultaneous activations from exposing multiple active revisions.

Editing released requirements is rejected. Corrections require a new draft revision. Administrators can change which released revision is active without rewriting its requirements or historical inspections. Deactivating a revision stops it appearing in ordinary lookup and prevents starting a new sheet against that inactive definition; existing sheets remain pinned for their job history.

## Add or replace a visual reference

Operation sketches and diagrams are optional and can be published separately from engineering requirements. Administrator uploads accept bounded PDF, PNG, and JPEG files. Files are stored as immutable local assets with checksums; reference publication creates a new version. Existing sheets retain their saved version and original file links.

Two administrators cannot silently overwrite the same reference edition: publication includes the version opened by the editor, and a stale request receives a conflict. Workstation inspection edits similarly include an expected measurement sequence, so an unseen save from another workstation must be reviewed before the stale sheet is saved or completed.

## Blind-thread and gauge-depth examples

The sample library separates full thread depth, blind drilled-hole depth, counterbore depth, and tool/gauge travel. Those dimensions are not interchangeable. The full thread requirement comes from the approved drawing; a calibrated gauge's indicated travel must be interpreted using its own nose/lead geometry, datum, and manufacturer procedure. Do not infer accepted full-thread depth solely from the drill point or from an arbitrary count of screw turns.

A minimum-depth characteristic uses a one-sided lower limit rather than an invented large upper tolerance. A maximum characteristic uses an upper limit. Bilateral characteristics retain their two inclusive limits. Numeric depth acceptance alone does not certify the thread form, pitch-diameter class, or GO/NO-GO acceptance; those require the approved inspection procedure and appropriate gauges.

All example dimensions and drawings are synthetic. The generic thread guides illustrate measurement intent; a real gauge and part require approved engineering and metrology instructions. A manufacturer discussion of thread-gauge acceptance is available from [Glastonbury Southern Gage](https://www.gsgage.com/read-this-thread).

## Local workflow verification

Browser checks covered operator sign-in, protected administrator sign-in, creating and saving a new part draft, choosing its visual family, releasing and activating revision A, and saving a job against A. A copied revision B was then changed, released, and activated. A different operator saw B in normal part lookup, while the archived A sheet retained its original 68.000 requirement and saved passing result. The verification part and job are labeled synthetic examples on the local server.

Geometric magnitudes such as flatness and total runout are nonnegative quantities: a negative reading is retained as a failed event. Signed dimensional positions and angular values remain supported by their specified limits.
