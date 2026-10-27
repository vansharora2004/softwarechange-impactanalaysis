/**
 * egcpGraphBuilder.js
 * -------------------
 * Builds the unified multi-relational evolutionary-structural graph representation
 * from the pre-change AST graph (c^1) and leak-free historical co-change counts (j < c).
 */

'use strict';

import { EGCP_DEFAULT_CONFIG } from './egcpConfig.js';

/**
 * Builds the heterogeneous graph representation for EGCP.
 *
 * @param {Object} graph - Pre-change AST graph { components, relationships }
 * @param {Map<string, number>|Object} historyCounts - Pairwise co-change counts 'idA|idB'
 * @param {Object} [config] - EGCP configuration options
 * @returns {Object} { nodes, nodeIndex, structAdj, evoAdj, evoWeights }
 */
export function buildEGCPGraph(graph, historyCounts = null, config = EGCP_DEFAULT_CONFIG) {
  const components = graph.components || [];
  const relationships = graph.relationships || [];

  const nodes = components.map(c => c.id);
  const nodeIndex = new Map();
  nodes.forEach((id, idx) => nodeIndex.set(id, idx));

  const N = nodes.length;

  // 1. Build Structural Adjacency Lists
  // structAdj[i] = Array<{ to: number, weight: number }>
  const structAdj = Array.from({ length: N }, () => []);
  const edgeWeights = config.structuralEdgeWeights || EGCP_DEFAULT_CONFIG.structuralEdgeWeights;
  const revFactor = config.reverseEdgeWeightFactor ?? 0.5;
  const defWeight = config.defaultStructuralWeight ?? 0.5;

  for (const rel of relationships) {
    const fromIdx = nodeIndex.get(rel.source || rel.sourceId || rel.fromId || rel.from);
    const toIdx = nodeIndex.get(rel.target || rel.targetId || rel.toId || rel.to);

    if (fromIdx !== undefined && toIdx !== undefined && fromIdx !== toIdx) {
      const type = rel.type || rel.relationshipType || '';
      const w = edgeWeights[type] !== undefined ? edgeWeights[type] : defWeight;

      // Forward edge: from -> to
      structAdj[fromIdx].push({ to: toIdx, weight: w });

      // Backward edge: to -> from (scaled)
      if (revFactor > 0) {
        structAdj[toIdx].push({ to: fromIdx, weight: w * revFactor });
      }
    }
  }

  // Deduplicate and consolidate structural parallel edges
  for (let i = 0; i < N; i++) {
    const edgeMap = new Map();
    for (const e of structAdj[i]) {
      edgeMap.set(e.to, (edgeMap.get(e.to) || 0) + e.weight);
    }
    structAdj[i] = Array.from(edgeMap.entries()).map(([to, weight]) => ({ to: Number(to), weight }));
  }

  // 2. Build Evolutionary Adjacency Lists from Leak-Free History
  // evoAdj[i] = Array<{ to: number, weight: number }>
  const evoAdj = Array.from({ length: N }, () => []);
  const componentCommits = new Map();

  // If historyCounts is a Map or Object, calculate individual component activity
  if (historyCounts) {
    const entries = historyCounts instanceof Map
      ? Array.from(historyCounts.entries())
      : Object.entries(historyCounts);

    for (const [key, count] of entries) {
      if (count <= 0) continue;
      const parts = key.split('|');
      if (parts.length === 2) {
        const [idA, idB] = parts;
        componentCommits.set(idA, (componentCommits.get(idA) || 0) + count);
        componentCommits.set(idB, (componentCommits.get(idB) || 0) + count);
      }
    }

    // Now construct normalized evolutionary edges
    for (const [key, count] of entries) {
      if (count <= 0) continue;
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
      }
    }

    // Deduplicate evolutionary edges
    for (let i = 0; i < N; i++) {
      const edgeMap = new Map();
      for (const e of evoAdj[i]) {
        edgeMap.set(e.to, Math.max(edgeMap.get(e.to) || 0, e.weight));
      }
      evoAdj[i] = Array.from(edgeMap.entries()).map(([to, weight]) => ({ to: Number(to), weight }));
    }
  }

  return {
    nodes,
    nodeIndex,
    structAdj,
    evoAdj,
    componentCommits
  };
}
