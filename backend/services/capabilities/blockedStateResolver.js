'use strict';

/**
 * Maps internal failure codes to customer-facing blocked states.
 * Base states for lead-campaign MVP; extended in later tasks.
 *
 * @param {string} code
 * @returns {{ owner: 'customer' | 'operator', customerMessage: 'waiting_on_you' | 'working_on_it', title: string }}
 */
function resolveBlockedState(code) {
  const normalized = String(code ?? '').trim();

  const customerOwned = new Set([
    'subscription_required',
    'subscription_lapsed',
    'budget_not_set',
    'budget_adjustment_needed',
    'google_ads_not_connected',
    'mcc_link_pending',
  ]);

  if (customerOwned.has(normalized)) {
    return {
      owner: 'customer',
      customerMessage: 'waiting_on_you',
      title: normalized,
    };
  }

  return {
    owner: 'operator',
    customerMessage: 'working_on_it',
    title: normalized || 'unknown_blocked_state',
  };
}

module.exports = {
  resolveBlockedState,
};
