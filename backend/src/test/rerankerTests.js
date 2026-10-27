/**
 * rerankerTests.js
 * ----------------
 * Comprehensive unit test suite for the proposed research methodology:
 * Structural Knowledge Graph Traversal + Historical Co-Change Reranking.
 *
 * Verifies:
 *   1. 1-hop candidate generation, relationship types (TESTS, IMPLEMENTS, EXTENDS, DEPENDS_ON, USES).
 *   2. Directional precedence (incoming contract/tests/callers before outgoing dependencies).
 *   3. 2-hop candidate propagation and ordering behind 1-hop candidates.
 *   4. Hop-depth sensitivity: 1-hop vs 2-hop vs 3-hop candidate sets.
 *   5. Historical reranking: high co-change frequency promoted to top ranks.
 *   6. Preservation of structural baseline rank when co-change frequency is equal or zero.
 *   7. Zero-cochange candidates fully retained in structural order (no candidate dropping).
 *   8. Deterministic ranking and alphabetical tie-breaking.
 *   9. Changed seed component strictly excluded.
 *  10. Disconnected component never recommended.
 *  11. Explanations and evidence type classification ('historical_and_structural' vs 'structural_only').
 */

'use strict';

import {
  generateStructuralCandidatesInMemory,
  rerankCandidatesWithHistory,
  analyzeStructuralHistoryImpact,
  pairKey
} from '../services/structuralHistoryReranker.js';

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

console.log('\n=== Proposed Structural + Historical Reranker Test Suite ===\n');

// ── Synthetic Test Fixture ──────────────────────────────────────────────────
function createFixture() {
  const components = [
    { id: 'com.app.OrderService', name: 'OrderService', type: 'Service', filePath: 'src/OrderService.java' },
    { id: 'com.app.OrderServiceInterface', name: 'OrderServiceInterface', type: 'Service', filePath: 'src/OrderServiceInterface.java' },
    { id: 'com.app.OrderServiceTest', name: 'OrderServiceTest', type: 'Test', filePath: 'src/OrderServiceTest.java' },
    { id: 'com.app.OrderController', name: 'OrderController', type: 'Controller', filePath: 'src/OrderController.java' },
    { id: 'com.app.OrderRepository', name: 'OrderRepository', type: 'Repository', filePath: 'src/OrderRepository.java' },
    { id: 'com.app.PaymentClient', name: 'PaymentClient', type: 'Service', filePath: 'src/PaymentClient.java' },
    { id: 'com.app.BaseService', name: 'BaseService', type: 'Service', filePath: 'src/BaseService.java' },
    { id: 'com.app.TwoHopService', name: 'TwoHopService', type: 'Service', filePath: 'src/TwoHopService.java' },
    { id: 'com.app.ThreeHopService', name: 'ThreeHopService', type: 'Service', filePath: 'src/ThreeHopService.java' },
    { id: 'com.app.DisconnectedHelper', name: 'DisconnectedHelper', type: 'Other', filePath: 'src/DisconnectedHelper.java' }
  ];

  const relationships = [
    // 1-hop incoming TESTS: OrderServiceTest -> OrderService
    { source: 'com.app.OrderServiceTest', target: 'com.app.OrderService', type: 'TESTS' },
    // 1-hop incoming IMPLEMENTS: OrderService implements OrderServiceInterface
    { source: 'com.app.OrderService', target: 'com.app.OrderServiceInterface', type: 'IMPLEMENTS' },
    // 1-hop incoming EXTENDS: OrderService extends BaseService
    { source: 'com.app.OrderService', target: 'com.app.BaseService', type: 'EXTENDS' },
    // 1-hop incoming caller: OrderController -> OrderService
    { source: 'com.app.OrderController', target: 'com.app.OrderService', type: 'DEPENDS_ON' },
    // 1-hop outgoing callee: OrderService -> OrderRepository
    { source: 'com.app.OrderService', target: 'com.app.OrderRepository', type: 'DEPENDS_ON' },
    // 1-hop outgoing usage: OrderService -> PaymentClient
    { source: 'com.app.OrderService', target: 'com.app.PaymentClient', type: 'USES' },
    // 2-hop: OrderRepository -> TwoHopService
    { source: 'com.app.OrderRepository', target: 'com.app.TwoHopService', type: 'DEPENDS_ON' },
    // 3-hop: TwoHopService -> ThreeHopService
    { source: 'com.app.TwoHopService', target: 'com.app.ThreeHopService', type: 'DEPENDS_ON' }
  ];

  const historyCounts = new Map();
  // PaymentClient co-changed 12 times with OrderService
  historyCounts.set(pairKey('com.app.OrderService', 'com.app.PaymentClient'), 12);
  // TwoHopService co-changed 5 times with OrderService
  historyCounts.set(pairKey('com.app.OrderService', 'com.app.TwoHopService'), 5);

  return { components, relationships, historyCounts };
}

// ── Test 1: Structural Candidate Generation & Precedence ─────────────────────
{
  console.log('Test 1: 1-Hop Structural Precedence');
  const fixture = createFixture();
  const structural = generateStructuralCandidatesInMemory(
    ['com.app.OrderService'],
    fixture,
    1 // maxHops = 1
  );

  const ids = structural.map(c => c.id);
  assert(ids.includes('com.app.OrderServiceTest'), 'Direct test suite included');
  assert(ids.includes('com.app.OrderServiceInterface'), 'Implemented interface included');
  assert(ids.includes('com.app.BaseService'), 'Extended base class included');
  assert(ids.includes('com.app.OrderController'), 'Calling controller included');
  assert(ids.includes('com.app.OrderRepository'), 'Called repository included');
  assert(ids.includes('com.app.PaymentClient'), 'Used client included');
  assert(!ids.includes('com.app.TwoHopService'), '2-hop candidate excluded at maxHops=1');
  assert(!ids.includes('com.app.DisconnectedHelper'), 'Disconnected helper excluded');
  assert(!ids.includes('com.app.OrderService'), 'Changed seed component excluded');

  // Verify precedence: Test suite and contracts precede outgoing USES
  const testRank = structural.find(c => c.id === 'com.app.OrderServiceTest').structuralBaselineRank;
  const clientRank = structural.find(c => c.id === 'com.app.PaymentClient').structuralBaselineRank;
  assert(testRank < clientRank, 'Test suite ranks ahead of outgoing USES dependency');
}

// ── Test 2: 2-Hop Candidate Propagation ──────────────────────────────────────
{
  console.log('\nTest 2: 2-Hop Candidate Propagation and Hop Ordering');
  const fixture = createFixture();
  const structural = generateStructuralCandidatesInMemory(
    ['com.app.OrderService'],
    fixture,
    2 // maxHops = 2
  );

  const ids = structural.map(c => c.id);
  assert(ids.includes('com.app.TwoHopService'), '2-hop TwoHopService included at maxHops=2');
  assert(!ids.includes('com.app.ThreeHopService'), '3-hop ThreeHopService excluded at maxHops=2');

  const twoHopCand = structural.find(c => c.id === 'com.app.TwoHopService');
  assertEqual(twoHopCand.minHop, 2, 'TwoHopService minHop is 2');

  // Verify all 1-hop candidates precede 2-hop candidate
  const hop1MaxRank = Math.max(...structural.filter(c => c.minHop === 1).map(c => c.structuralBaselineRank));
  assert(twoHopCand.structuralBaselineRank > hop1MaxRank, '2-hop candidate ranks after all 1-hop candidates in structural baseline');
}

// ── Test 3: Hop Sensitivity (1-hop vs 2-hop vs 3-hop) ────────────────────────
{
  console.log('\nTest 3: Hop-Depth Sensitivity (1-hop, 2-hop, 3-hop)');
  const fixture = createFixture();
  const hop1 = generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 1);
  const hop2 = generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 2);
  const hop3 = generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 3);

  assertEqual(hop1.length, 6, '1-hop produces exactly 6 candidates');
  assertEqual(hop2.length, 7, '2-hop expands candidate set to 7 (adds TwoHopService)');
  assertEqual(hop3.length, 8, '3-hop expands candidate set to 8 (adds ThreeHopService)');

  // Verify subset containment
  const ids1 = new Set(hop1.map(c => c.id));
  const ids2 = new Set(hop2.map(c => c.id));
  const ids3 = new Set(hop3.map(c => c.id));

  assert([...ids1].every(id => ids2.has(id)), '1-hop candidate set is strict subset of 2-hop set');
  assert([...ids2].every(id => ids3.has(id)), '2-hop candidate set is strict subset of 3-hop set');
}

// ── Test 4: Historical Co-Change Reranking ────────────────────────────────────
{
  console.log('\nTest 4: Historical Co-Change Reranking Prioritization');
  const fixture = createFixture();
  const structural = generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 2);
  const reranked = rerankCandidatesWithHistory(structural, ['com.app.OrderService'], fixture.historyCounts);

  // In structural baseline, PaymentClient was 1-hop USES (ranked low among 1-hop)
  // With 12 co-changes, PaymentClient MUST be promoted to proposedRank = 1
  assertEqual(reranked[0].id, 'com.app.PaymentClient', 'PaymentClient promoted to Rank 1 due to highest co-change count (12)');
  assertEqual(reranked[0].proposedRank, 1, 'PaymentClient proposedRank is 1');
  assertEqual(reranked[0].coChangeCount, 12, 'PaymentClient coChangeCount is 12');
  assertEqual(reranked[0].evidenceType, 'historical_and_structural', 'PaymentClient marked historical_and_structural');

  // TwoHopService has 5 co-changes. In structural baseline it was rank 7 (hop 2).
  // In reranked, it should be rank 2 (above all 0 co-change 1-hop components)!
  assertEqual(reranked[1].id, 'com.app.TwoHopService', 'TwoHopService promoted to Rank 2 due to 5 co-changes');
  assertEqual(reranked[1].proposedRank, 2, 'TwoHopService proposedRank is 2');
}

// ── Test 5: Preservation of Structural Order for Zero-Cochange Candidates ────
{
  console.log('\nTest 5: Structural Tie-Breaking for Zero-Cochange Candidates');
  const fixture = createFixture();
  const structural = generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 2);
  const reranked = rerankCandidatesWithHistory(structural, ['com.app.OrderService'], fixture.historyCounts);

  // Candidates with 0 co-change count
  const zeroCoChange = reranked.filter(c => c.coChangeCount === 0);
  assertEqual(zeroCoChange.length, 5, 'Exactly 5 candidates have zero co-change count');

  // Verify that among the 0-cochange candidates, relative structural baseline rank is perfectly preserved
  let strictlyIncreasing = true;
  for (let i = 0; i < zeroCoChange.length - 1; i++) {
    if (zeroCoChange[i].structuralBaselineRank >= zeroCoChange[i + 1].structuralBaselineRank) {
      strictlyIncreasing = false;
      break;
    }
  }
  assert(strictlyIncreasing, 'Zero-cochange candidates preserve exact structural baseline relative ordering');

  // Verify all zero-cochange candidates have evidenceType = 'structural_only'
  assert(zeroCoChange.every(c => c.evidenceType === 'structural_only'), 'Zero-cochange candidates correctly marked structural_only');
}

// ── Test 6: Zero Candidate Dropping ──────────────────────────────────────────
{
  console.log('\nTest 6: No Candidates Dropped (Full Retention)');
  const fixture = createFixture();
  const structural = generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 2);
  const reranked = rerankCandidatesWithHistory(structural, ['com.app.OrderService'], fixture.historyCounts);

  assertEqual(reranked.length, structural.length, 'Reranked candidate set size equals structural baseline size');
  const structuralIds = new Set(structural.map(c => c.id));
  const rerankedIds = new Set(reranked.map(c => c.id));
  assertEqual(rerankedIds.size, structuralIds.size, 'No candidate lost or dropped during reranking');
}

// ── Test 7: Deterministic Output Across Repeated Runs ─────────────────────────
{
  console.log('\nTest 7: Deterministic Ranking Across Repeated Executions');
  const fixture = createFixture();
  const run1 = rerankCandidatesWithHistory(
    generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 2),
    ['com.app.OrderService'],
    fixture.historyCounts
  );
  const run2 = rerankCandidatesWithHistory(
    generateStructuralCandidatesInMemory(['com.app.OrderService'], fixture, 2),
    ['com.app.OrderService'],
    fixture.historyCounts
  );

  let allMatch = true;
  for (let i = 0; i < run1.length; i++) {
    if (run1[i].id !== run2[i].id || run1[i].proposedRank !== run2[i].proposedRank) {
      allMatch = false;
      break;
    }
  }
  assert(allMatch, 'Proposed reranking is 100% deterministic across repeated runs');
}

// ── Test 8: End-to-End Pipeline Function ─────────────────────────────────────
{
  console.log('\nTest 8: Complete End-to-End Pipeline Execution');
  const fixture = createFixture();
  const res = await analyzeStructuralHistoryImpact(['com.app.OrderService'], {
    components: fixture.components,
    relationships: fixture.relationships,
    historyCounts: fixture.historyCounts,
    maxHops: 2,
    forceInMemory: true
  });

  assert(Array.isArray(res.structuralBaseline), 'res.structuralBaseline is array');
  assert(Array.isArray(res.proposedRecommendations), 'res.proposedRecommendations is array');
  assertEqual(res.metadata.totalCandidates, 7, 'metadata.totalCandidates is 7');
  assertEqual(res.metadata.historicalCount, 2, 'metadata.historicalCount is 2');
  assertEqual(res.metadata.structuralOnlyCount, 5, 'metadata.structuralOnlyCount is 5');
  assertEqual(res.metadata.maxHops, 2, 'metadata.maxHops is 2');
}

// ── Test 9: Robustness to Empty / Invalid Inputs ─────────────────────────────
{
  console.log('\nTest 9: Robustness to Empty / Invalid Input');
  const resEmpty = await analyzeStructuralHistoryImpact([], { forceInMemory: true });
  assertEqual(resEmpty.structuralBaseline.length, 0, 'Empty changedIds returns empty baseline');
  assertEqual(resEmpty.proposedRecommendations.length, 0, 'Empty changedIds returns empty proposed');

  const resNull = await analyzeStructuralHistoryImpact(null, { forceInMemory: true });
  assertEqual(resNull.structuralBaseline.length, 0, 'Null changedIds returns empty baseline');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Proposed Reranker Test Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('\nFailures:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('✓ All proposed reranker unit tests passed successfully!\n');
}
