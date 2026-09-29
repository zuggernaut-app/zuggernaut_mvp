# Security CI — Implementation Plan

**Purpose:** Add cheap CI hygiene (secrets + dependency scanning) so we don't ship leaked credentials or known-bad packages.

**Scope:** Gitleaks, npm audit, Dependabot, required checks. Does **not** include Semgrep, Nuclei, Trivy, or Aikido (Phase 1+).

**Source material:**
- `.github/workflows/ci.yml`
- `CONTRIBUTING.md`
- `scripts/check-before-push.js`
- Architect recommendations (gitleaks, npm audit, OSV deferred)

**Parallel with:** `SUSO_AND_CLOUD_SOFTLAUNCH_PLAN.md` — no dependency on SUSO or Hardening Tier 3.

---

## How to use this doc

1. Work tasks in order (9 must exist before 10).
2. One Composer task = one numbered item below.
3. Mark **Status** as you go: `todo` | `in_progress` | `done` | `accepted` | `deferred`.
4. Do not make security jobs required (task 10) until policy doc (task 9) exists.

---

## Numbered tasks

| ID | Status | Task |
|----|--------|------|
| 1 | todo | Add `.gitleaks.toml` allowlist — new repo-root file; **allowlist the specific known fingerprint/regex in `backend/tests/temporalConnectionOptions.test.js`, not the whole file** (avoid hiding future real secrets in test dirs); **add `[allowlist]` path entries for `node_modules`, `frontend/node_modules`, `backend/node_modules` so `gitleaks dir` doesn't scan dependencies (slow + noisy)**. |
| 2 | todo | Add gitleaks CI job — `.github/workflows/ci.yml` (or new `security.yml`); fail on findings; run on PR + push; **install sequence: `actions/setup-go@v5` with `go-version: '1.22'` → `go install github.com/gitleaks/gitleaks/v8/cmd/gitleaks@v8.21.2` → `echo "$(go env GOPATH)/bin" >> $GITHUB_PATH`**; then **current-tree scan using `gitleaks dir --source . --config .gitleaks.toml` (scans working tree, not history)** — full history is task 3 (`workflow_dispatch`). |
| 3 | todo | One-time full-history gitleaks scan — local or `workflow_dispatch` job; **install sequence: `actions/setup-go@v5` with `go-version: '1.22'` → `go install github.com/gitleaks/gitleaks/v8/cmd/gitleaks@v8.21.2` → `echo "$(go env GOPATH)/bin" >> $GITHUB_PATH`**; then **run `gitleaks git --source . --config .gitleaks.toml`**; **log only finding IDs + status, never secret values**; document result. |
| 4 | todo | Rotate any real secrets found in step 3 — out-of-band (Railway/Atlas/Google Console); then allowlist specific fingerprint or purge history. |
| 5 | todo | Add `npm audit` job for backend — `.github/workflows/ci.yml`; `npm audit --omit=dev --audit-level=critical` in `backend/`. |
| 6 | todo | Add `npm audit` job for frontend — same workflow; `frontend/`. |
| 7 | todo | Add root convenience script — `package.json` (`check:security`) calling both audits; no provider code. |
| 8 | todo | Add Dependabot config — new `.github/dependabot.yml` (backend + frontend npm ecosystems; weekly; PRs only, no auto-merge for V1). |
| 9 | todo | Document policy + exception process — new `dev-tools/docs/SECURITY_TOOLING.md` (what fails, allowlist process, accepted-CVE exceptions with expiry); **must define expiry-based exception entry + approval before task 10**. |
| 10 | todo | Make security jobs required checks — GitHub branch protection / rulesets on default branch; **explicitly update required-checks list to include gitleaks + both audit jobs**; enforce only after task 9 exists. |

---

## Hard dependencies

- 2 depends on 1.
- 4 depends on 3.
- **9 must exist before 10.**
- 10 depends on 2, 5, 6 being green.
- No dependency on SUSO track or Hardening Tier 3.

---

## Decided policies

| Policy | Decision |
|--------|----------|
| **Allowlist governance** | PR review + expiry/reason for every exception; only deterministic test fixtures are permanent (no open-ended allowlists). |
| **Fail policy** | `npm audit --omit=dev --audit-level=critical` only for Phase 0; add `high` after one clean week. |
| **OSV-Scanner** | Deferred; add only if `npm audit` misses transitive issues you care about. |
| **Gitleaks scope** | Current-tree (`gitleaks dir`) in CI; full history (`gitleaks git`) as `workflow_dispatch`. |

---

## High-risk steps

| Task | Risk | Mitigation |
|------|------|------------|
| 4 | If history contains a real secret, rotation is irreversible ops | Coordinate before purging history; rotate Railway/Atlas/Google secrets first |
| 10 | Can block deploys if a new CVE lands | Ensure exception path (task 9) exists before enforcing |

**No idempotency / provider-mutation exposure** — this track is CI/config only; no Google/Ads/GTM creates.

---

## Suggested execution order

1. **Allowlist first:** 1
2. **CI gates:** 2 → 5 → 6 → 7
3. **History scan (parallel/manual):** 3 → 4 if needed
4. **Ongoing deps:** 8
5. **Policy then enforce:** 9 → 10

---

## Example CI snippet (task 2)

```yaml
gitleaks:
  name: Gitleaks (secrets)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version: '1.22'
    - name: Install gitleaks
      run: |
        go install github.com/gitleaks/gitleaks/v8/cmd/gitleaks@v8.21.2
        echo "$(go env GOPATH)/bin" >> $GITHUB_PATH
    - name: Scan working tree
      run: gitleaks dir --source . --config .gitleaks.toml
```
