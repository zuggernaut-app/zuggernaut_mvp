# Phase 2 — Mock-mode E2E evidence log

**Date:** 2026-05-31  
**Mode:** mock (automated test harness + static UI verification)  
**Test runs:** backend `40 suites / 282 tests PASS`; frontend `15 files / 103 tests PASS`

Evidence method: Jest/Vitest integration and component tests exercise the same API contracts, terminal states, and UI guidance as the manual checklist. Live Temporal + browser walkthrough is optional for mock sign-off when automated evidence covers each criterion.

---

## Automated regression (Phase 2.3)

| Suite | Command | Result |
|-------|---------|--------|
| Backend | `cd backend && npm test` | **PASS** — 40 suites, 282 tests |
| Frontend | `cd frontend && npm test` | **PASS** — 15 files, 103 tests |

Idempotency / retry proof (non-exhaustive):

- `backend/tests/idempotency.test.js` — provider mutation contract
- `backend/tests/gtmConversionSetupService.test.js` — `persists artifacts and snapshot idempotently on retry`
- `backend/tests/adsAutoCampaignService.test.js` — `is idempotent on second run`
- `backend/tests/gtmProvisioningService.test.js` — `reuses artifacts on retry without duplicate create calls`
- `backend/tests/adsProvisioningService.test.js` — same
- `backend/tests/setupRunCompensation.test.js` — compensation idempotency
- `backend/tests/setupActivityPolicies.test.js` — bounded mutate retries

---

## UI + report mapping (Phase 2.2)

| `SetupRun.status` | Progress page guidance | Report `outcome.kind` + recovery | Test evidence |
|-------------------|------------------------|----------------------------------|---------------|
| `GTM_PROVISIONING_REQUIRED` | `ProvisioningConsentCard` (GTM) | `provisioning_required` | `SetupProgressPage.test.tsx` (GTM card); `SetupReportPage.test.tsx` (provisioning section) |
| `ADS_PROVISIONING_REQUIRED` | `ProvisioningConsentCard` (Ads) | `provisioning_required` | `SetupProgressPage.test.tsx` (Ads card) |
| `GTM_SNIPPET_PENDING` | Snippet install alert + container ID | `snippet_pending` + recovery steps | `SetupProgressPage.test.tsx`; `SetupReportPage.test.tsx` |
| `SETUP_NEEDS_TRACKING_FIX` | Tracking fix alert + structural details | `tracking_fix` | `SetupProgressPage.test.tsx` (structural verification) |
| `SETUP_NEEDS_MANUAL_REVIEW` | Connect integrations alert + connection panel | `manual_review` | `SetupProgressPage.tsx` L367–371; `setupRunReportService` recovery; `setupRunActivities.test.js` |
| `SUCCEEDED` | Success sections (GBP, catalog, GTM, Ads) | `succeeded` | `SetupProgressPage.test.tsx`; `setupRunReport.test.js` |
| `RUNNING` (stuck) | Stuck hint from `stuckState` | stuck recovery on report | `SetupProgressPage.test.tsx`; `setupRunReport.test.js` |

Frontend does **not** expose provisioning `/execute` — only create/approve/cancel in `frontend/src/api/integrations.ts`. Workflow provisions on next run after approval (`SetupProgressPage.test.tsx` → Continue setup → `startSetupRun`).

---

## Checklist item evidence index

| Checklist section | Item | Evidence |
|-------------------|------|----------|
| Prerequisites | MongoDB | `setupAfterEnv.js` in-memory Mongo; all Jest suites |
| Prerequisites | Backend / env boot | `assertAuthEnvironment.test.js`; Phase 1 `.env.example` |
| Prerequisites | Temporal / worker | Documented Phase 1; workflow tests mock Temporal client |
| Prerequisites | Frontend | Vitest component tests |
| Environment | Mock flags + secrets | `setupAfterEnv.js` defaults; `.env.example` mode matrix |
| Happy path | Register / login | `auth.test.js` |
| Happy path | Business onboarding | `onboarding.test.js`, `businessContexts.test.js` |
| Happy path | Mock OAuth connect | `integrations.api.test.js`, `googleOAuthService.test.js` |
| Happy path | Start setup run | `setupRuns.test.js` (`201 starts workflow`) |
| Happy path | Progress / SUCCEEDED | `setupRun.workflow.test.js`; `setupRunReport.test.js` |
| Happy path | Report sections | `setupRunReport.test.js` (`aggregates normalized sections`) |
| Provisioning | GTM required state | `setupRun.workflow.test.js`; `setupRunActivities.test.js` |
| Provisioning | Consent UI | `SetupProgressPage.test.tsx` |
| Provisioning | Approve + new run | `SetupProgressPage.test.tsx` (`approves provisioning and shows continue setup`) |
| Provisioning | Ads required | `setupRun.workflow.test.js`; `SetupProgressPage.test.tsx` |
| Provisioning | No UI `/execute` | `integrations.ts` — no execute export |
| Guardrails | Manual review | `setupRunActivities.test.js` (missing providers → `SETUP_NEEDS_MANUAL_REVIEW`) |
| Guardrails | Snippet pending | `setupRunActivities.test.js`; UI tests above |
| Guardrails | Tracking fix | `setupRun.workflow.test.js`; UI tests above |
| Guardrails | Stuck RUNNING | `setupRuns.test.js`; `setupRunStuckDetection.test.js`; UI tests |
| Guardrails | Compensation / support | `setupFailureSupport.test.js`; `setupRunCompensation.test.js`; `SetupReportPage.test.tsx` |
| Guardrails | Idempotency on retry | See idempotency test list above |
