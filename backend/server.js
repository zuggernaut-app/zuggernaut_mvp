// backend/server.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

require('./models');

const { createLogger } = require('./lib/observability/logger');
const { createApp } = require('./app');

const logger = createLogger();

const app = createApp();
const port = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut_test')
  .then(() => logger.info('MongoDB connected successfully (using default or env URI)'))
  .catch((err) => logger.error(`MongoDB connection error: ${err}`));

app.listen(port, () => {
  logger.info(`Backend server listening on port ${port}`);
});
