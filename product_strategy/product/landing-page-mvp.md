# Landing page MVP — launch copy

**Status:** Launch copy for zuggernaut.com static marketing site.
**Date:** 2026-09-29
**CTA target:** `%APP_URL%/register` (production `APP_URL` TBD — deferred)
**Pricing at launch:** Omitted (no dollar amounts on page).
**Legal at launch:** Omitted (no privacy/terms pages).

---

## Hero

**Headline:** Google Ads for small businesses. Built for you, free until you press start.

**Subhead:** Tell us about your business. We build your lead campaign from your website, a real person checks it, and nothing spends until you choose to start.

**Primary CTA label:** Get started free

**Risk-reversal line (under CTA):** No card needed · Nothing spends until you start · Pause anytime

**Example card label:** Example campaign preview (not a real customer)

---

## Pain strip (three bullets)

1. **Agencies cost too much** — Typical management runs hundreds to thousands a month, often with minimum ad spends above what a small business can afford.
2. **Doing it yourself is a time sink** — Google Ads has a steep learning curve; one wrong setting can burn budget fast.
3. **AI-only tools skip the human check** — Fully automated setups can miss what makes your business different.

---

## How it works (three steps)

1. **Register and share your business** — Website, contact details, and a few facts about what you do.
2. **We build your campaign** — Your site is read once; a recommended paused lead campaign is created. A person reviews it before you see it.
3. **You press start when ready** — Set your daily budget (from $5/day), subscribe, and your ads go live. Pause anytime.

---

## What you get

- One recommended lead campaign (calls or form — not both), plus at most one alternative
- Human review of every campaign before you can start it
- A dashboard to start, pause, and adjust budget within plan limits
- Visible status when something is blocked — you always know whether it's waiting on you or on us
- Ad spend paid directly to Google; you control when money moves

---

## Comparison table

Use only these sourced figures in the page table.

| Row | Agency | DIY (in-house) | Zuggernaut |
| --- | --- | --- | --- |
| Typical management cost | $500–$2,500/mo or 10–20% of spend, with $500–$1,500 minimums common | Your time (no fee, high learning cost) | Pay subscription only when you start a campaign |
| Human review before ads spend | Varies; not guaranteed on low-fee tiers | No | Every campaign reviewed before start |
| Built for ~$300–$1,500/mo ad spend | Many agencies set $2,500+/mo minimum ad budgets | Possible, but easy to misconfigure | Daily budgets from $5/day per campaign |
| Campaign built before you pay | Rare; setup fees common | N/A | Yes — build and review are free until you press start |

**Sources**

- Agency fee ranges: [WordStream — Google Ads management pricing](https://www.wordstream.com/blog/ws/2016/02/29/google-adwords-management-pricing)
- Agency minimum spend norms: [WebFX — how much does Google Ads cost](https://www.webfx.com/blog/ppc/how-much-does-google-ads-cost/)
- Value proposition clarity (hero design): [NN/g — How Long Do Users Stay on Web Pages?](https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/) (~10 seconds to decide)
- Lead cost context (FAQ only — do not promise volumes): [LocaliQ — Search advertising benchmarks](https://localiq.com/blog/search-advertising-benchmarks/) — US search CPL ~$70 avg., home services ~$91 (2025)

---

## FAQ

**Do I need a Google Ads account?**
You can connect one during setup, or we help create one as part of onboarding. An operator handles account setup details.

**What does "free until you press start" mean?**
We build and review your campaign at no charge. You only need an active subscription when you choose to turn ads on. Nothing spends while campaigns are paused.

**How much will leads cost?**
It depends on your industry, location, and competition. Industry benchmarks for US search campaigns average around $70 per lead, with home services higher — but your results will vary. We do not guarantee a number of leads.

**Can I pause anytime?**
Yes. Stopping a campaign means pause — your ads stop spending immediately.

**Who reviews my campaign?**
A real person on our team checks every campaign before you can start it. We do not launch ads without that review.

**What types of campaigns do you run?**
Lead campaigns only — designed to get phone calls or form submissions, not both on the same campaign.

---

## Final CTA

**Headline:** Ready to see your campaign before you spend a dollar?

**Button:** Get started free

---

## Claims table (evidence)

| Claim | Allowed on page | Evidence |
| --- | --- | --- |
| Nothing spends until you press start | Yes | `lead-campaign-mvp.md` invariant; enable gated at `leadCampaignManagementService.js:196`, `integrations.js:578,631` |
| No subscription needed to build a campaign | Yes | `lead-campaign-mvp.md` invariant; `setupRuns.js` imports `assertActivePlan` but never calls it |
| Every campaign human-reviewed before start | Yes | `approveCampaignSlot` in `leadCampaignOperatorService.js:149`; admin route `admin/index.js:167` |
| Daily budget from $5/day | Yes | `FLOOR_DAILY_MICROS.USD` = 5M micros in `leadCampaign.js:12-15` |
| Pause anytime | Yes | `lead-campaign-mvp.md` — stop means pause |
| Specific lead volumes or CPL guarantees | **No** | LocaliQ benchmarks are directional only |
| "2-minute setup" or "no Google account needed" | **No** | Current intake requires full business form + Google connection |
| Pricing dollar amounts | **No** | Deferred at launch |
| Customer testimonials or "Google Partner" badge | **No** | Not available at launch |

---

## Visual

- **Wordmark:** Text only — "Zuggernaut"
- **Accent:** `rgb(13, 148, 136)` / `#0d9488`
- **Style:** Light background, dark text, mobile-first, sticky mobile CTA
