# Campaign (Bucket 1)

Zuggernaut V1 creates **paused Search campaigns** via `CampaignService.MutateCampaigns`.

## Official sources

| Type | URL |
|------|-----|
| Resource fields | https://developers.google.com/google-ads/api/fields/v24/campaign |
| RPC `Campaign` | https://developers.google.com/google-ads/api/reference/rpc/v24/Campaign |
| Create campaigns guide | https://developers.google.com/google-ads/api/docs/campaigns/create-campaigns |
| Proto | https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign.proto |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/campaigns:mutate
```

Implemented in `backend/services/integrations/googleAdsCampaignClient.js` → `createCampaign`, payload via `buildSearchCampaignCreatePayload`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `name` | `intent.campaign.name` | Required on create; must not contain null (0x0), NL (0xA), or CR (0xD) | `{businessName} — Zuggernaut Search`; max 255 chars in our validator |
| `advertising_channel_type` | `SEARCH` | Enum; Search campaigns use `SEARCH` | Fixed `SEARCH` |
| `status` | `PAUSED` | Enum `CampaignStatus` | Fixed `PAUSED` for safe V1 launch |
| `campaign_budget` | Budget resource from prior mutate | Resource name `customers/{id}/campaignBudgets/{budget_id}` | Required; created in same setup run |
| `manual_cpc.enhanced_cpc_enabled` | `false` | Manual CPC bidding for Search | Fixed; `maximizeConversions {}` rejected on v24 in our dev diagnostics |
| `network_settings.target_google_search` | `true` | Network settings object | Search only |
| `network_settings.target_search_network` | `true` | Network settings object | Search partners on |
| `network_settings.target_content_network` | `false` | Network settings object | Display off |
| `contains_eu_political_advertising` | `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` | EU political ads declaration (v24) | Required in our create payload |

## Validation in codebase

- `validateCampaignIntent` in `adsCampaignIntentService.js` (bucket `campaign`)
- Codes: `ADS_INTENT_INVALID_CAMPAIGN_*`, `ADS_INTENT_INVALID_BUDGET_*`, `ADS_INTENT_INVALID_BIDDING`, `ADS_INTENT_INVALID_NETWORK_SETTINGS`

## Idempotency

- Lookup by exact campaign name via GAQL before create
- Recover from `DUPLICATE_CAMPAIGN_NAME` via second lookup
- See `findExistingCampaignResourceNameByName` in `googleAdsCampaignClient.js`

## Notes

- Campaign **name** uniqueness is enforced by Google Ads within an account.
- Default Google status on create is `ENABLED`; we explicitly set `PAUSED`.
