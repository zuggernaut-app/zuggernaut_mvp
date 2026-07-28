# Phase 13 — Testing (V1)

**MVP reference:** `mvp_implementation_plan.md` → Phase 13  
**Approach:** Close regression gaps in orchestration, provider clients, idempotency contract coverage, and mock-mode E2E — not a full real-mode sandbox.

---

## Testing layers → evidence

| Layer | Scope | Primary evidence |
|-------|--------|------------------|
| **Unit** | Workflow state transitions, idempotency keys, client parsing/errors, verification logic | `backend/tests/setupRun.workflow.test.js`, `backend/tests/idempotency.test.js`, `backend/tests/idempotencyContractMatrix.test.js`, `backend/tests/googleAdsConversionCatalogClient.test.js`, `backend/tests/googleTagManagerClient.mutations.test.js` |
| **Integration** | Capability services with mocked Google APIs (no Temporal) | `backend/tests/setupRun.integration.test.js`, Phase 7–12 service suites referenced by idempotency matrix |
| **E2E (mock mode)** | Real local API + embedded Temporal worker + mocked Google APIs; UI polls real setup-run status | `frontend/e2e/setup-run-complete.e2e.ts`, `frontend/e2e/setup-run.e2e.ts`, `dev-tools/docs/MANUAL_E2E_CHECKLIST.md` |

---

## Phase 13 changes (this pass)

1. **`GTM_PROVISIONING_REQUIRED` workflow tests** — `setupRun.workflow.test.js` (pending approval stop + approve/provision continue).
2. **GTM mutation client tests** — `googleTagManagerClient.mutations.test.js` (create tag/trigger/variable, publish paths).
3. **Ads conversion catalog client tests** — parsing, search failure, empty catalog error paths in `googleAdsConversionCatalogClient.test.js`.
4. **Idempotency contract matrix** — `idempotencyContractMatrix.test.js` maps each `PROVIDER_MUTATION_CONTRACT` row to a real test file/name (or explicit gap TODO).
5. **Setup-run integration branches** — `manageAdsConversionActions` + GTM provisioning branch in `setupRun.integration.test.js`.
6. **Playwright terminal run** — `setup-run-complete.e2e.ts` with embedded worker (`backend/lib/e2eTemporalStack.js`, `start-e2e-api.js`) and real `GET /api/v1/setup-runs/:id` polling to `SUCCEEDED`.

---

## Verification (commands)

```powershell
cd backend
npm test -- setupRun.workflow.test.js googleTagManagerClient.mutations.test.js googleAdsConversionCatalogClient.test.js idempotencyContractMatrix.test.js setupRun.integration.test.js

cd ../frontend
npx playwright test setup-run-complete.e2e.ts setup-run.e2e.ts
```

---

## Deferred (explicit)

| Item | Status |
|------|--------|
| Real-mode full-pipeline sandbox | Optional operator path — see `dev-tools/docs/REAL_MODE_E2E_CHECKLIST.md` |
| Temporal `TestWorkflowEnvironment` in Jest worker E2E | **Not required** — embedded worker used only in Playwright `start:e2e` stack |

---

## Sign-off

| Field | Value |
|-------|--------|
| Inventory date | 2026-07-28 |
| Mock terminal E2E | `frontend/e2e/setup-run-complete.e2e.ts` — PASS |
| Phase 13 status | `COMPLETE` |
