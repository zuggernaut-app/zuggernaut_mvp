# CampaignBudget (Bucket 1)

Created before the campaign via `CampaignBudgetService.MutateCampaignBudgets`.

## Official sources

| Type | URL |
|------|-----|
| Resource fields | https://developers.google.com/google-ads/api/fields/v24/campaign_budget |
| RPC `CampaignBudget` | https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignBudget |
| Create budgets guide | https://developers.google.com/google-ads/api/docs/campaigns/budgets/create-budgets |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/campaignBudgets:mutate
```

Implemented in `googleAdsCampaignClient.js` → `createCampaignBudget`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `name` | `intent.campaign.budget.name` | Required for create in practice | `{businessName} — Daily Budget` |
| `amount_micros` | `intent.campaign.budget.amountMicros` | Daily budget in micros (1M micros = 1 currency unit); mutually exclusive with `total_amount_micros` | Default `10_000_000` micros; min `1_000_000` in validator |
| `delivery_method` | `STANDARD` | Enum `BudgetDeliveryMethod` | Fixed `STANDARD` |
| `explicitly_shared` | `false` | Whether budget is shared across campaigns | Fixed `false` (one budget per campaign in V1) |

## Validation in codebase

- `validateCampaignIntent` → `campaign.budget.name`, `campaign.budget.amountMicros`
- Constants: `MIN_DAILY_BUDGET_MICROS`, `DEFAULT_DAILY_BUDGET_MICROS` in `adsCampaignIntent.js`

## Idempotency

- Stored as `IntegrationArtifact` type `ads_campaign_budget` keyed by setup run + logical key `campaign_budget`

## Notes

- Google supports **custom period** total budgets via `period=CUSTOM_PERIOD` and `total_amount_micros`; V1 uses **daily** budgets only.
- Actual minimum spend limits may also depend on account currency and Google policy; our validator enforces a V1 floor only.
