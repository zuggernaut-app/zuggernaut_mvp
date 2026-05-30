# Zuggernaut Product Strategy Docs

This folder is the decision system for the Zuggernaut product strategy and V1 architecture.

## Recommended Reading Order

1. `product/strategy-canon.md`
   - The source of truth for product vision, target user, V1 scope, V2 scope, differentiation, non-goals, and assumptions.
2. `product/v1-scope.md`
   - The detailed V1 product boundary: what is included, what is excluded, and what the user experience should be.
3. `architecture/architecture-review.md`
   - The architecture brief intended for senior technical review.
4. `architecture/implementation-blueprint.md`
   - The implementation-level breakdown of services, data models, workflows, reliability, and security requirements.
5. `adr/`
   - Architecture Decision Records explaining the major decisions and trade-offs.
6. `research/`
   - Supporting research notes, Google API assumptions, and conversation-derived context.

## Source Of Truth

`product/strategy-canon.md` is the canonical product strategy document. If another document conflicts with it, update the other document or explicitly record a new ADR that changes the canon.

## V1 Boundary

V1 includes:

- Google Business Profile audit only, with no profile modifications.
- Google Tag Manager conversion tracking setup through the GTM API.
- Manual GTM snippet installation by the customer, supported by clear instructions and checks.
- Automated Google Ads campaign creation only after the required tracking setup and verification steps pass.

V1 excludes:

- Google Business Profile edits.
- Automated website code changes or CMS-specific GTM snippet installation.
- GA4 as the primary V1 tracking system.
- SEO implementation.
- Website builder or website revamp features.
- Ongoing campaign optimization beyond initial campaign setup.

## Maintenance Rules

- Keep V1 and V2 boundaries explicit in every product or architecture document.
- Record irreversible product or architecture decisions as ADRs.
- Mark uncertain API details as assumptions to verify, not as final implementation facts.
- Store implementation risks with owners, verification steps, and fallback behavior.
- Prefer small, versioned configuration for GTM templates, campaign templates, prompts, and audit rules.
