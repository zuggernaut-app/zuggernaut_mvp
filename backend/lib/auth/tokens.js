'use strict';

const jwt = require('jsonwebtoken');

const JWT_ISS = 'zuggernaut-api';
const JWT_ALG = 'HS256';

function getJwtExpiresInString() {
  return process.env.JWT_EXPIRES_IN?.trim() || '2h';
}

function verifyJwtConfigured() {
  if (process.env.NODE_ENV === 'test') return;

  const secret = process.env.JWT_SECRET;

  if (!secret || typeof secret !== 'string') {
    throw new Error('JWT_SECRET must be set');
  }

  if (secret.length < 32) {
    throw new Error(`JWT_SECRET must be at least 32 characters (got ${secret.length})`);
  }
}

/** @param {{ userId: string, email: string }} claims */
function signAccessToken({ userId, email }) {
  verifyJwtConfigured();

  const secret = process.env.JWT_SECRET;

  /** @type {import('jsonwebtoken').SignOptions} */
  const opts = {
    expiresIn: getJwtExpiresInString(),
    algorithm: JWT_ALG,
    issuer: JWT_ISS,
    subject: userId,
  };

  const payload = { email };

  return jwt.sign(payload, secret, opts);
}

function verifyAccessToken(rawToken) {
  verifyJwtConfigured();

  const secret = process.env.JWT_SECRET;

  try {
    return jwt.verify(rawToken, secret, {
      algorithms: [JWT_ALG],
      issuer: JWT_ISS,
      complete: false,
    });
  } catch {
    return null;
  }
}

module.exports = {
  JWT_ISS,
  signAccessToken,
  verifyAccessToken,
  verifyJwtConfigured,
  getJwtExpiresInString,
};
