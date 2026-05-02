'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const User = mongoose.model('User');
const { devUserRequired } = require('./middleware/devUser');
const { runPlaceholderScrape } = require('../../services/scrapePlaceholder');
const { validateHttpUrl } = require('../../lib/validation');

const router = express.Router();

/** Preserve existing scrape blob keys and append `runs`. */
function mergeRawScrapeOutput(existing, rawPayload) {
  const prev =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing
      : {};
  const runs = Array.isArray(prev.runs) ? [...prev.runs] : [];
  runs.push(rawPayload);
  return { ...prev, runs };
}

router.post('/business', devUserRequired, async (req, res) => {
  const draft = await BusinessContext.create({
    userId: req.devUserId,
  });

  await User.findOneAndUpdate(
    {
      _id: req.devUserId,
      $or: [{ primaryBusinessId: { $exists: false } }, { primaryBusinessId: null }],
    },
    { $set: { primaryBusinessId: draft.businessId } }
  );

  return res.status(201).json({
    businessId: draft.businessId.toString(),
  });
});

router.post('/business/:businessId/scrape', devUserRequired, async (req, res) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  const urlCheck = validateHttpUrl(
    typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl : ''
  );
  if (!urlCheck.ok) {
    return res.status(400).json({
      error: 'validation_error',
      message: urlCheck.message,
    });
  }
  const websiteUrl = urlCheck.value;

  const doc = await BusinessContext.findOne({
    businessId,
    userId: req.devUserId,
  }).select('+rawScrapeOutput');

  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business draft not found for this user',
    });
  }

  const { suggested, rawPayload } = runPlaceholderScrape(websiteUrl);

  doc.websiteUrl = websiteUrl;
  doc.rawScrapeOutput = mergeRawScrapeOutput(doc.rawScrapeOutput, rawPayload);
  doc.markModified('rawScrapeOutput');
  await doc.save();

  return res.status(200).json({
    businessId: doc.businessId.toString(),
    websiteUrl: doc.websiteUrl,
    suggested,
    rawScrapeStored: true,
  });
});

module.exports = router;
