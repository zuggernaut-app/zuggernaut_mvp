'use strict';

async function buildMetaConnectUrl() {
  return {
    url: process.env.META_OAUTH_MOCK === 'true' ? 'https://meta.example/oauth/mock' : null,
    source: 'meta_oauth_mock',
  };
}

async function getMetaAdsStatus(ctx) {
  return {
    connected: process.env.META_API_MOCK === 'true',
    source: 'meta_api_mock',
    businessId: ctx.businessId,
  };
}

module.exports = {
  buildMetaConnectUrl,
  getMetaAdsStatus,
};
