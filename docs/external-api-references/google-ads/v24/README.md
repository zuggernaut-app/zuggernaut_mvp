# Google Ads API v24 — Zuggernaut Reference Pack

Local reference for Phase 10 campaign creation compliance. **Official Google documentation is the source of truth**; these files summarize the fields Zuggernaut uses and link to authoritative sources.

## API version

- **Version:** v24
- **Base URL pattern:** `https://googleads.googleapis.com/v24/...`
- **RPC overview:** [overview.md](./overview.md)

## Resource references (by validation bucket)

| Bucket | Topic | Local doc |
|--------|--------|-----------|
| 1 | Campaign shell | [campaign.md](./campaign.md) |
| 1 | Campaign budget | [campaign-budget.md](./campaign-budget.md) |
| 2 | Ad group | [ad-group.md](./ad-group.md) |
| 2 | Responsive search ad | [responsive-search-ad.md](./responsive-search-ad.md) |
| 3 | Ad group keyword | [ad-group-keyword.md](./ad-group-keyword.md) |
| 3 | Campaign location targeting | [campaign-location-targeting.md](./campaign-location-targeting.md) |
| 3 | Custom conversion goal | [custom-conversion-goal.md](./custom-conversion-goal.md) |
| 3 | Conversion goal campaign config | [conversion-goal-campaign-config.md](./conversion-goal-campaign-config.md) |

## Compliance matrix

See [compliance-matrix.md](./compliance-matrix.md) for the full parameter → Google field → constraint → Zuggernaut implementation mapping.

## Related services (not separate docs yet)

| Service | Official doc |
|---------|----------------|
| Geo target suggest | [Location targeting](https://developers.google.com/google-ads/api/docs/targeting/location-targeting) |
| Conversion actions (catalog) | [Conversion actions](https://developers.google.com/google-ads/api/docs/conversions/overview) |
| GoogleAdsFieldService (metadata) | [Resource metadata](https://developers.google.com/google-ads/api/docs/concepts/field-service) |

## Code mapping

| Area | Path |
|------|------|
| Intent validation | `backend/services/capabilities/adsCampaignIntentService.js` |
| Keyword compliance | `backend/services/capabilities/googleAdsCampaignComplianceService.js` |
| Intent constants | `backend/constants/adsCampaignIntent.js` |
| Campaign mutations | `backend/services/integrations/googleAdsCampaignClient.js` |
| Geo resolution | `backend/services/integrations/googleAdsGeoTargetClient.js` |
| Orchestration | `backend/services/capabilities/adsAutoCampaignService.js` |
