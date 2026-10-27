/**
 * apiBaselineContractTests.js
 * ----------------------------
 * Verification of the Canonical Structural Baseline API Contract.
 *
 * Verifies:
 *   1. Both /api/analyse-impact and /api/analyze-impact endpoints respond with 200 OK.
 *   2. Response contains success, executionMode, changedComponents, potentiallyImpactedComponents, and baselineOutput.
 *   3. Every recommended candidate contains required contract fields:
 *      id, name, type, impactLevel, reason, reasoningPath, hopDistance.
 *   4. Changed seed components are strictly excluded from results.
 *   5. Empty or missing changedComponents returns 400 Bad Request with error description.
 *   6. Results do NOT contain legacy 70/30 scores (influenceScore, alpha, beta).
 */

'use strict';

import express from 'express';
import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from '../routes/api.js';
import { closeDriver } from '../services/neo4jService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const GRAPH_JSON = path.join(BACKEND_ROOT, 'analysis_output.json');
let testSeedId = 'org.springframework.samples.petclinic.service.ClinicService';
if (fs.existsSync(GRAPH_JSON)) {
  try {
    const data = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf-8'));
    const found = (data.components || []).find(c => c.type === 'Service' && c.filePath) || (data.components || [])[0];
    if (found) testSeedId = found.id;
  } catch (_) {}
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch(err => {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    });
}

async function main() {
  console.log('\n=== Canonical Baseline API Contract Verification Test Suite ===\n');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  try {
    // Test 1: Canonical /api/analyse-impact endpoint
    await runTest('POST /api/analyse-impact returns canonical structural baseline', async () => {
      const res = await fetch(`${baseUrl}/analyse-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedComponents: [testSeedId] })
      });
      assert.strictEqual(res.status, 200, 'HTTP status should be 200');
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert(body.executionMode === 'neo4j' || body.executionMode === 'in-memory-fallback');
      assert.deepStrictEqual(body.changedComponents, [testSeedId]);
      assert(Array.isArray(body.potentiallyImpactedComponents), 'potentiallyImpactedComponents should be array');
      assert(Array.isArray(body.baselineOutput), 'baselineOutput should be array');
      assert.strictEqual(body.potentiallyImpactedComponents.length, body.baselineOutput.length);
      assert(body.potentiallyImpactedComponents.length > 0, 'Should find impacted components');

      // Verify contract fields
      for (const item of body.potentiallyImpactedComponents) {
        assert(item.id, 'Candidate must have id');
        assert(item.name, 'Candidate must have name');
        assert(item.type, 'Candidate must have type');
        assert(item.impactLevel, 'Candidate must have impactLevel');
        assert(['High', 'Medium', 'Low'].includes(item.impactLevel), 'impactLevel must be High, Medium, or Low');
        assert(item.reason, 'Candidate must have reason string');
        assert(item.reasoningPath, 'Candidate must have reasoningPath string');
        assert(item.hopDistance === 1 || item.hopDistance === 2, 'hopDistance must be 1 or 2');
        assert.notStrictEqual(item.id, testSeedId, 'Seed component must be excluded');

        // Verify 70/30 formula is NOT present in baseline response
        assert.strictEqual(item.influenceScore, undefined, 'Baseline must not contain legacy influenceScore');
        assert.strictEqual(item.artifactContext, undefined, 'Baseline must not contain legacy artifactContext');
      }
    });

    // Test 2: US English spelling alias /api/analyze-impact
    await runTest('POST /api/analyze-impact responds identically with 200 OK', async () => {
      const res = await fetch(`${baseUrl}/analyze-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedComponents: [testSeedId] })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert(body.potentiallyImpactedComponents.length > 0);
    });

    // Test 3: Validation on empty selection
    await runTest('POST /api/analyse-impact returns 400 on empty changedComponents array', async () => {
      const res = await fetch(`${baseUrl}/analyse-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedComponents: [] })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert(body.error && body.error.includes('select at least one'));
    });

    // Test 4: Validation on missing body
    await runTest('POST /api/analyse-impact returns 400 on missing changedComponents property', async () => {
      const res = await fetch(`${baseUrl}/analyse-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
    });

    // Test 5: Deterministic candidate ordering by impact priority then ID
    await runTest('Candidates are deterministically sorted by severity and alphabetical ID', async () => {
      const res = await fetch(`${baseUrl}/analyse-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedComponents: [testSeedId] })
      });
      const body = await res.json();
      const list = body.potentiallyImpactedComponents;
      const priMap = { High: 3, Medium: 2, Low: 1 };
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i];
        const b = list[i + 1];
        const diff = priMap[b.impactLevel] - priMap[a.impactLevel];
        assert(diff <= 0, `Priority violation between ${a.id} and ${b.id}`);
        if (diff === 0) {
          assert(a.id.localeCompare(b.id) <= 0, `Alphabetical tie-break violation between ${a.id} and ${b.id}`);
        }
      }
    });

  } finally {
    await new Promise(resolve => server.close(resolve));
    await closeDriver();
  }

  console.log(`\n===========================================================`);
  console.log(`API Contract Verification Results: ${passed} passed, ${failed} failed`);
  console.log(`===========================================================\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
