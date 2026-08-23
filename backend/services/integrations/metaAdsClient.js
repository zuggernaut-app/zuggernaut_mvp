'use strict';

async function createMetaCampaignStub(ctx) {
  if (process.env.META_API_MOCK !== 'true') {
    return { outcome: 'skipped_api_disabled', source: 'meta_ads_api' };
  }
  return {
    outcome: 'created',
    campaignId: `meta_campaign_${ctx.businessId}`,
    source: 'meta_ads_api_mock',
  };
}

module.exports = {
  createMetaCampaignStub,
};
