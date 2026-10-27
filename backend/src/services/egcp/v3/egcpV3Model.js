/**
 * egcpV3Model.js
 * --------------
 * Main entry point for EGCP v3 (Evolutionary-Graph Change Propagation v3).
 *
 * Implements:
 *   - Decoupled dual-channel random walk with restart and degree discounting
 *   - Ablation 1: Adaptive Channel Balancing (beta_adaptive)
 *   - Ablation 2: Operation-Aware Edge Weighting
 *   - Ablation 3: Stereotype Entity Dampening
 *   - Per-commit graph caching for high throughput
 */

'use strict';

import { EGCP_V3_DEFAULT_CONFIG } from './egcpV3Config.js';
import { buildEGCPv3Graph } from './egcpV3GraphBuilder.js';
import { propagateChannelEnergy, computeDegreeDiscountedLift } from './egcpV3Propagation.js';
import { computeAdaptiveBeta } from './egcpV3AdaptiveBeta.js';
import { rankCandidatesWithEGCPv3 } from './egcpV3Scorer.js';

/**
 * Precomputes and caches the graph topology and transition structures for a commit.
 *
 * @param {Object} graph - Pre-change AST graph at c^1
 * @param {Map<string, number>|Object} historyCounts - Leak-free historical co-change counts (j > c)
 * @param {Object} [options] - Configuration overrides
 * @param {string} [editOperation] - Optional classified edit operation
 * @returns {Object} Cached EGCP v3 graph structure
 */
export function buildCommitGraphCacheV3(graph, historyCounts = null, options = {}, editOperation = null) {
  const mergedConfig = { ...EGCP_V3_DEFAULT_CONFIG, ...options };
  return buildEGCPv3Graph(graph, historyCounts, mergedConfig, editOperation);
}

/**
 * Ranks candidates using EGCP v3 with configurable ablations.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} seedId - Changed seed component ID
 * @param {Object} graphOrCache - Pre-change AST graph OR precomputed cache from buildCommitGraphCacheV3
 * @param {Map<string, number>|Object} historyCounts - Historical co-change counts (j > c)
 * @param {Object} [options] - Configuration overrides
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModel_EGCP_v3(
  structuralCandidates,
  seedId,
  graphOrCache,
  historyCounts = null,
  options = {}
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const config = { ...EGCP_V3_DEFAULT_CONFIG, ...options };
  const editOperation = options.editOperation || null;

  // Use precomputed graph cache if valid, else build graph
  let egcpGraph = null;
  if (graphOrCache && graphOrCache.structTrans && graphOrCache.nodeIndex) {
    if (config.enableOperationAwareWeights && editOperation && graphOrCache.editOperation !== editOperation) {
      // Rebuild on-the-fly if operation differs from cached operation
      egcpGraph = buildEGCPv3Graph(
        { components: graphOrCache.components, relationships: graphOrCache.structAdj ? [] : graphOrCache },
        historyCounts,
        config,
        editOperation
      );
    } else {
      egcpGraph = graphOrCache;
    }
  } else {
    egcpGraph = buildEGCPv3Graph(graphOrCache, historyCounts, config, editOperation);
  }

  const {
    nodes,
    nodeIndex,
    structTrans,
    evoTrans,
    structInDegree,
    evoInDegree
  } = egcpGraph;

  const N = nodes.length;
  const seedIdx = nodeIndex.get(seedId);
  const seedIndices = seedIdx !== undefined ? [seedIdx] : [];

  const gamma = config.degreeDiscountExponent ?? EGCP_V3_DEFAULT_CONFIG.degreeDiscountExponent;

  // Determine effective beta (static or adaptive)
  let effectiveBeta = config.channelMixingBeta ?? EGCP_V3_DEFAULT_CONFIG.channelMixingBeta;
  if (config.enableAdaptiveBeta) {
    const adaptiveRes = computeAdaptiveBeta(seedId, historyCounts, egcpGraph, config);
    effectiveBeta = adaptiveRes.beta;
  }

  // 1. Structural Diffusion (skipped if beta = 1.0)
  let structLift = null;
  if (effectiveBeta < 1.0) {
    const structRes = propagateChannelEnergy(structTrans, seedIndices, N, config);
    structLift = computeDegreeDiscountedLift(structRes.stationaryScores, structInDegree, gamma);
  }

  // 2. Evolutionary Diffusion (skipped if beta = 0.0)
  let evoLift = null;
  if (effectiveBeta > 0.0) {
    const evoRes = propagateChannelEnergy(evoTrans, seedIndices, N, config);
    evoLift = computeDegreeDiscountedLift(evoRes.stationaryScores, evoInDegree, gamma);
  }

  // 3. Score and Deterministically Rank Candidate Universe
  return rankCandidatesWithEGCPv3(
    structuralCandidates,
    seedId,
    nodeIndex,
    structLift,
    evoLift,
    effectiveBeta,
    historyCounts,
    config
  );
}

/**
 * Base EGCP v3 (Equal to EGCP v2 baseline: beta=0.60, gamma=0.75, no adaptive, no op, no dampening).
 */
export function rankModel_EGCP_v3_Base(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v3(candidates, seedId, graph, historyCounts, {
    ...options,
    enableAdaptiveBeta: false,
    enableOperationAwareWeights: false,
    enableStereotypeDampening: false
  });
}

/**
 * Ablation 1: Adaptive Channel Balancing (beta_adaptive) Only.
 */
export function rankModel_EGCP_v3_AdaptiveBetaOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v3(candidates, seedId, graph, historyCounts, {
    ...options,
    enableAdaptiveBeta: true,
    enableOperationAwareWeights: false,
    enableStereotypeDampening: false
  });
}

/**
 * Ablation 2: Operation-Aware Edge Weighting Only.
 */
export function rankModel_EGCP_v3_OpAwareOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v3(candidates, seedId, graph, historyCounts, {
    ...options,
    enableAdaptiveBeta: false,
    enableOperationAwareWeights: true,
    enableStereotypeDampening: false
  });
}

/**
 * Ablation 3: Stereotype Entity Dampening Only.
 */
export function rankModel_EGCP_v3_DampeningOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v3(candidates, seedId, graph, historyCounts, {
    ...options,
    enableAdaptiveBeta: false,
    enableOperationAwareWeights: false,
    enableStereotypeDampening: true
  });
}

/**
 * Combined EGCP v3: Adaptive Beta + Operation-Aware + Entity Dampening.
 */
export function rankModel_EGCP_v3_Combined(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v3(candidates, seedId, graph, historyCounts, {
    ...options,
    enableAdaptiveBeta: true,
    enableOperationAwareWeights: true,
    enableStereotypeDampening: true
  });
}
