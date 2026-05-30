# Google Ads Account Setup

## Context
When an AI agent needs to guide the step-by-step process of creating a new Google Ads account, including handling common issues, settings, and recent changes in the setup flow.

## Core Concepts
*   **Accessing the Platform:** Navigate to `www.ads.google.com`.
*   **Prerequisites:** A Gmail ID is the primary requirement.
*   **Account Creation Flow:**
    *   **Expert Mode:** The initial setup often presents a "guided tour" or "smart campaign" setup. It is **highly recommended to bypass this** and switch to **Expert Mode** for more control. Look for options like "Switch to expert mode," "Skip guided tour," or "Create an account without a campaign."
    *   **Recent UI Trends:** Google continues to push towards automated campaign types like Performance Max even during initial setup, reinforcing the need to find the expert mode option.
*   **Essential Settings (Choose Carefully at Creation):
    *   **Billing Country:** Determines available payment methods and currency.
    *   **Time Zone:** Affects ad scheduling and reporting times.
    *   **Currency:** Sets the default currency for billing and reporting; **cannot be changed later without creating a new account.**
*   **Payment Method:**
    *   Often required during setup, especially if using certain promotions or in specific regions.
    *   Options vary by country (e.g., Credit Card, UPI, Net Banking).
    *   **Workaround:** If a card is mandatory but not desired initially, add one but avoid running live campaigns. Alternatively, try deleting and restarting the account creation process, or use a new Gmail ID, as some instances might allow skipping this step.
*   **User Access:** Multiple users (with Gmail IDs) can be added to an account after creation.
*   **Multiple Accounts:** One Gmail ID can manage multiple Google Ads accounts, useful for different clients, countries, or campaign types.

## Decision Rules
*   IF setting up for a new client THEN ensure currency and billing country match the client's primary needs.
*   IF encountering a mandatory payment prompt and no card is available THEN advise trying to delete and re-create the account, or use a new Gmail ID.
*   IF setting up for a freelancer/agency THEN recommend creating separate accounts per client for organizational and billing clarity.
*   IF the user is completely new to Google Ads THEN explain the importance of switching to expert mode to avoid limitations of smart campaigns.

## Related Files
*   `strategy/platform_overview.md` (Accessibility & Cost Model, Native Integrations)
*   `tactics/measurement_attribution.md`
