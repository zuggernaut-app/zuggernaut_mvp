'use strict';

jest.mock('axios');
jest.mock('dns', () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const axios = require('axios');
const dns = require('dns').promises;
const {
  SsrfError,
  isPrivateOrReservedIp,
  isBlockedHostname,
  resolvePublicIp,
  assertUrlAllowed,
  createPinnedAgent,
  ssrfSafeGet,
} = require('../lib/ssrf');

describe('ssrf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dns.resolve4.mockResolvedValue(['93.184.216.34']);
    dns.resolve6.mockRejectedValue(new Error('no AAAA'));
  });

  it('blocks private IPv4 addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
  });

  it('blocks IPv4-mapped private IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:93.184.216.34')).toBe(false);
  });

  it('blocks localhost hostnames', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    expect(isBlockedHostname('example.com')).toBe(false);
  });

  it('rejects direct private IP URLs', async () => {
    await expect(assertUrlAllowed('http://127.0.0.1/')).rejects.toThrow(SsrfError);
  });

  it('rejects hostnames that resolve to private IPs', async () => {
    dns.resolve4.mockResolvedValue(['10.0.0.5']);
    await expect(assertUrlAllowed('http://evil.example/')).rejects.toThrow(SsrfError);
  });

  it('allows public hostnames with public DNS results', async () => {
    await expect(assertUrlAllowed('https://example.com/')).resolves.toBeTruthy();
  });

  it('re-validates redirect targets', async () => {
    axios.get
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
        data: '',
      });

    await expect(ssrfSafeGet('https://example.com/')).rejects.toThrow(SsrfError);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('follows safe redirects with connection-time pin', async () => {
    dns.resolve4.mockResolvedValue(['93.184.216.34']);
    axios.get
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: '/landing' },
        data: '',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: '<html>ok</html>',
      });

    const res = await ssrfSafeGet('https://example.com/');
    expect(res.status).toBe(200);
    expect(axios.get).toHaveBeenCalledTimes(2);
    const secondCall = axios.get.mock.calls[1][0];
    expect(secondCall).toBe('https://example.com/landing');
  });

  it('resolvePublicIp rejects blocked hostnames', async () => {
    await expect(resolvePublicIp('localhost')).rejects.toThrow(SsrfError);
  });

  describe('createPinnedAgent lookup', () => {
    const pinnedIp = '93.184.216.34';

    function agentLookup(secure) {
      const agent = createPinnedAgent(pinnedIp, secure);
      return agent.options.lookup;
    }

    it('returns single address when options.all is false', () => {
      const lookup = agentLookup(false);
      lookup('example.com', { all: false }, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe(pinnedIp);
        expect(family).toBe(4);
      });
    });

    it('returns address array when options.all is true (Node 20+ autoSelectFamily)', () => {
      const lookup = agentLookup(false);
      lookup('example.com', { all: true }, (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual([{ address: pinnedIp, family: 4 }]);
      });
    });

    it('supports two-argument lookup(hostname, callback) form', () => {
      const lookup = agentLookup(true);
      lookup('example.com', (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe(pinnedIp);
        expect(family).toBe(4);
      });
    });
  });
});
