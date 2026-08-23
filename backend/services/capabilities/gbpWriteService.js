'use strict';

const { assertBusinessMembershipOrOwnership } = require('../../lib/auth/membershipCheck');
const { writeGbpHours, writeGbpPost } = require('../integrations/googleBusinessProfileWriteClient');

class GbpWriteError extends Error {
  constructor(message, code = 'GBP_WRITE_ERROR') {
    super(message);
    this.name = 'GbpWriteError';
    this.code = code;
  }
}

async function executeGbpWrite(userId, businessId, payload, consentGranted) {
  if (!consentGranted) {
    throw new GbpWriteError('Explicit consent is required for GBP writes.', 'consent_required');
  }

  await assertBusinessMembershipOrOwnership(userId, businessId);

  const action = typeof payload?.action === 'string' ? payload.action.trim() : '';
  if (action === 'hours') {
    return writeGbpHours({ businessId, hours: payload.hours });
  }
  if (action === 'post') {
    return writeGbpPost({ businessId, post: payload.post });
  }

  throw new GbpWriteError('action must be hours or post', 'validation_error');
}

module.exports = {
  GbpWriteError,
  executeGbpWrite,
};
