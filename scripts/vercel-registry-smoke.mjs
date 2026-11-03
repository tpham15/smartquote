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

const vercel = fs.existsSync('vercel.json') ? JSON.parse(fs.readFileSync('vercel.json', 'utf8')) : {};
if (vercel.installCommand !== 'npm ci --include=dev') {
  failures.push('vercel.json must force installCommand=npm ci --include=dev so Vite devDependencies are present at build time');
}

const npmrc = fs.existsSync('.npmrc') ? fs.readFileSync('.npmrc', 'utf8') : '';
if (!/registry\s*=\s*https:\/\/registry\.npmjs\.org\/?/i.test(npmrc)) {
  failures.push('.npmrc must pin registry=https://registry.npmjs.org/');
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const packages = lock.packages || {};
for (const [name, meta] of Object.entries(packages)) {
  if (meta?.resolved && typeof meta.resolved === 'string') {
    // RC16.1: the ONE allowed non-npm tarball is the official SheetJS 0.20.3 build
    // (npm stops at the vulnerable 0.18.5), pinned by its published SHA-512.
    const isOfficialSheetJs = name === 'node_modules/xlsx'
      && meta.resolved === 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
      && meta.integrity === 'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==';
    if (!isOfficialSheetJs && meta.resolved.includes('registry.npmjs.org') === false && meta.resolved.startsWith('http')) {
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
