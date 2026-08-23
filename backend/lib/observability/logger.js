const pino = require('pino');

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'headers.authorization',
  'headers.Authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'password',
  'accessToken',
  'refreshToken',
  'accessTokenEnc',
  'refreshTokenEnc',
  'token',
  'secret',
  'responseBody',
  '*.accessToken',
  '*.refreshToken',
  '*.accessTokenEnc',
  '*.refreshTokenEnc',
  '*.password',
  '*.token',
  '*.secret',
  '*.responseBody',
];

function createLogger(options = {}, destination) {
  const config = {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    ...options,
  };

  return destination ? pino(config, destination) : pino(config);
}

module.exports = {
  REDACT_PATHS,
  createLogger,
};
