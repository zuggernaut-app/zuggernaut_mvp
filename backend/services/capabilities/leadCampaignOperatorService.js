'use strict';

const mongoose = require('mongoose');
const { INTAKE_FIELD_SOURCES, CAMPAIGN_SEND_BACK_REASONS } = require('../../constants/leadCampaign');
const { isValidPhone, validateHttpUrl, isValidEmail } = require('../../lib/validation');
const { parseInternationalPhone } = require('../scraper/phoneUtils');
const {
  getLeadCampaignSet,
  updateSlot,
  LeadCampaignSetError,
} = require('./leadCampaignSetService');

const BusinessContext = mongoose.model('BusinessContext');
const LeadCampaignSet = mongoose.model('LeadCampaignSet');

class LeadCampaignOperatorError extends Error {
  constructor(message, code = 'LEAD_CAMPAIGN_OPERATOR_ERROR') {
    super(message);
    this.name = 'LeadCampaignOperatorError';
    this.code = code;
  }
}

/**
 * @param {string} raw
 * @param {string | null | undefined} countryCode
 */
function normalizeOperatorPhone(raw, countryCode) {
  const country = String(countryCode ?? 'US').slice(0, 2).toUpperCase();
  const parsed = parseInternationalPhone(String(raw).trim(), country);
  return parsed?.e164 ?? null;
}

/**
 * @param {object | null | undefined} contactMethods
 * @param {'phones' | 'emails'} kind
 * @param {string} value
 */
function setCanonicalContactValue(contactMethods, kind, value) {
  const next = { ...(contactMethods ?? {}) };
  next[kind] = [value];
  if (kind === 'phones' && next.phone) delete next.phone;
  if (kind === 'emails' && next.email) delete next.email;
  return next;
}

const FACT_CHECK_FIELDS = [
  'businessName',
  'websiteUrl',
  'phone',
  'email',
  'services',
  'whoBuysToday',
  'serviceAreas',
  'orderValueHint',
  'howBuyersContact',
  'businessCountry',
];

const SETUP_CALL_REQUIRED_OPERATOR_SOURCES = [
  'services',
  'whoBuysToday',
  'serviceAreas',
  'orderValueHint',
  'howBuyersContact',
];

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function loadBusinessForOperator(businessId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);
  const doc = await BusinessContext.findOne({ businessId: biz });
  if (!doc) {
    throw new LeadCampaignOperatorError('Business not found.', 'not_found');
  }
  return doc;
}

/**
 * Task 8 — operator fact-check corrections.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} corrections
 */
async function applyOperatorFactCheck(businessId, corrections) {
  const doc = await loadBusinessForOperator(businessId);
  const sources = { ...(doc.intakeFieldSources ?? {}) };

  for (const field of FACT_CHECK_FIELDS) {
    if (!(field in corrections)) continue;
    const value = corrections[field];

    if (field === 'phone' && value != null && value !== '') {
      if (!isValidPhone(String(value))) {
        throw new LeadCampaignOperatorError('Invalid phone format.', 'validation_error');
      }
      const normalized = normalizeOperatorPhone(String(value), doc.businessCountry);
      if (!normalized) {
        throw new LeadCampaignOperatorError('Invalid phone format.', 'validation_error');
      }
      doc.contactMethods = setCanonicalContactValue(doc.contactMethods, 'phones', normalized);
      sources.phone = 'operator';
      continue;
    }
    if (field === 'email' && value != null && value !== '') {
      if (!isValidEmail(String(value))) {
        throw new LeadCampaignOperatorError('Invalid email format.', 'validation_error');
      }
      doc.contactMethods = setCanonicalContactValue(
        doc.contactMethods,
        'emails',
        String(value).trim()
      );
      sources.email = 'operator';
      continue;
    }
    if (field === 'websiteUrl' && value != null && value !== '') {
      const urlCheck = validateHttpUrl(String(value));
      if (!urlCheck.ok) {
        throw new LeadCampaignOperatorError(urlCheck.message, 'validation_error');
      }
      doc.websiteUrl = urlCheck.value;
      sources.websiteUrl = 'operator';
      continue;
    }

    if (field === 'services' || field === 'serviceAreas') {
      if (!Array.isArray(value)) {
        throw new LeadCampaignOperatorError(`${field} must be an array.`, 'validation_error');
      }
      doc[field] = value.map((v) => String(v ?? '').trim()).filter(Boolean);
    } else if (value != null) {
      doc[field] = typeof value === 'string' ? value.trim() : value;
    }

    sources[field] = 'operator';
  }

  doc.intakeFieldSources = sources;
  doc.factCheckCompletedAt = new Date();
  await doc.save();
  return doc;
}

/**
 * Task 12a — record confirmation call completion.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function recordSetupCallConfirmation(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const sources = { ...(doc.intakeFieldSources ?? {}) };

  for (const field of SETUP_CALL_REQUIRED_OPERATOR_SOURCES) {
    if (sources[field] !== 'operator') {
      throw new LeadCampaignOperatorError(
        'All five answers must be operator-reviewed before recording the confirmation call.',
        'validation_error'
      );
    }
  }

  if (body.phone != null && String(body.phone).trim()) {
    if (!isValidPhone(String(body.phone))) {
      throw new LeadCampaignOperatorError('Invalid phone format.', 'validation_error');
    }
    const normalized = normalizeOperatorPhone(String(body.phone), doc.businessCountry);
    if (!normalized) {
      throw new LeadCampaignOperatorError('Invalid phone format.', 'validation_error');
    }
    doc.contactMethods = setCanonicalContactValue(doc.contactMethods, 'phones', normalized);
    sources.phone = 'operator';
  }

  if (body.email != null && String(body.email).trim()) {
    if (!isValidEmail(String(body.email))) {
      throw new LeadCampaignOperatorError('Invalid email format.', 'validation_error');
    }
    doc.contactMethods = setCanonicalContactValue(
      doc.contactMethods,
      'emails',
      String(body.email).trim()
    );
    sources.email = 'operator';
  }

  if (body.orderValueHint != null && String(body.orderValueHint).trim()) {
    doc.orderValueHint = String(body.orderValueHint).trim();
    sources.orderValueHint = 'operator';
  }

  if (Array.isArray(body.confirmedFields)) {
    for (const field of body.confirmedFields) {
      if (FACT_CHECK_FIELDS.includes(field)) {
        sources[field] = sources[field] ?? 'operator';
      }
    }
  }

  doc.intakeFieldSources = sources;
  doc.setupCallConfirmedAt = new Date();
  await doc.save();
  return {
    businessId: doc.businessId.toString(),
    setupCallConfirmedAt: doc.setupCallConfirmedAt,
  };
}

/**
 * Task 27 — approve campaign slot.
 */
async function approveCampaignSlot(businessId, slot, note) {
  const set = await getLeadCampaignSet(businessId);
  const slotDoc = set?.[slot];
  if (!slotDoc?.reservedAt) {
    throw new LeadCampaignOperatorError('Slot not reserved.', 'not_found');
  }
  if (slotDoc.reviewStatus === 'retired') {
    throw new LeadCampaignOperatorError('Campaign is retired.', 'campaign_retired');
  }

  const history = Array.isArray(slotDoc.reviewHistory) ? [...slotDoc.reviewHistory] : [];
  history.push({
    action: 'approved',
    note: note ?? null,
    at: new Date().toISOString(),
  });

  return updateSlot(businessId, slot, {
    reviewStatus: 'approved',
    reviewHistory: history,
  });
}

/**
 * Task 27 — send campaign back for regeneration.
 */
async function sendBackCampaignSlot(businessId, slot, reasonCode, note) {
  if (!CAMPAIGN_SEND_BACK_REASONS.includes(reasonCode)) {
    throw new LeadCampaignOperatorError('Invalid send-back reason code.', 'validation_error');
  }

  const current = await getLeadCampaignSet(businessId);
  if (current?.[slot]?.reviewStatus === 'sent_back') {
    throw new LeadCampaignOperatorError(
      'Campaign is already sent back for regeneration.',
      'invalid_review_state'
    );
  }

  const result = await LeadCampaignSet.findOneAndUpdate(
    {
      businessId,
      [`${slot}.reservedAt`]: { $exists: true, $ne: null },
      [`${slot}.reviewStatus`]: { $in: ['pending_review', 'approved'] },
    },
    {
      $set: { [`${slot}.reviewStatus`]: 'sent_back' },
      $inc: { [`${slot}.regenerationCount`]: 1 },
      $push: {
        [`${slot}.reviewHistory`]: {
          action: 'sent_back',
          reasonCode,
          note: note ?? null,
          at: new Date().toISOString(),
        },
      },
    },
    { returnDocument: 'after' }
  );

  if (!result) {
    throw new LeadCampaignOperatorError('Slot not found or not reviewable.', 'not_found');
  }

  const count = result[slot]?.regenerationCount ?? 0;
  if (count >= 2) {
    await LeadCampaignSet.updateOne(
      { businessId },
      { $set: { [`${slot}.reviewStatus`]: 'internal_review' } }
    );
    result[slot].reviewStatus = 'internal_review';
  }

  return result;
}

/**
 * Task 29 — retire campaign from internal review.
 */
async function retireCampaignSlot(businessId, slot, note) {
  const set = await getLeadCampaignSet(businessId);
  const slotDoc = set?.[slot];
  if (!slotDoc?.reservedAt) {
    throw new LeadCampaignOperatorError('Slot not found.', 'not_found');
  }
  if (slotDoc.reviewStatus !== 'internal_review') {
    throw new LeadCampaignOperatorError(
      'Retire is only allowed from internal review.',
      'invalid_review_state'
    );
  }

  const IntegrationArtifact = mongoose.model('IntegrationArtifact');
  const { pauseAdsCampaign } = require('../integrations/googleAdsCampaignClient');
  const campaignArtifact = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_campaign',
    'metadata.slot': slot,
  }).lean();
  if (campaignArtifact?.externalId) {
    await pauseAdsCampaign({ businessId, campaignResourceName: campaignArtifact.externalId });
  }

  const history = Array.isArray(slotDoc.reviewHistory) ? [...slotDoc.reviewHistory] : [];
  history.push({
    action: 'retired',
    note: note ?? null,
    at: new Date().toISOString(),
  });

  return updateSlot(businessId, slot, {
    reviewStatus: 'retired',
    desiredState: 'paused',
    pauseReason: 'operator_retired',
    reviewHistory: history,
  });
}

module.exports = {
  LeadCampaignOperatorError,
  FACT_CHECK_FIELDS,
  INTAKE_FIELD_SOURCES,
  applyOperatorFactCheck,
  recordSetupCallConfirmation,
  approveCampaignSlot,
  sendBackCampaignSlot,
  retireCampaignSlot,
};
