'use strict';

const express = require('express');
const { createLogger } = require('./lib/observability/logger');

const logger = createLogger();

function createApp() {
  const app = express();

  app.use(express.json());

  app.use('/api/v1', require('./api/v1'));

  app.get('/', (_req, res) => {
    logger.info('Health check route accessed');
    res.send('Backend is running!');
  });

  app.use((err, _req, res, _next) => {
    logger.error({ err }, 'Unhandled API error');
    if (res.headersSent) return;
    const status = typeof err.status === 'number' ? err.status : 500;
    const message =
      status === 500 ? 'Internal server error' : err.message || 'Request failed';
    res.status(status).json({ error: 'internal_error', message });
  });

  return app;
}

module.exports = { createApp };
