/**
 * egcpV2GraphBuilder.js
 * ---------------------
 * Builds decoupled multi-relational graph structures for EGCP v2.
 * Computes node in-degrees for hub discounting and precomputes transition probabilities.
 */

'use strict';

import { EGCP_V2_DEFAULT_CONFIG } from './egcpV2Config.js';

/**
 * Builds the EGCP v2 heterogeneous graph representation.
 *
 * @param {Object} graph - Pre-change AST graph { components, relationships }
 * @param {Map<string, number>|Object} historyCounts - Pairwise co-change counts 'idA|idB'
 * @param {Object} [config] - EGCP v2 configuration options
 * @returns {Object} Graph topology, in-degrees, and precomputed transition probability lists
 */
export function buildEGCPv2Graph(graph, historyCounts = null, config = EGCP_V2_DEFAULT_CONFIG) {
  const components = graph.components || [];
  const relationships = graph.relationships || [];

  const nodes = components.map(c => c.id);
  const nodeIndex = new Map();
  nodes.forEach((id, idx) => nodeIndex.set(id, idx));

  const N = nodes.length;

  // 1. Structural Adjacency and In-Degree
  const structAdj = Array.from({ length: N }, () => []);
  const structInDegree = new Uint32Array(N);

  const edgeWeights = config.structuralEdgeWeights || EGCP_V2_DEFAULT_CONFIG.structuralEdgeWeights;
  const revFactor = config.reverseEdgeWeightFactor ?? EGCP_V2_DEFAULT_CONFIG.reverseEdgeWeightFactor;
  const defWeight = config.defaultStructuralWeight ?? EGCP_V2_DEFAULT_CONFIG.defaultStructuralWeight;

  for (const rel of relationships) {
    const fromId = rel.source || rel.sourceId || rel.fromId || rel.from;
    const toId = rel.target || rel.targetId || rel.toId || rel.to;

    const fromIdx = nodeIndex.get(fromId);
    const toIdx = nodeIndex.get(toId);

    if (fromIdx !== undefined && toIdx !== undefined && fromIdx !== toIdx) {
      const type = rel.type || rel.relationshipType || '';
      const w = edgeWeights[type] !== undefined ? edgeWeights[type] : defWeight;

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
      }
    }

    // Construct normalized evolutionary edges
    for (const [key, count] of entries) {
      if (count < minSupport) continue;
      const parts = key.split('|');
      if (parts.length !== 2) continue;
      const [idA, idB] = parts;

      const idxA = nodeIndex.get(idA);
      const idxB = nodeIndex.get(idB);

      if (idxA !== undefined && idxB !== undefined && idxA !== idxB) {
        const totA = componentCommits.get(idA) || count;
        const totB = componentCommits.get(idB) || count;
        // Salton's cosine coefficient for evolutionary coupling
        const normWeight = count / Math.sqrt(totA * totB);

        evoAdj[idxA].push({ to: idxB, weight: normWeight });
        evoAdj[idxB].push({ to: idxA, weight: normWeight });
        evoInDegree[idxB]++;
        evoInDegree[idxA]++;
      }
    }

    // Deduplicate and precompute evolutionary transition probabilities
    for (let i = 0; i < N; i++) {
      const edgeMap = new Map();
      for (const e of evoAdj[i]) {
        edgeMap.set(e.to, Math.max(edgeMap.get(e.to) || 0, e.weight));
      }
      const merged = Array.from(edgeMap.entries()).map(([to, weight]) => ({ to: Number(to), weight }));
      evoAdj[i] = merged;

      const sumW = merged.reduce((s, e) => s + e.weight, 0);
      if (sumW > 0) {
        evoTrans[i] = merged.map(e => ({ to: e.to, prob: e.weight / sumW }));
      } else {
        evoTrans[i] = [];
      }
    }
  }

  // Combined In-Degree for Hub Mitigation
  const totalInDegree = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    totalInDegree[i] = structInDegree[i] + evoInDegree[i];
  }

  return {
    nodes,
    nodeIndex,
    structAdj,
    evoAdj,
    structTrans,
    evoTrans,
    structInDegree,
    evoInDegree,
    totalInDegree,
    componentCommits
  };
}
