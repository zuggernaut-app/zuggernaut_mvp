# Research Notes: Google APIs for Zuggernaut

## 1. Google Business Profile (GBP) API

*   **Purpose:** Manage business listings on Google Search and Maps.
*   **V1 Scope:** Read-only audit.
*   **Key Endpoints (for audit):**
    *   `accounts.locations.get`:
        *   Retrieves detailed information about a specific business location.
        *   Provides data on name, address, phone, hours, website, services, categories, reviews, photos, etc.
        *   Requires authenticated access with appropriate OAuth scopes. Minimum viable read-only access must be verified against current GBP API requirements; `https://www.googleapis.com/auth/business.manage` may be required by Google even for read operations and should not be treated as permission to modify GBP in V1.
    *   `accounts.locations.list`:
        *   Lists all locations associated with a Google account.
        *   Useful for discovering which locations a user manages.
*   **Authentication:** OAuth 2.0.
*   **Client Libraries:** These notes reference Python client libraries because early API exploration was done in Python. The production V1 stack uses Node.js with the `googleapis` npm library. Python references here are for research and prototyping context only.

## 2. Google Tag Manager (GTM) API (v2)

*   **Purpose:** Programmatically manage GTM accounts, containers, tags, triggers, and variables.
*   **V1 Scope:** Create Google Ads conversion tracking tags and basic triggers.
*   **Key Concepts:**
    *   **Accounts:** Top-level container for GTM organizations.
    *   **Containers:** Represents a website or app installation of GTM.
    *   **Workspaces:** Environments within a container where changes are made.
    *   **Tags:** Snippets of code or tracking pixels (e.g., Google Ads Conversion Tag).
    *   **Triggers:** Define when tags should fire (e.g., page views, custom events, clicks).
    *   **Variables:** Dynamic values used in tags and triggers.
*   **Relevant API Methods:**
    *   `accounts.containers.workspaces.tags.create`:
        *   Used to create new tags.
        *   **Assumption to verify:** Requires precise definition of `type` and `parameter` structure for Google Ads conversion tags. Do not hard-code guessed keys until they are validated in the GTM test environment.
    *   `accounts.containers.workspaces.triggers.create`:
        *   Used to create new triggers.
        *   Supports various trigger types (PAGE_VIEW, CUSTOM_EVENT, CLICK).
        *   **V1 Strategy:** Focus on creating triggers based on common discoverable signals (URL contains, element clicks).
    *   `accounts.containers.workspaces.get`:
        *   Retrieves details about a workspace, essential for obtaining the latest workspace path for creating/updating resources.
*   **Authentication:** OAuth 2.0.
*   **Client Libraries:** These notes reference Python client libraries because early API exploration was done in Python. The production V1 stack uses Node.js with the `googleapis` npm library. Python references here are for research and prototyping context only.
*   **Notes:** **Documentation Gap:** Exact parameter names and structures for Google Ads conversion tags are not clearly documented in the public GTM API docs. Requires experimental validation in the GTM test environment before production implementation. Trigger configuration will rely on discoverable website signals and versioned templates.

## 3. Google Ads API

*   **Purpose:** Create, manage, and retrieve data for Google Ads campaigns.
*   **V1 Scope:** Automated initial campaign creation, gated by required tracking setup and verification checks.
*   **Key Concepts:**
    *   **Customer Accounts:** Represents an advertiser's account.
    *   **Campaigns:** High-level advertising initiatives.
    *   **Ad Groups:** Groupings of ads targeting specific keywords/audiences.
    *   **Keywords:** Terms users search for.
    *   **Ads:** Text ads, responsive search ads.
    *   **Bidding Strategies:** Rules for how bids are managed (e.g., Maximize Conversions, Target CPA).
*   **Relevant API Methods:**
    *   `GoogleAdsService.CreateCampaign`:
        *   Used to create new campaigns.
        *   Requires defining `campaignBudget`, `campaign`, `biddingStrategyType`, etc.
    *   `GoogleAdsService.MutateCampaigns`:
        *   For updating existing campaigns (e.g., budget, status).
    *   `GoogleAdsService.SearchStream` / `GoogleAdsService.Search`:
        *   For retrieving campaign performance data, keywords, etc.
*   **Authentication:** OAuth 2.0.
*   **Client Libraries:** These notes reference Python client libraries because early API exploration was done in Python. The production V1 stack uses Node.js with the `googleapis` npm library. Python references here are for research and prototyping context only.
*   **Notes:** Need to map user's business goals and audience segments to appropriate campaign structures, keywords, and bidding strategies. Requires careful handling of API request structures and response parsing.

## 4. General Notes on Google APIs

*   **OAuth 2.0:** Central to all Google API interactions. Requires careful management of access and refresh tokens, including secure storage and automatic refreshing.
*   **API Quotas:** All Google APIs have quotas. Robust error handling, rate limiting (token bucket/leaky bucket), and retry mechanisms with exponential backoff are essential.
*   **Client Libraries:** Leverage official client libraries where available for ease of use and maintained compatibility.
*   **Documentation Gaps:** Public documentation may not always be exhaustive, especially for specific parameter configurations or edge cases. Expect to use experimental approaches and community resources.

## 5. Action Items from Research

*   Investigate `google-api-python-client` for GBP and GTM interaction.
*   Focus Python scripting on GTM API for tag/trigger creation, paying close attention to parameter payloads. Use `create_gads_tag.py` as a starting point.
*   Thoroughly study Google Ads API documentation for campaign creation, bidding strategies, and keyword planning.
*   Implement robust OAuth token management and refresh logic.
*   Design and implement rate limiting and retry strategies for all Google API calls.