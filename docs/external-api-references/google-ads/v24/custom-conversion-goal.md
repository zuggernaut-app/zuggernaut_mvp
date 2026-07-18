# CustomConversionGoal (Bucket 3)

Links selected conversion actions into a named custom goal for campaign optimization.

## Official sources

| Type | URL |
|------|-----|
| RPC `CustomConversionGoal` | https://developers.google.com/google-ads/api/reference/rpc/v24/CustomConversionGoal |
| Campaign goals guide | https://developers.google.com/google-ads/api/docs/conversions/goals/campaign-goals |
| Custom conversion goals | https://developers.google.com/google-ads/api/docs/conversions/goals/custom-conversion-goals |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/customConversionGoals:mutate
```

Implemented in `googleAdsCampaignClient.js` → `createCustomConversionGoal`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `name` | `{businessName} — Zuggernaut Conversions` | **Globally unique within account** | Deterministic name; idempotent lookup-before-create |
| `conversion_actions[]` | Selected conversion action resource names | At least one valid conversion action resource | From `IntegrationArtifact` ads conversion catalog |
| `status` | `ENABLED` | Enum | Default enabled |

## Idempotency (required)

Google error: `customConversionGoalError:CUSTOM_GOAL_DUPLICATE_NAME`

Strategy in `createCustomConversionGoal`:
1. GAQL lookup by exact name before create
2. If duplicate-name error on mutate, lookup again and reuse

## Validation in codebase

- `validateCampaignIntent` → `selectedConversionIds` (at least one)
- `buildCustomConversionGoalCreatePayload` requires non-empty `conversionActionResourceNames`
- Code: `ADS_INTENT_MISSING_CONVERSION_ACTIONS`

## Notes

- Custom goals are separate from default `CampaignConversionGoal` biddable flags; linking is done via `ConversionGoalCampaignConfig`.
