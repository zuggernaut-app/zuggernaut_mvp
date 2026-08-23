'use strict';

const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { requireAuth } = require('./middleware/requireAuth');
const { assertMembership, MembershipCheckError } = require('../../lib/auth/membershipCheck');
const { hashResetToken, resetTokenExpiresAt, verifyResetToken } = require('../../lib/auth/passwordReset');
const { sendEmail } = require('../../lib/notifications/emailTransport');
const { bootstrapOrgsForExistingUsers } = require('../../services/orgs/orgBootstrapMigration');
const { migrateUserSubscriptionsToOrg } = require('../../services/billing/orgBillingMigration');

const router = express.Router();
const Org = mongoose.model('Org');
const Membership = mongoose.model('Membership');
const InviteToken = mongoose.model('InviteToken');
const User = mongoose.model('User');

function inviteFrontendLink(email, plainToken) {
  const origin = process.env.FRONTEND_ORIGIN?.trim()?.split(',')[0]?.trim() || 'http://localhost:5173';
  const params = new URLSearchParams({ token: plainToken, email });
  return `${origin.replace(/\/+$/, '')}/team/accept-invite?${params.toString()}`;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const memberships = await Membership.find({ userId }).lean();
    if (memberships.length === 0) {
      return res.status(200).json({ orgs: [] });
    }

    const orgIds = memberships.map((row) => row.orgId);
    const orgRows = await Org.find({ _id: { $in: orgIds } })
      .select('name')
      .lean();
    const orgNameById = new Map(orgRows.map((org) => [org._id.toString(), org.name]));

    return res.status(200).json({
      orgs: memberships.map((membership) => ({
        id: membership.orgId.toString(),
        name: orgNameById.get(membership.orgId.toString()) ?? 'Organization',
        role: membership.role,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/bootstrap-migration', requireAuth, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'forbidden', message: 'Not available in production' });
    }
    const orgResult = await bootstrapOrgsForExistingUsers();
    const billingResult = await migrateUserSubscriptionsToOrg();
    return res.status(200).json({ orgResult, billingResult });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!nameRaw) {
      return res.status(400).json({ error: 'validation_error', message: 'name is required' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const existing = await Membership.findOne({ userId, role: 'owner' }).lean();
    if (existing) {
      return res.status(409).json({ error: 'conflict', message: 'Organization already exists for user' });
    }

    const org = await Org.create({ name: nameRaw, ownerUserId: userId });
    await Membership.create({ orgId: org._id, userId, role: 'owner' });
    await User.findByIdAndUpdate(userId, { $set: { primaryOrgId: org._id } });

    return res.status(201).json({ org: { id: org._id.toString(), name: org.name } });
  } catch (err) {
    return next(err);
  }
});

router.post('/:orgId/invites', requireAuth, async (req, res, next) => {
  try {
    const orgIdRaw = req.params.orgId;
    if (!mongoose.Types.ObjectId.isValid(orgIdRaw)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid orgId' });
    }
    const orgId = new mongoose.Types.ObjectId(orgIdRaw);
    await assertMembership(req.user.id, orgId, 'admin');

    const emailRaw =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim() : 'member';
    if (!emailRaw) {
      return res.status(400).json({ error: 'validation_error', message: 'email is required' });
    }
    if (!['admin', 'member'].includes(roleRaw)) {
      return res.status(400).json({ error: 'validation_error', message: 'role must be admin or member' });
    }

    const plainToken = crypto.randomBytes(32).toString('base64url');
    await InviteToken.create({
      orgId,
      email: emailRaw,
      role: roleRaw,
      tokenHash: hashResetToken(plainToken),
      expiresAt: resetTokenExpiresAt(),
      invitedByUserId: new mongoose.Types.ObjectId(req.user.id),
    });

    const inviteLink = inviteFrontendLink(emailRaw, plainToken);
    await sendEmail({
      to: emailRaw,
      subject: 'You are invited to a Zuggernaut organization',
      text: `Accept invite: ${inviteLink}`,
      html: `<p>Accept invite:</p><p><a href="${inviteLink}">${inviteLink}</a></p>`,
    });

    return res.status(200).json({ ok: true, message: 'Invite sent if email delivery is configured.' });
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      return res.status(403).json({ error: err.code, message: err.message });
    }
    return next(err);
  }
});

router.post('/accept-invite', requireAuth, async (req, res, next) => {
  try {
    const emailRaw =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : req.user.email;
    const tokenRaw = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

    if (!tokenRaw) {
      return res.status(400).json({ error: 'validation_error', message: 'token is required' });
    }

    const invite = await InviteToken.findOne({ email: emailRaw })
      .select('+tokenHash')
      .lean();
    if (
      !invite ||
      !invite.tokenHash ||
      invite.expiresAt < new Date() ||
      !verifyResetToken(tokenRaw, invite.tokenHash)
    ) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid or expired invite' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);
    await Membership.findOneAndUpdate(
      { orgId: invite.orgId, userId },
      { $set: { role: invite.role } },
      { upsert: true }
    );
    const memberUser = await User.findById(userId).select('primaryOrgId').lean();
    if (!memberUser?.primaryOrgId) {
      await User.findByIdAndUpdate(userId, { $set: { primaryOrgId: invite.orgId } });
    }
    await InviteToken.deleteOne({ _id: invite._id });

    return res.status(200).json({ ok: true, orgId: invite.orgId.toString() });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
