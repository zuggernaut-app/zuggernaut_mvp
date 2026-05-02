'use strict';

/** RFC 5321 local+domain practical limit */
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_SINGLE_LINE_FIELD = 500;
const MAX_ARRAY_ITEMS = 100;
const MAX_ARRAY_ITEM_LENGTH = 500;

/** Intentionally conservative; rejects obvious garbage without claiming full RFC 5322 compliance */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  return e.length > 0 && e.length <= MAX_EMAIL_LENGTH && EMAIL_REGEX.test(e);
}

function validateHttpUrl(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'websiteUrl must be a non-empty string' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: 'websiteUrl is required' };
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, message: `websiteUrl must be at most ${MAX_URL_LENGTH} characters` };
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: 'websiteUrl must use http or https' };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, message: 'Invalid websiteUrl' };
  }
}

/**
 * @param {unknown} val
 * @param {string} fieldName
 * @returns {{ ok: true, value: string[] } | { ok: false, message: string }}
 */
function normalizeStringList(val, fieldName) {
  if (!Array.isArray(val)) {
    return { ok: false, message: `${fieldName} must be an array of strings` };
  }
  if (val.length > MAX_ARRAY_ITEMS) {
    return {
      ok: false,
      message: `${fieldName} must have at most ${MAX_ARRAY_ITEMS} items`,
    };
  }
  const out = [];
  for (let i = 0; i < val.length; i++) {
    const item = val[i];
    if (typeof item !== 'string') {
      return { ok: false, message: `${fieldName}[${i}] must be a string` };
    }
    const t = item.trim();
    if (!t) continue;
    if (t.length > MAX_ARRAY_ITEM_LENGTH) {
      return {
        ok: false,
        message: `${fieldName}[${i}] must be at most ${MAX_ARRAY_ITEM_LENGTH} characters`,
      };
    }
    out.push(t);
  }
  return { ok: true, value: out };
}

/**
 * Mixed fields: JSON object or null (clear). No arrays/dates/primitives.
 * @param {unknown} val
 * @param {string} fieldName
 */
function validateMixedObjectOrNull(val, fieldName) {
  if (val === null) return { ok: true, value: null };
  if (val === undefined) return { ok: true, value: undefined };
  if (typeof val !== 'object' || Array.isArray(val) || val instanceof Date) {
    return {
      ok: false,
      message: `${fieldName} must be a JSON object or null`,
    };
  }
  return { ok: true, value: val };
}

module.exports = {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
  MAX_SINGLE_LINE_FIELD,
  MAX_ARRAY_ITEMS,
  MAX_ARRAY_ITEM_LENGTH,
  isValidEmail,
  validateHttpUrl,
  normalizeStringList,
  validateMixedObjectOrNull,
};
