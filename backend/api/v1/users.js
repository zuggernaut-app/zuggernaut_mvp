'use strict';

const express = require('express');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const { requireAuth } = require('./middleware/requireAuth');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../lib/auth/membershipCheck');

const router = express.Router();

router.put('/primary-business', requireAuth, async (req, res) => {
  const businessIdRaw =
    typeof req.body?.businessId === 'string' ? req.body.businessId.trim() : '';
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'businessId is required and must be a valid ObjectId',
    });
  }

  const userId = new mongoose.Types.ObjectId(req.user.id);
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  try {
    await assertBusinessMembershipOrOwnership(userId, businessIdRaw);
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      const status = err.code === 'forbidden' ? 403 : 404;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    throw err;
  }

  await User.findByIdAndUpdate(userId, { $set: { primaryBusinessId: businessId } });

  return res.status(200).json({
    ok: true,
    primaryBusinessId: businessId.toString(),
  });
});

module.exports = router;
