'use strict';

const {
  resolveCookieSameSite,
  cookieIsSecureDefault,
  sharedCookieAttributes,
} = require('../lib/auth/sessionCookie');

describe('sessionCookie', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it('uses lax SameSite for local development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SAMESITE;
    delete process.env.FRONTEND_ORIGIN;

    expect(resolveCookieSameSite()).toBe('lax');
    expect(sharedCookieAttributes()).toMatchObject({ sameSite: 'lax' });
  });

  it('uses none SameSite in production when FRONTEND_ORIGIN is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_ORIGIN = 'https://zuggernaut-mvp.web.app';
    delete process.env.COOKIE_SAMESITE;

    expect(resolveCookieSameSite()).toBe('none');
    expect(sharedCookieAttributes()).toMatchObject({
      sameSite: 'none',
      secure: true,
    });
  });

  it('honors COOKIE_SAMESITE override', () => {
    process.env.COOKIE_SAMESITE = 'strict';
    expect(resolveCookieSameSite()).toBe('strict');
  });

  it('forces secure cookies when SameSite is none', () => {
    process.env.COOKIE_SAMESITE = 'none';
    process.env.COOKIE_SECURE = 'false';
    expect(cookieIsSecureDefault()).toBe(true);
  });
});
