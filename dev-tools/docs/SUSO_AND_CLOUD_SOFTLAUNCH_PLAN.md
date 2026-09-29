# SUSO + Cloud Soft Launch — Implementation Plan

**Purpose:** Wire SUSO campaign strategy into the product, then deploy a staging/soft-launch environment for real test businesses.

**Scope:** SUSO Step 0 → matrix → intent wiring → cloud deploy. Does **not** include Security CI (see `SECURITY_CI_PLAN.md`) or Hardening Tier 3.

**Source material:**
- `docs/suso-framework/SUSO-framework-full-v2.1.md`
- `docs/suso-framework/SUSO-google-search-ads-mvp-v2.1.md`
- `docs/DEPLOY.md`
- `backend/.env.example`
- `mvp_implementation_plan.md` → Implementation Discipline

**SME editing scope:** SUSO rules (constants/trim order/gates) stay in code/config (`backend/constants/suso.js`). SMEs edit per-business Step 0 inputs only — no rule-management product in this phase.

---

## How to use this doc

1. Work tasks in order unless noted as parallel-safe.
2. One Composer task = one numbered item below.
3. Mark **Status** as you go: `todo` | `in_progress` | `done` | `accepted` | `deferred`.
4. Do not start cloud soft launch (Section B) until Section A is testable end-to-end.

---

## A. SUSO wiring (product/strategy brain)

| ID | Status | Task |
|----|--------|------|
| 1 | todo | Add SUSO Step 0 fields to `BusinessContext` model — `backend/models/BusinessContext.js` (uvp, competitorLandscape, businessScope, valueComplexity, susoVersion, susoVersionUpdatedAt). |
| 1b | todo | Add backfill/defaults for existing `BusinessContext` rows — `backend/models/BusinessContext.js` migration + `backend/scripts/` one-off; default `susoVersion: 0`, nullable Step 0 fields; existing businesses not blocked. |
| 1c | todo | Add `budgetTier` field to `BusinessContext` — `backend/models/BusinessContext.js` (user-stated budget input for SUSO budget viability gate). |
| 2 | todo | Add SUSO constants — `backend/constants/suso.js` (objectives, stages, segments, value×complexity gate map, budget trim order, feasibility gate states). |
| 3 | todo | Add feasibility-gate resolver — new `backend/services/capabilities/susoFeasibilityService.js` (retargeting/loyalty/budget gates; **V1 default: "not enough data yet"** for retargeting + loyalty unless real Google Ads reporting wired later). |
| 4 | todo | Add SUSO matrix builder — new `backend/services/capabilities/susoMatrixService.js` (Layer 1 cells filtered by Step 0 + feasibility gates; uses `budgetTier` from BC). |
| 5 | todo | Wire SUSO matrix → campaign intent — `backend/services/capabilities/adsCampaignIntentService.js` (derive eligible objectives/segments; pass through to intent validation). |
| 5b | todo | Store `susoVersion` on campaign intent/artifact metadata at creation — `backend/services/capabilities/adsAutoCampaignService.js` (so stale campaigns can be detected by comparing artifact `susoVersion` to current BC `susoVersion`); **metadata only — do NOT add `susoVersion` to idempotency keys**. |
| 6 | todo | Add Step 0 versioning + invalidation — `backend/services/setup/businessSetupStateService.js` **owns the version bump in the BusinessContext write path** so every BC edit route increments consistently (bump `susoVersion` on edit of Step 0 fields; **concrete behavior: store `susoVersion` + `susoVersionUpdatedAt` on BC; UI banner "campaigns generated under prior SUSO version — review" on report page; requires explicit "reviewed/force re-run" confirmation before any new provider mutations under a newer SUSO version — does not silently allow re-creation**); **also add a server-side gate in `backend/api/v1/setupRuns.js` requiring an explicit `force` flag when starting a provider-mutating run under a newer SUSO version than the most recent completed setup run's campaign artifact `susoVersion` (deterministic selection — not "any existing artifact"); null/undefined artifact `susoVersion` (no prior completed run / first-time run) → gate passes, no `force` flag required**. |
| 6b | todo | Expose stale-SUSO signal in report service — `backend/services/reports/setupRunReportService.js` (compare artifact `susoVersion` to current BC `susoVersion`; **if no prior artifact exists or artifact `susoVersion` is null/undefined → `susoStale: false` (no stale flag, do not throw, do not default to stale)**; else return `susoStale: true` + versions for UI when mismatched). |
| 6c | todo | Render stale-SUSO banner in report page — `frontend/src/pages/SetupReportPage.tsx` (show banner + "review/force re-run" confirmation when `susoStale`). |
| 6d | todo | Wire force re-run confirm action on report page — `frontend/src/pages/SetupReportPage.tsx` (when user clicks "force re-run" in the stale banner, show a confirm dialog then call `POST /api/v1/setup-runs` with `force: true` directly from the report page; on success navigate to `SetupProgressPage`). |
| 7 | todo | Add BusinessContext API fields + validation — `backend/api/v1/businessContexts.js` (accept Step 0 inputs; enforce value×complexity objective gate; routes through the same write path as task 6). |
| 8 | todo | Add frontend Step 0 capture screen — new `frontend/src/pages/Step0BusinessFoundationPage.tsx` (UVP, competitors, scope, value×complexity picker, budget tier); **positioned after scrape/BusinessContext confirmation so scrape can prefill and SMEs edit real context**. |
| 8b | todo | Add admin/seed path for Step 0 (fallback if FE not ready for soft launch) — `backend/scripts/seedStep0.js` **calling the same BusinessContext update service/path used by the API**, not direct Mongo writes. |
| 9 | todo | Add frontend SUSO matrix preview — new `frontend/src/components/setup/SusoMatrixPreview.tsx` (show eligible/trimmed cells + gate states). |
| 10 | todo | Wire Step 0 into onboarding router — `frontend/src/app/router.tsx` + `frontend/src/hooks/useOnboardingState.tsx`; **insert Step 0 after scrape/BusinessContext confirmation (same position as task 8) — before setup-run start**. |
| 11 | todo | Add Search-MVP narrowing — `backend/constants/suso.js` (excluded objectives/stages per `SUSO-google-search-ads-mvp-v2.1.md`). |
| 12 | todo | Add comparison-copy default-off guardrail — `backend/services/capabilities/googleAdsCampaignComplianceService.js` (generic comparison only; **named-competitor comparison always default-off for this phase — no new flag/API**). |
| 13 | todo | Tests for SUSO services — `backend/tests/susoFeasibilityService.test.js`, `susoMatrixService.test.js`, Step 0 versioning test in `businessSetupState.test.js`, **setup-runs force-flag gate test in `backend/tests/setupRuns.test.js` asserting a run with mismatched SUSO version is rejected without the `force` flag and a first-time run (null artifact `susoVersion`) passes without the `force` flag**, **and `backend/tests/setupRunReport.test.js` case asserting `susoStale: false` when artifact `susoVersion` is null/absent**. |
| 14 | todo | FE tests — `frontend/src/pages/Step0BusinessFoundationPage.test.tsx`, `SusoMatrixPreview.test.tsx`, **`frontend/src/pages/SetupReportPage.test.tsx` cases asserting the stale-SUSO banner renders when `susoStale: true`, is absent when `susoStale: false`, and that the force re-run button calls `POST /setup-runs` with `force: true` after confirmation**. |

### Hard dependencies (Section A)

- Tasks 5, 7 depend on 1–4 + 1c.
- Task 5b depends on 5.
- Task 6 depends on 1.
- Tasks 6b–6d depend on 5b + 6.
- Tasks 8–10 depend on 7.
- Task 8b depends on 1 + 6.
- Tasks 11–12 depend on 2.

**Section A complete when:** at least tasks 1–7, 5b, 6b–6d, 11–12 done, plus task 8 **or** 8b.

---

## B. Cloud soft launch (after Section A is testable end-to-end)

| ID | Status | Task |
|----|--------|------|
| 15 | todo | Verify `docs/DEPLOY.md` covers current env vars — `docs/DEPLOY.md` (audit against `backend/.env.example`). |
| 16 | todo | Add Google OAuth redirect URI for Railway — Google Cloud Console + `backend/.env` (`GOOGLE_OAUTH_REDIRECT_URI`). |
| 16b | todo | Provision staging as a separate environment from any future production — separate Railway project, Firebase project, Atlas cluster, Temporal namespace, and Google OAuth client/config; **do not share prod config with staging** (avoids painful test-data/OAuth-callback unwinding later). |
| 17 | todo | Provision Railway API service — Railway (deploy from `backend/`, root dir `backend`). |
| 18 | todo | Provision Railway worker service — Railway (same repo, `npm run temporal:worker`, no HTTP healthcheck). |
| 19 | todo | Provision MongoDB Atlas + allow Railway egress — Atlas (shared `MONGODB_URI` on both services). |
| 20 | todo | Provision Temporal Cloud — Temporal (mTLS env on both services); **use Temporal Cloud for soft launch unless cost is prohibitive — self-hosting adds ops risk when tester feedback is the priority**. |
| 21 | todo | Deploy Firebase Hosting — `frontend/` (`VITE_API_BASE_URL` → Railway; `firebase deploy --only hosting`). |
| 22 | todo | Set `FRONTEND_ORIGIN` on Railway API — Railway (Firebase URL; triggers `SameSite=None; Secure`). |
| 23 | todo | Turn off Google mocks on Railway — Railway (`GOOGLE_*_MOCK=false`, `GOOGLE_*_API_ENABLED=true`). |
| 23b | todo | Throwaway MCC/test-customer checklist — new `dev-tools/docs/SOFT_LAUNCH_TEST_ACCOUNTS.md` (which MCC customer IDs are disposable; verify before task 23). |
| 24 | todo | Post-deploy smoke (manual) — login, OAuth connect, one full setup run on a throwaway Ads customer. |
| 25 | todo | Soft-launch checklist doc — new `dev-tools/docs/SOFT_LAUNCH_CHECKLIST.md`. |

### Hard dependencies (Section B)

- Depends on Section A being testable end-to-end.
- Depends on existing `docs/DEPLOY.md`, `backend/.env.example`, `sessionCookie.js` (SameSite already done).

---

## High-risk steps

| Task | Risk | Mitigation |
|------|------|------------|
| 5 | Changes campaign creation path; touches `adsAutoCampaignService` → Google Ads mutate | Idempotency-sensitive; add tests before merge |
| 5b | `susoVersion` on artifacts | Metadata only; written at create time; must NOT enter idempotency keys |
| 6 | Step 0 versioning + server-side gate | UI banner + explicit confirmation + API gate; null artifact = gate passes; deterministic artifact selection (most recent completed run) |
| 17–18 | Real Google OAuth + Ads API enabled | Use throwaway MCC test accounts (task 23b), not live spend |
| 23 | Mocks off | Irreversible real Google mutations; verify on test MCC customer first |
| 24 | Smoke test | Real provider creates (Ads customer, GTM container, conversion actions); idempotency keys must be live |

---

## Phase-later notes

- **Real Google Ads reporting for feasibility gates** — deferred to post-soft-launch; V1 uses "not enough data yet" default for retargeting + loyalty.

---

## Suggested execution order

1. **Backend foundation:** 1 → 1b → 1c → 2 → 3 → 4
2. **Intent + versioning:** 5 → 5b → 6 → 6b
3. **API + FE Step 0:** 7 → 8 (or 8b) → 9 → 10
4. **Guardrails + tests:** 11 → 12 → 13 → 14
5. **FE stale flow:** 6c → 6d (can follow 6b once report API is ready)
6. **Cloud:** 15 → 16 → 16b → 17–22 → 23b → 23 → 24 → 25

**Parallel with Section A:** Security CI track (`SECURITY_CI_PLAN.md`) — no dependency on SUSO.
