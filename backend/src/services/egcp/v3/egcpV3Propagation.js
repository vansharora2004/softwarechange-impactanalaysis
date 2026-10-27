/**
 * egcpV3Propagation.js
 * --------------------
 * High-performance power iteration engine for Personalized Random Walk with Restart.
 * Includes degree-normalized lift scoring and proper dangling node teleportation.
 */

'use strict';

import { EGCP_V3_DEFAULT_CONFIG } from './egcpV3Config.js';

/**
 * Propagates energy through a precomputed transition structure via Random Walk with Restart.
 *
 * @param {Array<Array<{to: number, prob: number}>>} transitions - Precomputed transition probabilities per node
 * @param {number|number[]} seedIndices - Changed seed indices
 * @param {number} N - Total node count
 * @param {Object} [options] - Propagation options
 * @returns {{ stationaryScores: Float64Array, iterations: number, converged: boolean, residual: number }}
 */
export function propagateChannelEnergy(transitions, seedIndices, N, options = {}) {
  if (N === 0) {
    return {
      stationaryScores: new Float64Array(0),
      iterations: 0,
      converged: true,
      residual: 0
    };
  }

  const d = options.dampingFactor ?? EGCP_V3_DEFAULT_CONFIG.dampingFactor;
  const maxIter = options.maxIterations ?? EGCP_V3_DEFAULT_CONFIG.maxIterations;
  const tol = options.convergenceTolerance ?? EGCP_V3_DEFAULT_CONFIG.convergenceTolerance;

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
    const uniform = 1.0 / N;
    for (let i = 0; i < N; i++) e[i] = uniform;
  }

  // Initial probability vector: p^(0) = e
  let p = new Float64Array(e);
  let pNext = new Float64Array(N);

  let converged = false;
  let iter = 0;
  let residual = 0;

  for (iter = 0; iter < maxIter; iter++) {
    pNext.fill(0);

    // Sum probability mass at dangling nodes (nodes with no outgoing transitions)
    let danglingSum = 0;
    for (let u = 0; u < N; u++) {
      const trans = transitions[u];
      if (!trans || trans.length === 0) {
        danglingSum += p[u];
      } else {
        const p_u = p[u];
        for (let j = 0; j < trans.length; j++) {
          pNext[trans[j].to] += p_u * trans[j].prob;
        }
      }
    }

    // Apply damping factor d and distribute dangling mass + restart mass
    // p_next = d * (P^T * p + danglingSum * e) + (1 - d) * e
    const teleportMass = d * danglingSum + (1 - d);
    let diff = 0;

    for (let i = 0; i < N; i++) {
      pNext[i] = d * pNext[i] + teleportMass * e[i];
      diff += Math.abs(pNext[i] - p[i]);
    }

    residual = diff;
    p.set(pNext);

    if (diff < tol) {
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

/**
 * Computes degree-discounted lift scores from stationary distribution.
 *
 * @param {Float64Array} stationaryScores - Stationary probability distribution
 * @param {Uint32Array} inDegrees - Node in-degrees for discounting
 * @param {number} gamma - Discount exponent (gamma = 0: raw stationary, gamma = 1: PageRank lift)
 * @returns {Float64Array} Lift scores
 */
export function computeDegreeDiscountedLift(stationaryScores, inDegrees, gamma) {
  const N = stationaryScores.length;
  const lift = new Float64Array(N);

  if (!stationaryScores || N === 0) return lift;

  if (gamma <= 0.0) {
    lift.set(stationaryScores);
    return lift;
  }

  for (let i = 0; i < N; i++) {
    const deg = inDegrees ? (inDegrees[i] || 0) : 0;
    const denom = Math.pow(1.0 + deg, gamma);
    lift[i] = stationaryScores[i] / denom;
  }

  return lift;
}
