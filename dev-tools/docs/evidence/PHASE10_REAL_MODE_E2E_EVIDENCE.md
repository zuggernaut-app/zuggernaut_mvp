# Phase 10 — Real-mode E2E evidence log

**Phase:** Google Ads Campaign Creation (targeting + strict validation + structural gate)  
**Checklist:** [`../PHASE10_REAL_MODE_E2E_CHECKLIST.md`](../PHASE10_REAL_MODE_E2E_CHECKLIST.md)  
**Guide:** [`../../../docs/google-ads-e2e-guide.md`](../../../docs/google-ads-e2e-guide.md) §7 Targeting

---

## Automated regression (mock mode — pre-requisite for real-mode)

Run before real-mode execution:

```powershell
cd backend
npx jest tests/adsCampaignIntentService.test.js tests/adsAutoCampaignService.test.js tests/googleAdsCampaignClient.test.js tests/googleAdsGeoTargetClient.test.js tests/idempotency.test.js tests/setupRunActivities.test.js tests/setupRun.workflow.test.js tests/phase10DefinitionOfDone.test.js --runInBand
```

| Area | Test file | What it proves |
|------|-----------|----------------|
| Intent contract (buckets 1–3) | `adsCampaignIntentService.test.js` | Stable `ADS_INTENT_*` codes; geo/keyword/RSA validation |
| Campaign orchestration | `adsAutoCampaignService.test.js` | budget → geo → ad group → keywords → RSA → goals; `ads_keyword` + `ads_campaign_criterion` artifacts |
| Keyword mutate + reuse | `googleAdsCampaignClient.test.js` | `adGroupCriteria:mutate` search-before-create |
| Geo resolve + criterion | `googleAdsGeoTargetClient.test.js`, `googleAdsCampaignClient.test.js` | `geoTargetConstants:suggest`; `campaignCriteria:mutate` |
| Idempotency contract | `idempotency.test.js`, `phase10DefinitionOfDone.test.js` | `ads_keyword`, `ads_campaign_criterion` in `ADS_CAMPAIGN_CREATION` |
| Activity error surfacing | `setupRunActivities.test.js` | `validationBucket` on intent failures |
| Structural gate | `setupRun.workflow.test.js` | Ads blocked when verification non-pass; allowed when skipped |

**Mock sign-off date:** `____________`  
**Mock test result:** `____________` (e.g. all suites PASS)

---

## Real-mode happy path (operator execution)

| Field | Value |
|-------|--------|
| **Status** | `PENDING` / `PASS` / `BLOCKED` |
| **Execution date** | `____________` |
| **Operator** | `____________` |
| **setupRunId** | `____________` |
| **customerId** | `____________` (redacted) |
| **SetupRun.status** | `____________` |
| **Structural verification** | `pass` / `skipped` / `failed` |

### Verifier output

```powershell
cd backend
npm run verify:phase10-setup-run -- <setupRunId>
```

Paste redacted JSON (exit code must be `0` for PASS):

```json
(paste verifier report here)
```

### Google Ads UI confirmation

| Check | Observed |
|-------|----------|
| PAUSED Search campaign | [ ] |
| PAUSED ad group | [ ] |
| RSA (no silent fallback copy) | [ ] |
| Keywords (PAUSED, PHRASE) | [ ] |
| Location target (resolved geo) | [ ] |
| Custom conversion goal linked | [ ] |

### Idempotency retry

| Field | Value |
|-------|--------|
| Retry date | `____________` |
| Artifact counts unchanged | [ ] |
| `idempotent: true` on activity | [ ] |

---

## Structural gate evidence (optional separate runs)

| Scenario | setupRunId | Terminal | Ads step ran? |
|----------|------------|----------|---------------|
| Snippet pending | | `GTM_SNIPPET_PENDING` | [ ] No |
| Tracking fix | | `SETUP_NEEDS_TRACKING_FIX` | [ ] No |
| GTM optional / skipped verify | | `SUCCEEDED` | [ ] Yes |

---

## Notes / blockers

`____________`
