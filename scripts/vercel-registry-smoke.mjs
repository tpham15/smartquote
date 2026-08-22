import fs from 'node:fs';

const files = ['package-lock.json', 'package.json', '.npmrc'];
const forbidden = [
  'applied-caas',
  'artifactory/api/npm/npm-public',
  'internal.api.openai.org',
  'packages.applied-caas-gateway',
];

const failures = [];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const token of forbidden) {
    if (text.includes(token)) failures.push(`${file} contains ${token}`);
  }
}

const npmrc = fs.existsSync('.npmrc') ? fs.readFileSync('.npmrc', 'utf8') : '';
if (!/registry\s*=\s*https:\/\/registry\.npmjs\.org\/?/i.test(npmrc)) {
  failures.push('.npmrc must pin registry=https://registry.npmjs.org/');
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const packages = lock.packages || {};
for (const [name, meta] of Object.entries(packages)) {
  if (meta?.resolved && typeof meta.resolved === 'string') {
    if (meta.resolved.includes('registry.npmjs.org') === false && meta.resolved.startsWith('http')) {
      failures.push(`${name || '<root>'} resolved to non-public URL: ${meta.resolved}`);
    }
  }
}

if (failures.length) {
  console.error('Vercel registry smoke: FAIL');
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}

console.log('Vercel registry smoke: PASS');
