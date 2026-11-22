'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ignored = new Set(['.git', 'node_modules']);
const legacyPassword = ['252', '6885'].join('');
const legacyAdmin = ['Admin', '@2026'].join('');
const legacyField = ['plain_', 'password'].join('');
const forbidden = [
  new RegExp(['sb_', 'publishable_'].join(''), 'i'),
  /anon[_-]?key/i,
  new RegExp(legacyAdmin, 'i'),
  new RegExp(legacyPassword),
  new RegExp(['051', '234'].join('') + '\\d{4,}'),
  new RegExp(['seed', 'IfNeeded'].join(''), 'i'),
  new RegExp(['DEFAULT_', 'MOBILES'].join(''), 'i'),
  new RegExp(legacyField, 'i'),
  new RegExp(['obfus', 'cate|deobfus', 'cate'].join(''), 'i'),
  new RegExp(['G-', '001|ICU-', '01'].join(''), 'i')
];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (ignored.has(entry.name) || file.includes(`${path.sep}tests${path.sep}security${path.sep}`)) continue;
    if (entry.isDirectory()) walk(file);
    else if (/\.(html|js|cjs|mjs|ts|json|sql|env|md)$/.test(entry.name) || entry.name === '.gitignore') files.push(file);
  }
}
walk(root);
const failures = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) failures.push(`${path.relative(root, file)}: ${pattern}`);
}
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
if (!/users:\s*\[\], referrals:\s*\[\], beds:\s*\[\]/.test(html)) failures.push('public/index.html: initial state is not empty');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`security scan passed (${files.length} files)`);
