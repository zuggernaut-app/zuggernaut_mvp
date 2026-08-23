'use strict';

const mongoose = require('mongoose');
const {
  GRACE_PERIOD_MS,
  assertActivePlan,
  upsertSubscriptionFromStripe,
  SubscriptionGateError,
  isWithinGracePeriod,
} = require('../services/billing/subscriptionGate');

describe('subscriptionGate', () => {
  const User = mongoose.model('User');
  const Plan = mongoose.model('Plan');
  const Subscription = mongoose.model('Subscription');

  let originalBillingBypass;
  let originalSoftLaunch;
  let originalTesterEmails;

  beforeEach(() => {
    originalBillingBypass = process.env.BILLING_FREE_PLAN_TEST;
    originalSoftLaunch = process.env.SOFT_LAUNCH_MODE;
    originalTesterEmails = process.env.SOFT_LAUNCH_TESTER_EMAILS;
    delete process.env.BILLING_FREE_PLAN_TEST;
    delete process.env.SOFT_LAUNCH_MODE;
    delete process.env.SOFT_LAUNCH_TESTER_EMAILS;
  });

  afterEach(() => {
    if (originalBillingBypass === undefined) {
      delete process.env.BILLING_FREE_PLAN_TEST;
    } else {
      process.env.BILLING_FREE_PLAN_TEST = originalBillingBypass;
    }
    if (originalSoftLaunch === undefined) {
      delete process.env.SOFT_LAUNCH_MODE;
    } else {
      process.env.SOFT_LAUNCH_MODE = originalSoftLaunch;
    }
    if (originalTesterEmails === undefined) {
      delete process.env.SOFT_LAUNCH_TESTER_EMAILS;
    } else {
      process.env.SOFT_LAUNCH_TESTER_EMAILS = originalTesterEmails;
    }
  });

  async function seedPlan() {
    return Plan.findOneAndUpdate(
      { tier: 'starter' },
      { $set: { name: 'Starter', stripePriceId: 'price_test', active: true } },
      { upsert: true, new: true }
    );
  }

  it('allows active subscription', async () => {
    const user = await User.create({ email: 'gate-active@example.com' });
    const plan = await seedPlan();
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const result = await assertActivePlan(user._id, 'setup_start');
    expect(result.allowed).toBe(true);
    expect(result.grace).toBe(false);
  });

  it('allows lapsed subscription within grace window', async () => {
    const user = await User.create({ email: 'gate-grace@example.com' });
    const plan = await seedPlan();
    const periodEnd = new Date(Date.now() - 86400000);
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'past_due',
      currentPeriodEnd: periodEnd,
    });

    expect(isWithinGracePeriod(periodEnd)).toBe(true);
    const result = await assertActivePlan(user._id, 'campaign_enable');
    expect(result.allowed).toBe(true);
    expect(result.grace).toBe(true);
  });

  it('prefers org subscription over stale personal subscription when org billing exists', async () => {
    const Org = mongoose.model('Org');
    const owner = await User.create({ email: 'gate-org-owner@example.com' });
    const member = await User.create({
      email: 'gate-org-member@example.com',
      primaryOrgId: null,
    });
    const plan = await seedPlan();
    const org = await Org.create({ name: 'Gate Org', ownerUserId: owner._id });

    await User.findByIdAndUpdate(member._id, { $set: { primaryOrgId: org._id } });
    await Subscription.create({
      userId: member._id,
      planId: plan._id,
      status: 'canceled',
      currentPeriodEnd: new Date(Date.now() - GRACE_PERIOD_MS - 1000),
    });
    await Subscription.create({
      userId: owner._id,
      orgId: org._id,
      planId: plan._id,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const result = await assertActivePlan(member._id, 'setup_start');
    expect(result.allowed).toBe(true);
    expect(result.grace).toBe(false);
  });

  it('blocks subscription outside grace window', async () => {
    const user = await User.create({ email: 'gate-lapsed@example.com' });
    const plan = await seedPlan();
    const periodEnd = new Date(Date.now() - GRACE_PERIOD_MS - 1000);
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'canceled',
      currentPeriodEnd: periodEnd,
    });

    await expect(assertActivePlan(user._id, 'setup_start')).rejects.toBeInstanceOf(
      SubscriptionGateError
    );
  });

  it('upserts subscription from stripe webhook fields', async () => {
    const user = await User.create({ email: 'gate-upsert@example.com' });
    await seedPlan();

    const doc = await upsertSubscriptionFromStripe({
      userId: user._id,
      planTier: 'starter',
      status: 'active',
      currentPeriodEnd: Date.now() + 3600000,
      stripeCustomerId: 'cus_test_1',
      stripeSubscriptionId: 'sub_test_1',
    });

    expect(doc.status).toBe('active');
    expect(doc.planId).toBeTruthy();

    const stored = await Subscription.findOne({ userId: user._id })
      .select('+stripeCustomerId +stripeSubscriptionId')
      .exec();
    expect(stored.stripeCustomerId).toBe('cus_test_1');
    expect(stored.stripeSubscriptionId).toBe('sub_test_1');
  });

  it('sets orgId from primaryOrgId on first upsert only', async () => {
    const Org = mongoose.model('Org');
    const owner = await User.create({ email: 'gate-upsert-org@example.com' });
    const org = await Org.create({ name: 'Upsert Org', ownerUserId: owner._id });
    await User.findByIdAndUpdate(owner._id, { $set: { primaryOrgId: org._id } });
    await seedPlan();

    const doc = await upsertSubscriptionFromStripe({
      userId: owner._id,
      status: 'active',
      stripeCustomerId: 'cus_org_1',
      stripeSubscriptionId: 'sub_org_1',
      planTier: 'starter',
    });
    expect(doc.orgId?.toString()).toBe(org._id.toString());

    const otherOrg = await Org.create({ name: 'Other Org', ownerUserId: owner._id });
    await User.findByIdAndUpdate(owner._id, { $set: { primaryOrgId: otherOrg._id } });

    const retry = await upsertSubscriptionFromStripe({
      userId: owner._id,
      status: 'active',
      stripeCustomerId: 'cus_org_1',
      stripeSubscriptionId: 'sub_org_1',
      planTier: 'starter',
    });
    expect(retry.orgId?.toString()).toBe(org._id.toString());
  });

  describe('billing free plan test bypass', () => {
    let originalNodeEnv;
    let originalFlag;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      originalFlag = process.env.BILLING_FREE_PLAN_TEST;
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.BILLING_FREE_PLAN_TEST = originalFlag;
    });

    it('allows setup_start when bypass flag on and NODE_ENV=development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.BILLING_FREE_PLAN_TEST = 'true';
      const user = await User.create({ email: 'bypass-dev@example.com' });
      const result = await assertActivePlan(user._id, 'setup_start');
      expect(result.allowed).toBe(true);
      expect(result.subscription).toBeNull();
    });

    it('allows campaign_enable when bypass flag on and NODE_ENV=test', async () => {
      process.env.NODE_ENV = 'test';
      process.env.BILLING_FREE_PLAN_TEST = 'true';
      const user = await User.create({ email: 'bypass-test@example.com' });
      const result = await assertActivePlan(user._id, 'campaign_enable');
      expect(result.allowed).toBe(true);
    });

    it('blocks bypass when NODE_ENV=production even if flag is set', async () => {
      process.env.NODE_ENV = 'production';
      process.env.BILLING_FREE_PLAN_TEST = 'true';
      const user = await User.create({ email: 'bypass-prod@example.com' });
      await expect(assertActivePlan(user._id, 'setup_start')).rejects.toBeInstanceOf(
        SubscriptionGateError
      );
    });

    it('blocks bypass when NODE_ENV=staging even if flag is set', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.BILLING_FREE_PLAN_TEST = 'true';
      const user = await User.create({ email: 'bypass-staging@example.com' });
      await expect(assertActivePlan(user._id, 'setup_start')).rejects.toBeInstanceOf(
        SubscriptionGateError
      );
    });

    it('blocks bypass when flag is off', async () => {
      process.env.NODE_ENV = 'development';
      process.env.BILLING_FREE_PLAN_TEST = 'false';
      const user = await User.create({ email: 'no-bypass@example.com' });
      await expect(assertActivePlan(user._id, 'setup_start')).rejects.toBeInstanceOf(
        SubscriptionGateError
      );
    });
  });

  describe('soft launch tester bypass', () => {
    let originalSoftLaunch;
    let originalTesterEmails;

    beforeEach(() => {
      originalSoftLaunch = process.env.SOFT_LAUNCH_MODE;
      originalTesterEmails = process.env.SOFT_LAUNCH_TESTER_EMAILS;
    });

    afterEach(() => {
      process.env.SOFT_LAUNCH_MODE = originalSoftLaunch;
      process.env.SOFT_LAUNCH_TESTER_EMAILS = originalTesterEmails;
    });

    it('allows allowlisted tester when SOFT_LAUNCH_MODE is true', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      process.env.SOFT_LAUNCH_TESTER_EMAILS = 'tester@example.com';
      const user = await User.create({ email: 'tester@example.com' });
      const result = await assertActivePlan(user._id, 'setup_start');
      expect(result.allowed).toBe(true);
      expect(result.softLaunchTesterBypass).toBe(true);
    });

    it('does not bypass non-allowlisted user when SOFT_LAUNCH_MODE is true', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      process.env.SOFT_LAUNCH_TESTER_EMAILS = 'tester@example.com';
      const user = await User.create({ email: 'other@example.com' });
      await expect(assertActivePlan(user._id, 'setup_start')).rejects.toBeInstanceOf(
        SubscriptionGateError
      );
    });
  });
});
