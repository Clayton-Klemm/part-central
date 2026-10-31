# How the database connects

The shared-server version keeps its records in PostgreSQL. Browsers use the API
to read requirements and save inspections into that shared database. The GitHub
Pages demo is separate: its sample catalog is bundled with the app and its
inspection entries stay in each visitor's browser.

![Overview of the Part Central database](assets/database-overview.png)

[Open the vector diagram](assets/database-overview.svg).

## Follow one inspection

1. A **part** has engineering **revisions**. Each revision defines its machining
   **operations**, and each operation has **characteristics** to inspect.
2. A **job** groups its sample **inspection sheets** (`inspection_runs`). Each
   sheet pins the exact revision and operation it uses.
3. A **reading** (`measurements`) connects a sheet to one characteristic. It
   records the value, result, time, employee, and shift. A correction adds
   another reading, preserving the earlier event.
4. Optional sketches, diagrams, and feature guides explain the requirements.
   A sheet retains a copy of its reference bundle when it starts, so later
   documentation releases do not rewrite that sheet's references.

Released requirements, earlier reference editions, and measurement events are
protected from rewriting. Completing a sheet locks it with its completion
employee and shift. Historical authors or shifts that were never recorded
remain unknown.

## Table relationships

This map shows the 13 application tables and selected fields. `PK` identifies a
row; `FK` connects it to another table. A circle means optional, a single bar
means one, and a fork means many. Migration bookkeeping is omitted.

```mermaid
erDiagram
    parts ||--o{ part_revisions : has
    part_revisions ||--o{ operations : defines
    part_revisions ||--o{ operation_sketches : owns
    operation_sketches o|--o{ operations : supplies_sketch
    operations ||--o{ characteristics : requires
    feature_guides o|--o| characteristics : optionally_explains

    jobs ||--o{ inspection_runs : groups
    part_revisions ||--o{ inspection_runs : pins
    operations ||--o{ inspection_runs : scopes
    inspection_runs ||--o{ measurements : records
    characteristics ||--o{ measurements : evaluates

    employees ||--o{ employee_sessions : has
    employees o|--o{ inspection_runs : starts
    employees o|--o{ inspection_runs : signs_completion
    employees o|--o{ measurements : records

    operations ||--o{ reference_assets : owns
    operations ||--o{ operation_reference_versions : documents
    reference_assets o|--o{ operation_reference_versions : supplies_sketch
    reference_assets o|--o{ operation_reference_versions : supplies_diagram
    operation_sketches o|--o{ operation_reference_versions : supplies_builtin_sketch

    parts {
        string id PK
        string number UK
        string name
    }
    part_revisions {
        string id PK
        string part_id FK
        string code
        string status
        boolean is_active
    }
    operations {
        string id PK
        string revision_id FK
        string sketch_id FK "Optional; same revision"
        string code
    }
    operation_sketches {
        string id PK
        string revision_id FK
        string asset_path
    }
    characteristics {
        string id PK
        string operation_id FK
        string guide_id FK, UK "Optional"
        int number
        decimal nominal
    }
    feature_guides {
        string id PK
        string animation_key
        string zone
    }
    jobs {
        string id PK
        string number UK
    }
    inspection_runs {
        string id PK
        string job_id FK
        string revision_id FK
        string operation_id FK "Paired with revision_id"
        string employee_number FK "Optional legacy starter"
        string completed_by_employee_number FK "Optional completion signer"
        string sample_number
        string status
        json references_snapshot "Copied reference bundle"
    }
    measurements {
        string id PK
        string run_id FK
        string feature_id FK
        string employee_number FK "Optional legacy author"
        int sequence "Unique within its sheet"
        decimal value
        string shift
    }
    employees {
        string number PK
        string display_name
        string role
    }
    employee_sessions {
        string token_hash PK
        string employee_number FK
        datetime expires_at
    }
    reference_assets {
        string id PK
        string operation_id FK
        string kind
        string storage_key UK
        string sha256
    }
    operation_reference_versions {
        string id PK
        string operation_id FK
        int version
        string sketch_asset_id FK "Optional"
        string diagram_asset_id FK "Optional"
        string builtin_sketch_id FK "Optional"
    }
```

The operation/revision pair on a sheet is enforced together. An operation's
built-in sketch must also belong to that operation's revision. Uploaded assets
and published reference editions are checked against their owning operation.
The optional guide is unique to a characteristic.

`references_snapshot` is a JSON copy, not a foreign key to an edition. The map
therefore does not draw a relational link from a sheet to a reference edition.
Reference file bytes live in a separate persistent volume; `reference_assets`
keeps their metadata and checksum. Sample labels can repeat; the sheet's `id`
is its unique identity.

For implementation details, see the [architecture](ARCHITECTURE.md),
[engineering design notes](DATABASE_PROOF.md), and
[verification evidence](VERIFICATION.md).
