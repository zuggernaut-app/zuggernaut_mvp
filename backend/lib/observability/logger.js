const pino = require('pino');

function createLogger(options = {}) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    ...options,
  });
}

module.exports = { createLogger };
