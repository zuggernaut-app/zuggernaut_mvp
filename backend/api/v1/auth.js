'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const BusinessContext = mongoose.model('BusinessContext');
const {
  isValidEmail,
  isValidPhone,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  validateOptionalHttpUrl,
} = require('../../lib/validation');
const { hashPassword, verifyPassword } = require('../../lib/auth/passwordHash');
const { signAccessToken } = require('../../lib/auth/tokens');
const {
  AUTH_ACCESS_COOKIE_NAME,
  accessTokenCookiePayload,
  accessTokenCookieMaxAgeMs,
  clearAccessTokenCookieAttributes,
} = require('../../lib/auth/sessionCookie');
const { validatePlainPassword } = require('../../lib/auth/validateCredentials');
const { assertPasswordNotPwned } = require('../../lib/auth/pwnedPassword');
const { loginFailedLimiter } = require('../../lib/auth/loginFailedLimiter');
const {
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  isResetTokenExpired,
  verifyResetToken,
} = require('../../lib/auth/passwordReset');
const { sendEmail } = require('../../lib/notifications/emailTransport');
const { issueCsrfCookie } = require('../../lib/auth/csrf');
const { requireAuth } = require('./middleware/requireAuth');
const { createBusinessDraftForUser } = require('../../services/onboarding/businessDraftService');
const { startSignupScrape } = require('../../services/capabilities/leadCampaignScrapeService');

const router = express.Router();

const authWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many authentication attempts. Try again shortly.',
  },
});

const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many password reset attempts. Try again shortly.',
  },
});

function passwordResetFrontendOrigin() {
  const origin = process.env.FRONTEND_ORIGIN?.trim()?.split(',')[0]?.trim();
  return origin || 'http://localhost:5173';
}

function buildPasswordResetLink(email, plainToken) {
  const base = passwordResetFrontendOrigin().replace(/\/+$/, '');
  const params = new URLSearchParams({
    token: plainToken,
    email,
  });
  return `${base}/password-reset?${params.toString()}`;
}

function userResponse(doc) {
  const id =
    typeof doc?.id === 'string' ? doc.id : doc?._id != null ? doc._id.toString() : undefined;
  if (!id || typeof doc.email !== 'string') {
    throw new TypeError('userResponse expects a persisted user document');
  }
  const name = doc.name === undefined ? null : doc.name ?? null;
  const primaryBusinessId =
    doc.primaryBusinessId != null ? doc.primaryBusinessId.toString() : null;
  return {
    id,
    email: doc.email,
    name,
    platformAdmin: Boolean(doc.platformAdmin),
    primaryBusinessId,
    createdAt: doc.createdAt,
  };
}

function attachSessionCookie(res, user) {
  const token = signAccessToken({
    userId: user._id.toString(),
    email: user.email,
  });
  const maxAgeMs = accessTokenCookieMaxAgeMs();
  const cookie = accessTokenCookiePayload(maxAgeMs);
  res.cookie(cookie.name, token, cookie.options);
  issueCsrfCookie(res);
}

async function bootstrapRegistrationBusiness(user) {
  const { businessId } = await createBusinessDraftForUser(user._id);
  const websiteCheck = validateOptionalHttpUrl(user.websiteUrl ?? '');
  const websiteUrl = websiteCheck.ok ? websiteCheck.value : undefined;

  const update = {
    websiteUrl: websiteUrl ?? undefined,
    contactMethods: {
      emails: [user.email],
      phones: user.phone ? [user.phone] : [],
    },
    intakeFieldSources: {
      phone: 'customer',
      email: 'customer',
      ...(websiteUrl ? { websiteUrl: 'customer' } : {}),
    },
  };

  await BusinessContext.updateOne({ businessId }, { $set: update });
  await User.findByIdAndUpdate(user._id, { $set: { primaryBusinessId: businessId } });

  if (websiteUrl) {
    try {
      await startSignupScrape(businessId, user._id, websiteUrl);
    } catch {
      // Signup scrape is best-effort; registration must still succeed.
    }
  }

  return businessId;
}

router.get('/csrf', (_req, res) => {
  const csrfToken = issueCsrfCookie(res);
  res.status(200).json({ csrfToken });
});

router.post('/register', authWriteLimiter, async (req, res, next) => {
  const emailRaw =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phoneRaw = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const websiteRaw = typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl.trim() : '';
  const pwdRaw = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!emailRaw) {
    return res.status(400).json({ error: 'validation_error', message: 'email is required' });
  }
  if (emailRaw.length > MAX_EMAIL_LENGTH) {
    return res.status(400).json({
      error: 'validation_error',
      message: `email must be at most ${MAX_EMAIL_LENGTH} characters`,
    });
  }
  if (!isValidEmail(emailRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'email format is invalid',
    });
  }

  if (!phoneRaw || !isValidPhone(phoneRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'A valid phone number is required',
    });
  }

  const pwdMsg = validatePlainPassword(pwdRaw);
  if (pwdMsg) {
    return res.status(400).json({ error: 'validation_error', message: pwdMsg });
  }

  const pwnedCheck = await assertPasswordNotPwned(pwdRaw);
  if (!pwnedCheck.ok) {
    return res.status(400).json({ error: 'validation_error', message: pwnedCheck.message });
  }

  let name;
  if (nameRaw) {
    if (nameRaw.length > MAX_NAME_LENGTH) {
      return res.status(400).json({
        error: 'validation_error',
        message: `name must be at most ${MAX_NAME_LENGTH} characters`,
      });
    }
    name = nameRaw;
  }

  const websiteCheck = validateOptionalHttpUrl(websiteRaw);
  const websiteUrl = websiteCheck.ok ? websiteCheck.value : undefined;

  try {
    const passwordHash = await hashPassword(pwdRaw);
    const user = await User.create({
      email: emailRaw,
      name: name || undefined,
      phone: phoneRaw,
      websiteUrl: websiteUrl || undefined,
      passwordHash,
    });

    const primaryBusinessId = await bootstrapRegistrationBusiness(user);

    attachSessionCookie(res, user);

    return res.status(201).json({
      user: userResponse({
        _id: user._id,
        email: user.email,
        name: user.name,
        primaryBusinessId,
        createdAt: user.createdAt,
      }),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error: 'conflict',
        message: 'A user with this email already exists',
      });
    }
    if (err?.code === 'soft_launch_single_business') {
      return res.status(409).json({
        error: 'soft_launch_single_business',
        message: err.message,
      });
    }
    return next(err);
  }
});

router.post('/login', loginFailedLimiter, async (req, res, next) => {
  const emailRaw =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const pwdRaw = typeof req.body?.password === 'string' ? req.body.password : '';

  const genericUnauthorized = () =>
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid email or password',
    });

  if (!emailRaw || pwdRaw.length === 0) {
    return genericUnauthorized();
  }

  try {
    const user = await User.findOne({
      email: emailRaw,
    })
      .select('+passwordHash')
      .exec();

    const passwordOk =
      user &&
      typeof user.passwordHash === 'string' &&
      (await verifyPassword(pwdRaw, user.passwordHash));

    if (!passwordOk || !user) return genericUnauthorized();

    attachSessionCookie(res, user);
    return res.status(200).json({
      user: userResponse({
        _id: user._id,
        email: user.email,
        name: user.name,
        primaryBusinessId: user.primaryBusinessId,
        createdAt: user.createdAt,
      }),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_ACCESS_COOKIE_NAME, clearAccessTokenCookieAttributes());
  issueCsrfCookie(res);
  res.status(200).json({ ok: true });
});

router.post('/password-reset/request', passwordResetRequestLimiter, async (req, res, next) => {
  const emailRaw =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  const genericOk = () =>
    res.status(200).json({
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    });

  if (!emailRaw || !isValidEmail(emailRaw)) {
    return genericOk();
  }

  try {
    const user = await User.findOne({ email: emailRaw })
      .select('+passwordHash')
      .exec();

    if (!user || typeof user.passwordHash !== 'string') {
      return genericOk();
    }

    const plainToken = generateResetToken();
    user.passwordResetToken = hashResetToken(plainToken);
    user.passwordResetExpiresAt = resetTokenExpiresAt();
    await user.save();

    const resetLink = buildPasswordResetLink(emailRaw, plainToken);
    await sendEmail({
      to: emailRaw,
      subject: 'Reset your Zuggernaut password',
      text: `Use this link to reset your password (expires in 1 hour): ${resetLink}`,
      html: `<p>Use this link to reset your password (expires in 1 hour):</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });

    return genericOk();
  } catch (err) {
    return next(err);
  }
});

router.post('/password-reset/confirm', authWriteLimiter, async (req, res, next) => {
  const emailRaw =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const tokenRaw = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const pwdRaw = typeof req.body?.password === 'string' ? req.body.password : '';

  const genericInvalid = () =>
    res.status(400).json({
      error: 'validation_error',
      message: 'Invalid or expired reset link. Request a new password reset.',
    });

  if (!emailRaw || !isValidEmail(emailRaw) || tokenRaw.length === 0) {
    return genericInvalid();
  }

  const pwdMsg = validatePlainPassword(pwdRaw);
  if (pwdMsg) {
    return res.status(400).json({ error: 'validation_error', message: pwdMsg });
  }

  const pwnedCheck = await assertPasswordNotPwned(pwdRaw);
  if (!pwnedCheck.ok) {
    return res.status(400).json({ error: 'validation_error', message: pwnedCheck.message });
  }

  try {
    const user = await User.findOne({ email: emailRaw })
      .select('+passwordHash +passwordResetToken +passwordResetExpiresAt')
      .exec();

    if (
      !user ||
      typeof user.passwordResetToken !== 'string' ||
      isResetTokenExpired(user.passwordResetExpiresAt) ||
      !verifyResetToken(tokenRaw, user.passwordResetToken)
    ) {
      return genericInvalid();
    }

    user.passwordHash = await hashPassword(pwdRaw);
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();

    return res.status(200).json({
      ok: true,
      message: 'Password updated. You can log in with your new password.',
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const doc = await User.findById(req.user.id).lean();
    if (!doc) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired session',
      });
    }
    res.status(200).json({
      user: userResponse(doc),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
