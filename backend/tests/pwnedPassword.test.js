'use strict';

const { assertPasswordNotPwned } = require('../lib/auth/pwnedPassword');

jest.mock('../lib/auth/pwnedPassword', () => {
  const actual = jest.requireActual('../lib/auth/pwnedPassword');
  return {
    ...actual,
    isPasswordPwned: jest.fn(),
  };
});

const { isPasswordPwned } = require('../lib/auth/pwnedPassword');

describe('assertPasswordNotPwned', () => {
  beforeEach(() => {
    isPasswordPwned.mockReset();
  });

  it('rejects a password found in the breach corpus', async () => {
    isPasswordPwned.mockResolvedValue(true);
    const res = await assertPasswordNotPwned('password123');
    expect(res.ok).toBe(false);
  });

  it('accepts a password when HIBP is unreachable', async () => {
    isPasswordPwned.mockRejectedValue(new Error('network down'));
    const res = await assertPasswordNotPwned('UniqueSafePass12!');
    expect(res.ok).toBe(true);
  });
});
