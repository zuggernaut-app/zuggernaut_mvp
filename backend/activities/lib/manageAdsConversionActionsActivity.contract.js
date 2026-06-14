'use strict';

/**
 * Activity Contract: manageAdsConversionActionsActivity
 *
 * INPUT:
 *   { setupRunId: string, businessId: string }
 *
 * OUTPUT (one of):
 *
 *   { outcome: 'ok', slotsResolved: number, created: number, reused: number }
 *     → All required conversion action slots are filled. Workflow proceeds
 *       to fetchAdsConversionCatalogActivity (which now validates rather than discovers).
 *
 *   { outcome: 'missing_goal_data', message: string }
 *     → BusinessContext.goals is null/empty. Cannot derive strategy.
 *       Workflow transitions to SETUP_NEEDS_MANUAL_REVIEW.
 *
 *   { outcome: 'creation_failed', message: string, errorCode: string }
 *     → Google Ads API returned an error during conversion action creation.
 *       Workflow transitions to FAILED.
 *
 *   { outcome: 'manual_review', message: string }
 *     → Unresolvable conflict (e.g., existing action with same name but wrong config).
 *       Workflow transitions to SETUP_NEEDS_MANUAL_REVIEW.
 *
 * WORKFLOW POSITION:
 *   After: ensureProviderReady('google_ads') succeeds
 *   Before: fetchAdsConversionCatalogActivity
 *
 * IDEMPOTENCY:
 *   Uses businessId + setupRunId + slot as idempotency scope.
 *   Re-running after partial creation must not duplicate actions.
 */

module.exports = {
  ACTIVITY_NAME: 'manageAdsConversionActionsActivity',
  STEP_NAME: 'manage_ads_conversion_actions',
};
