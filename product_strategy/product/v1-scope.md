# V1 Product Scope: Zuggernaut

## 1. Executive Summary

Zuggernaut V1 provides a streamlined, automated solution for small businesses to establish their initial digital marketing presence across Google platforms. It focuses on core setup tasks for Google Business Profile (GBP), Google Tag Manager (GTM), and Google Ads, aiming to bridge the gap for businesses that cannot afford or access traditional marketing agencies. The V1 product takes businesses from "0 to 1" in their digital marketing efforts, with a clear roadmap for future expansion.

## 2. Core Features (V1)

### 2.1. Google Business Profile (GBP) Audit

*   **Objective:** Provide users with a clear understanding of their current GBP listing's completeness and adherence to best practices.
*   **Functionality:**
    *   Automated API integration to fetch existing GBP data.
    *   Analysis against a predefined audit checklist (e.g., completeness of info, categorization, service areas, hours, photos).
    *   Present a summary report highlighting missing information and areas for improvement.
*   **Limitations:** Read-only operation. No modifications will be made to the GBP listing in V1.

### 2.2. Google Tag Manager (GTM) Conversion Tracking Setup

*   **Objective:** Implement essential conversion tracking for Google Ads within the user's GTM container.
*   **Functionality:**
    *   Automated API integration to access the user's GTM account and container.
    *   Programmatic creation of GTM tags for Google Ads conversion tracking (e.g., Thank You page visits, form submissions).
    *   Programmatic creation of corresponding GTM triggers based on discoverable signals (e.g., URL patterns, specific click events).
    *   Requires user to manually provide GTM Container ID and Google Ads Conversion ID/Label.
*   **Limitations:** GTM snippet installation on the user's website is a manual step, with clear instructions provided. Trigger creation relies on common, discoverable patterns; advanced custom triggers are out of scope for V1.

### 2.3. Google Ads Campaign Creation

*   **Objective:** Launch initial, automated Google Ads campaigns tailored to the business's goals and audience.
*   **Functionality:**
    *   Automated API integration to create campaigns within the user's Google Ads account.
    *   Leverage user-provided business details (industry, services, goals, audience segments) to define campaign strategy.
    *   Generate campaign structure, ad groups, keywords, and ad copy using AI and predefined templates.
    *   Set up campaigns with appropriate bidding strategies (e.g., Maximize Conversions, Target CPA) and daily budgets.
    *   User input required for core business information, audience segmentation, and campaign goals.
    *   Launch only after required GTM setup and structural verification checks pass, or after a controlled manual review path is triggered.
*   **Limitations:** Focus on initial campaign setup. Ongoing campaign management and optimization are V2 features.

## 3. User Experience Flow (V1)

*   **Section 1: User Input & Permissions**
    *   Scraping of website for initial business context (fallback to manual input if scraping fails).
    *   User confirmation/correction of scraped business details (name, industry, service areas, order value, primary goal).
    *   User provides necessary API credentials and permissions (OAuth flow) for GBP, GTM, and Google Ads.
    *   User provides Google Ads Conversion ID/Label and GTM Container ID.
    *   User receives instructions and performs manual GTM snippet installation on their website.
*   **Section 2: Automated Backend Processes**
    *   GBP Audit is performed and results are generated.
    *   GTM conversion tracking tags and triggers are created.
    *   Structural tracking checks are run before Ads launch.
    *   Google Ads campaigns are created and launched only when required gates pass.
    *   Backend processes are hidden from the user, with status updates provided.

## 4. Technology Stack (High-Level)

*   **Frontend:** React (for user input and display)
*   **Backend:** Node.js (Express.js)
*   **APIs:** Google Business Profile API, Google Tag Manager API (v2), Google Ads API
*   **Data Storage:** MongoDB (for business context, campaign data, user settings)
*   **AI Integration:** OpenAI API (for ad copy, keyword generation, campaign strategy suggestions)

## 5. Key Differentiators (V1)

*   **Accessibility:** Empowers small businesses lacking agency budgets.
*   **Automation:** Reduces manual setup time and complexity for core marketing tools.
*   **Integrated Setup:** A single point of entry for essential Google marketing platforms.
*   **"0 to 1" Foundation:** Provides a starting point for businesses new to digital marketing.

## 6. V1 Non-Goals

- Editing or publishing changes to Google Business Profile.
- Automatically installing the GTM snippet into customer websites.
- Using GA4 as the required V1 tracking system.
- Providing SEO implementation, website builder functionality, or website revamps.
- Performing ongoing campaign optimization after initial campaign creation.
- Supporting advanced custom GTM triggers that require bespoke website analysis.

## 7. Future Considerations (V2+)

- Automated GBP modifications.
- Automated GTM snippet installation for major CMS platforms.
- Advanced GTM trigger configurations.
- Enhanced GA4 integration and reporting.
- SEO audit and basic recommendations.
- Ongoing campaign management and optimization features.
- Expanded audience segmentation and targeting options.
- Website builder/enhancement tools.