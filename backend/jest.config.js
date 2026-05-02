module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/registerModels.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.js'],
  testTimeout: 60000,
};
