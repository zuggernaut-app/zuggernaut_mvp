# ADR 0002: GTM Snippet Installation - V1 Manual Approach

## 1. Title

GTM Snippet Installation - V1 Manual Approach

## 2. Status

Accepted

## 3. Context

Zuggernaut V1 aims to automate the setup of Google Tag Manager (GTM) conversion tracking. A crucial prerequisite for GTM to function is the installation of the GTM container snippet within the `<head>` section of a business's website. Automating this installation across the diverse landscape of website platforms (custom HTML, WordPress, Shopify, Wix, etc.) presents significant technical challenges and risks for a V1 product.

## 4. Decision

For Version 1 (V1) of Zuggernaut, the installation of the GTM container snippet on the client's website will be a **manual process** guided by clear instructions provided by the platform. Zuggernaut will generate the necessary snippet code and provide step-by-step guidance on how to add it to the website's HTML. Full automation of this step is deferred to V2.

## 5. Rationale

*   **Technical Complexity:** Different website platforms (CMS, static site generators, custom builds) have vastly different methods for code injection. Automating this reliably across a wide range of targets is a complex engineering problem requiring platform-specific integrations or sophisticated code injection techniques.
*   **Risk Mitigation:** Incorrectly modifying a website's code can lead to site breakage or performance issues. A manual approach keeps website code changes under the control of the business owner or their existing website administrator.
*   **Focus on Core Differentiation:** Zuggernaut's core value proposition in V1 lies in the *automated configuration* of GTM tags and triggers and Google Ads campaigns, leveraging AI and API integrations. Automating snippet installation, while important for UX, is secondary to this core differentiation for V1.
*   **User Control & Feedback:** Requiring manual installation ensures the user is aware of and directly responsible for the GTM tracking setup on their site, fostering transparency.
*   **Feasibility for V1:** It is more feasible to provide excellent documentation and clear instructions for a manual process within the V1 timeline than to build a robust, automated solution for diverse website architectures.

## 6. Consequences

*   **Positive:**
    *   Allows for a faster V1 launch by reducing development scope.
    *   Mitigates risks associated with automated code injection on user websites.
    *   Keeps the focus on the core value proposition of automated GTM/Ads configuration.
    *   Provides a clear path for improvement in V2.
*   **Negative:**
    *   Adds a manual step for the user, potentially creating friction in the onboarding process.
    *   May reduce the perceived "end-to-end automation" value for less technical users.
    *   Requires clear, high-quality user guidance documentation.

## 7. Alternatives Considered

*   **Automated Snippet Installation (V1):** Rejected due to high technical complexity, platform diversity, and associated risks. This is a key target for V2 automation.
*   **Integrate with GA4 (instead of GTM):** Rejected because GTM is a more flexible platform for managing various tracking tags (including Google Ads conversions), and the goal is to set up GTM as the central hub. Direct GA4 integration would bypass GTM, which is a core part of the planned automated setup.

## 8. Conclusion

Implementing manual GTM snippet installation with comprehensive guidance is the most pragmatic and risk-averse approach for Zuggernaut V1. This decision allows the team to focus on delivering the core automated GTM tag and Ads campaign setup features while paving the way for full automation in future releases.

## Related ADRs

*   ADR 0004: Structural Verification Gate for GTM Triggers