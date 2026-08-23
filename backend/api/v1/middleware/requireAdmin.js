'use strict';

const mongoose = require('mongoose');
const User = mongoose.model('User');

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('platformAdmin').lean();
    if (!user?.platformAdmin) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin };
