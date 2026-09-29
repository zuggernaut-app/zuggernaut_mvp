'use strict';

const mongoose = require('mongoose');
const SetupRun = mongoose.model('SetupRun');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

/**
 * Deterministic artifact selection: newest SUCCEEDED setup run for businessId,
 * then that run's google_ads ads_campaign artifact.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @returns {Promise<{ setupRun: object | null, artifact: object | null }>}
 */
async function findLatestSucceededAdsCampaignArtifact(businessId) {
  const setupRun = await SetupRun.findOne({ businessId, status: 'SUCCEEDED' })
    .sort({ updatedAt: -1 })
    .lean();

  if (!setupRun) {
    return { setupRun: null, artifact: null };
  }

  const artifact = await IntegrationArtifact.findOne({
    businessId,
    setupRunId: setupRun._id,
    provider: 'google_ads',
    artifactType: 'ads_campaign',
  }).lean();

  return { setupRun, artifact };
}

/**
 * @param {object | null | undefined} bc
 * @param {object | null | undefined} artifact
 * @returns {{
 *   susoStale: boolean,
 *   currentSusoVersion: number,
 *   artifactSusoVersion: number | null,
 * }}
 */
function resolveSusoStaleState(bc, artifact) {
  const currentSusoVersion = typeof bc?.susoVersion === 'number' ? bc.susoVersion : 0;
  const rawArtifactVersion = artifact?.metadata?.susoVersion;

  if (rawArtifactVersion === null || rawArtifactVersion === undefined) {
    return {
      susoStale: false,
      currentSusoVersion,
      artifactSusoVersion: null,
    };
  }

  const artifactSusoVersion = Number(rawArtifactVersion);
  if (!Number.isFinite(artifactSusoVersion)) {
    return {
      susoStale: false,
      currentSusoVersion,
      artifactSusoVersion: null,
    };
  }

  return {
    susoStale: artifactSusoVersion !== currentSusoVersion,
    currentSusoVersion,
    artifactSusoVersion,
  };
}

module.exports = {
  findLatestSucceededAdsCampaignArtifact,
  resolveSusoStaleState,
};
