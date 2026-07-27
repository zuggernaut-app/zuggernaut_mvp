# Phase 9 — GTM Snippet Setup-Pending and Verification

**MVP reference:** `mvp_implementation_plan.md` → Phase 9  
**Approach:** Inventory + verification of existing structural verification, workflow terminals, report recovery, and progress/report UI; close gaps only if found.

**Evidence:** [`evidence/PHASE9_GTM_SNIPPET_SETUP_PENDING_EVIDENCE.md`](./evidence/PHASE9_GTM_SNIPPET_SETUP_PENDING_EVIDENCE.md)

**ADR:** [`product_strategy/adr/0002-manual-gtm-snippet-install-v1.md`](../../product_strategy/adr/0002-manual-gtm-snippet-install-v1.md) — manual snippet install in V1.

---

## Task 1 — Inventory (decision gate)

Audited: `backend/services/capabilities/structuralVerificationService.js`, `runStructuralVerificationActivity` in `backend/activities/setupRunActivities.js`, `backend/workflows/setupRun.workflow.js`, `backend/services/reports/setupRunReportService.js` (`buildRecovery`), `frontend/src/pages/SetupProgressPage.tsx`, `frontend/src/pages/SetupReportPage.tsx`, `backend/constants/enums.js` / `setupWorkflow.js` statuses.

| Phase 9 requirement | Implementation | Status |
|---------------------|----------------|--------|
| Clear GTM snippet installation instructions in the UI | `SetupProgressPage` banner when `GTM_SNIPPET_PENDING`; report `outcome.recovery` + structural verification section on `SetupReportPage` | **Met** |
| `GTM_SNIPPET_PENDING` or `SETUP_PENDING` state | `GTM_SNIPPET_PENDING` on SetupRun; workflow terminal `snippet_pending` (`T.SNIPPET_PENDING`) | **Met** |
| Lightweight HTML presence check for GTM container ID | `axios.get(websiteUrl)` + `detectSnippetInHtml` (container ID, `gtm.js`, noscript iframe) | **Met** |
| Structural verification: published version, tags, triggers, tag–trigger links, Ads conversion IDs | Artifact counts vs `buildGtmSetupPlan` expected structure + `verifyAdsConversionLinkage` + `ProviderSnapshot` `publishedVersionPath` | **Met** |
| On verification failure → `SETUP_NEEDS_TRACKING_FIX` + user-friendly steps | Activity patches `SETUP_NEEDS_TRACKING_FIX`; `buildRecovery('tracking_fix')` + progress/report copy | **Met** |

### Gap list (code)

| Gap | Action |
|-----|--------|
| — | **None** — all Phase 9 bullets covered by existing verification + UI flows. |

### Stop gate (Task 1)

**Result:** Inventory passes with **no code gaps**. Proceed to automated verification (Tasks 2–6) and sign-off (Tasks 7–8).

---

## Tasks 3–6 — Verification summary

| Task | Result |
|------|--------|
| **3 Snippet presence** | `detectSnippetInHtml` checks public container ID, `googletagmanager.com/gtm.js`, and noscript iframe; fetch uses 15s timeout, max 5 redirects, `validateStatus: () => true`. |
| **4 Structural coverage** | `collectStructuralMissing` (tags/triggers/variables/conversions/published version) + `verifyAdsConversionLinkage` (tag binding, trigger templates, `firingTriggerLogicalKeys`). |
| **5 State transitions** | `snippet_pending` → `GTM_SNIPPET_PENDING` + `GTM_SNIPPET_PENDING` supportState; `needs_tracking_fix` → `SETUP_NEEDS_TRACKING_FIX`; workflow maps to `T.SNIPPET_PENDING` / `T.NEEDS_TRACKING_FIX`. |
| **6 UI instructions** | Container ID in progress banner; recovery steps include “start a new setup run”; **Refresh** re-polls run status only (no V1 re-verify API). |

### Resolved open questions (planning)

- **Real-mode snippet E2E:** **Deferred** (same as Phase 7 Track A / Phase 8) — optional operator sign-off in evidence doc; automated Jest covers verdict paths.
- **Refresh semantics:** **Poll only** — user starts a **new setup run** after installing snippet; structural verification runs again in workflow.

---

## Task 2 — Automated tests (commands)

```powershell
cd backend
npx jest tests/structuralVerificationService.test.js tests/setupRun.workflow.test.js tests/setupRunActivities.test.js -t "runStructuralVerification|snippet_pending|needs_tracking_fix|structural" --runInBand
npx jest tests/setupRunReport.test.js -t "snippet|tracking|buildRecovery" --runInBand

cd ../frontend
npm test -- SetupProgressPage.test.tsx SetupReportPage.test.tsx --runInBand
```

---

## Sign-off

| Field | Value |
|-------|--------|
| Inventory date | 2026-07-20 |
| Stop gate | Pass — no Phase 9 code changes required |
| Automated tests | PASS — backend structural/activity/workflow/report filters; frontend progress + report suites |
| Phase 9 status | `COMPLETE` (real-mode snippet E2E sign-off **PENDING** — see evidence doc) |
