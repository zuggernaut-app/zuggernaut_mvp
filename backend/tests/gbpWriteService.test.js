'use strict';

const mongoose = require('mongoose');
const { executeGbpWrite, GbpWriteError } = require('../services/capabilities/gbpWriteService');

describe('gbpWriteService', () => {
  const User = mongoose.model('User');
  const BusinessContext = mongoose.model('BusinessContext');
  const Org = mongoose.model('Org');
  const Membership = mongoose.model('Membership');

  async function seedBusiness(ownerEmail) {
    const user = await User.create({ email: ownerEmail });
    const org = await Org.create({ name: 'GBP Org', ownerUserId: user._id });
    await Membership.create({ orgId: org._id, userId: user._id, role: 'owner' });
    const bc = await BusinessContext.create({
      userId: user._id,
      orgId: org._id,
      businessName: 'GBP Biz',
      confirmedAt: new Date(),
    });
    return { user, bc };
  }

  it('requires consent before write', async () => {
    const { user, bc } = await seedBusiness('gbp-consent@example.com');
    await expect(
      executeGbpWrite(user._id, bc.businessId.toString(), { action: 'post', post: { summary: 'Hi' } }, false)
    ).rejects.toBeInstanceOf(GbpWriteError);
  });

  it('writes post when consent granted', async () => {
    process.env.GBP_API_MOCK = 'true';
    const { user, bc } = await seedBusiness('gbp-write@example.com');
    const result = await executeGbpWrite(
      user._id,
      bc.businessId.toString(),
      { action: 'post', post: { summary: 'Hello' } },
      true
    );
    expect(result.outcome).toBe('created');
  });
});
