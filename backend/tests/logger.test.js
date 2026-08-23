'use strict';

const { Writable } = require('stream');
const { createLogger } = require('../lib/observability/logger');

describe('logger', () => {
  it('redacts sensitive fields from log output', () => {
    const lines = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const logger = createLogger({ level: 'info' }, destination);
    logger.info({
      accessToken: 'secret-token',
      responseBody: { nested: 'payload' },
      message: 'ok',
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.accessToken).toBe('[REDACTED]');
    expect(parsed.responseBody).toBe('[REDACTED]');
    expect(parsed.message).toBe('ok');
  });
});
