/**
 * Mirrors `backend/lib/validation.js` so client-side checks match API errors.
 */

export const MAX_EMAIL_LENGTH = 254
export const MAX_NAME_LENGTH = 200
export const MAX_URL_LENGTH = 2048
/** Mirrors backend/lib/auth/passwordPolicy.js */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 72

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
  const e = email.trim().toLowerCase()
  return e.length > 0 && e.length <= MAX_EMAIL_LENGTH && EMAIL_REGEX.test(e)
}

export type HttpUrlResult =
  | { ok: true; value: string }
  | { ok: false; message: string }

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
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: 'websiteUrl must use http or https' }
    }
    return { ok: true, value: trimmed }
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
  | { ok: true; email: string; name?: string; password: string }
  | { ok: false; message: string }

export function validateRegisterWithPasswordForm(
  emailRaw: string,
  nameRaw: string,
  passwordRaw: string,
  confirmRaw: string
): RegisterWithPasswordResult {
  const basic = validateRegisterForm(emailRaw, nameRaw)
  if (!basic.ok) return basic

  const pw = validatePasswordField(passwordRaw)
  if (!pw.ok) return pw

  const confirmTrim = confirmRaw.trim()
  if (!confirmTrim) return { ok: false, message: 'Confirm your password.' }
  if (confirmTrim !== pw.password) return { ok: false, message: 'Passwords must match.' }

  return {
    ok: true,
    email: basic.email,
    name: basic.name,
    password: pw.password,
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
