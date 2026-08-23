'use strict';

const { createMetaCampaignStub } = require('../integrations/metaAdsClient');
const { assertBusinessMembershipOrOwnership } = require('../../lib/auth/membershipCheck');

async function runMetaSetup(userId, businessId) {
  await assertBusinessMembershipOrOwnership(userId, businessId);
  const created = await createMetaCampaignStub({ businessId });
  return { created, step: 'meta_setup_v1' };
}

module.exports = {
  runMetaSetup,
};
