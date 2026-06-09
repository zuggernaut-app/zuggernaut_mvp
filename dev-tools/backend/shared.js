'use strict';

const path = require('path');

const backendRoot = path.resolve(__dirname, '../../backend');

require(path.join(backendRoot, 'models'));

function backendRequire(specifier) {
  return require(require.resolve(specifier, { paths: [backendRoot] }));
}

module.exports = {
  backendRoot,
  backendRequire,
  mongoose: backendRequire('mongoose'),
};
