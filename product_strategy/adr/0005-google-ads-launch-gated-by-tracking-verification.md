# ADR 0005: Google Ads Launch Gated By Tracking Verification

## 1. Title

Google Ads Launch Gated By Tracking Verification

## 2. Status

Accepted

## 3. Context

Zuggernaut V1 creates initial Google Ads campaigns for small businesses. Because ads spend real money, campaign launch should not happen blindly if conversion tracking setup is incomplete or structurally invalid. GTM setup is a core V1 differentiator, and Google Ads should depend on that setup reaching a minimum reliability threshold.

## 4. Decision

Google Ads campaign creation and launch will be gated by required tracking setup checks. The system may prepare campaign configuration before verification, but active launch should only proceed when:

*   Required GTM access and configuration steps have completed.
*   Required conversion IDs/labels or equivalent Ads conversion metadata are available.
*   Required structural verification checks pass.
*   Or a controlled manual review path explicitly approves launch.

## 5. Rationale

*   **Protect customer budget:** Ads should not launch when conversion tracking is clearly incomplete.
*   **Preserve product trust:** A failed first campaign experience damages confidence in the product.
*   **Align V1 value:** The value proposition is not just creating ads, but creating ads with foundational tracking in place.
*   **Support operations:** A manual review path allows progress when automated checks are inconclusive rather than permanently blocking setup.

## 6. Consequences

*   **Positive:**
    *   Reduces wasted ad spend.
    *   Forces clean separation between campaign preparation and campaign launch.
    *   Creates an auditable launch decision.
*   **Negative:**
    *   Adds one more gate that can delay onboarding.
    *   Requires clear UX for setup-pending and manual-review states.

## 7. Alternatives Considered

*   **Launch immediately after campaign creation:** Rejected because it risks running campaigns without working tracking.
*   **Require full behavioral conversion proof before launch:** Rejected for V1 because end-to-end conversion simulation across arbitrary SMB websites is too complex and brittle.

## 8. Conclusion

Google Ads launch should be gated by structural tracking verification in V1, with a controlled manual review fallback for ambiguous cases.

## Related ADRs

*   ADR 0004: Structural Verification Gate for GTM Triggers