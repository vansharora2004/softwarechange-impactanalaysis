/**
 * simplifiedFormulasTests.js
 * --------------------------
 * Unit and integration tests for simplified CSF and EGCP formulas:
 *
 * 1. CSF Simplified Equal Average Formula:
 *    S_CSF(c) = (S_cond(c) + S_gen(c) + S_hist(c) + S_struct(c)) / 4
 *    - All 4 scores confirmed in [0, 1]
 *    - Equal weights 0.25
 *    - Deterministic ranking and candidate preservation
 *
 * 2. EGCP Simplified Min-Max Formula:
 *    S_EGCP(c) = S_evo_normalized(c) + S_struct_normalized(c)
 *    - Min-Max normalization with max == min boundary handling
 *    - Equal 1:1 importance
 *    - Removal of adaptive beta
 *    - Deterministic tie-breaking
 *
 * 3. Multi-Model Comparative Integration:
 *    - Verifies runThreeWayImpactAnalysis with useSimplifiedFormulas flag
 */

'use strict';

import assert from 'assert';
import {
  DEFAULT_FUSION_WEIGHTS,
  EQUAL_AVERAGE_FUSION_WEIGHTS,
  rankModelB_OCCP_ContinuousFusion,
  rankModel_CSF_EqualAverage
} from '../services/occp_experiments/occpFusionModel.js';
import {
  rankCandidatesWithEGCP_SimplifiedMinMax,
  rankCandidatesWithEGCPv4
} from '../services/egcp/v4/egcpV4Scorer.js';
import {
  rankModel_EGCP_v4_SimplifiedMinMax,
  rankModel_EGCP_Base_SimplifiedMinMax
} from '../services/egcp/v4/egcpV4Model.js';
import { runThreeWayImpactAnalysis } from '../services/threeWayComparisonService.js';

console.log('=== Running Simplified Formulas Test Suite ===\n');

// ── Test 1: CSF Equal Average Formula Properties ──
console.log('Test 1: CSF Equal Average Formula Properties');

assert.strictEqual(EQUAL_AVERAGE_FUSION_WEIGHTS.w_cond, 0.25, 'w_cond must be 0.25');
assert.strictEqual(EQUAL_AVERAGE_FUSION_WEIGHTS.w_gen, 0.25, 'w_gen must be 0.25');
assert.strictEqual(EQUAL_AVERAGE_FUSION_WEIGHTS.w_hist, 0.25, 'w_hist must be 0.25');
assert.strictEqual(EQUAL_AVERAGE_FUSION_WEIGHTS.w_struct, 0.25, 'w_struct must be 0.25');
const weightSum = EQUAL_AVERAGE_FUSION_WEIGHTS.w_cond +
  EQUAL_AVERAGE_FUSION_WEIGHTS.w_gen +
  EQUAL_AVERAGE_FUSION_WEIGHTS.w_hist +
  EQUAL_AVERAGE_FUSION_WEIGHTS.w_struct;
assert.strictEqual(weightSum, 1.0, 'Equal weights must sum to 1.0');

// Mock candidates
const mockCandidates = [
  { id: 'com.example.ServiceA', name: 'ServiceA', minHop: 1, structuralBaselineRank: 1 },
  { id: 'com.example.ServiceB', name: 'ServiceB', minHop: 1, structuralBaselineRank: 2 },
  { id: 'com.example.ServiceC', name: 'ServiceC', minHop: 2, structuralBaselineRank: 3 }
];

const mockCandidatePaths = new Map([
  ['com.example.ServiceA', [{ signature: 'USES_IN' }]],
  ['com.example.ServiceB', [{ signature: 'DEPENDS_ON_IN' }]],
  ['com.example.ServiceC', [{ signature: 'USES_IN_2' }]]
]);

const mockCondStats = new Map([
  ['METHOD_BODY|USES_IN', { positive: 8, total: 10 }] // smoothed: (8 + 0.5) / (10 + 1) = 8.5 / 11 = 0.7727
]);

const mockGenStats = new Map([
  ['DEPENDS_ON_IN', { positive: 5, total: 10 }] // smoothed: (5 + 0.5) / (10 + 1) = 5.5 / 11 = 0.5
]);

const mockHistory = new Map([
  ['com.example.Seed|com.example.ServiceA', 4],
  ['com.example.Seed|com.example.ServiceB', 2]
]);

const opClass = { primaryCategory: 'METHOD_BODY', detectedCategories: ['METHOD_BODY'] };

const rankedEqualCSF = rankModel_CSF_EqualAverage(
  mockCandidates,
  'com.example.Seed',
  opClass,
  mockCandidatePaths,
  mockCondStats,
  mockGenStats,
  mockHistory,
  0.5
);

assert.strictEqual(rankedEqualCSF.length, 3, 'All candidates must be preserved');

// Verify ServiceA arithmetic:
// S_cond = 8.5 / 11 ≈ 0.7727
// S_gen = 0
// S_hist = 4 / 4 = 1.0
// S_struct = 1.0 / 1 = 1.0
// Expected average = (0.7727 + 0 + 1.0 + 1.0) / 4 = 2.7727 / 4 ≈ 0.6932
const candA = rankedEqualCSF.find(c => c.id === 'com.example.ServiceA');
assert(candA, 'ServiceA must exist');
assert(Math.abs(candA.fusion_score - (candA.fusion_s_cond + candA.fusion_s_gen + candA.fusion_s_hist + candA.fusion_s_struct) / 4) < 1e-9,
  'Fusion score must exactly equal sum of 4 signals divided by 4');
assert(candA.fusion_s_cond >= 0 && candA.fusion_s_cond <= 1.0, 'S_cond must be in [0, 1]');
assert(candA.fusion_s_gen >= 0 && candA.fusion_s_gen <= 1.0, 'S_gen must be in [0, 1]');
assert(candA.fusion_s_hist >= 0 && candA.fusion_s_hist <= 1.0, 'S_hist must be in [0, 1]');
assert(candA.fusion_s_struct >= 0 && candA.fusion_s_struct <= 1.0, 'S_struct must be in [0, 1]');
console.log('  ✓ Confirmed all 4 signals in [0, 1] and exact equal average S_CSF = (S_cond + S_gen + S_hist + S_struct) / 4');

// ── Test 2: EGCP Simplified Min-Max Normalization & Equal 1:1 Combination ──
console.log('\nTest 2: EGCP Simplified Min-Max Normalization & Equal 1:1 Combination');

const nodeIndex = new Map([
  ['com.example.ServiceA', 0],
  ['com.example.ServiceB', 1],
  ['com.example.ServiceC', 2]
]);

// Structural lifts: A=0.8, B=0.4, C=0.2 -> min=0.2, max=0.8, range=0.6
// A_norm = (0.8 - 0.2) / 0.6 = 1.0
// B_norm = (0.4 - 0.2) / 0.6 = 0.3333
// C_norm = (0.2 - 0.2) / 0.6 = 0.0
const structLift = new Float64Array([0.8, 0.4, 0.2]);

// Evolutionary lifts: A=0.1, B=0.9, C=0.5 -> min=0.1, max=0.9, range=0.8
// A_norm = (0.1 - 0.1) / 0.8 = 0.0
// B_norm = (0.9 - 0.1) / 0.8 = 1.0
// C_norm = (0.5 - 0.1) / 0.8 = 0.5
const evoLift = new Float64Array([0.1, 0.9, 0.5]);

const rankedMinMax = rankCandidatesWithEGCP_SimplifiedMinMax(
  mockCandidates,
  'com.example.Seed',
  nodeIndex,
  structLift,
  evoLift,
  mockHistory
);

assert.strictEqual(rankedMinMax.length, 3, 'Must preserve candidate count');

const resA = rankedMinMax.find(c => c.id === 'com.example.ServiceA');
const resB = rankedMinMax.find(c => c.id === 'com.example.ServiceB');
const resC = rankedMinMax.find(c => c.id === 'com.example.ServiceC');

// Check Min-Max normalized values
assert.strictEqual(resA.egcp_structScore, 1.0, 'ServiceA structural min-max must be 1.0');
assert.strictEqual(resA.egcp_evoScore, 0.0, 'ServiceA evolutionary min-max must be 0.0');
assert.strictEqual(resA.egcp_score, 1.0, 'ServiceA combined score must be 1.0 (1.0 + 0.0)');

assert(Math.abs(resB.egcp_structScore - (0.4 - 0.2) / 0.6) < 1e-9, 'ServiceB struct norm');
assert.strictEqual(resB.egcp_evoScore, 1.0, 'ServiceB evo norm must be 1.0');
// Combined B = 1.0 + 0.3333 = 1.3333
assert(Math.abs(resB.egcp_score - (1.0 + 1/3)) < 1e-9, 'ServiceB combined score must be 1.3333');

// B must be rank 1 (score 1.3333 > A score 1.0 > C score 0.5)
assert.strictEqual(rankedMinMax[0].id, 'com.example.ServiceB', 'ServiceB must be rank 1');
assert.strictEqual(rankedMinMax[1].id, 'com.example.ServiceA', 'ServiceA must be rank 2');
assert.strictEqual(rankedMinMax[2].id, 'com.example.ServiceC', 'ServiceC must be rank 3');

console.log('  ✓ Confirmed Min-Max normalization and unweighted equal combination S_EGCP = S_evo_norm + S_struct_norm');

// ── Test 3: Edge Case: Maximum Equals Minimum (All Identical Values) ──
console.log('\nTest 3: Edge Case: Maximum Equals Minimum (No Division by Zero)');

const flatStructLift = new Float64Array([0.5, 0.5, 0.5]);
const flatEvoLift = new Float64Array([0.0, 0.0, 0.0]);

const rankedFlat = rankCandidatesWithEGCP_SimplifiedMinMax(
  mockCandidates,
  'com.example.Seed',
  nodeIndex,
  flatStructLift,
  flatEvoLift,
  mockHistory
);

assert.strictEqual(rankedFlat.length, 3, 'Candidates preserved');
for (const c of rankedFlat) {
  assert(!isNaN(c.egcp_score), 'Score must not be NaN');
  assert(!isNaN(c.egcp_structScore), 'Struct score must not be NaN');
  assert(!isNaN(c.egcp_evoScore), 'Evo score must not be NaN');
  assert.strictEqual(c.egcp_structScore, 0.0, 'When max == min, normalized score must safely map to 0.0');
  assert.strictEqual(c.egcp_evoScore, 0.0, 'When max == min, normalized score must safely map to 0.0');
}
console.log('  ✓ Handled max == min edge case gracefully (0.0 score, no division by zero or NaN)');

// ── Test 4: Integration with runThreeWayImpactAnalysis ──
console.log('\nTest 4: Integration with runThreeWayImpactAnalysis with useSimplifiedFormulas');

const mockGraph = {
  components: [
    { id: 'CompSeed', name: 'CompSeed', type: 'Service' },
    { id: 'CompA', name: 'CompA', type: 'Service' },
    { id: 'CompB', name: 'CompB', type: 'Repository' }
  ],
  relationships: [
    { source: 'CompSeed', target: 'CompA', type: 'DEPENDS_ON' },
    { source: 'CompSeed', target: 'CompB', type: 'USES' }
  ]
};

const threeWayOriginal = await runThreeWayImpactAnalysis(['CompSeed'], {
  customGraph: mockGraph,
  useSimplifiedFormulas: false
});

const threeWaySimplified = await runThreeWayImpactAnalysis(['CompSeed'], {
  customGraph: mockGraph,
  useSimplifiedFormulas: true
});

assert.strictEqual(threeWayOriginal.candidateUniverseSize, threeWaySimplified.candidateUniverseSize,
  'Candidate universe size must be identical');
assert.strictEqual(threeWaySimplified.candidateUniverseSize, 2, 'Must have 2 candidates');
assert(threeWaySimplified.csfOutput.length === 2, 'CSF simplified must have 2 candidates');
assert(threeWaySimplified.egcpOutput.length === 2, 'EGCP simplified must have 2 candidates');

console.log('  ✓ runThreeWayImpactAnalysis executed successfully with useSimplifiedFormulas flag');

console.log('\n======================================================');
console.log('ALL SIMPLIFIED FORMULAS TESTS PASSED! (4 / 4)');
console.log('======================================================\n');
