'use strict';

const { safeProviderIdentifiers } = require('../../../../backend/services/capabilities/integrationConnectionService');

/**
 * @param {unknown} value
 */
function redactId(value) {
  if (value == null) return null;
  const s = String(value).replace(/-/g, '');
  if (s.length <= 4) return '****';
  return `…${s.slice(-4)}`;
}

/**
 * @param {Record<string, unknown> | null | undefined} raw
 */
function sanitizeIdentifiers(raw) {
  const safe = safeProviderIdentifiers(raw);
  if (!safe || typeof safe !== 'object') return null;
  const out = { ...safe };
  if (out.customerId != null) out.customerId = redactId(out.customerId);
  if (out.loginCustomerId != null) out.loginCustomerId = redactId(out.loginCustomerId);
  if (out.managerCustomerId != null) out.managerCustomerId = redactId(out.managerCustomerId);
  if (Array.isArray(out.accessibleCustomerIds)) {
    out.accessibleCustomerIds = out.accessibleCustomerIds.map((id) => redactId(id));
  }
  if (typeof out.locationName === 'string' && out.locationName.length > 48) {
    out.locationName = `${out.locationName.slice(0, 24)}…`;
  }
  return out;
}

module.exports = {
  redactId,
  sanitizeIdentifiers,
};
