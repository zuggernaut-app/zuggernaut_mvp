'use strict';

const express = require('express');
const mongoose = require('mongoose');
const User = mongoose.model('User');

const router = express.Router();

router.post('/', async (req, res, next) => {
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;

  if (!email) {
    return res.status(400).json({ error: 'validation_error', message: 'email is required' });
  }

  try {
    const user = await User.create({ email, name: name || undefined });
    return res.status(201).json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name ?? null,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error: 'conflict',
        message: 'A user with this email already exists',
      });
    }
    return next(err);
  }
});

module.exports = router;
