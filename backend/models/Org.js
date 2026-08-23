const mongoose = require('mongoose');

const orgSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Org', orgSchema);
