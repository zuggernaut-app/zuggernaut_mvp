'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

beforeAll(async () => {
  /** Required for JWT in route tests (`verifyJwtConfigured` skips only when NODE_ENV=test). */
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-thirty-two-chars-xxxx';
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
