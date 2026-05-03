'use strict';

const { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } = require('./passwordPolicy');

/**
 * Validates password complexity for signup/login bodies.
 * @returns {null|string} Null if OK, otherwise an English message suitable for `{ message }`.
 */
function validatePlainPassword(passwordRaw) {
  if (typeof passwordRaw !== 'string' || passwordRaw.length === 0) {
    return 'password is required';
  }

  const len = [...passwordRaw].length;
  if (len < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (len > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }

  return null;
}

module.exports = { validatePlainPassword };
