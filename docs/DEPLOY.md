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
2. Generate API key / mTLS credentials per Temporal Cloud docs.
3. Set on **both** Railway services:
   - `TEMPORAL_ADDRESS=<cloud-grpc-endpoint>`
   - `TEMPORAL_NAMESPACE=<namespace>`
   - `TEMPORAL_TASK_QUEUE=setup-run`
4. Disable mock flags: `TEMPORAL_E2E_MOCK` must be **unset** or `false`.

For local development only, use `docker/temporal` — do not use local Temporal for production.

## 3. Railway — API service

1. New project → deploy from GitHub `backend/` root (or monorepo with root directory `backend`).
2. Use `backend/railway.toml` (start: `npm start`).
3. Set environment variables (see table below).
4. Note the public URL, e.g. `https://zuggernaut-api.up.railway.app`.

## 4. Railway — Worker service

1. Add a **second service** in the same project, same repo, root `backend/`.
2. Override start command: `npm run temporal:worker`.
3. Copy the **same** env vars as API except omit `PORT` exposure needs.
4. Scale to **1 instance** for MVP.

## 5. Firebase Hosting — Frontend

1. Install Firebase CLI: `npm install -g firebase-tools`
2. `firebase login` and create/select project; update `.firebaserc` `default` project id.
3. Build with production API URL:

```bash
cd frontend
# Point SPA at Railway API (cross-origin)
echo "VITE_API_BASE_URL=https://YOUR-RAILWAY-API.up.railway.app/api/v1" > .env.production
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
| `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Ads MCC flow |

### API only

| Variable | Production |
|----------|------------|
| `JWT_SECRET` | ≥32 characters |
| `FRONTEND_ORIGIN` | Firebase hosting URL |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |

### Never set in production

- `TEMPORAL_E2E_MOCK=true` (Playwright only)
- Committed `.env` files

## Post-deploy verification

1. `GET https://<api>/api/v1/health` → `orchestration.taskQueue` = `setup-run`.
2. Worker logs: `Temporal worker ready — polling for tasks`.
3. Register → onboard → connect Google (real or staged mock) → start setup → progress/report pages update.
4. Operator checklist: `backend/tests/MANUAL_E2E_CHECKLIST.md` and `backend/tests/REAL_MODE_E2E_CHECKLIST.md`.

## CI vs production

GitHub Actions (`.github/workflows/ci.yml`) runs unit tests and Playwright smoke with in-memory Mongo + `TEMPORAL_E2E_MOCK`. Production deploy is **manual** per this runbook until a staging pipeline is added.
