'use strict';

const axios = require('axios');

const SCRAPER_UA =
  process.env.SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (compatible; ZuggernautBot/1.0; +https://example.com/contact)';

/**
 * Minimal robots.txt parser for `User-agent: *` group (Disallow only).
 * @param {string} text
 * @returns {string[]}
 */
function parseDisallowRules(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  let applies = false;
  const disallows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const ua = /^user-agent:\s*(.+)$/i.exec(trimmed);
    if (ua) {
      applies = ua[1].trim().toLowerCase() === '*' || ua[1].trim() === '*';
      continue;
    }
    if (!applies) continue;
    const dis = /^disallow:\s*(.*)$/i.exec(trimmed);
    if (dis) {
      const path = dis[1].trim();
      if (path) disallows.push(path);
    }
  }
  return disallows;
}

function pathMatchesDisallow(pathname, rule) {
  if (!rule) return false;
  if (rule === '/') return true;
  const p = pathname || '/';
  try {
    return p.startsWith(rule);
  } catch {
    return false;
  }
}

/**
 * @param {string} pathname
 * @param {string[]} disallows
 */
function isPathAllowed(pathname, disallows) {
  return !disallows.some((r) => pathMatchesDisallow(pathname, r));
}

/**
 * @param {string} websiteUrl normalized http(s) URL
 * @returns {Promise<{ allowed: boolean, reason: string, disallows?: string[] }>}
 */
async function checkRobotsAllowedForUrl(websiteUrl) {
  let u;
  try {
    u = new URL(websiteUrl);
  } catch {
    return { allowed: false, reason: 'invalid_url' };
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    return { allowed: false, reason: 'unsupported_protocol' };
  }

  const robotsUrl = new URL('/robots.txt', u.origin).href;

  try {
    const res = await axios.get(robotsUrl, {
      timeout: 8000,
      maxRedirects: 3,
      maxContentLength: 256 * 1024,
      validateStatus: (s) => s >= 200 && s < 500,
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/plain,*/*' },
    });

    if (res.status === 404 || res.status === 403) {
      return { allowed: true, reason: 'no_applicable_robots', disallows: [] };
    }
    if (res.status !== 200 || typeof res.data !== 'string') {
      return { allowed: true, reason: 'robots_unavailable_assume_allowed', disallows: [] };
    }

    const disallows = parseDisallowRules(res.data);
    const allowed = isPathAllowed(u.pathname || '/', disallows);
    return {
      allowed,
      reason: allowed ? 'robots_allow' : 'robots_disallow',
      disallows,
    };
  } catch {
    return { allowed: true, reason: 'robots_fetch_failed_assume_allowed', disallows: [] };
  }
}

module.exports = {
  SCRAPER_UA,
  checkRobotsAllowedForUrl,
  parseDisallowRules,
  isPathAllowed,
};
