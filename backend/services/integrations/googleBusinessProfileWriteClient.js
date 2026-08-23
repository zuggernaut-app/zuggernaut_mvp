'use strict';

/**
 * Separate GBP write client (not via read-only audit service).
 */
async function writeGbpHours(ctx) {
  if (process.env.GBP_API_MOCK !== 'true' && process.env.GBP_WRITE_ENABLED !== 'true') {
    return { outcome: 'skipped_api_disabled', source: 'gbp_write_api' };
  }
  return {
    outcome: 'updated',
    field: 'hours',
    source: process.env.GBP_API_MOCK === 'true' ? 'gbp_api_mock' : 'gbp_write_api',
  };
}

async function writeGbpPost(ctx) {
  if (process.env.GBP_API_MOCK !== 'true' && process.env.GBP_WRITE_ENABLED !== 'true') {
    return { outcome: 'skipped_api_disabled', source: 'gbp_write_api' };
  }
  return {
    outcome: 'created',
    field: 'post',
    source: process.env.GBP_API_MOCK === 'true' ? 'gbp_api_mock' : 'gbp_write_api',
  };
}

module.exports = {
  writeGbpHours,
  writeGbpPost,
};
