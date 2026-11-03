import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const EXCLUDED = new Map([
  ['smoke:pilot', 'chạy riêng trên staging: cần Supabase thật / qa:production'],
  ['smoke:pilot-release', 'chạy riêng trên staging: cần Supabase thật + private golden corpus'],
]);
const names = Object.keys(pkg.scripts || {})
  .filter((name) => name.startsWith('smoke:') && name !== 'smoke:all' && !EXCLUDED.has(name))
  .sort();

const rows = [];
for (const [name, reason] of EXCLUDED) {
  if (pkg.scripts?.[name]) rows.push({ name, status: 'SKIPPED', code: 0, reason });
}

for (const name of names) {
  const r = spawnSync('npm', ['run', name], {
    encoding: 'utf8',
    env: { ...process.env, SMARTQUOTE_SMOKE_ALL_CHILD: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
  const skippedLine = combined.split(/\r?\n/).find((line) => line.startsWith('SKIPPED '));
  const status = r.status !== 0 ? 'FAIL' : skippedLine ? 'SKIPPED' : 'PASS';
  rows.push({ name, status, code: r.status, reason: skippedLine ? skippedLine.replace(/^SKIPPED\s*/, '').trim() : '' });
  if (status === 'FAIL') process.exitCode = 1;
}

console.log('\n=== SMARTQUOTE SMOKE:ALL ===');
for (const row of rows) {
  const detail = row.status === 'SKIPPED' && row.reason ? ` — ${row.reason}` : '';
  console.log(`${row.status.padEnd(7)} ${row.name}${detail}`);
}
console.log(`TOTAL ${rows.length} · PASS ${rows.filter(x => x.status === 'PASS').length} · SKIPPED ${rows.filter(x => x.status === 'SKIPPED').length} · FAIL ${rows.filter(x => x.status === 'FAIL').length}`);
