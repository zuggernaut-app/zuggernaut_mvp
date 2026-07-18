# Responsive Search Ad (Bucket 2)

Created as an `AdGroupAd` with `ad.responsive_search_ad` via `AdGroupAdService.MutateAdGroupAds`.

## Official sources

| Type | URL |
|------|-----|
| RPC `ResponsiveSearchAdInfo` | https://developers.google.com/google-ads/api/reference/rpc/v24/ResponsiveSearchAdInfo |
| Create RSA guide | https://developers.google.com/google-ads/api/docs/responsive-search-ads/create-responsive-search-ads |
| RSA overview | https://developers.google.com/google-ads/api/docs/responsive-search-ads/overview |
| Google Ads Help (limits) | https://support.google.com/google-ads/answer/7684791 |

## Mutate endpoint

```
POST /v24/customers/{customer_id}/adGroupAds:mutate
```

Implemented in `googleAdsCampaignClient.js` → `createResponsiveSearchAd`, payload via `buildResponsiveSearchAdCreatePayload(..., { strict: true })`.

## Fields Zuggernaut sets

| Google field | Zuggernaut source | Google / Help constraint | V1 policy |
|--------------|-------------------|--------------------------|-----------|
| `ad_group` | Ad group resource name | Required parent | From prior step |
| `status` | `PAUSED` | Ad group ad status | Fixed `PAUSED` |
| `ad.final_urls[]` | `intent.ad.finalUrl` | At least one final URL; valid URL | From confirmed `websiteUrl` |
| `ad.responsive_search_ad.headlines[]` | `intent.ad.headlines` | Min 3, max 15; each max 30 chars | From `adCopySeeds`; strict mode (no fallback at mutate) |
| `ad.responsive_search_ad.descriptions[]` | `intent.ad.descriptions` | Min 2, max 4; each max 90 chars | From `adCopySeeds`; strict mode |

## Validation in codebase

- `validateCampaignIntent` → headlines/descriptions count and length
- `buildResponsiveSearchAdCreatePayload` enforces min counts when `strict: true`
- Codes: `ADS_INTENT_RSA_*`, `ADS_INTENT_INVALID_FINAL_URL`

## Notes

- Google rotates headline/description combinations at serve time.
- Double-width languages (CJK) count as 2 characters per Google Help; V1 primarily targets Latin scripts.
- V1 does not use pinning (`ServedAssetFieldType`) yet.
