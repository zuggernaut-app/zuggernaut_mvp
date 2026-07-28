# Manual E2E Checklist (V1 Setup Run)

Use this checklist for local sandbox verification before real customers.

**Environment source of truth:** [`backend/.env.example`](../.env.example) (mode matrix at bottom). Copy to `backend/.env` before running.

**Phase 2 sign-off (2026-05-31):** All items **PASS (mock mode)** with automated test evidence — see [`evidence/PHASE2_MOCK_E2E_EVIDENCE.md`](./evidence/PHASE2_MOCK_E2E_EVIDENCE.md).

## Prerequisites

- [x] **PASS (mock mode)** MongoDB reachable — Jest `setupAfterEnv.js` in-memory Mongo; 282 backend tests green
- [x] **PASS (mock mode)** Backend running — `assertAuthEnvironment.test.js`; boot validates JWT + `TOKEN_ENCRYPTION_KEY`
- [x] **PASS (mock mode)** Temporal stack — workflow/API tests mock Temporal client (`setupRuns.test.js`); live stack per README for operator runs
- [x] **PASS (mock mode)** Temporal worker — worker startup contract Phase 1; activity tests cover workflow steps
- [x] **PASS (mock mode)** Frontend running — 103 Vitest tests green

## Environment (local mock mode)

Use these values (see `.env.example` mode matrix):

- [x] **PASS (mock mode)** `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` — `assertAuthEnvironment.test.js`; `setupAfterEnv.js`
- [x] **PASS (mock mode)** `TEMPORAL_*` vars — documented `.env.example`; `setupRuns.test.js` uses `setup-run` queue
- [x] **PASS (mock mode)** `GOOGLE_OAUTH_MOCK=true` — `setupAfterEnv.js`; `googleOAuthService.test.js`
- [x] **PASS (mock mode)** `GBP_API_MOCK=true` — `setupAfterEnv.js`; `gbpReadOnlyAuditService.test.js`
- [x] **PASS (mock mode)** `GOOGLE_ADS_API_MOCK=true` — `setupAfterEnv.js`; `adsAutoCampaignService.test.js`
- [x] **PASS (mock mode)** `GTM_API_MOCK=true` — `setupAfterEnv.js`; `gtmConversionSetupService.test.js`
- [x] **PASS (mock mode)** `FRONTEND_ORIGIN` — `setupAfterEnv.js` default `http://localhost:5173`

**Real mode (Phase 4):** see [`REAL_MODE_E2E_CHECKLIST.md`](./REAL_MODE_E2E_CHECKLIST.md). Preflight: `npm run verify:real-mode-env` in `backend/`. **Status: DEFERRED** (2026-05-31) — [`evidence/PHASE4_REAL_MODE_DEFERRAL.md`](./evidence/PHASE4_REAL_MODE_DEFERRAL.md).

## Happy path

- [x] **PASS (mock mode)** Register / log in — `auth.test.js`
- [x] **PASS (mock mode)** Complete business onboarding and confirm BusinessContext — `onboarding.test.js`, `businessContexts.test.js`
- [x] **PASS (mock mode)** Connect Google Tag Manager and Google Ads (mock OAuth callback) — `integrations.api.test.js`, `googleOAuthService.test.js`
- [x] **PASS (mock mode)** Start a setup run from `/setup` — `setupRuns.test.js` (`POST /api/v1/setup-runs`)
- [x] **PASS (mock mode)** Progress page polls and advances through steps — `SetupProgressPage.test.tsx`; `useSetupRunStatus.test.tsx`
- [x] **PASS (mock mode)** Run reaches `SUCCEEDED` — `setupRun.workflow.test.js`; `setupRunReport.test.js`; `frontend/e2e/setup-run-complete.e2e.ts` (embedded worker + real `/api/v1/setup-runs/:id` polling)
- [x] **PASS (mock mode)** Open setup report at `/setup/report/:setupRunId` — `setupRuns.test.js` (report route); `SetupReportPage.test.tsx`
- [x] **PASS (mock mode)** Report shows GBP, catalog, GTM, verification, and Ads campaign sections — `setupRunReport.test.js` (`aggregates normalized sections`)

## Provisioning consent paths

- [x] **PASS (mock mode)** Seed/simulate GTM `provisioning_required` — `provisioning.api.test.js`; `setupRunActivities.test.js`
- [x] **PASS (mock mode)** Start setup → `GTM_PROVISIONING_REQUIRED` — `backend/tests/setupRun.workflow.test.js` (`stops with gtm_provisioning_required when GTM provisioning approval is pending`; `provisions GTM and continues when approval exists`)
- [x] **PASS (mock mode)** Progress page provisioning consent card + GBP read-only note — `SetupProgressPage.test.tsx`; `provisioningUi.test.ts`
- [x] **PASS (mock mode)** Approve GTM → continue setup → new run — `SetupProgressPage.test.tsx` (`approves provisioning and shows continue setup action`)
- [x] **PASS (mock mode)** Ads `ADS_PROVISIONING_REQUIRED` — `setupRun.workflow.test.js`; `SetupProgressPage.test.tsx` (Ads card)
- [x] **PASS (mock mode)** UI does **not** call provisioning `/execute` — `frontend/src/api/integrations.ts` (create/approve/cancel only)

## Failure / guardrail paths

- [x] **PASS (mock mode)** Missing GTM/Ads → `SETUP_NEEDS_MANUAL_REVIEW` — `setupRunActivities.test.js`
- [x] **PASS (mock mode)** Snippet not on site → `GTM_SNIPPET_PENDING` — `setupRunActivities.test.js`; `SetupProgressPage.test.tsx`
- [x] **PASS (mock mode)** Structural issues → `SETUP_NEEDS_TRACKING_FIX` — `setupRun.workflow.test.js`; `SetupProgressPage.test.tsx`
- [x] **PASS (mock mode)** Stuck `RUNNING` guidance — `setupRunStuckDetection.test.js`; `SetupProgressPage.test.tsx`; `setupRunReport.test.js`
- [x] **PASS (mock mode)** Partial failure support metadata — `setupFailureSupport.test.js`
- [x] **PASS (mock mode)** Ads partial failure pauses campaign — `setupRunCompensation.test.js`; `setupRunActivities.test.js`
- [x] **PASS (mock mode)** GTM partial failure manual review (no auto-delete) — `setupRunActivities.test.js`; `SetupReportPage.test.tsx`
- [x] **PASS (mock mode)** Provisioning failure recovery on report — `setupRunReport.test.js` (provisioning + supportState)
- [x] **PASS (mock mode)** Retry does not duplicate artifacts — `gtmConversionSetupService.test.js`, `adsAutoCampaignService.test.js`, `gtmProvisioningService.test.js`, `adsProvisioningService.test.js`

## Automated regression

- [x] **PASS** Backend: `npm test` — 40 suites, 282 tests (2026-05-31)
- [x] **PASS** Frontend: `npm test` — 15 files, 103 tests (2026-05-31)

Evidence capture: [`V1_REMEDIATION_EXECUTION.md`](../../V1_REMEDIATION_EXECUTION.md#evidence-capture-template) · [`evidence/PHASE2_MOCK_E2E_EVIDENCE.md`](./evidence/PHASE2_MOCK_E2E_EVIDENCE.md)
