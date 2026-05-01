// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

require('./models');

const { createLogger } = require('./lib/observability/logger');
const logger = createLogger();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

app.use('/api/v1', require('./api/v1'));

// Basic route to check if server is running
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

// MongoDB Connection (optional for this basic check, but good to have)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut_test')
  .then(() => logger.info('MongoDB connected successfully (using default or env URI)'))
  .catch(err => logger.error(`MongoDB connection error: ${err}`));

app.listen(port, () => {
  logger.info(`Backend server listening on port ${port}`);
});
