/**
 * egcpV4Model.js
 * --------------
 * Main entry point for EGCP v4 (Evolutionary-Graph Change Propagation v4).
 *
 * Implements:
 *   - Decoupled dual-channel random walk with restart and degree discounting
 *   - Ablation A: Graph-Entropy Adaptive Channel Balancing (beta_adaptive)
 *   - Ablation B: Progressive Hub Exclusion via Sigmoidal Transition Attenuation
 *   - Ablation C: Evidence-Gated Operation-Aware Edge Weighting
 *   - Full Combined Model (A + B + C + Entity Dampening)
 *   - Per-commit graph caching for maximum throughput
 */

'use strict';

import { EGCP_V4_DEFAULT_CONFIG } from './egcpV4Config.js';
import { buildEGCPv4Graph } from './egcpV4GraphBuilder.js';
import { propagateChannelEnergy, computeDegreeDiscountedLift } from './egcpV4Propagation.js';
import { computeAdaptiveBetaV4 } from './egcpV4AdaptiveBeta.js';
import { rankCandidatesWithEGCPv4, rankCandidatesWithEGCP_SimplifiedMinMax } from './egcpV4Scorer.js';

/**
 * Precomputes and caches the graph topology, entropy, and transition structures for a commit.
 *
 * @param {Object} graph - Pre-change AST graph at c^1
 * @param {Map<string, number>|Object} historyCounts - Leak-free historical co-change counts (j > c)
 * @param {Object} [options] - Configuration overrides
 * @param {string} [editOperation] - Optional classified edit operation
 * @param {string} [seedId] - Optional seed component
 * @param {number} [seedEvoSupport] - Seed direct co-change count
 * @returns {Object} Cached EGCP v4 graph structure
 */
export function buildCommitGraphCacheV4(
  graph,
  historyCounts = null,
  options = {},
  editOperation = null,
  seedId = null,
  seedEvoSupport = 0
) {
  const mergedConfig = { ...EGCP_V4_DEFAULT_CONFIG, ...options };
  return buildEGCPv4Graph(graph, historyCounts, mergedConfig, editOperation, seedId, seedEvoSupport);
}

/**
 * Ranks candidates using EGCP v4 with configurable ablations.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} seedId - Changed seed component ID
 * @param {Object} graphOrCache - Pre-change AST graph OR precomputed cache from buildCommitGraphCacheV4
 * @param {Map<string, number>|Object} historyCounts - Historical co-change counts (j > c)
 * @param {Object} [options] - Configuration overrides
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModel_EGCP_v4(
  structuralCandidates,
  seedId,
  graphOrCache,
  historyCounts = null,
  options = {}
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const config = { ...EGCP_V4_DEFAULT_CONFIG, ...options };
  const editOperation = options.editOperation || null;

  // Calculate seed evolutionary support for gating checks
  let seedEvoSupport = 0;
  if (historyCounts) {
    const entries = historyCounts instanceof Map
      ? Array.from(historyCounts.entries())
      : Object.entries(historyCounts);

    for (const [key, count] of entries) {
      if (!count || count <= 0) continue;
      const parts = key.split('|');
      if (parts.length === 2 && (parts[0] === seedId || parts[1] === seedId)) {
        seedEvoSupport += count;
      }
    }
  }

  // Use precomputed graph cache if valid, otherwise build
  let egcpGraph = null;
  if (graphOrCache && graphOrCache.structTrans && graphOrCache.nodeIndex) {
    // If gated operation weights are enabled and seed triggers gating, rebuild if needed
    if (config.enableGatedOperationWeights && editOperation && graphOrCache.editOperation !== editOperation) {
      egcpGraph = buildEGCPv4Graph(
        { components: graphOrCache.components, relationships: graphOrCache.structAdj ? [] : graphOrCache },
        historyCounts,
        config,
        editOperation,
        seedId,
        seedEvoSupport
      );
    } else {
      egcpGraph = graphOrCache;
    }
  } else {
    egcpGraph = buildEGCPv4Graph(graphOrCache, historyCounts, config, editOperation, seedId, seedEvoSupport);
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

  const gamma = config.degreeDiscountExponent ?? EGCP_V4_DEFAULT_CONFIG.degreeDiscountExponent;

  // Determine effective beta (static or entropy-adaptive)
  let effectiveBeta = config.channelMixingBeta ?? EGCP_V4_DEFAULT_CONFIG.channelMixingBeta;
  if (config.enableEntropyAdaptiveBeta) {
    const adaptiveRes = computeAdaptiveBetaV4(seedId, historyCounts, egcpGraph, config);
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
  return rankCandidatesWithEGCPv4(
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
 * Base EGCP v4 (Equal to EGCP v2/v3 base: static beta=0.60, gamma=0.75, no ablations).
 */
export function rankModel_EGCP_v4_Base(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v4(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: false,
    enableProgressiveHubExclusion: false,
    enableGatedOperationWeights: false,
    enableStereotypeDampening: false
  });
}

/**
 * Ablation A: Graph-Entropy Adaptive Channel Balancing Only.
 */
export function rankModel_EGCP_v4_EntropyBetaOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v4(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: true,
    enableProgressiveHubExclusion: false,
    enableGatedOperationWeights: false,
    enableStereotypeDampening: false
  });
}

/**
 * Ablation B: Progressive Hub Exclusion Only.
 */
export function rankModel_EGCP_v4_HubExclusionOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v4(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: false,
    enableProgressiveHubExclusion: true,
    enableGatedOperationWeights: false,
    enableStereotypeDampening: false
  });
}

/**
 * Ablation C: Evidence-Gated Operation-Aware Edge Weighting Only.
 */
export function rankModel_EGCP_v4_GatedOpOnly(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v4(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: false,
    enableProgressiveHubExclusion: false,
    enableGatedOperationWeights: true,
    enableStereotypeDampening: false
  });
}

/**
 * Combination A + B: Entropy-Adaptive Beta + Progressive Hub Exclusion.
 */
export function rankModel_EGCP_v4_EntropyAndHub(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v4(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: true,
    enableProgressiveHubExclusion: true,
    enableGatedOperationWeights: false,
    enableStereotypeDampening: false
  });
}

/**
 * Full Combined EGCP v4: Entropy-Adaptive Beta + Hub Exclusion + Gated Op + Entity Dampening.
 */
export function rankModel_EGCP_v4_Combined(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_v4(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: true,
    enableProgressiveHubExclusion: true,
    enableGatedOperationWeights: true,
    enableStereotypeDampening: true
  });
}

/**
 * Ranks candidates using EGCP with Simplified Min-Max Normalization and Equal Importance (1:1 Sum):
 *   S_EGCP(c) = S_evo_normalized(c) + S_struct_normalized(c)
 * Removes the adaptive fusion weight (beta).
 *
 * @param {Array<Object>} structuralCandidates
 * @param {string} seedId
 * @param {Object} graphOrCache
 * @param {Map<string, number>|Object} historyCounts
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
export function rankModel_EGCP_SimplifiedMinMax(
  structuralCandidates,
  seedId,
  graphOrCache,
  historyCounts = null,
  options = {}
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const config = { ...EGCP_V4_DEFAULT_CONFIG, ...options };
  const editOperation = options.editOperation || null;

  let seedEvoSupport = 0;
  if (historyCounts) {
    const entries = historyCounts instanceof Map
      ? Array.from(historyCounts.entries())
      : Object.entries(historyCounts);

    for (const [key, count] of entries) {
      if (!count || count <= 0) continue;
      const parts = key.split('|');
      if (parts.length === 2 && (parts[0] === seedId || parts[1] === seedId)) {
        seedEvoSupport += count;
      }
    }
  }

  let egcpGraph = null;
  if (graphOrCache && graphOrCache.structTrans && graphOrCache.nodeIndex) {
    egcpGraph = graphOrCache;
  } else {
    egcpGraph = buildEGCPv4Graph(graphOrCache, historyCounts, config, editOperation, seedId, seedEvoSupport);
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
  const gamma = config.degreeDiscountExponent ?? EGCP_V4_DEFAULT_CONFIG.degreeDiscountExponent;

  // Propagate energy through both channels independently
  const structRes = propagateChannelEnergy(structTrans, seedIndices, N, config);
  const structLift = computeDegreeDiscountedLift(structRes.stationaryScores, structInDegree, gamma);

  const evoRes = propagateChannelEnergy(evoTrans, seedIndices, N, config);
  const evoLift = computeDegreeDiscountedLift(evoRes.stationaryScores, evoInDegree, gamma);

  // Equal 1:1 fusion with Min-Max normalization
  return rankCandidatesWithEGCP_SimplifiedMinMax(
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
 * Simplified EGCP on v4 Topology (Hub Exclusion + Gated Op + Entity Dampening, but Min-Max Equal 1:1 Sum, No Beta).
 */
export function rankModel_EGCP_v4_SimplifiedMinMax(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_SimplifiedMinMax(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: false,
    enableProgressiveHubExclusion: true,
    enableGatedOperationWeights: true,
    enableStereotypeDampening: true
  });
}

/**
 * Simplified EGCP on Base Topology (Parity Random Walk, Min-Max Equal 1:1 Sum, No Beta, No Ablations).
 */
export function rankModel_EGCP_Base_SimplifiedMinMax(candidates, seedId, graph, historyCounts = null, options = {}) {
  return rankModel_EGCP_SimplifiedMinMax(candidates, seedId, graph, historyCounts, {
    ...options,
    enableEntropyAdaptiveBeta: false,
    enableProgressiveHubExclusion: false,
    enableGatedOperationWeights: false,
    enableStereotypeDampening: false
  });
}

