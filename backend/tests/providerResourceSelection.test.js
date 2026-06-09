'use strict';

const {
  buildGoogleAdsCustomerOption,
  formatGoogleAdsCustomerId,
  isGoogleAdsAccountSelectable,
  normalizeGoogleAdsAccountStatus,
  pickPreferredGoogleAdsCustomerOption,
} = require('../lib/dev/providerResourceSelection');
const {
  GOOGLE_ADS_ACCOUNT_KIND,
  GOOGLE_ADS_ACCOUNT_STATUS,
} = require('../constants/providerResourceSelection');

describe('providerResourceSelection helpers', () => {
  it('formats Google Ads customer ids for display', () => {
    expect(formatGoogleAdsCustomerId('6314301557')).toBe('631-430-1557');
  });

  it('normalizes Google Ads account statuses', () => {
    expect(normalizeGoogleAdsAccountStatus('CANCELLED')).toBe(GOOGLE_ADS_ACCOUNT_STATUS.CANCELLED);
    expect(normalizeGoogleAdsAccountStatus('ENABLED')).toBe(GOOGLE_ADS_ACCOUNT_STATUS.ENABLED);
  });

  it('marks manager and cancelled accounts as non-selectable', () => {
    const manager = buildGoogleAdsCustomerOption('2940178860', {
      descriptiveName: 'Manager',
      manager: true,
      status: 'ENABLED',
    });
    const cancelled = buildGoogleAdsCustomerOption('6314301557', {
      descriptiveName: 'Cancelled',
      manager: false,
      status: 'CANCELLED',
    });
    const client = buildGoogleAdsCustomerOption('7809414862', {
      descriptiveName: 'Client',
      manager: false,
      status: 'ENABLED',
    });

    expect(manager.kind).toBe(GOOGLE_ADS_ACCOUNT_KIND.MANAGER);
    expect(isGoogleAdsAccountSelectable(manager)).toBe(false);
    expect(isGoogleAdsAccountSelectable(cancelled)).toBe(false);
    expect(isGoogleAdsAccountSelectable(client)).toBe(true);
  });

  it('marks metadata API failures as non-selectable with guidance', () => {
    const option = buildGoogleAdsCustomerOption('7119783568', {
      metadataError: true,
      authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED',
    });

    expect(option.selectable).toBe(false);
    expect(option.nonSelectableReason).toContain('test account');
  });

  it('prefers env override and test accounts when picking defaults', () => {
    const options = [
      {
        customerId: '6314301557',
        selectable: false,
        testAccount: false,
        kind: GOOGLE_ADS_ACCOUNT_KIND.CLIENT,
      },
      {
        customerId: '7809414862',
        selectable: true,
        testAccount: false,
        kind: GOOGLE_ADS_ACCOUNT_KIND.CLIENT,
      },
      {
        customerId: '5369183891',
        selectable: true,
        testAccount: true,
        kind: GOOGLE_ADS_ACCOUNT_KIND.CLIENT,
      },
    ];

    process.env.GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID = '5369183891';
    expect(pickPreferredGoogleAdsCustomerOption(options)).toBe('5369183891');

    delete process.env.GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID;
    expect(pickPreferredGoogleAdsCustomerOption(options)).toBe('5369183891');
  });
});
