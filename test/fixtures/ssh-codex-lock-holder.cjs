'use strict';
// All fixture paths arrive as arguments, never executable source text.
const fd = require('node:fs').openSync(process.argv[2], 'w', 0o600);
require(process.argv[3]).flockSync(fd, 'exnb');
console.log('ready');
setInterval(() => {}, 1000);
