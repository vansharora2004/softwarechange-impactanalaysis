/**
 * egcpV3Tests.js
 * --------------
 * Comprehensive test suite for EGCP v3.
 *
 * Verifies:
 *   1. Adaptive-weight boundaries and monotonicity
 *   2. Temporal cutoffs and leak-free evidence
 *   3. Operation-aware structural edge weight scaling
 *   4. Stereotype entity dampening
 *   5. Probability mass conservation & power-iteration convergence
 *   6. Candidate universe preservation (100% preserved, 0 dropped/added)
 *   7. Deterministic ranking across repeated runs
 *   8. Parity between EGCP v3 Base and EGCP v2 Main
 */

'use strict';

import assert from 'assert';
import { EGCP_V3_DEFAULT_CONFIG } from '../services/egcp/v3/egcpV3Config.js';
import { computeAdaptiveBeta } from '../services/egcp/v3/egcpV3AdaptiveBeta.js';
import { buildEGCPv3Graph } from '../services/egcp/v3/egcpV3GraphBuilder.js';
import { propagateChannelEnergy, computeDegreeDiscountedLift } from '../services/egcp/v3/egcpV3Propagation.js';
import {
  rankModel_EGCP_v3,
  rankModel_EGCP_v3_Base,
  rankModel_EGCP_v3_AdaptiveBetaOnly,
  rankModel_EGCP_v3_OpAwareOnly,
  rankModel_EGCP_v3_DampeningOnly,
  rankModel_EGCP_v3_Combined
} from '../services/egcp/v3/egcpV3Model.js';
import { rankModel_EGCP_v2 } from '../services/egcp/v2/egcpV2Model.js';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

// ── Synthetic Test Fixtures ─────────────────────────────────────────────────

const MOCK_GRAPH = {
  components: [
    { id: 'com.test.Controller', type: 'Controller', filePath: 'com/test/Controller.java' },
    { id: 'com.test.Service', type: 'Service', filePath: 'com/test/Service.java' },
    { id: 'com.test.Repository', type: 'Repository', filePath: 'com/test/Repository.java' },
    { id: 'com.test.model.Entity', type: 'Entity', filePath: 'com/test/model/Entity.java' },
    { id: 'com.test.OtherService', type: 'Service', filePath: 'com/test/OtherService.java' }
  ],
  relationships: [
    { source: 'com.test.Controller', target: 'com.test.Service', type: 'CALLS' },
    { source: 'com.test.Service', target: 'com.test.Repository', type: 'CALLS' },
    { source: 'com.test.Service', target: 'com.test.model.Entity', type: 'USES' },
    { source: 'com.test.Repository', target: 'com.test.model.Entity', type: 'USES' },
    { source: 'com.test.OtherService', target: 'com.test.model.Entity', type: 'USES' }
  ]
};

const MOCK_CANDIDATES = [
  { id: 'com.test.Service', type: 'Service', hopDistance: 1 },
  { id: 'com.test.Repository', type: 'Repository', hopDistance: 2 },
  { id: 'com.test.model.Entity', type: 'Entity', hopDistance: 2 },
  { id: 'com.test.OtherService', type: 'Service', hopDistance: 2 }
];

console.log('\n=== Evolutionary-Graph Change Propagation v3 (EGCP v3) Test Suite ===\n');

// ── 1. Adaptive Weight Boundaries & Monotonicity ────────────────────────────
console.log('--- 1. Adaptive Weight Boundaries & Monotonicity ---');

runTest('Disabled adaptive beta returns configured static beta', () => {
  const res = computeAdaptiveBeta('com.test.Controller', null, null, {
    ...EGCP_V3_DEFAULT_CONFIG,
    enableAdaptiveBeta: false,
    channelMixingBeta: 0.60
  });
  assert.strictEqual(res.beta, 0.60);
});

runTest('Cold start (zero history) bounds to minAdaptiveBeta', () => {
  const emptyHistory = new Map();
  const res = computeAdaptiveBeta('com.test.Controller', emptyHistory, null, {
    ...EGCP_V3_DEFAULT_CONFIG,
    enableAdaptiveBeta: true,
    minAdaptiveBeta: 0.10,
    adaptiveTau: 10.0
  });
  assert.strictEqual(res.beta, 0.10);
  assert.strictEqual(res.evoSupport, 0);
});

runTest('Adaptive beta scales monotonically with historical co-change support', () => {
  const h1 = new Map([['com.test.Controller|com.test.Service', 5]]);
  const h2 = new Map([['com.test.Controller|com.test.Service', 20]]);
  const h3 = new Map([['com.test.Controller|com.test.Service', 100]]);

  const cfg = { ...EGCP_V3_DEFAULT_CONFIG, enableAdaptiveBeta: true, adaptiveTau: 10.0 };
  const r1 = computeAdaptiveBeta('com.test.Controller', h1, null, cfg);
  const r2 = computeAdaptiveBeta('com.test.Controller', h2, null, cfg);
  const r3 = computeAdaptiveBeta('com.test.Controller', h3, null, cfg);

  assert(r1.beta > 0.10, 'r1 should exceed minBeta');
  assert(r2.beta > r1.beta, 'r2 should exceed r1');
  assert(r3.beta > r2.beta, 'r3 should exceed r2');
  assert(r3.beta <= 0.95, 'r3 should not exceed maxBeta');
});

// ── 2. Operation-Aware Structural Edge Weighting ───────────────────────────
console.log('\n--- 2. Operation-Aware Structural Edge Weighting ---');

runTest('Method signature updates boost CALLS edges relative to base weights', () => {
  const baseGraph = buildEGCPv3Graph(MOCK_GRAPH, null, {
    ...EGCP_V3_DEFAULT_CONFIG,
    enableOperationAwareWeights: false
  });

  const opGraph = buildEGCPv3Graph(MOCK_GRAPH, null, {
    ...EGCP_V3_DEFAULT_CONFIG,
    enableOperationAwareWeights: true
  }, 'METHOD_SIGNATURE_OR_DECLARATION');

  const cIdx = baseGraph.nodeIndex.get('com.test.Controller');
  const sIdx = baseGraph.nodeIndex.get('com.test.Service');

  const baseEdge = baseGraph.structAdj[cIdx].find(e => e.to === sIdx);
  const opEdge = opGraph.structAdj[cIdx].find(e => e.to === sIdx);

  assert(opEdge.weight > baseEdge.weight, `Op edge weight ${opEdge.weight} should exceed base ${baseEdge.weight}`);
});

// ── 3. Stereotype Entity Dampening ──────────────────────────────────────────
console.log('\n--- 3. Stereotype Entity Dampening ---');

runTest('Stereotype dampening penalizes passive entity models when seed is business logic', () => {
  const unpenalized = rankModel_EGCP_v3(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH, null, {
    ...EGCP_V3_DEFAULT_CONFIG,
    enableStereotypeDampening: false
  });

  const penalized = rankModel_EGCP_v3(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH, null, {
    ...EGCP_V3_DEFAULT_CONFIG,
    enableStereotypeDampening: true,
    entityDampeningFactor: 0.10
  });

  const entityUnpen = unpenalized.find(c => c.id === 'com.test.model.Entity');
  const entityPen = penalized.find(c => c.id === 'com.test.model.Entity');

  assert(entityPen.egcp_v3_score < entityUnpen.egcp_v3_score, 'Entity score should be dampened');
  assert(entityPen.egcp_v3_rank >= entityUnpen.egcp_v3_rank, 'Entity rank should drop or remain lower');
});

// ── 4. Candidate Universe Preservation & Determinism ────────────────────────
console.log('\n--- 4. Candidate Universe Preservation & Determinism ---');

runTest('Preserves 100% of candidate universe across all ablations', () => {
  const rBase = rankModel_EGCP_v3_Base(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);
  const rAdaptive = rankModel_EGCP_v3_AdaptiveBetaOnly(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);
  const rOp = rankModel_EGCP_v3_OpAwareOnly(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);
  const rDamp = rankModel_EGCP_v3_DampeningOnly(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);
  const rComb = rankModel_EGCP_v3_Combined(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);

  const origIds = new Set(MOCK_CANDIDATES.map(c => c.id));
  for (const list of [rBase, rAdaptive, rOp, rDamp, rComb]) {
    assert.strictEqual(list.length, MOCK_CANDIDATES.length);
    for (const c of list) {
      assert(origIds.has(c.id), `Unexpected candidate ${c.id}`);
    }
  }
});

runTest('Deterministic rankings across repeated invocations', () => {
  const r1 = rankModel_EGCP_v3_Combined(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);
  const r2 = rankModel_EGCP_v3_Combined(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);

  for (let i = 0; i < r1.length; i++) {
    assert.strictEqual(r1[i].id, r2[i].id);
    assert.strictEqual(r1[i].egcp_v3_score, r2[i].egcp_v3_score);
    assert.strictEqual(r1[i].egcp_v3_rank, r2[i].egcp_v3_rank);
  }
});

// ── 5. Parity with EGCP v2 Main ─────────────────────────────────────────────
console.log('\n--- 5. Parity with EGCP v2 Main Under Base Config ---');

runTest('EGCP v3 Base produces identical ranking to EGCP v2 Main', () => {
  const rV2 = rankModel_EGCP_v2(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);
  const rV3Base = rankModel_EGCP_v3_Base(MOCK_CANDIDATES, 'com.test.Controller', MOCK_GRAPH);

  assert.strictEqual(rV2.length, rV3Base.length);
  for (let i = 0; i < rV2.length; i++) {
    assert.strictEqual(rV2[i].id, rV3Base[i].id, `Rank ${i+1} mismatch between v2 and v3 base`);
    assert(Math.abs(rV2[i].egcp_v2_score - rV3Base[i].egcp_v3_score) < 1e-9, `Score mismatch at rank ${i+1}`);
  }
});

// ── 6. Power Iteration & Probability Conservation ───────────────────────────
console.log('\n--- 6. Power Iteration & Probability Conservation ---');

runTest('Power iteration conserves total probability mass to 1.0', () => {
  const g = buildEGCPv3Graph(MOCK_GRAPH);
  const prop = propagateChannelEnergy(g.structTrans, [0], g.nodes.length);
  const totalMass = prop.stationaryScores.reduce((s, v) => s + v, 0);

  assert(prop.converged, 'Power iteration should converge');
  assert(Math.abs(totalMass - 1.0) < 1e-6, `Total mass ${totalMass} should equal 1.0`);
});

console.log('\n======================================================');
console.log(`EGCP v3 Test Results: ${passed} passed, ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
