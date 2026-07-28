# Phase 12 — Reliability and Guardrails (V1)

**MVP reference:** `mvp_implementation_plan.md` → Phase 12  
**Approach:** Close gaps on existing guardrails (idempotency, compensation, rate limits, support UX) — not greenfield.

---

## Requirement map

| Phase 12 requirement | Implementation | Tests / evidence |
|----------------------|----------------|------------------|
| Idempotency keys for provider-changing activities | `backend/constants/idempotency.js`, `PROVIDER_MUTATION_CONTRACT`, unique sparse index on `IntegrationArtifact.idempotencyKey` | `backend/tests/idempotency.test.js` |
| Artifact lookup before every external create | Capability services (`adsAutoCampaignService`, `gtmConversionSetupService`, provisioning, conversion catalog/action management) | Phase 7–10 test suites; `gtmConversionSetupService.submittedWorkspace.test.js` |
| Retry policies and activity timeouts in Temporal | `backend/constants/setupActivityPolicies.js`, wired in `setupRun.workflow.js` | `backend/tests/setupActivityPolicies.test.js` |
| Provider-level rate limiting in workers | `backend/lib/providerRateLimit.js`; GTM 429 client backoff in `googleTagManagerClient.js`; Ads 429 client backoff in `googleAdsApiConfig.js` (`googleAdsPost` / `googleAdsGet`) used by Ads HTTP clients | `providerRateLimit.test.js`, `googleTagManagerClient.rateLimit.test.js`, `googleAdsApiConfig.test.js`, per-client 429 tests |
| Compensation for partial failures | `setupRunCompensationService.js` — Ads pause on campaign failure; GTM guidance; conversion-action failure guidance with conditional campaign pause | `setupRunCompensation.test.js`, `setupFailureSupport.test.js` |
| Support states for failed / stuck runs | `setupFailureSupport.js`, `setupRunStuckDetection.js`, report + progress UI (`SetupReportPage`, `SetupProgressPage` on `FAILED`) | `setupRunActivities.test.js` (conversion-action support), `SetupProgressPage.test.tsx` |

---

## Phase 12 changes (this pass)

1. **Conversion-action failure support** — `manageAdsConversionActionsActivity` now calls `recordSetupFailureSupport` on `creation_failed` and thrown errors; compensation records guidance and pauses setup-created campaigns only when an `ads_campaign` artifact already exists for the run.
2. **Ads 429 Retry-After** — shared helper in `googleAdsApiConfig.js`; all Ads HTTP clients route through `googleAdsPost` / `googleAdsGet` with bounded in-client retries for confirmed `429` only.
3. **Progress UX parity** — `SetupProgressPage` shows support/compensation sections when status is `FAILED` (stuck guidance remains for long-running `RUNNING` only).

---

## Verification (commands)

```powershell
cd backend
npx jest tests/setupRunActivities.test.js tests/setupRunCompensation.test.js tests/googleAdsApiConfig.test.js tests/googleAdsCampaignClient.test.js tests/googleAdsConversionCatalogClient.test.js tests/googleAdsConversionActionClient.test.js tests/googleAdsAccountClient.test.js --runInBand

cd ../frontend
npm test -- SetupProgressPage.test.tsx --runInBand
```

---

## Sign-off

| Field | Value |
|-------|--------|
| Inventory date | 2026-07-28 |
| Automated tests | See verification commands above |
| Deferred (V1) | Multi-worker Redis rate limits; automated GTM delete/rollback; full TOCTOU pending-artifact rewrite |
| Phase 12 status | `COMPLETE` |
