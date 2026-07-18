# Phase 10 Real-Mode E2E Checklist (Google Ads Campaign Creation)

Execute after Phase 10 PR1–PR4 code is deployed and mock-mode regression is green.

**Prerequisites:** [`REAL_MODE_E2E_CHECKLIST.md`](./REAL_MODE_E2E_CHECKLIST.md) preflight (`npm run verify:real-mode-env` in `backend/`).

**Evidence:** capture runs in [`evidence/PHASE10_REAL_MODE_E2E_EVIDENCE.md`](./evidence/PHASE10_REAL_MODE_E2E_EVIDENCE.md).

**Post-run verifier:** from `backend/`:

```powershell
npm run verify:phase10-setup-run -- <setupRunId>
```

---

## Scope (Phase 10 definition of done)

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | `validateCampaignIntent()` enforces buckets 1–3 | Intent failure surfaces `ADS_INTENT_*` + `validationBucket` on `ads_campaign_creation` step |
| 2 | No silent RSA/keyword/geo fallbacks on product path | Campaign uses validated intent only; geo fails with `ADS_INTENT_UNRESOLVED_GEO` when ambiguous |
| 3 | Keywords created via API | `ads_keyword` artifacts; keywords visible in Google Ads UI (PAUSED) |
| 4 | Geo targets created via API | `ads_campaign_criterion` artifacts; location target visible on campaign |
| 5 | Conversion goal linkage | `ads_custom_conversion_goal` + `ads_conversion_goal_campaign_config` artifacts |
| 6 | Idempotency | Second run on same `setupRunId` reuses artifacts (`idempotent: true`) |
| 7 | Structural verification gate (strict) | Ads creation **blocked** when verification is `snippet_pending`, `needs_tracking_fix`, or `manual_review` |
| 8 | Orchestration order | budget → campaign → geo → ad group → keywords → RSA → conversion goals |

---

## Environment (real mode)

- [ ] `GOOGLE_ADS_API_MOCK=false`, `GOOGLE_ADS_API_ENABLED=true`
- [ ] `GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED=true` (if catalog slots were empty)
- [ ] Sandbox `customerId` selected and persisted on `IntegrationConnection`
- [ ] Billing active on target Google Ads customer (required for mutates)

---

## Happy path (structural verification passes)

1. [ ] Confirmed `BusinessContext` with Ads readiness fields (website, service area, goals, ad copy seeds)
2. [ ] Google Ads connected; customer selected
3. [ ] GTM connected **and** snippet installed so structural verification returns `pass` (strict gate)
4. [ ] Start setup run → reaches `SUCCEEDED`
5. [ ] `npm run verify:phase10-setup-run -- <setupRunId>` exits **0**
6. [ ] Google Ads UI — PAUSED **Search** campaign `{businessName} — Zuggernaut Search`
7. [ ] Google Ads UI — ad group `{businessName} — Core` (PAUSED)
8. [ ] Google Ads UI — RSA with validated headlines/descriptions (no filler copy)
9. [ ] Google Ads UI — keywords from intent (PAUSED, PHRASE)
10. [ ] Google Ads UI — location target matches resolved `geoTargets[0].label`
11. [ ] Google Ads UI — custom conversion goal linked to campaign
12. [ ] Setup report / meta `adsCampaignSummary` includes `keywordsCreated`, `geoTargetsCreated`, `keywordExternalIds`, `geoExternalIds`

Record: `setupRunId`, redacted `customerId`, artifact counts, verifier JSON output.

---

## Idempotency retry

1. [ ] Re-trigger `ads_campaign_creation` for the **same** `setupRunId` (Temporal retry or activity re-run)
2. [ ] `IntegrationArtifact` counts unchanged for `ads_keyword` and `ads_campaign_criterion`
3. [ ] Activity result `idempotent: true`, `reusedArtifacts > 0`

---

## Structural gate (must block Ads)

Run **separate** sandbox runs (do not use happy-path account if it would leave campaigns behind):

| Scenario | Expected terminal | `createAdsCampaignActivity` |
|----------|-------------------|----------------------------|
| GTM snippet missing | `GTM_SNIPPET_PENDING` | **not run** |
| Tracking elements missing | `SETUP_NEEDS_TRACKING_FIX` | **not run** |
| Website fetch failed | `SETUP_NEEDS_MANUAL_REVIEW` | **not run** |
| GTM not configured (optional) | `SUCCEEDED` (verification skipped → `pass`) | **runs** |

---

## Intent failure path (optional)

1. [ ] Use BusinessContext that fails Ads readiness or intent validation
2. [ ] `ads_campaign_creation` fails with stable code (e.g. `ADS_READINESS_*` or `ADS_INTENT_*`)
3. [ ] Step `details.validationBucket` populated; `SetupRun.lastErrorSummary` is human-readable

---

## Sign-off

| Field | Value |
|-------|--------|
| Operator | `____________` |
| Date | `____________` |
| Happy-path `setupRunId` | `____________` |
| Verifier exit code | `____________` |
| Phase 10 status | `PASS` / `BLOCKED` |

Update [`evidence/PHASE10_REAL_MODE_E2E_EVIDENCE.md`](./evidence/PHASE10_REAL_MODE_E2E_EVIDENCE.md) when complete.
