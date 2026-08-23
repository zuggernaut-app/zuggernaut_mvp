'use strict';

const { createLogger } = require('../../lib/observability/logger');

const log = createLogger({ name: 'stripeClient' });

function isStripeMock() {
  return process.env.STRIPE_MOCK === 'true';
}

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || '';
}

function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
}

function getStripeClient() {
  if (isStripeMock()) return null;
  const secretKey = getStripeSecretKey();
  if (!secretKey) return null;
  // Lazy require so tests without Stripe configured do not load the SDK.
  const Stripe = require('stripe');
  return new Stripe(secretKey);
}

function resolveFrontendOrigin() {
  const origin = process.env.FRONTEND_ORIGIN?.trim()?.split(',')[0]?.trim();
  return origin || 'http://localhost:5173';
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.email
 * @param {string} [params.stripeCustomerId]
 * @param {string} params.priceId
 * @param {string} [params.successPath]
 * @param {string} [params.cancelPath]
 */
async function createCheckoutSession(params) {
  const {
    userId,
    email,
    stripeCustomerId,
    priceId,
    successPath = '/billing?checkout=success',
    cancelPath = '/billing?checkout=cancel',
  } = params;

  if (isStripeMock() || !getStripeSecretKey()) {
    const mockSessionId = `cs_test_mock_${userId}`;
    log.info({ userId, priceId, mockSessionId }, 'stripe.checkout.mock');
    return {
      sessionId: mockSessionId,
      url: `${resolveFrontendOrigin()}${successPath}`,
      source: 'stripe_mock',
    };
  }

  const stripe = getStripeClient();
  if (!stripe) {
    throw new StripeClientError('Stripe is not configured.', 'STRIPE_NOT_CONFIGURED');
  }

  const base = resolveFrontendOrigin().replace(/\/+$/, '');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId || undefined,
    customer_email: stripeCustomerId ? undefined : email,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}${successPath}`,
    cancel_url: `${base}${cancelPath}`,
    metadata: { userId },
  });

  return {
    sessionId: session.id,
    url: session.url,
    source: 'stripe',
  };
}

/**
 * @param {string} stripeCustomerId
 */
async function createCustomerPortalSession(stripeCustomerId) {
  if (isStripeMock() || !getStripeSecretKey()) {
    log.info({ stripeCustomerId }, 'stripe.portal.mock');
    return {
      url: `${resolveFrontendOrigin()}/billing`,
      source: 'stripe_mock',
    };
  }

  const stripe = getStripeClient();
  if (!stripe) {
    throw new StripeClientError('Stripe is not configured.', 'STRIPE_NOT_CONFIGURED');
  }

  const base = resolveFrontendOrigin().replace(/\/+$/, '');
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${base}/billing`,
  });

  return { url: session.url, source: 'stripe' };
}

/**
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (isStripeMock()) {
    try {
      const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      return JSON.parse(payload);
    } catch {
      throw new StripeClientError('Invalid mock webhook payload.', 'STRIPE_WEBHOOK_INVALID');
    }
  }

  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  if (!stripe || !webhookSecret) {
    throw new StripeClientError('Stripe webhook is not configured.', 'STRIPE_WEBHOOK_NOT_CONFIGURED');
  }

  if (!signatureHeader) {
    throw new StripeClientError('Missing Stripe signature header.', 'STRIPE_WEBHOOK_INVALID');
  }

  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

class StripeClientError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StripeClientError';
    this.code = code;
  }
}

module.exports = {
  StripeClientError,
  isStripeMock,
  createCheckoutSession,
  createCustomerPortalSession,
  verifyWebhookSignature,
};
