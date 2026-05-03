import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
  isValidEmail,
  validateHttpUrl,
  validateLoginForm,
  validateRegisterForm,
  validateRegisterWithPasswordForm,
} from './validation'

describe('isValidEmail', () => {
  it('accepts a normal email', () => {
    expect(isValidEmail('Hi@Example.COM')).toBe(true)
  })

  it('rejects empty or whitespace', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('   ')).toBe(false)
  })

  it('rejects obvious invalid shapes', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('@nodomain.com')).toBe(false)
  })

  it('rejects when over max length', () => {
    const email = `${'a'.repeat(MAX_EMAIL_LENGTH)}b@x.co`
    expect(email.length).toBeGreaterThan(MAX_EMAIL_LENGTH)
    expect(isValidEmail(email)).toBe(false)
  })
})

describe('validateHttpUrl', () => {
  it('accepts http and https', () => {
    expect(validateHttpUrl(' https://example.com/path ')).toEqual({
      ok: true,
      value: 'https://example.com/path',
    })
    expect(validateHttpUrl('http://localhost:5173')).toEqual({
      ok: true,
      value: 'http://localhost:5173',
    })
  })

  it('rejects empty', () => {
    expect(validateHttpUrl('')).toEqual({
      ok: false,
      message: 'websiteUrl is required',
    })
  })

  it('rejects non-http protocols', () => {
    expect(validateHttpUrl('ftp://x')).toEqual({
      ok: false,
      message: 'websiteUrl must use http or https',
    })
  })

  it('rejects invalid URL', () => {
    expect(validateHttpUrl('http://')).toEqual({
      ok: false,
      message: 'Invalid websiteUrl',
    })
  })

  it('rejects when over max length', () => {
    const long = `https://${'a'.repeat(MAX_URL_LENGTH)}`
    expect(long.length > MAX_URL_LENGTH).toBe(true)
    expect(validateHttpUrl(long).ok).toBe(false)
  })
})

describe('validateRegisterForm', () => {
  it('normalizes email and trims optional name', () => {
    expect(validateRegisterForm('  User@EXAMPLE.com ', '  Ada  ')).toEqual({
      ok: true,
      email: 'user@example.com',
      name: 'Ada',
    })
  })

  it('omits name when empty after trim', () => {
    expect(validateRegisterForm('user@example.com', '   ')).toEqual({
      ok: true,
      email: 'user@example.com',
      name: undefined,
    })
  })

  it('returns validation messages aligned with API', () => {
    expect(validateRegisterForm('', '')).toMatchObject({
      ok: false,
      message: 'email is required',
    })
    expect(
      validateRegisterForm(`${'a'.repeat(MAX_EMAIL_LENGTH + 1)}@x.co`, ''),
    ).toMatchObject({
      ok: false,
      message: `email must be at most ${MAX_EMAIL_LENGTH} characters`,
    })
    expect(validateRegisterForm('bad', '')).toMatchObject({
      ok: false,
      message: 'email format is invalid',
    })
    expect(
      validateRegisterForm('ok@example.com', 'x'.repeat(MAX_NAME_LENGTH + 1)),
    ).toMatchObject({
      ok: false,
      message: `name must be at most ${MAX_NAME_LENGTH} characters`,
    })
  })
})

describe('validateRegisterWithPasswordForm', () => {
  const okPw = '1234567890ab'

  it('requires matching confirmation', () => {
    const result = validateRegisterWithPasswordForm('a@example.com', '', okPw, 'nomatch')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/match/i)
  })

  it('returns trimmed email and password bundle', () => {
    expect(
      validateRegisterWithPasswordForm('  Hi@Example.com ', '', okPw, okPw),
    ).toMatchObject({
      ok: true,
      email: 'hi@example.com',
      password: okPw,
    })
  })
})

describe('validateLoginForm', () => {
  it('accepts plausible credentials', () => {
    expect(validateLoginForm('  Hi@Example.com ', 'secret')).toEqual({
      ok: true,
      email: 'hi@example.com',
      password: 'secret',
    })
  })

  it('reports missing password', () => {
    expect(validateLoginForm('who@example.com', '')).toMatchObject({
      ok: false,
      message: 'password is required',
    })
  })
})