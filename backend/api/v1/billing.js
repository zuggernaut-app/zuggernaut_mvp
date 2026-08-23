'use strict';

const express = require('express');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const Plan = mongoose.model('Plan');
const Subscription = mongoose.model('Subscription');
const { requireAuth } = require('./middleware/requireAuth');
const {
  createCheckoutSession,
  createCustomerPortalSession,
  verifyWebhookSignature,
  StripeClientError,
} = require('../../services/billing/stripeClient');
const { upsertSubscriptionFromStripe } = require('../../services/billing/subscriptionGate');

const router = express.Router();

function mapStripeStatus(stripeStatus) {
  const allowed = ['trialing', 'active', 'past_due', 'canceled', 'unpaid'];
  if (allowed.includes(stripeStatus)) return stripeStatus;
  return 'unpaid';
}

/**
 * Org billing wins once an org subscription row exists; personal userId is the cutover fallback.
 * @param {import('mongoose').Types.ObjectId} userObjectId
 * @param {string} [select]
 */
async function findSubscriptionForUser(userObjectId, select = '') {
  const user = await User.findById(userObjectId).select('primaryOrgId').lean();

  let subscription = null;
  if (user?.primaryOrgId) {
    let query = Subscription.findOne({ orgId: user.primaryOrgId }).populate('planId');
    if (select) query = query.select(select);
    subscription = await query.lean();
  }

  if (!subscription) {
    let query = Subscription.findOne({ userId: userObjectId }).populate('planId');
    if (select) query = query.select(select);
    subscription = await query.lean();
  }

  return subscription;
}

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const subscription = await findSubscriptionForUser(userId);

    if (!subscription) {
      return res.status(200).json({
        subscription: null,
      });
    }

    return res.status(200).json({
      subscription: {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
        plan: subscription.planId
          ? {
              tier: subscription.planId.tier,
              name: subscription.planId.name,
            }
          : null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const tierRaw = typeof req.body?.tier === 'string' ? req.body.tier.trim() : 'starter';
    const plan = await Plan.findOne({ tier: tierRaw, active: true }).lean();
    if (!plan?.stripePriceId) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Selected plan is not available for checkout.',
      });
    }

    const userId = req.user.id;
    const user = await User.findById(userId).select('email').lean();
    if (!user?.email) {
      return res.status(404).json({ error: 'not_found', message: 'User not found' });
    }

    const existing = await Subscription.findOne({ userId })
      .select('+stripeCustomerId')
      .lean();

    const session = await createCheckoutSession({
      userId,
      email: user.email,
      stripeCustomerId: existing?.stripeCustomerId,
      priceId: plan.stripePriceId,
    });

    return res.status(200).json({
      checkoutUrl: session.url,
      sessionId: session.sessionId,
    });
  } catch (err) {
    if (err instanceof StripeClientError) {
      return res.status(503).json({ error: err.code, message: err.message });
    }
    return next(err);
  }
});

router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const subscription = await findSubscriptionForUser(userId, '+stripeCustomerId');

    if (!subscription?.stripeCustomerId) {
      return res.status(404).json({
        error: 'not_found',
        message: 'No billing customer found. Start checkout first.',
      });
    }

    const portal = await createCustomerPortalSession(subscription.stripeCustomerId);
    return res.status(200).json({ portalUrl: portal.url });
  } catch (err) {
    if (err instanceof StripeClientError) {
      return res.status(503).json({ error: err.code, message: err.message });
    }
    return next(err);
  }
});

router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody ?? req.body;

    const event = verifyWebhookSignature(rawBody, signature);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.userId;
      const stripeCustomerId = session.customer;
      const stripeSubscriptionId = session.subscription;
      if (userId && stripeCustomerId) {
        await upsertSubscriptionFromStripe({
          userId,
          status: 'active',
          stripeCustomerId,
          stripeSubscriptionId,
          planTier: 'starter',
        });
      }
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object;
      const stripeCustomerId = sub.customer;
      const existing = await Subscription.findOne({ stripeCustomerId })
        .select('+stripeCustomerId')
        .lean();
      if (existing) {
        const status =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : mapStripeStatus(sub.status);
        await upsertSubscriptionFromStripe({
          userId: existing.userId,
          status,
          currentPeriodEnd: sub.current_period_end
            ? sub.current_period_end * 1000
            : undefined,
          stripeCustomerId,
          stripeSubscriptionId: sub.id,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    if (err instanceof StripeClientError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    return next(err);
  }
});

module.exports = router;
