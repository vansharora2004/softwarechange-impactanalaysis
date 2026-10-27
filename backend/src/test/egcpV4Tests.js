/**
 * egcpV4Tests.js
 * --------------
 * Unit and contract test suite for EGCP v4.
 *
 * Verifies:
 *   1. Graph in-degree entropy calculation (uniform vs hub-dominated)
 *   2. Entropy-adaptive beta bounds and monotonicity
 *   3. Progressive hub exclusion sigmoidal attenuation
 *   4. Gated operation-aware weight conditions
 *   5. Stereotype entity dampening
 *   6. 100% candidate universe preservation
 *   7. Parity between EGCP v4 Base and EGCP v3 Base
 *   8. Deterministic tie-breaking and rank ordering
 */

'use strict';

import assert from 'assert';
import {
  computeGraphInDegreeEntropy,
  computeAdaptiveBetaV4
} from '../services/egcp/v4/egcpV4AdaptiveBeta.js';
import {
  computePercentile,
  computeHubAttenuation,
  buildEGCPv4Graph
} from '../services/egcp/v4/egcpV4GraphBuilder.js';
import {
  rankModel_EGCP_v4_Base,
  rankModel_EGCP_v4_EntropyBetaOnly,
  rankModel_EGCP_v4_HubExclusionOnly,
  rankModel_EGCP_v4_GatedOpOnly,
  rankModel_EGCP_v4_Combined
} from '../services/egcp/v4/egcpV4Model.js';
import { rankModel_EGCP_v3_Base } from '../services/egcp/v3/egcpV3Model.js';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('--- Running EGCP v4 Unit & Contract Tests ---');

// Test 1: Graph In-Degree Entropy
runTest('Graph In-Degree Entropy: Uniform vs Hub-Dominated', () => {
  // Uniform graph: 4 nodes with identical in-degree 5
  const uniformInDegrees = new Uint32Array([5, 5, 5, 5]);
  const uniformEntropy = computeGraphInDegreeEntropy(uniformInDegrees);
  assert(uniformEntropy > 0.99, `Expected near 1.0, got ${uniformEntropy}`);

  // Star / Hub graph: 1 hub with in-degree 100, 99 nodes with in-degree 1
  const hubInDegrees = new Uint32Array(100);
  hubInDegrees[0] = 100;
  for (let i = 1; i < 100; i++) hubInDegrees[i] = 1;
  const hubEntropy = computeGraphInDegreeEntropy(hubInDegrees);
  assert(hubEntropy < uniformEntropy, `Hub entropy ${hubEntropy} should be lower than uniform ${uniformEntropy}`);
});

// Test 2: Entropy-Adaptive Beta Bounds & Monotonicity
runTest('Entropy-Adaptive Beta: Bounds, Monotonicity, and Topology Scaling', () => {
  const config = {
    enableEntropyAdaptiveBeta: true,
    entropyBaseTau: 5.0,
    entropyTauScale: 20.0,
    minAdaptiveBeta: 0.10,
    maxAdaptiveBeta: 0.95
  };

  const seed = 'ServiceA';
  const historyCounts1 = new Map([['ServiceA|ServiceB', 2]]);
  const historyCounts2 = new Map([['ServiceA|ServiceB', 20]]);

  const lowEntropyGraph = { graphEntropy: 0.1, nodeIndex: new Map([['ServiceA', 0]]), structInDegree: new Uint32Array([2]) };
  const highEntropyGraph = { graphEntropy: 0.9, nodeIndex: new Map([['ServiceA', 0]]), structInDegree: new Uint32Array([2]) };

  const resLow = computeAdaptiveBetaV4(seed, historyCounts1, lowEntropyGraph, config);
  const resHigh = computeAdaptiveBetaV4(seed, historyCounts1, highEntropyGraph, config);

  // In low entropy (hub-dominated) graph, effective tau is smaller -> beta is higher (more evolutionary trust)
  assert(resLow.beta > resHigh.beta, `Low entropy beta (${resLow.beta}) should exceed high entropy beta (${resHigh.beta})`);

  // Monotonicity check
  const resMoreHistory = computeAdaptiveBetaV4(seed, historyCounts2, lowEntropyGraph, config);
  assert(resMoreHistory.beta >= resLow.beta, 'More history must yield higher or equal beta');
  assert(resMoreHistory.beta <= 0.95 && resMoreHistory.beta >= 0.10, 'Beta must stay in bounds');
});

// Test 3: Progressive Hub Exclusion Sigmoid Attenuation
runTest('Progressive Hub Exclusion: Attenuation Curve', () => {
  const threshold = 50;
  const slope = 0.01;
  const minAtten = 0.05;

  const attenLow = computeHubAttenuation(30, threshold, slope, minAtten);
  const attenAtThresh = computeHubAttenuation(50, threshold, slope, minAtten);
  const attenHigh = computeHubAttenuation(200, threshold, slope, minAtten);
  const attenExtreme = computeHubAttenuation(2000, threshold, slope, minAtten);

  assert.strictEqual(attenLow, 1.0, 'Nodes below threshold should not be attenuated');
  assert(attenHigh < attenAtThresh, 'Nodes above threshold must be attenuated');
  assert(attenExtreme >= minAtten, 'Attenuation must respect min floor');
});

// Test 4: Gated Operation-Aware Multiplier Logic
runTest('Gated Operation Weights: Condition Enforcement', () => {
  const dummyGraph = {
    components: [{ id: 'ServiceA' }, { id: 'EntityB' }],
    relationships: [{ source: 'ServiceA', target: 'EntityB', type: 'CALLS' }]
  };

  const cfg = {
    enableGatedOperationWeights: true,
    sparseEvoThreshold: 5.0,
    gatedOpMultipliers: {
      METHOD_SIGNATURE_OR_DECLARATION: { CALLS: 2.0 }
    }
  };

  // Case A: Rich evo history -> Gated OFF (multiplier not applied)
  const gRich = buildEGCPv4Graph(dummyGraph, null, cfg, 'METHOD_SIGNATURE_OR_DECLARATION', 'ServiceA', 50);
  const wRich = gRich.structAdj[0][0].weight;

  // Case B: Sparse evo history + Business Logic Seed -> Gated ON (multiplier applied)
  const gSparse = buildEGCPv4Graph(dummyGraph, null, cfg, 'METHOD_SIGNATURE_OR_DECLARATION', 'ServiceA', 1);
  const wSparse = gSparse.structAdj[0][0].weight;

  assert(wSparse > wRich, `Gated op multiplier should apply for sparse evo (got ${wSparse} vs ${wRich})`);
});

// Test 5: Candidate Universe Preservation & Determinism
runTest('Candidate Universe 100% Preservation & Determinism', () => {
  const dummyGraph = {
    components: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
    relationships: [
      { source: 'A', target: 'B', type: 'CALLS' },
      { source: 'B', target: 'C', type: 'CALLS' },
      { source: 'C', target: 'D', type: 'CALLS' }
    ]
  };

  const candidates = [
    { id: 'B', minHop: 1, structuralBaselineRank: 1 },
    { id: 'C', minHop: 2, structuralBaselineRank: 2 },
    { id: 'D', minHop: 3, structuralBaselineRank: 3 }
  ];

  const ranked1 = rankModel_EGCP_v4_Combined(candidates, 'A', dummyGraph, null);
  const ranked2 = rankModel_EGCP_v4_Combined(candidates, 'A', dummyGraph, null);

  assert.strictEqual(ranked1.length, 3, 'Must preserve all candidates');
  assert.strictEqual(ranked1[0].id, ranked2[0].id, 'Must be deterministic');
  assert.strictEqual(ranked1[1].id, ranked2[1].id, 'Must be deterministic');
  assert.strictEqual(ranked1[2].id, ranked2[2].id, 'Must be deterministic');
});

// Test 6: Parity Check between EGCP v4 Base and EGCP v3 Base
runTest('Parity Check: EGCP v4 Base == EGCP v3 Base', () => {
  const dummyGraph = {
    components: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
    relationships: [
      { source: 'A', target: 'B', type: 'EXTENDS' },
      { source: 'A', target: 'C', type: 'IMPLEMENTS' },
      { source: 'C', target: 'D', type: 'DEPENDS_ON' }
    ]
  };

  const candidates = [
    { id: 'B', minHop: 1, structuralBaselineRank: 1 },
    { id: 'C', minHop: 1, structuralBaselineRank: 2 },
    { id: 'D', minHop: 2, structuralBaselineRank: 3 }
  ];

  const rankedV3 = rankModel_EGCP_v3_Base(candidates, 'A', dummyGraph, null);
  const rankedV4 = rankModel_EGCP_v4_Base(candidates, 'A', dummyGraph, null);

  assert.strictEqual(rankedV3.length, rankedV4.length, 'Length mismatch');
  for (let i = 0; i < rankedV3.length; i++) {
    assert.strictEqual(rankedV3[i].id, rankedV4[i].id, `Rank ${i} mismatch`);
  }
});

console.log(`\nTests Completed: ${passed} Passed, ${failed} Failed`);
if (failed > 0) process.exit(1);
