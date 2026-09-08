#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback='') { const i=process.argv.indexOf(`--${name}`); return i>=0 && process.argv[i+1] && !process.argv[i+1].startsWith('--') ? process.argv[i+1] : fallback; }
const creating = process.argv.includes('--create-baseline');
const reviewerConfirmed = process.argv.includes('--reviewer-confirmed');
const manifest = path.resolve(arg('manifest', process.env.SQ_DOCBENCH_PRIVATE_MANIFEST || path.join(root,'benchmarks/vietnam-docbench/private/manifest.json')));
const baseline = path.resolve(arg('baseline', path.join(path.dirname(manifest),'pilot-p12-current-native-baseline.json')));
if (!fs.existsSync(manifest)) throw new Error(`Private manifest missing: ${manifest}`);
if (creating && !reviewerConfirmed) { console.error('✗ Refusing baseline creation without --reviewer-confirmed'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'sq-p12-native-'));
const predictions = path.join(tmp,'predictions.json'); const scoreDir = path.join(tmp,'score');
function run(script,args) { const r=spawnSync(process.execPath,[path.join(root,script),...args],{cwd:root,encoding:'utf8'}); if(r.status!==0) throw new Error(`${script} failed\n${r.stdout}\n${r.stderr}`); return r; }
run('benchmarks/vietnam-docbench/engines/run-adapter.mjs',['--manifest',manifest,'--adapter',path.join(root,'benchmarks/vietnam-docbench/engines/current-smartquote-native.mjs'),'--out',predictions]);
run('benchmarks/vietnam-docbench/run.mjs',['--manifest',manifest,'--predictions',predictions,'--out',scoreDir]);
const report=JSON.parse(fs.readFileSync(path.join(scoreDir,'report.json'),'utf8'));
const pickMetrics=(m)=>({
  rowPrecision:m?.rowDetection?.precision ?? null,
  rowRecall:m?.rowDetection?.recall ?? null,
  falseProductRate:m?.rowDetection?.falseProductRate ?? null,
  skuExact:m?.fields?.sku?.exact ?? null,
  unitPriceExact:m?.fields?.unitPrice?.exact ?? null,
  quantityExact:m?.fields?.quantity?.exact ?? null,
  trustedRowAccuracy:m?.trustedRows?.accuracy ?? null,
  unsafeAutoApproveRate:m?.autoApproval?.unsafeRate ?? null,
  groundingCoverage:m?.grounding?.coverage ?? null,
});
const current={schemaVersion:'sq-pilot-p12-native-baseline-v1',createdAt:new Date().toISOString(),engine:report.engine,dataset:report.dataset,overall:pickMetrics(report.overall),documents:Object.fromEntries(report.documents.map((d)=>[d.documentId,pickMetrics(d.metrics)]))};
if(creating){fs.writeFileSync(baseline,JSON.stringify(current,null,2)+'\n');console.log(`✓ Created P1.2 native baseline: ${baseline}`);process.exit(0);}
if(!fs.existsSync(baseline)) throw new Error(`P1.2 native baseline missing: ${baseline}. Create once with --create-baseline --reviewer-confirmed.`);
const frozen=JSON.parse(fs.readFileSync(baseline,'utf8')); assert.equal(frozen.schemaVersion,current.schemaVersion); assert.equal(frozen.dataset.id,current.dataset.id); assert.equal(frozen.dataset.version,current.dataset.version);
const higherBetter=new Set(['rowPrecision','rowRecall','skuExact','unitPriceExact','quantityExact','trustedRowAccuracy','groundingCoverage']);
const lowerBetter=new Set(['falseProductRate','unsafeAutoApproveRate']);
const EPS=1e-12; const regressions=[];
function compare(scope,b,c){for(const key of [...higherBetter,...lowerBetter]){const bv=b?.[key],cv=c?.[key];if(bv==null||cv==null)continue;if(higherBetter.has(key)&&cv+EPS<bv)regressions.push(`${scope}.${key}: ${cv} < baseline ${bv}`);if(lowerBetter.has(key)&&cv-EPS>bv)regressions.push(`${scope}.${key}: ${cv} > baseline ${bv}`);}}
compare('overall',frozen.overall,current.overall); for(const [id,b] of Object.entries(frozen.documents||{})){if(!current.documents[id]){regressions.push(`document missing: ${id}`);continue;}compare(`documents.${id}`,b,current.documents[id]);}
if(regressions.length){console.error('✗ P1.2 native golden regression FAIL');for(const x of regressions)console.error(`  - ${x}`);process.exit(1);}console.log('✓ Pilot P1.2 Native Golden baseline PASS');console.log(`  baseline=${baseline}`);
