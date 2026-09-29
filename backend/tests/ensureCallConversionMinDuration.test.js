'use strict';

const mongoose = require('mongoose');
const { ensureCallConversionMinDuration } = require('../services/capabilities/adsConversionActionManagementService');

describe('ensureCallConversionMinDuration', () => {
  it('records a failure when conversion duration updates are disabled', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');
    const SetupRun = mongoose.model('SetupRun');

    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'false';

    const user = await User.create({ email: 'duration-fail@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Duration Co',
      websiteUrl: 'https://duration.example',
      services: ['Plumbing'],
      serviceAreas: ['Austin'],
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    const { failures } = await ensureCallConversionMinDuration({
      businessId: bc.businessId,
      customerId: '1234567890',
      setupRunId: run._id,
      catalog: [
        {
          externalId: '1001',
          resourceName: 'customers/1234567890/conversionActions/1001',
          phoneCallDurationSeconds: null,
        },
      ],
      requiredSlots: [
        {
          logicalCategory: 'call',
          externalId: '1001',
          resourceName: 'customers/1234567890/conversionActions/1001',
        },
      ],
      logger: null,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].externalId).toBe('1001');
    expect(failures[0].errorCode).toBe('GOOGLE_ADS_CONVERSION_CREATION_DISABLED');
  });
});
