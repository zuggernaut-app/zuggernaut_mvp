# Ad Group Keyword (Bucket 3)

Created as `AdGroupCriterion` with `keyword` via `AdGroupCriterionService.MutateAdGroupCriteria`.

## Official sources

| Type | URL |
|------|-----|
| Resource fields | https://developers.google.com/google-ads/api/fields/v24/ad_group_criterion |
| RPC `AdGroupCriterion` | https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupCriterion |
| `KeywordInfo` proto | https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/criteria.proto |
| Criterion errors | https://developers.google.com/google-ads/api/reference/rpc/v24/CriterionErrorEnum.CriterionError |
| Criterion error proto | https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/errors/criterion_error.proto |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/adGroupCriteria:mutate
```

Implemented in `googleAdsCampaignClient.js` → `createAdGroupKeyword`, payload via `buildAdGroupKeywordCreatePayload`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google constraint | V1 policy |
|--------------|-------------------|-------------------|-----------|
| `ad_group` | Ad group resource name | Required | From prior step |
| `status` | `PAUSED` | Criterion status | Fixed `PAUSED` |
| `keyword.text` | `intent.keywords[].text` | **At most 80 characters and 10 words** | Built from `keywordSeeds`; max 80 in validator |
| `keyword.match_type` | `PHRASE` (default) | Enum: `BROAD`, `EXACT`, `PHRASE` | Default `PHRASE` |

## Relevant Google error codes

| Error | Meaning |
|-------|---------|
| `INVALID_KEYWORD_TEXT` | Invalid keyword criteria text |
| `KEYWORD_TEXT_TOO_LONG` | Text should be less than 80 chars |
| `KEYWORD_HAS_TOO_MANY_WORDS` | More than 10 words |
| `KEYWORD_HAS_INVALID_CHARS` | Invalid characters or symbols |

## V1 keyword sanitization (implemented)

Google does not publish one exhaustive list of every invalid keyword character. Zuggernaut uses a **V1 conservative allowlist policy** in `googleAdsCampaignComplianceService.js`:

1. Normalize whitespace.
2. Replace separators with spaces: `& / | + _ -`
3. Remove unsafe symbols: `# @ ! ? * % $ ^ = < > { } [ ] ( ) quotes/backticks`
4. Strip control chars, emoji, and any non-letter/non-digit characters.
5. Collapse spaces, trim.
6. Enforce max **10 words** and **80 characters** (truncate without mid-word cut when possible).
7. Dedupe after sanitization.

Examples:

| Raw seed | Sanitized keyword |
|----------|-------------------|
| `tax prep & bookkeeping` | `tax prep bookkeeping` |
| `#1 dentist near me!` | `1 dentist near me` |
| `HVAC repair/service` | `HVAC repair service` |
| `women's health clinic` | `womens health clinic` |
| `24/7 emergency plumber` | `24 7 emergency plumber` |

Validation runs in:

- `buildKeywordsFromSeeds()` during intent build
- `validateCampaignIntent()` before mutate
- `assertGoogleAdsCampaignCompliance()` in `adsAutoCampaignService.js`
- `buildAdGroupKeywordCreatePayload()` as last-mile client guard

Intent codes: `ADS_INTENT_KEYWORD_INVALID_CHARS`, `ADS_INTENT_KEYWORD_TOO_MANY_WORDS`, `ADS_INTENT_KEYWORD_SANITIZED_EMPTY`

## Idempotency

- Lookup by ad group + keyword text + match type before create
- Recover duplicate criterion errors via second lookup

## Notes

- Keywords are **immutable** on the criterion after create (change requires remove + recreate).
- Campaign-level negative keywords use `CampaignCriterion`, not covered in V1 auto-setup.
