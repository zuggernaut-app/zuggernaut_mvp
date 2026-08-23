'use strict';

const mongoose = require('mongoose');

/**
 * First five characters of a slug derived from the business name.
 * @param {string | null | undefined} businessName
 * @returns {string}
 */
function slug5FromBusinessName(businessName) {
  const raw = String(businessName ?? '').trim();
  if (!raw) {
    return 'biz';
  }
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = cleaned || 'biz';
  return base.slice(0, 5);
}

/**
 * Last six hex characters from a businessId ObjectId string.
 * @param {mongoose.Types.ObjectId | string | null | undefined} businessId
 * @returns {string}
 */
function id6FromBusinessId(businessId) {
  const hex = String(businessId ?? '').replace(/[^a-fA-F0-9]/g, '');
  if (hex.length >= 6) {
    return hex.slice(-6).toLowerCase();
  }
  const oid =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(String(businessId));
  return oid.toString().replace(/[^a-f0-9]/g, '').slice(-6);
}

/**
 * Stable per-business key frozen at first context confirm (slug5-id6).
 * @param {string | null | undefined} businessName
 * @param {mongoose.Types.ObjectId | string} businessId
 * @returns {string}
 */
function deriveBusinessNameKey(businessName, businessId) {
  return `${slug5FromBusinessName(businessName)}-${id6FromBusinessId(businessId)}`;
}

/**
 * @param {string | null | undefined} nameKey
 * @param {string} label
 * @returns {string}
 */
function zugGtmResourceLabel(nameKey, label) {
  const key = String(nameKey ?? '').trim();
  if (!key) {
    return `Zuggernaut ${label}`;
  }
  return `ZUG · ${key} · ${label}`;
}

/**
 * @param {string | null | undefined} nameKey
 * @param {'form' | 'call'} logicalCategory
 * @returns {string | null}
 */
function zugConversionActionName(nameKey, logicalCategory) {
  const key = String(nameKey ?? '').trim();
  if (!key) {
    return null;
  }
  if (logicalCategory === 'form') {
    return `ZUG · ${key} · Form Submission`;
  }
  if (logicalCategory === 'call') {
    return `ZUG · ${key} · Phone Call`;
  }
  return null;
}

module.exports = {
  deriveBusinessNameKey,
  slug5FromBusinessName,
  id6FromBusinessId,
  zugGtmResourceLabel,
  zugConversionActionName,
};
