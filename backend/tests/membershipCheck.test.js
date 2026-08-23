'use strict';

const mongoose = require('mongoose');
const {
  assertMembership,
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../lib/auth/membershipCheck');

describe('membershipCheck', () => {
  const User = mongoose.model('User');
  const Org = mongoose.model('Org');
  const Membership = mongoose.model('Membership');
  const BusinessContext = mongoose.model('BusinessContext');

  it('assertMembership enforces role rank', async () => {
    const owner = await User.create({ email: 'owner@example.com' });
    const member = await User.create({ email: 'member@example.com' });
    const org = await Org.create({ name: 'Org', ownerUserId: owner._id });
    await Membership.create({ orgId: org._id, userId: owner._id, role: 'owner' });
    await Membership.create({ orgId: org._id, userId: member._id, role: 'member' });

    await assertMembership(owner._id, org._id, 'admin');
    await expect(assertMembership(member._id, org._id, 'admin')).rejects.toBeInstanceOf(
      MembershipCheckError
    );
  });

  it('assertBusinessMembershipOrOwnership falls back to userId when orgId unset', async () => {
    const user = await User.create({ email: 'legacy@example.com' });
    const bc = await BusinessContext.create({ userId: user._id, businessName: 'Legacy' });

    const access = await assertBusinessMembershipOrOwnership(user._id, bc.businessId.toString());
    expect(access.businessId.toString()).toBe(bc.businessId.toString());
  });
});
