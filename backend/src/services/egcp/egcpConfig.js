/**
 * egcpConfig.js
 * -------------
 * Configuration parameters for Evolutionary-Graph Change Propagation (EGCP).
 */

'use strict';

export const EGCP_DEFAULT_CONFIG = {
  // Damping factor for Random Walk with Restart (1 - restart_probability)
  dampingFactor: 0.85,

  // Structural vs. Evolutionary mixing ratio:
  // alpha = 1.0 -> Pure structural diffusion
  // alpha = 0.0 -> Pure evolutionary co-change diffusion
  // alpha = 0.5 -> Balanced dual-channel diffusion
  alpha: 0.50,

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

  // Reverse edge scaling factor (changes propagate back to callers)
  reverseEdgeWeightFactor: 0.50,

  // Fallback structural weight when relationship type is unrecognized
  defaultStructuralWeight: 0.50
};
