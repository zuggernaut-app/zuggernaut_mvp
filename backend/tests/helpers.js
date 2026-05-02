'use strict';

const mongoose = require('mongoose');

async function createDevUser(email = 'dev@test.com') {
  const User = mongoose.model('User');
  return User.create({ email });
}

function authHeader(userId) {
  return { 'x-dev-user-id': userId._id.toString() };
}

module.exports = { createDevUser, authHeader };
