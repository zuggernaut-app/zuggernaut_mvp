# Zuggernaut Product Strategy Canon

## 1. Vision

To empower small businesses by acting as an expert intermediary, automating the setup and initial management of essential digital marketing tools. Zuggernaut will translate business goals into effective Google Ads campaigns, proactively identifying, creating, and managing the necessary Google Ads infrastructure (including conversion actions), enabling businesses to establish a strong online presence and drive growth without the need for expensive agencies.

## 2. Target Audience

Small businesses that:
- Lack dedicated marketing resources or expertise.
- Find current marketing tools complex or time-consuming.
- Cannot afford traditional marketing agencies.
- Are looking for a cost-effective entry into digital marketing.

## 3. V1 Scope

Focus on **automating the initial setup** of:
- **Google Business Profile (GBP):** Read-only audit of existing information.
- **Google Tag Manager (GTM):** Automated setup of conversion tracking tags and triggers.
- **Google Ads:** Automated initial campaign creation based on business-provided goals and audience segments, gated by required tracking setup and verification checks. This includes intelligently deriving and, where necessary, programmatically creating required Google Ads conversion actions. The campaign creation process will strictly enforce the definition of most impactful parameters for core campaign, ad group, ad creative, targeting, and conversion goal linking.

## 4. V2 Scope

- Automated GBP modifications.
- Automated GTM snippet installation for major CMS platforms (WordPress, Shopify, Wix, Squarespace).
- Deeper GA4 integration and enhanced analytics reporting.
- SEO strategy and implementation guidance.

## 5. Differentiation

- **"0 to 1" Marketing Automation:** Taking businesses from no marketing setup to a functional, automated system.
- **Simplicity & Affordability:** Making sophisticated marketing tools accessible and easy to use for SMBs.
- **Integrated Solution:** A single platform for GBP, GTM, and Google Ads setup.
- **Intelligent Derivation & Recommendation:** Zuggernaut intelligently processes business data to recommend and implement effective campaign strategies and conversion actions.
- **Focus on Measurable Results:** Emphasis on conversion tracking and campaign performance.

## 6. Non-Goals

- Replacing full-service marketing agencies for ongoing, advanced strategy and execution.
- Providing a website builder or CMS in V1.
- Automating every single step of the marketing setup (e.g., GTM snippet installation is manual in V1).
- Behavioral GTM verification as a hard gate in V1.
- Using GA4, SEO, or website changes as required V1 dependencies.
- Ongoing Google Ads optimization after the first campaign launch.

## 7. Core Assumptions

- Users can and will manually install the GTM snippet based on provided instructions.
- Users will grant necessary API permissions for GBP, GTM, and Google Ads.
- Businesses have an existing website that can be scraped for basic information.
- Businesses can define basic goals (calls, forms) and audience segments.
- Google Ads creation should not start if we do not have enough information about the business, **specifically the parameters identified as high-impact for campaign, ad group, ad creative, targeting, and conversion goal linking.**
- Google Ads should not launch until the required tracking setup and structural verification checks pass or a controlled manual review path is triggered.
- Zuggernaut can and will programmatically create necessary Google Ads conversion actions if they don't exist or don't meet the business goals, using sensible defaults or prompting the user for necessary details.

---