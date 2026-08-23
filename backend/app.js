'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');

const { createLogger } = require('./lib/observability/logger');

const logger = createLogger();

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }),
  );

  const frontendOrigin = process.env.FRONTEND_ORIGIN?.trim();
  if (frontendOrigin) {
    const origins = frontendOrigin
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    app.use(
      cors({
        origin: origins.length === 1 ? origins[0] : origins,
        credentials: true,
      }),
    );
  }

  app.use(
    '/api/v1/billing/webhook',
    express.raw({ type: 'application/json' }),
    (req, _res, next) => {
      req.rawBody = req.body;
      next();
    },
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const { requestIdMiddleware } = require('./api/v1/middleware/requestId');
  app.use(requestIdMiddleware);

  const { otelHttpMiddleware } = require('./lib/observability/otel');
  app.use(otelHttpMiddleware);

  const { csrfProtection } = require('./api/v1/middleware/csrfProtection');
  app.use('/api/v1', csrfProtection);

  app.use('/api/v1', require('./api/v1'));

  app.get('/', (_req, res) => {
    logger.info('Health check route accessed');
    res.send('Backend is running!');
  });

  app.use((err, req, res, _next) => {
    logger.error({ err, requestId: req.requestId }, 'Unhandled API error');
    if (res.headersSent) return;
    const status = typeof err.status === 'number' ? err.status : 500;
    const message =
      status === 500 ? 'Internal server error' : err.message || 'Request failed';
    res.status(status).json({ error: 'internal_error', message });
  });

  return app;
}

module.exports = { createApp };
