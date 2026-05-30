# Manual E2E Checklist (V1 Setup Run)

Use this checklist for local sandbox verification before real customers.

## Prerequisites

- [ ] MongoDB reachable (`MONGODB_URI` set; tests use in-memory Mongo automatically)
- [ ] Backend running (`npm start` in `backend/`, default port 3000)
- [ ] Temporal stack running (`docker compose` in `docker/temporal/` or equivalent)
- [ ] Temporal worker running (`npm run temporal:worker` in `backend/`)
- [ ] Frontend running (`npm run dev` in `frontend/`)

## Environment (local mock mode)

- [ ] `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` configured
- [ ] `GOOGLE_OAUTH_MOCK=true`
- [ ] `GBP_API_MOCK=true`
- [ ] `GOOGLE_ADS_API_MOCK=true`
- [ ] `GTM_API_MOCK=true`
- [ ] `FRONTEND_ORIGIN` matches frontend dev URL

## Happy path

- [ ] Register / log in
- [ ] Complete business onboarding and confirm BusinessContext
- [ ] Connect Google Tag Manager and Google Ads (mock OAuth callback)
- [ ] Start a setup run from `/setup`
- [ ] Progress page polls and advances through steps
- [ ] Run reaches `SUCCEEDED` (or expected terminal state in mock conditions)
- [ ] Open setup report at `/setup/report/:setupRunId`
- [ ] Report shows GBP, catalog, GTM, verification, and Ads campaign sections as applicable

## Provisioning consent paths

- [ ] Seed or simulate `provisioning_required` for GTM (connected OAuth, no GTM account/container)
- [ ] Start setup → run stops at `GTM_PROVISIONING_REQUIRED`
- [ ] Progress page shows provisioning consent card with resource list and GBP read-only note
- [ ] Approve GTM provisioning → continue setup → new run provisions GTM and advances
- [ ] Repeat for Google Ads when `ADS_PROVISIONING_REQUIRED` (no accessible customer)
- [ ] Confirm UI does **not** call provisioning `/execute` directly (workflow provisions on next run)

## Failure / guardrail paths

- [ ] Missing GTM/Ads integrations → `SETUP_NEEDS_MANUAL_REVIEW`
- [ ] GTM configured but snippet not on site → `GTM_SNIPPET_PENDING`
- [ ] Structural issues → `SETUP_NEEDS_TRACKING_FIX`
- [ ] Stuck `RUNNING` run shows stuck guidance on progress/report pages
- [ ] Partial provider failure records compensation/support metadata where applicable
- [ ] Ads campaign partial failure pauses created campaign (compensation)
- [ ] GTM setup partial failure shows manual review guidance (no auto-delete)
- [ ] Provisioning failure after approval shows recovery guidance on setup report
- [ ] Retry setup run does not duplicate GTM tags or Ads campaign artifacts (idempotency)

## Automated regression

- [ ] Backend: `npm test` (from `backend/`)
- [ ] Frontend: `npm test` (from `frontend/`)
