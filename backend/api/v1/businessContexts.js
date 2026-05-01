'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const { devUserRequired } = require('./middleware/devUser');

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

router.put('/:businessId', devUserRequired, async (req, res) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  const doc = await BusinessContext.findOne({
    businessId,
    userId: req.devUserId,
  });

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
      if (!Array.isArray(val)) {
        return res.status(400).json({
          error: 'validation_error',
          message: `${key} must be an array of strings`,
        });
      }
      doc[key] = val.map((s) => String(s).trim()).filter(Boolean);
      continue;
    }
    if (
      key === 'contactMethods' ||
      key === 'audienceSignals' ||
      key === 'goals'
    ) {
      doc[key] = val === undefined ? undefined : val;
      continue;
    }
    if (typeof val === 'string' || val === null || val === undefined) {
      doc[key] = val === null || val === undefined ? undefined : val.trim();
    } else {
      return res.status(400).json({
        error: 'validation_error',
        message: `Invalid type for ${key}`,
      });
    }
  }

  doc.confirmedAt = new Date();
  await doc.save();

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
