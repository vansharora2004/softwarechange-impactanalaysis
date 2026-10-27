/**
 * traversalConsistencyTests.js
 * ----------------------------
 * Focused test suite verifying graph traversal consistency, direction handling,
 * and parity across baseline, in-memory, and proposed engines.
 *
 * Verifies:
 *   1. Incoming and outgoing paths handled correctly for USES, DEPENDS_ON, EXTENDS, IMPLEMENTS, TESTS.
 *   2. Alternating 2-hop paths (e.g. A <- B -> C or A -> B <- C) are dropped from baseline traversal.
 *   3. Direct test relationships (TESTS incoming) correctly identified.
 *   4. Seed changed components are strictly excluded (self-exclusion).
 *   5. Duplicate candidate entries are deduplicated.
 *   6. IMPLEMENTS relationship is emitted distinctly from EXTENDS.
 */

'use strict';

import { analyzeImpactInMemory } from '../services/impactEngine.js';
import { generateStructuralCandidatesInMemory, rerankCandidatesWithHistory, pairKey } from '../services/structuralHistoryReranker.js';

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

console.log('\n=== Graph Traversal Consistency & Correctness Test Suite ===\n');

// ── Test 1: Alternating 2-Hop Path Exclusion in Baseline Engine ─────────────
{
  console.log('Test 1: Alternating 2-Hop Paths Dropped in Baseline Traversal');
  // Changed: SeedComp
  // Edge 1: MidComp -> SeedComp (incoming to Seed)
  // Edge 2: MidComp -> AlternateComp (outgoing from Mid)
  // Path: SeedComp <- MidComp -> AlternateComp (Alternating: Incoming then Outgoing)
  const components = [
    { id: 'com.app.SeedComp', name: 'SeedComp', type: 'Service' },
    { id: 'com.app.MidComp', name: 'MidComp', type: 'Service' },
    { id: 'com.app.AlternateComp', name: 'AlternateComp', type: 'Service' },
    { id: 'com.app.TrueDownstream', name: 'TrueDownstream', type: 'Service' }
  ];

  const relationships = [
    { source: 'com.app.SeedComp', target: 'com.app.MidComp', type: 'DEPENDS_ON' },
    { source: 'com.app.MidComp', target: 'com.app.TrueDownstream', type: 'DEPENDS_ON' },
    // Alternating edge:
    { source: 'com.app.AlternateComp', target: 'com.app.SeedComp', type: 'DEPENDS_ON' },
    { source: 'com.app.AlternateComp', target: 'com.app.MidComp', type: 'DEPENDS_ON' }
  ];

  const baselineResults = analyzeImpactInMemory(['com.app.SeedComp'], { components, relationships });
  const baselineIds = baselineResults.map(r => r.id);

  assert(baselineIds.includes('com.app.MidComp'), 'Direct dependency MidComp included');
  assert(baselineIds.includes('com.app.TrueDownstream'), 'Unidirectional 2-hop TrueDownstream included');
  assert(baselineIds.includes('com.app.AlternateComp'), 'Direct caller AlternateComp included at hop 1');

  // Now create an alternating-only node that is ONLY reachable via MidComp in alternating direction:
  const componentsAlt = [
    { id: 'com.app.Seed', name: 'Seed', type: 'Service' },
    { id: 'com.app.Mid', name: 'Mid', type: 'Service' },
    { id: 'com.app.AltSibling', name: 'AltSibling', type: 'Service' }
  ];
  // Seed -> Mid (outgoing)
  // AltSibling -> Mid (incoming to Mid, so Seed -> Mid <- AltSibling is alternating)
  const relsAlt = [
    { source: 'com.app.Seed', target: 'com.app.Mid', type: 'DEPENDS_ON' },
    { source: 'com.app.AltSibling', target: 'com.app.Mid', type: 'DEPENDS_ON' }
  ];

  const resultsAlt = analyzeImpactInMemory(['com.app.Seed'], { components: componentsAlt, relationships: relsAlt });
  const idsAlt = resultsAlt.map(r => r.id);

  assert(idsAlt.includes('com.app.Mid'), 'Mid is included (1-hop outgoing)');
  assert(!idsAlt.includes('com.app.AltSibling'), 'AltSibling is excluded because Seed -> Mid <- AltSibling is an alternating path');
}

// ── Test 2: Unidirectional 2-Hop Traversal (In-In and Out-Out) ───────────────
{
  console.log('\nTest 2: Unidirectional 2-Hop Traversal (In-In and Out-Out)');
  // Out-Out: Seed -> Mid -> LeafOut
  // In-In: LeafIn -> Mid2 -> Seed
  const components = [
    { id: 'com.app.Seed', name: 'Seed', type: 'Service' },
    { id: 'com.app.MidOut', name: 'MidOut', type: 'Service' },
    { id: 'com.app.LeafOut', name: 'LeafOut', type: 'Service' },
    { id: 'com.app.MidIn', name: 'MidIn', type: 'Service' },
    { id: 'com.app.LeafIn', name: 'LeafIn', type: 'Service' }
  ];

  const relationships = [
    { source: 'com.app.Seed', target: 'com.app.MidOut', type: 'DEPENDS_ON' },
    { source: 'com.app.MidOut', target: 'com.app.LeafOut', type: 'DEPENDS_ON' },
    { source: 'com.app.LeafIn', target: 'com.app.MidIn', type: 'DEPENDS_ON' },
    { source: 'com.app.MidIn', target: 'com.app.Seed', type: 'DEPENDS_ON' }
  ];

  const res = analyzeImpactInMemory(['com.app.Seed'], { components, relationships });
  const ids = res.map(r => r.id);

  assert(ids.includes('com.app.LeafOut'), 'LeafOut included via Out-Out path');
  assert(ids.includes('com.app.LeafIn'), 'LeafIn included via In-In path');

  const leafOutRec = res.find(r => r.id === 'com.app.LeafOut');
  assertEqual(leafOutRec.hopDistance, 2, 'LeafOut has hopDistance 2');
  assert(leafOutRec.reasoningPath.includes('➔ [DEPENDS_ON] ➔ com.app.MidOut ➔ [DEPENDS_ON] ➔ com.app.LeafOut'), 'LeafOut reasoning path correctly chained');

  const leafInRec = res.find(r => r.id === 'com.app.LeafIn');
  assertEqual(leafInRec.hopDistance, 2, 'LeafIn has hopDistance 2');
  assert(leafInRec.reasoningPath.includes('com.app.LeafIn ➔ [DEPENDS_ON] ➔ com.app.MidIn ➔ [DEPENDS_ON] ➔ com.app.Seed'), 'LeafIn reasoning path correctly chained');
}

// ── Test 3: Test Propagation Across 2 Hops (LeafTest -> Mid -> Seed) ─────────
{
  console.log('\nTest 3: In-Test 2-Hop Traversal (Test -> Mid -> Seed)');
  const components = [
    { id: 'com.app.Seed', name: 'Seed', type: 'Service' },
    { id: 'com.app.CallerService', name: 'CallerService', type: 'Service' },
    { id: 'com.app.CallerServiceTest', name: 'CallerServiceTest', type: 'Test' }
  ];

  const relationships = [
    // CallerService calls Seed
    { source: 'com.app.CallerService', target: 'com.app.Seed', type: 'DEPENDS_ON' },
    // CallerServiceTest tests CallerService
    { source: 'com.app.CallerServiceTest', target: 'com.app.CallerService', type: 'TESTS' }
  ];

  const res = analyzeImpactInMemory(['com.app.Seed'], { components, relationships });
  const ids = res.map(r => r.id);

  assert(ids.includes('com.app.CallerServiceTest'), 'CallerServiceTest included at 2 hops');
  const testRec = res.find(r => r.id === 'com.app.CallerServiceTest');
  assertEqual(testRec.hopDistance, 2, 'CallerServiceTest hopDistance is 2');
  assert(testRec.reason.includes('tests com.app.CallerService, which directly depends on'), 'Descriptive explanation for 2-hop test');
}

// ── Test 4: Self-Exclusion & Deduplication ───────────────────────────────────
{
  console.log('\nTest 4: Self-Exclusion and Duplicate Path Deduplication');
  const components = [
    { id: 'com.app.A', name: 'A', type: 'Service' },
    { id: 'com.app.B', name: 'B', type: 'Service' }
  ];

  const relationships = [
    { source: 'com.app.A', target: 'com.app.B', type: 'DEPENDS_ON' },
    { source: 'com.app.A', target: 'com.app.B', type: 'USES' },
    { source: 'com.app.B', target: 'com.app.A', type: 'DEPENDS_ON' }
  ];

  const res = analyzeImpactInMemory(['com.app.A'], { components, relationships });
  assertEqual(res.length, 1, 'Only 1 recommendation produced despite multiple parallel edges');
  assertEqual(res[0].id, 'com.app.B', 'Candidate is B');
  assert(!res.some(r => r.id === 'com.app.A'), 'Changed component A is never recommended');

  const struct = generateStructuralCandidatesInMemory(['com.app.A'], { components, relationships }, 2);
  assertEqual(struct.length, 1, 'Proposed reranker produces exactly 1 candidate B');
  assert(!struct.some(c => c.id === 'com.app.A'), 'Proposed reranker excludes changed seed A');
}

// ── Test 5: IMPLEMENTS and EXTENDS Distinction ──────────────────────────────
{
  console.log('\nTest 5: IMPLEMENTS and EXTENDS Distinction in Proposed Reranker');
  const components = [
    { id: 'com.app.BaseEntity', name: 'BaseEntity', type: 'Entity/Model' },
    { id: 'com.app.SubEntity', name: 'SubEntity', type: 'Entity/Model' },
    { id: 'com.app.ItemService', name: 'ItemService', type: 'Service' },
    { id: 'com.app.ItemServiceImpl', name: 'ItemServiceImpl', type: 'Service' }
  ];

  const relationships = [
    { source: 'com.app.SubEntity', target: 'com.app.BaseEntity', type: 'EXTENDS' },
    { source: 'com.app.ItemServiceImpl', target: 'com.app.ItemService', type: 'IMPLEMENTS' }
  ];

  const fromInterface = generateStructuralCandidatesInMemory(['com.app.ItemService'], { components, relationships }, 1);
  const implCand = fromInterface.find(c => c.id === 'com.app.ItemServiceImpl');
  assert(!!implCand, 'ItemServiceImpl found from ItemService');
  assertEqual(implCand.primaryRel, 'IMPLEMENTS', 'Relationship type is IMPLEMENTS (not EXTENDS)');
  assert(implCand.reason.includes('interface contract'), 'Reason cites interface contract');

  const fromBase = generateStructuralCandidatesInMemory(['com.app.BaseEntity'], { components, relationships }, 1);
  const subCand = fromBase.find(c => c.id === 'com.app.SubEntity');
  assert(!!subCand, 'SubEntity found from BaseEntity');
  assertEqual(subCand.primaryRel, 'EXTENDS', 'Relationship type is EXTENDS');
  assert(subCand.reason.includes('Inherits from class'), 'Reason cites class inheritance');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Traversal Consistency Test Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('\nFailures:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('✓ All traversal consistency tests passed successfully!\n');
}
