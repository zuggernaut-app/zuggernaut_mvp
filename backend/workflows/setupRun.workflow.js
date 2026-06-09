'use strict';

const { proxyActivities } = require('@temporalio/workflow');
const { SETUP_WORKFLOW_TERMINALS: T } = require('../constants/setupWorkflow');
const { SETUP_ACTIVITY_POLICIES: P } = require('../constants/setupActivityPolicies');

const controlActivities = proxyActivities(P.control);
const preconditionActivities = proxyActivities(P.precondition);
const readActivities = proxyActivities(P.read);
const mutateActivities = proxyActivities(P.mutate);

const {
  loadSetupContextActivity,
  runGbpAuditActivity,
  runStructuralVerificationActivity,
} = controlActivities;

const {
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsConnectionActivity,
  discoverGoogleAdsCustomersActivity,
  ensureGoogleAdsProvisioningApprovalActivity,
  assertGoogleAdsSetupReadyActivity,
  checkProvisioningApprovalActivity,
} = preconditionActivities;

const { fetchAdsConversionCatalogActivity } = readActivities;

const {
  runGtmConversionSetupActivity,
  createAdsCampaignActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
} = mutateActivities;

/**
 * @param {object} load
 * @param {'gtm' | 'google_ads'} provider
 */
async function ensureProviderReady(load, provider) {
  const ctx = {
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  };

  if (provider === 'gtm') {
    let pre = await checkGtmPreconditionsActivity(ctx);
    if (pre.outcome === 'ok') {
      return null;
    }
    if (pre.outcome !== 'gtm_provisioning_required') {
      return { terminal: pre.outcome, pre };
    }

    const approval = await checkProvisioningApprovalActivity({ ...ctx, provider: 'gtm' });
    if (approval.outcome === 'pending_approval') {
      return { terminal: T.GTM_PROVISIONING_REQUIRED, pre, approval };
    }
    if (approval.outcome === 'approved') {
      await provisionGtmResourcesActivity({
        ...ctx,
        provisioningRequestId: approval.provisioningRequestId,
      });
      pre = await checkGtmPreconditionsActivity(ctx);
      if (pre.outcome !== 'ok') {
        return { terminal: T.MANUAL_REVIEW, pre, approval };
      }
      return null;
    }
    if (approval.outcome === 'ready') {
      return null;
    }
    return { terminal: T.MANUAL_REVIEW, pre, approval };
  }

  const conn = await checkGoogleAdsConnectionActivity(ctx);
  if (conn.outcome !== 'ok') {
    return { terminal: conn.outcome, pre: conn };
  }

  let discovery = await discoverGoogleAdsCustomersActivity(ctx);
  if (discovery.outcome === 'manual_review') {
    return { terminal: T.MANUAL_REVIEW, pre: discovery };
  }
  if (discovery.outcome === 'ok') {
    return null;
  }
  if (discovery.outcome !== 'ads_provisioning_required') {
    return { terminal: discovery.outcome, pre: discovery };
  }

  const approval = await ensureGoogleAdsProvisioningApprovalActivity(ctx);
  if (approval.outcome === 'pending_approval') {
    return { terminal: T.ADS_PROVISIONING_REQUIRED, pre: discovery, approval };
  }
  if (approval.outcome === 'approved') {
    await provisionGoogleAdsCustomerActivity({
      ...ctx,
      provisioningRequestId: approval.provisioningRequestId,
    });
    const readiness = await assertGoogleAdsSetupReadyActivity(ctx);
    if (readiness.outcome !== 'ok') {
      return { terminal: T.MANUAL_REVIEW, pre: readiness, approval };
    }
    return null;
  }
  if (approval.outcome === 'ready') {
    return null;
  }
  return { terminal: T.MANUAL_REVIEW, pre: discovery, approval };
}

/**
 * V1 `SetupRunWorkflow` — deterministic sequencing; branches only on activity results.
 * No Mongo, API calls, tokens, dates, randomness, or env reads in this file.
 *
 * @param {object} [input]
 * @param {string} [input.setupRunId]
 * @returns {Promise<Record<string, unknown>>}
 */
async function setupRunWorkflow(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const setupRunId = safe.setupRunId;

  const load = await loadSetupContextActivity({ setupRunId });
  if (load.outcome !== 'ok') {
    return {
      workflow: 'setupRunWorkflow',
      terminal: load.outcome,
      setupRunId,
      load,
    };
  }

  const gbpPre = await checkGbpPreconditionsActivity({
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  });
  if (gbpPre.outcome !== 'ok' && gbpPre.outcome !== 'not_ready') {
    return {
      workflow: 'setupRunWorkflow',
      terminal: gbpPre.outcome,
      setupRunId: load.setupRunId,
      pre: gbpPre,
    };
  }

  const gtmGate = await ensureProviderReady(load, 'gtm');
  if (gtmGate) {
    return {
      workflow: 'setupRunWorkflow',
      terminal: gtmGate.terminal,
      setupRunId: load.setupRunId,
      pre: gtmGate.pre,
      approval: gtmGate.approval ?? null,
    };
  }

  const adsGate = await ensureProviderReady(load, 'google_ads');
  if (adsGate) {
    return {
      workflow: 'setupRunWorkflow',
      terminal: adsGate.terminal,
      setupRunId: load.setupRunId,
      pre: adsGate.pre,
      approval: adsGate.approval ?? null,
    };
  }

  const gbp = await runGbpAuditActivity({
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  });
  if (gbp.outcome !== 'ok' && gbp.outcome !== 'skipped') {
    return {
      workflow: 'setupRunWorkflow',
      terminal: T.GBP_BLOCKED,
      setupRunId: load.setupRunId,
      gbp,
    };
  }

  await fetchAdsConversionCatalogActivity({
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  });

  await runGtmConversionSetupActivity({
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  });

  const verify = await runStructuralVerificationActivity({
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  });
  if (
    verify.outcome === T.NEEDS_TRACKING_FIX ||
    verify.outcome === T.MANUAL_REVIEW ||
    verify.outcome === T.SNIPPET_PENDING
  ) {
    return {
      workflow: 'setupRunWorkflow',
      terminal: verify.outcome,
      setupRunId: load.setupRunId,
      verify,
    };
  }

  const ads = await createAdsCampaignActivity({
    setupRunId: load.setupRunId,
    businessId: load.businessId,
  });

  return {
    workflow: 'setupRunWorkflow',
    terminal: T.SUCCEEDED,
    setupRunId: load.setupRunId,
    gbp,
    verify,
    ads,
  };
}

module.exports = { setupRunWorkflow };
