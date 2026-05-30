# ADR 0001: GBP Audit - V1 Scope Decision

## 1. Title

GBP Audit - V1 Scope Decision

## 2. Status

Accepted

## 3. Context

The Zuggernaut product aims to automate digital marketing setup for small businesses. A core component involves leveraging Google's APIs. For Google Business Profile (GBP), initial discussions considered full management capabilities. However, given the V1 focus on core setup automation and the desire to minimize complexity and risk, the scope for GBP needs to be clearly defined.

## 4. Decision

For Version 1 (V1) of Zuggernaut, the Google Business Profile (GBP) functionality will be limited to a **read-only audit** of the existing business profile information. This means the platform will fetch and analyze the current GBP listing data against a set of best practices but will **not** allow any modifications or updates to the profile via the Zuggernaut platform.

## 5. Rationale

*   **Minimizing Complexity:** Implementing full read/write capabilities for GBP, including all its nuances (hours, services, photos, Q&A, reviews), significantly increases development effort and complexity for V1. This complexity risks delaying the launch or compromising the quality of core automation features (GTM, Ads).
*   **Reducing Risk:** Modifications to GBP listings carry higher risks of unintended consequences or violations of Google's policies, which could negatively impact a business's visibility. A read-only approach mitigates this risk.
*   **Focus on Core Value:** Zuggernaut's primary differentiation in V1 is the *automation* of GTM conversion tracking and Google Ads campaign setup. A GBP audit provides valuable insights without the operational overhead of full management.
*   **User Experience:** Providing a clear audit report empowers users to make informed decisions about their GBP listing, which they can then update manually or through future Zuggernaut versions.
*   **API Limitations & Best Practices:** Focusing on read operations aligns with a phased approach to API integration and allows for thorough understanding of the GBP API before committing to write operations.

## 6. Consequences

*   **Positive:**
    *   Faster V1 development and launch.
    *   Reduced risk of policy violations or negative business impact.
    *   Clearer focus on core automation value proposition.
    *   Foundation for future GBP management features in V2.
*   **Negative:**
    *   Users cannot directly update their GBP information through Zuggernaut in V1.
    *   The "0 to 1" value proposition is slightly reduced in terms of immediate actionability on GBP.

## 7. Alternatives Considered

*   **Full GBP Management (Read/Write):** Rejected due to excessive complexity and risk for V1. Would require extensive UI development for managing all GBP attributes.
*   **No GBP Integration:** Rejected as GBP is a critical local SEO asset, and an audit provides immediate, actionable value.

## 8. Conclusion

Limiting GBP functionality to a read-only audit in V1 is a strategic decision to balance ambitious product goals with feasible development timelines and risk mitigation, while still providing tangible value to the end-user.

## Related ADRs

*   ADR 0003: SetupRun State Machine for Orchestration