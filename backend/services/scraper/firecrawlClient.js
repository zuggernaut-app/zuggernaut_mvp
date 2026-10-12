'use strict';

const axios = require('axios');
const { assertUrlAllowed } = require('../../lib/ssrf');

const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v1';

/**
 * Fetch page markdown via Firecrawl. Required only on the Railway worker (`FIRECRAWL_API_KEY`).
 * Never throws — returns null on any failure.
 *
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function fetchWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) return null;

  const target = typeof url === 'string' ? url.trim() : '';
  if (!target) return null;

  try {
    await assertUrlAllowed(target);
  } catch {
    return null;
  }

  try {
    const res = await axios.post(
      `${FIRECRAWL_API_BASE}/scrape`,
      { url: target, formats: ['markdown'] },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
        validateStatus: (s) => s >= 200 && s < 500,
      }
    );

    if (res.status >= 400) return null;
    const markdown = res.data?.data?.markdown ?? res.data?.markdown;
    if (typeof markdown !== 'string' || !markdown.trim()) return null;
    return markdown.trim();
  } catch {
    return null;
  }
}

module.exports = { fetchWithFirecrawl };
