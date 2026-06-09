# Dev Tools

Non-production development utilities for Zuggernaut MVP: integration diagnostics, OAuth labs, debug/trace scripts, and manual test evidence.

## Layout

- `backend/api/v1/` — dev-only API routes (`/api/v1/dev/integrations`)
- `backend/lib/dev/` — diagnostic helpers, OAuth labs, flow traces
- `backend/services/dev/` — diagnostic and resource-selection services
- `backend/scripts/` — one-off debug and trace CLI scripts
- `backend/tests/` — tests for dev/diagnostic code (run via `npm test` in `backend/`)
- `backend/constants/` — constants used only by dev diagnostics
- `frontend/src/pages/dev/` — dev integration UI pages
- `frontend/src/api/dev/` — frontend API clients for dev routes
- `docs/` — checklists, evidence, and remediation notes (not executable tests)

## Usage

- Enable dev integrations: set `ENABLE_INTEGRATION_DIAGNOSTICS=true` (see backend env docs).
- Backend debug scripts: run from `backend/` via `npm run debug:*` (paths point here).
- Frontend dev pages: available at `/dev/integrations/*` when dev integrations are enabled.
- Frontend dev page tests: co-located under `dev-tools/frontend/src/pages/dev/*.test.tsx` (excluded from default `npm test`; run via backend/jest for API coverage).

Production code in `backend/` and `frontend/src/` imports this tree only through explicit bridge paths (e.g. API router mount, frontend router).
