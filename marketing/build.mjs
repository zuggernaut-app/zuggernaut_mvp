#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');
const distDir = join(__dirname, 'dist');

const appUrl = process.env.APP_URL;
if (!appUrl || !appUrl.trim()) {
  console.error('marketing:build requires APP_URL (e.g. https://zuggernaut-mvp.web.app)');
  process.exit(1);
}

const normalizedAppUrl = appUrl.trim().replace(/\/$/, '');

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

mkdirSync(distDir, { recursive: true });

for (const file of walk(srcDir)) {
  const rel = relative(srcDir, file);
  const dest = join(distDir, rel);
  mkdirSync(dirname(dest), { recursive: true });

  const isText =
    /\.(html?|css|xml|txt|svg|json|webmanifest)$/i.test(file) ||
    file.endsWith('.htaccess');

  if (isText) {
    const raw = readFileSync(file, 'utf8');
    const out = raw.replaceAll('%APP_URL%', normalizedAppUrl);
    if (out.includes('%APP_URL%')) {
      console.error(`Unresolved %APP_URL% placeholder in ${rel}`);
      process.exit(1);
    }
    writeFileSync(dest, out, 'utf8');
  } else {
    cpSync(file, dest);
  }
}

console.log(`marketing:build wrote ${distDir} (APP_URL=${normalizedAppUrl})`);
