'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

beforeAll(async () => {
  /** Required for JWT in route tests (`verifyJwtConfigured` skips only when NODE_ENV=test). */
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-thirty-two-chars-xxxx';
  process.env.TOKEN_ENCRYPTION_KEY =
    process.env.TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret';
  process.env.GOOGLE_OAUTH_MOCK = process.env.GOOGLE_OAUTH_MOCK || 'true';
  process.env.GBP_API_MOCK = process.env.GBP_API_MOCK || 'true';
  process.env.GOOGLE_ADS_API_MOCK = process.env.GOOGLE_ADS_API_MOCK || 'true';
  process.env.GTM_API_MOCK = process.env.GTM_API_MOCK || 'true';
  process.env.FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  process.env.STRIPE_MOCK = process.env.STRIPE_MOCK || 'true';
  process.env.BILLING_FREE_PLAN_TEST = process.env.BILLING_FREE_PLAN_TEST || 'true';
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(process.env.MONGODB_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  for (const key of Object.keys(cols)) {
    await cols[key].deleteMany({});
  }
});
