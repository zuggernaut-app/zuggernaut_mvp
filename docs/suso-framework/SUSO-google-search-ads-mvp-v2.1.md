# SUSO — Google Search Ads MVP (v2.1)

## Step 0: Business Foundation

Identical to full spec — all gates active, all versioning rules apply.

See [SUSO-framework-full-v2.1.md](./SUSO-framework-full-v2.1.md) for complete Step 0, Feasibility Gates, and Layer 3 definitions.

---

## Behavioral Segment (Search-Specific Definition)

Limited to:
- In-market audiences (observation only)
- RLSA (Remarketing Lists for Search Ads)
- Keyword-derived intent

No custom site-behavior audience building on Search alone.

---

## Feasibility Gates (Search-Specific Narrowing)

| Gate | Search MVP Rule |
|------|----------------|
| **Retargeting (RLSA)** | Requires existing tag/pixel + Google's RLSA minimum audience volume. Default: "Not enough data yet" until verified. |
| **Loyalty** | Requires **branded/navigational search volume only**. "Repeat-purchase intent" alone does NOT pass this gate on Search — it's valid for other channels (email, CRM) but insufficient for a branded Search campaign. Default: "Not enough data yet" until verified. |
| **Budget viability** | Same trim logic as full spec. |

---

## Layer 1 Matrix (Search-Viable, Gate-Filtered)

| Objective | Consideration | Conversion |
|-----------|--------------|------------|
| **Leadgen** | Mid-commitment content (guide, case study) | Direct capture (quote/consult request) |
| **Sales** (Low/Low only) | Comparison-driven (generic/category-based) | Hard CTA, transactional |
| **Retargeting** (if feasibility gate passes) | Reminder + objection handling | Last-chance push |
| **Loyalty** (if branded-demand gate passes) | — | Repeat/upsell |

**Excluded from Search MVP:**
- Awareness stage (not executable on Search alone; folds into Consideration-stage messaging)
- Standalone Branding objective

---

## Layer 2: Keyword Intent Type

| Stage | Intent Type |
|-------|-------------|
| Consideration | Commercial Investigation |
| Conversion | Transactional |
| Loyalty | Navigational (branded search) |

---

## Layer 3: Guardrails

### Constraints/Compliance
- All full-spec compliance rules apply
- **Comparison-copy default:** "Comparison-driven" ad copy (Sales/Consideration cell) uses generic/category-based comparison unless legal review has explicitly cleared named-competitor usage for this account

### Budget Tier
- Volume filter + viability floor
- Full deterministic trim order applied (Conversion > Consideration; Leadgen > Sales > Retargeting > Loyalty; Geographic > Demographic > Behavioral)

---

## What's NOT in Search MVP (Parked)

| Item | Activates When |
|------|---------------|
| Awareness stage | Display/YouTube added |
| Psychographic segmentation | Display/YouTube added |
| Branding objective | Display/YouTube added |
| Custom behavioral audiences | Display/social channels added |
| Named-competitor keywords/copy | Legal review clears per-account |
