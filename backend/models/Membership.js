const mongoose = require('mongoose');

const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'];

const membershipSchema = new mongoose.Schema(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: MEMBERSHIP_ROLES,
      index: true,
    },
  },
  { timestamps: true }
);

membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Membership', membershipSchema);
module.exports.MEMBERSHIP_ROLES = MEMBERSHIP_ROLES;
