'use strict';

const crypto = require('crypto');

/**
 * Canonical minimal intent fingerprint — stable product fields only.
 * Excludes volatile scrape text and direct PII (email/phone in contactMethods).
 *
 * @param {object} bc — BusinessContext lean document
 * @returns {string} 16-char hex fingerprint
 */
function computeBusinessIntentFingerprint(bc) {
  const businessName = typeof bc?.businessName === 'string' ? bc.businessName.trim().toLowerCase() : '';
  const websiteHost = extractWebsiteHost(bc?.websiteUrl);
  const goals = bc?.goals && typeof bc.goals === 'object' ? bc.goals : {};
  const primaryGoal =
    typeof goals.primary === 'string'
      ? goals.primary.trim().toLowerCase()
      : typeof goals.resolvedPrimaryGoal === 'string'
        ? goals.resolvedPrimaryGoal.trim().toLowerCase()
        : '';
  const serviceAreas = Array.isArray(bc?.serviceAreas)
    ? [...bc.serviceAreas]
        .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
        .filter(Boolean)
        .sort()
        .join('|')
    : '';

  const canonical = `${businessName}|${websiteHost}|${primaryGoal}|${serviceAreas}`;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

function extractWebsiteHost(websiteUrl) {
  if (typeof websiteUrl !== 'string' || websiteUrl.trim().length === 0) return '';
  try {
    const u = new URL(websiteUrl.trim());
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

module.exports = {
  computeBusinessIntentFingerprint,
  extractWebsiteHost,
};
