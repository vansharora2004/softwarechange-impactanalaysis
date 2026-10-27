/**
 * apiModelSelectionTests.js
 * -------------------------
 * Contract and integration test suite for live model selection:
 * Canonical Baseline, EGCP v4, and Comparative Analysis.
 */

'use strict';

import assert from 'assert';

const API_BASE = 'http://localhost:5000/api';
const SEED = ['org.springframework.samples.petclinic.service.ClinicServiceImpl'];

console.log('\n=== API Model Selection & Routing Test Suite ===\n');

async function runTests() {
  let passed = 0;

  // 1. Default model parameter defaults strictly to canonical baseline
  const res1 = await fetch(`${API_BASE}/analyse-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: SEED })
  });
  const data1 = await res1.json();
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(data1.success, true);
  assert.strictEqual(data1.model, 'canonical');
  assert(Array.isArray(data1.baselineOutput), 'baselineOutput array present');
  console.log('  ✓ Test 1: POST /api/analyse-impact defaults strictly to canonical baseline');
  passed++;

  // 2. Explicit model: 'canonical'
  const res2 = await fetch(`${API_BASE}/analyse-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: SEED, model: 'canonical' })
  });
  const data2 = await res2.json();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(data2.model, 'canonical');
  console.log('  ✓ Test 2: POST /api/analyse-impact with model="canonical" returns baseline');
  passed++;

  // 3. Explicit model: 'egcp_v4'
  const res3 = await fetch(`${API_BASE}/analyse-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: SEED, model: 'egcp_v4' })
  });
  const data3 = await res3.json();
  assert.strictEqual(res3.status, 200);
  assert.strictEqual(data3.model, 'egcp_v4');
  assert(Array.isArray(data3.potentiallyImpactedComponents), 'potentiallyImpactedComponents array present');
  assert(data3.potentiallyImpactedComponents.length > 0, 'Candidates returned');
  const topEgcp = data3.potentiallyImpactedComponents[0];
  assert.strictEqual(topEgcp.egcp_v4_rank, 1);
  assert(typeof topEgcp.egcp_v4_score === 'number');
  assert(data3.evolutionaryStatus, 'evolutionaryStatus present');
  console.log(`  ✓ Test 3: POST /api/analyse-impact with model="egcp_v4" returns EGCP v4 output (Top: ${topEgcp.name}, score: ${topEgcp.egcp_v4_score})`);
  passed++;

  // 4. Explicit model: 'compare'
  const res4 = await fetch(`${API_BASE}/analyse-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: SEED, model: 'compare' })
  });
  const data4 = await res4.json();
  assert.strictEqual(res4.status, 200);
  assert.strictEqual(data4.model, 'compare');
  assert(Array.isArray(data4.baselineOutput), 'baselineOutput array present');
  assert(Array.isArray(data4.egcpOutput), 'egcpOutput array present');
  assert(data4.comparison, 'comparison object present');
  assert(Array.isArray(data4.comparison.rankDeltas), 'rankDeltas array present');
  console.log(`  ✓ Test 4: POST /api/analyse-impact with model="compare" returns comparative report (Common: ${data4.comparison.commonCount})`);
  passed++;

  // 5. Dedicated endpoint /api/analyse-impact-egcp
  const res5 = await fetch(`${API_BASE}/analyse-impact-egcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: SEED })
  });
  const data5 = await res5.json();
  assert.strictEqual(res5.status, 200);
  assert.strictEqual(data5.modelUsed, 'egcp_v4_combined');
  console.log('  ✓ Test 5: Dedicated POST /api/analyse-impact-egcp responds successfully');
  passed++;

  // 6. Dedicated endpoint /api/analyse-impact-compare
  const res6 = await fetch(`${API_BASE}/analyse-impact-compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: SEED })
  });
  const data6 = await res6.json();
  assert.strictEqual(res6.status, 200);
  assert.strictEqual(data6.model, 'compare');
  console.log('  ✓ Test 6: Dedicated POST /api/analyse-impact-compare responds successfully');
  passed++;

  // 7. Input validation error handling
  const res7 = await fetch(`${API_BASE}/analyse-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changedComponents: [], model: 'egcp_v4' })
  });
  assert.strictEqual(res7.status, 400);
  console.log('  ✓ Test 7: Empty changed components rejected with 400 Bad Request');
  passed++;

  console.log(`\n===========================================================`);
  console.log(`API Model Selection Tests: ${passed} passed, 0 failed`);
  console.log(`===========================================================\n`);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
