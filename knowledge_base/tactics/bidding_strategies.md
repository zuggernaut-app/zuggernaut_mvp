# Bidding Strategies

## Context
When an AI agent needs to select the most appropriate bidding strategy to align with campaign objectives and optimize ad spend.

## Core Concepts
*   **Automated Bidding Strategies:** Google Ads heavily promotes automated strategies that use AI to optimize bids for conversions or conversion value. These are often the default and recommended approach for most campaigns.
    *   **Maximize Conversions:** Aims to get the most conversions within a set budget.
    *   **Target CPA (Cost Per Acquisition):** Aims to achieve conversions at a specific target cost.
    *   **Target ROAS (Return on Ad Spend):** Aims to achieve a specific return on ad spend.
    *   **Maximize Conversion Value:** Aims to maximize the total value of conversions.
*   **Manual CPC (Cost Per Click):** Allows direct control over the maximum bid for each click. Generally used for specific scenarios, granular control, or when conversion data is limited.

## Decision Rules
*   IF objective is "Online Sales" or "Leads" with sufficient conversion data THEN strongly consider automated strategies like Target ROAS, Maximize Conversions, or Target CPA.
*   IF objective is "Brand Awareness" or "Traffic" THEN automated strategies focused on reach or clicks might be suitable, but always monitor performance.
*   IF budget is limited and achieving a specific CPA is critical THEN Target CPA is a suitable choice.
*   IF running Performance Max campaigns THEN bidding is largely automated based on the campaign's conversion goals and value rules.
*   IF new to Google Ads or lack conversion data THEN starting with a simpler automated strategy like Maximize Conversions can help gather data.

## Related Files
*   `strategy/campaign_objectives.md`
*   `core_concepts/automation_ai.md`
*   `core_concepts/roas.md`
*   `tactics/measurement_attribution.md`
