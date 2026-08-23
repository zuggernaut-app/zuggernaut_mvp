'use strict';

const mongoose = require('mongoose');
const { CONVERSION_ACTION_CLAIM_LEASE_MS } = require('../constants/conversionActionClaim');
const { DEFAULT_CONVERSION_ACTION_TEMPLATES } = require('../constants/conversionActionRequirements');
const {
  claimConversionActionCreation,
  recoverOwnedConversionAction,
  isOwnedNameRecoverableError,
  ConversionActionClaimError,
} = require('../services/capabilities/conversionActionCreationClaim');
const { GoogleAdsApiError } = require('../services/integrations/googleAdsApiConfig');

describe('conversionActionCreationClaim', () => {
  let setupRunId;
  let businessId;
  const slot = { slot: 'call', logicalCategory: 'call' };
  const idempotencyKey = 'test-ca-claim-key';
  const template = DEFAULT_CONVERSION_ACTION_TEMPLATES.call;

  beforeEach(() => {
    setupRunId = new mongoose.Types.ObjectId();
    businessId = new mongoose.Types.ObjectId();
  });

  it('throws CONVERSION_ACTION_CLAIM_IN_PROGRESS when an active lease exists', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const leaseUntil = new Date(Date.now() + CONVERSION_ACTION_CLAIM_LEASE_MS);
    await IntegrationArtifact.create({
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action_created',
      externalId: 'pending:call',
      idempotencyKey,
      metadata: {
        slot: 'call',
        logicalCategory: 'call',
        claimState: 'claiming',
        claimLeaseExpiresAt: leaseUntil.toISOString(),
        ownedTemplateName: template.name,
      },
    });

    await expect(
      claimConversionActionCreation({ setupRunId, businessId, slot, idempotencyKey, template })
    ).rejects.toMatchObject({
      code: 'CONVERSION_ACTION_CLAIM_IN_PROGRESS',
    });
  });

  it('reclaims a stale claiming lease', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const expiredLease = new Date(Date.now() - 1_000).toISOString();
    await IntegrationArtifact.create({
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action_created',
      externalId: 'pending:call',
      idempotencyKey,
      metadata: {
        slot: 'call',
        logicalCategory: 'call',
        claimState: 'claiming',
        claimLeaseExpiresAt: expiredLease,
        ownedTemplateName: template.name,
      },
    });

    const claim = await claimConversionActionCreation({
      setupRunId,
      businessId,
      slot,
      idempotencyKey,
      template,
    });
    expect(claim.claimed).toBe(true);
    expect(claim.artifact.metadata.claimState).toBe('claiming');
  });

  it('returns idempotent when artifact is already created', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    await IntegrationArtifact.create({
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action_created',
      externalId: '12345',
      idempotencyKey,
      metadata: {
        slot: 'call',
        logicalCategory: 'call',
        claimState: 'created',
        resourceName: 'customers/1/conversionActions/12345',
      },
    });

    const claim = await claimConversionActionCreation({
      setupRunId,
      businessId,
      slot,
      idempotencyKey,
      template,
    });
    expect(claim.idempotent).toBe(true);
    expect(claim.artifact.externalId).toBe('12345');
  });

  it('isOwnedNameRecoverableError only matches duplicate-name Google Ads errors', () => {
    const recoverable = new GoogleAdsApiError('duplicate', 'GOOGLE_ADS_API_ERROR', {
      googleAdsErrors: [{ errorCode: 'DUPLICATE_NAME' }],
    });
    const other = new GoogleAdsApiError('permission', 'GOOGLE_ADS_API_ERROR', {
      googleAdsErrors: [{ errorCode: 'AUTHORIZATION_ERROR' }],
    });

    expect(isOwnedNameRecoverableError(recoverable)).toBe(true);
    expect(isOwnedNameRecoverableError(other)).toBe(false);
    expect(isOwnedNameRecoverableError(new Error('nope'))).toBe(false);
  });

  it('recoverOwnedConversionAction matches owned template name or default template name', () => {
    const catalog = [
      {
        name: template.name,
        externalId: '999',
        resourceName: 'customers/1/conversionActions/999',
      },
      {
        name: 'ZUG · acme-123456 · Phone Call',
        externalId: '888',
        resourceName: 'customers/1/conversionActions/888',
      },
    ];

    expect(recoverOwnedConversionAction(catalog, 'call', template.name)?.externalId).toBe('999');
    expect(
      recoverOwnedConversionAction(catalog, 'call', 'ZUG · acme-123456 · Phone Call')?.externalId
    ).toBe('888');
    expect(recoverOwnedConversionAction(catalog, 'call', 'Wrong name')?.externalId).toBe('999');
    expect(
      recoverOwnedConversionAction(
        [{ name: 'ZUG · acme-123456 · Phone Call', externalId: '888', resourceName: 'x' }],
        'call',
        'Wrong name'
      )
    ).toBeNull();
    expect(recoverOwnedConversionAction(catalog, 'call')).not.toBeNull();
  });

  it('throws ConversionActionClaimError for in-progress contention', () => {
    const err = new ConversionActionClaimError('busy', 'CONVERSION_ACTION_CLAIM_IN_PROGRESS');
    expect(err).toBeInstanceOf(ConversionActionClaimError);
    expect(err.code).toBe('CONVERSION_ACTION_CLAIM_IN_PROGRESS');
  });
});
