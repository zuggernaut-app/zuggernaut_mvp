# Ad Format Selection

## Context
When an AI agent needs to decide which ad format is most suitable for a given campaign objective, target audience, and platform.

## Core Concepts
*   **Search Ads (Text Ads):**
    *   Appear on Google SERPs for relevant keyword searches, labeled "Sponsored."
    *   Best for capturing high-intent users actively looking for solutions.
*   **Shopping Ads:**
    *   Display product images, prices, and merchant info on SERPs.
    *   Ideal for e-commerce product sales and discovery.
*   **App Campaigns (UAC - Universal App Campaigns):**
    *   Promote app installs and re-engagement across Google's network (Search, Play Store, YouTube, Display).
    *   Features an "Install" or "Open" Call to Action (CTA).
    *   Dedicated for app businesses.
*   **Display Ads (Banner Ads):**
    *   Visual ads across the Google Display Network (GDN) on various websites.
    *   Effective for broad reach, remarketing, and building brand awareness.
*   **Video Ads:**
    *   Ads on YouTube and within apps.
    *   Effective for storytelling, brand building, and engaging video content.
*   **Gmail Ads:**
    *   Ads appearing within Gmail inboxes, often used for promotions.
*   **Local Business Ads:**
    *   Appear on Google Maps for local searches (now integrated into other campaign types).
    *   Helps businesses attract nearby customers.
*   **Performance Max (PMax):**
    *   A highly automated, cross-channel campaign type using AI across all Google inventory (Search, Display, YouTube, Gmail, Maps, Discover).
    *   Focuses on driving conversions with less granular control.
    *   **Responsive Search Ads (RSAs) & Responsive Display Ads (RDAs):** Ad formats that use AI to test combinations of headlines, descriptions, and assets to find the best performing variations.

## Decision Rules
*   IF objective is "Online Sales" AND product is shippable THEN recommend Shopping Ads or Performance Max.
*   IF objective is "Leads" or "Calls" for a local business THEN recommend Search Campaigns with local targeting and extensions, or Performance Max.
*   IF objective is "Brand Awareness" THEN consider Display or Video Ads, or Performance Max.
*   IF promoting an app THEN use App Campaigns (UAC).
*   IF aiming for broad automation and conversions across channels THEN consider Performance Max.
*   IF aiming for greater control over keywords and ad relevance THEN consider Search Campaigns with well-structured ad groups.

## Related Files
*   `strategy/campaign_objectives.md`
*   `implementation/account_setup.md`
*   `tactics/bidding_strategies.md`
