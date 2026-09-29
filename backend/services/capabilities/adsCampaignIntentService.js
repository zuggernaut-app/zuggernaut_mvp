'use strict';

const { validateHttpUrl } = require('../../lib/validation');
const {
  ADS_INTENT_CODES,
  CAMPAIGN_INTENT_VERSION,
  CAMPAIGN_CHANNEL,
  CAMPAIGN_STATUS,
  AD_GROUP_TYPE,
  BIDDING_STRATEGY,
  MIN_DAILY_BUDGET_MICROS,
  DEFAULT_DAILY_BUDGET_MICROS,
  MAX_CAMPAIGN_NAME_CHARS,
  MAX_AD_GROUP_NAME_CHARS,
  MAX_BUDGET_NAME_CHARS,
  RSA_MIN_HEADLINES,
  RSA_MAX_HEADLINES,
  RSA_MIN_DESCRIPTIONS,
  RSA_MAX_DESCRIPTIONS,
  RSA_HEADLINE_MAX_CHARS,
  RSA_DESCRIPTION_MAX_CHARS,
  DEFAULT_NETWORK_SETTINGS,
  ADS_INTENT_VALIDATION_BUCKETS,
} = require('../../constants/adsCampaignIntent');
const {
  sanitizeKeywordSeeds,
  validateKeywordCompliance,
} = require('./googleAdsCampaignComplianceService');

/**
 * @typedef {object} CampaignIntentIssue
 * @property {string} code
 * @property {string} field
 * @property {string} message
 * @property {'campaign'|'ad_group'|'ad'|'keywords'|'geo'|'conversions'} [bucket]
 */

/**
 * @param {string} code
 * @param {string} field
 * @param {string} message
 * @param {CampaignIntentIssue['bucket']} [bucket]
 * @returns {CampaignIntentIssue}
 */
function issue(code, field, message, bucket) {
  return { code, field, message, ...(bucket ? { bucket } : {}) };
}

/**
 * @param {string | undefined | null} text
 * @param {number} maxChars
 */
function normalizeRsaText(text, maxChars) {
  const trimmed = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars).trim();
}

/**
 * @param {string[]} texts
 * @param {number} minCount
 * @param {number} maxCount
 * @param {number} maxChars
 */
function validateUniqueRsaTexts(texts, minCount, maxCount, maxChars) {
  const seen = new Set();
  const normalized = [];

  for (const raw of texts) {
    const text = normalizeRsaText(raw, maxChars);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= maxCount) {
      break;
    }
  }

  return normalized;
}

/**
 * @param {string[]} keywordSeeds
 */
function buildKeywordsFromSeeds(keywordSeeds) {
  const { keywords } = sanitizeKeywordSeeds(keywordSeeds);
  return keywords;
}

/**
 * @param {import('./businessContextAdsReadinessService').AdsReadinessNormalized} normalized
 * @param {object[]} conversionArtifacts
 * @param {{ budgetAmountMicros?: number }} [options]
 */
function buildCampaignIntentFromNormalized(normalized, conversionArtifacts, options = {}) {
  const {
    businessName,
    websiteUrl,
    primaryService,
    primaryServiceArea,
    serviceAreas,
    keywordSeeds,
    adCopySeeds,
  } = normalized;

  const amountMicros =
    Number.isFinite(options.budgetAmountMicros) && options.budgetAmountMicros > 0
      ? options.budgetAmountMicros
      : DEFAULT_DAILY_BUDGET_MICROS;

  return {
    version: CAMPAIGN_INTENT_VERSION,
    businessName,
    websiteUrl,
    goals: { primary: normalized.resolvedPrimaryGoal },
    serviceAreas,
    selectedConversionIds: conversionArtifacts.map((artifact) => String(artifact.externalId)),
    campaign: {
      name: `${businessName} — Zuggernaut Search`,
      channel: CAMPAIGN_CHANNEL.SEARCH,
      status: CAMPAIGN_STATUS.PAUSED,
      bidding: BIDDING_STRATEGY.MANUAL_CPC,
      budget: {
        name: `${businessName} — Daily Budget`,
        amountMicros,
      },
      networkSettings: { ...DEFAULT_NETWORK_SETTINGS },
    },
    adGroup: {
      name: `${businessName} — Core`,
      type: AD_GROUP_TYPE.SEARCH_STANDARD,
      status: CAMPAIGN_STATUS.PAUSED,
    },
    ad: {
      finalUrl: websiteUrl,
      headlines: adCopySeeds.headlines,
      descriptions: adCopySeeds.descriptions,
      primaryService,
      primaryServiceArea,
    },
    keywords: buildKeywordsFromSeeds(keywordSeeds),
    geoTargetLabels: [primaryServiceArea],
    geoTargets: [],
  };
}

/**
 * @param {string | undefined | null} resourceName
 */
function isValidGeoTargetResourceName(resourceName) {
  return /^geoTargetConstants\/[a-zA-Z0-9_-]+$/.test(String(resourceName ?? '').trim());
}

/**
 * @param {string} name
 * @param {number} maxChars
 * @param {string} field
 * @param {string} code
 * @param {CampaignIntentIssue['bucket']} bucket
 * @param {CampaignIntentIssue[]} issues
 */
function validateRequiredName(name, maxChars, field, code, bucket, issues) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    issues.push(issue(code, field, `${field} is required.`, bucket));
    return;
  }
  if (trimmed.length > maxChars) {
    issues.push(
      issue(code, field, `${field} must be at most ${maxChars} characters.`, bucket)
    );
  }
}

/**
 * @param {object | null | undefined} intent
 * @returns {{ ok: true, intent: object } | { ok: false, issues: CampaignIntentIssue[] }}
 */
function validateCampaignIntent(intent) {
  const issues = [];
  const data = intent ?? {};

  if (data.version !== CAMPAIGN_INTENT_VERSION) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_CAMPAIGN_NAME,
        'version',
        `Campaign intent version must be ${CAMPAIGN_INTENT_VERSION}.`,
        'campaign'
      )
    );
  }

  const campaign = data.campaign ?? {};
  validateRequiredName(
    campaign.name,
    MAX_CAMPAIGN_NAME_CHARS,
    'campaign.name',
    ADS_INTENT_CODES.INVALID_CAMPAIGN_NAME,
    'campaign',
    issues
  );

  if (campaign.channel !== CAMPAIGN_CHANNEL.SEARCH) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_CAMPAIGN_CHANNEL,
        'campaign.channel',
        'Campaign channel must be SEARCH.',
        'campaign'
      )
    );
  }

  if (campaign.status !== CAMPAIGN_STATUS.PAUSED) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_CAMPAIGN_STATUS,
        'campaign.status',
        'Campaign status must be PAUSED for V1 setup.',
        'campaign'
      )
    );
  }

  if (campaign.bidding !== BIDDING_STRATEGY.MANUAL_CPC) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_BIDDING,
        'campaign.bidding',
        'Campaign bidding must be manual_cpc for V1 setup.',
        'campaign'
      )
    );
  }

  const budget = campaign.budget ?? {};
  validateRequiredName(
    budget.name,
    MAX_BUDGET_NAME_CHARS,
    'campaign.budget.name',
    ADS_INTENT_CODES.INVALID_BUDGET_NAME,
    'campaign',
    issues
  );

  const amountMicros = Number(budget.amountMicros);
  if (!Number.isFinite(amountMicros) || amountMicros < MIN_DAILY_BUDGET_MICROS) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_BUDGET_AMOUNT,
        'campaign.budget.amountMicros',
        `Daily budget must be at least ${MIN_DAILY_BUDGET_MICROS} micros.`,
        'campaign'
      )
    );
  }

  const network = campaign.networkSettings ?? {};
  if (
    network.targetGoogleSearch !== true ||
    network.targetSearchNetwork !== true ||
    network.targetContentNetwork !== false
  ) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_NETWORK_SETTINGS,
        'campaign.networkSettings',
        'Campaign network settings must target Google Search and Search Network only.',
        'campaign'
      )
    );
  }

  const adGroup = data.adGroup ?? {};
  validateRequiredName(
    adGroup.name,
    MAX_AD_GROUP_NAME_CHARS,
    'adGroup.name',
    ADS_INTENT_CODES.INVALID_AD_GROUP_NAME,
    'ad_group',
    issues
  );

  if (adGroup.type !== AD_GROUP_TYPE.SEARCH_STANDARD) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_AD_GROUP_TYPE,
        'adGroup.type',
        'Ad group type must be SEARCH_STANDARD.',
        'ad_group'
      )
    );
  }

  if (adGroup.status !== CAMPAIGN_STATUS.PAUSED) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_AD_GROUP_STATUS,
        'adGroup.status',
        'Ad group status must be PAUSED for V1 setup.',
        'ad_group'
      )
    );
  }

  const ad = data.ad ?? {};
  const finalUrlRaw = typeof ad.finalUrl === 'string' ? ad.finalUrl : '';
  const urlCheck = validateHttpUrl(finalUrlRaw);
  if (!urlCheck.ok) {
    issues.push(
      issue(
        ADS_INTENT_CODES.INVALID_FINAL_URL,
        'ad.finalUrl',
        urlCheck.message ?? 'Final URL must be a valid http or https URL.',
        'ad'
      )
    );
  }

  const headlines = validateUniqueRsaTexts(
    Array.isArray(ad.headlines) ? ad.headlines : [],
    RSA_MIN_HEADLINES,
    RSA_MAX_HEADLINES,
    RSA_HEADLINE_MAX_CHARS
  );
  if (headlines.length < RSA_MIN_HEADLINES) {
    issues.push(
      issue(
        ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
        'ad.headlines',
        `Responsive search ads require at least ${RSA_MIN_HEADLINES} unique headlines.`,
        'ad'
      )
    );
  } else {
    for (const raw of ad.headlines ?? []) {
      const text = normalizeRsaText(raw, RSA_HEADLINE_MAX_CHARS);
      if (text && text.length > RSA_HEADLINE_MAX_CHARS) {
        issues.push(
          issue(
            ADS_INTENT_CODES.RSA_HEADLINE_LENGTH,
            'ad.headlines',
            `Headlines must be at most ${RSA_HEADLINE_MAX_CHARS} characters.`,
            'ad'
          )
        );
        break;
      }
    }
  }

  const descriptions = validateUniqueRsaTexts(
    Array.isArray(ad.descriptions) ? ad.descriptions : [],
    RSA_MIN_DESCRIPTIONS,
    RSA_MAX_DESCRIPTIONS,
    RSA_DESCRIPTION_MAX_CHARS
  );
  if (descriptions.length < RSA_MIN_DESCRIPTIONS) {
    issues.push(
      issue(
        ADS_INTENT_CODES.RSA_DESCRIPTION_COUNT,
        'ad.descriptions',
        `Responsive search ads require at least ${RSA_MIN_DESCRIPTIONS} unique descriptions.`,
        'ad'
      )
    );
  } else {
    for (const raw of ad.descriptions ?? []) {
      const text = normalizeRsaText(raw, RSA_DESCRIPTION_MAX_CHARS);
      if (text && text.length > RSA_DESCRIPTION_MAX_CHARS) {
        issues.push(
          issue(
            ADS_INTENT_CODES.RSA_DESCRIPTION_LENGTH,
            'ad.descriptions',
            `Descriptions must be at most ${RSA_DESCRIPTION_MAX_CHARS} characters.`,
            'ad'
          )
        );
        break;
      }
    }
  }

  const keywords = Array.isArray(data.keywords) ? data.keywords : [];
  const keywordCompliance = validateKeywordCompliance(keywords);
  if (!keywordCompliance.ok) {
    issues.push(...keywordCompliance.issues);
  }

  const geoLabels = Array.isArray(data.geoTargetLabels)
    ? data.geoTargetLabels.map((label) => String(label ?? '').trim()).filter(Boolean)
    : [];
  if (geoLabels.length < 1) {
    issues.push(
      issue(
        ADS_INTENT_CODES.MISSING_GEO_TARGET_LABELS,
        'geoTargetLabels',
        'At least one service area label is required for geographic targeting.',
        'geo'
      )
    );
  }

  const geoTargets = Array.isArray(data.geoTargets) ? data.geoTargets : [];
  if (geoTargets.length < 1) {
    issues.push(
      issue(
        ADS_INTENT_CODES.UNRESOLVED_GEO,
        'geoTargets',
        'At least one resolved geo target constant is required for geographic targeting.',
        'geo'
      )
    );
  } else {
    for (let index = 0; index < geoTargets.length; index += 1) {
      const row = geoTargets[index];
      const resourceName = String(row?.resourceName ?? '').trim();
      const label = String(row?.label ?? '').trim();

      if (!isValidGeoTargetResourceName(resourceName)) {
        issues.push(
          issue(
            ADS_INTENT_CODES.INVALID_GEO_TARGET,
            `geoTargets[${index}].resourceName`,
            'Geo target resourceName must be a geoTargetConstants/{id} value.',
            'geo'
          )
        );
      }
      if (!label) {
        issues.push(
          issue(
            ADS_INTENT_CODES.INVALID_GEO_TARGET,
            `geoTargets[${index}].label`,
            'Geo target label is required.',
            'geo'
          )
        );
      }
    }
  }

  const conversionIds = Array.isArray(data.selectedConversionIds)
    ? data.selectedConversionIds.map((id) => String(id ?? '').trim()).filter(Boolean)
    : [];
  if (conversionIds.length < 1) {
    issues.push(
      issue(
        ADS_INTENT_CODES.MISSING_CONVERSION_ACTIONS,
        'selectedConversionIds',
        'At least one conversion action is required before campaign creation.',
        'conversions'
      )
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, intent: data };
}

/** @returns {Record<string, { status: string, issues: object[] }>} */
function createEmptyBucketValidation(initialStatus = 'pending') {
  return {
    campaign: { status: initialStatus, issues: [] },
    ad_group: { status: initialStatus, issues: [] },
    ad: { status: initialStatus, issues: [] },
    keywords: { status: initialStatus, issues: [] },
    geo: { status: initialStatus, issues: [] },
    conversions: { status: initialStatus, issues: [] },
  };
}

/**
 * @param {CampaignIntentIssue[]} issues
 * @returns {Record<string, { status: string, issues: object[] }>}
 */
function buildBucketValidationFromIssues(issues) {
  const bucketValidation = createEmptyBucketValidation('pass');

  if (!Array.isArray(issues) || issues.length < 1) {
    return bucketValidation;
  }

  for (const row of issues) {
    const bucket =
      row.bucket ||
      resolveAdsCampaignValidationBucket(row.code) ||
      'campaign';
    if (!bucketValidation[bucket]) {
      continue;
    }
    bucketValidation[bucket].status = 'fail';
    bucketValidation[bucket].issues.push({
      code: row.code,
      field: row.field,
      message: row.message,
      ...(row.rawValue !== undefined ? { rawValue: row.rawValue } : {}),
      ...(row.sanitizedValue !== undefined ? { sanitizedValue: row.sanitizedValue } : {}),
    });
  }

  return bucketValidation;
}

/**
 * @param {{ ok: false, issues: CampaignIntentIssue[] }} result
 */
function formatCampaignIntentSummary(result) {
  if (result.ok || !Array.isArray(result.issues) || result.issues.length < 1) {
    return 'Campaign intent is not valid for Google Ads setup.';
  }
  return result.issues[0].message;
}

/**
 * @param {string | undefined | null} code
 * @returns {'campaign'|'ad_group'|'ad'|'keywords'|'geo'|'conversions'|'readiness'|'preconditions'|'provider'|null}
 */
function resolveAdsCampaignValidationBucket(code) {
  const normalized = String(code ?? '').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('ADS_READINESS_')) {
    return 'readiness';
  }
  if (ADS_INTENT_VALIDATION_BUCKETS[normalized]) {
    return ADS_INTENT_VALIDATION_BUCKETS[normalized];
  }
  if (normalized.startsWith('ADS_INTENT_')) {
    return 'campaign';
  }
  if (normalized.startsWith('GOOGLE_ADS_')) {
    return 'provider';
  }
  if (normalized.startsWith('ADS_')) {
    return 'preconditions';
  }
  return null;
}

/**
 * @param {{ message?: string, code?: string, field?: string, issues?: CampaignIntentIssue[], bucketValidation?: object }} err
 */
function formatAdsCampaignPreconditionDetails(err) {
  const code = String(err?.code ?? 'ADS_PROVIDER_PRECONDITION').trim();
  const message = String(err?.message ?? 'Ads campaign creation failed.').trim();
  const firstIssue = Array.isArray(err?.issues) && err.issues.length > 0 ? err.issues[0] : null;

  return {
    message,
    code,
    validationBucket:
      resolveAdsCampaignValidationBucket(code) ?? firstIssue?.bucket ?? null,
    field: err?.field ?? firstIssue?.field ?? null,
    issues: Array.isArray(err?.issues) ? err.issues : firstIssue ? [firstIssue] : [],
    bucketValidation: err?.bucketValidation ?? null,
  };
}

/**
 * Minimal valid intent for unit tests (client + service).
 *
 * @param {object} [overrides]
 */
function buildMinimalCampaignIntent(overrides = {}) {
  const intent = buildCampaignIntentFromNormalized(
    {
      businessName: 'Test Business',
      websiteUrl: 'https://example.com',
      primaryService: 'Plumbing',
      primaryServiceArea: 'Springfield',
      services: ['Plumbing'],
      serviceAreas: ['Springfield'],
      resolvedPrimaryGoal: 'calls',
      keywordSeeds: ['plumbing Springfield', 'Test Business Springfield', 'plumbing near me'],
      adCopySeeds: {
        headlines: ['Test Business', 'Plumbing in Springfield', 'Get a Free Quote Today'],
        descriptions: [
          'Trusted Plumbing serving Springfield. Contact Test Business today.',
          'Professional Plumbing. Visit our website to learn more.',
        ],
      },
    },
    [{ externalId: '1001' }]
  );

  return {
    ...intent,
    geoTargets: [
      {
        resourceName: 'geoTargetConstants/mock-geo-springfield',
        label: 'Springfield',
        canonicalName: 'Springfield,United States',
        targetType: 'City',
        countryCode: 'US',
      },
    ],
    ...overrides,
    campaign: { ...intent.campaign, ...(overrides.campaign ?? {}) },
    adGroup: { ...intent.adGroup, ...(overrides.adGroup ?? {}) },
    ad: { ...intent.ad, ...(overrides.ad ?? {}) },
  };
}

module.exports = {
  buildKeywordsFromSeeds,
  buildCampaignIntentFromNormalized,
  buildMinimalCampaignIntent,
  createEmptyBucketValidation,
  buildBucketValidationFromIssues,
  validateCampaignIntent,
  formatCampaignIntentSummary,
  resolveAdsCampaignValidationBucket,
  formatAdsCampaignPreconditionDetails,
};
