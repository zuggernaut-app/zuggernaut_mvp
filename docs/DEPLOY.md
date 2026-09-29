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

## 5. Firebase Hosting — Frontend (app SPA)

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

**Important:** The app SPA uses the **root** `firebase.json`. Do not deploy the app from `marketing/` — that directory has its own isolated Firebase config for the marketing site only.

## 5b. Firebase Hosting — Marketing site (zuggernaut.com)

Static landing page lives in `marketing/`. Copy and claims spec: `product_strategy/product/landing-page-mvp.md`.

### One-time Firebase setup

1. In [Firebase console](https://console.firebase.google.com/) → project **zuggernaut-mvp** → Hosting → **Add another site**.
2. Create site id **`zuggernaut-com`** (must match `marketing/firebase.json` `hosting.site`).
3. Do **not** modify root `firebase.json` or `.firebaserc`.

### Build

Set `APP_URL` to the **app** origin where `/register` lives (deferred until app subdomain is chosen). For smoke tests against the current SPA:

```bash
# Example — replace when app moves to app.zuggernaut.com
set APP_URL=https://zuggernaut-mvp.web.app   # Windows cmd
# $env:APP_URL="https://zuggernaut-mvp.web.app"  # PowerShell
npm run marketing:build
```

Verify every CTA in `marketing/dist/index.html` points at the same `{APP_URL}/register`.

### Preview channel (guardrail: test before custom domain)

```bash
cd marketing
firebase hosting:channel:deploy preview --expires 7d
```

Review the preview URL. Confirm CTAs, mobile layout, and sticky CTA bar.

### Production deploy (marketing only)

```bash
cd marketing
firebase deploy --only hosting:zuggernaut-com
```

The app SPA is unaffected: deploy it separately from the repo root with `firebase deploy --only hosting` (default site).

### Custom domain — zuggernaut.com (manual DNS)

**Guardrail — audit before changing DNS:**

1. Inventory current DNS records at your registrar (A, AAAA, CNAME, MX, TXT/SPF/DKIM). **Do not remove or change MX, SPF, or DKIM** unless you intend to move email.
2. Lower TTLs 24–48 hours before cutover.
3. In Firebase Hosting → site **zuggernaut-com** → Add custom domain → `zuggernaut.com`.
4. Add only the records Firebase shows (typically A/AAAA or CNAME for apex; CNAME for `www`).
5. Add `www` → redirect to apex (or apex → `www`, pick one canonical host).
6. Keep a written copy of pre-cutover records for rollback.

After DNS propagates, rebuild with the final `APP_URL` and redeploy from `marketing/`.

### Post-deploy smoke test

1. Open `https://zuggernaut.com` on desktop Chrome and iOS Safari.
2. Tap **Get started free** — lands on `{APP_URL}/register`.
3. Rollback: Firebase Hosting → Release history → Roll back to previous version.

## Session cookies and CSRF (split hosting)

Firebase Hosting (SPA) and Railway (API) are **different sites**. The API must send session cookies with `SameSite=None; Secure` so the browser includes them on cross-origin `fetch(..., { credentials: 'include' })` calls.

| Setting | Production (split hosting) | Local dev (Vite proxy) |
|---------|---------------------------|-------------------------|
| `FRONTEND_ORIGIN` | Firebase URL (required for CORS) | `http://localhost:5173` |
| `NODE_ENV` | `production` | `development` |
| Session `SameSite` | `none` (auto when prod + `FRONTEND_ORIGIN`) | `lax` (same-site via proxy) |
| `Secure` cookie flag | `true` (required for `SameSite=None`) | `false` ok on `http://localhost` (`COOKIE_SECURE=false`) |

**CSRF:** With `SameSite=None`, all cookie-authenticated mutating routes (`POST`/`PUT`/`PATCH`/`DELETE`) require a matching `X-CSRF-Token` header and `zugg_csrf` cookie (double-submit). The SPA bootstraps via `GET /api/v1/auth/csrf` on load; login/register also set the CSRF cookie.

Override defaults with `COOKIE_SAMESITE=none|lax|strict` if needed.

## Token encryption rotation

OAuth tokens are stored as `enc:v1:` ciphertext. Legacy rows without the prefix remain readable via dual-read until re-encrypted.

1. Generate a new 64-char hex key.
2. Set `TOKEN_ENCRYPTION_KEY` to the new key on **both** API and worker.
3. Set `TOKEN_ENCRYPTION_KEY_PREVIOUS` to the old key on **both** services (dual-read).
4. Stop the Temporal worker (maintenance window).
5. Run `node backend/scripts/reencryptTokens.js --dry-run`, then without `--dry-run`.
6. Verify audit output shows 100% v1 (no `would_update` / `updated` left for v0 rows).
7. Remove `TOKEN_ENCRYPTION_KEY_PREVIOUS` only after audit confirms all tokens are v1.
8. Restart the worker.

Rollback: keep `TOKEN_ENCRYPTION_KEY_PREVIOUS` set so old ciphertext remains readable; do not delete the previous key until re-encrypt completes.

## Observability (OTel) and alerts

### OpenTelemetry (Honeycomb free tier)

Set on **both** API and worker when you want traces and the `google_ads.rate_limit.hit` metric:

| Variable | Example |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://api.honeycomb.io` |
| `HONEYCOMB_API_KEY` | Honeycomb ingest key (or use `OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_KEY`) |

When unset, OTel bootstrap is a no-op (Pino logs only).

### External alerts (not app-emitted)

| Signal | Source |
|--------|--------|
| Worker down | Temporal Cloud **no task queue pollers** alert on namespace `setup-run` queue |
| Worker crash/restart | Railway process restart notification on the **worker** service |
| Setup failures | Railway log drain (e.g. Logtail/Papertrail) filtered on `level:error` + `setupRunId` |
| Google Ads 429 rate | Honeycomb dashboard on metric `google_ads.rate_limit.hit` |

## Environment variables

### API + Worker (shared)

| Variable | Production |
|----------|------------|
| `MONGODB_URI` | Atlas connection string |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex (generate once, store in Railway secrets) |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | Optional — previous key for dual-read during rotation (see **Token encryption rotation** below) |
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
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional — Honeycomb OTLP base URL |
| `HONEYCOMB_API_KEY` | Optional — Honeycomb ingest key when using OTel |

Production split hosting uses `SameSite=None; Secure` session cookies automatically when `FRONTEND_ORIGIN` is set. Ensure HTTPS on the API origin. See **Session cookies and CSRF** above.

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
