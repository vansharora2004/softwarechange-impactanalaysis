/**
 * egcpModel.js
 * ------------
 * Main entry point for Evolutionary-Graph Change Propagation (EGCP).
 *
 * An independent graph-propagation model that diffuses change activation
 * from seed components across a multi-relational evolutionary-structural graph.
 *
 * Guarantees:
 *   1. Strictly leak-free: graph from c^1, history from j < c.
 *   2. Preserves candidate universe |C|: zero candidates dropped or added.
 *   3. 100% deterministic ranking with explicit tie-breaking.
 *   4. Zero dependencies on OCCP or live UI modules.
 */

'use strict';

import { EGCP_DEFAULT_CONFIG } from './egcpConfig.js';
import { buildEGCPGraph } from './egcpGraphBuilder.js';
import { propagateEvolutionaryEnergy } from './egcpPropagation.js';
import { rankCandidatesWithEGCP } from './egcpScorer.js';

/**
 * Executes Evolutionary-Graph Change Propagation (EGCP) to rank candidates.
 *
 * @param {Array<Object>} structuralCandidates - Candidate components from generateStructuralCandidatesInMemory
 * @param {string} seedId - Changed seed component ID
 * @param {Object} graph - Pre-change AST graph at c^1 { components, relationships }
 * @param {Map<string, number>|Object} historyCounts - Co-change counts from commits older than target (j < c)
 * @param {Object} [options] - Configuration overrides (dampingFactor, alpha, maxIterations, etc.)
 * @returns {Array<Object>} Ranked candidates with EGCP scores
 */
export function rankModel_EGCP(
  structuralCandidates,
  seedId,
  graph,
  historyCounts = null,
  options = {}
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  // 1. Build Heterogeneous Graph Representation
  const egcpGraph = buildEGCPGraph(graph, historyCounts, options);

  // 2. Identify Seed Index
  const seedIdx = egcpGraph.nodeIndex.get(seedId);

  // 3. Propagate Energy via Random Walk with Restart
  const propResult = propagateEvolutionaryEnergy(
    egcpGraph,
    seedIdx !== undefined ? [seedIdx] : [],
    options
  );

  // 4. Score and Deterministically Rank Candidates
  return rankCandidatesWithEGCP(
    structuralCandidates,
    seedId,
    egcpGraph,
    propResult.stationaryScores,
    historyCounts
  );
}

/**
 * Ablation 1: Pure Structural Diffusion (alpha = 1.0).
 */
export function rankModel_EGCP_StructOnly(structuralCandidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP(structuralCandidates, seedId, graph, historyCounts, { ...options, alpha: 1.0 });
}

/**
 * Ablation 2: Pure Evolutionary Co-Change Diffusion (alpha = 0.0).
 */
export function rankModel_EGCP_EvoOnly(structuralCandidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP(structuralCandidates, seedId, graph, historyCounts, { ...options, alpha: 0.0 });
}

/**
 * Standard Balanced EGCP: Dual-Channel Diffusion (alpha = 0.5).
 */
export function rankModel_EGCP_Dual(structuralCandidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP(structuralCandidates, seedId, graph, historyCounts, { ...options, alpha: 0.5 });
}
