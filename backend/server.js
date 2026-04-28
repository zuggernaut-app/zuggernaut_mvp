// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const pino = require('pino');

dotenv.config(); // Load environment variables from .env

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Basic route to check if server is running
app.get('/', (req, res) => {
  logger.info('Health check route accessed');
  res.send('Backend is running!');
});

// MongoDB Connection (optional for this basic check, but good to have)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut_test')
  .then(() => logger.info('MongoDB connected successfully (using default or env URI)'))
  .catch(err => logger.error(`MongoDB connection error: ${err}`));

app.listen(port, () => {
  logger.info(`Backend server listening on port ${port}`);
});
