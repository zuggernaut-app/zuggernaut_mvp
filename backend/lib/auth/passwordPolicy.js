'use strict';

/** bcrypt truncates silently past 72 bytes; keep payloads within spec */
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 72;

module.exports = { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH };
