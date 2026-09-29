'use strict';

const mongoose = require('mongoose');
const { fetchCampaignPerformanceMetrics } = require('../integrations/googleAdsReportClient');
const { requireSetupReadyConnection } = require('../capabilities/setupReadyConnectionService');
const { GoogleAdsApiError } = require('../integrations/googleAdsApiConfig');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../lib/auth/membershipCheck');
const { isPlatformAdminUser } = require('../../api/v1/lib/platformAdminBusinessAccess');
const { LEAD_CAMPAIGN_SLOTS } = require('../../constants/leadCampaign');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');

class AdsPerformanceError extends Error {
  constructor(message, code = 'ADS_PERFORMANCE_ERROR') {
    super(message);
    this.name = 'AdsPerformanceError';
    this.code = code;
  }
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function getCampaignPerformanceForBusiness(userId, businessIdRaw) {
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    throw new AdsPerformanceError('businessId is required and must be a valid ObjectId', 'validation_error');
  }

  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  const isAdmin = await isPlatformAdminUser(userId);
  if (!isAdmin) {
    try {
      await assertBusinessMembershipOrOwnership(userId, businessIdRaw);
    } catch (err) {
    if (err instanceof MembershipCheckError) {
      throw new AdsPerformanceError(
        err.code === 'forbidden'
          ? err.message
          : 'Business context not found for this user',
        err.code === 'forbidden' ? 'forbidden' : 'not_found'
      );
    }
      throw err;
    }
  }

  const { customerId } = await requireSetupReadyConnection(businessId, 'google_ads', AdsPerformanceError);
  const slots = {};

  for (const slot of LEAD_CAMPAIGN_SLOTS) {
    const campaignArtifact = await IntegrationArtifact.findOne({
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      'metadata.slot': slot,
    })
      .sort({ updatedAt: -1 })
      .lean();

    if (!campaignArtifact?.externalId) {
      slots[slot] = null;
      continue;
    }

    try {
      const metrics = await fetchCampaignPerformanceMetrics({
        businessId,
        customerId,
        campaignResourceName: campaignArtifact.externalId,
      });
      slots[slot] = {
        campaignResourceName: campaignArtifact.externalId,
        metrics: {
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          costMicros: metrics.costMicros,
          conversions: metrics.conversions,
          dateRangeDays: metrics.dateRangeDays,
        },
        source: metrics.source,
      };
    } catch (err) {
      if (err instanceof GoogleAdsApiError) {
        throw new AdsPerformanceError(err.message, err.code);
      }
      throw err;
    }
  }

  if (!slots.recommended && !slots.alternative) {
    throw new AdsPerformanceError('No campaign artifact found for this business.', 'not_found');
  }

  return {
    businessId: businessId.toString(),
    slots,
  };
}

function mapPerformanceRouteError(err, res) {
  if (err instanceof AdsPerformanceError) {
    const status =
      err.code === 'not_found'
        ? 404
        : err.code === 'forbidden'
          ? 403
          : err.code === 'validation_error'
            ? 400
            : 400;
    return res.status(status).json({ error: err.code, message: err.message });
  }
  return null;
}

module.exports = {
  AdsPerformanceError,
  getCampaignPerformanceForBusiness,
  mapPerformanceRouteError,
};
