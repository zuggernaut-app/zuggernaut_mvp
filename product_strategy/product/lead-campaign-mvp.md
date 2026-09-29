# Lead campaign MVP

**Status:** Spec. Build against this document.
**Date:** 2026-09-28

A customer submits a short business form and may connect Google accounts. An operator checks the facts, the AI reads the website once and fills the remaining answers, and a call confirms them. The AI then creates a recommended paused lead campaign and at most one alternative. No subscription is needed for that. An operator reviews every campaign. The customer then starts, pauses, budgets, and pays for those campaigns from one dashboard.

---

## How to use this document

1. Treat every rule in **Invariants**, **Process**, and **Blocked states** as required behavior.
2. **Out of scope** is not a later interpretation. Do not build those items in this MVP.
3. **Build deltas** say what the current product does and what this spec changes. Keep current behavior where this document does not change it.
4. When a rule and an older plan disagree, this document wins for this MVP.

---

## Invariants

These hold for the whole MVP. Later sections spell out when each one applies.

- Phone, email, and website are required on the customer form and are format-checked. Every other answer may be blank or wrong, and the form still submits.
- The website is scraped once, only after the operator has checked the form, and only during onboarding. The full scrape is stored before the AI answers. The site is not scraped again after onboarding.
- A customer answer that is already present is kept. The AI fills only what is missing and marks its own answers as guesses. It does not overwrite a customer fact.
- The operator corrects a fact only when the website shows it plainly, or an answer only when it is visibly wrong. The operator does not invent an offer, a buyer, a place, or a price, and does not add keywords, proof lines, or a budget.
- Name, website, phone, and email stay the customer's values unless the site clearly corrects them.
- Business setup is complete at the end of the confirmation call. No ads, keywords, or campaigns exist before that call.
- Creating campaigns does not require a subscription, from the customer or from the operator.
- Nothing spends until the customer starts a campaign.
- Every campaign is a lead campaign. Each campaign uses exactly one action: calls or a form. Never both.
- At most two campaigns per business: one recommended, and at most one alternative. A campaign is not deleted. Stop means pause.
- Call campaigns are offered only when the recorded business country is on the forwarding-number list. That list is config, not hard-coded. Otherwise the business gets form campaigns only. The business country decides this, not the account currency.
- Google Ads account currency is US dollars or rupees. The operator chooses it when creating an account. It cannot be changed after the account is created. An existing account in any other currency cannot have campaigns created.
- Verified tracking is not required to create a campaign. It is required before that campaign can start. A skipped tracking check counts as not passed.
- Every campaign needs operator approval before the customer can start it. The operator approves or sends it back. The operator never edits the ad.
- Sending a campaign back takes a reason code and may include a note. After two regenerations, a campaign that is still not approved goes to internal review.
- A campaign can start only when the customer who owns the business has an active subscription, tracking has passed for that campaign's action, an operator has approved it, and the customer has set a budget within the limits. The first start confirms the budget once.
- Every failure is a visible blocked state with an owner. The customer sees either "Waiting on you" or "We're working on it."
- Every created campaign is logged.

---

## In scope

- Customer form for business facts. Phone, email, and website are required.
- Optional customer connection of Google Ads, Google Tag Manager, and Google Business Profile.
- One-time business setup: the operator checks the form, the AI scrapes the website and answers a fixed list, the operator checks those answers, and the customer confirms on a call.
- Account setup, done by the operator:
  - completing any connection the customer did not finish
  - choosing the account currency when creating a Google Ads account
  - recording the business country
  - installing the Tag Manager snippet on the website
- AI creation of a recommended paused lead campaign and at most one alternative. No subscription required.
- A tracking gate before any campaign can start.
- Operator review of every campaign before it can start.
- A visible blocked state, with an owner, for every failure.
- Customer dashboard: campaign list, start, pause, performance, recommended budget, budget setting within limits, and the existing subscription billing.

## Out of scope

- Sale campaigns and purchase tracking. Every MVP campaign is a lead campaign.
- A campaign that uses both calls and a form.
- Google Ads account currencies other than US dollars and rupees.
- Verifying a form tag installed without Tag Manager.
- Dropdowns on the customer form.
- Asking the customer for keywords, headlines, a budget tier, an objective, competitors, or a unique value proposition.
- The operator writing, choosing, or editing ads, or doing research. Reviewing a campaign and sending it back is allowed.
- Secondary research from search, social, or review sites.
- Showing the strategy matrix.
- Creating a campaign before the confirmation call.
- Spending before the customer starts a campaign.
- More than two campaigns per business.
- Deleting a campaign. Stop means pause.
- Editing ad text, keywords, or locations from the dashboard. That comes later.
- Charts, requesting a new campaign, and more than one business per customer.
- Re-scraping the website after onboarding.

---

## Process

### 1. Customer submits

The customer enters, as short text:

- business name
- website
- phone
- email
- what they sell
- who buys today
- where those buyers are
- a typical order value
- how a buyer contacts them

Phone, email, and website must be present, and the form checks their format. Every other answer may be blank or wrong, and the form still submits.

On the same submission the customer may connect Google Ads, Google Tag Manager, and Google Business Profile. A connection the customer makes counts.

**Done when:** the submission is stored, required fields have passed format checks, and any connection the customer completed is recorded as theirs.

### 2. Operator checks the form

The operator compares the submitted facts with the website. They correct a fact only when the website shows it plainly. They do not invent an offer, a buyer, a place, or a price. Name, website, phone, and email stay the customer's values unless the site clearly corrects them.

**Done when:** the checked facts are stored, and each correction is one the website shows plainly.

### 3. AI reads the website once

This runs only after step 2, and only once during onboarding. The AI stores the full scrape, then answers only these five questions:

1. What they sell, as a list of the products or services it found.
2. Who actually buys today, as its best guess.
3. Where those buyers are, as its best guess.
4. What a typical order is worth, as a range. The AI answers this only when the customer left it blank.
5. How a buyer contacts them today.

A customer answer that is already present is kept. The AI fills what is missing and marks its own answers as guesses. It does not overwrite a customer fact.

The scrape covers same-origin pages up to the configured page cap (homepage plus additional pages). It does not stop at the website address on the form.

**Done when:** the full scrape is stored, the five answers are stored, customer facts are unchanged, and AI-filled answers are marked as guesses. This step does not run again.

### 4. Operator checks the five answers

The operator reviews the list, the buyer, the places, the order value, and the contact method before any call. They correct an answer only when it is visibly wrong. They do not add keywords, proof lines, or a budget.

**Done when:** the five answers are checked, and no keywords, proof lines, or budget have been added.

### 5. Account setup

If the customer already connected an account, the operator leaves it. The operator connects only a missing account.

**Google Ads.** Before campaigns can be created, Google Ads must be connected, a customer account selected, and that account linked to the Zuggernaut MCC. A missing or pending MCC link blocks only campaign creation.

**Account currency.** When the operator creates a new Google Ads account, they choose its currency: US dollars or rupees. The currency cannot be changed after the account is created. An existing account in any other currency cannot have campaigns created.

**Business country.** The operator records the business's country. That country, not the account currency, decides whether call campaigns are offered.

**Tag Manager.** It is optional for creating campaigns, and required before a form campaign can start. The operator connects it if the customer didn't, and installs the Tag Manager snippet on the business website. The tracking check verifies the form tag only through that connected Tag Manager container.

**Business Profile.** It stays optional.

**Done when:** missing connections are filled by the operator, a created Google Ads account has an operator-chosen currency of US dollars or rupees, and the business country is recorded.

### 6. Confirmation call

The operator reads back the checked facts and the answers from step 3, and confirms the phone and email.

For order value, the operator always asks the customer for the number, even when the customer already gave one. They do not read back a range. That number replaces any earlier value.

For every other answer, the customer says yes or corrects a fact. The operator does not design the campaign on the call. Facts the customer confirms on the call are stored with operator as the source.

Business setup is complete at the end of this call. No ads, keywords, or campaigns exist yet.

**Done when:** phone and email are confirmed, order value is a customer-confirmed number, every other answer is confirmed or corrected by the customer, and business setup is marked complete with no campaigns created.

### 7. AI creates the campaigns

Creating campaigns does not require a subscription, from the customer or from the operator. From the confirmed answers and the stored scrape, the AI creates a recommended lead campaign and at most one alternative, all paused. Each campaign uses exactly one action: calls or a form.

**The recommended campaign:**

- uses one offer from the list
- uses the confirmed places as its only locations
- takes its action from how buyers contact the business

The confirmed order value only shapes its recommended budget.

**The alternative is one of these:**

- the same offer with the other action, when both calls and a form are real
- another real offer from the list

If neither exists, only the recommended campaign is created. Do not create sale, trimmed, gated, retargeting, or branded campaigns.

Call campaigns are offered only when the recorded business country is on the forwarding-number list. Otherwise that business gets form campaigns only. The forwarding-number list is a config value. Both the United States and India are on Google's list. Importing call conversions is limited in India, but that limit does not apply, because the call conversion counts calls from ads.

**For each campaign the AI does four things:**

1. finds the page that matches the offer
2. takes one proof line that is actually on the site
3. builds the search phrases from what that buyer would type
4. writes headlines and descriptions from the offer, the proof line, and the action, not from a template of the business name and the place

Call campaigns get a call asset. Each campaign has one ad.

**A campaign is created only when all of these hold:**

- there is a real place
- a Google Ads account is selected, linked to the MCC, and in US dollars or rupees
- there is a conversion action for that campaign's call or form

The business also needs a name, a valid website, at least one thing it sells, a real place it serves, and a goal of calls or forms. The AI sets that goal to each campaign's one action. The product supports calls, forms, and both today, but the MVP never uses both.

Verified tracking is not needed to create a campaign. Nothing spends in this step, and every campaign is logged.

If the AI still finds no real offer or place after the call, no campaign is created. The business stays blocked with the operator until they get the missing fact from the customer.

**Done when:** zero, one, or two paused lead campaigns exist, each with one action and one ad, or the business is blocked because there is no real offer or place.

### 8. Tracking gate

A campaign can be created without verified tracking, but it cannot start until tracking passes for its action.

| Campaign action | Tracking that must pass |
| --- | --- |
| Calls | A call asset, and a call conversion that counts a call lasting at least 60 seconds |
| Form | A verified form tag through the connected Tag Manager container |

Until tracking passes, the campaign is blocked. The owner comes from the existing tracking check. Skipped counts as not passed.

| Tracking check result | Owner | Customer sees |
| --- | --- | --- |
| Skipped, because Tag Manager is not connected | Operator | We're working on it |
| Snippet pending | Operator | We're working on it |
| Needs a tracking fix | Operator | We're working on it |
| Needs manual review | Operator | We're working on it |

The existing tracking check works only through a connected Tag Manager container. It returns one of five results: skipped, snippet pending, needs a tracking fix, needs manual review, or pass. A form tag installed directly on the site, without Tag Manager, is not verified. Those customers still need the Tag Manager snippet.

**Done when:** a form campaign cannot start unless the check is pass, and a call campaign cannot start unless it has a call asset and a call conversion with a minimum length of 60 seconds.

### 9. Operator review

Every campaign needs an operator review before the customer can start it. The operator checks that the offer, place, action, page, and proof line are sensible, then approves the campaign or sends it back to the AI.

When sending a campaign back, the operator gives a reason code and may add a note. They never edit the ad. After two regenerations, a campaign that is still not approved goes to internal review. Retiring from internal review pauses the campaign and keeps the slot reserved; it is not deleted. Until approval, the customer sees the campaign as waiting on review.

**Done when:** each campaign is approved, sent back with a reason code, or in internal review after two regenerations. The customer never sees an unapproved campaign as startable.

### 10. Customer dashboard

After step 7 the customer uses only this screen.

**What the customer sees**

- The recommended campaign is listed first, followed by the alternative if there is one. Each stays paused until the customer starts it.
- Each campaign shows its recommended budget and lets the customer set a budget.
- Each campaign shows amount spent, the number of calls or form leads, and cost per result. A result is the same call or form the ad asks for.

**Starting and pausing**

The customer can start or pause a campaign. Stop means pause, and a campaign cannot be deleted. A campaign can start only when all of these hold:

- The customer has an active subscription. The subscription checked is the customer's, not the operator's.
- Tracking has passed for that campaign's action.
- An operator has approved the campaign.
- The customer has set a budget within the limits.

The first time a campaign starts, the customer confirms the budget once.

Start and pause work for both the recommended campaign and the alternative.

**Budget limits**

Budgets are daily and in the Google Ads account's currency.

The floor is per campaign. It is half the starter ceiling, so a starter customer can always run both campaigns at the minimum.

| Currency | Floor per campaign (daily) |
| --- | --- |
| US dollars | $5 |
| Rupees | ₹400 |

The ceiling is one limit per plan, covering both campaigns combined.

| Plan | US dollars (daily) | Rupees (daily) |
| --- | --- | --- |
| Starter | $10 | ₹800 |
| Middle | $25 | ₹2,000 |
| Top | $50 | ₹4,000 |

Rupee ceilings are the dollar ceilings converted at about ₹85 to $1 and rounded down. Adding a currency later means adding one row to each table. The product already has the dollar ceilings of 10, 25, and 50. This MVP adds the rupee ceilings and the per-campaign floor. Rupee budgets use this fixed conversion, not a live rate.

Before subscribing, the customer sees the starter ceiling. Nothing starts until they subscribe.

If the recommended budget is above the ceiling, the dashboard shows the ceiling as the recommendation and explains why.

**Billing**

Billing is the existing subscription. The customer subscribes on this dashboard when they are ready to start. If the subscription lapses, running campaigns keep running through the existing seven-day grace period and are paused when it ends.

**Disapproved ads**

If Google disapproves a running campaign's ad, the campaign stays enabled, but it serves nothing and spends nothing. The operator sends it back to the AI with a reason code. The regenerated ad goes through operator review again, and the two-regeneration limit applies. After two regenerations it goes to internal review. The customer sees "We're working on it."

**Done when:** the customer can list, budget, start, and pause both campaigns from this screen, and a campaign stays paused unless every start condition above is true.

---

## Blocked states

Every failure appears as a visible blocked state with an owner. The customer sees either "Waiting on you" or "We're working on it," never a silent wait.

| What went wrong | Who owns it | Customer sees |
| --- | --- | --- |
| Site is thin, blocks scraping, or needs JavaScript to render | Operator | We're working on it |
| No real offer or place found | Operator, who gets the missing fact from the customer | We're working on it |
| Answers blank and the site cannot fill them | Operator, on the call | We're working on it |
| Google Ads not connected or no account selected | Customer, with operator help if they can't | Waiting on you |
| MCC link still pending | Customer | Waiting on you |
| Account currency not supported | Operator | We're working on it |
| AI creation failed, or a Google Ads error | Operator | We're working on it |
| Tracking not verified | Operator, as shown in step 8 | We're working on it |
| Campaign waiting on operator review | Operator | We're working on it |
| Campaign sent back to the AI | Operator. After two regenerations it goes to internal review. | We're working on it |
| Budget not set | Customer | Waiting on you |
| No active subscription | Customer | Waiting on you |
| Ad disapproved by Google after start | Operator | We're working on it |

---

## Gates

Two different gates. Do not collapse them.

**Create a paused campaign** (no subscription, no spend):

- Business setup is complete (confirmation call finished).
- Business has a name, a valid website, at least one thing it sells, and a real place it serves.
- The campaign's goal is calls or forms, never both.
- A Google Ads account is selected, linked to the MCC, and in US dollars or rupees.
- A conversion action exists for that campaign's call or form.
- There are fewer than two campaigns for the business.
- The campaign is one of: the recommended campaign, or the single allowed alternative.

**Start a campaign** (can spend):

- Create already succeeded and the campaign is still paused or is being resumed.
- The customer who owns the business has an active subscription.
- Tracking has passed for that campaign's action (step 8).
- An operator has approved the campaign (step 9).
- The customer has set a daily budget at or above the per-campaign floor, and the combined budgets stay within the plan ceiling.
- The first start includes a one-time budget confirmation.

Pause does not delete the campaign. A lapsed subscription uses the existing seven-day grace period, then pauses running campaigns.

---

## Build deltas

Onboarding and account setup:

- The website becomes required on the form. Today the form accepts a blank website.
- The scrape has to cover same-origin pages up to the configured page cap. Today it reads only the website address on the form. Step 3 needs the AI to read the site and store the whole result before it answers the five questions.
- The operator chooses the account currency. Accounts the product creates today use a default currency from config, which is US dollars. Step 5 needs the operator to choose US dollars or rupees when creating the account.
- The business country is used for call campaigns. The forwarding-number list is a config value, not hard-coded. Step 7 checks the operator-recorded business country against it.

Campaign creation:

- Creating a campaign keeps its current requirements: a name, a valid website, at least one thing it sells, a real place it serves, and a goal of calls or forms. In step 7 the AI sets that goal to each campaign's one action. The MVP never uses both.
- The campaign builder changes. Today it makes one paused campaign from the business name, the offer, and the place. Step 7 replaces that with the confirmed answers, the scrape, a recommended campaign, and at most one alternative.
- Creating paused campaigns no longer needs a subscription. Today, starting a setup run requires an active subscription, checked against whoever presses start.

Tracking and starting a campaign:

- The call conversion needs a minimum length of 60 seconds. The product already creates a "calls from ads" conversion and a form conversion before launch, but no minimum call length is set today.
- Starting a campaign has to check tracking. Enabling a campaign does not look at that check today. Step 8 requires a pass before a form campaign can start, and skipped counts as not passed.
- Starting a campaign checks more than the subscription. Enabling a campaign already requires an active subscription. Step 10 keeps that check and applies it to the customer who owns the business. It also adds operator approval, a budget within limits, and a one-time budget confirmation.
- Enable and pause have to work for two campaigns. Today they work for a single campaign.
- Budget amounts follow the account currency. Step 10 adds the rupee ceilings and the per-campaign floor beside the existing dollar ceilings.

---

## Known limits

- The website is scraped once during onboarding. Its data goes stale if the business changes its site later.
- A form tag installed directly on the site, without Tag Manager, is not verified. Those customers still need the Tag Manager snippet.
- Only US dollar and rupee Google Ads accounts are supported.
- Rupee budgets use a fixed conversion of about ₹85 to $1, not a live rate.
