# Phase 7 — Google Ads failure validation evidence log

**Checklist:** [`../PHASE7_GOOGLE_ADS_FAILURE_VALIDATION.md`](../PHASE7_GOOGLE_ADS_FAILURE_VALIDATION.md)

---

## Track B — Automated regression (run first)

```powershell
cd backend
npx jest tests/adsCampaignIntentService.test.js tests/adsAutoCampaignService.test.js tests/googleAdsGeoTargetClient.test.js tests/setupRunReport.test.js --runInBand
```

| Field | Value |
|-------|--------|
| **Date** | `____________` |
| **Operator** | `____________` |
| **Result** | `PASS` / `FAIL` |
| **Notes** | `____________` |

### Code coverage matrix

| Scenario | Code | Bucket | Test file | Status |
|----------|------|--------|-----------|--------|
| Keyword invalid chars | `ADS_INTENT_KEYWORD_INVALID_CHARS` | `keywords` | `adsCampaignIntentService.test.js` | |
| Keyword too many words | `ADS_INTENT_KEYWORD_TOO_MANY_WORDS` | `keywords` | `adsCampaignIntentService.test.js` | |
| RSA headline count | `ADS_INTENT_RSA_HEADLINE_COUNT` | `ad` | `adsCampaignIntentService.test.js` | |
| Missing conversion IDs (intent) | `ADS_INTENT_MISSING_CONVERSION_ACTIONS` | `conversions` | `adsCampaignIntentService.test.js` | |
| Geo unresolved (client) | `ADS_INTENT_UNRESOLVED_GEO` | `geo` | `googleAdsGeoTargetClient.test.js` | |
| Geo unresolved (orchestration) | `ADS_INTENT_UNRESOLVED_GEO` | `geo` | `adsAutoCampaignService.test.js` | |
| Missing conversion artifacts | `ADS_MISSING_CONVERSIONS` | `preconditions` | `adsAutoCampaignService.test.js` | |

---

## Track A — Real-mode E2E

**Environment:** `GOOGLE_ADS_API_MOCK=false`, `GOOGLE_ADS_API_ENABLED=true`, sandbox customer with billing.

### A1 — Unresolved geo targeting

| Field | Value |
|-------|--------|
| **Status** | `PENDING` / `PASS` / `BLOCKED` |
| **Date** | `____________` |
| **businessId** | `____________` |
| **setupRunId** | `____________` |
| **serviceAreas[0]** | `____________` |
| **Step status** | `____________` |
| **details.code** | `____________` |
| **details.validationBucket** | `____________` |
| **details.field** | `____________` |
| **Campaign artifacts created?** | `yes` / `no` |
| **UI screenshot / notes** | `____________` |

### A2 — Missing conversion actions

| Field | Value |
|-------|--------|
| **Status** | `PENDING` / `PASS` / `BLOCKED` |
| **Date** | `____________` |
| **businessId** | `____________` |
| **setupRunId** | `____________` |
| **ads_conversion_action artifact count** | `____________` |
| **Step status** | `____________` |
| **details.code** | `____________` |
| **details.validationBucket** | `____________` |
| **details.field** | `____________` |
| **Campaign artifacts created?** | `yes` / `no` |
| **UI screenshot / notes** | `____________` |

---

## Sign-off

| Field | Value |
|-------|--------|
| **Phase 7 status** | `PASS` / `BLOCKED` |
| **Operator** | `____________` |
| **Date** | `____________` |
| **Blockers (if any)** | `____________` |
