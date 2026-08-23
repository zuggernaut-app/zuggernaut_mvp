'use strict';

/**
 * Soft-launch product constraints (forms-only goals, single business, no setup reruns).
 * Enabled via SOFT_LAUNCH_MODE=true in environment.
 */
function isSoftLaunchMode() {
  const flag = process.env.SOFT_LAUNCH_MODE?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

module.exports = { isSoftLaunchMode };
