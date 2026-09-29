'use strict';

/**
 * Fails startup when LLM is enabled without required credentials (skipped in NODE_ENV=test).
 */
function assertLlmEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'test') return;

  if (process.env.LLM_ENABLED === 'true' && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      'LLM_ENABLED=true requires OPENAI_API_KEY to be set. Disable LLM or provide a key.'
    );
  }
}

module.exports = { assertLlmEnvironment };
