'use strict';

const {
  buildMccLinkKey,
  isMccLinkForSelectedCustomer,
  isMccLinkActiveForSetup,
  preserveMccLinkForSelection,
  buildNewlyCreatedUnderMccLink,
} = require('../services/capabilities/googleAdsMccLinkService');

describe('googleAdsMccLinkService helpers', () => {
  const managerId = '3462198684';
  const clientId = '1234567890';

  beforeEach(() => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = managerId;
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_OAUTH_MOCK = 'true';
  });

  it('buildMccLinkKey normalizes ids', () => {
    expect(buildMccLinkKey('346-219-8684', '123-456-7890')).toBe(`${managerId}:${clientId}`);
  });

  it('isMccLinkForSelectedCustomer matches manager and client', () => {
    const mccLink = {
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: clientId,
    };
    expect(isMccLinkForSelectedCustomer(mccLink, clientId, managerId)).toBe(true);
    expect(isMccLinkForSelectedCustomer(mccLink, '9999999999', managerId)).toBe(false);
  });

  it('isMccLinkActiveForSetup requires ACTIVE status for selected customer', () => {
    const active = {
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: clientId,
    };
    const pending = { ...active, status: 'PENDING' };
    expect(isMccLinkActiveForSetup(active, clientId, managerId)).toBe(true);
    expect(isMccLinkActiveForSetup(pending, clientId, managerId)).toBe(false);
  });

  it('isMccLinkActiveForSetup accepts mcc_create provisioning source', () => {
    const created = {
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: clientId,
      provisioningSource: 'mcc_create',
    };
    expect(isMccLinkActiveForSetup(created, clientId, managerId)).toBe(true);
  });

  it('preserveMccLinkForSelection keeps link only when customer matches', () => {
    const mccLink = {
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: clientId,
    };
    expect(preserveMccLinkForSelection(mccLink, clientId, managerId)).toEqual(mccLink);
    expect(preserveMccLinkForSelection(mccLink, '9999999999', managerId)).toBeUndefined();
  });

  it('buildNewlyCreatedUnderMccLink only when manager matches login customer', () => {
    expect(buildNewlyCreatedUnderMccLink(clientId, managerId)?.provisioningSource).toBe('mcc_create');
    expect(buildNewlyCreatedUnderMccLink(clientId, '9999999999')).toBeNull();
  });
});
