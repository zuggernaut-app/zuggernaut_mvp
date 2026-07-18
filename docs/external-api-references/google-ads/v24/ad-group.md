# AdGroup (Bucket 2)

Created after campaign shell via `AdGroupService.MutateAdGroups`.

## Official sources

| Type | URL |
|------|-----|
| Resource fields | https://developers.google.com/google-ads/api/fields/v24/ad_group |
| RPC `AdGroup` | https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroup |
| API structure | https://developers.google.com/google-ads/api/docs/concepts/api-structure |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/adGroups:mutate
```

Implemented in `googleAdsCampaignClient.js` → `createAdGroup`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `name` | `intent.adGroup.name` | Required on create; fewer than 255 UTF-8 full-width chars; no null/NL/CR | `{businessName} — Core` |
| `campaign` | Campaign resource name from prior step | Immutable parent campaign resource name | Required |
| `status` | `PAUSED` | Enum `AdGroupStatus` | Fixed `PAUSED` |
| `type` | `SEARCH_STANDARD` | Enum `AdGroupType` | Fixed for Search RSA flow |

## Validation in codebase

- `validateCampaignIntent` → `adGroup.name`, `adGroup.type`, `adGroup.status`
- Codes: `ADS_INTENT_INVALID_AD_GROUP_*`

## Idempotency

- Lookup by ad group name + campaign resource name before create
- Recover from `DUPLICATE_ADGROUP_NAME` via second lookup

## Notes

- Ad group IDs are unique per ad group globally, but criterion/ad IDs are scoped to ad group.
