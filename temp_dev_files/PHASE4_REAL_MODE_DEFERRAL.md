# Phase 4 — Real-mode validation deferral record

**Date:** 2026-05-31  
**Status:** **BLOCKED** (execution started 2026-05-31; not FAIL)

## Decision

Real Google end-to-end validation **cannot PASS** until operator completes preflight and checklist. Execution was started 2026-05-31; blockers are documented in [`phase4-real/PHASE4_EXECUTION_LOG.md`](./phase4-real/PHASE4_EXECUTION_LOG.md).

## Why deferred (not FAIL)

| Blocker | Notes |
|---------|--------|
| No committed `backend/.env` | Secrets must not live in repo; only `.env.example` is versioned |
| Google OAuth client + Ads developer token | Operator-held; requires Google Cloud / Ads API onboarding |
| Sandbox Google account | Real consent and provisioning paths need human OAuth in browser |
| Temporal + worker | Real mode requires live worker (not `TEMPORAL_E2E_MOCK`) |

Mock-mode sign-off (Phase 2), production readiness (Phase 1), and CI guards (Phase 3) are **PASS**. No code defects were found that block real-mode execution.

## What is ready for operator execution

1. **Preflight script:** `npm run verify:real-mode-env` — validates mock flags off and required vars present
2. **Checklist:** [`REAL_MODE_E2E_CHECKLIST.md`](../REAL_MODE_E2E_CHECKLIST.md)
3. **Env matrix:** [`backend/.env.example`](../../.env.example)
4. **Evidence template:** [`V1_REMEDIATION_EXECUTION.md`](../../../V1_REMEDIATION_EXECUTION.md#evidence-capture-template)

## Operator steps to reach Phase 4 PASS

1. Copy `.env.example` → `.env`; fill real-mode values (see mode matrix).
2. Run `npm run verify:real-mode-env` until exit 0.
3. Start MongoDB, Temporal, worker, API, frontend (see checklist).
4. Execute `REAL_MODE_E2E_CHECKLIST.md`; capture evidence per template.
5. Update `V1_REMEDIATION_EXECUTION.md` Phase 4 tracker to **PASS** and fill evidence log.

## Re-validation after any real-mode code fix

If a real-mode run exposes a defect requiring code changes to idempotency-sensitive paths:

- Re-run full backend `npm test` (especially idempotency / provisioning / campaign suites)
- Re-run affected checklist items in real mode before declaring PASS
