'use strict';

const mongoose = require('mongoose');
const { PROVIDERS } = require('../../constants/enums');
const ScrapeRun = mongoose.model('ScrapeRun');
const { validateHttpUrl } = require('../../lib/validation');
const { getTemporalClient } = require('../../lib/temporalClient');
const {
  SCRAPE_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../../constants/temporalDefaults');

const TERMINAL_SCRAPE_STATUSES = new Set(['SUCCEEDED', 'PARTIAL', 'BLOCKED', 'FAILED']);
const {
  getAllConnectionStatuses,
  getConnectionStatus,
} = require('../capabilities/integrationConnectionService');
const { getProvisioningOverview } = require('../capabilities/integrationProvisioningService');
const { discoverProviderConnection } = require('../integrations/providerDiscoveryService');
const { getFreshGoogleAccessToken } = require('../integrations/googleTokenService');
const { getGoogleAdsApiVersion } = require('../integrations/googleAdsApiConfig');
const { runGoogleAdsDiagnostics } = require('./googleAdsDiagnosticsService');
const { sanitizeIdentifiers } = require('./diagnosticsSanitizers');

const BusinessContext = mongoose.model('BusinessContext');
const User = mongoose.model('User');

const SANDBOX_BUSINESS_NAME = 'Integration Diagnostics Sandbox';

/**
 * @param {import('mongoose').Types.ObjectId | string} userId
 */
async function ensureSandboxBusiness(userId) {
  const uid = new mongoose.Types.ObjectId(userId);

  let bc = await BusinessContext.findOne({
    userId: uid,
    businessName: SANDBOX_BUSINESS_NAME,
  }).lean();

  if (bc) {
    return {
      businessId: bc.businessId.toString(),
      created: false,
      businessName: bc.businessName,
      confirmedAt: bc.confirmedAt ?? null,
    };
  }

  const created = await BusinessContext.create({
    userId: uid,
    businessName: SANDBOX_BUSINESS_NAME,
    industry: 'Diagnostics',
    websiteUrl: 'https://example.com',
    serviceAreas: ['Test'],
    confirmedAt: new Date(),
  });

  await User.findOneAndUpdate(
    {
      _id: uid,
      $or: [{ primaryBusinessId: { $exists: false } }, { primaryBusinessId: null }],
    },
    { $set: { primaryBusinessId: created.businessId } },
  );

  return {
    businessId: created.businessId.toString(),
    created: true,
    businessName: created.businessName,
    confirmedAt: created.confirmedAt,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 */
async function runProviderSmokeTest(businessId, provider) {
  const startedAt = new Date().toISOString();

  const status = await getConnectionStatus(businessId, provider, { attemptRefresh: true });
  if (!status.ready && status.reason !== 'ok') {
    if (
      status.reason === 'missing_connection' ||
      status.reason === 'not_connected' ||
      status.reason === 'needs_reauth' ||
      status.reason === 'token_expired' ||
      status.reason === 'insufficient_scopes'
    ) {
      return {
        provider,
        ok: false,
        startedAt,
        errorCode: status.reason.toUpperCase(),
        message: `Connect ${provider} before running smoke test.`,
        connection: status,
      };
    }
  }

  try {
    if (provider === 'google_ads') {
      return runGoogleAdsDiagnostics(businessId);
    }

    const accessToken = await getFreshGoogleAccessToken({ businessId, provider });
    const discovery = await discoverProviderConnection(provider, accessToken);

    const discoveryOk =
      discovery.connectionHealth === 'connected' ||
      discovery.connectionHealth === 'provisioning_required' ||
      discovery.connectionHealth === 'selection_required';

    return {
      provider,
      ok: discoveryOk,
      startedAt,
      apiVersion: provider === 'google_ads' ? getGoogleAdsApiVersion() : null,
      connectionHealth: discovery.connectionHealth,
      discoveryReason: discovery.reason ?? null,
      providerIdentifiers: sanitizeIdentifiers(discovery.providerIdentifiers),
      ...(discoveryOk
        ? {}
        : {
            errorCode: discovery.providerIdentifiers?.discoveryError ?? 'DISCOVERY_FAILED',
            message: 'Provider discovery did not return a usable connection state.',
          }),
    };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'SMOKE_TEST_FAILED';
    const message = err instanceof Error ? err.message : 'Smoke test failed';
    return {
      provider,
      ok: false,
      startedAt,
      errorCode: code,
      message,
    };
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
/**
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} websiteUrl
 */
async function startSandboxScrape(userId, businessId, websiteUrl) {
  const urlCheck = validateHttpUrl(typeof websiteUrl === 'string' ? websiteUrl : '');
  if (!urlCheck.ok) {
    const err = new Error(urlCheck.message);
    err.code = 'validation_error';
    throw err;
  }

  const uid = new mongoose.Types.ObjectId(userId);
  const bid = new mongoose.Types.ObjectId(businessId);

  const doc = await BusinessContext.findOne({
    businessId: bid,
    userId: uid,
  });

  if (!doc) {
    const err = new Error('Business context not found for this user');
    err.code = 'not_found';
    throw err;
  }

  doc.websiteUrl = urlCheck.value;
  await doc.save();

  const scrapeRun = await ScrapeRun.create({
    businessId: doc.businessId,
    userId: uid,
    websiteUrl: urlCheck.value,
    status: 'QUEUED',
  });

  const workflowId = `scrape-${scrapeRun._id.toString()}`;
  const taskQueue = resolveTemporalTaskQueue();
  const startedAt = new Date().toISOString();

  try {
    const client = await getTemporalClient();
    await client.workflow.start(SCRAPE_WORKFLOW_NAME, {
      taskQueue,
      workflowId,
      args: [
        {
          scrapeRunId: scrapeRun._id.toString(),
          businessId: doc.businessId.toString(),
          userId: uid.toString(),
          websiteUrl: urlCheck.value,
          startedAt,
        },
      ],
    });

    scrapeRun.temporalWorkflowId = workflowId;
    scrapeRun.status = 'RUNNING';
    await scrapeRun.save();

    return {
      businessId: doc.businessId.toString(),
      websiteUrl: urlCheck.value,
      scrapeRunId: scrapeRun._id.toString(),
      workflowId,
      status: scrapeRun.status,
    };
  } catch (err) {
    scrapeRun.status = 'FAILED';
    scrapeRun.lastErrorSummary =
      typeof err?.message === 'string' ? err.message : 'Temporal workflow start failed';
    await scrapeRun.save();

    const temporalErr = new Error(
      'Scrape was queued but Temporal workflow could not be started. Check Temporal address and worker.',
    );
    temporalErr.code = 'temporal_unavailable';
    temporalErr.detail = scrapeRun.lastErrorSummary;
    temporalErr.payload = {
      businessId: doc.businessId.toString(),
      websiteUrl: urlCheck.value,
      scrapeRunId: scrapeRun._id.toString(),
      workflowId: null,
      status: scrapeRun.status,
    };
    throw temporalErr;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} scrapeRunId
 */
async function getSandboxScrapeRun(userId, businessId, scrapeRunId) {
  const uid = new mongoose.Types.ObjectId(userId);
  const bid = new mongoose.Types.ObjectId(businessId);
  const rid = new mongoose.Types.ObjectId(scrapeRunId);

  const owns = await BusinessContext.exists({
    businessId: bid,
    userId: uid,
  });
  if (!owns) {
    const err = new Error('Business context not found for this user');
    err.code = 'not_found';
    throw err;
  }

  const scrapeRun = await ScrapeRun.findOne({
    _id: rid,
    businessId: bid,
    userId: uid,
  }).lean();
  if (!scrapeRun) {
    const err = new Error('Scrape run not found');
    err.code = 'not_found';
    throw err;
  }

  const terminal = TERMINAL_SCRAPE_STATUSES.has(scrapeRun.status);
  const suggested =
    terminal && scrapeRun.resultSuggested && typeof scrapeRun.resultSuggested === 'object'
      ? scrapeRun.resultSuggested
      : null;

  return {
    id: scrapeRun._id.toString(),
    businessId: scrapeRun.businessId.toString(),
    websiteUrl: scrapeRun.websiteUrl,
    temporalWorkflowId: scrapeRun.temporalWorkflowId ?? null,
    status: scrapeRun.status,
    lastErrorSummary: scrapeRun.lastErrorSummary ?? null,
    suggested,
    createdAt: scrapeRun.createdAt,
    updatedAt: scrapeRun.updatedAt,
  };
}

async function getDiagnosticsOverview(businessId) {
  const connections = await getAllConnectionStatuses(businessId, PROVIDERS);
  const provisioning = await getProvisioningOverview(businessId);

  const sanitizedConnections = {};
  for (const [key, value] of Object.entries(connections)) {
    sanitizedConnections[key] = {
      ...value,
      providerIdentifiers: sanitizeIdentifiers(value.providerIdentifiers),
    };
  }

  return {
    businessId: businessId.toString(),
    connections: sanitizedConnections,
    provisioning,
    environment: {
      googleOAuthMock: process.env.GOOGLE_OAUTH_MOCK === 'true',
      gtmApiMock: process.env.GTM_API_MOCK === 'true',
      googleAdsApiMock: process.env.GOOGLE_ADS_API_MOCK === 'true',
      gbpApiMock: process.env.GBP_API_MOCK === 'true',
      gtmApiEnabled: process.env.GTM_API_ENABLED === 'true',
      googleAdsApiEnabled: process.env.GOOGLE_ADS_API_ENABLED === 'true',
      googleAdsApiVersion: getGoogleAdsApiVersion(),
      gbpApiEnabled: process.env.GBP_API_ENABLED === 'true',
    },
  };
}

module.exports = {
  SANDBOX_BUSINESS_NAME,
  TERMINAL_SCRAPE_STATUSES,
  ensureSandboxBusiness,
  startSandboxScrape,
  getSandboxScrapeRun,
  runProviderSmokeTest,
  getDiagnosticsOverview,
};
