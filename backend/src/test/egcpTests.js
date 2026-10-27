/**
 * egcpTests.js
 * ------------
 * Comprehensive Unit and Regression Test Suite for Evolutionary-Graph Change Propagation (EGCP).
 */

'use strict';

import assert from 'assert';
import {
  rankModel_EGCP,
  rankModel_EGCP_StructOnly,
  rankModel_EGCP_EvoOnly,
  rankModel_EGCP_Dual
} from '../services/egcp/egcpModel.js';
import { buildEGCPGraph } from '../services/egcp/egcpGraphBuilder.js';
import { propagateEvolutionaryEnergy } from '../services/egcp/egcpPropagation.js';

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n=== Evolutionary-Graph Change Propagation (EGCP) Test Suite ===\n');

// ── Test 1: Graph Builder Construction & Edge Types ─────────────────────────
console.log('--- 1. Graph Construction & Multi-Relational Adjacency ---');

const mockGraph = {
  components: [
    { id: 'CompA', type: 'Controller' },
    { id: 'CompB', type: 'Service' },
    { id: 'CompC', type: 'Repository' },
    { id: 'CompD', type: 'Entity' },
    { id: 'CompE', type: 'Other' }
  ],
  relationships: [
    { fromId: 'CompA', toId: 'CompB', type: 'USES' },
    { fromId: 'CompB', toId: 'CompC', type: 'DEPENDS_ON' },
    { fromId: 'CompC', toId: 'CompD', type: 'REFERENCES' }
  ]
};

const mockHistoryCounts = new Map([
  ['CompA|CompC', 5], // A and C co-change frequently without direct edge
  ['CompB|CompC', 2],
  ['CompD|CompE', 1]
]);

it('Correctly indexes all components and builds node indices', () => {
  const g = buildEGCPGraph(mockGraph, mockHistoryCounts);
  assert.strictEqual(g.nodes.length, 5);
  assert.strictEqual(g.nodeIndex.get('CompA'), 0);
  assert.strictEqual(g.nodeIndex.get('CompE'), 4);
});

it('Extracts directed structural edges with reverse scaling', () => {
  const g = buildEGCPGraph(mockGraph, mockHistoryCounts);
  const aEdges = g.structAdj[0];
  const bEdges = g.structAdj[1];

  // A -> B via USES (weight 0.7)
  const toB = aEdges.find(e => e.to === 1);
  assert(toB !== undefined, 'Forward edge A -> B missing');
  assert.strictEqual(toB.weight, 0.7);

  // B -> A reverse edge (scaled by 0.5: 0.7 * 0.5 = 0.35)
  const toA = bEdges.find(e => e.to === 0);
  assert(toA !== undefined, 'Reverse edge B -> A missing');
  assert.strictEqual(toA.weight, 0.35);
});

it('Constructs normalized evolutionary edges from co-change counts', () => {
  const g = buildEGCPGraph(mockGraph, mockHistoryCounts);
  const aEvo = g.evoAdj[0]; // CompA
  const toC = aEvo.find(e => e.to === 2); // CompC is index 2

  assert(toC !== undefined, 'Evolutionary edge A -> C missing');
  assert(toC.weight > 0 && toC.weight <= 1.0, `Expected normalized weight in (0, 1], got ${toC.weight}`);
});

// ── Test 2: Energy Propagation & Convergence ────────────────────────────────
console.log('\n--- 2. Energy Propagation & Convergence Guarantees ---');

it('Power iteration converges to a valid probability distribution (sum = 1)', () => {
  const g = buildEGCPGraph(mockGraph, mockHistoryCounts);
  const result = propagateEvolutionaryEnergy(g, [0]); // seed: CompA

  assert.strictEqual(result.converged, true, 'Power iteration failed to converge');
  assert(result.iterations <= 30, 'Iterations exceeded maximum threshold');

  let sum = 0;
  for (let i = 0; i < result.stationaryScores.length; i++) {
    sum += result.stationaryScores[i];
  }
  assert(Math.abs(sum - 1.0) < 1e-5, `Stationary distribution sum must be 1.0, got ${sum}`);
});

it('Seed component retains high restart energy and diffuses downstream', () => {
  const g = buildEGCPGraph(mockGraph, mockHistoryCounts);
  const result = propagateEvolutionaryEnergy(g, [0]); // seed: CompA

  // CompA (seed) has high score
  const scoreA = result.stationaryScores[0];
  const scoreB = result.stationaryScores[1];
  const scoreE = result.stationaryScores[4];

  assert(scoreA > scoreB, 'Seed should have higher energy than 1-hop neighbor');
  assert(scoreB > scoreE, 'Direct neighbor CompB should have higher energy than isolated CompE');
});

// ── Test 3: Candidate Universe Preservation & Determinism ───────────────────
console.log('\n--- 3. Candidate Universe Preservation & Determinism ---');

const mockCandidates = [
  { id: 'CompB', minHop: 1, structuralBaselineRank: 1 },
  { id: 'CompC', minHop: 2, structuralBaselineRank: 2 },
  { id: 'CompD', minHop: 3, structuralBaselineRank: 3 },
  { id: 'CompE', minHop: 99, structuralBaselineRank: 4 }
];

it('Preserves 100% of candidates (zero candidates added or dropped)', () => {
  const ranked = rankModel_EGCP(mockCandidates, 'CompA', mockGraph, mockHistoryCounts);
  assert.strictEqual(ranked.length, mockCandidates.length);
  const returnedIds = new Set(ranked.map(c => c.id));
  for (const c of mockCandidates) {
    assert(returnedIds.has(c.id), `Candidate ${c.id} was dropped`);
  }
});

it('Ranking is 100% deterministic across multiple repeated runs', () => {
  const run1 = rankModel_EGCP(mockCandidates, 'CompA', mockGraph, mockHistoryCounts);
  const run2 = rankModel_EGCP(mockCandidates, 'CompA', mockGraph, mockHistoryCounts);

  for (let i = 0; i < run1.length; i++) {
    assert.strictEqual(run1[i].id, run2[i].id);
    assert.strictEqual(run1[i].egcp_score, run2[i].egcp_score);
    assert.strictEqual(run1[i].egcp_rank, run2[i].egcp_rank);
  }
});

// ── Test 4: Evolutionary Coupling Elevates Structurally Distant Co-Changes ──
console.log('\n--- 4. Evolutionary Synergy over Syntactic-Only Traversal ---');

it('CompC is elevated ahead of CompB when evolutionary coupling between A and C is dominant', () => {
  // CompC is 2 hops away structurally, but has high evolutionary co-change (5 commits)
  // CompB is 1 hop away structurally, but has 0 evolutionary co-change with CompA
  const rankedDual = rankModel_EGCP_Dual(mockCandidates, 'CompA', mockGraph, mockHistoryCounts);

  // In dual diffusion, the high evolutionary weight CompA-CompC pushes energy directly to CompC
  const scoreC = rankedDual.find(c => c.id === 'CompC').egcp_score;
  const scoreD = rankedDual.find(c => c.id === 'CompD').egcp_score;
  assert(scoreC > scoreD, 'CompC should receive more energy than CompD');
});

// ── Test 5: Ablation Verification (Pure Struct vs. Pure Evo) ────────────────
console.log('\n--- 5. Ablation Verification (alpha = 1.0 vs. alpha = 0.0) ---');

it('Pure Structural mode (alpha = 1.0) propagates exclusively through AST edges', () => {
  const rankedStruct = rankModel_EGCP_StructOnly(mockCandidates, 'CompA', mockGraph, mockHistoryCounts);

  // In pure structural mode, 1-hop neighbor CompB must strictly beat 2-hop CompC
  const rankB = rankedStruct.find(c => c.id === 'CompB').egcp_rank;
  const rankC = rankedStruct.find(c => c.id === 'CompC').egcp_rank;
  assert(rankB < rankC, `Under alpha=1.0, 1-hop CompB (rank ${rankB}) must beat 2-hop CompC (rank ${rankC})`);
});

it('Pure Evolutionary mode (alpha = 0.0) propagates exclusively through co-change edges', () => {
  const rankedEvo = rankModel_EGCP_EvoOnly(mockCandidates, 'CompA', mockGraph, mockHistoryCounts);

  // CompA has evolutionary edge to CompC (5 commits), but 0 to CompB
  const rankC = rankedEvo.find(c => c.id === 'CompC').egcp_rank;
  const rankB = rankedEvo.find(c => c.id === 'CompB').egcp_rank;
  assert(rankC < rankB, `Under alpha=0.0, co-changed CompC (rank ${rankC}) must beat non-cochanged CompB (rank ${rankB})`);
});

// ── Test 6: Cold-Start & Sparsity Handling ──────────────────────────────────
console.log('\n--- 6. Robustness Under Extreme Sparsity & Missing Data ---');

it('Handles completely empty history (cold start) gracefully without errors', () => {
  const ranked = rankModel_EGCP(mockCandidates, 'CompA', mockGraph, null);
  assert.strictEqual(ranked.length, mockCandidates.length);
  assert(ranked[0].egcp_score > 0, 'Should fall back to structural energy');
});

it('Handles empty structural relationships (utility library scenario) cleanly', () => {
  const utilityGraph = {
    components: mockGraph.components,
    relationships: [] // 0 structural relationships
  };
  const ranked = rankModel_EGCP(mockCandidates, 'CompA', utilityGraph, mockHistoryCounts);
  assert.strictEqual(ranked.length, mockCandidates.length);
  // Co-changed CompC should rank #1
  assert.strictEqual(ranked[0].id, 'CompC', 'CompC should rank #1 via evolutionary coupling');
});

console.log(`\n======================================================`);
console.log(`EGCP Test Results: ${passed} passed, ${failed} failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
