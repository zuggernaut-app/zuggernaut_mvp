'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../../lib/observability/logger');
const { callsAllowedForBusiness } = require('./leadCampaignPlanner');
const {
  prepareSignupScrapeForWebsiteUrlChange,
  startSignupScrape,
  LeadCampaignScrapeError,
} = require('./leadCampaignScrapeService');
const { normalizeStartUrl } = require('../scraper/staticScraper');
const { validateHttpUrl } = require('../../lib/validation');
const { SCRAPE_TERMINAL_STATUSES } = require('../../constants/onboarding');

const BusinessContext = mongoose.model('BusinessContext');
const ScrapeRun = mongoose.model('ScrapeRun');
const User = mongoose.model('User');

const logger = createLogger({ name: 'operatorCallWorkflow' });

class OperatorCallWorkflowError extends Error {
  constructor(message, code = 'operator_call_workflow_error') {
    super(message);
    this.name = 'OperatorCallWorkflowError';
    this.code = code;
  }
}

function emptyWorkflow() {
  return {
    beforeCall: {},
    call: {},
    afterCall: {},
    needsOperatorFollowUp: false,
    operatorFollowUpClearedNote: null,
    awaitingTestLead: false,
    snippetPending: false,
    finishedAt: null,
    stepSavedAt: {},
  };
}

function getWorkflow(doc) {
  if (doc.operatorCallWorkflow && typeof doc.operatorCallWorkflow === 'object') {
    return doc.operatorCallWorkflow;
  }
  return emptyWorkflow();
}

/**
 * @param {import('mongoose').Document} doc
 * @param {object} wf
 */
function setOperatorCallWorkflow(doc, wf) {
  doc.operatorCallWorkflow = JSON.parse(JSON.stringify(wf));
  doc.markModified('operatorCallWorkflow');
}

/**
 * @param {object | null | undefined} doc
 * @returns {string}
 */
function resolveOperatorListStatus(doc) {
  if (!doc) return 'signup_not_finished';
  if (!doc.signupCompletedAt) return 'signup_not_finished';

  const wf = getWorkflow(doc);
  if (wf.finishedAt) return 'finished';
  if (wf.needsOperatorFollowUp) return 'needs_operator_follow_up';
  if (wf.snippetPending) return 'snippet_pending';
  if (wf.awaitingTestLead) return 'awaiting_test_lead';
  return 'signup_complete';
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function loadBusinessForOperator(businessId) {
  const bid = new mongoose.Types.ObjectId(businessId);
  const doc = await BusinessContext.findOne({ businessId: bid });
  if (!doc) {
    throw new OperatorCallWorkflowError('Business not found.', 'not_found');
  }
  return doc;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
function pagesFromRawScrapeRun(bc, scrapeRunId) {
  const runs =
    bc?.rawScrapeOutput && Array.isArray(bc.rawScrapeOutput.runs) ? bc.rawScrapeOutput.runs : [];
  const sid = String(scrapeRunId);
  let latestPages = [];
  for (const row of runs) {
    if (!row || typeof row !== 'object') continue;
    if (row.scrapeRunId && String(row.scrapeRunId) !== sid) continue;
    const pages = Array.isArray(row.pages) ? row.pages : [];
    if (pages.length > 0) latestPages = pages;
  }
  return latestPages;
}

async function getSignupScrapePreview(businessId) {
  const bid = new mongoose.Types.ObjectId(businessId);
  const scrapeRun = await ScrapeRun.findOne({ businessId: bid, purpose: 'signup' })
    .sort({ updatedAt: -1 })
    .lean();
  if (!scrapeRun) {
    return { fetched: false, pages: [], fetchedAt: null, homepageGtmPublicId: null, status: null };
  }
  const bc = await BusinessContext.findOne({ businessId: bid })
    .select('+rawScrapeOutput websiteUrl')
    .lean();
  const businessUrl =
    typeof bc?.websiteUrl === 'string' && bc.websiteUrl.trim() ? normalizeStartUrl(bc.websiteUrl) : '';
  const scrapeUrl =
    typeof scrapeRun.websiteUrl === 'string' && scrapeRun.websiteUrl.trim()
      ? normalizeStartUrl(scrapeRun.websiteUrl)
      : '';
  if (!businessUrl && scrapeUrl) {
    return {
      fetched: false,
      pages: [],
      fetchedAt: null,
      homepageGtmPublicId: null,
      status: scrapeRun.status,
      websiteUrl: scrapeRun.websiteUrl ?? null,
    };
  }
  if (businessUrl && scrapeUrl && businessUrl !== scrapeUrl) {
    return {
      fetched: false,
      pages: [],
      fetchedAt: null,
      homepageGtmPublicId: null,
      status: scrapeRun.status,
      websiteUrl: scrapeRun.websiteUrl ?? null,
    };
  }
  const pages = pagesFromRawScrapeRun(bc, scrapeRun._id);
  let homepageGtmPublicId = null;
  for (const p of pages) {
    if (p && typeof p.homepageGtmPublicId === 'string' && p.homepageGtmPublicId.trim()) {
      homepageGtmPublicId = p.homepageGtmPublicId.trim();
      break;
    }
  }
  const terminal = SCRAPE_TERMINAL_STATUSES.includes(String(scrapeRun.status));
  const fetched = terminal && pages.length > 0;
  return {
    fetched,
    pages: pages.map((p) => ({
      url: p?.url ?? null,
      title: p?.title ?? null,
      textPreview: typeof p?.text === 'string' ? p.text.slice(0, 500) : null,
      homepageGtmPublicId: p?.homepageGtmPublicId ?? null,
    })),
    fetchedAt: scrapeRun.persistedAt ?? scrapeRun.updatedAt ?? null,
    homepageGtmPublicId,
    status: scrapeRun.status,
    websiteUrl: scrapeRun.websiteUrl ?? null,
  };
}

async function clearSignupScrapeRawForBusiness(businessId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);
  const scrapeRun = await ScrapeRun.findOne({ businessId: biz, purpose: 'signup' })
    .select('_id')
    .lean();
  if (!scrapeRun) return;
  const doc = await BusinessContext.findOne({ businessId: biz }).select('+rawScrapeOutput');
  if (!doc?.rawScrapeOutput || !Array.isArray(doc.rawScrapeOutput.runs)) return;
  const sid = String(scrapeRun._id);
  const filtered = doc.rawScrapeOutput.runs.filter(
    (row) => !row || String(row.scrapeRunId) !== sid,
  );
  if (filtered.length === doc.rawScrapeOutput.runs.length) return;
  doc.rawScrapeOutput = { ...doc.rawScrapeOutput, runs: filtered };
  doc.markModified('rawScrapeOutput');
  await doc.save();
}

async function discardSignupScrapePreviewForWebsiteChange(businessId, previous, next) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);
  if (previous) {
    await prepareSignupScrapeForWebsiteUrlChange({
      businessId: biz,
      previousWebsiteUrl: previous,
      nextWebsiteUrl: next,
    });
  }
  await clearSignupScrapeRawForBusiness(biz);
  await ScrapeRun.updateOne(
    { businessId: biz, purpose: 'signup' },
    { $set: { resultSuggested: null } }
  );
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function getOperatorCallContext(businessId) {
  const doc = await loadBusinessForOperator(businessId);
  const user = await User.findById(doc.userId).select('email').lean();
  const scrape = await getSignupScrapePreview(businessId);
  const wf = getWorkflow(doc);
  return {
    businessId: doc.businessId.toString(),
    userId: doc.userId.toString(),
    customerEmail: user?.email ?? null,
    operatorListStatus: resolveOperatorListStatus(doc),
    signupCompletedAt: doc.signupCompletedAt ?? null,
    businessName: doc.businessName ?? null,
    businessCountry: doc.businessCountry ?? null,
    accountCurrencyCode: doc.accountCurrencyCode ?? null,
    accountTimeZone: doc.accountTimeZone ?? null,
    websiteUrl: doc.websiteUrl ?? null,
    services: doc.services ?? [],
    serviceAreas: doc.serviceAreas ?? [],
    whoBuysToday: doc.whoBuysToday ?? null,
    howBuyersContact: doc.howBuyersContact ?? null,
    orderValueHint: doc.orderValueHint ?? null,
    goals: doc.goals ?? null,
    managedAdsAccountConsentAt: doc.managedAdsAccountConsentAt ?? null,
    operatorCallWorkflow: wf,
    signupScrape: scrape,
    callsAllowed: callsAllowedForBusiness(doc),
  };
}

function markStepSaved(wf, stepKey) {
  if (!wf.stepSavedAt || typeof wf.stepSavedAt !== 'object') {
    wf.stepSavedAt = {};
  }
  wf.stepSavedAt[stepKey] = new Date().toISOString();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveBeforePageSource(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  const home =
    typeof body.pageSourceHome === 'string' ? body.pageSourceHome : '';
  const other =
    typeof body.pageSourceOther === 'string' ? body.pageSourceOther : '';
  wf.beforeCall = { ...wf.beforeCall, pageSourceHome: home, pageSourceOther: other };
  markStepSaved(wf, 'before_page_source');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveCallAccountSettings(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const currency =
    typeof body.accountCurrencyCode === 'string'
      ? body.accountCurrencyCode.trim().toUpperCase()
      : '';
  const timeZone =
    typeof body.accountTimeZone === 'string' ? body.accountTimeZone.trim() : '';
  const country =
    typeof body.businessCountry === 'string' ? body.businessCountry.trim().toUpperCase() : '';
  const allowed = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD'];
  if (!allowed.includes(currency)) {
    throw new OperatorCallWorkflowError('Invalid account currency.', 'validation_error');
  }
  if (!timeZone) {
    throw new OperatorCallWorkflowError('accountTimeZone is required.', 'validation_error');
  }
  doc.accountCurrencyCode = currency;
  doc.accountTimeZone = timeZone;
  if (country) doc.businessCountry = country.slice(0, 2);
  const wf = getWorkflow(doc);
  markStepSaved(wf, 'call_account_settings');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveCallBusinessAnswers(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const setIfString = (field, key) => {
    if (typeof body[key] === 'string' && body[key].trim()) {
      doc[field] = body[key].trim();
    }
  };
  if (Array.isArray(body.services)) {
    doc.services = body.services.map((s) => String(s ?? '').trim()).filter(Boolean);
  } else if (typeof body.services === 'string' && body.services.trim()) {
    doc.services = body.services
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(body.serviceAreas)) {
    doc.serviceAreas = body.serviceAreas.map((s) => String(s ?? '').trim()).filter(Boolean);
  } else if (typeof body.serviceAreas === 'string' && body.serviceAreas.trim()) {
    doc.serviceAreas = body.serviceAreas
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  setIfString('whoBuysToday', 'whoBuysToday');
  setIfString('howBuyersContact', 'howBuyersContact');
  const wf = getWorkflow(doc);
  if (body.orderValueUnknown === true) {
    doc.orderValueHint = '';
    wf.needsOperatorFollowUp = true;
  } else {
    setIfString('orderValueHint', 'orderValueHint');
  }
  markStepSaved(wf, 'call_business_answers');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveCallWebsite(businessId, body, triggerFetch) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  const noWebsite = body.noWebsite === true;
  if (noWebsite) {
    doc.websiteUrl = undefined;
    wf.call = { ...wf.call, noWebsite: true, websiteChangedOnCall: false };
    markStepSaved(wf, 'call_website');
    setOperatorCallWorkflow(doc, wf);
    await doc.save();
    await clearSignupScrapeRawForBusiness(doc.businessId);
    await ScrapeRun.updateOne(
      { businessId: doc.businessId, purpose: 'signup' },
      { $set: { resultSuggested: null } },
    );
    return getOperatorCallContext(businessId);
  }
  const websiteRaw = typeof body.websiteUrl === 'string' ? body.websiteUrl.trim() : '';
  if (!websiteRaw) {
    throw new OperatorCallWorkflowError('websiteUrl is required unless noWebsite.', 'validation_error');
  }
  const urlCheck = validateHttpUrl(websiteRaw);
  if (!urlCheck.ok) {
    throw new OperatorCallWorkflowError(urlCheck.message, 'validation_error');
  }
  const normalized = normalizeStartUrl(urlCheck.value);
  const previous =
    typeof doc.websiteUrl === 'string' && doc.websiteUrl.trim()
      ? normalizeStartUrl(doc.websiteUrl)
      : '';
  const changed = previous !== normalized;
  doc.websiteUrl = normalized;
  wf.call = {
    ...wf.call,
    noWebsite: false,
    websiteChangedOnCall: changed || !previous,
    ctaNote: typeof body.ctaNote === 'string' ? body.ctaNote : wf.call?.ctaNote,
  };
  markStepSaved(wf, 'call_website');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();

  if (changed) {
    await discardSignupScrapePreviewForWebsiteChange(doc.businessId, previous, normalized);
  }

  if (triggerFetch) {
    try {
      if (previous && changed) {
        await prepareSignupScrapeForWebsiteUrlChange({
          businessId: doc.businessId,
          previousWebsiteUrl: previous,
          nextWebsiteUrl: normalized,
        });
      }
      await startSignupScrape(doc.businessId, doc.userId, normalized);
    } catch (err) {
      logger.warn(
        { businessId: String(businessId), errMessage: err?.message },
        'operator_call_website_scrape_start_failed',
      );
      if (err instanceof LeadCampaignScrapeError) {
        throw new OperatorCallWorkflowError(err.message, err.code);
      }
      throw err;
    }
  }
  return getOperatorCallContext(businessId);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveCallGoalChoice(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const primary = String(body.primary ?? '').toLowerCase();
  if (!['calls', 'forms', 'both'].includes(primary)) {
    throw new OperatorCallWorkflowError('primary must be calls, forms, or both.', 'validation_error');
  }
  if ((primary === 'calls' || primary === 'both') && !callsAllowedForBusiness(doc)) {
    throw new OperatorCallWorkflowError(
      'Calls are not offered for this business country.',
      'validation_error',
    );
  }
  doc.goals = { ...(doc.goals && typeof doc.goals === 'object' ? doc.goals : {}), primary };
  const wf = getWorkflow(doc);
  wf.call = { ...wf.call, goalPrimary: primary, noFormAd: body.noFormAd === true };
  markStepSaved(wf, 'call_goal_choice');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveCallPermission(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  if (body.useOwnAccount === true) {
    const billingOk = body.ownAccountBillingOk === true;
    const currencyMatch = body.ownAccountCurrencyMatch === true;
    wf.call = {
      ...wf.call,
      useOwnAccount: true,
      managerLinkAccepted: body.managerLinkAccepted === true,
      ownAccountBillingOk: billingOk,
      ownAccountCurrencyMatch: currencyMatch,
    };
    wf.needsOperatorFollowUp = !billingOk || !currencyMatch;
    markStepSaved(wf, 'call_permission');
    setOperatorCallWorkflow(doc, wf);
    await doc.save();
    return getOperatorCallContext(businessId);
  }
  if (body.managedConsent !== true) {
    throw new OperatorCallWorkflowError('managedConsent must be true.', 'validation_error');
  }
  doc.managedAdsAccountConsentAt = new Date();
  wf.call = { ...wf.call, useOwnAccount: false, managedConsent: true };
  markStepSaved(wf, 'call_permission');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} body
 */
async function saveCallSnippetNew(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  if (body.notApplicable === true) {
    wf.call = { ...wf.call, snippetBranch: 'not_applicable' };
    wf.snippetPending = false;
    markStepSaved(wf, 'call_snippet_new');
    setOperatorCallWorkflow(doc, wf);
    await doc.save();
    return getOperatorCallContext(businessId);
  }
  if (body.snippetPending === true) {
    wf.snippetPending = true;
    wf.call = { ...wf.call, snippetBranch: 'pending', snippetInstalledAt: null };
    markStepSaved(wf, 'call_snippet_new');
    setOperatorCallWorkflow(doc, wf);
    await doc.save();
    return getOperatorCallContext(businessId);
  }
  if (body.snippetInstalled === true) {
    wf.snippetPending = false;
    wf.call = {
      ...wf.call,
      snippetBranch: 'new_container',
      snippetInstalledAt: new Date().toISOString(),
    };
    markStepSaved(wf, 'call_snippet_new');
    setOperatorCallWorkflow(doc, wf);
    await doc.save();
    return getOperatorCallContext(businessId);
  }
  throw new OperatorCallWorkflowError('Invalid snippet save payload.', 'validation_error');
}

async function saveCallSnippetExistingGtm(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  const publishAccess = body.publishAccessGranted === true;
  wf.call = {
    ...wf.call,
    snippetBranch: 'existing_gtm',
    publishAccessGranted: publishAccess,
    noFormAd: !publishAccess,
  };
  if (!publishAccess && (doc.goals?.primary === 'forms' || doc.goals?.primary === 'both')) {
    wf.call.noFormAd = true;
  }
  if (body.snippetInstalled === true) {
    wf.snippetPending = false;
    wf.call.snippetInstalledAt = new Date().toISOString();
  }
  markStepSaved(wf, 'call_snippet_existing_gtm');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return tryMarkFinished(businessId);
}

async function saveCallSnippetPasted(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  wf.call = {
    ...wf.call,
    snippetBranch: 'pasted_code',
    noFormAd: body.noFormAd === true,
    pastedCodeRemoved:
      typeof body.pastedCodeRemoved === 'string' ? body.pastedCodeRemoved : null,
    existingConversionId:
      typeof body.existingConversionId === 'string' ? body.existingConversionId : null,
    existingConversionLabel:
      typeof body.existingConversionLabel === 'string' ? body.existingConversionLabel : null,
  };
  markStepSaved(wf, 'call_snippet_pasted');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

async function saveCallClose(businessId) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  markStepSaved(wf, 'call_close');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return tryMarkFinished(businessId);
}

async function saveAfterPageSource(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  if (body.skipped === true) {
    wf.afterCall = { ...wf.afterCall, pageSourceSkipped: true };
  } else {
    wf.afterCall = {
      ...wf.afterCall,
      pageSourceHome: typeof body.pageSourceHome === 'string' ? body.pageSourceHome : '',
      pageSourceOther: typeof body.pageSourceOther === 'string' ? body.pageSourceOther : '',
    };
  }
  markStepSaved(wf, 'after_page_source');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return tryMarkFinished(businessId);
}

async function saveAfterFormResult(businessId, body) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  wf.afterCall = {
    ...wf.afterCall,
    formAfterSubmit:
      typeof body.formAfterSubmit === 'string' ? body.formAfterSubmit : null,
    tagTrigger: typeof body.tagTrigger === 'string' ? body.tagTrigger : null,
    noFormAd: body.noFormAd === true,
  };
  if (body.noFormAd !== true) {
    wf.awaitingTestLead = true;
  }
  markStepSaved(wf, 'after_form_result');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return tryMarkFinished(businessId);
}

async function saveAfterTestLeadPassed(businessId) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  wf.awaitingTestLead = false;
  wf.afterCall = { ...wf.afterCall, testLeadPassedAt: new Date().toISOString() };
  markStepSaved(wf, 'after_test_lead_passed');
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return tryMarkFinished(businessId);
}

/**
 * @param {object} wf
 * @param {object} doc
 */
function isOperatorWorkflowComplete(wf, doc) {
  if (!wf.stepSavedAt?.call_close) return false;
  if (wf.awaitingTestLead) return false;
  const primary = String(doc.goals?.primary ?? '').toLowerCase();
  if ((primary === 'forms' || primary === 'both') && !wf.stepSavedAt?.after_form_result) {
    return false;
  }
  if (primary === 'forms' || primary === 'both') {
    if (wf.afterCall?.noFormAd !== true && !wf.stepSavedAt?.after_test_lead_passed) {
      return false;
    }
  }
  if (wf.call?.websiteChangedOnCall && typeof doc.websiteUrl === 'string' && doc.websiteUrl.trim()) {
    if (!wf.stepSavedAt?.after_page_source) return false;
  }
  return true;
}

/**
 * @param {object} wf
 * @returns {boolean}
 */
function isSnippetReadyForFinished(wf) {
  if (wf.call?.snippetBranch === 'not_applicable') return false;
  if (wf.call?.snippetBranch === 'pending' || wf.snippetPending) return false;
  return Boolean(wf.call?.snippetInstalledAt);
}

/**
 * Set finished only when the operator workflow is complete and the snippet step is satisfied.
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function tryMarkFinished(businessId) {
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  if (wf.finishedAt) {
    return getOperatorCallContext(businessId);
  }
  if (isSnippetReadyForFinished(wf) && isOperatorWorkflowComplete(wf, doc)) {
    wf.finishedAt = new Date().toISOString();
    setOperatorCallWorkflow(doc, wf);
    await doc.save();
  }
  return getOperatorCallContext(businessId);
}

async function clearOperatorFollowUp(businessId, note) {
  const clearedNote = typeof note === 'string' ? note.trim() : '';
  if (!clearedNote) {
    throw new OperatorCallWorkflowError('A one-line note is required.', 'validation_error');
  }
  const doc = await loadBusinessForOperator(businessId);
  const wf = getWorkflow(doc);
  if (!wf.needsOperatorFollowUp) {
    throw new OperatorCallWorkflowError('No operator follow-up is open.', 'validation_error');
  }
  wf.needsOperatorFollowUp = false;
  wf.operatorFollowUpClearedNote = clearedNote;
  setOperatorCallWorkflow(doc, wf);
  await doc.save();
  return getOperatorCallContext(businessId);
}

module.exports = {
  OperatorCallWorkflowError,
  resolveOperatorListStatus,
  getOperatorCallContext,
  saveBeforePageSource,
  saveCallAccountSettings,
  saveCallBusinessAnswers,
  saveCallWebsite,
  saveCallGoalChoice,
  saveCallPermission,
  saveCallSnippetNew,
  saveCallSnippetExistingGtm,
  saveCallSnippetPasted,
  saveCallClose,
  saveAfterPageSource,
  saveAfterFormResult,
  saveAfterTestLeadPassed,
  tryMarkFinished,
  clearOperatorFollowUp,
};
