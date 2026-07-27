# Phase 9 — GTM snippet setup-pending evidence log

**Checklist:** [`../PHASE9_GTM_SNIPPET_SETUP_PENDING.md`](../PHASE9_GTM_SNIPPET_SETUP_PENDING.md)

---

## Automated regression (Tasks 2–6)

```powershell
cd backend
npx jest tests/structuralVerificationService.test.js tests/setupRun.workflow.test.js tests/setupRunActivities.test.js -t "runStructuralVerification|snippet_pending|needs_tracking_fix|structural" --runInBand
npx jest tests/setupRunReport.test.js -t "snippet|tracking|buildRecovery" --runInBand

cd ../frontend
npm test -- SetupProgressPage.test.tsx SetupReportPage.test.tsx --runInBand
```

| Field | Value |
|-------|--------|
| **Date** | 2026-07-20 |
| **Operator** | Composer (automated) |
| **Backend (filtered)** | `20 passed` (structural / activity / workflow filter) |
| **Backend report (filtered)** | `3 passed` |
| **Frontend** | `34 passed` (SetupProgressPage + SetupReportPage) |
| **Notes** | No code changes in Phase 9 close-out; inventory gap list empty. |

### Inventory / verification matrix

| Check | Evidence | Status |
|-------|----------|--------|
| Snippet HTML detection | `structuralVerificationService.test.js` | PASS |
| `snippet_pending` / `needs_tracking_fix` verdicts | `structuralVerificationService.test.js` + activity tests | PASS |
| Workflow terminals | `setupRun.workflow.test.js` | PASS |
| Report recovery copy | `setupRunReport.test.js` (`buildRecovery`) | PASS |
| Progress/report UI | `SetupProgressPage.test.tsx`, `SetupReportPage.test.tsx` | PASS |

---

## Real-mode snippet detection E2E — **PENDING**

**Environment:** Live `websiteUrl` on `BusinessContext`, GTM connected and conversion setup complete on a Setup Run.

| Field | Value |
|-------|--------|
| **Status** | `PENDING` |
| **Reason** | Same product constraint as Phase 7 Track A: no in-place re-verify endpoint; after snippet install user must start a **new** setup run. Optional operator happy-path recorded below. |
| **V1 behavior** | Progress **Refresh** re-fetches current run status only. |

### Optional happy-path real-mode run

| Field | Value |
|-------|--------|
| **Date** | `____________` |
| **businessId** | `____________` |
| **setupRunId (snippet pending)** | `____________` |
| **websiteUrl** | `____________` |
| **publicContainerId** | `____________` |
| **After snippet install — new setupRunId** | `____________` |
| **Result** | `PASS` / `FAIL` / `SKIPPED` |
