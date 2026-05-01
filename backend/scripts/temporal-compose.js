'use strict';

const { execSync } = require('child_process');
const path = require('path');

const dir = path.join(__dirname, '../../docker/temporal');
const argv = process.argv.slice(2);
const cmd = `docker compose ${argv.join(' ')}`;

execSync(cmd, { cwd: dir, stdio: 'inherit' });
