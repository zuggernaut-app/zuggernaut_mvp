'use strict';

/**
 * Read-only inventory scan for GTM awct tags that use the wrong conversion measurement
 * (Ads customer id / conversion-action API id instead of tag_snippet conversionId/label).
 *
 * Scans IntegrationArtifact rows and published (live) GTM container versions.
 *
 * Usage: node backend/scripts/gtm-conversion-tag-inventory.js
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');
require('../models');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const { inspectGtmTagArtifact, inspectPublishedGtmTag, summarizeGtmConversionTagInventory } = require('../lib/gtmConversionTagInventory');
const { getGtmAccessToken } = require('../services/integrations/googleTagManagerClient');

const GTM_API_BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';

/**
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} containerId
 */
async function fetchLiveContainerTags(accessToken, accountId, containerId) {
  if (process.env.GTM_API_MOCK === 'true') {
    const err = new Error('GTM live version fetch skipped in mock mode');
    err.code = 'GTM_API_MOCK_UNSCANNED';
    throw err;
  }

  const url = `${GTM_API_BASE}/accounts/${accountId}/containers/${containerId}/versions:live`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`GTM live version fetch failed (${res.status})`);
    err.status = res.status;
    err.responseBody = res.data;
    throw err;
  }

  return Array.isArray(res.data?.tag) ? res.data.tag : [];
}

async function scanArtifactTags() {
  const tags = await IntegrationArtifact.find({
    provider: 'gtm',
    artifactType: 'gtm_tag',
    'metadata.template': { $in: ['ads_conversion_form', 'ads_conversion_call'] },
  }).lean();

  const affected = [];
  for (const tag of tags) {
    const issues = inspectGtmTagArtifact(tag);
    if (issues.length > 0) {
      affected.push({
        source: 'artifact',
        artifactId: String(tag._id),
        businessId: String(tag.businessId),
        setupRunId: String(tag.setupRunId),
        template: tag.metadata?.template ?? null,
        externalId: tag.externalId,
        issues,
      });
    }
  }

  return { scanned: tags.length, affected };
}

async function scanPublishedContainers() {
  const connections = await IntegrationConnection.find({
    provider: 'gtm',
    'providerIdentifiers.accountId': { $exists: true, $ne: null },
    'providerIdentifiers.containerId': { $exists: true, $ne: null },
  })
    .select('businessId providerIdentifiers')
    .lean();

  const affected = [];
  const skipped = [];

  for (const conn of connections) {
    const accountId = conn.providerIdentifiers?.accountId;
    const containerId = conn.providerIdentifiers?.containerId;
    const publicContainerId = conn.providerIdentifiers?.publicContainerId ?? null;
    if (!accountId || !containerId) continue;

    try {
      const accessToken = await getGtmAccessToken({ businessId: conn.businessId });
      const liveTags = await fetchLiveContainerTags(accessToken, accountId, containerId);

      for (const liveTag of liveTags) {
        const issues = inspectPublishedGtmTag(liveTag);
        if (issues.length === 0) continue;

        affected.push({
          source: 'published_container',
          businessId: String(conn.businessId),
          accountId: String(accountId),
          containerId: String(containerId),
          publicContainerId,
          tagId: liveTag.tagId != null ? String(liveTag.tagId) : null,
          tagName: liveTag.name ?? null,
          issues,
        });
      }
    } catch (err) {
      skipped.push({
        businessId: String(conn.businessId),
        accountId: String(accountId),
        containerId: String(containerId),
        reason: err instanceof Error ? err.message : 'published_scan_failed',
        status: err?.status ?? null,
      });
    }
  }

  return { scanned: connections.length, affected, skipped };
}

async function runInventory() {
  const uri = process.env.MONGODB_URI || process.env.mongodb_uri;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);

  const artifactScan = await scanArtifactTags();
  const publishedScan = await scanPublishedContainers();

  const inventorySummary = summarizeGtmConversionTagInventory(artifactScan, publishedScan);

  const summary = {
    artifactScan: {
      scanned: artifactScan.scanned,
      affected: artifactScan.affected.length,
    },
    publishedContainerScan: {
      scanned: publishedScan.scanned,
      affected: publishedScan.affected.length,
      skipped: publishedScan.skipped,
    },
    scanned: artifactScan.scanned + publishedScan.scanned,
    affected: inventorySummary.affected,
    affectedArtifacts: inventorySummary.affectedArtifacts,
    provenClean: inventorySummary.provenClean,
    repairRequired: inventorySummary.repairRequired,
  };

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  process.exit(summary.repairRequired ? 2 : 0);
}

runInventory().catch((err) => {
  console.error(err);
  process.exit(1);
});
