/**
 * egcpV2Propagation.js
 * --------------------
 * High-performance power iteration engine for Personalized Random Walk with Restart.
 * Includes degree-normalized lift scoring and proper dangling node teleportation.
 */

'use strict';

import { EGCP_V2_DEFAULT_CONFIG } from './egcpV2Config.js';

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

  const d = options.dampingFactor ?? EGCP_V2_DEFAULT_CONFIG.dampingFactor;
  const maxIter = options.maxIterations ?? EGCP_V2_DEFAULT_CONFIG.maxIterations;
  const tol = options.convergenceTolerance ?? EGCP_V2_DEFAULT_CONFIG.convergenceTolerance;

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
    let danglingMass = 0;

    // 1. Transition push: p^(t) * P
    for (let i = 0; i < N; i++) {
      const p_i = p[i];
      if (p_i <= 1e-15) continue;

      const edges = transitions[i];
      const numEdges = edges.length;

      if (numEdges > 0) {
        for (let j = 0; j < numEdges; j++) {
          pNext[edges[j].to] += p_i * edges[j].prob;
        }
      } else {
        // Absorbing / dangling node: mass teleports back to restart vector
        danglingMass += p_i;
      }
    }

    // 2. Damping and Restart: p^(t+1) = d * [p Next + danglingMass * e] + (1 - d) * e
    const restartScale = (1.0 - d) + (d * danglingMass);
    let l1Diff = 0;

    for (let i = 0; i < N; i++) {
      const newVal = (d * pNext[i]) + (restartScale * e[i]);
      l1Diff += Math.abs(newVal - p[i]);
      pNext[i] = newVal;
    }

    residual = l1Diff;

    // Swap buffers
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

/**
 * Computes degree-discounted normalized lift scores for all nodes.
 *
 * @param {Float64Array} stationaryScores - Raw stationary probabilities p*(u)
 * @param {Uint32Array} inDegrees - Node in-degrees d_in(u)
 * @param {number} gamma - Degree discount exponent
 * @returns {Float64Array} Normalized lift scores
 */
export function computeDegreeDiscountedLift(stationaryScores, inDegrees, gamma = 0.75) {
  const N = stationaryScores.length;
  const lift = new Float64Array(N);

  if (gamma <= 0.0) {
    // Zero degree discounting: return raw stationary probability
    lift.set(stationaryScores);
    return lift;
  }

  for (let i = 0; i < N; i++) {
    const rawScore = stationaryScores[i];
    if (rawScore > 0) {
      const deg = inDegrees[i] || 0;
      const penalty = Math.pow(deg + 1.0, gamma);
      lift[i] = rawScore / penalty;
    }
  }

  return lift;
}
