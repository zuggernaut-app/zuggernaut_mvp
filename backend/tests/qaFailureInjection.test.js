'use strict';

describe('qaFailureInjection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('injects failure when QA_FAILURE_INJECT matches step', () => {
    process.env.QA_FAILURE_INJECT = 'ads_provisioning';
    const { shouldInjectFailure, maybeInjectFailure } = require('../lib/qaFailureInjection');
    expect(shouldInjectFailure('ads_provisioning')).toBe(true);
    expect(() => maybeInjectFailure('ads_provisioning')).toThrow(/QA failure injection/);
  });

  it('does not inject when QA_FAILURE_INJECT is unset', () => {
    delete process.env.QA_FAILURE_INJECT;
    const { shouldInjectFailure, maybeInjectFailure } = require('../lib/qaFailureInjection');
    expect(shouldInjectFailure('ads_provisioning')).toBe(false);
    expect(() => maybeInjectFailure('ads_provisioning')).not.toThrow();
  });

  it('throws on module load when NODE_ENV=production and QA_FAILURE_INJECT is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.QA_FAILURE_INJECT = 'ads_provisioning';
    expect(() => {
      jest.isolateModules(() => {
        require('../lib/qaFailureInjection');
      });
    }).toThrow(/Refusing to start/);
  });
});
