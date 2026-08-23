'use strict';

const mongoose = require('mongoose');

/**
 * @param {import('express').Response} res
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @returns {Promise<boolean>} false when response was sent
 */
async function assertProviderSelectionNotLocked(res, businessId) {
  const BusinessSetupState = mongoose.model('BusinessSetupState');
  const lock = await BusinessSetupState.findOne({ businessId }).select('lockState').lean();
  if (lock?.lockState === 'succeeded') {
    res.status(409).json({
      error: 'provider_selection_locked',
      message:
        'Google Ads and GTM selections cannot be changed after setup completes successfully.',
    });
    return false;
  }
  return true;
}

module.exports = { assertProviderSelectionNotLocked };
