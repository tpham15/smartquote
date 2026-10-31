#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const root = process.cwd();
const biscoArg = process.argv[2] || process.env.SQ_BISCO_GOLDEN_XLSX || '';
const rogerArg = process.argv[3] || process.env.SQ_ROGER_GOLDEN_PDF || '';
const bisco = biscoArg ? path.resolve(biscoArg) : '';
const roger = rogerArg ? path.resolve(rogerArg) : '';
const reportDir = path.join(root, 'pilot-artifacts');
fs.mkdirSync(reportDir, { recursive:true });
const reportPath = path.join(reportDir, 'pilot-local-gate-report.json');
const report = { schemaVersion:'sq-pilot-local-gate-v2', startedAt:new Date().toISOString(), biscoFile:bisco || null, rogerFile:roger || null, steps:[] };

function git(args) {
  const r=spawnSync('git',args,{cwd:root,encoding:'utf8'}); return r.status===0?String(r.stdout).trim():'';
}
report.gitCommit = git(['rev-parse','HEAD']) || null;
report.gitDirty = !!git(['status','--porcelain']);
if (bisco && fs.existsSync(bisco)) report.biscoSha256 = crypto.createHash('sha256').update(fs.readFileSync(bisco)).digest('hex');
if (roger && fs.existsSync(roger)) report.rogerSha256 = crypto.createHash('sha256').update(fs.readFileSync(roger)).digest('hex');

function saveAndExit(code) {
  report.finishedAt = new Date().toISOString();
  report.status = code === 0 ? 'PASS' : 'FAIL';
  fs.writeFileSync(reportPath, JSON.stringify(report,null,2)+'\n');
  console.log(`\nPilot gate report: ${reportPath}`);
  process.exit(code);
}

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===`);
  const started = Date.now();
  const r = spawnSync(cmd,args,{cwd:root,stdio:'inherit',env:process.env});
  report.steps.push({label,cmd:[cmd,...args].join(' '),status:r.status===0?'PASS':'FAIL',exitCode:r.status,durationMs:Date.now()-started});
  if (r.status !== 0) saveAndExit(r.status || 1);
}

run('Environment doctor','node',['scripts/pilot-env-doctor.mjs',bisco,roger]);
run('Production build','npm',['run','build']);
run('Offline pilot regression','npm',['run','smoke:pilot:offline']);
run('Bisco production real-file E2E','node',['scripts/pilot-bisco-real-file-gate.mjs',bisco]);
run('Roger production real-file E2E','node',['scripts/pilot-roger-real-file-gate.mjs',roger]);

if (report.gitDirty) {
  console.error('\n✗ PILOT GATE FAIL: git working tree is dirty. Commit/tag the exact tested tree before pilot.');
  report.steps.push({label:'Git release freeze',status:'FAIL',reason:'dirty working tree'});
  saveAndExit(1);
}
report.steps.push({label:'Git release freeze',status:'PASS',commit:report.gitCommit});
console.log('\n✓ LOCAL PILOT RELEASE GATE PASS');
console.log('  This proves the exact committed build + offline regressions + real Bisco + Roger production imports.');
console.log('  Production/Supabase QA and manual UAT are still mandatory before exposing pilot users.');
saveAndExit(0);
