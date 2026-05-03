'use strict';

const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

function hashPassword(plainText) {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

function verifyPassword(plainText, passwordHash) {
  return bcrypt.compare(plainText, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
