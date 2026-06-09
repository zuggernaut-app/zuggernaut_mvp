'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('./middleware/requireAuth');
const { requireIntegrationDiagnostics } = require('./middleware/requireIntegrationDiagnostics');
const { assertBusinessAccess } = require('./lib/assertBusinessAccess');
const { isGoogleOAuthProvider } = require('../../constants/googleOAuth');
const { buildGoogleConnectUrl } = require('../../services/integrations/googleOAuthService');
const {
  ensureSandboxBusiness,
  startSandboxScrape,
  getSandboxScrapeRun,
  runProviderSmokeTest,
  getDiagnosticsOverview,
} = require('../../services/dev/integrationDiagnosticsService');
const { getProviderProvisioningState } = require('../../services/capabilities/integrationProvisioningService');
const { CREATION_DIAGNOSTIC_SAFETY } = require('../../lib/dev/creationDiagnosticResults');
const { runGtmCreationDiagnostics } = require('../../services/dev/gtmCreationDiagnosticsService');
const { runGoogleAdsCreationDiagnostics } = require('../../services/dev/googleAdsCreationDiagnosticsService');
const { getIntegrationDiagnosticRun } = require('../../services/dev/integrationDiagnosticRunService');
const {
  GoogleAdsResourceSelectionError,
  listGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
} = require('../../services/dev/googleAdsResourceSelectionService');
const {
  GtmResourceSelectionError,
  listGtmResourceOptions,
  saveGtmSelection,
} = require('../../services/dev/gtmResourceSelectionService');
const {
  parseGoogleAdsSelectionBody,
  parseGtmSelectionBody,
} = require('../../lib/dev/providerResourceSelection');
const {
  runOAuthTrace,
  runMccLinkFlow,
  runReadWriteTests,
  RETURN_PATH: GOOGLE_ADS_OAUTH_LAB_RETURN_PATH,
} = require('../../lib/dev/googleAdsOAuthLab');
const {
  runOAuthTrace: runGtmOAuthTrace,
  runReadWriteTests: runGtmReadWriteTests,
  RETURN_PATH: GTM_OAUTH_LAB_RETURN_PATH,
} = require('../../lib/dev/gtmOAuthLab');
const {
  runOAuthTrace: runGbpOAuthTrace,
  runReadTests: runGbpReadTests,
  RETURN_PATH: GBP_OAUTH_LAB_RETURN_PATH,
} = require('../../lib/dev/gbpOAuthLab');

const router = express.Router();

function parseCreationDiagnosticsBody(body) {
  const businessId = typeof body?.businessId === 'string' ? body.businessId.trim() : '';
  const mode = typeof body?.mode === 'string' ? body.mode.trim() : undefined;
  const confirmCreateExternalResources =
    body?.[CREATION_DIAGNOSTIC_SAFETY.CONFIRM_CREATE_EXTERNAL_RESOURCES_FIELD] === true;
  return { businessId, mode, confirmCreateExternalResources };
}

router.use(requireIntegrationDiagnostics);
router.use(requireAuth);

router.post('/sandbox-business', async (req, res, next) => {
  try {
    const sandbox = await ensureSandboxBusiness(req.user.id);
    return res.status(sandbox.created ? 201 : 200).json(sandbox);
  } catch (err) {
    next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const overview = await getDiagnosticsOverview(access.businessId);
    return res.status(200).json(overview);
  } catch (err) {
    next(err);
  }
});

router.post('/scrape', async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const websiteUrl =
      typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl.trim() : '';

    try {
      const started = await startSandboxScrape(req.user.id, access.businessId, websiteUrl);
      return res.status(202).json(started);
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'validation_error') {
        return res.status(400).json({
          error: 'validation_error',
          message: err.message,
        });
      }
      if (err && typeof err === 'object' && err.code === 'temporal_unavailable') {
        return res.status(503).json({
          error: 'temporal_unavailable',
          message: err.message,
          detail: err.detail,
          ...err.payload,
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.get('/scrape-runs/:scrapeRunId', async (req, res, next) => {
  try {
    const scrapeRunIdRaw =
      typeof req.params.scrapeRunId === 'string' ? req.params.scrapeRunId.trim() : '';
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';

    if (!mongoose.Types.ObjectId.isValid(scrapeRunIdRaw)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid scrapeRunId',
      });
    }

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    try {
      const scrapeRun = await getSandboxScrapeRun(
        req.user.id,
        access.businessId,
        scrapeRunIdRaw,
      );
      return res.status(200).json({ scrapeRun });
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'not_found') {
        return res.status(404).json({
          error: 'not_found',
          message: err.message,
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.get('/google/:provider/connect-url', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (!isGoogleOAuthProvider(provider)) {
      return res.status(400).json({
        error: 'validation_error',
        message: `Unsupported provider: ${provider}`,
      });
    }

    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const returnPathRaw =
      typeof req.query.returnPath === 'string' ? req.query.returnPath.trim() : '';
    const returnPath =
      returnPathRaw.startsWith('/') && !returnPathRaw.startsWith('//')
        ? returnPathRaw
        : '/dev/integrations';

    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider,
      userId: req.user.id,
      returnPath,
    });

    return res.status(200).json({
      provider,
      businessId: access.businessId.toString(),
      url,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/googleads/oauth-trace', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const report = await runOAuthTrace(access.businessId.toString(), req.user.id);
    const status = report.firstFailure ? 409 : 200;
    return res.status(status).json({ result: report });
  } catch (err) {
    next(err);
  }
});

router.post('/googleads/mcc-link', async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const managerCustomerId =
      typeof req.body?.managerCustomerId === 'string' ? req.body.managerCustomerId.trim() : undefined;
    const clientCustomerId =
      typeof req.body?.clientCustomerId === 'string' ? req.body.clientCustomerId.trim() : undefined;
    const sendInvitation = req.body?.sendInvitation === true;
    const acceptLink = req.body?.acceptLink === true;

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runMccLinkFlow(access.businessId.toString(), {
      managerCustomerId,
      clientCustomerId,
      sendInvitation,
      acceptLink,
    });
    const status = result.linkReady ? 200 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    next(err);
  }
});

router.post('/googleads/read-write-test', async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const customerId =
      typeof req.body?.customerId === 'string' ? req.body.customerId.trim() : undefined;
    const managerCustomerId =
      typeof req.body?.managerCustomerId === 'string' ? req.body.managerCustomerId.trim() : undefined;
    const includeCampaign = req.body?.includeCampaign === true;
    const modeRaw = typeof req.body?.mode === 'string' ? req.body.mode.trim() : 'all';
    const mode = modeRaw === 'read' || modeRaw === 'write' ? modeRaw : 'all';

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runReadWriteTests(access.businessId.toString(), {
      customerId,
      managerCustomerId,
      includeCampaign,
      mode,
    });
    const status = result.ok ? 200 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    next(err);
  }
});

router.get('/gtm/oauth-trace', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const report = await runGtmOAuthTrace(access.businessId.toString(), req.user.id);
    const status = report.firstFailure ? 409 : 200;
    return res.status(status).json({ result: report });
  } catch (err) {
    next(err);
  }
});

router.post('/gtm/read-write-test', async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId.trim() : undefined;
    const containerId =
      typeof req.body?.containerId === 'string' ? req.body.containerId.trim() : undefined;
    const workspaceId =
      typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : undefined;
    const modeRaw = typeof req.body?.mode === 'string' ? req.body.mode.trim() : 'all';
    const mode = modeRaw === 'read' || modeRaw === 'write' ? modeRaw : 'all';

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runGtmReadWriteTests(access.businessId.toString(), {
      accountId,
      containerId,
      workspaceId,
      mode,
    });
    const status = result.ok ? 200 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    next(err);
  }
});

router.get('/gtm/connect-url', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider: 'gtm',
      userId: req.user.id,
      returnPath: GTM_OAUTH_LAB_RETURN_PATH,
    });

    return res.status(200).json({
      provider: 'gtm',
      businessId: access.businessId.toString(),
      returnPath: GTM_OAUTH_LAB_RETURN_PATH,
      url,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/gbp/oauth-trace', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const report = await runGbpOAuthTrace(access.businessId.toString(), req.user.id);
    const status = report.firstFailure ? 409 : 200;
    return res.status(status).json({ result: report });
  } catch (err) {
    next(err);
  }
});

router.post('/gbp/read-test', async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const accountName =
      typeof req.body?.accountName === 'string' ? req.body.accountName.trim() : undefined;
    const locationName =
      typeof req.body?.locationName === 'string' ? req.body.locationName.trim() : undefined;

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runGbpReadTests(access.businessId.toString(), {
      accountName,
      locationName,
    });
    const status = result.ok ? 200 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    next(err);
  }
});

router.get('/gbp/connect-url', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider: 'gbp',
      userId: req.user.id,
      returnPath: GBP_OAUTH_LAB_RETURN_PATH,
    });

    return res.status(200).json({
      provider: 'gbp',
      businessId: access.businessId.toString(),
      returnPath: GBP_OAUTH_LAB_RETURN_PATH,
      url,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/googleads/connect-url', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider: 'google_ads',
      userId: req.user.id,
      returnPath: GOOGLE_ADS_OAUTH_LAB_RETURN_PATH,
    });

    return res.status(200).json({
      provider: 'google_ads',
      businessId: access.businessId.toString(),
      returnPath: GOOGLE_ADS_OAUTH_LAB_RETURN_PATH,
      url,
    });
  } catch (err) {
    next(err);
  }
});

// Static paths before /:provider/* so Express never treats e.g. google_ads/create-diagnostics as a provider param.
router.get('/google_ads/resources', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await listGoogleAdsResourceOptions(access.businessId);
    return res.status(200).json({ result });
  } catch (err) {
    if (err instanceof GoogleAdsResourceSelectionError && err.code === 'ADS_NOT_CONNECTED') {
      return res.status(409).json({
        error: 'not_connected',
        message: err.message,
      });
    }
    next(err);
  }
});

router.post('/google_ads/selection', async (req, res, next) => {
  try {
    const { businessId, customerId } = parseGoogleAdsSelectionBody(req.body);
    const access = await assertBusinessAccess(req.user.id, businessId);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await saveGoogleAdsSelection(access.businessId, { customerId });
    return res.status(200).json({ result });
  } catch (err) {
    if (err instanceof GoogleAdsResourceSelectionError) {
      const status =
        err.code === 'ADS_NOT_CONNECTED'
          ? 409
          : err.code === 'ADS_SELECTION_NOT_ACCESSIBLE' || err.code === 'ADS_SELECTION_NOT_ALLOWED'
            ? 409
            : 400;
      return res.status(status).json({
        error: 'validation_error',
        message: err.message,
        code: err.code,
      });
    }
    next(err);
  }
});

router.get('/gtm/resources', async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await listGtmResourceOptions(access.businessId);
    return res.status(200).json({ result });
  } catch (err) {
    if (err instanceof GtmResourceSelectionError && err.code === 'GTM_NOT_CONNECTED') {
      return res.status(409).json({
        error: 'not_connected',
        message: err.message,
      });
    }
    next(err);
  }
});

router.post('/gtm/selection', async (req, res, next) => {
  try {
    const { businessId, accountId, containerId, workspaceId } = parseGtmSelectionBody(req.body);
    const access = await assertBusinessAccess(req.user.id, businessId);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await saveGtmSelection(access.businessId, {
      accountId,
      containerId,
      workspaceId,
    });
    return res.status(200).json({ result });
  } catch (err) {
    if (err instanceof GtmResourceSelectionError) {
      const status =
        err.code === 'GTM_NOT_CONNECTED' || err.code === 'GTM_SELECTION_NOT_ACCESSIBLE' ? 409 : 400;
      return res.status(status).json({
        error: 'validation_error',
        message: err.message,
        code: err.code,
      });
    }
    next(err);
  }
});

router.post('/gtm/create-diagnostics', async (req, res, next) => {
  try {
    const { businessId, mode, confirmCreateExternalResources } = parseCreationDiagnosticsBody(req.body);

    if (!confirmCreateExternalResources) {
      return res.status(400).json({
        error: 'validation_error',
        message: `Set ${CREATION_DIAGNOSTIC_SAFETY.CONFIRM_CREATE_EXTERNAL_RESOURCES_FIELD}=true to create real external GTM resources.`,
      });
    }

    const access = await assertBusinessAccess(req.user.id, businessId);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runGtmCreationDiagnostics(access.businessId, { mode });
    const status = result.ok ? 200 : result.errorCode === 'SELECTION_REQUIRED' ? 409 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    if (err instanceof Error && /Unsupported creation diagnostic mode/.test(err.message)) {
      return res.status(400).json({
        error: 'validation_error',
        message: err.message,
      });
    }
    next(err);
  }
});

router.post('/google_ads/create-diagnostics', async (req, res, next) => {
  try {
    const { businessId, mode, confirmCreateExternalResources } = parseCreationDiagnosticsBody(req.body);

    if (!confirmCreateExternalResources) {
      return res.status(400).json({
        error: 'validation_error',
        message: `Set ${CREATION_DIAGNOSTIC_SAFETY.CONFIRM_CREATE_EXTERNAL_RESOURCES_FIELD}=true to create real external Google Ads resources.`,
      });
    }

    const access = await assertBusinessAccess(req.user.id, businessId);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runGoogleAdsCreationDiagnostics(access.businessId, { mode });
    const status = result.ok ? 200 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    if (err instanceof Error && /Unsupported creation diagnostic mode/.test(err.message)) {
      return res.status(400).json({
        error: 'validation_error',
        message: err.message,
      });
    }
    next(err);
  }
});

router.post('/:provider/smoke-test', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (!isGoogleOAuthProvider(provider)) {
      return res.status(400).json({
        error: 'validation_error',
        message: `Unsupported provider: ${provider}`,
      });
    }

    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await runProviderSmokeTest(access.businessId, provider);
    const status = result.ok ? 200 : 409;
    return res.status(status).json({ result });
  } catch (err) {
    next(err);
  }
});

router.get('/diagnostic-runs/:diagnosticRunId', async (req, res, next) => {
  try {
    const diagnosticRunId =
      typeof req.params.diagnosticRunId === 'string' ? req.params.diagnosticRunId.trim() : '';
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';

    if (!diagnosticRunId) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'diagnosticRunId is required',
      });
    }

    const access = await assertBusinessAccess(req.user.id, businessId);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await getIntegrationDiagnosticRun(access.businessId, diagnosticRunId);
    if (!result) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Diagnostic run not found for this business',
      });
    }

    return res.status(200).json({ result });
  } catch (err) {
    next(err);
  }
});

router.get('/:provider/provisioning-check', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (provider !== 'gtm' && provider !== 'google_ads') {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Provisioning check supports gtm and google_ads only',
      });
    }

    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const state = await getProviderProvisioningState(access.businessId, provider);
    return res.status(200).json({
      businessId: access.businessId.toString(),
      provider,
      provisioningRequired: state.provisioningRequired,
      connection: state.connection,
      activeRequest: state.activeRequest,
      latestRequest: state.latestRequest,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
