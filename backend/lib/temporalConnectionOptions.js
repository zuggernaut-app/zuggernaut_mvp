'use strict';

const { resolveTemporalAddress } = require('../constants/temporalDefaults');

/**
 * @param {string | undefined} value — PEM text or base64-encoded PEM
 * @returns {Buffer | null}
 */
function decodePemFromEnv(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('-----BEGIN')) {
    return Buffer.from(trimmed, 'utf8');
  }
  return Buffer.from(trimmed, 'base64');
}

function isTemporalCloudTlsEnabled() {
  const flag = process.env.TEMPORAL_CLOUD_TLS?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

/**
 * Shared Connection / NativeConnection options for API client and worker.
 * Local dev: `TEMPORAL_CLOUD_TLS` unset → `tls: false`.
 * Temporal Cloud: `TEMPORAL_CLOUD_TLS=true` + mTLS cert/key env vars.
 */
function resolveTemporalConnectOptions() {
  const address = resolveTemporalAddress();

  if (!isTemporalCloudTlsEnabled()) {
    return { address, tls: false };
  }

  const clientCert = decodePemFromEnv(process.env.TEMPORAL_CLIENT_CERT);
  const clientKey = decodePemFromEnv(process.env.TEMPORAL_CLIENT_KEY);
  if (!clientCert || !clientKey) {
    throw new Error(
      'TEMPORAL_CLOUD_TLS=true requires TEMPORAL_CLIENT_CERT and TEMPORAL_CLIENT_KEY (PEM or base64).'
    );
  }

  /** @type {import('@temporalio/client').TLSConfig} */
  const tls = {
    clientCertPair: {
      crt: clientCert,
      key: clientKey,
    },
  };

  const serverNameOverride = process.env.TEMPORAL_SERVER_NAME_OVERRIDE?.trim();
  if (serverNameOverride) {
    tls.serverNameOverride = serverNameOverride;
  }

  return { address, tls };
}

module.exports = {
  decodePemFromEnv,
  isTemporalCloudTlsEnabled,
  resolveTemporalConnectOptions,
};
