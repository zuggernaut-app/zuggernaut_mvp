'use strict';

const { validateIntakeBody } = require('../lib/intakeValidation');

describe('validateIntakeBody', () => {
  const valid = {
    businessName: 'Acme',
    phone: '+1 555 123 4567',
    email: 'owner@acme.example',
    primaryOffer: 'Plumbing',
    whoBuysToday: 'Homeowners',
    serviceArea: 'Austin, TX',
    orderValueHint: '$500',
    howBuyersContact: 'Phone and form',
    websiteUrl: 'https://acme.example',
  };

  it('accepts a complete intake payload', () => {
    const res = validateIntakeBody(valid);
    expect(res.ok).toBe(true);
    expect(res.value.businessName).toBe('Acme');
    expect(res.value.intakeFieldSources.businessName).toBe('customer');
    expect(res.value.intakeFieldSources.services).toBe('customer');
  });

  it('accepts only required phone, email, and website', () => {
    const res = validateIntakeBody({
      phone: valid.phone,
      email: valid.email,
      websiteUrl: valid.websiteUrl,
    });
    expect(res.ok).toBe(true);
    expect(res.value.intakeFieldSources.phone).toBe('customer');
    expect(res.value.intakeFieldSources.email).toBe('customer');
    expect(res.value.intakeFieldSources.websiteUrl).toBe('customer');
    expect(res.value.intakeFieldSources.services).toBeUndefined();
    expect(res.value.intakeFieldSources.whoBuysToday).toBeUndefined();
    expect(res.value.intakeFieldSources.serviceAreas).toBeUndefined();
    expect(res.value.intakeFieldSources.howBuyersContact).toBeUndefined();
  });

  it('rejects missing website', () => {
    const res = validateIntakeBody({ ...valid, websiteUrl: '' });
    expect(res.ok).toBe(false);
  });

  it('rejects invalid phone', () => {
    const res = validateIntakeBody({ ...valid, phone: '12' });
    expect(res.ok).toBe(false);
  });
});
