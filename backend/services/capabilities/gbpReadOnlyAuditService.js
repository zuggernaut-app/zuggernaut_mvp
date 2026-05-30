'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { fetchGbpProfileReadModel, phoneFromBusinessContext } = require('../integrations/gbpProfileReadClient');
const BusinessContext = mongoose.model('BusinessContext');
const ProviderSnapshot = mongoose.model('ProviderSnapshot');
const AuditReport = mongoose.model('AuditReport');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

class GbpProviderPreconditionError extends Error {
  constructor(message, code = 'GBP_PROVIDER_PRECONDITION') {
    super(message);
    this.name = 'GbpProviderPreconditionError';
    this.code = code;
  }
}

function normalizeStr(value) {
  return value != null ? String(value).trim().toLowerCase() : '';
}

/**
 * @param {object} bc — lean BusinessContext
 * @param {{ profile: Record<string, unknown> }} readModel
 */
function computeFindings(bc, readModel) {
  const present = [];
  const missing = [];
  const needsAttention = [];
  const profile = readModel.profile ?? {};

  function compareScalar(bcVal, profileVal, label) {
    const confirmedStr = normalizeStr(bcVal);
    const profileStr = normalizeStr(profileVal);

    if (!confirmedStr && !profileStr) {
      missing.push(label);
    } else if (confirmedStr && profileStr && confirmedStr === profileStr) {
      present.push(label);
    } else if (confirmedStr && !profileStr) {
      needsAttention.push(`${label}: confirmed in onboarding but absent from GBP`);
    } else if (confirmedStr && profileStr && confirmedStr !== profileStr) {
      needsAttention.push(`${label}: mismatch between confirmed context and GBP`);
    } else if (!confirmedStr && profileStr) {
      needsAttention.push(`${label}: present on GBP but not confirmed in business context`);
    }
  }

  compareScalar(bc.businessName, profile.businessName, 'Business name');
  compareScalar(bc.websiteUrl, profile.websiteUrl, 'Website URL');
  compareScalar(bc.industry, profile.primaryCategory, 'Primary category');

  const confirmedPhone = phoneFromBusinessContext(bc);
  compareScalar(confirmedPhone, profile.phoneNumber, 'Phone number');

  const bcAreas = Array.isArray(bc.serviceAreas) ? bc.serviceAreas.filter(Boolean) : [];
  const gbpAreas = Array.isArray(profile.serviceAreas) ? profile.serviceAreas.filter(Boolean) : [];
  if (bcAreas.length === 0 && gbpAreas.length === 0) {
    missing.push('Service areas');
  } else if (bcAreas.length > 0 && gbpAreas.length === 0) {
    needsAttention.push('Service areas: confirmed in onboarding but absent from GBP');
  } else if (bcAreas.length > 0 && gbpAreas.length > 0) {
    const bcSet = new Set(bcAreas.map(normalizeStr));
    const overlap = gbpAreas.some((a) => bcSet.has(normalizeStr(a)));
    if (overlap) present.push('Service areas');
    else needsAttention.push('Service areas: GBP areas do not overlap confirmed context');
  } else if (bcAreas.length === 0 && gbpAreas.length > 0) {
    needsAttention.push('Service areas: present on GBP but not confirmed in business context');
  }

  if (profile.openingHoursPresent === true) {
    present.push('Opening hours');
  } else {
    missing.push('Opening hours');
  }

  return { present, missing, needsAttention };
}

function findingsSummary(findings) {
  return {
    presentCount: findings.present.length,
    missingCount: findings.missing.length,
    needsAttentionCount: findings.needsAttention.length,
  };
}

const GBP_MISSING_REASONS = Object.freeze(['GBP_NO_ACCOUNTS', 'GBP_NO_LOCATIONS']);

/**
 * @param {string} code
 */
function isGbpMissingReason(code) {
  return GBP_MISSING_REASONS.includes(code);
}

/**
 * @param {string} reason
 */
function buildGbpMissingGuidance(reason) {
  if (reason === 'GBP_NO_ACCOUNTS') {
    return {
      code: 'GBP_NO_ACCOUNTS',
      title: 'No Google Business Profile account found',
      message:
        'Connect a Google account that has access to your Business Profile, or create one in Google Business Profile.',
      blocking: false,
    };
  }

  if (reason === 'GBP_NO_LOCATIONS') {
    return {
      code: 'GBP_NO_LOCATIONS',
      title: 'No Google Business Profile location found',
      message:
        'Your Google account has a Business Profile account but no locations. Add or claim a business location in Google Business Profile to enable the audit.',
      blocking: false,
    };
  }

  return {
    code: reason,
    title: 'Google Business Profile unavailable',
    message: 'Google Business Profile is optional for setup. Connect or create a profile to run a read-only audit.',
    blocking: false,
  };
}

/**
 * @param {object} ctx
 * @param {{ reason: string, guidance: object }} input
 */
async function persistGbpMissingAuditResult(ctx, input) {
  const { setupRunId, businessId, logger } = ctx;
  const { reason, guidance } = input;
  const recordedAt = new Date().toISOString();
  const findings = {
    present: [],
    missing: [],
    needsAttention: [guidance.message],
  };
  const summary = findingsSummary(findings);
  const payload = {
    source: 'gbp_missing',
    recordedAt,
    reason,
    guidance,
  };

  await ProviderSnapshot.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'gbp',
      snapshotType: 'gbp_profile_read',
    },
    {
      $set: { payload },
      $setOnInsert: { immutable: true, snapshotVersion: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await AuditReport.findOneAndUpdate(
    { setupRunId, businessId },
    {
      $set: {
        findings,
        rawProviderRefs: {
          snapshotType: 'gbp_profile_read',
          source: 'gbp_missing',
          reason,
        },
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const artifactCount = await IntegrationArtifact.countDocuments({
    setupRunId,
    businessId,
    provider: 'gbp',
  });
  if (artifactCount > 0) {
    logger?.warn?.(
      { setupRunId: setupRunId.toString(), businessId: businessId.toString(), artifactCount },
      'unexpected gbp IntegrationArtifact rows during read-only audit'
    );
  }

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      provider: 'gbp',
      reason,
      blocking: false,
      ...summary,
      source: 'gbp_missing',
    },
    'gbp read-only audit skipped with guidance'
  );

  return {
    skipped: true,
    reason,
    guidance,
    findings,
    summary,
    source: 'gbp_missing',
    blocking: false,
  };
}

/**
 * Read-only GBP audit — persists ProviderSnapshot + AuditReport. Never writes to GBP.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} ctx.logger
 */
async function runGbpReadOnlyAudit(ctx) {
  const { setupRunId, businessId, logger } = ctx;

  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    throw new GbpProviderPreconditionError('BusinessContext missing for GBP audit.');
  }

  let readModel;
  try {
    readModel = await fetchGbpProfileReadModel({ businessId, logger });
  } catch (err) {
    const code = err instanceof Error && err.code ? err.code : 'GBP_READ_FAILED';
    if (isGbpMissingReason(code)) {
      const guidance = buildGbpMissingGuidance(code);
      return persistGbpMissingAuditResult(ctx, { reason: code, guidance });
    }
    const msg = err instanceof Error ? err.message : 'GBP profile read failed';
    throw new GbpProviderPreconditionError(msg, code);
  }

  const findings = computeFindings(bc, readModel);
  const summary = findingsSummary(findings);

  await ProviderSnapshot.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'gbp',
      snapshotType: 'gbp_profile_read',
    },
    {
      $set: { payload: readModel },
      $setOnInsert: { immutable: true, snapshotVersion: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await AuditReport.findOneAndUpdate(
    { setupRunId, businessId },
    {
      $set: {
        findings,
        rawProviderRefs: {
          snapshotType: 'gbp_profile_read',
          source: readModel.source,
          locationName: readModel.locationName ?? null,
        },
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const artifactCount = await IntegrationArtifact.countDocuments({
    setupRunId,
    businessId,
    provider: 'gbp',
  });
  if (artifactCount > 0) {
    logger?.warn?.(
      { setupRunId: setupRunId.toString(), businessId: businessId.toString(), artifactCount },
      'unexpected gbp IntegrationArtifact rows during read-only audit'
    );
  }

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      provider: 'gbp',
      ...summary,
      source: readModel.source,
    },
    'gbp read-only audit persisted'
  );

  return { findings, summary, source: readModel.source };
}

module.exports = {
  runGbpReadOnlyAudit,
  GbpProviderPreconditionError,
  computeFindings,
  findingsSummary,
  phoneFromBusinessContext,
  buildGbpMissingGuidance,
  isGbpMissingReason,
  GBP_MISSING_REASONS,
};
