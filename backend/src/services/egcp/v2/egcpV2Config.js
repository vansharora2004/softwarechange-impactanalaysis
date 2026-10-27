/**
 * egcpV2Config.js
 * ---------------
 * Configuration options and hyperparameters for EGCP v2 (Evolutionary-Graph Change Propagation v2).
 *
 * Grounded in empirical diagnosis of EGCP v1:
 *   1. In-degree hub discounting (gamma): normalizes stationary probability by node in-degree.
 *   2. Decoupled dual-channel mixing (beta): combines independent structural and evolutionary
 *      random-walk lifts rather than forcing them into a single diluted transition matrix.
 *   3. Recency decay (lambda): exponentially weights recent historical revisions.
 *   4. Strict convergence and dangling node teleportation to restart vector.
 */

'use strict';

export const EGCP_V2_DEFAULT_CONFIG = {
  // Damping factor for Random Walk with Restart (1 - restart_probability)
  dampingFactor: 0.85,

  // In-degree discount exponent (gamma) for hub mitigation:
  // S_norm(u) = p*(u) / (d_in(u) + 1)^gamma
  // gamma = 0.0 -> Raw stationary probability (EGCP v1 behavior)
  // gamma = 0.75 -> Sublinear degree normalization (Standard recommendation)
  // gamma = 1.0 -> Full PageRank-to-degree ratio
  degreeDiscountExponent: 0.75,

  // Channel mixing weight (beta):
  // S_v2(u) = beta * S_evo_norm(u) + (1 - beta) * S_struct_norm(u)
  // beta = 1.0 -> Pure evolutionary diffusion (Evo-Only)
  // beta = 0.0 -> Pure structural diffusion (Struct-Only)
  // beta = 0.60 -> Balanced dual-channel fusion with evolutionary priority
  channelMixingBeta: 0.60,

  // Maximum power iteration steps
  maxIterations: 50,

  // L1 convergence threshold for power iteration
  convergenceTolerance: 1e-4,

  // Structural edge weights by relationship type
  structuralEdgeWeights: {
    EXTENDS: 1.0,
    IMPLEMENTS: 0.9,
    DEPENDS_ON: 0.8,
    USES: 0.7,
    REFERENCES: 0.5,
    TESTS: 0.4
  },

  // Reverse edge scaling factor (caller notification)
  // Reduced to 0.35 in v2 to prevent reverse energy feedback to global hubs
  reverseEdgeWeightFactor: 0.35,

  // Fallback structural weight when relationship type is unrecognized
  defaultStructuralWeight: 0.50,

  // Minimum support threshold for evolutionary edges (pairs with <= minSupport are dropped)
  minEvoSupport: 1,

  // Exponential recency decay parameter (per-commit distance decay):
  // weight = count * exp(-recencyLambda * deltaCommits)
  // Set to 0 to disable recency weighting
  recencyLambda: 0.0
};
