# SUSO Framework — Full Spec (v2.1)

## Step 0 — Business Foundation (Internal, One-Time, Versioned Hard Gate)

Not customer-facing marketing content — internal business context that gates everything downstream.

### Inputs

| Input | Description |
|-------|-------------|
| **UVP** | Core differentiation, in the business's own words |
| **Competitor Landscape** | 2–3 named competitors + differentiation angle (feeds UVP; usage restricted — see Layer 3 Guardrails) |
| **Business Scope** | Local-service / Regional / National-online |
| **Order Value × Technical Complexity** | 2×2 matrix that determines objective eligibility and CTA style |

### Value × Complexity Matrix

| Combination | Go-to-Market | Objective Gate | CTA Style |
|-------------|-------------|----------------|-----------|
| Low Value / Low Complexity | Marketing-led | Sales/Conversion allowed | "Buy now" |
| Low Value / High Complexity | Marketing-led, education-heavy | Leadgen only, no Sales | Informational → soft CTA |
| High Value / Low Complexity | Marketing + light-touch sales | Leadgen, fast-follow | "Book demo / call now" |
| High Value / High Complexity | Sales-led (ads start conversations, never close) | Leadgen only | "Talk to us" — never a hard close |

### Business Scope → Segment Availability

| Business Scope | Geographic Segment | Behavioral Segment |
|---------------|-------------------|-------------------|
| Local-service | Mandatory | Optional |
| Regional | Mandatory (broader) | Optional |
| National/online | Optional | Prioritized |

### Versioning Rule

Step 0 carries a **version + timestamp**. Any edit to UVP, Competitor Landscape, Scope, or Value×Complexity increments the version and flags all downstream campaigns generated under the prior version for review — no silent auto-regeneration.

---

## Feasibility Gates (System-Derived, Checked Before Offering a Cell)

Same enforcement mechanism as Step 0's business-stated gates, but derived from account/market data instead of business input.

| Gate | Requirement | Default When Data Unavailable |
|------|-------------|-------------------------------|
| **Retargeting eligibility** | Existing tag/pixel + minimum audience volume (channel-defined minimum, e.g. Google's RLSA floor) | "Not enough data yet" — objective not offered |
| **Loyalty/branded eligibility** | Verifiable branded search volume OR repeat-purchase intent (channel-specific narrowing applies) | "Not enough data yet" — objective not offered |
| **Budget viability floor** | Budget Tier must support all qualifying cells; if not, trim lowest-priority cells rather than fragmenting spend | Trim per deterministic priority order |

**System states for gates:**
- **"Gate passed"** — checked, qualifies, objective offered
- **"Gate failed"** — checked, doesn't qualify, objective not offered
- **"Not enough data yet"** — can't verify (data not connected), objective not offered, user shown different status so they know to connect data or wait

### Budget Trim Priority (Deterministic, No Ties)

1. **Stage:** Conversion > Consideration > Awareness
2. **Within same stage, Objective:** Leadgen > Sales > Retargeting > Loyalty
3. **Within same stage + objective, Segment:** Geographic (if mandatory per Business Scope) > Demographic > Behavioral

Lowest-priority cells are trimmed first when budget cannot support all qualifying cells.

---

## Layer 1 — SUSO Core Matrix

**Objective × Segment × Stage**, filtered by Step 0 gates + Feasibility Gates.

### Objectives
- Leadgen
- Branding (parked — see v-next)
- Retargeting
- Sales-Conversion (gated by Value×Complexity)
- Loyalty-Retention

### Segments
- Demographic
- Geographic (availability gated by Business Scope)
- Behavioral (availability gated by Business Scope; definition is channel-specific)
- Psychographic (parked — inactive until Display/YouTube/branding channels are added)

### Stages (Google's funnel)
Awareness → Consideration → Conversion

---

## Layer 2 — Execution Bridge

### Keyword Intent Type Mapping

| Stage | Intent Type |
|-------|-------------|
| Awareness | Informational |
| Consideration | Commercial Investigation |
| Conversion | Transactional |
| Loyalty | Navigational (branded search) |

---

## Layer 3 — Guardrails

### Constraints/Compliance
- Regulated claims, brand voice, banned words
- **Competitor-usage rule:** Competitor names may inform UVP/strategy internally but must not appear in ad copy or as keywords without legal review (default-off)
- **Comparison-copy rule:** "Comparison-driven" messaging defaults to generic/category-based comparison ("vs. traditional providers," "unlike typical solutions") unless legal review has explicitly cleared named-competitor usage for the account

### Budget Tier
- Governs campaign/ad-group volume (not ad content)
- Enforces viability floor via Feasibility Gates
- Trim order applied when budget insufficient (see Budget Trim Priority above)

---

## Parked for v-next

| Item | Reactivation Trigger |
|------|---------------------|
| Psychographic segmentation | Display/YouTube/social channels added |
| Branding as standalone objective | Display/YouTube/social channels added |
| Display/YouTube/social channels | Channel expansion decision |
| Branding×Conversion cells | Branding objective activated |
| Sales×Awareness cells | Multi-channel funnel capability added |
