'use strict';

const crypto = require('crypto');
const https = require('https');

/**
 * Check Have I Been Pwned Pwned Passwords range API (k-anonymity).
 * @param {string} password
 * @returns {Promise<boolean>} true if the password appears in the breach corpus
 */
function isPasswordPwned(password) {
  return new Promise((resolve, reject) => {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const req = https.get(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      { headers: { 'Add-Padding': 'true' }, timeout: 5000 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HIBP range API returned ${res.statusCode}`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const found = body.split('\n').some((line) => {
            const [hashSuffix] = line.split(':');
            return hashSuffix?.trim() === suffix;
          });
          resolve(found);
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HIBP range API timed out'));
    });
  });
}

/**
 * @param {string} password
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function assertPasswordNotPwned(password) {
  try {
    const pwned = await isPasswordPwned(password);
    if (pwned) {
      return {
        ok: false,
        message:
          'This password has appeared in a data breach. Choose a different password.',
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

module.exports = { assertPasswordNotPwned, isPasswordPwned };
