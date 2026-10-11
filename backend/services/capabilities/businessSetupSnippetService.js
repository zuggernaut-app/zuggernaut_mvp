'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { ssrfSafeGet, SsrfError } = require('../../lib/ssrf');
const { loadSetupReadyConnection } = require('./setupReadyConnectionService');
const {
  detectSnippetInHtml,
} = require('./structuralVerificationService');
const { SetupReadyConnectionError } = require('./setupReadyConnectionService');

const BusinessContext = mongoose.model('BusinessContext');
const SetupRun = mongoose.model('SetupRun');
const SetupStepExecution = mongoose.model('SetupStepExecution');

class BusinessSetupSnippetError extends Error {
  constructor(message, code = 'BUSINESS_SETUP_SNIPPET_ERROR') {
    super(message);
    this.name = 'BusinessSetupSnippetError';
    this.code = code;
  }
}

/**
 * @param {object | null | undefined} gtmIds
 */
function resolvePublicContainerId(gtmIds) {
  if (!gtmIds || typeof gtmIds !== 'object') return null;
  return gtmIds.publicContainerId ?? gtmIds.containerPublicId ?? gtmIds.gtmId ?? null;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function checkSnippetOnSite(businessId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);

  let gtmReady;
  try {
    gtmReady = await loadSetupReadyConnection(biz, 'gtm');
  } catch (err) {
    if (err instanceof SetupReadyConnectionError) {
      return { status: 'error', message: err.message, code: 'gtm_not_connected' };
    }
    throw err;
  }

  const publicContainerId = resolvePublicContainerId(gtmReady.gtmIds);
  if (!publicContainerId) {
    return {
      status: 'error',
      message: 'Cannot verify GTM snippet without a public container id on the GTM connection.',
      code: 'missing_container_id',
    };
  }

  const bc = await BusinessContext.findOne({ businessId: biz }).lean();
  const websiteUrl = bc?.websiteUrl?.trim() ?? '';
  if (!websiteUrl) {
    return { status: 'error', message: 'No website URL on file.', code: 'no_website' };
  }

  let html;
  try {
    const res = await ssrfSafeGet(websiteUrl);
    html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  } catch (err) {
    const msg =
      err instanceof SsrfError
        ? 'Website could not be fetched for snippet verification.'
        : 'Website could not be opened.';
    return { status: 'error', message: msg, code: 'website_fetch_failed' };
  }

  const onSite = detectSnippetInHtml(html, publicContainerId);
  const verdict = onSite
    ? { status: 'on_site', message: 'On the site', publicContainerId }
    : { status: 'not_on_site', message: 'Not on the site', publicContainerId };

  const latestRun = await SetupRun.findOne({ businessId: biz }).sort({ updatedAt: -1 }).lean();
  if (latestRun?._id) {
    const now = new Date();
    await SetupStepExecution.findOneAndUpdate(
      { setupRunId: latestRun._id, stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION },
      {
        $set: {
          setupRunId: latestRun._id,
          businessId: biz,
          stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
          status: onSite ? 'success' : 'failed',
          endedAt: now,
          lastErrorSummary: onSite ? null : verdict.message,
          provider: 'gtm',
          details: { snippetPresent: onSite, publicContainerId, businessSetupSnippetCheck: true },
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  return verdict;
}

module.exports = {
  BusinessSetupSnippetError,
  checkSnippetOnSite,
};
