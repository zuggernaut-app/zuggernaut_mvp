'use strict';

jest.mock('../services/integrations/googleAdsReportClient', () => ({
  fetchAdPolicyStatus: jest.fn(),
}));

jest.mock('../services/capabilities/setupReadyConnectionService', () => ({
  requireSetupReadyConnection: jest.fn(),
}));

jest.mock('../lib/notifications/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ delivered: true }),
}));

const mongoose = require('mongoose');
const { fetchAdPolicyStatus } = require('../services/integrations/googleAdsReportClient');
const { requireSetupReadyConnection } = require('../services/capabilities/setupReadyConnectionService');
const { sendEmail } = require('../lib/notifications/emailTransport');
const { pollAdsDisapprovalsActivity } = require('../activities/leadCampaignScheduleActivities');

describe('pollAdsDisapprovalsActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireSetupReadyConnection.mockResolvedValue({ customerId: '1234567890' });
    fetchAdPolicyStatus.mockResolvedValue({
      approvalStatus: 'DISAPPROVED',
      policyTopic: 'DESTINATION_NOT_WORKING',
    });
  });

  it('records operator notification without mutating campaign state (read-only poll)', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const LeadCampaignSet = mongoose.model('LeadCampaignSet');
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');

    const user = await User.create({ email: 'poll@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      businessName: 'Poll Biz',
      confirmedAt: new Date(),
    });

    await LeadCampaignSet.create({
      businessId: bc.businessId,
      recommended: {
        slot: 'recommended',
        action: 'forms',
        offer: 'Plumbing',
        places: ['Austin'],
        reservedAt: new Date(),
        reviewStatus: 'approved',
        desiredState: 'enabled',
      },
    });

    const SetupRun = mongoose.model('SetupRun');
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });

    const ad = await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_ad',
      externalId: 'customers/1234567890/adGroupAds/1',
      metadata: { slot: 'recommended' },
    });

    const pauseSpy = jest.spyOn(
      require('../services/integrations/googleAdsCampaignClient'),
      'pauseAdsCampaign'
    );

    const result = await pollAdsDisapprovalsActivity();

    expect(result.notifiedCount).toBe(1);
    expect(pauseSpy).not.toHaveBeenCalled();

    const set = await LeadCampaignSet.findOne({ businessId: bc.businessId }).lean();
    expect(set.recommended.reviewStatus).toBe('approved');
    expect(set.recommended.desiredState).toBe('enabled');
    expect(set.recommended.disapprovalDedupeKeys).toEqual([
      `${ad.externalId}:DESTINATION_NOT_WORKING`,
    ]);
    expect(set.operatorNotifications).toHaveLength(1);
    expect(set.operatorNotifications[0]).toMatchObject({
      type: 'ad_disapproved',
      slot: 'recommended',
      policyTopic: 'DESTINATION_NOT_WORKING',
    });

    pauseSpy.mockRestore();
  });

  it('sends operator email when OPERATOR_ALERT_EMAIL is set', async () => {
    process.env.OPERATOR_ALERT_EMAIL = 'ops@example.com';
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const LeadCampaignSet = mongoose.model('LeadCampaignSet');
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');

    const user = await User.create({ email: 'poll-email@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      businessName: 'Email Poll Biz',
      confirmedAt: new Date(),
    });

    await LeadCampaignSet.create({
      businessId: bc.businessId,
      recommended: {
        slot: 'recommended',
        action: 'forms',
        offer: 'Roofing',
        places: ['Denver'],
        reservedAt: new Date(),
        reviewStatus: 'approved',
      },
    });

    const SetupRun = mongoose.model('SetupRun');
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_ad',
      externalId: 'customers/1234567890/adGroupAds/2',
      metadata: { slot: 'recommended' },
    });

    await pollAdsDisapprovalsActivity();

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@example.com',
        subject: expect.stringContaining('disapproval'),
      })
    );

    delete process.env.OPERATOR_ALERT_EMAIL;
  });
});
