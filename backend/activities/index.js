'use strict';

const { helloActivity } = require('./hello');

/** Activity name → implementation (see `Worker.create` in `scripts/temporal-worker.js`). */
module.exports = {
  helloActivity,
};
