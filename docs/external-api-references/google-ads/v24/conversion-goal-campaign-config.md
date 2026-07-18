# ConversionGoalCampaignConfig (Bucket 3)

Links a campaign to a custom conversion goal for optimization.

## Official sources

| Type | URL |
|------|-----|
| RPC `ConversionGoalCampaignConfig` | https://developers.google.com/google-ads/api/reference/rpc/v24/ConversionGoalCampaignConfig |
| Resource fields | https://developers.google.com/google-ads/api/fields/v24/conversion_goal_campaign_config |
| Mutate RPC | https://developers.google.com/google-ads/api/reference/rpc/v24/ConversionGoalCampaignConfigService/MutateConversionGoalCampaignConfigs |
| Campaign goals guide | https://developers.google.com/google-ads/api/docs/conversions/goals/campaign-goals |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/conversionGoalCampaignConfigs:mutate
```

Implemented in `googleAdsCampaignClient.js` → `linkCampaignToCustomConversionGoal`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `resource_name` | Derived from campaign ID | `customers/{customer_id}/conversionGoalCampaignConfigs/{campaign_id}` | Built in update operation |
| `custom_conversion_goal` | Custom goal resource from prior step | Valid custom conversion goal resource name | Required for V1 linkage |
| `update_mask` | `custom_conversion_goal` | Field mask on update | Set in mutate operation |

## Validation in codebase

- Depends on prior steps: conversion artifacts exist, custom goal created/reused
- `resolveConversionActionResourceName` validates conversion action resource names

## Idempotency

- Stored as `IntegrationArtifact` type `ads_conversion_goal_campaign_config`
- Logical key: `conversion_goal_campaign_config`

## Notes

- Setting a custom goal typically moves campaign to `goal_config_level=CAMPAIGN` (Google side).
- V1 does not yet tune individual `CampaignConversionGoal.biddable` flags after linkage.
