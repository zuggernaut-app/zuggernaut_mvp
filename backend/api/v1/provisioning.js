'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('./middleware/requireAuth');
const { assertBusinessAccess } = require('./lib/assertBusinessAccess');
const {
  PROVISIONING_PROVIDERS,
  ProvisioningServiceError,
  GtmProvisioningError,
  AdsProvisioningError,
  getProvisioningOverview,
  createProvisioningRequest,
  approveProvisioningRequest,
  executeProvisioningRequest,
  cancelProvisioningRequest,
} = require('../../services/capabilities/integrationProvisioningService');
const { createLogger } = require('../../lib/observability/logger');
const { resolveSetupUserErrorMessage } = require('../../lib/setupUserErrorMessages');

const router = express.Router();
const logger = createLogger({ name: 'provisioningApi' });

function mapProvisioningError(err, res) {
  if (err instanceof ProvisioningServiceError) {
    const statusByCode = {
      PROVISIONING_BUSINESS_NOT_FOUND: 404,
      PROVISIONING_REQUEST_NOT_FOUND: 404,
      PROVISIONING_SETUP_RUN_NOT_FOUND: 404,
      PROVISIONING_NOT_REQUIRED: 409,
      PROVISIONING_NOT_ELIGIBLE: 409,
      PROVISIONING_CONNECTION_NOT_READY: 409,
      PROVISIONING_CONNECTION_REQUIRED: 409,
      PROVISIONING_INVALID_STATUS: 409,
      PROVISIONING_APPROVAL_REQUIRED: 409,
      PROVISIONING_PROVIDER_UNSUPPORTED: 400,
      PROVISIONING_INVALID_SETUP_RUN: 400,
    };

    const status = statusByCode[err.code] ?? 400;
    return res.status(status).json({
      error: err.code,
      message: resolveSetupUserErrorMessage({
        errorCode: err.code,
        fallbackMessage: err.message,
      }),
    });
  }

  if (err instanceof GtmProvisioningError || err instanceof AdsProvisioningError) {
    return res.status(502).json({
      error: err.code,
      message: resolveSetupUserErrorMessage({
        errorCode: err.code,
        fallbackMessage: err.message,
      }),
    });
  }

  return null;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const overview = await getProvisioningOverview(access.businessId);
    return res.status(200).json(overview);
  } catch (err) {
    const mapped = mapProvisioningError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/:provider/requests', requireAuth, async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (!PROVISIONING_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        error: 'validation_error',
        message: `Unsupported provisioning provider: ${provider}`,
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

    const setupRunId =
      typeof req.body?.setupRunId === 'string' && mongoose.Types.ObjectId.isValid(req.body.setupRunId)
        ? req.body.setupRunId
        : undefined;

    const result = await createProvisioningRequest({
      businessId: access.businessId,
      provider,
      requestedByUserId: req.user.id,
      setupRunId,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    const mapped = mapProvisioningError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/requests/:requestId/approve', requireAuth, async (req, res, next) => {
  try {
    const requestId = req.params.requestId;
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const request = await approveProvisioningRequest({
      requestId,
      businessId: access.businessId,
      approvedByUserId: req.user.id,
      provisioningIntent:
        typeof req.body?.provisioningIntent === 'string'
          ? req.body.provisioningIntent.trim()
          : undefined,
    });

    return res.status(200).json({ request });
  } catch (err) {
    const mapped = mapProvisioningError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/requests/:requestId/execute', requireAuth, async (req, res, next) => {
  try {
    const requestId = req.params.requestId;
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const setupRunId =
      typeof req.body?.setupRunId === 'string' ? req.body.setupRunId.trim() : '';

    if (!setupRunId || !mongoose.Types.ObjectId.isValid(setupRunId)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'setupRunId is required and must be a valid ObjectId',
      });
    }

    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const result = await executeProvisioningRequest({
      requestId,
      businessId: access.businessId,
      setupRunId,
      logger,
    });

    return res.status(200).json({ result });
  } catch (err) {
    const mapped = mapProvisioningError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

router.post('/requests/:requestId/cancel', requireAuth, async (req, res, next) => {
  try {
    const requestId = req.params.requestId;
    const bidRaw = typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
    const access = await assertBusinessAccess(req.user.id, bidRaw);
    if (!access) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Business context not found for this user',
      });
    }

    const request = await cancelProvisioningRequest({
      requestId,
      businessId: access.businessId,
    });

    return res.status(200).json({ request });
  } catch (err) {
    const mapped = mapProvisioningError(err, res);
    if (mapped) return mapped;
    next(err);
  }
});

module.exports = router;
