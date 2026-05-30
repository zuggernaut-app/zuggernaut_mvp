# Privacy Considerations

## Context
When an AI agent needs to understand how privacy regulations and changes impact advertising strategies, targeting, and measurement.

## Core Concepts
*   **Evolving Regulations:** Awareness of data privacy laws (e.g., GDPR, CCPA) and their implications.
*   **Cookie Deprecation:** The shift away from third-party cookies necessitates new approaches to tracking and targeting.
*   **Consent Management:** Importance of user consent for data collection and usage.
*   **Google's Adaptations:** Google Ads is evolving with AI-driven insights, consent modes, and privacy-preserving measurement solutions.
    *   **Consent Mode:** Allows signals to be sent to Google regarding user consent status for analytics and ads.
    *   **First-Party Data Reliance:** Increased importance of using data collected directly from users (e.g., website visitors, CRM data).

## Decision Rules
*   IF running campaigns in regions with strict privacy laws THEN ensure compliance with consent requirements using tools like Google Tag Manager and Consent Mode.
*   IF relying on third-party data THEN explore first-party data strategies and Google's privacy-centric solutions.

## Related Files
*   `tactics/measurement_attribution.md`
*   `core_concepts/automation_ai.md`
*   `core_concepts/first_party_data.md`
