'use strict';

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const axios = require('axios');

class SsrfError extends Error {
  /**
   * @param {string} code
   * @param {string} [detail]
   */
  constructor(code, detail) {
    super(detail ? `SSRF blocked: ${code} (${detail})` : `SSRF blocked: ${code}`);
    this.name = 'SsrfError';
    this.code = code;
  }
}

/**
 * @param {string} ip
 */
function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('::ffff:')) {
      const embeddedIpv4 = lower.slice('::ffff:'.length);
      if (net.isIPv4(embeddedIpv4)) {
        return isPrivateOrReservedIp(embeddedIpv4);
      }
    }
    return false;
  }
  return true;
}

/**
 * @param {string} hostname
 */
function isBlockedHostname(hostname) {
  const h = String(hostname).toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal') return true;
  return false;
}

/**
 * @param {string} rawUrl
 */
function parseHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError('invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfError('unsupported_protocol', parsed.protocol);
  }
  if (!parsed.hostname) {
    throw new SsrfError('missing_hostname');
  }
  return parsed;
}

/**
 * Resolve hostname and return the first public IP. Rejects if any resolved address is private.
 * @param {string} hostname
 */
async function resolvePublicIp(hostname) {
  if (isBlockedHostname(hostname)) {
    throw new SsrfError('blocked_hostname', hostname);
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfError('blocked_ip', hostname);
    }
    return hostname;
  }

  const addresses = [];
  try {
    addresses.push(...(await dns.resolve4(hostname)));
  } catch {
    /* no A records */
  }
  try {
    addresses.push(...(await dns.resolve6(hostname)));
  } catch {
    /* no AAAA records */
  }

  if (addresses.length === 0) {
    throw new SsrfError('dns_resolution_failed', hostname);
  }

  for (const ip of addresses) {
    if (isPrivateOrReservedIp(ip)) {
      throw new SsrfError('blocked_ip', ip);
    }
  }

  return addresses[0];
}

/**
 * @param {string} rawUrl
 */
async function assertUrlAllowed(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  await resolvePublicIp(parsed.hostname);
  return parsed;
}

/**
 * @param {string} pinnedIp
 * @param {boolean} secure
 */
function createPinnedAgent(pinnedIp, secure) {
  const family = net.isIPv6(pinnedIp) ? 6 : 4;
  const lookup = (_hostname, options, callback) => {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    } else if (typeof opts === 'number') {
      opts = { family: opts };
    } else if (!opts) {
      opts = {};
    }

    if (opts.all) {
      cb(null, [{ address: pinnedIp, family }]);
    } else {
      cb(null, pinnedIp, family);
    }
  };
  return secure ? new https.Agent({ lookup, keepAlive: true }) : new http.Agent({ lookup, keepAlive: true });
}

/**
 * Fetch a URL with SSRF controls: DNS blocklist, connection-time IP pin, redirect re-validation.
 * @param {string} rawUrl
 * @param {import('axios').AxiosRequestConfig} [options]
 */
async function ssrfSafeGet(rawUrl, options = {}) {
  const maxRedirects =
    typeof options.maxRedirects === 'number' ? options.maxRedirects : 5;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = parseHttpUrl(current);
    const pinnedIp = await resolvePublicIp(parsed.hostname);
    const secure = parsed.protocol === 'https:';

    const response = await axios.get(current, {
      ...options,
      maxRedirects: 0,
      httpAgent: createPinnedAgent(pinnedIp, false),
      httpsAgent: createPinnedAgent(pinnedIp, true),
      validateStatus: options.validateStatus ?? (() => true),
    });

    if (response.status >= 300 && response.status < 400 && response.headers?.location) {
      current = new URL(response.headers.location, current).href;
      continue;
    }

    return response;
  }

  throw new SsrfError('too_many_redirects', rawUrl);
}

module.exports = {
  SsrfError,
  isPrivateOrReservedIp,
  isBlockedHostname,
  parseHttpUrl,
  resolvePublicIp,
  assertUrlAllowed,
  createPinnedAgent,
  ssrfSafeGet,
};
