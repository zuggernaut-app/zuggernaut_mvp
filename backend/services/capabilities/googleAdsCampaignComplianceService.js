'use strict';

const {
  ADS_INTENT_CODES,
  ALLOWED_KEYWORD_MATCH_TYPES,
  MAX_KEYWORD_TEXT_CHARS,
} = require('../../constants/adsCampaignIntent');

/** Google Ads documented keyword word limit. */
const MAX_KEYWORD_WORDS = 10;

/** V1 conservative allowlist: Unicode letters, digits, spaces only. */
const KEYWORD_COMPLIANT_PATTERN = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u;

/** Separators replaced with spaces before allowlist filtering. */
const KEYWORD_SEPARATOR_PATTERN = /[&/|+_-]/g;

/** Explicit unsafe symbols removed (V1 conservative policy). Quotes handled separately. */
const KEYWORD_UNSAFE_SYMBOL_PATTERN = /[#@!?*%$^=<>{}\[\]()]/g;

/**
 * @typedef {object} KeywordSanitizeResult
 * @property {string} text
 * @property {string} raw
 * @property {boolean} changed
 * @property {boolean} empty
 */

/**
 * @typedef {object} KeywordComplianceIssue
 * @property {string} code
 * @property {string} field
 * @property {string} message
 * @property {'keywords'} bucket
 */

/**
 * @param {string} text
 * @param {number} maxChars
 */
function truncateKeywordWithoutMidWord(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) {
    return slice.slice(0, lastSpace).trim();
  }

  return slice.trim();
}

/**
 * @param {string | undefined | null} rawText
 * @returns {KeywordSanitizeResult}
 */
function sanitizeKeywordText(rawText) {
  const raw = String(rawText ?? '');
  let text = raw.replace(/\s+/g, ' ').trim();
  text = text.replace(/[''`"]/g, '');
  text = text.replace(KEYWORD_SEPARATOR_PATTERN, ' ');
  text = text.replace(KEYWORD_UNSAFE_SYMBOL_PATTERN, ' ');
  text = text.replace(/[\x00-\x1F\x7F]/g, ' ');
  text = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  const words = text.split(' ').filter(Boolean);
  if (words.length > MAX_KEYWORD_WORDS) {
    text = words.slice(0, MAX_KEYWORD_WORDS).join(' ');
  }

  if (text.length > MAX_KEYWORD_TEXT_CHARS) {
    text = truncateKeywordWithoutMidWord(text, MAX_KEYWORD_TEXT_CHARS);
  }

  text = text.replace(/\s+/g, ' ').trim();

  return {
    text,
    raw,
    changed: text !== raw.replace(/\s+/g, ' ').trim(),
    empty: text.length === 0,
  };
}

/**
 * @param {string | undefined | null} rawSeed
 * @returns {KeywordSanitizeResult}
 */
function sanitizeKeywordSeed(rawSeed) {
  return sanitizeKeywordText(rawSeed);
}

/**
 * @param {string | undefined | null} text
 */
function countKeywordWords(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * @param {string | undefined | null} text
 */
function isKeywordTextCompliant(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }
  if (normalized.length > MAX_KEYWORD_TEXT_CHARS) {
    return false;
  }
  if (countKeywordWords(normalized) > MAX_KEYWORD_WORDS) {
    return false;
  }
  return KEYWORD_COMPLIANT_PATTERN.test(normalized);
}

/**
 * @param {string[]} keywordSeeds
 * @returns {{ keywords: { text: string, matchType: string }[], rejected: { raw: string, reason: string }[] }}
 */
function sanitizeKeywordSeeds(keywordSeeds) {
  const keywords = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of keywordSeeds ?? []) {
    const result = sanitizeKeywordSeed(raw);
    if (result.empty) {
      rejected.push({ raw: result.raw, reason: ADS_INTENT_CODES.KEYWORD_SANITIZED_EMPTY });
      continue;
    }
    if (!isKeywordTextCompliant(result.text)) {
      rejected.push({ raw: result.raw, reason: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS });
      continue;
    }

    const key = result.text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    keywords.push({ text: result.text, matchType: 'PHRASE' });
  }

  return { keywords, rejected };
}

/**
 * @param {string} code
 * @param {string} field
 * @param {string} message
 * @returns {KeywordComplianceIssue}
 */
function complianceIssue(code, field, message) {
  return { code, field, message, bucket: 'keywords' };
}

/**
 * @param {{ text?: string, matchType?: string }[]} keywords
 * @param {string} [fieldPrefix]
 * @returns {{ ok: true } | { ok: false, issues: KeywordComplianceIssue[] }}
 */
function validateKeywordCompliance(keywords, fieldPrefix = 'keywords') {
  const issues = [];
  const rows = Array.isArray(keywords) ? keywords : [];

  if (rows.length < 1) {
    issues.push(
      complianceIssue(
        ADS_INTENT_CODES.MISSING_KEYWORDS,
        fieldPrefix,
        'At least one keyword is required for campaign setup.'
      )
    );
    return { ok: false, issues };
  }

  const seenKeywords = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const field = `${fieldPrefix}[${index}].text`;
    const text = String(row?.text ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      issues.push(complianceIssue(ADS_INTENT_CODES.INVALID_KEYWORD, field, 'Keyword text is required.'));
      continue;
    }

    if (text.length > MAX_KEYWORD_TEXT_CHARS) {
      issues.push(
        complianceIssue(
          ADS_INTENT_CODES.INVALID_KEYWORD,
          field,
          `Keyword text must be at most ${MAX_KEYWORD_TEXT_CHARS} characters.`
        )
      );
    }

    const wordCount = countKeywordWords(text);
    if (wordCount > MAX_KEYWORD_WORDS) {
      issues.push(
        complianceIssue(
          ADS_INTENT_CODES.KEYWORD_TOO_MANY_WORDS,
          field,
          `Keyword text must be at most ${MAX_KEYWORD_WORDS} words.`
        )
      );
    }

    if (!isKeywordTextCompliant(text)) {
      issues.push(
        complianceIssue(
          ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
          field,
          'Keyword text contains invalid characters or symbols.'
        )
      );
    }

    const matchType = row?.matchType;
    if (!ALLOWED_KEYWORD_MATCH_TYPES.includes(matchType)) {
      issues.push(
        complianceIssue(
          ADS_INTENT_CODES.INVALID_KEYWORD_MATCH_TYPE,
          `${fieldPrefix}[${index}].matchType`,
          'Keyword match type must be PHRASE, EXACT, or BROAD.'
        )
      );
    }

    const key = text.toLowerCase();
    if (seenKeywords.has(key)) {
      issues.push(
        complianceIssue(ADS_INTENT_CODES.DUPLICATE_KEYWORD, field, `Duplicate keyword: ${text}`)
      );
    } else {
      seenKeywords.add(key);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true };
}

/**
 * Re-sanitize intent keywords deterministically (idempotent when already compliant).
 *
 * @param {object} intent
 * @returns {object}
 */
function applyKeywordComplianceToIntent(intent) {
  const data = intent ?? {};
  const currentKeywords = Array.isArray(data.keywords) ? data.keywords : [];
  const seedTexts = currentKeywords.map((row) => String(row?.text ?? ''));
  const { keywords } = sanitizeKeywordSeeds(seedTexts.length > 0 ? seedTexts : []);

  return {
    ...data,
    keywords,
  };
}

/**
 * Pre-mutate compliance gate for keyword bucket.
 *
 * @param {object} intent
 * @returns {object}
 */
function assertGoogleAdsCampaignCompliance(intent) {
  const compliance = validateKeywordCompliance(intent?.keywords ?? []);
  if (!compliance.ok) {
    const err = new Error(compliance.issues[0].message);
    err.name = 'GoogleAdsCampaignComplianceError';
    err.code = compliance.issues[0].code;
    err.issues = compliance.issues;
    throw err;
  }
  return intent;
}

module.exports = {
  MAX_KEYWORD_WORDS,
  KEYWORD_COMPLIANT_PATTERN,
  sanitizeKeywordText,
  sanitizeKeywordSeed,
  sanitizeKeywordSeeds,
  countKeywordWords,
  isKeywordTextCompliant,
  validateKeywordCompliance,
  applyKeywordComplianceToIntent,
  assertGoogleAdsCampaignCompliance,
};
