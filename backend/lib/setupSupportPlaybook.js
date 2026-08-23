'use strict';

const { resolveSetupUserErrorMessage } = require('./setupUserErrorMessages');

/**
 * @typedef {object} SupportPlaybookStep
 * @property {string} text
 * @property {string} [href]
 * @property {boolean} [external]
 */

/**
 * @typedef {object} SupportPlaybook
 * @property {string} title
 * @property {SupportPlaybookStep[]} steps
 * @property {SupportPlaybookStep[]} [advancedSteps]
 */

/**
 * @param {string} path
 * @returns {SupportPlaybookStep}
 */
function internalStep(path, text) {
  return { text, href: path };
}

/**
 * @param {string} url
 * @param {string} text
 * @returns {SupportPlaybookStep}
 */
function externalStep(url, text) {
  return { text, href: url, external: true };
}

/**
 * @param {string} text
 * @returns {SupportPlaybookStep}
 */
function plainStep(text) {
  return { text };
}

/**
 * @param {object} [ctx]
 * @param {string | null | undefined} [ctx.errorCode]
 * @param {string} [ctx.outcomeKind]
 * @param {string | null | undefined} [ctx.setupRunId]
 * @param {string | null | undefined} [ctx.businessId]
 * @param {string | null | undefined} [ctx.publicContainerId]
 * @returns {SupportPlaybook | null}
 */
function buildSupportPlaybook(ctx = {}) {
  const errorCode = typeof ctx.errorCode === 'string' ? ctx.errorCode.trim() : '';
  const outcomeKind = typeof ctx.outcomeKind === 'string' ? ctx.outcomeKind : '';
  const setupRunId = typeof ctx.setupRunId === 'string' ? ctx.setupRunId : null;
  const publicContainerId =
    typeof ctx.publicContainerId === 'string' ? ctx.publicContainerId : null;

  const progressHref = setupRunId ? `/setup/progress/${setupRunId}` : '/setup';
  const reportHref = setupRunId ? `/setup/report/${setupRunId}` : null;
  const editBusinessHref = ctx.businessId ? `/business-context/${ctx.businessId}/edit` : null;

  if (errorCode === 'GTM_SNIPPET_PENDING') {
    return {
      title: 'Install the Google Tag Manager snippet',
      steps: [
        plainStep(
          publicContainerId
            ? `Add the GTM container snippet (${publicContainerId}) to the <head> of every page on your website.`
            : 'Add the GTM container snippet to the <head> of every page on your website.'
        ),
        externalStep('https://tagmanager.google.com/', 'Open Google Tag Manager to copy your container snippet.'),
        internalStep('/setup', 'Start a new setup run after the snippet is live on your site.'),
      ],
    };
  }

  if (errorCode === 'GTM_ACCOUNT_NOT_FOUND' || errorCode === 'GTM_PROVISIONING_FAILED') {
    return {
      title: 'Fix Google Tag Manager provisioning',
      steps: [
        externalStep('https://tagmanager.google.com/', 'Create or verify your GTM account at tagmanager.google.com.'),
        internalStep(progressHref, 'Return to setup progress and approve GTM provisioning again.'),
        internalStep('/setup', 'Start a new setup run after provisioning succeeds.'),
      ],
    };
  }

  if (
    errorCode === 'ADS_PROVISIONING_FAILED' ||
    errorCode === 'ADS_MCC_PERMISSION_DENIED' ||
    errorCode === 'ADS_MCC_CREATE_DENIED'
  ) {
    return {
      title: 'Fix Google Ads provisioning',
      steps: [
        externalStep('https://ads.google.com/', 'Open Google Ads and confirm billing and MCC permissions.'),
        internalStep(progressHref, 'Return to setup progress and approve Google Ads provisioning again.'),
        internalStep('/setup', 'Start a new setup run after provisioning succeeds.'),
      ],
    };
  }

  if (errorCode === 'ADS_CUSTOMER_SELECTION_REQUIRED' || errorCode === 'ADS_CUSTOMER_NOT_FOUND') {
    return {
      title: 'Select your Google Ads account',
      steps: [
        internalStep('/setup', 'Open setup and connect Google Ads.'),
        plainStep('Choose the Google Ads customer account Zuggernaut should use, or approve creating a new one.'),
        internalStep('/setup', 'Start a new setup run after the account is selected.'),
      ],
    };
  }

  if (errorCode === 'CONVERSION_STRATEGY_MISSING_GOALS') {
    return {
      title: 'Confirm your business goals',
      steps: [
        editBusinessHref
          ? internalStep(editBusinessHref, 'Edit your business profile and choose calls, forms, or both.')
          : plainStep('Edit your business profile and choose calls, forms, or both.'),
        internalStep('/setup', 'Start a new setup run after saving your goals.'),
      ],
    };
  }

  if (errorCode) {
    const message = resolveSetupUserErrorMessage({ errorCode });
    return {
      title: 'Resolve the setup issue',
      steps: [
        plainStep(message),
        reportHref ? internalStep(reportHref, 'Review the setup report for step details.') : plainStep('Review the setup report for step details.'),
        internalStep('/setup', 'Start a new setup run after fixing the issue.'),
      ],
    };
  }

  if (outcomeKind === 'snippet_pending') {
    return {
      title: 'Install the Google Tag Manager snippet',
      steps: [
        plainStep(
          publicContainerId
            ? `Use container ID ${publicContainerId} from your connected GTM account.`
            : 'Use the container ID from your connected GTM account.'
        ),
        externalStep('https://tagmanager.google.com/', 'Open Google Tag Manager to copy your container snippet.'),
        internalStep('/setup', 'Start a new setup run after installing the snippet.'),
      ],
    };
  }

  if (outcomeKind === 'provisioning_required') {
    return {
      title: 'Approve Google resource provisioning',
      steps: [
        internalStep(progressHref, 'Open setup progress and review the provisioning consent card.'),
        plainStep('Approve what Zuggernaut will create in Google Tag Manager or Google Ads.'),
        internalStep('/setup', 'Continue setup after provisioning is approved.'),
      ],
    };
  }

  if (outcomeKind === 'tracking_fix') {
    return {
      title: 'Fix tracking before retrying setup',
      steps: [
        editBusinessHref
          ? internalStep(editBusinessHref, 'Confirm your website URL and thank-you page paths in your business profile.')
          : plainStep('Confirm your website URL matches where GTM is installed.'),
        externalStep('https://tagmanager.google.com/', 'Review published GTM tags and triggers in Tag Manager.'),
        internalStep('/setup', 'Start a new setup run after fixes are live on your site.'),
      ],
    };
  }

  if (outcomeKind === 'manual_review') {
    return {
      title: 'Connect required Google integrations',
      steps: [
        internalStep('/setup', 'Open setup and connect Google Ads (required) and GTM (recommended).'),
        plainStep('Complete account selection or provisioning approval if prompted.'),
        internalStep('/setup', 'Start a new setup run once integrations show as connected.'),
      ],
    };
  }

  if (outcomeKind === 'failed') {
    return {
      title: 'Retry setup after fixing the error',
      steps: [
        reportHref ? internalStep(reportHref, 'Review the setup report and step history.') : plainStep('Review the error summary and step history.'),
        internalStep('/setup', 'Fix integration or configuration issues, then start a new setup run.'),
      ],
      advancedSteps: [
        plainStep('If status stays RUNNING for several minutes, verify the Temporal worker and MongoDB are healthy.'),
      ],
    };
  }

  if (outcomeKind === 'in_progress') {
    return {
      title: 'Setup still running',
      steps: [
        progressHref
          ? internalStep(progressHref, 'Refresh the setup progress page periodically.')
          : plainStep('Wait for the workflow to advance — refresh this page periodically.'),
      ],
      advancedSteps: [
        plainStep('If status stays RUNNING for several minutes, verify the Temporal worker logs and MongoDB connectivity.'),
      ],
    };
  }

  return null;
}

module.exports = {
  buildSupportPlaybook,
};
