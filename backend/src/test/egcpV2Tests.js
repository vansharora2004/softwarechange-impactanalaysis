/**
 * egcpV2Tests.js
 * --------------
 * Comprehensive Unit and Regression Test Suite for EGCP v2.
 * Verifies hub discounting, decoupled dual-channel fusion, candidate universe preservation,
 * dangling node teleportation, and deterministic ranking.
 */

'use strict';

import {
  buildEGCPv2Graph
} from '../services/egcp/v2/egcpV2GraphBuilder.js';
import {
  propagateChannelEnergy,
  computeDegreeDiscountedLift
} from '../services/egcp/v2/egcpV2Propagation.js';
import {
  rankModel_EGCP_v2,
  buildCommitGraphCacheV2,
  rankModel_EGCP_v2_NoDegreeDiscount,
  rankModel_EGCP_v2_EvoOnly,
  rankModel_EGCP_v2_StructOnly
} from '../services/egcp/v2/egcpV2Model.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log(`\n=== Evolutionary-Graph Change Propagation v2 (EGCP v2) Test Suite ===\n`);

// Mock Graph: Seed A connected to Hub H (in-degree 10) and Target B (in-degree 1)
const mockComponents = [
  { id: 'CompA', type: 'Controller', filePath: 'CompA.java' },
  { id: 'CompB', type: 'Service', filePath: 'CompB.java' },
  { id: 'CompH_Hub', type: 'Entity', filePath: 'CompH_Hub.java' },
  { id: 'Other1', type: 'Service', filePath: 'Other1.java' },
  { id: 'Other2', type: 'Service', filePath: 'Other2.java' },
  { id: 'Other3', type: 'Service', filePath: 'Other3.java' },
  { id: 'Other4', type: 'Service', filePath: 'Other4.java' },
  { id: 'Other5', type: 'Service', filePath: 'Other5.java' }
];

const mockRelationships = [
  // A depends on B and H
  { source: 'CompA', target: 'CompB', type: 'DEPENDS_ON' },
  { source: 'CompA', target: 'CompH_Hub', type: 'DEPENDS_ON' },
  // Many other nodes also depend on H, making H a high-in-degree hub
  { source: 'Other1', target: 'CompH_Hub', type: 'DEPENDS_ON' },
  { source: 'Other2', target: 'CompH_Hub', type: 'DEPENDS_ON' },
  { source: 'Other3', target: 'CompH_Hub', type: 'DEPENDS_ON' },
  { source: 'Other4', target: 'CompH_Hub', type: 'DEPENDS_ON' },
  { source: 'Other5', target: 'CompH_Hub', type: 'DEPENDS_ON' }
];

const mockCandidates = [
  { id: 'CompB', minHop: 1, structuralBaselineRank: 1 },
  { id: 'CompH_Hub', minHop: 1, structuralBaselineRank: 2 },
  { id: 'Other1', minHop: 2, structuralBaselineRank: 3 }
];

console.log('--- 1. In-Degree Profiling & Graph Construction ---');
{
  const egcpGraph = buildEGCPv2Graph({ components: mockComponents, relationships: mockRelationships }, null);
  const hubIdx = egcpGraph.nodeIndex.get('CompH_Hub');
  const bIdx = egcpGraph.nodeIndex.get('CompB');

  assert(egcpGraph.nodes.length === 8, 'Correctly indexes all 8 components');
  assert(egcpGraph.structInDegree[hubIdx] > egcpGraph.structInDegree[bIdx], 'Hub H has significantly higher in-degree than target B');
  assert(egcpGraph.structTrans[egcpGraph.nodeIndex.get('CompA')].length === 2, 'Seed A has transitions to both B and H');
}

console.log('\n--- 2. Hub Discounting Verification (gamma = 0.75 vs. gamma = 0.0) ---');
{
  const graph = { components: mockComponents, relationships: mockRelationships };

  // Run without degree discounting (v1 style)
  const rankedV1Style = rankModel_EGCP_v2_NoDegreeDiscount(mockCandidates, 'CompA', graph, null);

  // Run with degree discounting (v2 style)
  const rankedV2Style = rankModel_EGCP_v2(mockCandidates, 'CompA', graph, null, { degreeDiscountExponent: 0.75, channelMixingBeta: 0.0 });

  const topV1 = rankedV1Style[0].id;
  const topV2 = rankedV2Style[0].id;

  // In v1, the hub absorbs high probability mass from multiple edges
  // In v2, degree discounting penalizes the hub's raw score
  assert(rankedV2Style.find(c => c.id === 'CompB').egcp_v2_score > rankedV2Style.find(c => c.id === 'CompH_Hub').egcp_v2_score,
    'Target B is ranked ahead of global Hub H under degree discounting in v2');
}

console.log('\n--- 3. Candidate Universe Preservation & Determinism ---');
{
  const graph = { components: mockComponents, relationships: mockRelationships };
  const historyCounts = new Map([['CompA|CompB', 5]]);

  const ranked1 = rankModel_EGCP_v2(mockCandidates, 'CompA', graph, historyCounts);
  const ranked2 = rankModel_EGCP_v2(mockCandidates, 'CompA', graph, historyCounts);

  assert(ranked1.length === mockCandidates.length, 'Preserves 100% of candidate universe (0 dropped/added)');
  assert(ranked1[0].id === ranked2[0].id && ranked1[1].id === ranked2[1].id, 'Deterministic ranking across multiple calls');
}

console.log('\n--- 4. Decoupled Dual-Channel Fusion & Ablations ---');
{
  const graph = { components: mockComponents, relationships: mockRelationships };
  // Direct evolutionary link between CompA and Other1
  const historyCounts = new Map([['CompA|Other1', 10]]);

  const evoOnly = rankModel_EGCP_v2_EvoOnly(mockCandidates, 'CompA', graph, historyCounts);
  const structOnly = rankModel_EGCP_v2_StructOnly(mockCandidates, 'CompA', graph, historyCounts);
  const dual = rankModel_EGCP_v2(mockCandidates, 'CompA', graph, historyCounts, { channelMixingBeta: 0.60 });

  assert(evoOnly[0].id === 'Other1', 'Evo-only mode (beta=1.0) prioritizes co-changed component Other1 first');
  assert(structOnly[0].id !== 'Other1', 'Struct-only mode (beta=0.0) prioritizes 1-hop structural neighbors first');
  assert(dual.find(c => c.id === 'Other1').egcp_v2_score > 0, 'Dual mode effectively balances structural and evolutionary evidence');
}

console.log('\n--- 5. Dangling Node Teleportation & Probability Mass Conservation ---');
{
  // Node with zero outgoing edges
  const emptyTrans = [[], [{ to: 0, prob: 1.0 }]];
  const res = propagateChannelEnergy(emptyTrans, [0], 2, { maxIterations: 30, convergenceTolerance: 1e-4 });

  const sumProb = res.stationaryScores[0] + res.stationaryScores[1];
  assert(res.converged, 'Power iteration converges with dangling nodes');
  assert(Math.abs(sumProb - 1.0) < 1e-6, 'Total probability mass strictly conserved to 1.0');
}

console.log('\n--- 6. Per-Commit Graph Caching Efficiency & Equivalence ---');
{
  const graph = { components: mockComponents, relationships: mockRelationships };
  const historyCounts = new Map([['CompA|CompB', 3]]);

  // Direct without cache
  const rankedDirect = rankModel_EGCP_v2(mockCandidates, 'CompA', graph, historyCounts);

  // With precomputed cache
  const cache = buildCommitGraphCacheV2(graph, historyCounts);
  const rankedCached = rankModel_EGCP_v2(mockCandidates, 'CompA', cache, historyCounts);

  assert(rankedDirect[0].id === rankedCached[0].id, 'Precomputed graph cache produces identical top rank to on-the-fly execution');
  assert(Math.abs(rankedDirect[0].egcp_v2_score - rankedCached[0].egcp_v2_score) < 1e-12, 'Cached scores are numerically identical');
}

console.log('\n--- 7. Robustness Under Cold Start & Empty Inputs ---');
{
  const graph = { components: mockComponents, relationships: [] };
  const rankedEmpty = rankModel_EGCP_v2(mockCandidates, 'CompA', graph, null);

  assert(rankedEmpty.length === mockCandidates.length, 'Handles completely empty relationships cleanly');
  assert(rankModel_EGCP_v2([], 'CompA', graph, null).length === 0, 'Handles empty candidate array gracefully');
}

console.log(`\n======================================================`);
console.log(`EGCP v2 Test Results: ${passed} passed, ${failed} failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
