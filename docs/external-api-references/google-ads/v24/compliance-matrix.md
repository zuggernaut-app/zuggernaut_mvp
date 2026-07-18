# Google Ads v24 Compliance Matrix

Maps Zuggernaut Phase 10 setup-run parameters to Google Ads API constraints, validation status, and implementation locations.

**Legend**

| Status | Meaning |
|--------|---------|
| ✅ Enforced | Validated before mutate; matches Google documented limits |
| ⚠️ Partial | Some checks exist; known gaps remain |
| ❌ Gap | Not validated; real-mode mutate can fail |
| 🔒 Fixed V1 | Hard-coded policy choice, not user-configurable |

---

## Bucket 1 — Campaign shell

| Parameter | Google resource.field | Google constraint (official) | Zuggernaut source | Validator | Mutate payload | Status |
|-----------|----------------------|------------------------------|-------------------|-----------|----------------|--------|
| Campaign name | `Campaign.name` | Required; no null/NL/CR; unique per account | `{businessName} — Zuggernaut Search` | `validateRequiredName` ≤255 | `buildSearchCampaignCreatePayload` | ✅ |
| Channel | `Campaign.advertising_channel_type` | Enum; Search = `SEARCH` | `CAMPAIGN_CHANNEL.SEARCH` | Must equal `SEARCH` | `advertisingChannelType: SEARCH` | 🔒 Fixed V1 |
| Status | `Campaign.status` | Enum `CampaignStatus` | `PAUSED` | Must equal `PAUSED` | `status: PAUSED` | 🔒 Fixed V1 |
| Budget resource | `Campaign.campaign_budget` | Valid budget resource name | Prior `createCampaignBudget` | Implicit (artifact) | `campaignBudget` | ✅ |
| Bidding | `Campaign.manual_cpc` | Manual CPC for Search V1 | `manual_cpc` | Must equal `manual_cpc` | `manualCpc.enhancedCpcEnabled: false` | 🔒 Fixed V1 |
| Network — Google Search | `Campaign.network_settings.target_google_search` | Boolean | `true` | Must be `true` | `targetGoogleSearch: true` | 🔒 Fixed V1 |
| Network — Search partners | `Campaign.network_settings.target_search_network` | Boolean | `true` | Must be `true` | `targetSearchNetwork: true` | 🔒 Fixed V1 |
| Network — Display | `Campaign.network_settings.target_content_network` | Boolean | `false` | Must be `false` | `targetContentNetwork: false` | 🔒 Fixed V1 |
| EU political ads | `Campaign.contains_eu_political_advertising` | Required declaration (v24) | N/A | Not in intent validator | `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` | ⚠️ Partial |
| Budget name | `CampaignBudget.name` | Required for create | `{businessName} — Daily Budget` | `validateRequiredName` ≤255 | `createCampaignBudget` | ✅ |
| Daily budget | `CampaignBudget.amount_micros` | Daily amount in micros | `DEFAULT_DAILY_BUDGET_MICROS` (10M) | ≥ `MIN_DAILY_BUDGET_MICROS` (1M) | `amountMicros` | ✅ |
| Budget delivery | `CampaignBudget.delivery_method` | Enum | `STANDARD` | Not in intent validator | `deliveryMethod: STANDARD` | 🔒 Fixed V1 |
| Shared budget | `CampaignBudget.explicitly_shared` | Boolean | `false` | Not in intent validator | `explicitlyShared: false` | 🔒 Fixed V1 |

**Docs:** [campaign.md](./campaign.md) · [campaign-budget.md](./campaign-budget.md)

**Intent codes:** `ADS_INTENT_INVALID_CAMPAIGN_*`, `ADS_INTENT_INVALID_BUDGET_*`, `ADS_INTENT_INVALID_BIDDING`, `ADS_INTENT_INVALID_NETWORK_SETTINGS`

---

## Bucket 2 — Ad group + RSA

| Parameter | Google resource.field | Google constraint (official) | Zuggernaut source | Validator | Mutate payload | Status |
|-----------|----------------------|------------------------------|-------------------|-----------|----------------|--------|
| Ad group name | `AdGroup.name` | Required; <255 UTF-8 chars; no null/NL/CR | `{businessName} — Core` | `validateRequiredName` ≤255 | `createAdGroup` | ✅ |
| Ad group type | `AdGroup.type` | Enum; Search = `SEARCH_STANDARD` | `SEARCH_STANDARD` | Must match | `type: SEARCH_STANDARD` | 🔒 Fixed V1 |
| Ad group status | `AdGroup.status` | Enum | `PAUSED` | Must equal `PAUSED` | `status: PAUSED` | 🔒 Fixed V1 |
| Parent campaign | `AdGroup.campaign` | Campaign resource name | Prior step artifact | Implicit | `campaign` | ✅ |
| Final URL | `Ad.final_urls[]` | At least one valid URL | `websiteUrl` | Non-empty URL check | RSA create | ✅ |
| RSA headlines | `ResponsiveSearchAdInfo.headlines[]` | Min 3, max 15; each ≤30 chars | `adCopySeeds.headlines` | Count + length | `strict: true` (no fallback) | ✅ |
| RSA descriptions | `ResponsiveSearchAdInfo.descriptions[]` | Min 2, max 4; each ≤90 chars | `adCopySeeds.descriptions` | Count + length | `strict: true` | ✅ |
| RSA duplicate text | (policy) | Unique asset text within ad | Dedup in `collectUniqueRsaTexts` | `ADS_INTENT_RSA_DUPLICATE_TEXT` | Payload builder | ✅ |
| Ad group ad status | `AdGroupAd.status` | Enum | `PAUSED` | Not in intent validator | `status: PAUSED` | 🔒 Fixed V1 |

**Docs:** [ad-group.md](./ad-group.md) · [responsive-search-ad.md](./responsive-search-ad.md)

**Intent codes:** `ADS_INTENT_INVALID_AD_GROUP_*`, `ADS_INTENT_RSA_*`, `ADS_INTENT_INVALID_FINAL_URL`

---

## Bucket 3 — Keywords, geo, conversions

### Keywords

| Parameter | Google resource.field | Google constraint (official) | Zuggernaut source | Validator | Mutate payload | Status |
|-----------|----------------------|------------------------------|-------------------|-----------|----------------|--------|
| Keyword text | `AdGroupCriterion.keyword.text` | ≤80 chars; ≤10 words; valid charset | `keywordSeeds` → `buildKeywordsFromSeeds` | Sanitize + length/word/compliance | `buildAdGroupKeywordCreatePayload` (sanitized) | ✅ |
| Keyword match type | `AdGroupCriterion.keyword.match_type` | `BROAD`, `EXACT`, `PHRASE` | Default `PHRASE` | Enum check | `matchType` | ✅ |
| Criterion status | `AdGroupCriterion.status` | Enum | `PAUSED` | Not in intent validator | `status: PAUSED` | 🔒 Fixed V1 |
| Min keyword count | (V1 policy) | At least 1 keyword | From seeds | `ADS_INTENT_MISSING_KEYWORDS` | Loop create | ✅ |
| Invalid characters | — | `CriterionError.KEYWORD_HAS_INVALID_CHARS` | Scraped seeds with `&`, `#`, etc. | V1 conservative allowlist sanitizer | Sanitized at payload build | ✅ |
| Max word count | — | `CriterionError.KEYWORD_HAS_TOO_MANY_WORDS` (10 words) | Long scraped phrases | Truncate to 10 words + validate | Enforced pre-mutate | ✅ |

**Implementation:** `googleAdsCampaignComplianceService.js` — see [ad-group-keyword.md](./ad-group-keyword.md#v1-keyword-sanitization-implemented)

**Docs:** [ad-group-keyword.md](./ad-group-keyword.md)

**Intent codes:** `ADS_INTENT_INVALID_KEYWORD`, `ADS_INTENT_INVALID_KEYWORD_MATCH_TYPE`, `ADS_INTENT_KEYWORD_INVALID_CHARS`, `ADS_INTENT_KEYWORD_TOO_MANY_WORDS`, `ADS_INTENT_KEYWORD_SANITIZED_EMPTY`, `ADS_INTENT_DUPLICATE_KEYWORD`, `ADS_INTENT_MISSING_KEYWORDS`

### Geo targeting

| Parameter | Google resource.field | Google constraint (official) | Zuggernaut source | Validator | Mutate payload | Status |
|-----------|----------------------|------------------------------|-------------------|-----------|----------------|--------|
| Service area label | (input) | Human-readable location | `primaryServiceArea` | `MISSING_GEO_TARGET_LABELS` | N/A (suggest step) | ✅ |
| Geo constant | `CampaignCriterion.location.geo_target_constant` | `geoTargetConstants/{id}` | `geoTargetConstants:suggest` | Resource name regex | `createCampaignGeoTarget` | ✅ |
| Suggest endpoint | `GeoTargetConstantService.SuggestGeoTargetConstants` | **Not** customer-scoped | `googleAdsGeoTargetClient.js` | N/A | Correct path | ✅ |
| Ambiguous cities | — | Multiple matches possible | Country tiebreaker (`US` default) | `UNRESOLVED_GEO` on failure | Best-match picker | ⚠️ Partial |

**Docs:** [campaign-location-targeting.md](./campaign-location-targeting.md)

**Intent codes:** `ADS_INTENT_MISSING_GEO_TARGET_LABELS`, `ADS_INTENT_UNRESOLVED_GEO`, `ADS_INTENT_INVALID_GEO_TARGET`

### Conversion goals

| Parameter | Google resource.field | Google constraint (official) | Zuggernaut source | Validator | Mutate payload | Status |
|-----------|----------------------|------------------------------|-------------------|-----------|----------------|--------|
| Selected conversions | `CustomConversionGoal.conversion_actions[]` | ≥1 valid conversion action | Conversion catalog artifacts | `MISSING_CONVERSION_ACTIONS` | `createCustomConversionGoal` | ✅ |
| Custom goal name | `CustomConversionGoal.name` | Unique within account | `{businessName} — Zuggernaut Conversions` | Not in intent validator | Lookup-before-create + duplicate recovery | ✅ |
| Campaign link | `ConversionGoalCampaignConfig.custom_conversion_goal` | Valid custom goal resource | Prior step | Implicit | `linkCampaignToCustomConversionGoal` | ✅ |

**Docs:** [custom-conversion-goal.md](./custom-conversion-goal.md) · [conversion-goal-campaign-config.md](./conversion-goal-campaign-config.md)

**Intent codes:** `ADS_INTENT_MISSING_CONVERSION_ACTIONS`

---

## Validation pipeline (current)

```
BusinessContext (ads-ready)
  → buildCampaignIntentFromNormalized()   // sanitized keywords
  → resolveGeoTargets()                   // suggest API
  → validateCampaignIntent()              // fail-fast before any mutate
  → assertGoogleAdsCampaignCompliance()     // keyword bucket gate
  → adsAutoCampaignService                  // sequential mutates via ensureResource
```

| Stage | File | Blocks mutate? |
|-------|------|----------------|
| Intent build + sanitize | `adsCampaignIntentService.js` + `googleAdsCampaignComplianceService.js` | No |
| Geo resolve | `googleAdsGeoTargetClient.js` | Yes (throws) |
| Intent validate | `adsCampaignIntentService.js` | Yes |
| Keyword compliance assert | `googleAdsCampaignComplianceService.js` | Yes |
| Payload build | `googleAdsCampaignClient.js` | Yes (sanitizes + rejects unsafe keywords) |
| Google mutate | `googleAdsCampaignClient.js` | API errors only if policy gap remains |

---

## Compliance layer status

| Item | Target module | Status |
|------|---------------|--------|
| Keyword charset sanitization | `googleAdsCampaignComplianceService.js` | ✅ Implemented |
| Keyword max 10 words | Same + `validateCampaignIntent` | ✅ Implemented |
| Pre-mutate compliance pass | `adsAutoCampaignService.js` | ✅ Implemented |
| Intent codes for keyword compliance | `adsCampaignIntent.js` | ✅ Implemented |
| Regression tests with scraped seed fixtures | `backend/tests/googleAdsCampaignComplianceService.test.js` | ✅ Implemented |
| EU political field in intent validator | `validateCampaignIntent` | P2 (deferred) |

---

## Google error → Zuggernaut mapping (keywords)

| Google `CriterionError` | Our pre-mutate code | Current behavior |
|-------------------------|---------------------|------------------|
| `INVALID_KEYWORD_TEXT` | `ADS_INTENT_INVALID_KEYWORD` | Blocked pre-mutate |
| `KEYWORD_TEXT_TOO_LONG` | `ADS_INTENT_INVALID_KEYWORD` | Truncated at 80 in sanitizer |
| `KEYWORD_HAS_TOO_MANY_WORDS` | `ADS_INTENT_KEYWORD_TOO_MANY_WORDS` | Blocked pre-mutate |
| `KEYWORD_HAS_INVALID_CHARS` | `ADS_INTENT_KEYWORD_INVALID_CHARS` | Sanitized or blocked pre-mutate |

Official reference: https://developers.google.com/google-ads/api/reference/rpc/v24/CriterionErrorEnum.CriterionError

---

## Setup run success criteria

All three buckets must pass validation **and** all mutates must succeed. Partial bucket success does not mark setup run as complete.

| Bucket | Resources created |
|--------|---------------------|
| 1 | `CampaignBudget`, `Campaign` |
| 2 | `AdGroup`, `AdGroupAd` (RSA) |
| 3 | `AdGroupCriterion` (keywords), `CampaignCriterion` (geo), `CustomConversionGoal`, `ConversionGoalCampaignConfig` |
