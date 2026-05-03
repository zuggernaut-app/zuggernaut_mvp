'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const { requireAuth } = require('./middleware/requireAuth');
const {
  normalizeStringList,
  validateMixedObjectOrNull,
  validateHttpUrl,
  MAX_SINGLE_LINE_FIELD,
} = require('../../lib/validation');

const router = express.Router();

/** Canonical fields users may confirm/edit (PUT body subset). */
const EDITABLE_FIELDS = new Set([
  'websiteUrl',
  'businessName',
  'industry',
  'services',
  'serviceAreas',
  'contactMethods',
  'audienceSignals',
  'goals',
  'differentiators',
  'orderValueHint',
]);

router.put('/:businessId', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userId = new mongoose.Types.ObjectId(req.user.id);

  let doc;
  try {
    doc = await BusinessContext.findOne({
      businessId,
      userId,
    });
  } catch {
    return res.status(503).json({
      error: 'service_unavailable',
      message: 'Database query failed. Check MongoDB and MONGODB_URI.',
    });
  }

  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business context not found for this user',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const key of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const val = body[key];
    if (key === 'services' || key === 'serviceAreas') {
      const list = normalizeStringList(val, key);
      if (!list.ok) {
        return res.status(400).json({ error: 'validation_error', message: list.message });
      }
      doc[key] = list.value;
      continue;
    }
    if (
      key === 'contactMethods' ||
      key === 'audienceSignals' ||
      key === 'goals'
    ) {
      const mixed = validateMixedObjectOrNull(val, key);
      if (!mixed.ok) {
        return res.status(400).json({ error: 'validation_error', message: mixed.message });
      }
      if (mixed.value === undefined) continue;
      doc[key] = mixed.value;
      continue;
    }
    if (key === 'websiteUrl') {
      if (val === null || val === undefined || val === '') {
        doc[key] = undefined;
        continue;
      }
      if (typeof val !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: 'websiteUrl must be a string or null',
        });
      }
      const urlCheck = validateHttpUrl(val);
      if (!urlCheck.ok) {
        return res.status(400).json({ error: 'validation_error', message: urlCheck.message });
      }
      doc[key] = urlCheck.value;
      continue;
    }
    if (typeof val === 'string' || val === null || val === undefined) {
      if (val === null || val === undefined || val === '') {
        doc[key] = undefined;
      } else {
        const t = val.trim();
        if (t.length > MAX_SINGLE_LINE_FIELD) {
          return res.status(400).json({
            error: 'validation_error',
            message: `${key} must be at most ${MAX_SINGLE_LINE_FIELD} characters`,
          });
        }
        doc[key] = t;
      }
    } else {
      return res.status(400).json({
        error: 'validation_error',
        message: `Invalid type for ${key}`,
      });
    }
  }

  doc.confirmedAt = new Date();
  try {
    await doc.save();
  } catch (err) {
    if (err?.name === 'ValidationError') {
      const msg =
        typeof err.message === 'string' ? err.message : 'Validation failed';
      return res.status(400).json({ error: 'validation_error', message: msg });
    }
    return next(err);
  }

  return res.status(200).json({
    businessContext: {
      businessId: doc.businessId.toString(),
      userId: doc.userId.toString(),
      websiteUrl: doc.websiteUrl ?? null,
      businessName: doc.businessName ?? null,
      industry: doc.industry ?? null,
      services: doc.services ?? [],
      serviceAreas: doc.serviceAreas ?? [],
      contactMethods: doc.contactMethods ?? null,
      audienceSignals: doc.audienceSignals ?? null,
      goals: doc.goals ?? null,
      differentiators: doc.differentiators ?? null,
      orderValueHint: doc.orderValueHint ?? null,
      confirmedAt: doc.confirmedAt,
      updatedAt: doc.updatedAt,
    },
  });
});

module.exports = router;
