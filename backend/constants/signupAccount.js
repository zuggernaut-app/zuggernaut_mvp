'use strict';

/** Currencies offered at customer signup (Google Ads account preference). */
const SIGNUP_ACCOUNT_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD']);

/**
 * @param {string} code
 * @returns {boolean}
 */
function isSignupAccountCurrency(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  return SIGNUP_ACCOUNT_CURRENCIES.includes(normalized);
}

/**
 * @param {string} code
 * @returns {string | null}
 */
function normalizeSignupAccountCurrency(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  return isSignupAccountCurrency(normalized) ? normalized : null;
}

/**
 * @param {string} code — ISO 3166-1 alpha-2
 * @returns {boolean}
 */
function isIsoCountryCode(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized);
}

module.exports = {
  SIGNUP_ACCOUNT_CURRENCIES,
  isSignupAccountCurrency,
  normalizeSignupAccountCurrency,
  isIsoCountryCode,
};
