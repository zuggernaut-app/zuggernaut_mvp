# Google Ads E2E Integration Guide - Zuggernaut

## Table of Contents

1.  [Overview & Introduction](#1-overview--introduction)
2.  [Prerequisites & Account Setup](#2-prerequisites--account-setup)
3.  [Authentication & Authorization](#3-authentication--authorization)
4.  [Account Provisioning & Linking](#4-account-provisioning--linking)
5.  [Campaign Lifecycle - Creation & Management](#5-campaign-lifecycle---creation--management)
    *   [Intent to Payload Translation](#intent-to-payload-translation)
    *   [Budget Creation (`createCampaignBudget`)](#budget-creation-createcampaignbudget)
    *   [Campaign Creation (`createCampaign`)](#campaign-creation-createcampaign)
    *   [Ad Group Creation (`createAdGroup`)](#ad-group-creation-createadgroup)
    *   [Ad Creation (`createResponsiveSearchAd`)](#ad-creation-createresponsivesearchad)
    *   [Pausing Campaigns (`pauseAdsCampaign`)](#pausing-campaigns-pauseadscampaign)
    *   [Key Campaign Parameters (Prioritized Buckets)](#key-campaign-parameters-prioritized-buckets)
    *   [Parameter Matrix Legend](#parameter-matrix-legend)
6.  [Conversion Tracking - Setup & Linkage](#6-conversion-tracking---setup--linkage)
    *   [Conversion Action Discovery/Creation](#conversion-action-discoverycreation)
    *   [Custom Conversion Goal Creation (`createCustomConversionGoal`)](#custom-conversion-goal-creation-createcustomconversiongoal)
    *   [Campaign Goal Configuration (`linkCampaignToCustomConversionGoal`)](#campaign-goal-configuration-linkcampaigntocustomconversiongoal)
    *   [Understanding CampaignConversionGoal](#understanding-campaignconversiongoal)
7.  [Targeting](#7-targeting)
8.  [Monitoring & Reporting (Planned)](#8-monitoring--reporting-planned)
9.  [Idempotency & Artifacts](#9-idempotency--artifacts)
10. [Error Handling & Troubleshooting](#10-error-handling--troubleshooting)
    *   [Troubleshooting `INVALID_ARGUMENT` for Campaign Creation](#troubleshooting-invalid_argument-for-campaign-creation)
11. [Real-Mode E2E Checklist Mapping](#11-real-mode-e2e-checklist-mapping)
12. [Known Open Gaps & Future Work](#12-known-open-gaps--future-work)
13. [References](#13-references)

---

## 1. Overview & Introduction

Zuggernaut aims to empower small businesses by automating the setup and initial management of essential digital marketing tools, particularly Google Ads. This guide details the end-to-end integration process with the [Google Ads API (v24)](https://developers.google.com/google-ads/api/docs/release-notes/v24), outlining how Zuggernaut translates business goals into effective campaigns, manages budgets, creates ad creatives, and sets up robust conversion tracking. The architecture prioritizes scalability, maintainability, security, and robust operational capabilities, with a strategic focus on explicitly defining the most impactful Google Ads API parameters (as detailed in `product_strategy/product/strategy-canon.md` and `mvp_implementation_plan.md`).

## 2. Prerequisites & Account Setup

Before Zuggernaut can initiate Google Ads campaign creation, several crucial prerequisites must be met concerning the Google Ads account and its billing status.

*   **Google Ads Account:** An active Google Ads account is required. This account will be managed under Zuggernaut's MCC (Manager Account).
*   **Billing Setup:** The linked Google Ads customer account *must* have a valid billing setup and active payment method. Campaign creation with a valid budget will fail with `BILLING_NOT_SETUP` or similar errors if this is not configured. This is an out-of-band manual step currently for the user.
*   **`login-customer-id`:** Zuggernaut's MCC ID is used as the `login-customer-id` in API requests to manage client accounts.
*   **Developer Token:** A Google Ads API developer token with appropriate access levels (e.g., `Standard` or `Production`) is required for Zuggernaut's API access.

## 3. Authentication & Authorization

Zuggernaut uses [OAuth 2.0](https://developers.google.com/google-ads/api/docs/oauth/overview) to securely access Google Ads accounts on behalf of our users.

*   **Flow:** The user grants Zuggernaut permission through a standard Google OAuth consent screen.
*   **Scopes:** The primary scope required is `https://www.googleapis.com/auth/adwords`, which grants broad access to Google Ads management. Additional scopes may be requested for other Google services (e.g., Google Tag Manager).
*   **Token Management:** Access tokens are short-lived and used for API requests. Refresh tokens are long-lived and securely stored (encrypted) by Zuggernaut to obtain new access tokens when needed, ensuring continuous API access without repeated user interaction.
*   **Implementation:** Our `backend/services/integrations/googleTokenService.js` handles the acquisition and refresh of Google OAuth tokens.

## 4. Account Provisioning & Linking

Before campaign creation, Zuggernaut ensures a valid Google Ads customer account is selected or provisioned. This process leverages the [CustomerService](https://developers.google.com/google-ads/api/reference/rpc/v24/CustomerService) and [CustomerManagerLinkService](https://developers.google.com/google-ads/api/reference/rpc/v24/CustomerManagerLinkService).

*   **Discovery:** After OAuth, Zuggernaut uses the Google Ads API to discover accessible customer accounts under the connected MCC.
*   **Selection/Provisioning:**
    *   If the user already has a suitable Google Ads account, it is selected.
    *   If no account exists, or provisioning is required, Zuggernaut may guide the user through creating a new customer account or linking an existing one to the MCC, depending on the workflow (`mvp_implementation_plan.md` Phase 5A).
*   **Idempotency:** This process is idempotent. If a suitable account is already linked, it's reused. (`IntegrationArtifact` is used to record provisioned `ads_customer` artifacts).
*   **Prerequisites:** An approved Google Ads API developer token and `login-customer-id` (the MCC ID) are necessary for these operations.

## 5. Campaign Lifecycle - Creation & Management

This section details how Zuggernaut automates the creation and basic management of Google Ads campaigns, adhering to strict parameter validation.

### Intent to Payload Translation

Zuggernaut's core logic translates a user's `BusinessContext` and derived `CampaignPlan` (stored in MongoDB via Mongoose models) into specific Google Ads API payloads. The `adsAutoCampaignService.js` orchestrates this process.

### Budget Creation (`createCampaignBudget`)

*   **Service:** [CampaignBudgetService](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignBudgetService)
*   **Method:** `CampaignBudgetService.MutateCampaignBudgets`
*   **Endpoint:** `customers/{customer_id}/campaignBudgets:mutate`
*   **Function:** `createCampaignBudget` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** Creates a campaign budget which can be shared across multiple campaigns or dedicated to a single campaign.
*   **Sample Request Payload (JSON for `create` operation):**
    ```json
    {
      "operations": [
        {
          "create": {
            "name": "Daily Budget for Zuggernaut Campaign",
            "amountMicros": "10000000", // e.g., $10.00
            "deliveryMethod": "STANDARD",
            "explicitlyShared": false
          }
        }
      ]
    }
    ```
*   **Parameters:**
    *   `name`: **[Required]** Descriptive name for the budget.
    *   `amountMicros`: **[Required]** Daily budget amount in micros (1,000,000 micros = 1 unit of currency).
    *   `deliveryMethod`: **[Defaulted]** Typically `STANDARD`.
    *   `explicitlyShared`: **[Defaulted]** `false` for budgets not explicitly shared with other campaigns.
*   **Idempotency:** Zuggernaut tracks `ads_campaign_budget` artifacts using `IntegrationArtifact` to prevent duplicate budget creation on retries.

### Campaign Creation (`createCampaign`)

*   **Service:** [CampaignService](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignService)
*   **Method:** `CampaignService.MutateCampaigns`
*   **Endpoint:** `customers/{customer_id}/campaigns:mutate`
*   **Function:** `createCampaign` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** Creates the main advertising campaign.
*   **Sample Request Payload (JSON for `create` operation):**
    ```json
    {
      "operations": [
        {
          "create": {
            "name": "Business Name — Zuggernaut Search",
            "advertisingChannelType": "SEARCH",
            "status": "PAUSED",
            "campaignBudget": "customers/1234567890/campaignBudgets/BUDGET_ID",
            "containsEuPoliticalAdvertising": "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
            "manualCpc": {
              "enhancedCpcEnabled": false
            },
            "networkSettings": {
              "targetGoogleSearch": true,
              "targetSearchNetwork": true,
              "targetContentNetwork": false
            }
          }
        }
      ]
    }
    ```
*   **Parameters (Key ones used by Zuggernaut):**
    *   `name`: **[Required]** Campaign name (e.g., `${businessName} — Zuggernaut Search`).
    *   `advertisingChannelType`: **[Required]** `SEARCH` for search campaigns.
    *   `status`: **[Defaulted]** Initially `PAUSED` to allow for verification before active serving.
    *   `campaignBudget`: **[Required]** Resource name of the previously created campaign budget.
    *   `containsEuPoliticalAdvertising`: **[Defaulted]** Set to `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` for compliance.
    *   `manualCpc`: **[Required]** Explicitly set `enhancedCpcEnabled: false` (as `maximizeConversions: {}` is rejected in v24). This is the current bidding strategy.
    *   `networkSettings`: **[Defaulted]** Configures where ads can show (e.g., `targetGoogleSearch: true`, `targetSearchNetwork: true`, `targetContentNetwork: false`).
    *   `maximizeConversions`: **[Blocked/Must-Not-Send]** `{}` was previously rejected by Google Ads API v24.
*   **Idempotency:** Zuggernaut tracks `ads_campaign` artifacts using `IntegrationArtifact`.

### Ad Group Creation (`createAdGroup`)

*   **Service:** [AdGroupService](https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupService)
*   **Method:** `AdGroupService.MutateAdGroups`
*   **Endpoint:** `customers/{customer_id}/adGroups:mutate`
*   **Function:** `createAdGroup` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** Creates an ad group within a campaign to organize ads and keywords.
*   **Sample Request Payload (JSON for `create` operation):**
    ```json
    {
      "operations": [
        {
          "create": {
            "name": "Business Name — Core",
            "campaign": "customers/1234567890/campaigns/CAMPAIGN_ID",
            "status": "PAUSED",
            "type": "SEARCH_STANDARD"
          }
        }
      ]
    }
    ```
*   **Parameters:**
    *   `name`: **[Required]** Ad group name (e.g., `${businessName} — Core`).
    *   `campaign`: **[Required]** Resource name of the parent campaign.
    *   `status`: **[Defaulted]** `PAUSED` for V1 setup (matches campaign).
    *   `type`: **[Defaulted]** `SEARCH_STANDARD`.
*   **Idempotency:** Zuggernaut tracks `ads_ad_group` artifacts using `IntegrationArtifact`.

### Ad Creation (`createResponsiveSearchAd`)

*   **Service:** [AdGroupAdService](https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupAdService)
*   **Method:** `AdGroupAdService.MutateAdGroupAds`
*   **Endpoint:** `customers/{customer_id}/adGroupAds:mutate`
*   **Function:** `createResponsiveSearchAd` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** Creates a Responsive Search Ad (RSA) within an ad group.
*   **Sample Request Payload (JSON for `create` operation):**
    ```json
    {
      "operations": [
        {
          "create": {
            "adGroup": "customers/1234567890/adGroups/ADGROUP_ID",
            "status": "PAUSED",
            "ad": {
              "responsiveSearchAd": {
                "headlines": [
                  { "text": "Headline 1 (30 chars max)" },
                  { "text": "Headline 2" },
                  { "text": "Headline 3" }
                ],
                "descriptions": [
                  { "text": "Description 1 (90 chars max)" },
                  { "text": "Description 2" }
                ]
              },
              "finalUrls": ["https://www.example.com"]
            }
          }
        }
      ]
    }
    ```
*   **Parameters (RSA specific logic):**
    *   `adGroup`: **[Required]** Resource name of the parent ad group.
    *   `status`: **[Defaulted]** Initially `PAUSED` to allow for verification.
    *   `ad`: Contains the RSA details:
        *   `responsiveSearchAd`: **[Required]**
            *   `headlines`: **[Required, Array]** Validated intent headlines only (minimum 3, max 30 chars each). Product path uses `strict: true` — no silent fallback injection.
            *   `descriptions`: **[Required, Array]** Validated intent descriptions only (minimum 2, max 90 chars each).
        *   `finalUrls`: **[Required, Array]** Array containing the primary landing page URL.
*   **Idempotency:** Zuggernaut tracks `ads_ad` artifacts using `IntegrationArtifact`.

### Pausing Campaigns (`pauseAdsCampaign`)

*   **Service:** [CampaignService](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignService)
*   **Method:** `CampaignService.MutateCampaigns`
*   **Endpoint:** `customers/{customer_id}/campaigns:mutate`
*   **Function:** `pauseAdsCampaign` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** Changes the status of an existing campaign to `PAUSED`.
*   **Sample Request Payload (JSON for `update` operation):**
    ```json
    {
      "operations": [
        {
          "update": {
            "resourceName": "customers/1234567890/campaigns/CAMPAIGN_ID",
            "status": "PAUSED"
          },
          "updateMask": "status"
        }
      ]
    }
    ```
*   **Operation:** Uses an `update` operation with `updateMask: 'status'` to only modify the campaign status.

### Key Campaign Parameters (Prioritized Buckets)

As per `mvp_implementation_plan.md` Phase 10, Zuggernaut enforces strict validation for the most impactful Google Ads API parameters. If any are missing or invalid, the workflow will fail with clear error messages.

1.  **Core Campaign Definition & Strategy**
    *   `campaign.name`: **[Required]** Must be unique and descriptive.
    *   `campaign.advertisingChannelType`: **[Required]** (`SEARCH`).
    *   `campaign.status`: **[Defaulted]** (`PAUSED` initially).
    *   `campaign.campaignBudget`: **[Required]** Resource name.
    *   `campaign.manualCpc.enhancedCpcEnabled`: **[Required]** (`false`).
    *   `campaign.networkSettings`: **[Defaulted]** Configures where ads can show (e.g., `targetGoogleSearch`, `targetSearchNetwork`).
    *   `campaign.containsEuPoliticalAdvertising`: **[Defaulted]** (`DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`).
2.  **Ad Group Structure & Ad Creative**
    *   `adGroup.name`: **[Required]**
    *   `adGroup.campaign`: **[Required]** Resource name.
    *   `adGroup.status`: **[Defaulted]** (`PAUSED` for V1 setup).
    *   `adGroup.type`: **[Defaulted]** (`SEARCH_STANDARD`).
    *   `adGroupAd.status`: **[Defaulted]** (`PAUSED` initially).
    *   `adGroupAd.ad.responsiveSearchAd.headlines`: **[Required, Validated]** Minimums, maximums, and character limits (30 chars).
    *   `adGroupAd.ad.responsiveSearchAd.descriptions`: **[Required, Validated]** Minimums, maximums, and character limits (90 chars).
    *   `adGroupAd.ad.finalUrls`: **[Required]** Must be a valid URL.
3.  **Core Targeting & Conversion Goal Linking**
    *   `adGroupCriterion.keyword` (keywords): **[Required, Implemented]** Created via `createAdGroupKeyword`; tracked as `ads_keyword` artifacts.
    *   `campaignCriterion.location.geoTargetConstant` (geo): **[Required, Implemented]** Resolved from `primaryServiceArea` via `resolvePrimaryGeoTargetConstant`; created via `createCampaignGeoTarget`; tracked as `ads_campaign_criterion` artifacts.
    *   `customConversionGoal.conversionActions`: **[Required]** Array of `ConversionAction` resource names.
    *   `conversionGoalCampaignConfig.customConversionGoal`: **[Required]** Resource name of `CustomConversionGoal`.

### Parameter Matrix Legend

*   **[Required]:** Parameter must be present and valid for the API call to succeed. If missing, Zuggernaut's validation will explicitly fail.
*   **[Optional]:** Parameter can be omitted. If present, it must be valid.
*   **[Defaulted]:** Parameter is set to a specific value by Zuggernaut if not explicitly provided, based on best practices or internal strategy.
*   **[Validated]:** Parameter has specific content requirements (e.g., length, format, min/max counts) enforced by Zuggernaut or the Google Ads API.
*   **[Blocked/Must-Not-Send]:** Parameter is known to cause errors or is intentionally excluded from Zuggernaut's API calls.

## 6. Conversion Tracking - Setup & Linkage

Zuggernaut automates conversion tracking setup to ensure campaigns optimize for relevant business goals (ADR 0007).

### Conversion Action Discovery/Creation

*   **Service:** [ConversionActionService](https://developers.google.com/google-ads/api/reference/rpc/v24/ConversionActionService)
*   **Method (Read):** `GoogleAdsService.SearchStream` (for discovery)
*   **Method (Create):** `ConversionActionService.MutateConversionActions`
*   **Endpoint:** `customers/{customer_id}/conversionActions:mutate`
*   **Internal:** Handled by `AdsConversionCatalogService` (reads) and `googleAdsConversionActionClient.js` (creates).
*   **Process:** Zuggernaut first discovers existing conversion actions. If suitable ones (e.g., for call or form leads) are not found or don't meet requirements, it programmatically creates new `ConversionAction` resources with sensible defaults.
*   **Sample Request Payload (JSON for `create` operation of a `ConversionAction`):**
    ```json
    {
      "operations": [
        {
          "create": {
            "name": "Zuggernaut Form Submit Lead",
            "type": "WEBPAGE",
            "category": "SUBMIT_LEAD_FORM",
            "status": "ENABLED",
            "valueSettings": {
              "defaultValue": 0,
              "alwaysUseDefaultValue": true
            },
            "appId": "com.example.android" // if type is APP_DOWNLOAD or FIRST_OPEN
          }
        }
      ]
    }
    ```

### Custom Conversion Goal Creation (`createCustomConversionGoal`)

*   **Service:** [CustomConversionGoalService](https://developers.google.com/google-ads/api/reference/rpc/v24/CustomConversionGoalService)
*   **Method:** `CustomConversionGoalService.MutateCustomConversionGoals`
*   **Endpoint:** `customers/{customer_id}/customConversionGoals:mutate`
*   **Function:** `createCustomConversionGoal` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** To group specific `ConversionAction` resources that a campaign should optimize for. This allows Zuggernaut to precisely define the conversion events it manages, overriding default account-level goals.
*   **Sample Request Payload (JSON for `create` operation):**
    ```json
    {
      "operations": [
        {
          "create": {
            "name": "Business Name — Zuggernaut Conversions",
            "conversionActions": [
              "customers/1234567890/conversionActions/CONVERSION_ACTION_ID_1",
              "customers/1234567890/conversionActions/CONVERSION_ACTION_ID_2"
            ],
            "status": "ENABLED"
          }
        }
      ]
    }
    ```
*   **Parameters:**
    *   `name`: **[Required]** A descriptive name for the custom goal (e.g., `${businessName} — Zuggernaut Conversions`).
    *   `conversionActions`: **[Required, Array]** An array of `ConversionAction` resource names that this custom goal will include. Must contain at least one.
    *   `status`: **[Defaulted]** Typically `ENABLED`.
*   **Operation:** Uses a `create` operation via `MutateCustomConversionGoals`.
*   **Idempotency:** Zuggernaut tracks `ads_custom_conversion_goal` artifacts using `IntegrationArtifact` to prevent duplicate custom goal creation.

### Campaign Goal Configuration (`linkCampaignToCustomConversionGoal`)

*   **Service:** [ConversionGoalCampaignConfigService](https://developers.google.com/google-ads/api/reference/rpc/v24/ConversionGoalCampaignConfigService)
*   **Method:** `ConversionGoalCampaignConfigService.MutateConversionGoalCampaignConfigs`
*   **Endpoint:** `customers/{customer_id}/conversionGoalCampaignConfigs:mutate`
*   **Function:** `linkCampaignToCustomConversionGoal` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Purpose:** To link a specific campaign to a `CustomConversionGoal`, overriding the customer-level conversion goals for that campaign.
*   **Sample Request Payload (JSON for `update` operation):**
    ```json
    {
      "operations": [
        {
          "update": {
            "resourceName": "customers/1234567890/conversionGoalCampaignConfigs/CAMPAIGN_ID",
            "customConversionGoal": "customers/1234567890/customConversionGoals/CUSTOM_GOAL_ID"
          },
          "updateMask": "custom_conversion_goal"
        }
      ]
    }
    ```
*   **Parameters:**
    *   `resourceName`: **[Required]** Formatted as `customers/{customer_id}/conversionGoalCampaignConfigs/{campaign_id}`.
    *   `customConversionGoal`: **[Required]** Resource name of the previously created `CustomConversionGoal`.
*   **Operation:** Uses an `update` operation on the `ConversionGoalCampaignConfig` resource (which is automatically created by Google Ads). The `updateMask: 'custom_conversion_goal'` is crucial to specify only this field is being changed.
*   **Idempotency:** Zuggernaut tracks `ads_conversion_goal_campaign_config` artifacts using `IntegrationArtifact`.

### Understanding CampaignConversionGoal

Google Ads automatically creates `CampaignConversionGoal` objects based on conversion categories and origins (`DEFAULT`/`WEBSITE`). Our initial attempt to update this directly with a `create` operation failed. While `CampaignConversionGoal` can be updated (e.g., to set `biddable` status for a specific category/origin), Zuggernaut's primary method for precise conversion linkage is through `CustomConversionGoal` and `ConversionGoalCampaignConfig`, as this allows linking *specific* conversion actions rather than broad categories.
*   **Key Point:** Since Google Ads automatically creates `CustomerConversionGoal`, `CampaignConversionGoal`, and `ConversionGoalCampaignConfig` objects in your account, you can only *update* those objects. The Google Ads API doesn't support creating or removing those objects. (`https://developers.google.com/google-ads/api/docs/conversions/goals/overview#mutate_requirements`)

## 7. Targeting

Phase 10 implements keyword and geographic targeting on the **product path** (`adsAutoCampaignService.js`). Intent is validated before any Google mutate; unresolved geo fails with `ADS_INTENT_UNRESOLVED_GEO` (no default US fallback).

### Orchestration order

1. Validate `BusinessContext` + build/resolve `CampaignPlan.intent`
2. `createCampaignBudget` → `ads_campaign_budget`
3. `createCampaign` → `ads_campaign`
4. `createCampaignGeoTarget` (per resolved `intent.geoTargets[]`) → `ads_campaign_criterion`
5. `createAdGroup` → `ads_ad_group`
6. `createAdGroupKeyword` (per `intent.keywords[]`) → `ads_keyword`
7. `createResponsiveSearchAd` → `ads_ad`
8. `createCustomConversionGoal` + `linkCampaignToCustomConversionGoal`

### Keyword creation (`createAdGroupKeyword`)

*   **Service:** [AdGroupCriterionService](https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupCriterionService)
*   **Method:** `AdGroupCriterionService.MutateAdGroupCriteria`
*   **Endpoint:** `customers/{customer_id}/adGroupCriteria:mutate`
*   **Function:** `createAdGroupKeyword` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Intent source:** `intent.keywords[]` — `{ text, matchType }` built from `BusinessContext` keyword seeds (default `PHRASE`).
*   **Sample create payload:**
    ```json
    {
      "operations": [
        {
          "create": {
            "adGroup": "customers/1234567890/adGroups/ADGROUP_ID",
            "status": "PAUSED",
            "keyword": {
              "text": "plumbing Springfield",
              "matchType": "PHRASE"
            }
          }
        }
      ]
    }
    ```
*   **Idempotency:** Logical keys `keyword_0`, `keyword_1`, …; GAQL search-by-text before create; artifact type `ads_keyword`.

### Geographic targeting

#### Resolve service area (`resolvePrimaryGeoTargetConstant`)

*   **Service:** [GeoTargetConstantService](https://developers.google.com/google-ads/api/reference/rpc/v24/GeoTargetConstantService)
*   **Method:** `GeoTargetConstantService.SuggestGeoTargetConstants`
*   **Endpoint:** `customers/{customer_id}/geoTargetConstants:suggest`
*   **Function:** `resolvePrimaryGeoTargetConstant` in `backend/services/integrations/googleAdsGeoTargetClient.js`
*   **Input:** `primaryServiceArea` label from Ads-ready `BusinessContext`
*   **Request body (V1):** `locale: "en"`, `countryCode: "US"`, `locationNames.names: [label]`
*   **Selection:** Single suggestion wins; multiple matches require exact canonical match; otherwise `ADS_INTENT_UNRESOLVED_GEO`
*   **Persisted on intent:** `geoTargets: [{ resourceName, label, canonicalName, targetType, countryCode }]`

#### Apply location criterion (`createCampaignGeoTarget`)

*   **Service:** [CampaignCriterionService](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignCriterionService)
*   **Method:** `CampaignCriterionService.MutateCampaignCriteria`
*   **Endpoint:** `customers/{customer_id}/campaignCriteria:mutate`
*   **Function:** `createCampaignGeoTarget` in `backend/services/integrations/googleAdsCampaignClient.js`
*   **Sample create payload:**
    ```json
    {
      "operations": [
        {
          "create": {
            "campaign": "customers/1234567890/campaigns/CAMPAIGN_ID",
            "location": {
              "geoTargetConstant": "geoTargetConstants/1014044"
            }
          }
        }
      ]
    }
    ```
*   **Idempotency:** Logical key `geo_0`; GAQL search on campaign + geo constant before create; artifact type `ads_campaign_criterion`.

### Structural verification gate

Per `mvp_implementation_plan.md` Phase 10, `setupRun.workflow.js` calls `createAdsCampaignActivity` **only when** `runStructuralVerificationActivity` returns `outcome: 'pass'`. Non-pass outcomes (`snippet_pending`, `needs_tracking_fix`, `manual_review`) stop the workflow before campaign creation. When GTM is not configured, verification is skipped but still returns `pass`.

### Real-mode verification

*   **Checklist:** `dev-tools/docs/PHASE10_REAL_MODE_E2E_CHECKLIST.md`
*   **Post-run script:** `npm run verify:phase10-setup-run -- <setupRunId>` (from `backend/`)
*   **Evidence log:** `dev-tools/docs/evidence/PHASE10_REAL_MODE_E2E_EVIDENCE.md`


## 8. Monitoring & Reporting (Planned)

This section outlines how Zuggernaut will monitor and report on Google Ads campaign performance. This is a planned feature and not part of the current MVP implementation.

*   **Service:** [GoogleAdsService](https://developers.google.com/google-ads/api/reference/rpc/v24/GoogleAdsService) (`GoogleAdsService.SearchStream` or `GoogleAdsService.Search`).
*   **Query Language:** [Google Ads Query Language (GAQL)](https://developers.google.com/google-ads/api/docs/query/overview) will be used to retrieve campaign performance data.
*   **Example GAQL Queries:**
    *   **Campaign Performance:**
        ```sql
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign_budget.amount_micros,
          metrics.clicks,
          metrics.impressions,
          metrics.conversions,
          metrics.cost_micros
        FROM campaign
        WHERE campaign.status IN ('ENABLED', 'PAUSED')
        ```
    *   **Ad Group Performance:**
        ```sql
        SELECT
          campaign.name,
          ad_group.name,
          ad_group.status,
          metrics.clicks,
          metrics.impressions
        FROM ad_group
        WHERE ad_group.status IN ('ENABLED', 'PAUSED')
        ```
    *   **Conversion Actions:**
        ```sql
        SELECT
          conversion_action.id,
          conversion_action.name,
          conversion_action.status,
          conversion_action.category,
          conversion_action.type
        FROM conversion_action
        ```

## 9. Idempotency & Artifacts

Idempotency is a core principle in Zuggernaut's Google Ads integration to ensure reliable operation and safe retries without creating duplicate resources. All external Google Ads resources created by Zuggernaut are tracked as `IntegrationArtifact` objects in our MongoDB.

*   **`IntegrationArtifact` Model:** Stores the `setupRunId`, `businessId`, `provider` (`google_ads`), `artifactType` (e.g., `ads_campaign`, `ads_custom_conversion_goal`), `idempotencyKey`, `externalId` (the Google Ads API resource name), and relevant `metadata`.
*   **`adsIdempotencyKey`:** A deterministic key generated for each logical resource to check for existing artifacts (`backend/constants/idempotency.js`).
*   **`ensureResource` Pattern:** Used across `adsAutoCampaignService.js` to:
    1.  Check if an `IntegrationArtifact` already exists for a given `idempotencyKey`.
    2.  If it exists, reuse the `externalId` and skip the API creation call.
    3.  If not, call the respective Google Ads API function (e.g., `createCampaign`), and then persist the resulting `resourceName` as a new `IntegrationArtifact`.

**Artifact Types Tracked (`backend/constants/enums.js` + `idempotency.js`):**

*   `ads_campaign_budget`
*   `ads_campaign`
*   `ads_campaign_criterion` (location / geo)
*   `ads_ad_group`
*   `ads_keyword`
*   `ads_ad`
*   `ads_conversion_action` (for discovered/created actions)
*   `ads_custom_conversion_goal`
*   `ads_conversion_goal_campaign_config`

## 10. Error Handling & Troubleshooting

Google Ads API errors are critical to handle gracefully.

*   **`GoogleAdsApiError`:** Custom error class (`backend/services/integrations/googleAdsApiConfig.js`) with `message`, `code`, and optional `details` (field violations, request ID).
*   **`AdsProviderPreconditionError`:** Pre-mutate failures (readiness, intent validation, missing conversions). Surfaced on `ads_campaign_creation` with `details.code` and `details.validationBucket` (`campaign`, `ad`, `keywords`, `geo`, `conversions`, `readiness`, `provider`, `preconditions`).
*   **Intent codes:** Stable `ADS_INTENT_*` codes in `backend/constants/adsCampaignIntent.js`; mapped to buckets via `ADS_INTENT_VALIDATION_BUCKETS`.
*   **Non-Retryable Failures:** `ApplicationFailure.nonRetryable` for precondition and `INVALID_ARGUMENT` class errors.
*   **Logging:** Detailed logging (using `pino`) captures `setupRunId`, `businessId`, `stepName`, and `provider` to aid in debugging workflow failures.

### Troubleshooting `INVALID_ARGUMENT` for Campaign Creation

The `INVALID_ARGUMENT` error, particularly during `CampaignService.MutateCampaigns`, is common and often generic. Debugging steps include:

1.  **Review the full API response:** The `details` field in the API error response often contains more specific validation errors. This is crucial for pinpointing the exact problematic field.
2.  **Cross-reference with API Reference:** Compare the sent payload (logged or observed during debugging) with the [official `MutateCampaigns` reference](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignService/MutateCampaigns) for the `CampaignService`. Pay close attention to:
    *   **Required Fields:** Ensure all fields marked as `(google.api.field_behavior) = REQUIRED` are present.
    *   **Field Constraints:** Check for value ranges, formats, and relationships between fields.
    *   **Enums:** Ensure all enum values are valid strings as defined by the API.
3.  **Check Parameter Prioritization:** Verify that all parameters from our "Core Campaign Definition & Strategy" bucket are correctly populated and adhere to Google Ads API requirements.
4.  **Consider Account State:** Even with a perfect payload, the API can return `INVALID_ARGUMENT` if the Google Ads account itself is not in a valid state (e.g., billing not set up, account suspended, MCC link issue).
5.  **Use Google Ads API Explorer:** The [Google Ads API Explorer](https://developers.google.com/google-ads/api/fields/v16/overview_query_builder) can be used to manually construct and test API requests to isolate the problematic parameter.

## 11. Real-Mode E2E Checklist Mapping

This section maps relevant parts of this guide to the `dev-tools/docs/REAL_MODE_E2E_CHECKLIST.md` to ensure that our real-mode tests cover the critical aspects of the Google Ads integration.

*   **Prerequisites & Account Setup:** Directly maps to the "Prerequisites (live stack)" section of the E2E checklist (e.g., `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`).
*   **Authentication & Authorization:** Covered by the "Register / log in (real session cookie)" and "Connect Google Ads via real OAuth" steps in the E2E checklist's "Happy path" section.
*   **Account Provisioning & Linking:** Validated by reaching `ADS_PROVISIONING_REQUIRED` terminal state and successful provisioning in the "Provisioning consent" section.
*   **Campaign Lifecycle - Creation & Management:** Successful `createAdsCampaign` path creates budget, campaign, geo criteria, ad group, keywords, RSA, and conversion goal linkage. See [`PHASE10_REAL_MODE_E2E_CHECKLIST.md`](../dev-tools/docs/PHASE10_REAL_MODE_E2E_CHECKLIST.md).
*   **Targeting (keywords + geo):** Validated by `ads_keyword` and `ads_campaign_criterion` artifacts; post-run `npm run verify:phase10-setup-run`.
*   **Structural gate:** Workflow blocks Ads when structural verification does not pass.
*   **Idempotency & Artifacts:** Validated by retry runs and `npm test` idempotency suites.

## 12. Known Open Gaps & Future Work

*   **Advanced targeting:** Negative keywords, audience segments, ad schedule criteria (diagnostics-only today).
*   **Campaign Modification:** Currently, Zuggernaut focuses on initial campaign creation. Future work includes updating existing campaigns (e.g., budget changes, bidding strategy adjustments).
*   **Ad Extensions:** Integration of ad extensions (sitelinks, callouts, call assets) for richer ad formats.
*   **Reporting & Monitoring:** Full implementation of GAQL-based reporting and dashboard integration for ongoing campaign performance monitoring.
*   **Campaign Types:** Support for additional campaign types beyond Search (e.g., Display, Performance Max).
*   **Error Handling Granularity:** More specific parsing of `INVALID_ARGUMENT` errors to provide targeted user feedback or automated remediation.

## 13. References

*   **Google Ads API Documentation (Official):** [https://developers.google.com/google-ads/api](https://developers.google.com/google-ads/api)
    *   [CampaignBudgetService](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignBudgetService)
    *   [CampaignService](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignService)
    *   [AdGroupService](https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupService)
    *   [AdGroupAdService](https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupAdService)
    *   [ConversionActionService](https://developers.google.com/google-ads/api/reference/rpc/v24/ConversionActionService)
    *   [CustomConversionGoalService](https://developers.google.com/google-ads/api/reference/rpc/v24/CustomConversionGoalService)
    *   [ConversionGoalCampaignConfigService](https://developers.google.com/google-ads/api/reference/rpc/v24/ConversionGoalCampaignConfigService)
    *   [GeoTargetConstantService](https://developers.google.com/google-ads/api/reference/rpc/v24/GeoTargetConstantService)
    *   [GoogleAdsService](https://developers.google.com/google-ads/api/reference/rpc/v24/GoogleAdsService)
    *   [Google Ads Query Language (GAQL)](https://developers.google.com/google-ads/api/docs/query/overview)
    *   [Google Ads API Explorer](https://developers.google.com/google-ads/api/fields/v16/overview_query_builder)
*   **Google Ads Python Client Library (GitHub):** [https://github.com/googleads/google-ads-python](https://github.com/googleads/google-ads-python)
*   **Google Ads PHP Client Library (GitHub):** [https://github.com/googleads/google-ads-php](https://github.com/googleads/google-ads-php)
*   **Zuggernaut Internal Documents:**
    *   `product_strategy/product/strategy-canon.md`
    *   `mvp_implementation_plan.md`
    *   `product_strategy/adr/0007-ads-conversion-action-creation.md`
    *   `dev-tools/docs/REAL_MODE_E2E_CHECKLIST.md`
*   **Codebase (for detailed implementation):**
    *   `backend/services/integrations/googleAdsCampaignClient.js`
    *   `backend/services/capabilities/adsAutoCampaignService.js`
    *   `backend/services/integrations/googleAdsApiConfig.js`
    *   `backend/services/integrations/googleTokenService.js`
    *   `backend/constants/enums.js`
    *   `backend/constants/idempotency.js`
    *   `backend/services/integrations/googleAdsGeoTargetClient.js`
    *   `backend/services/capabilities/adsCampaignIntentService.js`
    *   `dev-tools/docs/PHASE10_REAL_MODE_E2E_CHECKLIST.md`