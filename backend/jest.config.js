module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/../dev-tools/backend/tests'],
  setupFiles: ['<rootDir>/tests/registerModels.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.js'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^axios$': '<rootDir>/node_modules/axios',
    '^supertest$': '<rootDir>/node_modules/supertest',
    '^jsonwebtoken$': '<rootDir>/node_modules/jsonwebtoken',
  },
};
