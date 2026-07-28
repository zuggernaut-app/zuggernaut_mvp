'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../../lib/observability/logger');
const { getFreshGoogleAccessToken, getMccGoogleAdsAccessToken } = require('./googleTokenService');
const { getGoogleAdsLoginCustomerId, normalizeCustomerId } = require('./googleAdsApiConfig');

const IntegrationConnection = mongoose.model('IntegrationConnection');
const googleAdsCustomerAuthLogger = createLogger({ name: 'googleAdsCustomerAuth' });

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string | number | null | undefined} customerIdInput
 * @returns {Promise<{
 *   accessToken: string,
 *   headerOpts: { loginCustomerId?: string },
 *   useMccAuth: boolean,
 *   tokenSource: 'mcc_admin' | 'customer_oauth',
 * }>}
 */
async function resolveGoogleAdsCustomerAuth(businessId, customerIdInput) {
  const customerId = normalizeCustomerId(customerIdInput);
  const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers.mccLink')
    .lean();
  const loginCustomerId = getGoogleAdsLoginCustomerId();
  const mccLink = conn?.providerIdentifiers?.mccLink ?? null;
  const { isMccLinkActiveForSetup } = require('../capabilities/googleAdsMccLinkService');
  const useMccAuth =
    loginCustomerId != null && isMccLinkActiveForSetup(mccLink, customerId, loginCustomerId);

  const tokenSource = useMccAuth ? 'mcc_admin' : 'customer_oauth';
  const accessToken = useMccAuth
    ? await getMccGoogleAdsAccessToken()
    : await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const headerOpts = useMccAuth ? { loginCustomerId } : {};

  googleAdsCustomerAuthLogger.debug(
    {
      businessId: String(businessId),
      customerId,
      useMccAuth,
      tokenSource,
      loginCustomerIdSent: useMccAuth ? loginCustomerId : null,
    },
    'google ads customer auth resolved'
  );

  return { accessToken, headerOpts, useMccAuth, tokenSource };
}

module.exports = {
  resolveGoogleAdsCustomerAuth,
};
