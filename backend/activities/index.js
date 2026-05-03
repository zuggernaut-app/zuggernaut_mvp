'use strict';

const { completeSkeletonSetupActivity } = require('./completeSkeletonSetup');
const {
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
} = require('./scrapeActivities');

/** Activity name → implementation (see `Worker.create` in `scripts/temporal-worker.js`). */
module.exports = {
  completeSkeletonSetupActivity,
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
};
