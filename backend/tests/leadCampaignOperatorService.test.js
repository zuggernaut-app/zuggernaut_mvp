'use strict';

const mongoose = require('mongoose');
const {
  applyOperatorFactCheck,
  recordSetupCallConfirmation,
  LeadCampaignOperatorError,
} = require('../services/capabilities/leadCampaignOperatorService');

describe('leadCampaignOperatorService', () => {
  const User = mongoose.model('User');
  const BusinessContext = mongoose.model('BusinessContext');

  async function seedBusiness(overrides = {}) {
    const user = await User.create({ email: `operator-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      businessName: 'Acme Co',
      services: ['Plumbing'],
      serviceAreas: ['Austin, TX'],
      whoBuysToday: 'Homeowners',
      orderValueHint: '500',
      howBuyersContact: 'Phone',
      contactMethods: {
        phones: ['+15551234567'],
        emails: ['ops@acme.example'],
      },
      businessCountry: 'US',
      intakeFieldSources: overrides.intakeFieldSources ?? {},
      ...overrides.fields,
    });
    return { user, bc };
  }

  it('rejects setup call before five answers are operator-reviewed', async () => {
    const { bc } = await seedBusiness();
    await expect(
      recordSetupCallConfirmation(bc.businessId, {
        phone: '+1 555 123 4567',
        email: 'ops@acme.example',
        orderValueHint: '500',
      })
    ).rejects.toBeInstanceOf(LeadCampaignOperatorError);
  });

  it('records setup call after five answers are operator-reviewed', async () => {
    const { bc } = await seedBusiness();
    await applyOperatorFactCheck(bc.businessId, {
      services: ['Plumbing'],
      whoBuysToday: 'Homeowners',
      serviceAreas: ['Austin, TX'],
      orderValueHint: '500',
      howBuyersContact: 'Phone',
    });

    const result = await recordSetupCallConfirmation(bc.businessId, {
      orderValueHint: '500',
    });

    expect(result.setupCallConfirmedAt).toBeTruthy();
  });
});
