# ADR 0007: Automated Google Ads Conversion Action Creation

## Status
Accepted

## Context

Zuggernaut aims to automate the setup of Google Ads campaigns for small businesses. A critical component of effective Google Ads campaigns is conversion tracking, which involves defining specific actions users take on a website (e.g., form submissions, phone calls, purchases) that are valuable to the business. These actions are represented as "Conversion Actions" within Google Ads.

Currently, many small businesses either do not have conversion tracking set up, or their existing setup is incomplete or misconfigured. Relying solely on existing conversion actions found via discovery could lead to suboptimal campaign performance or inability to launch campaigns if no suitable actions are found. Manual intervention to create conversion actions is contrary to Zuggernaut's automation goals.

Therefore, a decision is needed on how Zuggernaut will handle the creation and management of Google Ads Conversion Actions, especially in the context of ensuring that the **Core Targeting & Conversion Goal Linking** bucket of parameters for campaign creation is always met.

## Decision

Zuggernaut will automate the creation of Google Ads Conversion Actions based on predefined templates and business goals, prioritizing programmatic creation when suitable existing conversion actions are not found. This process will be tightly integrated with the overall campaign setup workflow and will directly support the **strict enforcement of parameters for Core Targeting & Conversion Goal Linking.**

### Key Principles:

1.  **Discovery First, Create Second:** Zuggernaut will first attempt to discover existing, suitable conversion actions within the linked Google Ads account. Suitability will be determined by matching types (e.g., "form submit," "phone call") and other configurable criteria against the business's stated goals.
2.  **Programmatic Creation:** If suitable conversion actions are not found, Zuggernaut will programmatically create them using the Google Ads API. These created conversion actions will be based on standardized templates (e.g., "Form Submission Lead," "Phone Call Lead") with sensible defaults for attributes like `category`, `status`, `counting_type`, etc.
3.  **Idempotency:** The creation process must be idempotent. Before creating a new conversion action, Zuggernaut will check if a conversion action with a similar name/configuration (representing the same logical intent) already exists to prevent duplicates upon retries.
4.  **Linkage to Campaigns:** Newly created or discovered conversion actions will be automatically linked to the Google Ads campaigns created by Zuggernaut, ensuring that the **Campaign Conversion Goal** parameters are always correctly populated and validated.
5.  **Auditability:** All created conversion actions will be logged and associated with the `SetupRun`, allowing for transparency and future auditing.
6.  **User Input for Details:** While the creation will be automated, the system may prompt the user for specific details where necessary (e.g., a specific value for a purchase conversion, or a precise event name for a custom conversion) if these cannot be intelligently derived or templated.

## Consequences

### Positive:

*   **Increased Campaign Launch Success:** Ensures that campaigns can always be launched with proper conversion tracking, as missing conversion actions will no longer be a blocker.
*   **Improved Campaign Performance:** Campaigns will be optimized for relevant business goals from the outset, leading to better performance for SMBs.
*   **Full Automation:** Reduces the need for manual setup and configuration, aligning with Zuggernaut's core value proposition.
*   **Standardization:** Promotes best practices in conversion tracking by using standardized, optimized templates.
*   **Supports Strict Parameter Enforcement:** Directly addresses the need to always have valid conversion goals defined and linked, thereby enabling the strict validation strategy for Google Ads campaign creation.

### Negative:

*   **Increased Google Ads API Calls:** More API calls will be made for discovery and potential creation of conversion actions.
*   **Complexity in Idempotency:** Requires careful implementation of idempotency logic to prevent duplicate conversion actions.
*   **Potential for "Default" Over-creation:** If not carefully managed, could lead to the creation of many default conversion actions that are not perfectly tailored to every unique business case, though these will be functional.
*   **Maintenance:** Requires ongoing maintenance of conversion action templates as Google Ads API evolves or best practices change.

## Mitigation:

*   **Rate Limiting & Caching:** Implement robust rate limiting and caching for Google Ads API calls to manage increased volume.
*   **Thorough Idempotency Logic:** Develop and rigorously test idempotency checks based on conversion action names, categories, and potentially `externalId` tracking.
*   **Configurable Templates:** Ensure conversion action templates are configurable (e.g., via `backend/config/rules/`) to allow for easy updates and customization without code changes.
*   **Smart Defaults & User Confirmation:** Use intelligent defaults that work for most SMBs, but provide an option for user review and confirmation of proposed conversion actions where ambiguity exists or customization is highly beneficial.
*   **Focus on High-Impact Conversion Types:** Initially, focus automation on the most common and highest-impact conversion types (e.g., leads, calls, purchases) to minimize over-creation of less critical actions.

## Status Update:

This ADR remains accepted. The implementation of automated conversion action creation is crucial for ensuring the integrity and completeness of Google Ads campaign setup. It directly supports the strategy of strictly enforcing **Core Targeting & Conversion Goal Linking** parameters, as outlined in the updated architecture and implementation plans. The system will leverage specific activity functions to discover existing conversion actions and, if necessary, programmatically create them, ensuring all campaigns are launched with valid and relevant conversion goals. This will involve the `AdsConversionCatalogService` and `googleAdsConversionActionClient` to ensure these critical parameters are always satisfied.