'use strict';

const { planLeadCampaignSlots } = require('../services/capabilities/leadCampaignPlanner');

describe('leadCampaignPlanner', () => {
  it('plans recommended form campaign when calls are not allowed', () => {
    const plan = planLeadCampaignSlots({
      businessCountry: 'DE',
      services: ['Plumbing'],
      serviceAreas: ['Berlin'],
      howBuyersContact: 'phone',
    });
    expect(plan.recommended?.action).toBe('forms');
    expect(plan.alternative).toBeNull();
  });

  it('plans alternative with other action when calls are allowed', () => {
    const plan = planLeadCampaignSlots({
      businessCountry: 'US',
      services: ['Plumbing'],
      serviceAreas: ['Austin, TX'],
      howBuyersContact: 'phone calls',
    });
    expect(plan.recommended?.action).toBe('calls');
    expect(plan.alternative?.action).toBe('forms');
  });
});
