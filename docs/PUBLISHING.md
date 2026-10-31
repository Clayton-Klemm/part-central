# Publish the browser demonstration

GitHub Pages serves the static React application with synthetic part definitions,
illustrations, and browser-local inspection entry. It does not host the API,
PostgreSQL, administrator uploads, or shared records across devices.

## Initial setup

1. Review the files to be committed. Keep `.env`, local tools, inspection
   databases, uploaded references, backups, and scratch output ignored. The
   maintained verification scripts and reviewed evidence belong in the source
   repository.
2. Push the reviewed source to the repository's `main` branch.
3. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
4. In **Actions → Publish browser demo → Run workflow**, select `main` and
   enable **Explicitly publish the synthetic browser demo**.
5. Wait for the build and deployment to succeed. Use the returned deployment
   URL as the repository's website link.

The workflow tests the frontend, explicitly selects `VITE_DATA_MODE=demo`, and
uses GitHub Pages' configured base path. Project sites, user sites, and custom
domains therefore use the correct asset paths without editing the workflow.
The uploaded site artifact contains only `dist/`.

## Subsequent releases

Push the reviewed changes, confirm the **Verify** checks pass, then run the
publishing workflow again with its publication input enabled. Publication stays
manual so routine local development never exposes a new build automatically.

For a local subdirectory check in PowerShell:

```powershell
$env:VITE_DATA_MODE = 'demo'
$env:VITE_BASE_PATH = '/part-central/'
npm run build
npm run preview
```

Open the printed preview URL including `/part-central/`. These variables apply
only to that shell session; remove them or start a fresh shell for other builds.

## Presenting at work

Use a sample employee number such as **1234**. Open **Part library**, select an
example, and explore its requirements, drawings, and interactive feature guide.
Start a clearly labeled demo job, choose a shift, and save a reading to show
traceability. Entries stay in that browser; use the local Docker system to
demonstrate a shared database or administrator workflows.
