/**
 * Mirrors `backend/lib/validation.js` so client-side checks match API errors.
 */

export const MAX_EMAIL_LENGTH = 254
export const MAX_NAME_LENGTH = 200
export const MAX_URL_LENGTH = 2048
/** Mirrors backend/lib/auth/passwordPolicy.js */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 72

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
  const e = email.trim().toLowerCase()
  return e.length > 0 && e.length <= MAX_EMAIL_LENGTH && EMAIL_REGEX.test(e)
}

/** Permissive phone check: allows +, spaces, dashes, parentheses; requires ≥7 digits. */
export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim()
  if (!trimmed) return false
  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= 7
}

export type HttpUrlResult =
  | { ok: true; value: string }
  | { ok: false; message: string }

function prependHttps(trimmed: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return `https://${trimmed}`
}

function isWebsiteHost(hostname: string): boolean {
  if (!hostname || hostname.startsWith('.') || hostname.endsWith('.')) return false
  if (hostname === 'localhost') return true
  return hostname.includes('.')
}

function httpUrlValueFromParsed(candidate: string, u: URL): string {
  let value = u.href
  if (u.pathname === '/' && !u.search && !u.hash && !candidate.endsWith('/')) {
    value = value.replace(/\/$/, '')
  }
  return value
}

export function validateHttpUrl(raw: string): HttpUrlResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, message: 'websiteUrl is required' }
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      message: `websiteUrl must be at most ${MAX_URL_LENGTH} characters`,
    }
  }
  const candidate = prependHttps(trimmed)
  if (candidate.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      message: `websiteUrl must be at most ${MAX_URL_LENGTH} characters`,
    }
  }
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: 'websiteUrl must use http or https' }
    }
    if (!isWebsiteHost(u.hostname)) {
      return { ok: false, message: 'Invalid websiteUrl' }
    }
    return { ok: true, value: httpUrlValueFromParsed(candidate, u) }
  } catch {
    return { ok: false, message: 'Invalid websiteUrl' }
  }
}

export type RegisterFormResult =
  | { ok: true; email: string; name?: string }
  | { ok: false; message: string }

/** Same rules as POST /users (trim email to lowercase; optional name length). */
export function validateRegisterForm(
  emailRaw: string,
  nameRaw: string
): RegisterFormResult {
  const email = emailRaw.trim().toLowerCase()
  if (!email) {
    return { ok: false, message: 'email is required' }
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return {
      ok: false,
      message: `email must be at most ${MAX_EMAIL_LENGTH} characters`,
    }
  }
  if (!isValidEmail(email)) {
    return { ok: false, message: 'email format is invalid' }
  }

  const nameTrimmed = nameRaw.trim()
  if (nameTrimmed.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      message: `name must be at most ${MAX_NAME_LENGTH} characters`,
    }
  }

  return {
    ok: true,
    email,
    name: nameTrimmed ? nameTrimmed : undefined,
  }
}

export type PasswordFormResult =
  | { ok: true; password: string }
  | { ok: false; message: string }

export function validatePasswordField(raw: string): PasswordFormResult {
  const pwd = raw
  if (!pwd.trim()) return { ok: false, message: 'password is required' }
  if ([...pwd].length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    }
  }
  if ([...pwd].length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      message: `password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    }
  }
  return { ok: true, password: pwd }
}

export type RegisterWithPasswordResult =
  | { ok: true; email: string; name?: string; phone: string; websiteUrl?: string; password: string }
  | { ok: false; message: string }

export function validateRegisterWithPasswordForm(
  emailRaw: string,
  nameRaw: string,
  phoneRaw: string,
  websiteRaw: string,
  passwordRaw: string,
  confirmRaw: string
): RegisterWithPasswordResult {
  const basic = validateRegisterForm(emailRaw, nameRaw)
  if (!basic.ok) return basic

  const phone = phoneRaw.trim()
  if (!phone || !isValidPhone(phone)) {
    return { ok: false, message: 'A valid phone number is required.' }
  }

  const websiteTrimmed = websiteRaw.trim()
  let websiteUrl: string | undefined
  if (websiteTrimmed) {
    const urlCheck = validateHttpUrl(websiteTrimmed)
    if (!urlCheck.ok) {
      return { ok: false, message: urlCheck.message }
    }
    websiteUrl = urlCheck.value
  }

  const pw = validatePasswordField(passwordRaw)
  if (!pw.ok) return pw

  const confirmTrim = confirmRaw.trim()
  if (!confirmTrim) return { ok: false, message: 'Confirm your password.' }
  if (confirmTrim !== pw.password) return { ok: false, message: 'Passwords must match.' }

  return {
    ok: true,
    email: basic.email,
    name: basic.name,
    phone,
    websiteUrl,
    password: pw.password,
  }
}

export type SignupRegisterResult =
  | {
      ok: true
      email: string
      phone: string
      websiteUrl?: string
      password: string
    }
  | { ok: false; message: string }

export function validateSignupRegisterForm(input: {
  email: string
  phone: string
  websiteUrl: string
  password: string
  confirmPassword: string
}): SignupRegisterResult {
  const basic = validateRegisterWithPasswordForm(
    input.email,
    '',
    input.phone,
    input.websiteUrl,
    input.password,
    input.confirmPassword,
  )
  if (!basic.ok) return basic

  return {
    ok: true,
    email: basic.email,
    phone: basic.phone,
    websiteUrl: basic.websiteUrl,
    password: basic.password,
  }
}

const SIGNUP_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD'])

export type CustomerSignupDetailsResult =
  | {
      ok: true
      businessName: string
      hasNoWebsite: boolean
      websiteUrl?: string
      businessCountry?: string
      accountCurrencyCode: string
      accountTimeZone?: string
    }
  | { ok: false; message: string; field?: 'websiteUrl' | 'terms' }

export function validateCustomerSignupDetailsForm(input: {
  businessName: string
  websiteUrl: string
  hasNoWebsite: boolean
  termsAccepted: boolean
  businessCountry: string
  accountCurrencyCode: string
  accountTimeZone: string
}): CustomerSignupDetailsResult {
  const businessName = input.businessName.trim()
  if (!businessName) {
    return { ok: false, message: 'Business name is required.' }
  }

  if (!input.termsAccepted) {
    return {
      ok: false,
      message: 'You must accept the terms and conditions.',
      field: 'terms',
    }
  }

  if (input.hasNoWebsite) {
    const country = input.businessCountry.trim().toUpperCase()
    if (country && !/^[A-Z]{2}$/.test(country)) {
      return { ok: false, message: 'A valid business country is required.' }
    }
    const accountCurrencyCode = input.accountCurrencyCode.trim().toUpperCase()
    if (!SIGNUP_CURRENCIES.has(accountCurrencyCode)) {
      return { ok: false, message: 'A valid account currency is required.' }
    }
    const accountTimeZone = input.accountTimeZone.trim()
    return {
      ok: true,
      businessName,
      hasNoWebsite: true,
      ...(country ? { businessCountry: country } : {}),
      accountCurrencyCode,
      ...(accountTimeZone ? { accountTimeZone } : {}),
    }
  }

  const websiteTrimmed = input.websiteUrl.trim()
  if (!websiteTrimmed) {
    return { ok: false, message: 'Website is required.', field: 'websiteUrl' }
  }
  const urlCheck = validateHttpUrl(websiteTrimmed)
  if (!urlCheck.ok) {
    return { ok: false, message: urlCheck.message, field: 'websiteUrl' }
  }

  const country = input.businessCountry.trim().toUpperCase()
  if (country && !/^[A-Z]{2}$/.test(country)) {
    return { ok: false, message: 'A valid business country is required.' }
  }

  const accountCurrencyCode = input.accountCurrencyCode.trim().toUpperCase()
  if (!SIGNUP_CURRENCIES.has(accountCurrencyCode)) {
    return { ok: false, message: 'A valid account currency is required.' }
  }

  const accountTimeZone = input.accountTimeZone.trim()

  return {
    ok: true,
    businessName,
    hasNoWebsite: false,
    websiteUrl: urlCheck.value,
    ...(country ? { businessCountry: country } : {}),
    accountCurrencyCode,
    ...(accountTimeZone ? { accountTimeZone } : {}),
  }
}

export type LoginFormValidateResult =
  | { ok: true; email: string; password: string }
  | { ok: false; message: string }

export function validateLoginForm(emailRaw: string, passwordRaw: string): LoginFormValidateResult {
  const email = emailRaw.trim().toLowerCase()
  if (!email) return { ok: false, message: 'email is required' }
  if (!isValidEmail(email)) return { ok: false, message: 'email format is invalid' }
  if (!passwordRaw) return { ok: false, message: 'password is required' }
  return { ok: true, email, password: passwordRaw }
}
