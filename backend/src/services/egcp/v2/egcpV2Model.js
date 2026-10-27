/**
 * egcpV2Model.js
 * --------------
 * Main entry point for EGCP v2 (Evolutionary-Graph Change Propagation v2).
 *
 * Implements decoupled dual-channel random walk with restart, in-degree hub discounting,
 * and high-performance per-commit graph caching.
 */

'use strict';

import { EGCP_V2_DEFAULT_CONFIG } from './egcpV2Config.js';
import { buildEGCPv2Graph } from './egcpV2GraphBuilder.js';
import { propagateChannelEnergy, computeDegreeDiscountedLift } from './egcpV2Propagation.js';
import { rankCandidatesWithEGCPv2 } from './egcpV2Scorer.js';

/**
 * Precomputes and caches the graph topology and transition structures for a commit.
 * Can be safely reused across all leave-one-out cases within that commit.
 *
 * @param {Object} graph - Pre-change AST graph at c^1
 * @param {Map<string, number>|Object} historyCounts - Leak-free historical co-change counts (j < c)
 * @param {Object} [options] - Configuration overrides
 * @returns {Object} Cached EGCP v2 graph structure
 */
export function buildCommitGraphCacheV2(graph, historyCounts = null, options = {}) {
  const mergedConfig = { ...EGCP_V2_DEFAULT_CONFIG, ...options };
  return buildEGCPv2Graph(graph, historyCounts, mergedConfig);
}

/**
 * Ranks candidates using EGCP v2 with an optionally precomputed graph cache.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} seedId - Changed seed component ID
 * @param {Object} graphOrCache - Pre-change AST graph OR precomputed cache from buildCommitGraphCacheV2
 * @param {Map<string, number>|Object} historyCounts - Historical co-change counts (j < c)
 * @param {Object} [options] - Configuration overrides
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModel_EGCP_v2(
  structuralCandidates,
  seedId,
  graphOrCache,
  historyCounts = null,
  options = {}
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const config = { ...EGCP_V2_DEFAULT_CONFIG, ...options };

  // Use precomputed graph cache if provided, else build on-the-fly
  const egcpGraph = (graphOrCache && graphOrCache.structTrans && graphOrCache.nodeIndex)
    ? graphOrCache
    : buildEGCPv2Graph(graphOrCache, historyCounts, config);

  const {
    nodes,
    nodeIndex,
    structTrans,
    evoTrans,
    structInDegree,
    evoInDegree,
    totalInDegree
  } = egcpGraph;

  const N = nodes.length;
  const seedIdx = nodeIndex.get(seedId);
  const seedIndices = seedIdx !== undefined ? [seedIdx] : [];

  const gamma = config.degreeDiscountExponent ?? EGCP_V2_DEFAULT_CONFIG.degreeDiscountExponent;
  const beta = config.channelMixingBeta ?? EGCP_V2_DEFAULT_CONFIG.channelMixingBeta;

  // 1. Structural Diffusion (skipped if beta = 1.0)
  let structLift = null;
  if (beta < 1.0) {
    const structRes = propagateChannelEnergy(structTrans, seedIndices, N, config);
    structLift = computeDegreeDiscountedLift(structRes.stationaryScores, structInDegree, gamma);
  }

  // 2. Evolutionary Diffusion (skipped if beta = 0.0)
  let evoLift = null;
  if (beta > 0.0) {
    const evoRes = propagateChannelEnergy(evoTrans, seedIndices, N, config);
    evoLift = computeDegreeDiscountedLift(evoRes.stationaryScores, evoInDegree, gamma);
  }

  // 3. Score and Deterministically Rank Candidate Universe
  return rankCandidatesWithEGCPv2(
    structuralCandidates,
    seedId,
    nodeIndex,
    structLift,
    evoLift,
    historyCounts,
    config
  );
}

/**
 * Ablation 1: Raw Stationary Probability (gamma = 0.0, No Degree Discounting).
 */
export function rankModel_EGCP_v2_NoDegreeDiscount(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v2(candidates, seedId, graph, historyCounts, { ...options, degreeDiscountExponent: 0.0 });
}

/**
 * Ablation 2: Pure Evolutionary Diffusion (beta = 1.0).
 */
export function rankModel_EGCP_v2_EvoOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v2(candidates, seedId, graph, historyCounts, { ...options, channelMixingBeta: 1.0 });
}

/**
 * Ablation 3: Pure Structural Diffusion (beta = 0.0).
 */
export function rankModel_EGCP_v2_StructOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v2(candidates, seedId, graph, historyCounts, { ...options, channelMixingBeta: 0.0 });
}
