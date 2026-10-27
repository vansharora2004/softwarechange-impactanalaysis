/**
 * egcpPropagation.js
 * ------------------
 * Implements deterministic Personalized Random Walk with Restart (Spreading Activation)
 * over the dual-channel evolutionary-structural graph.
 */

'use strict';

import { EGCP_DEFAULT_CONFIG } from './egcpConfig.js';

/**
 * Propagates change energy from seed node(s) through structural and evolutionary channels.
 *
 * @param {Object} egcpGraph - Output of buildEGCPGraph
 * @param {number|number[]} seedIndices - Index or array of indices of changed seed components
 * @param {Object} [options] - Propagation options overriding defaults
 * @returns {{ stationaryScores: Float64Array, iterations: number, converged: boolean, residual: number }}
 */
export function propagateEvolutionaryEnergy(egcpGraph, seedIndices, options = {}) {
  const { nodes, structAdj, evoAdj } = egcpGraph;
  const N = nodes.length;

  if (N === 0) {
    return {
      stationaryScores: new Float64Array(0),
      iterations: 0,
      converged: true,
      residual: 0
    };
  }

  const d = options.dampingFactor ?? EGCP_DEFAULT_CONFIG.dampingFactor;
  const alpha = options.alpha ?? EGCP_DEFAULT_CONFIG.alpha;
  const maxIter = options.maxIterations ?? EGCP_DEFAULT_CONFIG.maxIterations;
  const tol = options.convergenceTolerance ?? EGCP_DEFAULT_CONFIG.convergenceTolerance;

  // Format seed set
  const seeds = Array.isArray(seedIndices) ? seedIndices : [seedIndices];
  const validSeeds = seeds.filter(idx => idx >= 0 && idx < N);

  // Preference / Restart vector (normalized over seeds)
  const e = new Float64Array(N);
  if (validSeeds.length > 0) {
    const seedWeight = 1.0 / validSeeds.length;
    for (const s of validSeeds) {
      e[s] = seedWeight;
    }
  } else {
    // If no valid seeds, uniform preference
    const uniform = 1.0 / N;
    for (let i = 0; i < N; i++) e[i] = uniform;
  }

  // Precompute normalized transition probabilities for each node
  // trans[i] = Array<{ to: number, prob: number }>
  const trans = Array.from({ length: N }, () => []);

  for (let i = 0; i < N; i++) {
    const sEdges = structAdj[i];
    const eEdges = evoAdj[i];

    const sWeightSum = sEdges.reduce((sum, ed) => sum + ed.weight, 0);
    const eWeightSum = eEdges.reduce((sum, ed) => sum + ed.weight, 0);

    const hasStruct = sWeightSum > 0;
    const hasEvo = eWeightSum > 0;

    if (alpha >= 1.0) {
      // Pure structural ablation
      if (hasStruct) {
        trans[i] = sEdges.map(ed => ({ to: ed.to, prob: ed.weight / sWeightSum }));
      } else {
        trans[i] = [{ to: i, prob: 1.0 }];
      }
    } else if (alpha <= 0.0) {
      // Pure evolutionary ablation
      if (hasEvo) {
        trans[i] = eEdges.map(ed => ({ to: ed.to, prob: ed.weight / eWeightSum }));
      } else {
        trans[i] = [{ to: i, prob: 1.0 }];
      }
    } else {
      // Dual-channel diffusion (0 < alpha < 1)
      if (hasStruct && hasEvo) {
        const sFactor = alpha / sWeightSum;
        const eFactor = (1.0 - alpha) / eWeightSum;

        const probMap = new Map();
        for (const ed of sEdges) {
          probMap.set(ed.to, (probMap.get(ed.to) || 0) + ed.weight * sFactor);
        }
        for (const ed of eEdges) {
          probMap.set(ed.to, (probMap.get(ed.to) || 0) + ed.weight * eFactor);
        }
        trans[i] = Array.from(probMap.entries()).map(([to, prob]) => ({ to, prob }));
      } else if (hasStruct) {
        trans[i] = sEdges.map(ed => ({ to: ed.to, prob: ed.weight / sWeightSum }));
      } else if (hasEvo) {
        trans[i] = eEdges.map(ed => ({ to: ed.to, prob: ed.weight / eWeightSum }));
      } else {
        trans[i] = [{ to: i, prob: 1.0 }];
      }
    }
  }

  // Initial probability distribution: p^(0) = e
  let p = new Float64Array(e);
  let pNext = new Float64Array(N);

  let converged = false;
  let iter = 0;
  let residual = 0;

  for (iter = 0; iter < maxIter; iter++) {
    pNext.fill(0);

    // 1. Transition push: p^(t) * P
    for (let i = 0; i < N; i++) {
      const p_i = p[i];
      if (p_i <= 1e-15) continue;

      const edges = trans[i];
      for (let j = 0; j < edges.length; j++) {
        pNext[edges[j].to] += p_i * edges[j].prob;
      }
    }

    // 2. Damping & Restart: (1 - d) * e + d * (p * P)
    residual = 0;
    for (let i = 0; i < N; i++) {
      const newVal = (1.0 - d) * e[i] + d * pNext[i];
      residual += Math.abs(newVal - p[i]);
      pNext[i] = newVal;
    }

    // Swap arrays
    const temp = p;
    p = pNext;
    pNext = temp;

    if (residual < tol) {
      converged = true;
      iter++;
      break;
    }
  }

  return {
    stationaryScores: p,
    iterations: iter,
    converged,
    residual
  };
}
