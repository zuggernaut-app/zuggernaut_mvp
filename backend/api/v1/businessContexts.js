'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const User = mongoose.model('User');
const { requireAuth } = require('./middleware/requireAuth');
const {
  normalizeStringList,
  validateMixedObjectOrNull,
  validateHttpUrl,
  MAX_SINGLE_LINE_FIELD,
} = require('../../lib/validation');
const { BUSINESS_CONTEXT_CONFIRM_REQUIRED } = require('../../constants/onboarding');
const {
  validateBusinessContextAdsReadiness,
} = require('../../services/capabilities/businessContextAdsReadinessService');
const { listOrgIdsForUser, MembershipCheckError } = require('../../lib/auth/membershipCheck');
const {
  assertBusinessMembershipOrPlatformAdmin,
} = require('./lib/platformAdminBusinessAccess');
const { isSoftLaunchMode } = require('../../constants/softLaunch');
const { deriveBusinessNameKey } = require('../../lib/businessNameKey');
const { resolvePrimaryGoal } = require('../../services/capabilities/adsConversionCatalogService');
const { buildSusoMatrix } = require('../../services/capabilities/susoMatrixService');
const {
  validateCompetitorLandscape,
  validateStep0Put,
  snapshotStep0Fields,
  step0FieldsChanged,
} = require('../../lib/susoStep0Validation');
const {
  BUSINESS_SCOPE,
  VALUE_COMPLEXITY,
  BUDGET_TIER,
} = require('../../constants/suso');

const SOFT_LAUNCH_DEFAULT_UVP = 'Soft-launch default — operator to refine';

const router = express.Router();

/**
 * Fill missing Step 0 fields on confirm during soft launch so setup is not blocked
 * before an operator refines strategy. Never overwrites non-empty values.
 *
 * @param {import('mongoose').Document} doc
 */
function applySoftLaunchStep0Defaults(doc) {
  if (!isSoftLaunchMode()) return;

  const uvpTrimmed = typeof doc.uvp === 'string' ? doc.uvp.trim() : '';
  if (!uvpTrimmed) {
    const fromDifferentiators =
      typeof doc.differentiators === 'string' ? doc.differentiators.trim() : '';
    doc.uvp = fromDifferentiators || SOFT_LAUNCH_DEFAULT_UVP;
  }

  if (!doc.businessScope) {
    doc.businessScope = BUSINESS_SCOPE.LOCAL_SERVICE;
  }
  if (!doc.valueComplexity) {
    doc.valueComplexity = VALUE_COMPLEXITY.LOW_LOW;
  }
  if (!doc.budgetTier) {
    doc.budgetTier = BUDGET_TIER.STARTER;
  }
}

function serializeBusinessContext(doc) {
  return {
    businessId: doc.businessId.toString(),
    userId: doc.userId.toString(),
    websiteUrl: doc.websiteUrl ?? null,
    businessName: doc.businessName ?? null,
    industry: doc.industry ?? null,
    services: doc.services ?? [],
    serviceAreas: doc.serviceAreas ?? [],
    contactMethods: doc.contactMethods ?? null,
    audienceSignals: doc.audienceSignals ?? null,
    goals: doc.goals ?? null,
    differentiators: doc.differentiators ?? null,
    orderValueHint: doc.orderValueHint ?? null,
    thankYouUrls: Array.isArray(doc.thankYouUrls) ? doc.thankYouUrls : [],
    nameKey: doc.nameKey ?? null,
    uvp: doc.uvp ?? null,
    competitorLandscape: doc.competitorLandscape ?? null,
    businessScope: doc.businessScope ?? null,
    valueComplexity: doc.valueComplexity ?? null,
    budgetTier: doc.budgetTier ?? null,
    susoVersion: typeof doc.susoVersion === 'number' ? doc.susoVersion : 0,
    susoVersionUpdatedAt: doc.susoVersionUpdatedAt ?? null,
    businessCountry: doc.businessCountry ?? null,
    setupCallConfirmedAt: doc.setupCallConfirmedAt ?? null,
    whoBuysToday: doc.whoBuysToday ?? null,
    howBuyersContact: doc.howBuyersContact ?? null,
    intakeFieldSources: doc.intakeFieldSources ?? null,
    confirmedAt: doc.confirmedAt ?? null,
    updatedAt: doc.updatedAt,
  };
}

/** Canonical fields users may confirm/edit (PUT body subset). */
const EDITABLE_FIELDS = new Set([
  'websiteUrl',
  'businessName',
  'industry',
  'services',
  'serviceAreas',
  'contactMethods',
  'audienceSignals',
  'goals',
  'differentiators',
  'orderValueHint',
  'thankYouUrls',
  'uvp',
  'competitorLandscape',
  'businessScope',
  'valueComplexity',
  'budgetTier',
]);

router.get('/', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const orgIds = await listOrgIdsForUser(userId);
  const accessFilters = [{ userId }];
  if (orgIds.length > 0) {
    accessFilters.push({ orgId: { $in: orgIds } });
  }

  const rows = await BusinessContext.find({ $or: accessFilters })
    .sort({ updatedAt: -1 })
    .lean();

  return res.status(200).json({
    businessContexts: rows.map(serializeBusinessContext),
  });
});

router.get('/:businessId', requireAuth, async (req, res) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }

  try {
    await assertBusinessMembershipOrPlatformAdmin(req.user.id, businessIdRaw);
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      const status = err.code === 'forbidden' ? 403 : 404;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    throw err;
  }

  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const doc = await BusinessContext.findOne({ businessId }).lean();
  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business context not found for this user',
    });
  }

  return res.status(200).json({
    businessContext: serializeBusinessContext(doc),
    adsReadiness: await validateBusinessContextAdsReadiness(doc),
    susoMatrix: buildSusoMatrix(doc),
  });
});

router.put('/:businessId', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  try {
    await assertBusinessMembershipOrPlatformAdmin(req.user.id, businessIdRaw);
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      const status = err.code === 'forbidden' ? 403 : 404;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    throw err;
  }

  let doc;
  try {
    doc = await BusinessContext.findOne({ businessId });
  } catch {
    return res.status(503).json({
      error: 'service_unavailable',
      message: 'Database query failed. Check MongoDB and MONGODB_URI.',
    });
  }

  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business context not found for this user',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const step0Before = snapshotStep0Fields(doc);
  for (const key of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const val = body[key];
    if (key === 'competitorLandscape') {
      const mixed = validateCompetitorLandscape(val);
      if (!mixed.ok) {
        return res.status(400).json({ error: 'validation_error', message: mixed.message });
      }
      if (mixed.value === undefined) continue;
      doc[key] = mixed.value;
      continue;
    }
    if (key === 'businessScope' || key === 'valueComplexity' || key === 'budgetTier') {
      if (val === null || val === undefined || val === '') {
        doc[key] = undefined;
        continue;
      }
      if (typeof val !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: `${key} must be a string or null`,
        });
      }
      doc[key] = val.trim();
      continue;
    }
    if (key === 'services' || key === 'serviceAreas' || key === 'thankYouUrls') {
      const list = normalizeStringList(val, key);
      if (!list.ok) {
        return res.status(400).json({ error: 'validation_error', message: list.message });
      }
      doc[key] = list.value;
      continue;
    }
    if (
      key === 'contactMethods' ||
      key === 'audienceSignals' ||
      key === 'goals'
    ) {
      const mixed = validateMixedObjectOrNull(val, key);
      if (!mixed.ok) {
        return res.status(400).json({ error: 'validation_error', message: mixed.message });
      }
      if (mixed.value === undefined) continue;
      doc[key] = mixed.value;
      continue;
    }
    if (key === 'websiteUrl') {
      if (val === null || val === undefined || val === '') {
        doc[key] = undefined;
        continue;
      }
      if (typeof val !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: 'websiteUrl must be a string or null',
        });
      }
      const urlCheck = validateHttpUrl(val);
      if (!urlCheck.ok) {
        return res.status(400).json({ error: 'validation_error', message: urlCheck.message });
      }
      doc[key] = urlCheck.value;
      continue;
    }
    if (typeof val === 'string' || val === null || val === undefined) {
      if (val === null || val === undefined || val === '') {
        doc[key] = undefined;
      } else {
        const t = val.trim();
        if (t.length > MAX_SINGLE_LINE_FIELD) {
          return res.status(400).json({
            error: 'validation_error',
            message: `${key} must be at most ${MAX_SINGLE_LINE_FIELD} characters`,
          });
        }
        doc[key] = t;
      }
    } else {
      return res.status(400).json({
        error: 'validation_error',
        message: `Invalid type for ${key}`,
      });
    }
  }

  applySoftLaunchStep0Defaults(doc);

  const step0Validation = validateStep0Put(body, doc);
  if (!step0Validation.ok) {
    return res.status(400).json({
      error: 'validation_error',
      message: step0Validation.message,
    });
  }

  for (const field of BUSINESS_CONTEXT_CONFIRM_REQUIRED) {
    const value = doc[field];
    if (typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({
        error: 'validation_error',
        message: `${field} is required to confirm business context`,
      });
    }
  }

  if (isSoftLaunchMode()) {
    const primary = resolvePrimaryGoal(doc.goals);
    if (primary !== 'forms') {
      return res.status(400).json({
        error: 'validation_error',
        message: 'During soft launch, primary business goal must be form submissions.',
      });
    }
  }

  if (!doc.nameKey) {
    doc.nameKey = deriveBusinessNameKey(doc.businessName, doc.businessId);
  }

  const step0After = snapshotStep0Fields(doc);
  if (step0FieldsChanged(step0Before, step0After)) {
    doc.susoVersion = (typeof doc.susoVersion === 'number' ? doc.susoVersion : 0) + 1;
    doc.susoVersionUpdatedAt = new Date();
  }

  doc.confirmedAt = new Date();
  try {
    await doc.save();
    await User.findByIdAndUpdate(doc.userId, {
      $set: { primaryBusinessId: doc.businessId },
    });
  } catch (err) {
    if (err?.name === 'ValidationError') {
      const msg =
        typeof err.message === 'string' ? err.message : 'Validation failed';
      return res.status(400).json({ error: 'validation_error', message: msg });
    }
    return next(err);
  }

  return res.status(200).json({
    businessContext: serializeBusinessContext(doc),
    adsReadiness: await validateBusinessContextAdsReadiness(doc.toObject()),
    susoMatrix: buildSusoMatrix(doc.toObject()),
  });
});

module.exports = router;
