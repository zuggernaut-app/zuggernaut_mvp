# Customer onboarding hardening — Tiers 0–3

**Purpose:** Single place to finish customer-readiness work in one pass. Each item has a clear **class** (bug / missing gate / deferred product / scale gap), **issue**, **proposed fix**, and **primary paths**.

**Related:** [`BACKEND_STABILITY_BACKLOG.md`](./BACKEND_STABILITY_BACKLOG.md) (P0–P2 code review), [`docs/DEPLOY.md`](../../docs/DEPLOY.md), [`mvp_implementation_plan.md`](../../mvp_implementation_plan.md).

**Rule:** Ship **Tier 0 → Tier 1** before Tier 2/3 product expansion. Mark **Status** as you go: `todo` | `in_progress` | `done` | `accepted` | `deferred`.

**Last RCA pass:** 2026-07-29 (Ask mode — diagnose only; no fixes applied).
**Revised:** 2026-08-02 (second-opinion review incorporated; round 6).

---

## How to use this for a one-shot pass

1. Work tiers in order; within a tier, prefer the **Suggested order** tables.
2. Fix **one item at a time**; update tests that currently lock in bad contracts (see stability backlog "Test suite debt").
3. When done with an item: set Status + link commit/PR.
4. Do **not** treat "phases 0–14 complete" as "customer-ready."

---

## Tier 0 — Must fix before many customers

**Class:** Safety / trust. Happy path can double-create, measure wrong, or break silently under real hosting + Google.

| ID | Status | Class | Issue | Proposed fix | Primary paths | Stability map |
|----|--------|-------|--------|--------------|---------------|---------------|
| T0-1 | done | Missing product gate | No one-setup / concurrent-run guard — `POST /setup-runs` always creates a new run; idempotency is `setupRunId`-scoped → re-click duplicates Ads/GTM; check-then-create races under concurrent clicks; vague `force` can fight the unique guard later; clearing Mongo while Temporal still runs dual-mutates Google | Atomically claim start (unique/partial index or equivalent CAS on active/succeeded per `businessId`) so concurrent starts cannot both succeed; return `409` for `RUNNING` / `SUCCEEDED` (`setup_already_complete` / `setup_in_progress`); **lock must carry explicit states (`idle`/`claiming`/`running`/`succeeded`/`failed`) with cleanup/retry** — if Temporal start fails or the process crashes after claim, a recoverable sequence must release or reclaim the lock (no permanent `claiming`); **`force` must explicitly archive/supersede prior success** (clear or move setup-state lock) before allowing a new run — never bypass the unique guard with a raw create; **if prior run is `RUNNING`, require confirmed workflow `terminated`/`closed` from Temporal before unlocking** (or hard-block `force` until not `RUNNING`) — never clear Mongo lock alone; **activities must be idempotent and keyed by `setupRunId/businessId`** so a late in-flight activity after cancel cannot double-mutate Google; **each mutating activity must re-verify it is still the current active setup run/generation for that `businessId` immediately before any provider mutation** (current-run guard) so a superseded run's late activity cannot write to Google; **until the current-run guard and T0-8 mutation idempotency are shipped, `force` is hard-blocked while `RUNNING`** (no supersede path) | `backend/api/v1/setupRuns.js`, `SetupRun` indexes/model (or `BusinessSetupState`), Temporal client cancel + confirm, activity current-run guard, FE Start page | P2-4 |
| T0-2 | done | Bug vs discovery contract | Provisioning auto-picks Ads `accessibleCustomerIds[0]` and first GTM account | If accessible Ads customers exist and no user selection → `selection_required` with explicit choice: **select existing** vs **create new under MCC** (do not auto-pick `[0]`; do not silently block MCC create); GTM auto-link only if exactly 1 account; update tests | `adsProvisioningService.js`, `gtmProvisioningService.js`, selection UX | P0-4 |
| T0-3 | done | Bug / incomplete data | GTM `awct` uses Ads **customer id** + conversion-action **API id** as conversionId/label — wrong for measurement; blind repair can break live tracking | Persist `tag_snippets` (or equiv.) on catalog/create; templates use real conversion ID + label; unit-test payload; **before any dry-run, run a read-only inventory/scan of existing artifacts + published GTM containers to confirm whether wrong tags already exist** — repair is a no-op only if the scan proves zero affected containers; **repair/backfill** only via dry-run → explicit operator/customer approval → new GTM workspace/version → publish with documented rollback; never mutate the live container blindly | `gtmTemplates/v1.js`, catalog/create clients, artifacts, repair path/script | P0-5 |
| T0-4 | done | Bug (wrong principal) | MCC `createCustomerClient` uses **tenant** OAuth; invite path correctly uses MCC admin | `mcc_create` branch: `getMccGoogleAdsAccessToken()` before create; assert in tests | `adsProvisioningService.js` → `googleAdsAccountClient.js` | P0-3 |
| T0-5 | done | Design gap vs deploy | Cookie `SameSite=lax` breaks Firebase SPA ↔ Railway API sessions; CSRF on only some routes leaves other mutations open | Prod/cross-origin: `SameSite=None; Secure`; keep `lax` for same-site local; update clearCookie + deploy docs; **CSRF on all cookie-authenticated mutating routes** (or same-site reverse-proxy topology instead of cross-site cookies) | `sessionCookie.js`, CORS/`FRONTEND_ORIGIN`, app-wide CSRF middleware or proxy, `docs/DEPLOY.md` | P0-1 |
| T0-6 | done | Missing egress policy | SSRF — scrape + structural verify fetch user URLs with no private/metadata IP block; separate DNS lookup then connect allows rebinding; axios-only pin leaves Playwright/`goto` open | Shared SSRF helper: resolve host, block private/link-local/metadata/localhost; **re-validate final host/IP after each redirect**; **pin/validate resolved IP at connection time** (custom lookup/agent or equivalent) so DNS rebinding cannot bypass; **for Playwright/headless choose one enforceable control and document it**: either (a) disable headless for untrusted URLs, or (b) route **all browser network requests** — top-level `goto`, subresources, XHR/fetch, iframes, redirects, downloads, and websockets — through a validated proxy/interception layer that applies the same blocklist/connection-time IP pin to every request, not just top-level navigation (a loaded page can SSRF through any of these); do not leave the browser path uncontrolled; **if headless is disabled for an untrusted URL, the scraper must return a deterministic fallback result: static-scrape only + an explicit `headless_disabled_ssrf` status on the scrape run** so downstream setup readiness does not silently assume complete headless scrape data; set `maxContentLength` on structural fetch. Call from scrape entry + structural verify (and robots if needed). | `lib/validation.js` or `lib/ssrf.js`, scrapers (`static` + `headless`), `structuralVerificationService.js` | P0-2 |
| T0-7 | done | Bug | Token refresh forces `connectionHealth = 'connected'`, clobbering `selection_required` / `provisioning_required` | Refresh updates tokens/expiry only; do not overwrite product health gates; fix tests that expect `connected` | `googleTokenService.js` | P0-7 |
| T0-8 | done | Bug | Conversion-action create `void idempotencyKey` on live path → retries can duplicate CAs; naive claim-before-mutate can strand forever if Google mutate fails; recover-by-name can attach user-created or colliding CAs | Claim with explicit states (`claiming` / `created` / failed→retryable); **`claiming` rows carry a lease/expiry and a reclaimer reprocesses stale claims** so a worker crash between claim and Google mutate cannot strand a CA forever; recover only via **deterministic Zuggernaut-owned naming** + stored artifact metadata (and/or resource name already on artifact); never treat arbitrary same-name Google CAs as reusable; stop voiding key; test live path | `googleAdsConversionActionClient.js`, `adsConversionActionManagementService.js` | P0-6 |
| T0-9 | done | Bug (workflow) | `scrape.workflow` uses `new Date()` when `startedAt` omitted → non-determinism | Require `startedAt` from API or fail closed; no `Date` in workflow code | `scrape.workflow.js`, scrape start API | P0-8 |

### Tier 0 — suggested fix order

1. T0-5 SameSite (if using split hosting) + CSRF on all mutating cookie routes / same-site proxy
2. T0-6 SSRF (redirect final-hop + connection-time IP pin + Playwright all-requests path + deterministic fallback)
3. **T0-1 One-setup / RUNNING atomic guard (+ defined `force` supersede + Temporal cancel-confirm-before-unlock + per-activity current-run guard + idempotent activities; hard-block `force` while `RUNNING` until T0-8) (+ FE)** — before Google mutation work
4. T0-4 MCC create token
5. T0-2 Stop auto-select (explicit select vs MCC create)
6. T0-3 GTM conversion ID/label + inventory scan + gated repair/backfill
7. T0-8 CA idempotency (claim states + lease/reclaimer + owned-name reconcile) — unblocks T0-1 `force`-while-`RUNNING` path
8. T0-7 Preserve connectionHealth
9. T0-9 Scrape `startedAt`

### Tier 0 notes

- **T0-3:** Semantic mismatch is confirmed; confirm exact Ads API snippet fields against the shipped API version when implementing. Repair/backfill is required if any live runs already published wrong tags; if zero production data, repair can be a no-op script still checked in — **but only after the read-only inventory scan confirms zero affected containers**. Live repair must never skip dry-run/approval/new version/rollback.
- **T0-1 alone is incomplete without Tier 1 UX** (already-complete / warned re-run), and vice versa. **`force` without archive/supersede of the setup-state lock is incomplete.** **`force` without confirmed Temporal terminate/close (or hard-block) while `RUNNING` is incomplete.** **A lock without lease/reclaim can strand a business on crash.** **Without the per-activity current-run guard, a superseded run's late activity can still mutate Google** — ship the guard with T0-1, and keep `force` hard-blocked while `RUNNING` until both the guard and T0-8 are done.
- **T0-6:** Disabling headless for untrusted URLs is only safe if downstream consumers handle the reduced scrape; the `headless_disabled_ssrf` status must be respected by structural verification and Ads readiness so a blocked headless scrape is not silently treated as a complete scrape. The proxy/interception option must cover **all browser network requests**, not only `goto` — a loaded page can issue XHR/fetch, load subresources/iframes, follow redirects, open downloads, or open websockets to private/metadata IPs.

---

## Tier 1 — Need soon after first customers

**Class:** Ops + support + honest UX. Some are real bugs (compensation); many are incomplete productization of Phase 11/12.

| ID | Status | Class | Issue | Proposed fix | Primary paths | Stability map |
|----|--------|-------|--------|--------------|---------------|---------------|
| T1-1 | done | Missing UX | Start Setup never checks "already SUCCEEDED" | Load latest run; if SUCCEEDED → "Setup complete — view report"; disable Start (or secondary re-run) | `StartSetupPage`, setup-run list/latest API | — |
| T1-2 | done | Missing UX | Re-run copy has no severity; new run = new create graph | Confirm modal: "May create another paused campaign / GTM tags"; SUCCEEDED requires force + warning | FE + optional `force` on `POST /setup-runs` | — |
| T1-3 | done | Lifecycle gap | BC PUT updates Mongo only; no post-success banner that Google won't sync | After SUCCEEDED: edit allowed + banner "Zuggernaut only; Ads/GTM unchanged"; do not auto-start setup | FE (report/BC edit); sync engine = Tier 2 | — |
| T1-4 | done | **Bug** | Compensation pause skips MCC auth; failed pause still sets `appliedAt` → never retries | `pauseAdsCampaign` → `resolveGoogleAdsCustomerAuth`; only set `appliedAt` on success / no-op | `googleAdsCampaignClient.js`, `setupRunCompensationService.js` | P1-1, P1-2 |
| T1-5 | done | Incomplete hygiene | Raw provider/`err.message` reaches API/UI | Map `errorCode` → safe user strings; keep raw in redacted logs only | Provisioning serialize, report, FE | P1-7 |
| T1-6 | done | Copy bug | Report says campaign "live" / "running"; V1 creates **PAUSED** | Replace with "created paused / ready to enable in Google Ads" | `setupRunReportService.js`, `SetupReportPage.tsx` | P1-8 |
| T1-7 | done | Incomplete | Stuck detection is operator-oriented; thin customer playbooks | Map errorCode/terminal → actionable steps + deep links; Temporal UI = advanced/ops | Report recovery + progress UI | Phase 12 partial |
| T1-8 | done | Weak heuristics | GTM thank-you `/thank` + noisy click/call triggers | User-confirmed thank-you URL(s); safer defaults; tighten form to submit/`form`; optional `tel:` only | `gtmTemplates/v1.js`, BC field, GTM setup | — |
| T1-9 | done | Wrong targeting shortcut | Placeholder service areas → **Mountain View** geo | Remove spoof; fail Ads readiness with "confirm a real city/region" | `businessContextAdsReadinessService.js` | P1-9 |
| T1-10 | done | Incomplete Phase 2 | Logger has no redact paths / request IDs; some clients log full `responseBody` | Pino `redact`; `x-request-id` middleware; stop logging full bodies | `logger.js`, `app.js`, Ads/GTM clients | P2-1 |

### Tier 1 — suggested fix order

1. T1-6 paused copy (quick win)
2. T1-4 compensation MCC pause (independent, high value)
3. T1-1 + T1-2 after T0-1
4. T1-9 Mountain View
5. T1-5 sanitized errors
6. T1-10 log redaction
7. T1-7 support playbook
8. T1-3 BC edit banner
9. T1-8 GTM triggers (can follow T0-3)

### Tier 1 notes

- **Depends on Tier 0:** T1-1/T1-2 need API SUCCEEDED/RUNNING guard (or they only paper over duplicates). Force re-run UX must use T0-1's supersede + Temporal-cancel-confirm semantics, and must surface the hard-block-while-`RUNNING` rule until T0-8 lands.
- **T1-4** is independent and should ship even if UX waits.

---

## Tier 2 — Product expansion (intentional V1 deferrals)

**Class:** Missing modules / scope cuts — **not** Phase 12–14 implementation bugs. Build only after Tier 0/1 trust.

| ID | Status | Class | Issue | Proposed fix (scoped V2 slice) | Primary paths |
|----|--------|-------|--------|--------------------------------|---------------|
| T2-1 | todo | Deferred module | No post-setup enable/pause/budget — setup ends at PAUSED create | API enable/pause using artifact + `resolveGoogleAdsCustomerAuth`; report "Enable campaign" CTA; fix T1-4 first | New management routes, Ads client, report UI |
| T2-2 | todo | Deferred module | Setup report ≠ Ads performance metrics | Read-only metrics GAQL for campaign artifact; `/performance` or report section | New reporting client + FE |
| T2-3 | todo | Schema yes, product no | No multi-business switcher (model allows multiple BCs) | List BCs; switcher; set `primaryBusinessId`; "Add business" onboarding | API + FE nav |
| T2-4 | todo | Never started | No team / invite / RBAC | Org + membership models; invite tokens; membership checks | Cross-cutting auth — large |
| T2-5 | todo | Never started | No billing / plans | Stripe + gate setup/OAuth on active plan | Billing module + FE |
| T2-6 | todo | Incomplete SaaS auth | Password-only; unused `googleSub`; no reset/verify | Pick one: password reset, email verify, or Google login (separate from Ads OAuth) | `auth.js`, User, email infra |
| T2-7 | todo | Scope boundary | GBP is read-only by design | Separate GBP write + consent module; do not mutate via audit service | New GBP write capability |
| T2-8 | todo | Deferred channel | Google-only providers | New provider enum + OAuth + setup module (greenfield) | New vertical |
| T2-9 | todo | Design limit | Idempotency is `setupRunId`-scoped — no cross-run reuse; naive business-level keys can reuse stale resources after BC/config change; hashing raw BC/scrape can churn and leak PII into keys/logs | Business-scoped keys versioned by a **canonical minimal intent fingerprint** (stable product fields only; exclude volatile scrape text and PII), or artifact lookup by business+type+version; clear recreate-vs-reuse rules; **after T0-1** | `idempotency.js`, campaign/GTM services |
| T2-10 | todo | Deferred ops UI | No admin console — ops via Temporal/Railway/Mongo | Admin authz + read-only tenant browser; later cancel/re-auth | New admin area |

### Tier 2 — suggested build order (after Tier 0/1)

1. T2-1 light Ads management (enable)
2. T2-6 auth hardening (when charging / real users)
3. T2-5 billing
4. T2-9 business-level idempotency (if re-setup still needed)
5. T2-2 performance
6. T2-3 multi-business → T2-4 teams
7. T2-10 admin → T2-7 GBP writes → T2-8 Meta

### Tier 2 notes

- Closest to "technical debt error": **T2-9** interacting with free re-runs — fix **T0-1 / T1-1/2** first.
- Do not build management/performance on top of broken auto-select, wrong conversion labels, or free double-setup.

---

## Tier 3 — Scale / platform / QA tooling

**Class:** Intentional MVP constraints. Fine for **1 worker** + static encryption key; become real risks when scaling or rotating secrets.

| ID | Status | Class | Issue | Proposed fix | Primary paths | Stability map |
|----|--------|-------|--------|--------------|---------------|---------------|
| T3-1 | deferred | Scale limit | In-process rate limits — N worker replicas ≈ N× Google QPS; a single global per-provider Redis key can bottleneck or unfairly starve tenants | Shared limiter (e.g. Redis) behind same `withProviderRateLimit` API with keys = **provider + quota scope + tenant/account** where Google quotas require it; until then keep **1 worker** | `providerRateLimit.js`, deploy | P1-13 |
| T3-2 | done | Ops gap | Single `TOKEN_ENCRYPTION_KEY`, no key id in ciphertext — rotation bricks tokens; partial re-encrypt can leave mixed rows | Versioned blobs (`enc:v1:…`); current + previous keys with **dual-read**; encrypt with current only; idempotent re-encrypt job with **progress/audit**; keep previous key until audit shows 100% current; rollback = leave previous key readable | `tokenEncryption.js`, connections, deploy docs, migration job | — |
| T3-3 | done | Deferred observability | Pino-only; no OTel / alerts | After T1-10: OTel on API+worker; alerts for worker down / setup fail / 429 rate | Observability bootstrap | Plan defer |
| T3-4 | done | Deferred UX | Advanced multi-account selection polish deferred | Fix **T0-2** first so selection isn't bypassed; then richer picker (name/ID/status, confirm) | FE + selection APIs | Plan defer |
| T3-5 | done | QA tooling gap | Phase 10 Track A deferred — no rerun/failure-injection | Dev-only inject via env flag **and** hard runtime assert that injection is disabled when `NODE_ENV=production` (both required); or clone BC without re-scrape | Activities/env gate, or setup API | Phase 10 Track A |

### Tier 3 — suggested order (when needed)

1. T0-2 then T3-4 (selection UX only matters if auto-pick is gone)
2. T3-1 only when scaling workers >1
3. T3-2 before first production key rotation
4. T3-5 for QA velocity
5. T3-3 when logs aren't enough to operate

---

## One-shot execution checklist

Use this as the master "finish all of this" checklist. Uncheck as you complete.

### Must ship (customer trust)

- [x] T0-5 SameSite / hosting (+ CSRF on all mutating cookie routes, or same-site proxy)
- [x] T0-6 SSRF (redirect final-hop + connection-time IP pin + Playwright all-requests path + deterministic fallback)
- [x] T0-1 One-setup / RUNNING **atomic** guard (+ defined `force` supersede + Temporal cancel-confirm-before-unlock + per-activity current-run guard + idempotent activities; hard-block `force` while `RUNNING` until T0-8)
- [x] T0-4 MCC create token
- [x] T0-2 No auto-select (explicit select vs MCC create)
- [x] T0-3 GTM conversion ID/label + inventory scan + gated repair/backfill
- [x] T0-8 CA idempotency (claim states + lease/reclaimer + owned-name reconcile)
- [x] T0-7 Preserve connectionHealth
- [x] T0-9 Scrape startedAt
- [x] T1-4 Compensation pause + appliedAt
- [x] T1-6 Paused-not-live copy
- [x] T1-1 Already-complete UX
- [x] T1-2 Warned re-run
- [x] T1-9 Kill Mountain View fallback
- [x] T1-5 Sanitized errors
- [x] T1-10 Log redaction + request IDs

### Should ship soon

- [x] T1-7 Support playbook
- [x] T1-3 BC edit banner
- [x] T1-8 GTM trigger quality

### Later product (Tier 2)

- [ ] T2-1 Enable campaign
- [ ] T2-6 Auth harden
- [ ] T2-5 Billing
- [ ] T2-9 Business-level idempotency (canonical minimal intent fingerprint)
- [ ] T2-2 Performance
- [ ] T2-3 Multi-business
- [ ] T2-4 Teams
- [ ] T2-10 Admin
- [ ] T2-7 GBP writes
- [ ] T2-8 Meta / other channels

### Scale when busy (Tier 3)

- [ ] T3-1 Distributed rate limits (scoped keys, not one global provider key) — **deferred** until `WORKER_REPLICAS > 1`
- [x] T3-2 Encryption key rotation (dual-read + audited migration)
- [x] T3-5 Failure injection / rerun QA (prod-impossible)
- [x] T3-3 OTel / alerts
- [x] T3-4 Stronger multi-account UX

---

## Explicitly out of early customer scope

- Full campaign optimizer / creative AI
- Auto-delete GTM on failure
- Perfect scrape quality for every site
- Multi-region / complex RBAC (beyond T2-4)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-29 | Initial doc from Tier 0–3 RCA passes + stability backlog crosswalk. |
| 2026-07-29 | Second-opinion review: atomic T0-1, reorder, T0-2 select-vs-create, T0-3 backfill, T0-5 CSRF, T0-6 redirect SSRF, T0-8 claim recovery, T2-9 versioned keys, T3-2 migration rollback, T3-5 prod hard-disable. |
| 2026-07-29 | Round 2: T0-1 force supersede, T0-5 app-wide CSRF, T0-6 DNS-rebinding pin, T0-3 gated repair, T0-8 owned-name recover, T2-9 minimal fingerprint, T3-1 scoped limiter keys. |
| 2026-07-29 | Round 3: T0-1 Temporal cancel-before-unlock on force; T0-6 Playwright/headless SSRF path. |
| 2026-08-02 | Round 4: T0-1 lock states + lease/reclaim + cancel-confirm + idempotent activities; T0-6 enforceable Playwright control; T0-8 stale-claim lease/reclaimer; T0-3 read-only inventory scan before no-op repair. |
| 2026-08-02 | Round 5: T0-1 per-activity current-run guard + hard-block `force` while `RUNNING` until T0-8; T0-6 deterministic `headless_disabled_ssrf` fallback so downstream readiness doesn't assume complete scrape. |
| 2026-08-02 | Round 6: T0-6 Playwright proxy/interception must cover all browser network requests (subresources/XHR/iframes/redirects/downloads/websockets), not only `goto`. |
