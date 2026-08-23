'use strict';

const mongoose = require('mongoose');
const { getCampaignPerformanceForBusiness } = require('../services/reports/adsPerformanceService');
const { fetchCampaignPerformanceMetrics } = require('../services/integrations/googleAdsReportClient');
const { encryptToken } = require('../lib/crypto/tokenEncryption');

describe('adsPerformanceService', () => {
  const User = mongoose.model('User');
  const BusinessContext = mongoose.model('BusinessContext');
  const IntegrationArtifact = mongoose.model('IntegrationArtifact');
  const IntegrationConnection = mongoose.model('IntegrationConnection');

  it('returns metrics for owned business with campaign artifact', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    const user = await User.create({ email: 'perf@example.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      businessName: 'Perf Biz',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });
    await IntegrationArtifact.create({
      businessId: bc.businessId,
      setupRunId: new mongoose.Types.ObjectId(),
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1234567890/campaigns/1',
    });

    const result = await getCampaignPerformanceForBusiness(
      user._id.toString(),
      bc.businessId.toString()
    );
    expect(result.metrics.impressions).toBe(1200);
    expect(result.metrics.clicks).toBe(84);
  });

  it('fetchCampaignPerformanceMetrics uses mock in test mode', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    const metrics = await fetchCampaignPerformanceMetrics({
      businessId: new mongoose.Types.ObjectId(),
      customerId: '1234567890',
      campaignResourceName: 'customers/1234567890/campaigns/1',
    });
    expect(metrics.source).toBe('google_ads_api_mock');
    expect(metrics.dateRangeDays).toBe(30);
  });
});
