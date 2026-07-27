# Phase 7 — Google Ads Failure Validation

Validate Google Ads campaign creation **failure paths** after Phase 10 success-path sign-off.

**Prerequisites:** Phase 10 happy path verified ([`PHASE10_REAL_MODE_E2E_CHECKLIST.md`](./PHASE10_REAL_MODE_E2E_CHECKLIST.md)). Backend + Temporal worker running for real-mode Track A.

**Evidence:** [`evidence/PHASE7_GOOGLE_ADS_FAILURE_VALIDATION_EVIDENCE.md`](./evidence/PHASE7_GOOGLE_ADS_FAILURE_VALIDATION_EVIDENCE.md)

---

## Scope split (no technical debt)

| Track | What it proves | How |
|-------|----------------|-----|
| **Track A — Real-mode E2E** | End-to-end blocking + UI/report surfacing via app-supported inputs | Manual runs with clean sandbox `businessId` / `setupRunId` per scenario |
| **Track B — Code-level coverage** | Exact `ADS_INTENT_*` validation codes for fields sanitized/generated before real-mode | Run existing Jest suites; add tests **only if a gap is found** |

**Not in real-mode scope:** keyword invalid-char / too-many-words and RSA headline-count failures — upstream sanitization and ad-copy generation prevent these from being reached via `BusinessContext` alone.

---

## Track B — Verify existing tests (run first)

From `backend/`:

```powershell
npx jest tests/adsCampaignIntentService.test.js tests/adsAutoCampaignService.test.js tests/googleAdsGeoTargetClient.test.js tests/setupRunReport.test.js --runInBand
```

Confirm these codes are covered:

| Scenario | Expected code | Expected bucket | Covered by |
|----------|---------------|-----------------|------------|
| Keyword invalid chars | `ADS_INTENT_KEYWORD_INVALID_CHARS` | `keywords` | `adsCampaignIntentService.test.js` |
| Keyword too many words | `ADS_INTENT_KEYWORD_TOO_MANY_WORDS` | `keywords` | `adsCampaignIntentService.test.js` |
| RSA headline count | `ADS_INTENT_RSA_HEADLINE_COUNT` | `ad` | `adsCampaignIntentService.test.js` |
| Missing conversion IDs in intent | `ADS_INTENT_MISSING_CONVERSION_ACTIONS` | `conversions` | `adsCampaignIntentService.test.js` |
| Geo unresolved (client) | `ADS_INTENT_UNRESOLVED_GEO` | `geo` | `googleAdsGeoTargetClient.test.js` |
| Geo unresolved (orchestration) | `ADS_INTENT_UNRESOLVED_GEO` | `geo` | `adsAutoCampaignService.test.js` |
| Missing conversion artifacts | `ADS_MISSING_CONVERSIONS` | `preconditions` | `adsAutoCampaignService.test.js` |

Record Track B result in the evidence log before starting Track A.

---

## Track A — Real-mode E2E (no code changes)

Use a **dedicated sandbox** Google account. One scenario per clean setup context.

### Protocol (every scenario)

1. Fresh `setupRunId` (or confirm no prior campaign artifacts for the run).
2. Trigger setup through the normal product flow (UI or existing dev integrations).
3. Capture:
   - Setup Progress + Setup Report UI failure state
   - `SetupStepExecution` row for `ads_campaign_creation` (`status`, `details`)
   - Proof of **no Google Ads campaign mutations** (no new `ads_campaign` / `ads_campaign_budget` / `ads_keyword` artifacts for that run)
4. Record in evidence log.

---

### Scenario A1 — Unresolved geo targeting

**Not testable in mock mode:** `GOOGLE_ADS_API_MOCK=true` always resolves geo via `buildMockGeoTarget()`. Requires real mode (`GOOGLE_ADS_API_MOCK=false`, `GOOGLE_ADS_API_ENABLED=true`).

**Data setup:**

- Confirm `BusinessContext` via PUT or onboarding UI.
- Set `serviceAreas[0]` to a fictitious label that does **not** normalize to `Mountain View`, e.g. `The Lost City of Z`.
- Ensure Ads readiness fields remain valid (website, services, goals).

**Trigger:** Start setup run through normal flow until `ads_campaign_creation`.

**Expected UI:**

- `ads_campaign_creation` step shows **failed**
- Message references geo targeting failure
- Recommended action: *Use a clearer city, region, or service area name.*

**Expected backend (`SetupStepExecution.details`):**

| Field | Expected |
|-------|----------|
| `status` | `failed` |
| `code` | `ADS_INTENT_UNRESOLVED_GEO` (or geo client equivalent) |
| `validationBucket` | `geo` |
| `field` | `geoTargetLabels` |
| Mutations | **None** — no campaign/budget/keyword artifacts |

---

### Scenario A2 — Missing conversion actions

**Data setup:**

- Use a fresh `businessId` + `setupRunId` where **no** `IntegrationArtifact` rows exist with `artifactType: 'ads_conversion_action'` for that pair.
- Do **not** run conversion catalog / manage steps that would create conversion artifacts before campaign creation.

**Trigger:** Start setup run through normal flow until `ads_campaign_creation`.

**Expected UI:**

- `ads_campaign_creation` step shows **failed**
- Message includes: *Selected Ads conversion actions are required before campaign creation.*
- **No** Google Ads campaign mutations

**Expected backend (`SetupStepExecution.details`):**

| Field | Expected |
|-------|----------|
| `status` | `failed` |
| `code` | `ADS_MISSING_CONVERSIONS` |
| `validationBucket` | `preconditions` |
| `field` | `null` |
| Mutations | **None** |

**Do not expect:** `ADS_INTENT_MISSING_CONVERSION_ACTIONS`, `validationBucket: conversions`, or `field: selectedConversionIds` — that code runs later in intent validation, not at the artifact precondition gate.

---

### Scenarios deferred to Track B only

| Original scenario | Why not real-mode E2E | Track B coverage |
|-------------------|----------------------|------------------|
| Invalid keywords | `sanitizeKeywordSeeds()` cleans/truncates; `buildKeywordSeeds()` always produces valid seeds including `{primaryService} near me` | `adsCampaignIntentService.test.js` |
| Insufficient RSA headlines | `buildAdCopySeeds()` always emits 3 headlines | `adsCampaignIntentService.test.js` |

---

## Sign-off

| Field | Value |
|-------|--------|
| Track B test result | `____________` |
| Track A — Geo scenario | `PASS` / `BLOCKED` / `SKIP` |
| Track A — Conversions scenario | `PASS` / `BLOCKED` / `SKIP` |
| Operator | `____________` |
| Date | `____________` |
| Phase 7 status | `PASS` / `BLOCKED` |

**PASS criteria:**

- Track B Jest suites green (all listed scenarios covered)
- Track A geo + missing-conversions scenarios fail as expected with no mutations
- UI and `SetupStepExecution` details match expected codes/buckets above

When complete, update the evidence log and proceed to GTM (Phase 8).
