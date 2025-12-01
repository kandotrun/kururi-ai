const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'index.html');
const destDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, 'index.html');
fs.copyFileSync(src, dest);
