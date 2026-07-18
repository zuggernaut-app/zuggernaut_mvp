# Campaign Location Targeting (Bucket 3)

Created as `CampaignCriterion` with `location` via `CampaignCriterionService.MutateCampaignCriteria`.

## Official sources

| Type | URL |
|------|-----|
| Resource fields | https://developers.google.com/google-ads/api/fields/v24/campaign_criterion |
| RPC `CampaignCriterion` | https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignCriterion |
| Location targeting guide | https://developers.google.com/google-ads/api/docs/targeting/location-targeting |
| Geo suggest | https://developers.google.com/google-ads/api/docs/targeting/location-targeting (SuggestGeoTargetConstants) |
| `GeoTargetConstantService` | Listed in [overview.md](./overview.md) |

## Suggest endpoint (resolve labels → constants)

```
POST /v24/geoTargetConstants:suggest
```

**Important:** This endpoint is **not** customer-scoped. Correct path:

```
geoTargetConstants:suggest
```

NOT `customers/{customer_id}/geoTargetConstants:suggest`.

Implemented in `googleAdsGeoTargetClient.js` → `resolvePrimaryGeoTargetConstant`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `campaign` | Campaign resource name | Required parent | From prior step |
| `location.geo_target_constant` | Resolved geo target | Resource name `geoTargetConstants/{criterion_id}` | From `primaryServiceArea` label via suggest + `pickBestGeoSuggestion` |
| `negative` | (not set) | Boolean; false = target, true = exclude | Positive location target only in V1 |

## Resolution flow

1. Read `primaryServiceArea` from ads-ready `BusinessContext`
2. Call `geoTargetConstants:suggest` with location name(s)
3. Pick best suggestion (exact name/canonical match, prefer `City`, country tiebreaker)
4. Persist resolved constant on `CampaignPlan.intent.geoTargets[]`
5. Mutate campaign criterion with resolved resource name

## Validation in codebase

- `validateCampaignIntent` → `geoTargetLabels`, `geoTargets[].resourceName`
- Codes: `ADS_INTENT_MISSING_GEO_TARGET_LABELS`, `ADS_INTENT_UNRESOLVED_GEO`, `ADS_INTENT_INVALID_GEO_TARGET`
- Regex for resource name: `^geoTargetConstants/[a-zA-Z0-9_-]+$`

## Idempotency

- Lookup by campaign + geo target constant before create
- Recover duplicate criterion errors via second lookup

## Notes

- Prefer `ENABLED` geo targets; Google may deprecate locations (`REMOVAL_PLANNED`).
- Ambiguous city names (e.g. multiple "Mountain View") require disambiguation — use country code bias (default `US` in client).
