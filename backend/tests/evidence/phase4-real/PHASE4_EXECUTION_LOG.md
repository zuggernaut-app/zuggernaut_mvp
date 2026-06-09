# Phase 4 execution log

**Started:** 2026-05-31  
**Status:** **BLOCKED** (preflight + infrastructure — not FAIL)

## Preflight (`npm run verify:real-mode-env`)

| Check | Result |
|-------|--------|
| JWT / TOKEN_ENCRYPTION_KEY | PASS |
| MONGODB_URI | PASS |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | PASS |
| GTM_API_ENABLED | PASS |
| Mock flags unset | PASS |
| FRONTEND_ORIGIN | PASS (added `http://localhost:5173`) |
| GOOGLE_ADS_API_ENABLED | PASS (added `true`) |
| GBP_API_ENABLED | PASS (added `true`) |
| GOOGLE_ADS_DEVELOPER_TOKEN | **BLOCKED** — operator must set in `backend/.env` |
| GOOGLE_ADS_LOGIN_CUSTOMER_ID | **BLOCKED** — operator must set in `backend/.env` |

**2026-05-31 update:** Preflight passes all checks except the two Ads vars above.

## Infrastructure

| Component | Result |
|-----------|--------|
| Docker / Temporal (`npm run temporal:up`) | **PASS** — `temporal` container restarted (was Exited; postgres race on first boot) |
| Temporal gRPC (`127.0.0.1:7233`) | **PASS** |
| Temporal UI | `http://localhost:8080` |
| MongoDB Atlas | **PASS** — direct replica-set URI (Windows Node `mongodb+srv` SRV lookup fails; see `.env.example`) |
| Temporal worker | **PASS** — `Temporal worker ready — polling for tasks` on queue `setup-run` |
| API | Not re-verified this session (start with `npm start` after preflight PASS) |
| Frontend | Not started (depends on preflight PASS) |

## OAuth note

Ensure Google Cloud OAuth client allows redirect URI:

`http://localhost:3000/api/v1/integrations/google/callback`

(The legacy `GOOGLE_REDIRECT_URI` key in `.env` is unused; the app derives callback from `API_PUBLIC_BASE_URL` or defaults to the path above.)

## Operator unblock (in order)

1. Add to `backend/.env`:
   - `GOOGLE_ADS_DEVELOPER_TOKEN` — from [Google Ads API Center](https://ads.google.com/aw/apicenter)
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — MCC customer ID (digits only, no dashes)
2. Confirm Google Cloud OAuth client allows redirect: `http://localhost:3000/api/v1/integrations/google/callback`
3. Start Docker Desktop, then: `cd backend && npm run temporal:up`
4. Re-run `npm run verify:real-mode-env` until exit 0
5. Execute [`REAL_MODE_E2E_CHECKLIST.md`](../../REAL_MODE_E2E_CHECKLIST.md); add evidence records below

## Evidence records

_Empty until real setup run completes. Use template in [`V1_REMEDIATION_EXECUTION.md`](../../../V1_REMEDIATION_EXECUTION.md#evidence-capture-template)._
