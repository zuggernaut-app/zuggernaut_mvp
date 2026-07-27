# Phase 8 — GTM Conversion Setup Capability

**MVP reference:** `mvp_implementation_plan.md` → Phase 8  
**Approach:** Inventory + verification of existing `gtmConversionSetupService` / `gtmTemplates/v1` / workflow wiring; close gaps only if found.

**Evidence:** [`evidence/PHASE8_GTM_CONVERSION_SETUP_EVIDENCE.md`](./evidence/PHASE8_GTM_CONVERSION_SETUP_EVIDENCE.md)

---

## Task 1 — Inventory (decision gate)

Audited: `backend/services/capabilities/gtmConversionSetupService.js`, `backend/services/capabilities/gtmTemplates/v1.js`, `runGtmConversionSetupActivity` in `backend/activities/setupRunActivities.js`, `backend/workflows/setupRun.workflow.js`.

| Phase 8 requirement | Implementation | Status |
|---------------------|----------------|--------|
| Build `GTMConversionSetupService` | `runGtmConversionSetup` in `gtmConversionSetupService.js`; exported via `capabilities/index.js` | **Met** |
| GTM identifiers on `IntegrationConnection.providerIdentifiers` | `requireSetupReadyConnection` + `validateGtmIdentifiers` before API calls | **Met** |
| Block with `GTM_PROVISIONING_REQUIRED` when no account/container/workspace | `checkGtmPreconditionsActivity` returns `outcome: 'gtm_provisioning_required'` when `getConnectionStatus` reason is `provisioning_required`; `setupRun.workflow.js` calls `ensureProviderReady(load, 'gtm')` → `checkProvisioningApprovalActivity` / `provisionGtmResourcesActivity` → terminal `GTM_PROVISIONING_REQUIRED` when approval pending | **Met** |
| After approval, create GTM account/web container via API | `provisionGtmResourcesActivity` → `gtmProvisioningService.js` (idempotent artifacts) | **Met** |
| Persist `accountId`, `containerId`, `workspaceId`, `publicContainerId` before tags | Provisioning persists identifiers on connection + artifacts before conversion setup runs | **Met** |
| Account/container creation idempotent in `IntegrationArtifact` | `gtmProvisioningService` artifact lookups | **Met** |
| Use selected conversion catalog | Reads `ads_conversion_action` artifacts from Ads manage step (`conversionArtifacts` query) | **Met** |
| Tags/triggers from versioned templates | `gtmTemplates/v1.js` (`TEMPLATE_VERSION = 1`) | **Met** |
| Publish GTM container version | `createAndPublishContainerVersion` + `container_version` artifact | **Met** |
| Store GTM resource IDs in `IntegrationArtifact` | `persistGtmArtifact` per variable/trigger/tag/version | **Met** |
| Every create checks existing artifact first | `findExistingGtmArtifact` before each create path | **Met** |

### V1 trigger templates

| MVP trigger | Template key in `v1.js` | Status |
|-------------|-------------------------|--------|
| Form confirmation page URL | `form_confirmation_page_url` (`trig_form_confirmation_url`) | **Met** |
| Form submit click | `form_submit_click` (`trig_form_submit_click`) | **Met** |
| Call `tel:` click | `call_tel_click` (`trig_call_tel_click`) | **Met** |
| Call element hint click | `call_element_hint_click` (`trig_call_element_hint_click`) | **Met** |

### Gap list (code)

| Gap | Action |
|-----|--------|
| — | **None** — all Phase 8 bullets covered by existing conversion setup + provisioning + workflow paths. |

### Stop gate (Task 1)

**Result:** Inventory passes with **no code gaps**. Proceed to automated verification (Tasks 2–7) and sign-off (Tasks 8–9).

---

## Tasks 3–7 — Verification summary

| Task | Result |
|------|--------|
| **3 Idempotency** | `findExistingGtmArtifact` runs before variable/trigger/tag creates and before `createAndPublishContainerVersion`; retry test in `gtmConversionSetupService.test.js` (`persists artifacts and snapshot idempotently on retry`). |
| **4 Templates** | All four V1 triggers present; form/call tags bind to Ads conversion labels from artifacts. |
| **5 Preconditions** | `GTM_MISSING_ADS_CONVERSIONS`, incomplete identifiers, `GTM_API_NOT_ENABLED` throw `GtmProviderPreconditionError`; activity uses `ApplicationFailure.nonRetryable` + `markStepFailed` with `details.code`. |
| **6 Workflow order** | `checkGtmPreconditionsActivity` → `ensureProviderReady('gtm')` when provisioning required → Ads gate → `manageAdsConversionActions` → `fetchAdsConversionCatalog` → `runGtmConversionSetup` (when `gtmReady`) → `runStructuralVerification` → `createAdsCampaign`; asserted in `setupRun.workflow.test.js` (22 cases). |
| **7 ProviderSnapshot** | `ProviderSnapshot` upsert `snapshotType: 'gtm_container_version'` with mock/real `source` in `runGtmConversionSetup`. |

### Non-material notes

- **GTM not connected (optional):** `checkGtmPreconditionsActivity` returns `outcome: 'not_ready'` (step skipped, `gtmOptional` meta); conversion setup and structural verification skip when GTM stays optional.
- **GTM connected, provisioning required:** `outcome: 'gtm_provisioning_required'` → workflow blocks or provisions via `ensureProviderReady('gtm')` before Ads work; not treated as optional skip.
- **Real-mode GTM E2E:** deferred optional sign-off (same constraints as Phase 7 Track A); does not block Phase 8 code stop gate.

---

## Task 2 — Automated tests (commands)

```powershell
cd backend
npx jest tests/gtmConversionSetupService.test.js tests/gtmProvisioningService.test.js tests/gtmResourceSelectionService.test.js tests/setupRun.workflow.test.js --runInBand
```

---

## Sign-off

| Field | Value |
|-------|--------|
| Inventory date | 2026-07-20 |
| Stop gate | Pass — provisioning gate wired in workflow; conversion setup unchanged |
| Automated tests | PASS — `setupRun.workflow.test.js` (22); plus conversion/provisioning suites per Task 2 command |
| Phase 8 status | `COMPLETE` (real-mode E2E sign-off **PENDING** — see evidence doc) |
