'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('./middleware/requireAuth');
const { assertBusinessAccess } = require('./lib/assertBusinessAccess');
const { assertProviderSelectionNotLocked } = require('./lib/assertProviderSelectionLocked');
const { isGoogleOAuthProvider } = require('../../constants/googleOAuth');
const {
  buildGoogleConnectUrl,
  verifyOAuthState,
  completeGoogleOAuthCallback,
  buildFrontendRedirectUrl,
  rediscoverConnectedIntegrations,
} = require('../../services/integrations/googleOAuthService');
const { getAllConnectionStatuses } = require('../../services/capabilities/integrationConnectionService');
const {
  listGtmResourceOptions,
  listGtmAccountsOnly,
  saveGtmSelection,
  saveGtmAccountOnlySelection,
  GtmResourceSelectionError,
} = require('../../services/integrations/gtmResourceSelectionService');
const {
  listGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
  saveGoogleAdsProvisioningIntent,
  GoogleAdsResourceSelectionError,
} = require('../../services/integrations/googleAdsResourceSelectionService');
const {
  parseGtmSelectionBody,
  parseGoogleAdsSelectionBody,
} = require('../../services/integrations/providerResourceSelection');
const {
  GoogleAdsMccLinkError,
  refreshMccLinkStatus,
  ensureMccLinkInvited,
  acceptMccLinkIfAllowed,
  getMccLinkManualAcceptInstructions,
} = require('../../services/capabilities/googleAdsMccLinkService');
const { GoogleAdsAccountError, GoogleAdsApiError } = require('../../services/integrations/googleAdsApiConfig');
const {
  AdsCampaignManagementError,
  getCampaignForBusiness,
  enableCampaignForBusiness,
  pauseCampaignForBusiness,
  updateBudgetForBusiness,
  mapManagementError,
} = require('../../services/capabilities/adsCampaignManagementService');
const {
  getCampaignPerformanceForBusiness,
  mapPerformanceRouteError,
} = require('../../services/reports/adsPerformanceService');
const { executeGbpWrite, GbpWriteError } = require('../../services/capabilities/gbpWriteService');
const {
  buildMetaConnectUrl,
  getMetaAdsStatus,
} = require('../../services/integrations/metaOAuthClient');
const { runMetaSetup } = require('../../services/capabilities/metaSetupService');
const {
  assertActivePlan,
  SubscriptionGateError,
} = require('../../services/billing/subscriptionGate');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const {
  ProviderResourceExclusiveError,
} = require('../../lib/providerResourceExclusivity');

const router = express.Router();

function mapSelectionError(err, res) {
  if (err instanceof ProviderResourceExclusiveError) {
    return res.status(409).json({
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof GtmResourceSelectionError || err instanceof GoogleAdsResourceSelectionError) {
    const statusByCode = {
      GTM_NOT_CONNECTED: 409,
      ADS_NOT_CONNECTED: 409,
      GTM_SELECTION_NOT_ACCESSIBLE: 400,
      ADS_SELECTION_NOT_ACCESSIBLE: 400,
      ADS_SELECTION_NOT_ALLOWED: 400,
      GTM_SELECTION_INVALID: 400,
      ADS_SELECTION_INVALID: 400,
    };
    const status = statusByCode[err.code] ?? 400;
    return res.status(status).json({
      error: err.code,
      message: err.message,
    });
  }
  return null;
}

function mapMccLinkError(err, res) {
  if (err instanceof GoogleAdsMccLinkError) {
    const statusByCode = {
      ADS_CUSTOMER_NOT_SELECTED: 409,
      ADS_MCC_LINK_NOT_PENDING: 409,
      ADS_MCC_REFRESH_TOKEN_MISSING: 503,
    };
    return res.status(statusByCode[err.code] ?? 400).json({
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof GoogleAdsAccountError) {
    const statusByCode = {
      ADS_MCC_REFRESH_TOKEN_MISSING: 503,
      ADS_MCC_PERMISSION_DENIED: 403,
      ADS_MCC_CONFIG_MISSING: 503,
    };
    const httpStatus =
      statusByCode[err.code] ??
      (err.details?.statusCode === 403
        ? 403
        : err.details?.statusCode === 401
          ? 401
          : 502);
    return res.status(httpStatus).json({
      error: err.code,
      message: err.message,
    });
  }
  return null;
}

function mccLinkResponse(mccLink, extra = {}) {
  return {
    mccLink: mccLink ?? null,
    manualAccept: getMccLinkManualAcceptInstructions(),
    ...extra,
  };
}

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    if (req.query.rediscover === 'true') {
      await rediscoverConnectedIntegrations(access.businessId);
    }

    const connections = await getAllConnectionStatuses(access.businessId);
    return res.status(200).json({
      businessId: access.businessId.toString(),
      connections,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/google/:provider/connect-url', requireAuth, async (req, res, next) => {
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
      returnPathRaw.startsWith('/') && !returnPathRaw.startsWith('//') ? returnPathRaw : undefined;

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

router.get('/gtm/resource-options', requireAuth, async (req, res, next) => {
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
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.put('/gtm/selection', requireAuth, async (req, res, next) => {
  try {
    const { businessId: bidRaw, accountId, containerId, workspaceId } = parseGtmSelectionBody(req.body);
    if (!bidRaw || !mongoose.Types.ObjectId.isValid(bidRaw)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'businessId is required and must be a valid ObjectId',
      });
    }

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    if (!(await assertProviderSelectionNotLocked(res, access.businessId))) {
      return;
    }

    const result = await saveGtmSelection(access.businessId, {
      accountId,
      containerId,
      workspaceId,
    });
    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.get('/gtm/accounts', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await listGtmAccountsOnly(access.businessId);
    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.put('/gtm/account-selection', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId.trim() : '';
    if (!bidRaw || !mongoose.Types.ObjectId.isValid(bidRaw)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'businessId is required and must be a valid ObjectId',
      });
    }
    if (!accountId) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'accountId is required',
      });
    }

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    if (!(await assertProviderSelectionNotLocked(res, access.businessId))) {
      return;
    }

    const result = await saveGtmAccountOnlySelection(access.businessId, accountId);
    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.get('/google_ads/resource-options', requireAuth, async (req, res, next) => {
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
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.put('/google_ads/selection', requireAuth, async (req, res, next) => {
  try {
    const { businessId: bidRaw, customerId } = parseGoogleAdsSelectionBody(req.body);
    if (!bidRaw || !mongoose.Types.ObjectId.isValid(bidRaw)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'businessId is required and must be a valid ObjectId',
      });
    }
    if (!customerId) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'customerId is required',
      });
    }

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    if (!(await assertProviderSelectionNotLocked(res, access.businessId))) {
      return;
    }

    const result = await saveGoogleAdsSelection(access.businessId, { customerId });
    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.put('/google_ads/provisioning-intent', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const intent =
      typeof req.body?.provisioningIntent === 'string' ? req.body.provisioningIntent.trim() : '';

    if (!bidRaw || !mongoose.Types.ObjectId.isValid(bidRaw)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'businessId is required and must be a valid ObjectId',
      });
    }
    if (intent !== 'mcc_create') {
      return res.status(400).json({
        error: 'validation_error',
        message: 'provisioningIntent must be mcc_create',
      });
    }

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await saveGoogleAdsProvisioningIntent(access.businessId);
    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.get('/google_ads/mcc-link-status', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    if (req.query.refresh === 'true') {
      const refreshed = await refreshMccLinkStatus(access.businessId);
      return res.status(200).json(
        mccLinkResponse(refreshed.mccLink, {
          businessId: access.businessId.toString(),
          refreshed: true,
        })
      );
    }

    const conn = await IntegrationConnection.findOne({
      businessId: access.businessId,
      provider: 'google_ads',
    })
      .select('providerIdentifiers.mccLink providerIdentifiers.customerId')
      .lean();

    return res.status(200).json(
      mccLinkResponse(conn?.providerIdentifiers?.mccLink ?? null, {
        businessId: access.businessId.toString(),
        refreshed: false,
        customerId: conn?.providerIdentifiers?.customerId ?? null,
      })
    );
  } catch (err) {
    const mapped = mapMccLinkError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/google_ads/mcc-link/invite', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await ensureMccLinkInvited(access.businessId);
    return res.status(200).json(
      mccLinkResponse(result.mccLink, {
        businessId: access.businessId.toString(),
        outcome: result.outcome,
      })
    );
  } catch (err) {
    const mapped = mapMccLinkError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/google_ads/mcc-link/accept', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    if (process.env.GOOGLE_ADS_MCC_AUTO_ACCEPT_ENABLED !== 'true') {
      return res.status(409).json({
        error: 'manual_accept_required',
        message: 'Automatic MCC link acceptance is not enabled. Accept the invitation in Google Ads.',
        ...mccLinkResponse(
          (
            await IntegrationConnection.findOne({
              businessId: access.businessId,
              provider: 'google_ads',
            })
              .select('providerIdentifiers.mccLink')
              .lean()
          )?.providerIdentifiers?.mccLink ?? null
        ),
      });
    }

    const result = await acceptMccLinkIfAllowed(access.businessId);
    return res.status(200).json(
      mccLinkResponse(result.mccLink, {
        businessId: access.businessId.toString(),
        outcome: result.outcome,
        ...(result.message ? { message: result.message } : {}),
      })
    );
  } catch (err) {
    const mapped = mapMccLinkError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

function mapManagementRouteError(err, res) {
  if (err instanceof AdsCampaignManagementError || err instanceof GoogleAdsApiError) {
    const statusByCode = {
      validation_error: 400,
      ADS_CAMPAIGN_BUDGET_TOO_LOW: 400,
      ADS_CAMPAIGN_BUDGET_MAX_EXCEEDED: 400,
      ADS_CAMPAIGN_NOT_FOUND: 404,
      ADS_CAMPAIGN_BUDGET_NOT_FOUND: 404,
      ADS_CAMPAIGN_BUSINESS_NOT_FOUND: 404,
      GOOGLE_ADS_API_NOT_ENABLED: 503,
    };
    const mapped = mapManagementError(err);
    return res.status(statusByCode[mapped.code] ?? 502).json({
      error: mapped.code,
      message: mapped.message,
    });
  }
  return null;
}

router.get('/google_ads/campaign', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const campaign = await getCampaignForBusiness(req.user.id, bidRaw);
    return res.status(200).json({ campaign });
  } catch (err) {
    const mapped = mapManagementRouteError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.get('/google_ads/campaign/performance', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const performance = await getCampaignPerformanceForBusiness(req.user.id, bidRaw);
    return res.status(200).json({ performance });
  } catch (err) {
    const mapped = mapPerformanceRouteError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/google_ads/campaign/enable', requireAuth, async (req, res, next) => {
  try {
    try {
      await assertActivePlan(req.user.id, 'campaign_enable');
    } catch (err) {
      if (err instanceof SubscriptionGateError) {
        return res.status(403).json({ error: err.code, message: err.message });
      }
      throw err;
    }

    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const result = await enableCampaignForBusiness(req.user.id, bidRaw);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapManagementRouteError(err, res);
    if (mapped) return mapped;
    const providerMapped = mapMccLinkError(err, res);
    if (providerMapped) return providerMapped;
    next(err);
  }
});

router.post('/google_ads/campaign/pause', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const result = await pauseCampaignForBusiness(req.user.id, bidRaw);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapManagementRouteError(err, res);
    if (mapped) return mapped;
    const providerMapped = mapMccLinkError(err, res);
    if (providerMapped) return providerMapped;
    next(err);
  }
});

router.patch('/google_ads/campaign/budget', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const amountMicros = req.body?.amountMicros;
    const result = await updateBudgetForBusiness(req.user.id, bidRaw, amountMicros);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapManagementRouteError(err, res);
    if (mapped) return mapped;
    const providerMapped = mapMccLinkError(err, res);
    if (providerMapped) return providerMapped;
    next(err);
  }
});

router.post('/gbp/:locationId/write', requireAuth, async (req, res, next) => {
  try {
    const consentGranted =
      req.headers['x-gbp-write-consent'] === 'true' || req.body?.consent === true;
    const businessIdRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const result = await executeGbpWrite(req.user.id, businessIdRaw, req.body ?? {}, consentGranted);
    return res.status(200).json({ result });
  } catch (err) {
    if (err instanceof GbpWriteError) {
      const status = err.code === 'consent_required' ? 400 : 403;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    return next(err);
  }
});

router.get('/meta/connect-url', requireAuth, async (_req, res) => {
  const data = await buildMetaConnectUrl();
  res.status(200).json(data);
});

router.get('/meta/status', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({ error: 'not_found', message: 'Business context not found' });
    }
    const status = await getMetaAdsStatus({ businessId: bidRaw });
    return res.status(200).json({ status });
  } catch (err) {
    return next(err);
  }
});

router.post('/meta/setup', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const result = await runMetaSetup(req.user.id, bidRaw);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

router.get('/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  if (oauthError) {
    const redirect = buildFrontendRedirectUrl({
      provider: 'unknown',
      outcome: 'error',
      reason: oauthError,
    });
    return res.redirect(302, redirect);
  }

  const payload = verifyOAuthState(state);
  if (!payload) {
    const redirect = buildFrontendRedirectUrl({
      provider: 'unknown',
      outcome: 'error',
      reason: 'invalid_state',
    });
    return res.redirect(302, redirect);
  }

  if (!code) {
    const redirect = buildFrontendRedirectUrl({
      provider: payload.provider,
      outcome: 'error',
      reason: 'missing_code',
    });
    return res.redirect(302, redirect);
  }

  if (!mongoose.Types.ObjectId.isValid(payload.businessId)) {
    const redirect = buildFrontendRedirectUrl({
      provider: payload.provider,
      outcome: 'error',
      reason: 'invalid_business',
    });
    return res.redirect(302, redirect);
  }

  const access = await assertBusinessAccess(payload.userId, payload.businessId);
  if (!access) {
    const redirect = buildFrontendRedirectUrl({
      provider: payload.provider,
      outcome: 'error',
      reason: 'forbidden',
    });
    return res.redirect(302, redirect);
  }

  try {
    await completeGoogleOAuthCallback({
      businessId: access.businessId.toString(),
      provider: payload.provider,
      userId: payload.userId,
      code,
    });

    const redirect = buildFrontendRedirectUrl({
      provider: payload.provider,
      outcome: 'connected',
      returnPath: payload.returnPath,
    });
    return res.redirect(302, redirect);
  } catch (err) {
    const reason = err instanceof Error && err.code ? String(err.code) : 'callback_failed';
    const redirect = buildFrontendRedirectUrl({
      provider: payload.provider,
      outcome: 'error',
      reason,
      returnPath: payload.returnPath,
    });
    return res.redirect(302, redirect);
  }
});

module.exports = router;
