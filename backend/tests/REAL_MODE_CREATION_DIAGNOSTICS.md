# Real-Mode Creation Diagnostics Runbook (Phase 10)

Manual checklist for **Dev Integrations → External creation diagnostics**. Uses live Google APIs and creates real (paused / prefixed) test resources. **Not** part of CI — run only in a dedicated sandbox Google account.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Backend running | `npm start` in `backend/` after env is configured |
| Frontend dev server | `npm run dev` in `frontend/` |
| MongoDB | Same URI as backend (`MONGODB_URI`) |
| Diagnostics enabled | `ENABLE_INTEGRATION_DIAGNOSTICS=true` in `backend/.env` |
| Frontend flag | `VITE_ENABLE_INTEGRATION_DIAGNOSTICS=true` in `frontend/.env` |
| Real APIs | `GOOGLE_OAUTH_MOCK=false`, `GTM_API_MOCK=false`, `GOOGLE_ADS_API_MOCK=false` |
| API switches | `GTM_API_ENABLED=true`, `GOOGLE_ADS_API_ENABLED=true` |
| OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` with redirect to `/api/v1/integrations/google/callback` |
| Ads credentials | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (if using MCC) |
| Ads API version | `GOOGLE_ADS_API_VERSION=v24` (or your approved version) |

**Preflight (recommended):** `npm run verify:real-mode-env` from `backend/`.

---

## OAuth scopes required

### Google Ads (`google_ads`)

- `https://www.googleapis.com/auth/adwords`

### GTM (`gtm`)

- `https://www.googleapis.com/auth/tagmanager.edit.containers`
- `https://www.googleapis.com/auth/tagmanager.publish`
- `https://www.googleapis.com/auth/tagmanager.manage.accounts`

Connect each provider separately from **Dev Integrations** on the **same sandbox `businessId`**.

---

## Google Cloud APIs to enable

- Google Ads API
- Google Tag Manager API
- Google OAuth (Cloud Console → APIs & Services → Credentials)

---

## How to connect

1. Open `http://localhost:5173/dev/integrations` (logged in).
2. Copy the **Sandbox business** ID shown on the page.
3. For each provider, click **Connect (OAuth)** and complete consent.
4. Run **Smoke test (read-only)** — must pass before creation diagnostics.
5. In each provider card, use **Google Ads account selection** or **GTM resource selection**:
   - Pick an **active client** Google Ads account (not manager, not cancelled).
   - Pick the GTM **account**, **container**, and **workspace** to target.
   - Click **Save Google Ads selection** or **Save GTM selection**.
6. Confirm the provider card shows **Connected** (not “Account selection needed”) and `providerIdentifiers` include `customerId` (Ads) or `accountId` / `containerId` / `workspaceId` (GTM).

---

## How to run diagnostics

### UI (recommended)

1. Complete OAuth and explicit account/container selection above.
2. Scroll to **External creation diagnostics**.
2. Select mode:
   - **Validate only** — no external creates (all steps skipped).
   - **Create paused** — default; creates resources; GTM does **not** publish.
   - **Create and publish** — GTM only; publishes container version.
3. Check **I understand this creates real external test resources**.
4. Click **Run Google Ads creation diagnostic** or **Run GTM creation diagnostic**.
5. Review step list, resource IDs, and artifacts panel.

### API

List and save selections:

```http
GET /api/v1/dev/integrations/google_ads/resources?businessId=<sandbox-business-id>
POST /api/v1/dev/integrations/google_ads/selection
{ "businessId": "<sandbox-business-id>", "customerId": "1234567890" }

GET /api/v1/dev/integrations/gtm/resources?businessId=<sandbox-business-id>
POST /api/v1/dev/integrations/gtm/selection
{
  "businessId": "<sandbox-business-id>",
  "accountId": "...",
  "containerId": "...",
  "workspaceId": "..."
}
```

Run diagnostics:

```http
POST /api/v1/dev/integrations/google_ads/create-diagnostics
POST /api/v1/dev/integrations/gtm/create-diagnostics
Content-Type: application/json

{
  "businessId": "<sandbox-business-id>",
  "mode": "create_paused",
  "confirmCreateExternalResources": true
}
```

Fetch run details:

```http
GET /api/v1/dev/integrations/diagnostic-runs/<diagnosticRunId>?businessId=<sandbox-business-id>
```

### CLI trace (Phase 8)

```bash
cd backend
npm run debug:dev-integrations-flow -- <businessId> --provider gtm --creation-diagnostics
npm run debug:dev-integrations-flow -- <businessId> --provider google_ads --creation-diagnostics --mode create_paused
npm run debug:dev-integrations-flow -- <businessId> --provider gtm --creation-diagnostics --mode create_and_publish --json
```

**Important:** Always pass `--provider gtm` or `--provider google_ads`. Bare `gtm` as a positional argument is **not** parsed as the provider.

Creation diagnostics **do not** start Temporal workflows.

---

## Expected results (V1 matrix)

### Google Ads (17 steps)

Budget → paused Search campaign → location/language/schedule → ad group → RSA → broad/phrase/exact keywords → conversion action → sitelink + callout (+ call if phone on business) → remarketing list (optional) → negative keyword list → offline import dry-run.

All created campaigns/ads use **PAUSED** status. Budget delivery is **STANDARD**.

### GTM (10 steps)

Container (or use connected) → workspace → built-in variables → data layer variable → page view + custom event triggers → GA4 tag (if measurement ID) → Ads conversion tag (if conversion ID/label) → container version → publish (only in `create_and_publish`).

---

## What skipped steps mean

| Step | Typical skip reason |
|------|---------------------|
| `publish_version` | Default `create_paused` mode — use `create_and_publish` to publish |
| `ga4_config_tag` | No GA4 measurement ID on business; set `goals.ga4MeasurementId` or `GTM_DIAGNOSTIC_GA4_MEASUREMENT_ID` |
| `google_ads_conversion_tag` | No conversion ID/label; set business goals or `GTM_DIAGNOSTIC_GOOGLE_ADS_CONVERSION_*` env |
| `asset_call` | No phone number on `BusinessContext.contactMethods` |
| `remarketing_user_list` | Account does not support the test remarketing list shape |
| All steps | `validate_only` mode selected |
| Entire run | `MISSING_CONNECTION`, `INSUFFICIENT_SCOPES`, or `PROVISIONING_REQUIRED` |

Skipped optional steps are **OK** (`ok: true`, `skipped: true`). Required step failures stop the run.

---

## Finding created resources in Google UI

### Google Ads

- Open [Google Ads](https://ads.google.com/) → select the connected customer.
- **Campaigns** — look for names prefixed with `ZUG_DEV_TEST_`.
- Confirm campaign and ad group status is **Paused**.
- **Goals → Conversions** — diagnostic conversion action.
- **Assets** — sitelink/callout extensions linked to the test campaign.

### GTM

- Open [tagmanager.google.com](https://tagmanager.google.com/).
- Navigate to the connected account → container → workspace used in diagnostics.
- Tags / Triggers / Variables tabs show `ZUG_DEV_TEST_*` resources.
- **Versions** — diagnostic container version (publish only if you used `create_and_publish`).

Artifact rows in the API/UI include `resourcePath` and `externalUrl` when available.

---

## Cleanup guidance

1. Every created resource is recorded in `IntegrationDiagnosticArtifact` with `cleanupStatus: pending`.
2. Query artifacts: `GET /api/v1/dev/integrations/diagnostic-runs/:id?businessId=...`
3. **V1 does not auto-delete** — no delete scopes requested by design.
4. Manual cleanup:
   - **Ads:** pause/remove test campaigns prefixed `ZUG_DEV_TEST_` in Google Ads UI.
   - **GTM:** delete or archive test tags/triggers/variables in the diagnostic workspace; discard unpublished workspace changes if you did not publish.
5. Update `cleanupStatus` in Mongo later when a cleanup automation phase is added.

---

## Safety reminders

- Resources are prefixed with `ZUG_DEV_TEST_` plus business/step suffix.
- Google Ads campaigns and ads default to **PAUSED** — no spend intent.
- GTM **does not publish** unless you explicitly choose `create_and_publish`.
- Offline conversion import is **validation only** — no real GCLID uploads.
- Never enable `ENABLE_INTEGRATION_DIAGNOSTICS` in production.

---

## Evidence capture (optional)

Store under `backend/tests/evidence/phase4-real/` or a dated folder:

- `businessId`, `diagnosticRunId`, `mode`, `provider`
- Redacted step summary JSON from CLI `--json` or API GET
- Screenshot of Dev Integrations results panel
- Note any skipped optional steps and why
