# Phase 14 — Deployment (V1)

**MVP reference:** `mvp_implementation_plan.md` → Phase 14  
**Approach:** Production runbook + Railway/Firebase/Temporal Cloud config — no new business logic.

---

## Instruction map

| Phase 14 instruction | Runbook / repo artifact | Verification |
|---------------------|-------------------------|--------------|
| Deploy frontend to Firebase Hosting | `docs/DEPLOY.md` §5, `firebase.json`, `.firebaserc`, `frontend/.env.production.example` | `npm run build` + `firebase deploy --only hosting` |
| Deploy backend API to Railway | `docs/DEPLOY.md` §3, `backend/railway.toml` (`healthcheckPath=/api/v1/health`) | `GET /api/v1/health` → `ok: true`, `orchestration.taskQueue: setup-run` |
| Deploy Temporal worker (separate process) | `docs/DEPLOY.md` §4, `backend/railway.worker.toml` | Worker logs: `Temporal worker ready — polling for tasks` |
| MongoDB Atlas | `docs/DEPLOY.md` §1, `MONGODB_URI` in `backend/.env.example` | API + worker connect; setup runs persist |
| Temporal Cloud (recommended) | `docs/DEPLOY.md` §2, `backend/lib/temporalConnectionOptions.js` | `TEMPORAL_CLOUD_TLS=true` + mTLS env on API + worker |

---

## Phase 14 changes (this pass)

1. **`docs/DEPLOY.md`** — corrected checklist paths, mTLS env contract, worker second-service steps, CI vs production separation.
2. **`backend/lib/temporalConnectionOptions.js`** — shared Temporal Cloud mTLS connect options for API + worker.
3. **`frontend/.env.production.example`** + **`backend/.env.example`** — production OAuth callback + MCC refresh token + Temporal mTLS vars.
4. **`backend/railway.worker.toml`** — reproducible worker deploy config.
5. **`backend/railway.toml`** — API healthcheck path.
6. **Production guard tests** — `assertAuthEnvironment.test.js`, `integrationDiagnosticsGate.test.js`.
7. **`backend/tests/temporalConnectionOptions.test.js`** — mTLS branch coverage.

---

## Verification (commands)

```powershell
cd backend
npm test -- temporalConnectionOptions.test.js assertAuthEnvironment.test.js integrationDiagnosticsGate.test.js

# After cloud provisioning (operator):
# GET https://<railway-api>/api/v1/health
# Worker logs on Railway worker service
# frontend/e2e/setup-run-complete.e2e.ts against staging (optional)
```

---

## Deferred (explicit — operator, not blocking V1 implementation COMPLETE)

| Item | Status |
|------|--------|
| Temporal Cloud vs self-hosted production decision | Operator — runbook recommends Cloud |
| Live Firebase / Railway / Atlas provisioning | Operator — checklist below; runbook ready |

---

## Operator provisioning checklist (operator execution of complete runbook)

**Note:** Phase 14 implementation is **COMPLETE** in-repo. Rows below track live cloud setup when you deploy — they are not missing code.

Repo deliverables (runbook, Railway/Firebase configs, mTLS wiring) are **done**. Complete these steps per `docs/DEPLOY.md` when provisioning production.

| Step | Runbook | Evidence (fill when done) | Status |
|------|---------|---------------------------|--------|
| 1. MongoDB Atlas cluster + `MONGODB_URI` | `docs/DEPLOY.md` §1 | Atlas connection string stored in Railway secrets | [ ] pending |
| 2. Temporal Cloud namespace + mTLS certs | `docs/DEPLOY.md` §2 | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_CLOUD_TLS`, cert/key on API + worker | [ ] pending |
| 3. Railway API service | `docs/DEPLOY.md` §3, `backend/railway.toml` | Public API URL; `GET /api/v1/health` → `ok: true` | [ ] pending |
| 4. Railway worker service | `docs/DEPLOY.md` §4, `backend/railway.worker.toml` | Worker logs: `Temporal worker ready — polling for tasks` | [ ] pending |
| 5. Firebase Hosting frontend | `docs/DEPLOY.md` §5, `frontend/.env.production.example` | Firebase URL; `FRONTEND_ORIGIN` set on API | [ ] pending |

**Deploy evidence:** check rows when live resources are provisioned; not a gate for Phase 14 implementation COMPLETE.

---

## Sign-off

| Field | Value |
|-------|--------|
| Inventory date | 2026-07-28 |
| Deployment runbook + configs | **COMPLETE** (repo) |
| Live cloud provisioning | Operator execution of `docs/DEPLOY.md` (outside repo) |
| Phase 14 status | `COMPLETE` |
