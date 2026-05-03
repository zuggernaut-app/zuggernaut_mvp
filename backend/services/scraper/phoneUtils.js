'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js/min');

/** @param {string} host */
function inferDefaultCountryFromUrl(host) {
  if (!host || typeof host !== 'string') return 'US';
  const h = host.replace(/^www\./, '').toLowerCase();
  const tld = h.split('.').pop() || '';
  const map = {
    uk: 'GB',
    gb: 'GB',
    ca: 'CA',
    au: 'AU',
    de: 'DE',
    fr: 'FR',
    in: 'IN',
    ie: 'IE',
    nz: 'NZ',
    jp: 'JP',
  };
  return map[tld] || 'US';
}

/**
 * @param {string} text
 * @param {string} defaultCountry ISO2
 */
function extractPhonesFromText(text, defaultCountry) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const seen = new Set();
  const re = /(\+?\d[\d\s().-]{7,}\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    const parsed = parseInternationalPhone(raw, defaultCountry);
    if (parsed && !seen.has(parsed.dedupeKey)) {
      seen.add(parsed.dedupeKey);
      out.push(parsed);
    }
  }
  return out;
}

/**
 * @param {string} raw
 * @param {string} defaultCountry
 */
function parseInternationalPhone(raw, defaultCountry) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.replace(/^tel:/i, '').trim();
  const ext = /(?:ext|x)[.: ]?\s*(\d+)/i.exec(s);
  if (ext) s = s.slice(0, ext.index).trim();

  const p = parsePhoneNumberFromString(s, defaultCountry);
  if (!p || !p.isValid()) return null;
  return {
    display: p.formatInternational(),
    e164: p.number,
    country: p.country || defaultCountry,
    dedupeKey: p.number,
  };
}

module.exports = {
  inferDefaultCountryFromUrl,
  extractPhonesFromText,
  parseInternationalPhone,
};
