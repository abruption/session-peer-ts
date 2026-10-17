require('node:fs').writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
