# Zuggernaut MVP — Production Deploy

This runbook implements **Phase 14** of `mvp_implementation_plan.md`: Firebase Hosting (frontend), Railway (API + worker), MongoDB Atlas, Temporal Cloud (recommended) or self-hosted Temporal.

## Architecture

| Component | Host | Process |
|-----------|------|---------|
| React SPA | Firebase Hosting | static `frontend/dist` |
| Express API | Railway service **api** | `npm start` in `backend/` |
| Temporal worker | Railway service **worker** | `npm run temporal:worker` in `backend/` |
| MongoDB | Atlas | managed cluster |
| Temporal | Temporal Cloud (prod) or Docker (dev only) | namespace + task queue `setup-run` |

**Critical:** API and worker must share the same `MONGODB_URI`, `TOKEN_ENCRYPTION_KEY`, `TEMPORAL_*`, and Google mock/real flags. Only the API needs `JWT_SECRET` and `FRONTEND_ORIGIN`.

Run **exactly one worker** per `TEMPORAL_TASK_QUEUE` unless you add distributed rate limiting.

## 1. MongoDB Atlas

1. Create a cluster and database user with read/write on the app database.
2. Allow Railway egress IPs (or `0.0.0.0/0` for MVP with strong credentials).
3. Copy the connection string → `MONGODB_URI`.

## 2. Temporal Cloud (recommended)

1. Create a namespace (e.g. `zuggernaut-prod`).
2. Generate **mTLS** client certificate and key per Temporal Cloud docs.
3. Set on **both** Railway services (API + worker):

| Variable | Value |
|----------|--------|
| `TEMPORAL_ADDRESS` | Temporal Cloud gRPC endpoint |
| `TEMPORAL_NAMESPACE` | Cloud namespace |
| `TEMPORAL_TASK_QUEUE` | `setup-run` |
| `TEMPORAL_CLOUD_TLS` | `true` |
| `TEMPORAL_CLIENT_CERT` | Client cert PEM (or base64-encoded PEM) |
| `TEMPORAL_CLIENT_KEY` | Client key PEM (or base64-encoded PEM) |
| `TEMPORAL_SERVER_NAME_OVERRIDE` | Optional; set if Cloud docs require SNI override |

4. Disable mock flags: `TEMPORAL_E2E_MOCK` and `TEMPORAL_E2E_EMBEDDED_WORKER` must be **unset** or `false`.

For local development only, use `docker/temporal` — do not use local Temporal for production.

## 3. Railway — API service

1. New project → deploy from GitHub `backend/` root (or monorepo with root directory `backend`).
2. Use `backend/railway.toml` (start: `npm start`, healthcheck: `GET /api/v1/health`).
3. Set environment variables (see table below).
4. Note the public URL, e.g. `https://zuggernaut-api.up.railway.app`.

## 4. Railway — Worker service

1. In the same Railway project, click **New Service** → deploy from the same GitHub repo.
2. Set **Root Directory** = `backend/`.
3. Set **Config file** = `railway.worker.toml` (do not reuse the API `railway.toml` — that starts `npm start`).
4. **Start command** (if not picked up from config): `npm run temporal:worker`.
5. Copy the **same shared env vars** as the API service:

   `MONGODB_URI`, `TOKEN_ENCRYPTION_KEY`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, `TEMPORAL_CLOUD_TLS`, `TEMPORAL_CLIENT_CERT`, `TEMPORAL_CLIENT_KEY`, `TEMPORAL_SERVER_NAME_OVERRIDE`, and all Google mock/real flags.

   Omit API-only vars: `JWT_SECRET`, `FRONTEND_ORIGIN`, `PORT` (worker has no HTTP server).

6. Scale to **1 instance** for MVP. Do **not** set an HTTP `healthcheckPath` on this service — use Railway process health only.

## 5. Firebase Hosting — Frontend

1. Install Firebase CLI: `npm install -g firebase-tools`
2. `firebase login` and create/select project; update `.firebaserc` `default` project id.
3. Build with production API URL (see `frontend/.env.production.example`):

```bash
cd frontend
cp .env.production.example .env.production
# Edit VITE_API_BASE_URL to your Railway API, e.g. https://YOUR-RAILWAY-API.up.railway.app/api/v1
npm run build
cd ..
firebase deploy --only hosting
```

4. Set `FRONTEND_ORIGIN` on the API to your Firebase URL, e.g. `https://zuggernaut-mvp.web.app`.

## Environment variables

### API + Worker (shared)

| Variable | Production |
|----------|------------|
| `MONGODB_URI` | Atlas connection string |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex (generate once, store in Railway secrets) |
| `TEMPORAL_ADDRESS` | Temporal Cloud gRPC host |
| `TEMPORAL_NAMESPACE` | Cloud namespace |
| `TEMPORAL_TASK_QUEUE` | `setup-run` |
| `GOOGLE_OAUTH_MOCK` | `false` when using real Google |
| `GTM_API_MOCK` / `GOOGLE_ADS_API_MOCK` / `GBP_API_MOCK` | `false` for real integrations |
| `GTM_API_ENABLED` / `GOOGLE_ADS_API_ENABLED` / `GBP_API_ENABLED` | `true` when credentials ready |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client |
| `API_PUBLIC_BASE_URL` or `GOOGLE_OAUTH_REDIRECT_URI` | Railway API origin / OAuth callback URL |
| `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Ads MCC flow |
| `GOOGLE_ADS_MCC_REFRESH_TOKEN` | MCC admin refresh token (server secret) |
| `TEMPORAL_CLOUD_TLS` / `TEMPORAL_CLIENT_CERT` / `TEMPORAL_CLIENT_KEY` | `true` + mTLS PEM (or base64) for Temporal Cloud |

### API only

| Variable | Production |
|----------|------------|
| `JWT_SECRET` | ≥32 characters |
| `FRONTEND_ORIGIN` | Firebase hosting URL |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |

### Never set in production

- `TEMPORAL_E2E_MOCK=true` (Playwright only)
- `TEMPORAL_E2E_EMBEDDED_WORKER=true` (Playwright `start:e2e` only)
- `ENABLE_INTEGRATION_DIAGNOSTICS=true`
- Committed `.env` files

## Post-deploy verification

1. `GET https://<api>/api/v1/health` → `orchestration.taskQueue` = `setup-run`.
2. Worker logs: `Temporal worker ready — polling for tasks`.
3. Register → onboard → connect Google (real or staged mock) → start setup → progress/report pages update.
4. Operator checklist: `dev-tools/docs/MANUAL_E2E_CHECKLIST.md` and `dev-tools/docs/REAL_MODE_E2E_CHECKLIST.md`.

## Self-hosted Temporal (production)

Phase 14 recommends **Temporal Cloud** for MVP operations. Self-hosted Temporal (`docker/temporal`) is for **local development only** — revisit production hosting before launch if Cloud is not used.

## CI vs production

GitHub Actions (`.github/workflows/ci.yml`) runs unit tests and Playwright smoke with in-memory Mongo + `TEMPORAL_E2E_MOCK` / `TEMPORAL_E2E_EMBEDDED_WORKER` (see `frontend/playwright.config.ts` and `backend/scripts/start-e2e-api.js`). Production deploy is **manual** per this runbook until a staging pipeline is added — do not copy CI mock flags to Railway.
