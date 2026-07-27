# Phase 8 — GTM conversion setup evidence log

**Checklist:** [`../PHASE8_GTM_CONVERSION_SETUP.md`](../PHASE8_GTM_CONVERSION_SETUP.md)

---

## Automated regression (Tasks 2–7)

```powershell
cd backend
npx jest tests/gtmConversionSetupService.test.js tests/gtmProvisioningService.test.js tests/gtmResourceSelectionService.test.js tests/setupRun.workflow.test.js --runInBand
```

| Field | Value |
|-------|--------|
| **Date** | 2026-07-20 |
| **Operator** | Composer (automated) |
| **Result** | `PASS` |
| **Suites** | 5 passed |
| **Tests** | 44 passed |
| **Notes** | Includes workflow order assertions and GTM conversion idempotency/snapshot tests. |

### Inventory / verification matrix

| Check | Evidence | Status |
|-------|----------|--------|
| Idempotency before creates | `gtmConversionSetupService.js` + retry test | PASS |
| Four V1 trigger templates | `gtmTemplates/v1.js` | PASS |
| Precondition error codes | `gtmConversionSetupService.test.js` + activity `nonRetryable` | PASS |
| Ads → GTM → verify → Ads campaign order | `setupRun.workflow.js` + `setupRun.workflow.test.js` | PASS |
| `ProviderSnapshot` `gtm_container_version` | `gtmConversionSetupService.js` + persistence tests | PASS |
| Provisioning / `GTM_PROVISIONING_REQUIRED` | `gtmProvisioningService.test.js` + workflow gate | PASS |

---

## Real-mode GTM E2E — **PENDING**

**Environment:** `GTM_API_MOCK=false`, `GTM_API_ENABLED=true`, connected GTM with provisioned container/workspace, Ads conversions managed on same Setup Run.

| Field | Value |
|-------|--------|
| **Status** | `PENDING` |
| **Reason** | Same product constraint as Phase 7 Track A: no reliable rerun / dev injection path documented for forcing GTM failure or re-publish scenarios from UI alone. |
| **Interim** | Mock-mode Jest + integration tests exercise create/publish/snapshot paths; operator may optionally run one happy-path real-mode Setup Run and record `setupRunId` below. |

### Optional happy-path real-mode run

| Field | Value |
|-------|--------|
| **Date** | `____________` |
| **businessId** | `____________` |
| **setupRunId** | `____________` |
| **GTM step** | `____________` |
| **Published version** | `____________` |
| **Result** | `PASS` / `FAIL` / `SKIPPED` |
