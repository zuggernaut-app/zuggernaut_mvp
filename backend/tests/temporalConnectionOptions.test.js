'use strict';

const {
  decodePemFromEnv,
  isTemporalCloudTlsEnabled,
  resolveTemporalConnectOptions,
} = require('../lib/temporalConnectionOptions');
const { resolveTemporalAddress } = require('../constants/temporalDefaults');

describe('temporalConnectionOptions', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('uses tls:false for local Temporal when TEMPORAL_CLOUD_TLS is unset', () => {
    delete process.env.TEMPORAL_CLOUD_TLS;
    process.env.TEMPORAL_ADDRESS = '127.0.0.1:7233';

    expect(resolveTemporalConnectOptions()).toEqual({
      address: '127.0.0.1:7233',
      tls: false,
    });
  });

  it('builds mTLS options when TEMPORAL_CLOUD_TLS=true', () => {
    process.env.TEMPORAL_CLOUD_TLS = 'true';
    process.env.TEMPORAL_ADDRESS = 'cloud.example:7233';
    process.env.TEMPORAL_CLIENT_CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    process.env.TEMPORAL_CLIENT_KEY = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----';
    process.env.TEMPORAL_SERVER_NAME_OVERRIDE = 'namespace.tmprl.cloud';

    const opts = resolveTemporalConnectOptions();

    expect(opts.address).toBe('cloud.example:7233');
    expect(opts.tls).toMatchObject({
      serverNameOverride: 'namespace.tmprl.cloud',
      clientCertPair: {
        crt: expect.any(Buffer),
        key: expect.any(Buffer),
      },
    });
    expect(opts.tls.clientCertPair.crt.toString('utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('throws when TEMPORAL_CLOUD_TLS=true but cert/key are missing', () => {
    process.env.TEMPORAL_CLOUD_TLS = 'true';
    delete process.env.TEMPORAL_CLIENT_CERT;
    delete process.env.TEMPORAL_CLIENT_KEY;

    expect(() => resolveTemporalConnectOptions()).toThrow(/TEMPORAL_CLIENT_CERT/);
  });

  it('decodes base64 PEM env values', () => {
    const pem = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
    const encoded = Buffer.from(pem, 'utf8').toString('base64');
    expect(decodePemFromEnv(encoded)?.toString('utf8')).toBe(pem);
  });

  it('isTemporalCloudTlsEnabled respects true/1 only', () => {
    process.env.TEMPORAL_CLOUD_TLS = 'true';
    expect(isTemporalCloudTlsEnabled()).toBe(true);
    process.env.TEMPORAL_CLOUD_TLS = '1';
    expect(isTemporalCloudTlsEnabled()).toBe(true);
    process.env.TEMPORAL_CLOUD_TLS = 'false';
    expect(isTemporalCloudTlsEnabled()).toBe(false);
  });

  it('defaults address via resolveTemporalAddress', () => {
    delete process.env.TEMPORAL_ADDRESS;
    expect(resolveTemporalConnectOptions().address).toBe(resolveTemporalAddress());
  });
});
