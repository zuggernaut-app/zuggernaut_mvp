# Measurement & Attribution

## Context
When an AI agent needs to understand how to track campaign performance, measure success, and attribute conversions across different touchpoints, especially in a privacy-conscious environment.

## Core Concepts
*   **Importance:** Essential for understanding campaign effectiveness, ROI, optimizing spend, and demonstrating value.
*   **Key Tools & Technologies:**
    *   **Google Analytics 4 (GA4):** Tracks website/app user behavior, providing insights into traffic sources, user journeys, and conversions. It's event-driven and focuses on user lifecycle.
    *   **Google Tag Manager:** Facilitates the implementation and management of tracking codes (like GA4 tags, Google Ads conversion tags) without direct code edits.
    *   **Google Ads Conversion Tracking:** Setting up specific actions (purchases, form submissions, calls) to be measured as conversions originating from Google Ads.
*   **Attribution Modeling:** Assigning credit for conversions across multiple touchpoints. Google Ads offers various models (e.g., Data-Driven, Last Click, Linear), with Data-Driven being the default and often recommended for a more holistic view.
*   **Key Metrics:** ROAS, CPA, CTR, Conversion Rate, Impression Share.
*   **Privacy-Centric Measurement:**
    *   **Consent Mode:** Allows signals to be sent to Google regarding user consent status for analytics and ads, adjusting tag behavior accordingly.
    *   **First-Party Data Reliance:** Increased importance of using data collected directly from users (e.g., website visitors, CRM data) for targeting and measurement.

## Decision Rules
*   IF running conversion-focused campaigns THEN ensure robust conversion tracking is set up via Tag Manager and GA4, with appropriate consent mode implementation.
*   IF evaluating campaign performance THEN use GA4 and Google Ads data, understanding the attribution model used to avoid misinterpretations.
*   IF privacy changes significantly impact tracking THEN prioritize first-party data strategies and explore Google's privacy-preserving measurement solutions.
*   IF using Performance Max campaigns THEN ensure conversion goals are clearly defined and accurately tracked in GA4.

## Related Files
*   `strategy/platform_overview.md` (Native Integrations)
*   `core_concepts/roas.md`
*   `core_concepts/automation_ai.md`
*   `core_concepts/first_party_data.md`
*   `implementation/conversion_tracking.md`
