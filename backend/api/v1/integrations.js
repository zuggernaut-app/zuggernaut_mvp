'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('./middleware/requireAuth');
const { assertBusinessAccess } = require('./lib/assertBusinessAccess');
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
  saveGtmSelection,
  GtmResourceSelectionError,
} = require('../../services/integrations/gtmResourceSelectionService');
const {
  listGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
  GoogleAdsResourceSelectionError,
} = require('../../services/integrations/googleAdsResourceSelectionService');
const {
  parseGtmSelectionBody,
  parseGoogleAdsSelectionBody,
} = require('../../services/integrations/providerResourceSelection');

const router = express.Router();

function mapSelectionError(err, res) {
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

    const result = await saveGoogleAdsSelection(access.businessId, { customerId });
    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapSelectionError(err, res);
    if (mapped) return mapped;
    next(err);
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
