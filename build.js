const fs = require('fs');

if (!fs.existsSync('dist')) fs.mkdirSync('dist');

const content = fs.readFileSync('src/index.js', 'utf8');

fs.writeFileSync('dist/index.js', content);

const esmContent = content.replace(
    /module\.exports = \{([\s\S]*?)\};/,
    'export {\n$1\n};'
);

fs.writeFileSync('dist/index.mjs', esmContent);

if (fs.existsSync('src/index.d.ts')) {
    fs.copyFileSync('src/index.d.ts', 'dist/index.d.ts');
}

console.log('Built CommonJS and ESM versions'); 