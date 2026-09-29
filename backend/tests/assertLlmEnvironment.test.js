'use strict';

describe('assertLlmEnvironment', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('skips validation in test environment', () => {
    process.env.NODE_ENV = 'test';
    process.env.LLM_ENABLED = 'true';
    delete process.env.OPENAI_API_KEY;
    const { assertLlmEnvironment } = require('../lib/ai/assertLlmEnvironment');
    expect(() => assertLlmEnvironment()).not.toThrow();
  });

  it('throws when LLM is enabled without OPENAI_API_KEY outside test', () => {
    process.env.NODE_ENV = 'development';
    process.env.LLM_ENABLED = 'true';
    delete process.env.OPENAI_API_KEY;
    const { assertLlmEnvironment } = require('../lib/ai/assertLlmEnvironment');
    expect(() => assertLlmEnvironment()).toThrow(/OPENAI_API_KEY/);
  });

  it('passes when LLM is disabled without a key', () => {
    process.env.NODE_ENV = 'development';
    process.env.LLM_ENABLED = 'false';
    delete process.env.OPENAI_API_KEY;
    const { assertLlmEnvironment } = require('../lib/ai/assertLlmEnvironment');
    expect(() => assertLlmEnvironment()).not.toThrow();
  });
});
