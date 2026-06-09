# Real-Mode E2E Checklist (Phase 4)

Execute this checklist **after** mock-mode sign-off ([`MANUAL_E2E_CHECKLIST.md`](./MANUAL_E2E_CHECKLIST.md) Phase 2 PASS). Uses live Google APIs, OAuth, Temporal worker, and MongoDB.

**Preflight:** from `backend/` run `npm run verify:real-mode-env` (must exit 0 before starting).

**Environment:** [`backend/.env.example`](../.env.example) real-mode column. **Do not** set `TEMPORAL_E2E_MOCK` in real runs.

**Evidence:** capture each run using [`V1_REMEDIATION_EXECUTION.md`](../../V1_REMEDIATION_EXECUTION.md#evidence-capture-template). Store artifacts under `backend/tests/evidence/phase4-real/`.

---

## Phase 4 status

| Field | Value |
|-------|--------|
| **Status** | **BLOCKED** (2026-05-31 — execution started; Ads credentials + worker Mongo pending) |
| **Decision date** | 2026-05-31 |
| **Reason** | Preflight blocked on `GOOGLE_ADS_DEVELOPER_TOKEN` and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only. Temporal + Mongo + worker are up (2026-05-31). |
| **Target completion** | Operator adds Ads credentials + confirms Mongo reachability; then run checklist |

---

## Prerequisites (live stack)

- [ ] `npm run verify:real-mode-env` passes in `backend/`
- [ ] MongoDB Atlas (or dedicated sandbox URI) reachable
- [ ] Backend + worker share same `MONGODB_URI`, `TOKEN_ENCRYPTION_KEY`, `TEMPORAL_*`
- [ ] Temporal server reachable; **one** worker on `TEMPORAL_TASK_QUEUE`
- [ ] Frontend dev server; `FRONTEND_ORIGIN` matches SPA URL
- [ ] Google Cloud OAuth client authorized for redirect URI (`/api/v1/integrations/google/callback`)
- [ ] Google Ads developer token + MCC `GOOGLE_ADS_LOGIN_CUSTOMER_ID` approved for test customer

## Environment (real mode)

- [ ] `GOOGLE_OAUTH_MOCK=false` (or unset)
- [ ] `GTM_API_MOCK=false`, `GTM_API_ENABLED=true`
- [ ] `GOOGLE_ADS_API_MOCK=false`, `GOOGLE_ADS_API_ENABLED=true`
- [ ] `GBP_API_MOCK=false`, `GBP_API_ENABLED=true` (optional but recommended for audit path)
- [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` set
- [ ] `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` set
- [ ] `TEMPORAL_E2E_MOCK` **unset** or `false`

---

## Execution protocol

1. Use a **dedicated sandbox Google account** (not production customer data).
2. Run [`MANUAL_E2E_CHECKLIST.md`](./MANUAL_E2E_CHECKLIST.md) sections in order with real OAuth (browser consent flows).
3. Record **one evidence block per terminal state** you validate (minimum: one happy-path or legitimate terminal).
4. After any failed run, **before retrying provider mutations**, confirm idempotency: re-run `npm test` in `backend/` (idempotency suites).
5. Redact customer IDs, tokens, and refresh tokens in evidence; last-4 or `[REDACTED]` only.

---

## Acceptance criteria (Phase 4 PASS)

| Criterion | Checklist item | Evidence when PASS |
|-----------|----------------|-------------------|
| Legitimate terminal state with real API fields | Happy path or expected terminal | Evidence record + report JSON excerpt |
| Provisioning consent stops for approval | Provisioning section | `GTM_PROVISIONING_REQUIRED` / `ADS_PROVISIONING_REQUIRED` + UI screenshot |
| Failures are user-actionable | Failure / guardrail section | Terminal state + report recovery steps observed |
| Retries do not duplicate artifacts | Idempotency item | Second run artifact counts unchanged; Jest idempotency suites green |

---

## Checklist (real mode — fill on execution)

### Happy path

- [ ] Register / log in (real session cookie)
- [ ] Complete onboarding; confirm `BusinessContext`
- [ ] Connect GTM + Google Ads via **real** OAuth (not mock callback)
- [ ] Start setup run → workflow progresses (`RUNNING` → terminal)
- [ ] Terminal state: `____________` (e.g. `SUCCEEDED`, `GTM_SNIPPET_PENDING`)
- [ ] Setup report sections verified (GBP, catalog, GTM, verification, Ads as applicable)
- [ ] Provider evidence: real fields observed (redacted): `____________`

### Provisioning consent

- [ ] Path reaches `GTM_PROVISIONING_REQUIRED` or `ADS_PROVISIONING_REQUIRED` if applicable
- [ ] UI consent card; approve; **new** setup run provisions (workflow executes, not UI `/execute`)
- [ ] Evidence record attached

### Guardrails

- [ ] Missing integrations → `SETUP_NEEDS_MANUAL_REVIEW` (if tested)
- [ ] Snippet / tracking fix terminals show actionable guidance (if tested)
- [ ] Retry run: no duplicate GTM tags or Ads campaigns (compare `IntegrationArtifact` counts)

### Sign-off

- [ ] Operator name / date: `____________`
- [ ] Phase 4 status updated to **PASS** in [`V1_REMEDIATION_EXECUTION.md`](../../V1_REMEDIATION_EXECUTION.md)

---

## Quick commands

```powershell
cd backend
npm run verify:real-mode-env
npm run temporal:up          # if local Temporal
npm run temporal:worker      # separate terminal
npm start                    # API
cd ../frontend
npm run dev
```

After Phase 4 PASS, update release gate in `V1_REMEDIATION_EXECUTION.md` to **remediation complete**.
