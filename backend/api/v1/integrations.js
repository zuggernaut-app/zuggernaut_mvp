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
} = require('../../services/integrations/googleOAuthService');
const { getAllConnectionStatuses } = require('../../services/capabilities/integrationConnectionService');

const router = express.Router();

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

    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider,
      userId: req.user.id,
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
    });
    return res.redirect(302, redirect);
  } catch (err) {
    const reason = err instanceof Error && err.code ? String(err.code) : 'callback_failed';
    const redirect = buildFrontendRedirectUrl({
      provider: payload.provider,
      outcome: 'error',
      reason,
    });
    return res.redirect(302, redirect);
  }
});

module.exports = router;
