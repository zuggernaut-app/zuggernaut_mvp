'use strict';

const mongoose = require('mongoose');
const {
  getGoogleAdsLoginCustomerId,
  normalizeCustomerId,
} = require('../integrations/googleAdsApiConfig');
const {
  resolveMccLinkStatus,
  createCustomerClientLinkInvitation,
  acceptCustomerManagerLink,
} = require('../integrations/googleAdsAccountClient');
const {
  getFreshGoogleAccessToken,
  getMccGoogleAdsAccessToken,
} = require('../integrations/googleTokenService');

const IntegrationConnection = mongoose.model('IntegrationConnection');

class GoogleAdsMccLinkError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, code = 'ADS_MCC_LINK_ERROR', details = undefined) {
    super(message);
    this.name = 'GoogleAdsMccLinkError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/**
 * @param {string | number | null | undefined} managerCustomerId
 * @param {string | number | null | undefined} clientCustomerId
 * @returns {string | null}
 */
function buildMccLinkKey(managerCustomerId, clientCustomerId) {
  const managerId = normalizeCustomerId(managerCustomerId);
  const clientId = normalizeCustomerId(clientCustomerId);
  if (!managerId || !clientId) {
    return null;
  }
  return `${managerId}:${clientId}`;
}

/**
 * @param {object | null | undefined} mccLink
 * @param {string | number | null | undefined} customerId
 * @param {string | number | null | undefined} [managerCustomerId]
 */
function isMccLinkForSelectedCustomer(mccLink, customerId, managerCustomerId) {
  if (!mccLink || typeof mccLink !== 'object') {
    return false;
  }
  const clientId = normalizeCustomerId(customerId);
  const managerId = normalizeCustomerId(managerCustomerId ?? getGoogleAdsLoginCustomerId());
  if (!clientId || !managerId) {
    return false;
  }
  return (
    normalizeCustomerId(mccLink.clientCustomerId) === clientId &&
    normalizeCustomerId(mccLink.managerCustomerId) === managerId
  );
}

/**
 * @param {object | null | undefined} mccLink
 * @param {string | number | null | undefined} customerId
 * @param {string | number | null | undefined} [managerCustomerId]
 */
function isMccLinkActiveForSetup(mccLink, customerId, managerCustomerId) {
  if (!isMccLinkForSelectedCustomer(mccLink, customerId, managerCustomerId)) {
    return false;
  }
  if (mccLink.status === 'ACTIVE') {
    return true;
  }
  if (mccLink.provisioningSource === 'mcc_create') {
    const loginId = getGoogleAdsLoginCustomerId();
    return loginId != null && normalizeCustomerId(mccLink.managerCustomerId) === loginId;
  }
  return false;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function loadGoogleAdsConnectionForMccLink(businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers')
    .lean();

  const customerId = normalizeCustomerId(conn?.providerIdentifiers?.customerId);
  if (!customerId) {
    throw new GoogleAdsMccLinkError(
      'Select a Google Ads customer before checking MCC link status.',
      'ADS_CUSTOMER_NOT_SELECTED'
    );
  }

  return { conn, customerId };
}

/**
 * @param {object} resolved
 * @param {string} managerId
 * @param {string} clientId
 */
function mccLinkFromResolved(resolved, managerId, clientId) {
  const linkStatus = resolved.linkStatus ?? {};
  const status = resolved.linkReady
    ? 'ACTIVE'
    : linkStatus.status === 'PENDING' || resolved.pending
      ? 'PENDING'
      : 'REQUIRED';

  return {
    status,
    managerCustomerId: managerId,
    clientCustomerId: clientId,
    managerLinkId:
      linkStatus.managerLinkId != null
        ? String(linkStatus.managerLinkId)
        : resolved.pending?.managerLinkId != null
          ? String(resolved.pending.managerLinkId)
          : null,
    resourceName: linkStatus.resourceName ?? resolved.pending?.resourceName ?? null,
    checkedAt: new Date().toISOString(),
    ...(status === 'ACTIVE' ? { acceptedAt: new Date().toISOString() } : {}),
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} mccLink
 */
async function persistMccLink(businessId, mccLink) {
  await IntegrationConnection.findOneAndUpdate(
    { businessId, provider: 'google_ads' },
    { $set: { 'providerIdentifiers.mccLink': mccLink } }
  );
  return mccLink;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('pino').Logger} [logger]
 */
async function refreshMccLinkStatus(businessId, logger) {
  const { customerId } = await loadGoogleAdsConnectionForMccLink(businessId);
  const managerId = getGoogleAdsLoginCustomerId({ required: true });
  const customerAccessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const managerAccessToken = await getMccGoogleAdsAccessToken();
  const resolved = await resolveMccLinkStatus(
    managerAccessToken,
    managerId,
    customerId,
    customerAccessToken
  );
  const mccLink = mccLinkFromResolved(resolved, managerId, customerId);

  await persistMccLink(businessId, mccLink);

  logger?.info?.(
    {
      businessId: String(businessId),
      provider: 'google_ads',
      stepName: 'mcc_link_refresh',
      status: mccLink.status,
    },
    'mcc link status refreshed'
  );

  return { mccLink, resolved };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('pino').Logger} [logger]
 */
async function ensureMccLinkInvited(businessId, logger) {
  const { conn, customerId } = await loadGoogleAdsConnectionForMccLink(businessId);
  const managerId = getGoogleAdsLoginCustomerId({ required: true });
  const existing = conn?.providerIdentifiers?.mccLink ?? null;

  if (isMccLinkActiveForSetup(existing, customerId, managerId)) {
    return { outcome: 'active', mccLink: existing };
  }

  const customerAccessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const managerAccessToken = await getMccGoogleAdsAccessToken();
  const resolved = await resolveMccLinkStatus(
    managerAccessToken,
    managerId,
    customerId,
    customerAccessToken
  );

  if (resolved.linkReady) {
    const mccLink = {
      ...mccLinkFromResolved(resolved, managerId, customerId),
      status: 'ACTIVE',
    };
    await persistMccLink(businessId, mccLink);
    return { outcome: 'active', mccLink };
  }

  if (resolved.pending || resolved.linkStatus?.status === 'PENDING') {
    const mccLink = {
      ...mccLinkFromResolved(resolved, managerId, customerId),
      status: 'PENDING',
      invitedAt: existing?.invitedAt ?? new Date().toISOString(),
    };
    await persistMccLink(businessId, mccLink);
    return { outcome: 'pending', mccLink };
  }

  const mccAccessToken = await getMccGoogleAdsAccessToken();
  const invite = await createCustomerClientLinkInvitation(mccAccessToken, managerId, customerId);
  const mccLink = {
    status: 'PENDING',
    managerCustomerId: managerId,
    clientCustomerId: customerId,
    managerLinkId: invite.managerLinkId != null ? String(invite.managerLinkId) : null,
    resourceName: invite.resourceName ?? null,
    invitedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
  await persistMccLink(businessId, mccLink);

  logger?.info?.(
    {
      businessId: String(businessId),
      provider: 'google_ads',
      stepName: 'mcc_link_invite',
      customerId,
      managerCustomerId: managerId,
    },
    'mcc link invite sent'
  );

  return { outcome: 'pending', mccLink, invite };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ refresh?: boolean }} [opts]
 */
async function assertMccLinkReadyForSetup(businessId, opts = {}) {
  const { conn, customerId } = await loadGoogleAdsConnectionForMccLink(businessId);
  const managerId = getGoogleAdsLoginCustomerId({ required: true });
  let mccLink = conn?.providerIdentifiers?.mccLink ?? null;

  if (!isMccLinkActiveForSetup(mccLink, customerId, managerId) && opts.refresh !== false) {
    const refreshed = await refreshMccLinkStatus(businessId);
    mccLink = refreshed.mccLink;
  }

  if (!isMccLinkActiveForSetup(mccLink, customerId, managerId)) {
    const code =
      mccLink?.status === 'PENDING' ? 'ADS_MCC_LINK_PENDING' : 'ADS_MCC_LINK_REQUIRED';
    const message =
      mccLink?.status === 'PENDING'
        ? 'Google Ads MCC link invitation is pending acceptance.'
        : 'Google Ads account must be linked to Zuggernaut MCC before setup can start.';
    throw new GoogleAdsMccLinkError(message, code, { mccLink });
  }

  return mccLink;
}

/**
 * Best-effort accept via customer OAuth. Not required for MVP user flow.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('pino').Logger} [logger]
 */
async function acceptMccLinkIfAllowed(businessId, logger) {
  const { conn, customerId } = await loadGoogleAdsConnectionForMccLink(businessId);
  const managerId = getGoogleAdsLoginCustomerId({ required: true });
  const mccLink = conn?.providerIdentifiers?.mccLink ?? null;

  if (!mccLink?.managerLinkId) {
    throw new GoogleAdsMccLinkError('No pending MCC link to accept.', 'ADS_MCC_LINK_NOT_PENDING');
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  try {
    await acceptCustomerManagerLink(
      accessToken,
      customerId,
      managerId,
      mccLink.managerLinkId
    );
    const refreshed = await refreshMccLinkStatus(businessId, logger);
    return {
      outcome: refreshed.mccLink.status === 'ACTIVE' ? 'active' : 'pending',
      mccLink: refreshed.mccLink,
    };
  } catch (err) {
    return {
      outcome: 'manual_accept_required',
      mccLink,
      message: err instanceof Error ? err.message : 'Accept failed',
    };
  }
}

/**
 * @param {string | number} customerId
 * @param {string | number} managerCustomerId
 */
function buildNewlyCreatedUnderMccLink(customerId, managerCustomerId) {
  const managerId = normalizeCustomerId(managerCustomerId);
  const loginId = getGoogleAdsLoginCustomerId();
  if (!loginId || managerId !== loginId) {
    return null;
  }
  const clientId = normalizeCustomerId(customerId);
  if (!clientId) {
    return null;
  }
  return {
    status: 'ACTIVE',
    managerCustomerId: managerId,
    clientCustomerId: clientId,
    provisioningSource: 'mcc_create',
    checkedAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
  };
}

/**
 * Preserve mccLink across customer selection when ids still match; otherwise omit.
 *
 * @param {object | null | undefined} priorMccLink
 * @param {string} customerId
 * @param {string | null | undefined} managerCustomerId
 */
function preserveMccLinkForSelection(priorMccLink, customerId, managerCustomerId) {
  if (!isMccLinkForSelectedCustomer(priorMccLink, customerId, managerCustomerId)) {
    return undefined;
  }
  return priorMccLink;
}

function getMccLinkManualAcceptInstructions() {
  return {
    summary: 'Accept the manager link invitation in Google Ads.',
    steps: [
      'Sign in to Google Ads with an account that has Admin or Standard access to this Ads account.',
      'Open Tools & Settings, then Manager accounts.',
      'Find the pending invitation from Zuggernaut and click Accept.',
      'Return here and click Verify link.',
    ],
    googleAdsUrl: 'https://ads.google.com/aw/accountaccess/managers',
  };
}

module.exports = {
  GoogleAdsMccLinkError,
  buildMccLinkKey,
  isMccLinkForSelectedCustomer,
  isMccLinkActiveForSetup,
  persistMccLink,
  refreshMccLinkStatus,
  ensureMccLinkInvited,
  assertMccLinkReadyForSetup,
  acceptMccLinkIfAllowed,
  buildNewlyCreatedUnderMccLink,
  preserveMccLinkForSelection,
  getMccLinkManualAcceptInstructions,
};
