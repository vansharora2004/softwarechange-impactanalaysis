/**
 * egcpV4GraphBuilder.js
 * ---------------------
 * Multi-relational graph builder for EGCP v4.
 *
 * Implements:
 *   - Pre-change AST graph parsing at c^1
 *   - Pre-change historical co-change aggregation (j > c)
 *   - Graph in-degree Shannon entropy calculation (for Ablation A)
 *   - Progressive Hub Exclusion (Ablation B): Sigmoidal attenuation of transitions
 *     into extreme in-degree sink nodes.
 *   - Evidence-Gated Operation-Aware Edge Weighting (Ablation C): Selectively applies
 *     op-multipliers only when evolutionary history is sparse and seed is logic.
 */

'use strict';

import { EGCP_V4_DEFAULT_CONFIG } from './egcpV4Config.js';
import { computeGraphInDegreeEntropy } from './egcpV4AdaptiveBeta.js';

function isBusinessLogicComponent(sourceId) {
  if (!sourceId) return false;
  return /(service|controller|api|manager|handler|resource|endpoint)/i.test(sourceId);
}

/**
 * Computes percentile value from an array of numbers.
 *
 * @param {Array<number>|Uint32Array} values
 * @param {number} percentile - 0.0 to 1.0
 * @returns {number}
 */
export function computePercentile(values, percentile) {
  if (!values || values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(percentile * sorted.length)));
  return sorted[index];
}

/**
 * Calculates sigmoidal hub attenuation multiplier.
 *
 * @param {number} inDegree
 * @param {number} threshold
 * @param {number} slope
 * @param {number} minAttenuation
 * @returns {number} Multiplier in [minAttenuation, 1.0]
 */
export function computeHubAttenuation(inDegree, threshold, slope = 0.005, minAttenuation = 0.05) {
  if (inDegree <= threshold) return 1.0;
  const diff = inDegree - threshold;
  // Logistic decay: 1 / (1 + exp(slope * diff))
  const decay = 1.0 / (1.0 + Math.exp(slope * diff));
  return Math.max(minAttenuation, Math.min(1.0, minAttenuation + (1.0 - minAttenuation) * 2.0 * decay));
}

/**
 * Builds the EGCP v4 graph representation.
 *
 * @param {Object} graph - Pre-change AST graph { components, relationships }
 * @param {Map<string, number>|Object} historyCounts - Pairwise co-change counts (j > c)
 * @param {Object} [config] - EGCP v4 configuration options
 * @param {string} [editOperation] - Optional classified edit operation category
 * @param {string} [seedId] - Optional seed component ID for gated op weights
 * @param {number} [seedEvoSupport] - Seed's total direct co-change support
 * @returns {Object} Graph topology, in-degrees, transition structures, and graph entropy
 */
export function buildEGCPv4Graph(
  graph,
  historyCounts = null,
  config = EGCP_V4_DEFAULT_CONFIG,
  editOperation = null,
  seedId = null,
  seedEvoSupport = 0
) {
  const components = graph.components || [];
  const relationships = graph.relationships || [];

  const nodes = components.map(c => c.id);
  const nodeIndex = new Map();
  nodes.forEach((id, idx) => nodeIndex.set(id, idx));

  const N = nodes.length;

  // 1. Initial raw in-degree calculation across relationships
  const rawInDegree = new Uint32Array(N);
  for (const rel of relationships) {
    const toId = rel.target || rel.targetId || rel.toId || rel.to;
    const toIdx = nodeIndex.get(toId);
    if (toIdx !== undefined) {
      rawInDegree[toIdx]++;
    }
  }

  // Calculate Graph In-Degree Entropy (Ablation A)
  const graphEntropy = computeGraphInDegreeEntropy(rawInDegree);

  // Progressive Hub Exclusion parameters (Ablation B)
  const enableHubExcl = Boolean(config.enableProgressiveHubExclusion);
  const hubPercentile = config.hubPercentileThreshold ?? EGCP_V4_DEFAULT_CONFIG.hubPercentileThreshold;
  const hubThreshold = enableHubExcl ? computePercentile(rawInDegree, hubPercentile) : Infinity;
  const hubSlope = config.hubAttenuationSlope ?? EGCP_V4_DEFAULT_CONFIG.hubAttenuationSlope;
  const hubMinAtten = config.hubMinAttenuation ?? EGCP_V4_DEFAULT_CONFIG.hubMinAttenuation;

  // Gated Operation-Aware Multipliers (Ablation C)
  let opMultipliers = null;
  if (config.enableGatedOperationWeights && editOperation) {
    const sparseThreshold = config.sparseEvoThreshold ?? EGCP_V4_DEFAULT_CONFIG.sparseEvoThreshold;
    const isLogic = seedId ? isBusinessLogicComponent(seedId) : true;
    const isSparse = seedEvoSupport <= sparseThreshold;

    // Gate: Apply op-aware multipliers only if evolutionary support is sparse AND component is logic
    if (isSparse && isLogic && config.gatedOpMultipliers && config.gatedOpMultipliers[editOperation]) {
      opMultipliers = config.gatedOpMultipliers[editOperation];
    }
  }

  // 2. Structural Adjacency and Final In-Degree
  const structAdj = Array.from({ length: N }, () => []);
  const structInDegree = new Uint32Array(N);

  const baseEdgeWeights = { ...EGCP_V4_DEFAULT_CONFIG.structuralEdgeWeights, ...(config.structuralEdgeWeights || {}) };
  const revFactor = config.reverseEdgeWeightFactor ?? EGCP_V4_DEFAULT_CONFIG.reverseEdgeWeightFactor;
  const defWeight = config.defaultStructuralWeight ?? EGCP_V4_DEFAULT_CONFIG.defaultStructuralWeight;

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

      // Ablation B: Apply progressive hub attenuation on incoming edges into target hubs
      if (enableHubExcl && rawInDegree[toIdx] > hubThreshold) {
        const atten = computeHubAttenuation(rawInDegree[toIdx], hubThreshold, hubSlope, hubMinAtten);
        w *= atten;
      }

      // Forward edge: from -> to
      structAdj[fromIdx].push({ to: toIdx, weight: w });
      structInDegree[toIdx]++;

      // Reverse edge: to -> from (scaled)
      if (revFactor > 0) {
        let revW = w * revFactor;
        if (enableHubExcl && rawInDegree[fromIdx] > hubThreshold) {
          const revAtten = computeHubAttenuation(rawInDegree[fromIdx], hubThreshold, hubSlope, hubMinAtten);
          revW *= revAtten;
        }
        structAdj[toIdx].push({ to: fromIdx, weight: revW });
        structInDegree[fromIdx]++;
      }
    }
  }

  // Deduplicate and consolidate structural transition probabilities
  const structTrans = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const edgeMap = new Map();
    for (const e of structAdj[i]) {
      edgeMap.set(e.to, (edgeMap.get(e.to) || 0) + e.weight);
    }
    const merged = Array.from(edgeMap.entries()).map(([to, weight]) => ({ to: Number(to), weight }));
    structAdj[i] = merged;

    const sumW = merged.reduce((s, e) => s + e.weight, 0);
    if (sumW > 0) {
      structTrans[i] = merged.map(e => ({ to: e.to, prob: e.weight / sumW }));
    } else {
      structTrans[i] = [];
    }
  }

  // 3. Evolutionary Adjacency and In-Degree (Identical to v2/v3)
  const evoAdj = Array.from({ length: N }, () => []);
  const evoInDegree = new Uint32Array(N);
  const evoTrans = Array.from({ length: N }, () => []);

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

  // Deduplicate and consolidate evolutionary transitions
  for (let i = 0; i < N; i++) {
    const edgeMap = new Map();
    for (const e of evoAdj[i]) {
      edgeMap.set(e.to, (edgeMap.get(e.to) || 0) + e.count);
    }
    const merged = Array.from(edgeMap.entries()).map(([to, count]) => ({ to: Number(to), count }));
    evoAdj[i] = merged;

    const sumC = merged.reduce((s, e) => s + e.count, 0);
    if (sumC > 0) {
      evoTrans[i] = merged.map(e => ({ to: e.to, prob: e.count / sumC }));
    } else {
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
    graphEntropy,
    hubThreshold,
    editOperation
  };
}
