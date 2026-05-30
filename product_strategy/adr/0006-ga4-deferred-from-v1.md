# ADR 0006: GA4 Deferred From V1

## 1. Title

GA4 Deferred From V1

## 2. Status

Accepted

## 3. Context

GA4 can provide richer analytics and reporting, and it may become valuable for future optimization workflows. However, Zuggernaut V1 is focused on taking a small business from no practical marketing setup to a working GBP audit, GTM conversion setup, and initial Google Ads campaign.

Adding GA4 as a required V1 dependency would increase setup complexity, permission scope, data interpretation requirements, and QA burden.

## 4. Decision

GA4 is deferred from required V1 scope. V1 will use GTM as the primary conversion tracking configuration layer for Google Ads. GA4 may be explored in V2+ for analytics, reporting, and optimization, but it should not block V1 onboarding or Google Ads launch.

## 5. Rationale

*   **Scope discipline:** V1 must focus on the smallest useful stack that delivers the "0 to 1" marketing setup.
*   **Implementation simplicity:** GTM is the correct control plane for deploying conversion tags and triggers.
*   **Lower onboarding burden:** Fewer required Google products and permissions reduce user friction.
*   **Cleaner architecture:** GA4 can be added later as a reporting and optimization capability without changing the core V1 promise.

## 6. Consequences

*   **Positive:**
    *   Keeps V1 simpler and easier to ship.
    *   Reduces permission and configuration complexity.
    *   Keeps the V1 product centered on setup, not analytics expansion.
*   **Negative:**
    *   V1 reporting will be less rich than a full GA4-backed analytics layer.
    *   Some future optimization features will need additional integration work.

## 7. Alternatives Considered

*   **Make GA4 required in V1:** Rejected because it expands the V1 surface area beyond the core setup goal.
*   **Use GA4 instead of GTM:** Rejected because GTM is more appropriate for managing conversion tag deployment and trigger configuration.

## 8. Conclusion

GA4 should remain a V2+ analytics and optimization layer, not a required V1 dependency.

## Related ADRs

*   ADR 0002: Manual GTM Snippet Installation - V1 Manual Approach