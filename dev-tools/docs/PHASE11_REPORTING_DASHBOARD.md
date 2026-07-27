# Phase 11 — Reporting Dashboard (V1)

**MVP reference:** `mvp_implementation_plan.md` → Phase 11  
**Approach:** Extend existing setup report + progress surfaces (`setupRunId`); no separate dashboard API or page.

---

## Step 1 — Inventory (decision gate)

Audited: `backend/services/reports/setupRunReportService.js`, `GET /api/v1/setupRuns/:setupRunId/report`, `frontend/src/pages/SetupReportPage.tsx`, `frontend/src/pages/SetupProgressPage.tsx`, `GET /api/v1/setupRuns/:setupRunId`.

| Phase 11 requirement | Backend (`buildSetupRunReport` / setup run API) | UI surface | Status |
|----------------------|-------------------------------------------------|------------|--------|
| GBP audit summary or missing-profile guidance | `gbpAudit` (`normalizeGbpAudit`, audit findings) | Report: GBP audit section; Progress: skipped / guidance / summary | **Met** |
| GTM setup status | `gtmSetup` (`normalizeGtmSetup`) | Report + Progress: GTM setup section when `setup_complete`; failures visible in **Step history** (`gtm_conversion_setup`) | **Met** |
| GTM provisioning status | `provisioning.gtm` (`normalizeProvisioning`) | Report + Progress: Provisioning status section | **Met** |
| GTM verification status | `structuralVerification` (`normalizeStructuralVerification`) | Report + Progress: Structural verification section; terminal banners (`GTM_SNIPPET_PENDING`, `SETUP_NEEDS_TRACKING_FIX`) | **Met** |
| Google Ads campaign creation status | `adsCampaign` (`normalizeAdsCampaign`, failure details) | Report + Progress: Google Ads campaign (success + failure with bucket/field/recommended action) | **Met** |
| Google Ads customer provisioning status | `provisioning.googleAds` | Report + Progress: Provisioning status section | **Met** |
| SetupRun progress | `steps` on report; full run + steps on `GET .../setupRuns/:id` | Progress: live polling, per-step list with errors | **Met** |
| Stuck-state instructions | `stuckState` (`detectStuckSetupRun`); `outcome.recovery` | Progress: “Looks stuck?” banner; Report: stuck alert + recovery steps in Outcome | **Met** |

**V1 constraint:** No optimization/performance dashboard — current pages are setup-result only. **Met.**

### Non-material notes (no implementation required)

- GTM setup **failed** runs surface as `gtmSetup.status: not_run` in the report payload, but the failed step is always listed under **Step history** on both pages — status is not invisible.
- Ads campaign **precondition** failures (e.g. `ADS_MISSING_CONVERSIONS`) appear in step history and `lastErrorSummary`; dedicated Ads failure UI is for `ads_campaign_creation` step failures with structured `details`.

### Gap list (backend / UI)

| Gap | Action |
|-----|--------|
| — | **None** — all four Phase 11 bullets covered by existing report + progress flows. |

### Stop gate

**Result:** Inventory passes with **no material gaps**. **Do not** add `dashboardReportService`, `DashboardPage`, or `GET .../dashboardReport`. **Skip** implementation Steps 2–3. Proceed to verification (Step 4) and close (Step 5).

---

## Step 4 — Verification (commands)

```powershell
cd backend
npx jest tests/setupRunReport.test.js --runInBand

cd ../frontend
npm test -- SetupReportPage.test.tsx SetupProgressPage.test.tsx --runInBand
```

Manual smoke: one terminal `SUCCEEDED` run and one `FAILED` / stuck run — open `/setup/progress/:setupRunId` and `/setup/report/:setupRunId`.

---

## Sign-off

| Field | Value |
|-------|--------|
| Inventory date | 2026-07-20 |
| Stop gate | Pass — no code changes required |
| Automated tests | PASS — backend `setupRunReport.test.js` (15); frontend `SetupReportPage` + `SetupProgressPage` (34) |
| Phase 11 status | `COMPLETE` |
