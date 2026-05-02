'use strict';

const express = require('express');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const {
  isValidEmail,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
} = require('../../lib/validation');

const router = express.Router();

router.post('/', async (req, res, next) => {
  const emailRaw =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const nameRaw =
    typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!emailRaw) {
    return res.status(400).json({ error: 'validation_error', message: 'email is required' });
  }
  if (emailRaw.length > MAX_EMAIL_LENGTH) {
    return res.status(400).json({
      error: 'validation_error',
      message: `email must be at most ${MAX_EMAIL_LENGTH} characters`,
    });
  }
  if (!isValidEmail(emailRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'email format is invalid',
    });
  }

  let name;
  if (nameRaw) {
    if (nameRaw.length > MAX_NAME_LENGTH) {
      return res.status(400).json({
        error: 'validation_error',
        message: `name must be at most ${MAX_NAME_LENGTH} characters`,
      });
    }
    name = nameRaw;
  }

  try {
    const user = await User.create({ email: emailRaw, name: name || undefined });
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
