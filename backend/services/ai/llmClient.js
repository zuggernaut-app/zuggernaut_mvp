'use strict';

class LlmClientError extends Error {
  constructor(message, code = 'LLM_CLIENT_ERROR') {
    super(message);
    this.name = 'LlmClientError';
    this.code = code;
  }
}

/**
 * @returns {boolean}
 */
function isLlmEnabled() {
  return process.env.LLM_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Structured JSON completion via OpenAI chat completions API.
 *
 * @param {{ system: string, user: string, schemaName?: string }} input
 * @returns {Promise<object>}
 */
async function completeJson(input) {
  if (!isLlmEnabled()) {
    throw new LlmClientError('LLM is disabled or OPENAI_API_KEY is missing.', 'LLM_DISABLED');
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const apiKey = process.env.OPENAI_API_KEY.trim();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      temperature: 0.2,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof body?.error?.message === 'string' ? body.error.message : `OpenAI HTTP ${res.status}`;
    throw new LlmClientError(msg, 'LLM_PROVIDER_ERROR');
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmClientError('OpenAI returned empty content.', 'LLM_EMPTY_RESPONSE');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new LlmClientError('OpenAI returned non-JSON content.', 'LLM_INVALID_JSON');
  }
}

module.exports = {
  LlmClientError,
  isLlmEnabled,
  completeJson,
};
