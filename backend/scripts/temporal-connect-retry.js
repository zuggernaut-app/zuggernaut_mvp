'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True while Temporal is still starting (port open but frontend not ready) or the
 * network path is flaky — worth retrying.
 */
function isRetryableConnectError(err) {
  const s = String(err);
  return (
    /ConnectionRefused|ECONNREFUSED|10061|actively refused|tcp connect error/i.test(
      s
    ) ||
    /BrokenPipe|broken pipe|Connection reset|connection reset|UNAVAILABLE|ENOTFOUND|ETIMEDOUT|timed out/i.test(
      s
    ) ||
    /GetSystemInfo|get_system_info|transport error|Transport error/i.test(s)
  );
}

/**
 * Retries an async factory (e.g. Temporal connect) until success or attempts exhausted.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, delayMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function withRetry(label, fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 45;
  const delayMs = options.delayMs ?? 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const retryable = isRetryableConnectError(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          msg: `${label}: connect not ready yet, retrying`,
          addressHint: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233',
          attempt,
          maxAttempts,
          nextRetryMs: delayMs,
        })
      );
      await sleep(delayMs);
    }
  }
}

module.exports = { withRetry, sleep };
