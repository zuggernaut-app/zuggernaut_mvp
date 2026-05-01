    343|-	Unit tests for state transitions, config selection, idempotency keys, and verification logic.
    344|-	Integration tests with mocked Google API responses.
    345|-	Sandbox/manual E2E tests for a full SetupRun before any real customers.
    346|
    347|### Phase 14: Deployment
    348|Purpose: deploy safely without overbuilding infra.
    349|
    350|Instructions:
    351|- Deploy frontend to Firebase Hosting.
    352|- Deploy backend API to Railway.
    353|- Deploy Temporal workers to Railway or the same hosting strategy, separated from API process.
    354|- Use MongoDB Atlas for persistence.
    355|- Use Temporal Cloud for simplest MVP operations if budget allows; otherwise use local/self-hosted only for development and revisit production hosting before launch.
    356|
    357|## What To Defer Explicitly
    358|Do not implement these in V1:
    359|- GBP write operations.
    360|- Automated GTM snippet installation.
    361|- GA4 deep integration.
    362|- SEO module.
    363|- Website builder.
    364|- Meta Ads, LinkedIn Ads, Instagram Ads.
    365|- Automated optimization engine.
    366|- Full Prometheus/Grafana/OpenTelemetry stack.
    367|- Custom ops dashboard beyond what Temporal UI and logs provide.
    368|
    369|## Definition of Done For V1
    370|V1 is done when:
    371|- A new user can register/login and complete business onboarding.
    372|- Confirmed `BusinessContext` is stored.
    373|- The user can connect required Google integrations.
    374|- A `SetupRun` is created and executed by Temporal.
    375|- GBP audit is generated read-only.
    376|- Google Ads conversion catalog is fetched and selected.
    377|- GTM conversion tracking is configured and structurally verified.
    378|- Google Ads campaigns are created automatically after verification.
    379|- The dashboard shows GBP audit, GTM status, Ads campaign status, and stuck-state recovery instructions.
    380|- Retries do not duplicate external GTM or Ads resources.
    381|
    382|## Implementation Discipline For Cursor Composer
    383|Use small, isolated implementation tasks:
    384|- One model at a time.
    385|- One workflow or activity at a time.
    386|- One capability service at a time.
    387|- One frontend screen at a time.
    388|- **Before pushing:** follow `CONTRIBUTING.md` (human checklist). From repo root run `npm run check:before-push` to block accidental staging of `.env` files; optionally enable the Git hook (`git config core.hooksPath .githooks`) so the same check runs on every `git push` on your machine.
    389|- Follow **Temporal workflow and activity design discipline** under Phase 3—balance granularity (retries, visibility) with scale (task overhead, workflow readability).
    390|- Add tests immediately for orchestration and idempotency-sensitive code.
    391|- Do not mix provider integrations into route handlers.
    392|- Do not add V2 modules while V1 setup flow is incomplete.
