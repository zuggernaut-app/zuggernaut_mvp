# Contributing

Quick guardrails before sharing code (solo or team).

## Before every push — checklist

Review **what changed**, not the whole repo.

1. Inspect the diff: `git diff` (and staged: `git diff --cached`).
2. Confirm secrets are not staged: no `**/`.env`** files (unless `*.example` / documented templates).
3. If you touched **Temporal**, smoke test once: `backend/` → `temporal:up`, `temporal:worker`, and a real scrape when feasible. **Use the same `MONGODB_URI` in `backend/.env` for the API (`npm start`) and the worker (`npm run temporal:worker`)** so activities can load `ScrapeRun` / `BusinessContext` rows created by the API.
4. If you touched **Mongo / models / seed**, run `npm run seed:test` — only against a DB you intend to mutate.
5. Run linters/tests when they exist (`backend`/`frontend` `npm test` paths will grow over time).

## Automated check (optional but recommended)

From the **repository root**:

```powershell
npm run check:before-push
```

Fails the process if staged files include disallowed secret/env filenames (blocks accidents like `git add -f .env`). It does **not** replace reading your own diff.

## Install a local pre-push hook (optional)

Registers Git hooks from this repo’s `.githooks/` folder (runs the same Node check on `git push`):

```powershell
git config core.hooksPath .githooks
```

To disable:

```powershell
git config --unset core.hooksPath
```

**Note:** `prepublishOnly`/`prepublish` in npm are for **npm publish**, not Git push — we use **`check:before-push`** + hooks instead.

## Version tags

Semantic-style tags (`v0.1.0`, `v0.2.0`, …) for milestones are fine; bump **minor** for visible feature slices (Temporal stack, onboarding API, …).
