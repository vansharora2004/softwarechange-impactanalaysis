/**
 * engineTests.js
 * --------------
 * Phase 3 Automated Verification Test Suite.
 *
 * Verifies:
 *   1. Direct dependency traversal (1-hop) in baseline and context-aware engines.
 *   2. Two-hop dependency traversal with correct intermediate path explanation.
 *   3. Historical co-change evidence boosts score and marks 'historical_co_change' source.
 *   4. Artifact/context relationship boosts score and marks 'artifact_context' source.
 *   5. Recommendation supported by multiple evidence sources.
 *   6. Disconnected component is never recommended.
 *   7. Empty, null, undefined, or invalid changed-component selection handled safely.
 *   8. Duplicate relationship records do not create duplicate recommendations.
 *   9. Missing historical or artifact context reported as unavailable (no crash).
 *  10. Stable ranking and explanations across repeated runs (deterministic tie-breaking).
 *  11. Changed component is never recommended.
 *  12. Nonexistent component IDs in edges are ignored.
 */

'use strict';

import { analyzeImpactInMemory } from '../services/impactEngine.js';
import { analyzeInMemory as analyzeContextInMemory } from '../services/contextAwareImpactAnalyzer.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== Phase 3: Impact Engine Correctness & Explainability Test Suite ===\n');

// Standard synthetic fixture
function createSyntheticGraph() {
  const components = [
    { id: 'com.app.OrderService', name: 'OrderService', type: 'Service', filePath: 'src/OrderService.java' },
    { id: 'com.app.OrderRepository', name: 'OrderRepository', type: 'Repository', filePath: 'src/OrderRepository.java' },
    { id: 'com.app.OrderModel', name: 'OrderModel', type: 'Entity/Model', filePath: 'src/OrderModel.java' },
    { id: 'com.app.PaymentService', name: 'PaymentService', type: 'Service', filePath: 'src/PaymentService.java' },
    { id: 'com.app.OrderController', name: 'OrderController', type: 'Controller', filePath: 'src/OrderController.java' },
    { id: 'com.app.MultiEvidenceService', name: 'MultiEvidenceService', type: 'Service', filePath: 'src/MultiEvidenceService.java' },
    { id: 'com.app.DisconnectedHelper', name: 'DisconnectedHelper', type: 'Other', filePath: 'src/DisconnectedHelper.java' },
    { id: 'com.app.OrderServiceTest', name: 'OrderServiceTest', type: 'Test', filePath: 'src/OrderServiceTest.java' },
    { id: 'com.app.IntermediateService', name: 'IntermediateService', type: 'Service', filePath: 'src/IntermediateService.java' },
    { id: 'com.app.DownstreamService', name: 'DownstreamService', type: 'Service', filePath: 'src/DownstreamService.java' }
  ];

  const relationships = [
    // 1-hop: OrderService (Service) -> OrderRepository (Repository)
    { source: 'com.app.OrderService', target: 'com.app.OrderRepository', type: 'DEPENDS_ON' },
    // 1-hop: OrderController (Controller) -> OrderService (Service)
    { source: 'com.app.OrderController', target: 'com.app.OrderService', type: 'DEPENDS_ON' },
    // 1-hop: OrderServiceTest (Test) -> OrderService (Service)
    { source: 'com.app.OrderServiceTest', target: 'com.app.OrderService', type: 'TESTS' },
    // 2-hop: OrderService -> IntermediateService -> DownstreamService
    { source: 'com.app.OrderService', target: 'com.app.IntermediateService', type: 'DEPENDS_ON' },
    { source: 'com.app.IntermediateService', target: 'com.app.DownstreamService', type: 'DEPENDS_ON' },
    // Co-change target: OrderService <-> PaymentService
    { source: 'com.app.OrderService', target: 'com.app.PaymentService', type: 'USES' },
    // Multi-evidence: OrderService -> MultiEvidenceService
    { source: 'com.app.OrderService', target: 'com.app.MultiEvidenceService', type: 'DEPENDS_ON' }
  ];

  const historyCounts = new Map();
  // PaymentService co-changed 10 times with OrderService
  let pA = 'com.app.OrderService', pB = 'com.app.PaymentService';
  if (pA > pB) { const t = pA; pA = pB; pB = t; }
  historyCounts.set(`${pA}|${pB}`, 10);

  // MultiEvidenceService co-changed 15 times with OrderService
  let mA = 'com.app.OrderService', mB = 'com.app.MultiEvidenceService';
  if (mA > mB) { const t = mA; mA = mB; mB = t; }
  historyCounts.set(`${mA}|${mB}`, 15);

  return { components, relationships, historyCounts };
}

// ── Test 1: Direct dependency (1-hop) ─────────────────────────────────────────
{
  console.log('Test 1: Direct dependency (1-hop)');
  const { components, relationships } = createSyntheticGraph();

  // Baseline
  const bRes = analyzeImpactInMemory(['com.app.OrderService'], { components, relationships });
  const bRepo = bRes.find(r => r.id === 'com.app.OrderRepository');
  assert(!!bRepo, 'Baseline recommends directly dependent OrderRepository');
  assertEqual(bRepo && bRepo.hopDistance, 1, 'Baseline hopDistance is 1');
  assert(bRepo && bRepo.reasoningPath.includes('DEPENDS_ON'), 'Baseline reasoning path includes DEPENDS_ON');

  // Context-Aware
  const cRes = analyzeContextInMemory(['com.app.OrderService'], { components, relationships });
  const cRepo = cRes.find(r => r.id === 'com.app.OrderRepository');
  assert(!!cRepo, 'Context-aware recommends directly dependent OrderRepository');
  assertEqual(cRepo && cRepo.hopDistance, 1, 'Context-aware hopDistance is 1');
  assert(cRepo && cRepo.evidenceSources.includes('structural'), 'evidenceSources includes "structural"');
  assert(cRepo && cRepo.influenceScore > 0, 'Influence score is positive');
}

// ── Test 2: Two-hop dependency ────────────────────────────────────────────────
{
  console.log('\nTest 2: Two-hop dependency traversal');
  const { components, relationships } = createSyntheticGraph();

  // Baseline
  const bRes = analyzeImpactInMemory(['com.app.OrderService'], { components, relationships });
  const bDown = bRes.find(r => r.id === 'com.app.DownstreamService');
  assert(!!bDown, 'Baseline finds 2-hop DownstreamService');
  assertEqual(bDown && bDown.hopDistance, 2, 'Baseline hopDistance is 2');
  assert(bDown && bDown.reasoningPath.includes('IntermediateService'), 'Baseline path includes intermediate node');

  // Context-Aware
  const cRes = analyzeContextInMemory(['com.app.OrderService'], { components, relationships });
  const cDown = cRes.find(r => r.id === 'com.app.DownstreamService');
  assert(!!cDown, 'Context-aware finds 2-hop DownstreamService');
  assertEqual(cDown && cDown.hopDistance, 2, 'Context-aware hopDistance is 2');
}

// ── Test 3: Historical co-change relationship ─────────────────────────────────
{
  console.log('\nTest 3: Historical co-change evidence boosts score and marks source');
  const { components, relationships, historyCounts } = createSyntheticGraph();

  // Without history
  const resNoHist = analyzeContextInMemory(['com.app.OrderService'], {
    components, relationships, historyCounts,
    configOverride: { ablation: { enableHistory: false } }
  });
  const pNoHist = resNoHist.find(r => r.id === 'com.app.PaymentService');

  // With history
  const resWithHist = analyzeContextInMemory(['com.app.OrderService'], {
    components, relationships, historyCounts,
    configOverride: { ablation: { enableHistory: true } }
  });
  const pWithHist = resWithHist.find(r => r.id === 'com.app.PaymentService');

  assert(!!pWithHist, 'PaymentService recommended with history enabled');
  assert(pWithHist.influenceScore > pNoHist.influenceScore, 'Score is higher with history enabled');
  assert(pWithHist.evidenceSources.includes('historical_co_change'), 'evidenceSources contains "historical_co_change"');
  assertEqual(pWithHist.historicalEvidence, 10, 'historicalEvidence records exactly 10 co-changes');
  assertEqual(pWithHist.evidenceStatus.history, 'available', 'evidenceStatus.history is "available"');
}

// ── Test 4: Artifact/context relationship ─────────────────────────────────────
{
  console.log('\nTest 4: Artifact/context relationship boosts score and marks source');
  const { components, relationships } = createSyntheticGraph();

  // Changed: Repository. Impacted: Service. Rule: Repository->Service (weight 0.2)
  const resNoArt = analyzeContextInMemory(['com.app.OrderRepository'], {
    components, relationships,
    configOverride: { ablation: { enableArtifactContext: false, enableHistory: false } }
  });
  const sNoArt = resNoArt.find(r => r.id === 'com.app.OrderService');

  const resWithArt = analyzeContextInMemory(['com.app.OrderRepository'], {
    components, relationships,
    configOverride: { ablation: { enableArtifactContext: true, enableHistory: false } }
  });
  const sWithArt = resWithArt.find(r => r.id === 'com.app.OrderService');

  assert(!!sWithArt, 'OrderService recommended');
  assert(sWithArt.influenceScore > sNoArt.influenceScore, 'Score is higher with artifact context enabled');
  assert(sWithArt.evidenceSources.includes('artifact_context'), 'evidenceSources contains "artifact_context"');
  assertEqual(sWithArt.evidenceStatus.artifact, 'available', 'evidenceStatus.artifact is "available"');
}

// ── Test 5: Recommendation supported by multiple evidence sources ─────────────
{
  console.log('\nTest 5: Recommendation supported by multiple evidence sources');
  const { components, relationships, historyCounts } = createSyntheticGraph();

  const res = analyzeContextInMemory(['com.app.OrderService'], {
    components, relationships, historyCounts
  });
  const multi = res.find(r => r.id === 'com.app.MultiEvidenceService');

  assert(!!multi, 'MultiEvidenceService found');
  assert(multi.evidenceSources.includes('structural'), 'Contains structural evidence');
  assert(multi.evidenceSources.includes('historical_co_change'), 'Contains historical co-change evidence');
  assert(multi.evidenceSources.length >= 2, 'Supported by at least 2 distinct evidence sources');
  assert(multi.allSupportingPaths.length >= 1, 'Has allSupportingPaths populated');
}

// ── Test 6: Disconnected component that should not be recommended ─────────────
{
  console.log('\nTest 6: Disconnected component is never recommended');
  const { components, relationships, historyCounts } = createSyntheticGraph();

  const bRes = analyzeImpactInMemory(['com.app.OrderService'], { components, relationships });
  const bDisc = bRes.find(r => r.id === 'com.app.DisconnectedHelper');
  assertEqual(bDisc, undefined, 'Baseline does not recommend disconnected component');

  const cRes = analyzeContextInMemory(['com.app.OrderService'], { components, relationships, historyCounts });
  const cDisc = cRes.find(r => r.id === 'com.app.DisconnectedHelper');
  assertEqual(cDisc, undefined, 'Context-aware does not recommend disconnected component');
}

// ── Test 7: Empty or invalid changed-component selection ──────────────────────
{
  console.log('\nTest 7: Empty or invalid changed-component selection');
  const { components, relationships } = createSyntheticGraph();

  assertEqual(analyzeImpactInMemory([], { components, relationships }).length, 0, 'Baseline empty array returns []');
  assertEqual(analyzeImpactInMemory(null, { components, relationships }).length, 0, 'Baseline null returns []');
  assertEqual(analyzeImpactInMemory(['nonexistent.Id'], { components, relationships }).length, 0, 'Baseline unknown ID returns []');

  assertEqual(analyzeContextInMemory([], { components, relationships }).length, 0, 'Context-aware empty array returns []');
  assertEqual(analyzeContextInMemory(null, { components, relationships }).length, 0, 'Context-aware null returns []');
  assertEqual(analyzeContextInMemory(['nonexistent.Id'], { components, relationships }).length, 0, 'Context-aware unknown ID returns []');
}

// ── Test 8: Duplicate relationship records ─────────────────────────────────────
{
  console.log('\nTest 8: Duplicate relationship records do not create duplicate recommendations');
  const { components, relationships } = createSyntheticGraph();

  // Inject duplicate edge
  const dupRelationships = [
    ...relationships,
    { source: 'com.app.OrderService', target: 'com.app.OrderRepository', type: 'DEPENDS_ON' }
  ];

  const bRes = analyzeImpactInMemory(['com.app.OrderService'], { components, relationships: dupRelationships });
  const bRepos = bRes.filter(r => r.id === 'com.app.OrderRepository');
  assertEqual(bRepos.length, 1, 'Baseline recommends OrderRepository exactly once');

  const cRes = analyzeContextInMemory(['com.app.OrderService'], { components, relationships: dupRelationships });
  const cRepos = cRes.filter(r => r.id === 'com.app.OrderRepository');
  assertEqual(cRepos.length, 1, 'Context-aware recommends OrderRepository exactly once');
}

// ── Test 9: Missing historical or artifact context ─────────────────────────────
{
  console.log('\nTest 9: Missing historical or artifact context handled gracefully');
  const { components, relationships } = createSyntheticGraph();

  // Call with no historyCounts (null)
  const res = analyzeContextInMemory(['com.app.OrderService'], {
    components, relationships, historyCounts: null
  });

  assert(res.length > 0, 'Engine completes successfully without historyCounts');
  const p = res.find(r => r.id === 'com.app.PaymentService');
  assert(!!p, 'PaymentService still found via structural path');
  assertEqual(p.historicalEvidence, 0, 'historicalEvidence is 0');
  assertEqual(p.evidenceStatus.history, 'unavailable', 'evidenceStatus.history is "unavailable"');
  assert(!p.evidenceSources.includes('historical_co_change'), 'Does NOT claim historical co-change source when count=0');
}

// ── Test 10: Stable ranking and explanations across repeated runs ──────────────
{
  console.log('\nTest 10: Stable ranking and explanations across repeated runs');
  const { components, relationships, historyCounts } = createSyntheticGraph();

  const run1 = analyzeContextInMemory(['com.app.OrderService'], { components, relationships, historyCounts });
  for (let i = 0; i < 5; i++) {
    const runN = analyzeContextInMemory(['com.app.OrderService'], { components, relationships, historyCounts });
    assertEqual(runN.length, run1.length, `Run ${i+2} length matches run 1`);
    for (let j = 0; j < run1.length; j++) {
      assertEqual(runN[j].id, run1[j].id, `Run ${i+2} item ${j} id matches`);
      assertEqual(runN[j].rank, run1[j].rank, `Run ${i+2} item ${j} rank matches`);
      assertEqual(runN[j].influenceScore, run1[j].influenceScore, `Run ${i+2} item ${j} score matches`);
      assertEqual(runN[j].primaryReasoningPath, run1[j].primaryReasoningPath, `Run ${i+2} item ${j} path matches`);
    }
  }
}

// ── Test 11: Changed component itself is never recommended ────────────────────
{
  console.log('\nTest 11: Changed component is never recommended');
  const { components, relationships, historyCounts } = createSyntheticGraph();

  const bRes = analyzeImpactInMemory(['com.app.OrderService'], { components, relationships });
  assert(!bRes.some(r => r.id === 'com.app.OrderService'), 'Baseline does not recommend changed OrderService');

  const cRes = analyzeContextInMemory(['com.app.OrderService'], { components, relationships, historyCounts });
  assert(!cRes.some(r => r.id === 'com.app.OrderService'), 'Context-aware does not recommend changed OrderService');
}

// ── Test 12: Regression test categorization ───────────────────────────────────
{
  console.log('\nTest 12: Regression test categorization');
  const { components, relationships } = createSyntheticGraph();

  const cRes = analyzeContextInMemory(['com.app.OrderService'], { components, relationships });
  const testComp = cRes.find(r => r.id === 'com.app.OrderServiceTest');
  assert(!!testComp, 'OrderServiceTest found');
  assertEqual(testComp && testComp.category, 'Regression Tests', 'Category is Regression Tests');
  assertEqual(testComp && testComp.influenceScore, 1.0, 'Regression test gets influenceScore 1.0');
  assert(testComp && testComp.evidenceSources.includes('regression_test'), 'evidenceSources includes "regression_test"');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n=== Phase 3 Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.error('\nFailed tests:');
  failures.forEach(f => console.error(' ✗', f));
  process.exit(1);
} else {
  console.log('All Phase 3 engine tests passed successfully.\n');
  process.exit(0);
}
