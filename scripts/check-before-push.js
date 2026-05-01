'use strict';

/**
 * Lightweight guard before push/commit: rejects staging of raw env-secret files.
 * Run from repo root: `npm run check:before-push`.
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function sh(cmd) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function isDisallowedSecretPath(rel) {
  const normalized = rel.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);

  if (normalized.endsWith('.env.example') || normalized.includes('.env.example')) {
    return false;
  }
  if (/^\.env(\.|$|$)/i.test(base) || base === '.env') {
    return true;
  }
  if (/\.env\.local$/i.test(base)) {
    return true;
  }
  if (/\.env\.test$/i.test(base)) {
    return true;
  }

  const segmentMatch = normalized.split('/').some((segment) => {
    if (!segment.startsWith('.env')) {
      return false;
    }
    if (segment === '.env.example') {
      return false;
    }
    return /^\.env($|\..+)/.test(segment);
  });

  return segmentMatch;
}

function main() {
  let staged;
  try {
    staged = sh('git diff --cached --name-only');
  } catch {
    console.warn(
      '[check-before-push] Not a git repo or git unavailable — skipping file checks.'
    );
    console.warn('[check-before-push] Manual checklist: see CONTRIBUTING.md');
    process.exit(0);
  }

  const files = staged
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const bad = files.filter(isDisallowedSecretPath);
  if (bad.length > 0) {
    console.error(
      '[check-before-push] Blocked: secret-style env paths are staged. Unstage before push:\n'
    );
    for (const line of bad) {
      console.error(`  - ${line}`);
    }
    console.error(
      '\nRun: git restore --staged <path>\nTemplates like **/.env.example are allowed.'
    );
    process.exit(1);
  }

  console.warn('[check-before-push] OK — no staged .env secrets detected.');
  console.warn('[check-before-push] Still skim your diff (CONTRIBUTING.md).');

  try {
    const stat = sh('git diff --stat');
    const lines = stat ? stat.split('\n').length : 0;
    console.warn(`[check-before-push] git diff stats ~${lines} line(s); review before push.`);
  } catch {
    // ignore — optional telemetry
  }
}

main();
