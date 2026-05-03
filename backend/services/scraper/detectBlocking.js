'use strict';

const CF_HINTS = [/cloudflare/i, /cf-ray/i];
const CHALLENGE_TITLE = /attention required|access denied|just a moment|checking your browser|enable javascript and cookies/i;
const CHALLENGE_BODY = /cf-browser-verification|challenge-platform|turnstile|captcha|hcaptcha|verify you are human/i;

/**
 * @param {string} html
 * @param {Record<string, string>} headers
 * @returns {{ blocked: boolean, partialBlock: boolean, reasons: string[] }}
 */
function detectBlocking(html, headers) {
  const reasons = [];
  const h = headers && typeof headers === 'object' ? headers : {};
  const lowerKeys = Object.keys(h).reduce((acc, k) => {
    acc[k.toLowerCase()] = h[k];
    return acc;
  }, /** @type {Record<string, string>} */ ({}));

  for (const hint of CF_HINTS) {
    for (const [k, v] of Object.entries(lowerKeys)) {
      if (hint.test(k) || (typeof v === 'string' && hint.test(v))) {
        reasons.push('cloudflare_header');
        break;
      }
    }
  }

  const sample = typeof html === 'string' ? html.slice(0, 120_000) : '';
  if (sample && CHALLENGE_BODY.test(sample)) {
    reasons.push('challenge_markup');
  }

  let title = '';
  const tm = /<title[^>]*>([^<]*)<\/title>/i.exec(sample);
  if (tm) title = tm[1].trim();
  if (title && CHALLENGE_TITLE.test(title)) {
    reasons.push('challenge_title');
  }

  const blocked = reasons.length > 0 && !hasSubstantialText(sample);

  return {
    blocked,
    /** Page may still have some readable bits (partial). */
    partialBlock: reasons.length > 0 && !blocked,
    reasons: [...new Set(reasons)],
  };
}

function hasSubstantialText(html) {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = stripped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 400;
}

module.exports = { detectBlocking };
