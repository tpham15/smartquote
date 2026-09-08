#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'benchmarks', 'pilot-golden');
const lockPath = path.join(dir, 'commercial-freeze-lock.json');
const scenarioPath = path.join(dir, 'commercial-scenarios.json');
const extractionPath = path.join(dir, 'extraction-seed.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
const extraction = JSON.parse(fs.readFileSync(extractionPath, 'utf8'));

assert.equal(lock.schemaVersion, 'sq-pilot-golden-freeze-lock-v1');
assert.equal(lock.commercialScenariosSha256, sha(scenarioPath), 'commercial golden fixture mutated without version bump');
assert.equal(lock.extractionSeedSha256, sha(extractionPath), 'extraction seed reference mutated without version bump');
assert.equal(lock.scenarioCount, scenarios.scenarios.length);
assert.equal(lock.extractionManifestSha256, extraction.dataset.manifestSha256);
assert(scenarios.scenarios.length >= 5, 'need >=5 commercial golden scenarios');
assert.equal(extraction.dataset.documents, 5);
assert.equal(extraction.dataset.productRows, 156);
assert.equal(extraction.dataset.nonProductTraps, 23);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert(pkg.scripts?.['smoke:pilot-p12'], 'package.json missing smoke:pilot-p12');
assert(pkg.scripts?.['smoke:pilot-release'], 'package.json missing smoke:pilot-release');
assert(String(pkg.scripts?.['smoke:pilot'] || '').includes('smoke:pilot-p12'), 'main smoke:pilot must include P1.2');
assert(pkg.scripts?.['golden:pilot:private'] && pkg.scripts?.['golden:pilot:baseline:verify'], 'private golden release commands missing');
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
assert(ignore.includes('benchmarks/pilot-golden/private/**'), 'P1.2 private golden data must be gitignored');
assert(ignore.includes('benchmarks/pilot-golden/reports/**'), 'P1.2 generated reports must be gitignored');
const publicPrivateEntries = fs.readdirSync(path.join(dir, 'private')).filter((x) => x !== '.gitkeep');
assert.equal(publicPrivateEntries.length, 0, 'GitHub-ready source must not contain private P1.2 golden files');

// Prove the lock actually rejects mutation rather than only matching happy-path constants.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-p12-freeze-'));
const mutant = path.join(tmp, 'commercial-scenarios.json');
fs.copyFileSync(scenarioPath, mutant);
fs.appendFileSync(mutant, ' ');
assert.notEqual(sha(mutant), lock.commercialScenariosSha256, 'mutation probe did not change fixture hash');

console.log('✓ Pilot P1.2 Golden Freeze smoke PASS');
console.log(`  commercial scenarios=${lock.scenarioCount}`);
console.log(`  extraction seed=${extraction.dataset.documents} docs / ${extraction.dataset.productRows} products / ${extraction.dataset.nonProductTraps} traps`);
