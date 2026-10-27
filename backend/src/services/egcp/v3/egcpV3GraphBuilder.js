/**
 * egcpV3GraphBuilder.js
 * ---------------------
 * Builds decoupled multi-relational graph structures for EGCP v3.
 * Supports:
 *   - In-degree profiling for hub discounting
 *   - Optional operation-aware edge weighting
 *   - Efficient caching across leave-one-out cases
 */

'use strict';

import { EGCP_V3_DEFAULT_CONFIG } from './egcpV3Config.js';

/**
 * Builds the EGCP v3 multi-relational graph representation.
 *
 * @param {Object} graph - Pre-change AST graph { components, relationships }
 * @param {Map<string, number>|Object} historyCounts - Pairwise co-change counts 'idA|idB'
 * @param {Object} [config] - EGCP v3 configuration options
 * @param {string} [editOperation] - Optional classified edit operation category
 * @returns {Object} Graph topology, in-degrees, and precomputed transition probability lists
 */
export function buildEGCPv3Graph(graph, historyCounts = null, config = EGCP_V3_DEFAULT_CONFIG, editOperation = null) {
  const components = graph.components || [];
  const relationships = graph.relationships || [];

  const nodes = components.map(c => c.id);
  const nodeIndex = new Map();
  nodes.forEach((id, idx) => nodeIndex.set(id, idx));

  const N = nodes.length;

  // 1. Structural Adjacency and In-Degree
  const structAdj = Array.from({ length: N }, () => []);
  const structInDegree = new Uint32Array(N);

  const baseEdgeWeights = { ...EGCP_V3_DEFAULT_CONFIG.structuralEdgeWeights, ...(config.structuralEdgeWeights || {}) };
  const revFactor = config.reverseEdgeWeightFactor ?? EGCP_V3_DEFAULT_CONFIG.reverseEdgeWeightFactor;
  const defWeight = config.defaultStructuralWeight ?? EGCP_V3_DEFAULT_CONFIG.defaultStructuralWeight;

  // Apply Operation-Aware Multipliers if enabled
  const opMultipliers = (config.enableOperationAwareWeights && editOperation && config.operationWeightMultipliers[editOperation])
    ? config.operationWeightMultipliers[editOperation]
    : null;

  for (const rel of relationships) {
    const fromId = rel.source || rel.sourceId || rel.fromId || rel.from;
    const toId = rel.target || rel.targetId || rel.toId || rel.to;

    const fromIdx = nodeIndex.get(fromId);
    const toIdx = nodeIndex.get(toId);

    if (fromIdx !== undefined && toIdx !== undefined && fromIdx !== toIdx) {
      const type = rel.type || rel.relationshipType || '';
      let w = baseEdgeWeights[type] !== undefined ? baseEdgeWeights[type] : defWeight;

      if (opMultipliers && opMultipliers[type] !== undefined) {
        w *= opMultipliers[type];
      }

      // Forward edge: from -> to
      structAdj[fromIdx].push({ to: toIdx, weight: w });
      structInDegree[toIdx]++;

      // Reverse edge: to -> from (scaled)
      if (revFactor > 0) {
        structAdj[toIdx].push({ to: fromIdx, weight: w * revFactor });
        structInDegree[fromIdx]++;
      }
    }
  }

  // Deduplicate and consolidate structural parallel edges
  const structTrans = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const edgeMap = new Map();
    for (const e of structAdj[i]) {
      edgeMap.set(e.to, (edgeMap.get(e.to) || 0) + e.weight);
    }
    const merged = Array.from(edgeMap.entries()).map(([to, weight]) => ({ to: Number(to), weight }));
    structAdj[i] = merged;

    // Precompute structural transition probabilities
    const sumW = merged.reduce((s, e) => s + e.weight, 0);
    if (sumW > 0) {
      structTrans[i] = merged.map(e => ({ to: e.to, prob: e.weight / sumW }));
    } else {
      // Dangling node in structural channel
      structTrans[i] = [];
    }
  }

  // 2. Evolutionary Adjacency and In-Degree
  const evoAdj = Array.from({ length: N }, () => []);
  const evoInDegree = new Uint32Array(N);
  const evoTrans = Array.from({ length: N }, () => []);
  const componentCommits = new Map();

  if (historyCounts) {
    const entries = historyCounts instanceof Map
      ? Array.from(historyCounts.entries())
      : Object.entries(historyCounts);

    const minSupport = config.minEvoSupport ?? 1;

    for (const [key, count] of entries) {
      if (count < minSupport) continue;
      const parts = key.split('|');
      if (parts.length === 2) {
        const [idA, idB] = parts;
        componentCommits.set(idA, (componentCommits.get(idA) || 0) + count);
        componentCommits.set(idB, (componentCommits.get(idB) || 0) + count);

        const idxA = nodeIndex.get(idA);
        const idxB = nodeIndex.get(idB);

        if (idxA !== undefined && idxB !== undefined && idxA !== idxB) {
          evoAdj[idxA].push({ to: idxB, count });
          evoAdj[idxB].push({ to: idxA, count });
          evoInDegree[idxA]++;
          evoInDegree[idxB]++;
        }
      }
    }
  }

  // Deduplicate and consolidate evolutionary parallel edges
  for (let i = 0; i < N; i++) {
    const edgeMap = new Map();
    for (const e of evoAdj[i]) {
      edgeMap.set(e.to, (edgeMap.get(e.to) || 0) + e.count);
    }
    const merged = Array.from(edgeMap.entries()).map(([to, count]) => ({ to: Number(to), count }));
    evoAdj[i] = merged;

    // Normalization: Jaccard-like co-occurrence probability P(j | i) = C_ij / Sum_k(C_ik)
    const sumC = merged.reduce((s, e) => s + e.count, 0);
    if (sumC > 0) {
      evoTrans[i] = merged.map(e => ({ to: e.to, prob: e.count / sumC }));
    } else {
      // Dangling node in evolutionary channel
      evoTrans[i] = [];
    }
  }

  const totalInDegree = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    totalInDegree[i] = structInDegree[i] + evoInDegree[i];
  }

  return {
    nodes,
    nodeIndex,
    components,
    structAdj,
    evoAdj,
    structTrans,
    evoTrans,
    structInDegree,
    evoInDegree,
    totalInDegree,
    editOperation
  };
}
