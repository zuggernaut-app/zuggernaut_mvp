# Backend stability backlog

**Purpose:** Track real issues found during a full backend code review (2026-07). Use this when hardening for production, fixing regressions, or planning stability work — not as a substitute for [`mvp_implementation_plan.md`](../../mvp_implementation_plan.md) phase completion.

**Scope:** `backend/` — API, activities, workflows, services, models, lib, scripts, tests.

**Verdict:** Phases 0–14 are implemented; the orchestration architecture is sound. **Do not treat “phases complete” as “safe for live Google + split hosting”** until P0 items below are addressed or explicitly accepted.

---

## How to use this doc

1. Work **P0 → P1 → P2** unless a deploy blocker forces reordering (e.g. SameSite before anything user-facing).
2. When fixing an item, add a **Status** column note (`fixed`, `accepted`, `deferred`) and link the PR or commit.
3. Update **Test debt** when tests are changed from locking in bad behavior to asserting correct contracts.
4. Cross-check [`PHASE12_RELIABILITY_GUARDRAILS.md`](./PHASE12_RELIABILITY_GUARDRAILS.md) and [`docs/DEPLOY.md`](../../docs/DEPLOY.md) for overlapping ops concerns.

---

## P0 — Fix before real multi-tenant production

| ID | Issue | Primary paths | Notes |
|----|--------|---------------|--------|
| P0-1 | **Cookie `SameSite=lax` breaks split hosting** — Firebase SPA + Railway API is cross-site; `credentials: 'include'` will not send Lax cookies on XHR | `backend/lib/auth/sessionCookie.js`, `backend/app.js` (CORS), `docs/DEPLOY.md` | Need `SameSite=None; Secure` + correct CORS, or same-site reverse proxy |
| P0-2 | **SSRF on user-controlled URLs** — scrape + structural verification fetch with redirects; no private/link-local/metadata IP block | `backend/services/scraper/staticScraper.js`, `headlessScraper.js`, `robots.js`, `backend/services/capabilities/structuralVerificationService.js`, `backend/lib/validation.js` | Structural fetch also lacks `maxContentLength` (scraper caps ~2MB) |
| P0-3 | **MCC customer create uses tenant OAuth** — `createCustomerClient` should use platform MCC admin token | `backend/services/capabilities/adsProvisioningService.js` → `backend/services/integrations/googleAdsAccountClient.js` | MCC invite path correctly uses `getMccGoogleAdsAccessToken()` in `googleAdsMccLinkService.js` |
| P0-4 | **Auto-pick resources after provisioning consent** — approval ≠ choice of which account/customer | `adsProvisioningService.js` (`accessibleCustomerIds[0]`), `gtmProvisioningService.js` (first sorted GTM account) | Conflicts with discovery contract (“never auto-select”) |
| P0-5 | **GTM `awct` tags use wrong Ads fields** — `conversionId` / `conversionLabel` must come from tag snippets, not customer ID + conversion-action API id | `backend/services/capabilities/gtmTemplates/v1.js`, catalog/create clients (no `tag_snippets` today) | Tags can publish but not attribute conversions in production |
| P0-6 | **Conversion-action create ignores idempotency** — `void idempotencyKey` on live mutate path | `backend/services/integrations/googleAdsConversionActionClient.js`, `adsConversionActionManagementService.js` | Retries can duplicate Google Ads conversion actions |
| P0-7 | **Token refresh overwrites `connectionHealth`** — forces `connected` after refresh, clobbering `selection_required` / `provisioning_required` | `backend/services/integrations/googleTokenService.js` | Amplified by `setupReadyConnectionService` default `attemptRefresh: true` |
| P0-8 | **`scrape.workflow` non-determinism** — `new Date().toISOString()` when `startedAt` omitted | `backend/workflows/scrape.workflow.js` | Require `startedAt` from API or fail closed; no `Date` in workflow code |

---

## P1 — Important correctness / ops

| ID | Issue | Primary paths |
|----|--------|---------------|
| P1-1 | **`pauseAdsCampaign` skips `resolveGoogleAdsCustomerAuth`** — compensation pause fails under active MCC link | `backend/services/integrations/googleAdsCampaignClient.js`, `setupRunCompensationService.js` |
| P1-2 | **Failed compensation pause still marks “applied”** — idempotent skip forever even when pause `outcome: 'failed'` | `backend/services/compensation/setupRunCompensationService.js` |
| P1-3 | **Discovery wipe can drop `customerId` / `mccLink`** | `backend/services/capabilities/googleAdsSetupService.js` |
| P1-4 | **Check-then-act races** — conversion/campaign/GTM create, compensation meta (no claim-before-mutate / CAS) | `adsConversionActionManagementService.js`, `adsAutoCampaignService.js`, `gtmConversionSetupService.js`, `setupRunCompensationService.js` |
| P1-5 | **Provisioning status not CAS’d** — concurrent execute or crash can strand `provisioning` | `adsProvisioningService.js`, `gtmProvisioningService.js`, `integrationProvisioningService.js` |
| P1-6 | **Empty OAuth `scope` assumed full grant** | `backend/services/integrations/googleOAuthService.js` |
| P1-7 | **Raw provider errors to API/logs** — `errorMessage: err.message`, full `responseBody` on some Ads/GTM failures | Provisioning services, `googleAdsCampaignClient.js`, `googleTagManagerClient.js` |
| P1-8 | **Report says campaign “live”** — V1 creates **PAUSED** campaigns | `backend/services/reports/setupRunReportService.js`, `frontend/src/pages/SetupReportPage.tsx` |
| P1-9 | **Mountain View geo fallback** for placeholder service areas | `backend/services/capabilities/businessContextAdsReadinessService.js` |
| P1-10 | **Catalog after manage** — workflow order can false-fail if Ads read lags new actions | `backend/workflows/setupRun.workflow.js`, `adsConversionCatalogService.js` |
| P1-11 | **Ads campaign failure throws in workflow** — Temporal run fails vs soft `terminal: failed` like other steps | `setupRun.workflow.js`, `createAdsCampaignActivity` in `setupRunActivities.js` |
| P1-12 | **Temporal client sticky failure** — rejected `clientPromise` not reset | `backend/lib/temporalClient.js` |
| P1-13 | **In-process rate limits only** — multi-replica workers multiply provider QPS | `backend/lib/providerRateLimit.js` |

---

## P2 — Lower priority / hygiene

| ID | Issue | Primary paths |
|----|--------|---------------|
| P2-1 | Logger has no redaction paths | `backend/lib/observability/logger.js` |
| P2-2 | Token encryption JSDoc wrong (iv/tag/ciphertext layout) | `backend/lib/crypto/tokenEncryption.js` |
| P2-3 | `ProviderSnapshot` “immutable” not enforced — services upsert with `immutable: false` | `backend/models/ProviderSnapshot.js`, catalog/GTM services |
| P2-4 | No “one active SetupRun per business” DB constraint | `backend/models/SetupRun.js` |
| P2-5 | Duplicate Mongoose indexes (`unique` + `index`) | `User.js`, `BusinessContext.js` |
| P2-6 | `workers/` is empty placeholder; real entry is `scripts/temporal-worker.js` | `backend/workers/index.js` |
| P2-7 | `temporal-demo-workflow.js` hardcodes `tls: false`, fake `setupRunId` | `backend/scripts/temporal-demo-workflow.js` |
| P2-8 | `seed-test-data.js` incomplete cleanup (no `ScrapeRun` / `IntegrationProvisioningRequest`); prod URI hazard | `backend/scripts/seed-test-data.js` |
| P2-9 | Dead `googleAdsCreationDiagnosticsClient.js` — weaker auth if wired | `backend/services/integrations/` |
| P2-10 | GAQL unescaped `resourceName` in MCC invite follow-up | `googleAdsAccountClient.js` |
| P2-11 | Geo suggest skips MCC auth resolve | `googleAdsGeoTargetClient.js` |
| P2-12 | GTM rediscovery merge without re-validating accessibility | `providerDiscoveryResult.js` |
| P2-13 | `setupRunFixtures` — `withGbp` on `createConfirmedBusiness` is ignored (only on `connectGoogleIntegrations`) | `backend/tests/fixtures/setupRunFixtures.js` |
| P2-14 | Password max length uses code points not UTF-8 bytes (bcrypt truncates bytes) | `backend/lib/auth/validateCredentials.js` |

---

## Test suite debt

Tests are broad and mock-first (MongoMemoryServer). Several suites **encode bad contracts** or **miss** known bugs.

| Problem | Evidence |
|---------|----------|
| Locks in Ads `accessibleCustomerIds[0]` auto-pick | `backend/tests/adsProvisioningService.test.js` |
| Asserts refresh → `connectionHealth: 'connected'` | `backend/tests/googleTokenService.test.js` |
| Conversion idempotency not asserted on live path | `googleAdsConversionActionClient.test.js` |
| MCC token not asserted for `createCustomerClient` | `adsProvisioningService.test.js` |
| No `pauseAdsCampaign` / MCC auth tests | compensation tests use mock only |
| GTM template tests skip `gtmPayload` conversion fields | `gtmConversionSetupService.test.js` |
| No SameSite / SSRF regression tests | `auth.test.js`, structural verification tests |
| **`GOOGLE_*_MOCK=false` can leak across files** | `setupAfterEnv.js` uses `\|\| 'true'` only on first set; partial restore in some suites |

**When fixing P0/P1:** update tests to **fail on old behavior**, not preserve it. Add global mock-flag restore in `setupAfterEnv` or per-suite `afterEach`.

---

## Strong patterns — preserve when refactoring

- Setup workflow deterministic sequencing; structural verify before Ads create (`setupRun.workflow.js`).
- Encrypted OAuth at rest; MCC refresh from env, not tenant rows (`tokenEncryption.js`, `googleTokenService.js`).
- Most Ads mutates use `resolveGoogleAdsCustomerAuth` (keep pause/geo on same path).
- Artifact `idempotencyKey` + lookup-before-create (`constants/idempotency.js`, campaign/GTM paths).
- Consent gates on `IntegrationProvisioningRequest` (partial unique index on active statuses).
- `select: false` on token fields; `safeProviderIdentifiers` in API serializers.
- Feature flags for live Google APIs (`GOOGLE_ADS_API_ENABLED`, etc.).
- Scraper same-origin follow-up URLs only (`htmlSignals.isSameOrigin`).
- Boot asserts: `assertAuthEnvironment` / `assertWorkerEnvironment`.
- Temporal Cloud mTLS via `temporalConnectionOptions.js`.

---

## Folder health (review snapshot)

| Area | Health | Main concern |
|------|--------|--------------|
| `workflows/` (setup) | Strong | Scrape `Date` determinism |
| `models/`, `constants/` | Strong | Mixed-field growth; snapshot immutability aspirational |
| `lib/auth`, `lib/crypto` | Strong | SameSite prod; no key rotation |
| `services/capabilities` | Risk concentrated | Auto-select, MCC token caller, SSRF in structural verify |
| `services/integrations` | Risk concentrated | Pause/idempotency/refresh/oauth scope |
| `services/scraper` | SSRF | No private-host guard |
| `services/compensation`, `reports` | OK V1 | Pause idempotency; “live” copy |
| `activities/` | Large but structured | `setupRunActivities.js` size; throw vs return |
| `api/v1/` | Thin, mostly fine | Cross-origin cookies |
| `scripts/` | Ops-ready | Demo/seed caveats |
| `tests/` | Broad | Locks in some bugs; env leak |
| `workers/` | Placeholder only | Use `npm run temporal:worker` |

---

## Suggested fix order

1. **Prod auth topology** — SameSite / hosting (P0-1).
2. **SSRF guard** — shared validator for scrape + structural verification (P0-2).
3. **MCC token for `createCustomerClient`** + pause via `resolveGoogleAdsCustomerAuth` (P0-3, P1-1).
4. **Stop auto-select** — explicit Ads/GTM resource selection (P0-4).
5. **Real Conversion ID/Label** → fix `gtmTemplates/v1.js` (P0-5).
6. **Conversion idempotency** + preserve `connectionHealth` on refresh (P0-6, P0-7).
7. **Scrape workflow** — require `startedAt` (P0-8).
8. **Tests** — invert lock-ins; add regressions (Test debt section).
9. **P1/P2** as capacity allows.

---

## Related docs

| Doc | Relevance |
|-----|-----------|
| [`docs/DEPLOY.md`](../../docs/DEPLOY.md) | Railway, Temporal Cloud, `FRONTEND_ORIGIN`, env parity |
| [`PHASE12_RELIABILITY_GUARDRAILS.md`](./PHASE12_RELIABILITY_GUARDRAILS.md) | Idempotency, compensation, rate limits (implemented; gaps listed above) |
| [`PHASE13_TESTING.md`](./PHASE13_TESTING.md) | E2E / embedded Temporal |
| [`PHASE14_DEPLOYMENT.md`](./PHASE14_DEPLOYMENT.md) | Operator checklist |
| [`V1_REMEDIATION_EXECUTION.md`](./V1_REMEDIATION_EXECUTION.md) | Earlier remediation phases (distinct from this backlog) |
| [`CUSTOMER_ONBOARDING_HARDENING.md`](./CUSTOMER_ONBOARDING_HARDENING.md) | Tier 0–3 customer-readiness plan (RCA + one-shot checklist) |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-28 | Initial backlog from full `backend/` code review (folder-by-folder). |
