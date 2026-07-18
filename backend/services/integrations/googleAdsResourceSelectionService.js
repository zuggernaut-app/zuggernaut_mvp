'use strict';

const mongoose = require('mongoose');
const {
  listAccessibleCustomers,
  describeAccessibleGoogleAdsCustomers,
  getEffectiveAdsDiscoveryReason,
} = require('./googleAdsAccountClient');
const { getFreshGoogleAccessToken } = require('./googleTokenService');
const { getOAuthConnectionStatus } = require('../capabilities/integrationConnectionService');
const { normalizeCustomerId } = require('./googleAdsApiConfig');
const {
  buildGoogleAdsCustomerOption,
  isGoogleAdsAccountSelectable,
  pickPreferredGoogleAdsCustomerOption,
  selectionTimestampFields,
} = require('./providerResourceSelection');
const { SELECTION_SOURCE } = require('../../constants/providerResourceSelection');
const { recordProviderResourceSelection } = require('./recordProviderResourceSelection');

const IntegrationConnection = mongoose.model('IntegrationConnection');

class GoogleAdsResourceSelectionError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'ADS_RESOURCE_SELECTION_ERROR') {
    super(message);
    this.name = 'GoogleAdsResourceSelectionError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function requireGoogleAdsOAuth(businessId) {
  const oauth = await getOAuthConnectionStatus(businessId, 'google_ads', { attemptRefresh: true });
  if (!oauth.oauthReady) {
    throw new GoogleAdsResourceSelectionError(
      'Connect Google Ads before listing selectable customers.',
      'ADS_NOT_CONNECTED'
    );
  }
  return oauth;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function listGoogleAdsResourceOptions(businessId) {
  await requireGoogleAdsOAuth(businessId);

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('connectionHealth providerIdentifiers')
    .lean();

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const customerIds = await listAccessibleCustomers(accessToken);

  if (customerIds.length === 0) {
    const reason = getEffectiveAdsDiscoveryReason({ discoveryReason: 'ADS_CUSTOMER_NOT_FOUND' });
    return {
      businessId: String(businessId),
      provider: 'google_ads',
      selectionRequired: false,
      reason,
      options: [],
      selected: null,
      accessibleCustomerIds: [],
    };
  }

  const described = await describeAccessibleGoogleAdsCustomers(accessToken, customerIds);
  const options = described.customers.map((metadata) =>
    buildGoogleAdsCustomerOption(metadata.customerId, metadata, {
      loginCustomerId: described.loginCustomerId,
    })
  );

  const selectedCustomerId = normalizeCustomerId(conn?.providerIdentifiers?.customerId);
  const selectedOption =
    selectedCustomerId != null
      ? options.find((option) => option.customerId === selectedCustomerId) ?? null
      : null;

  return {
    businessId: String(businessId),
    provider: 'google_ads',
    selectionRequired: !selectedOption,
    reason: selectedOption ? null : 'ADS_CUSTOMER_SELECTION_REQUIRED',
    options,
    suggestedCustomerId: pickPreferredGoogleAdsCustomerOption(options),
    selected: selectedOption
      ? {
          customerId: selectedOption.customerId,
          formattedCustomerId: selectedOption.formattedCustomerId,
          descriptiveName: selectedOption.descriptiveName,
          kind: selectedOption.kind,
          status: selectedOption.status,
          selectedAt: conn?.providerIdentifiers?.selectedAt ?? null,
        }
      : null,
    accessibleCustomerIds: customerIds,
    loginCustomerId: described.loginCustomerId,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ customerId: string }} selection
 */
async function saveGoogleAdsSelection(businessId, selection) {
  await requireGoogleAdsOAuth(businessId);

  const customerId = normalizeCustomerId(selection.customerId);
  if (!customerId) {
    throw new GoogleAdsResourceSelectionError('customerId is required.', 'ADS_SELECTION_INVALID');
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const accessibleCustomerIds = await listAccessibleCustomers(accessToken);

  if (!accessibleCustomerIds.includes(customerId)) {
    throw new GoogleAdsResourceSelectionError(
      'Selected customer is not accessible for this OAuth grant.',
      'ADS_SELECTION_NOT_ACCESSIBLE'
    );
  }

  const described = await describeAccessibleGoogleAdsCustomers(accessToken, [customerId]);
  const metadata = described.customers[0];
  const option = buildGoogleAdsCustomerOption(customerId, metadata, {
    loginCustomerId: described.loginCustomerId,
  });

  if (!isGoogleAdsAccountSelectable(option)) {
    throw new GoogleAdsResourceSelectionError(
      option.nonSelectableReason ?? 'Selected Google Ads account cannot be used.',
      'ADS_SELECTION_NOT_ALLOWED'
    );
  }

  const providerIdentifiers = {
    customerId,
    accessibleCustomerIds,
    ...(described.loginCustomerId
      ? {
          loginCustomerId: described.loginCustomerId,
          managerCustomerId: described.loginCustomerId,
        }
      : {}),
    selectedCustomerDescriptiveName: option.descriptiveName,
    selectedCustomerKind: option.kind,
    selectedCustomerStatus: option.status,
    selectionRequired: false,
    ...selectionTimestampFields(SELECTION_SOURCE.PRODUCT_SETUP),
  };

  await recordProviderResourceSelection(businessId, 'google_ads', providerIdentifiers, {
    source: SELECTION_SOURCE.PRODUCT_SETUP,
    summary: {
      customerId: option.customerId,
      formattedCustomerId: option.formattedCustomerId,
      descriptiveName: option.descriptiveName,
      kind: option.kind,
      status: option.status,
    },
  });

  return {
    businessId: String(businessId),
    provider: 'google_ads',
    selectionRequired: false,
    selected: {
      customerId: option.customerId,
      formattedCustomerId: option.formattedCustomerId,
      descriptiveName: option.descriptiveName,
      kind: option.kind,
      status: option.status,
      selectedAt: providerIdentifiers.selectedAt,
    },
    providerIdentifiers,
  };
}

module.exports = {
  GoogleAdsResourceSelectionError,
  listGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
};
