/**
 * egcpV3Config.js
 * ---------------
 * Configuration specifications for Evolutionary-Graph Change Propagation v3 (EGCP v3).
 *
 * Base configuration matches EGCP v2 Main identically.
 * Supports three decoupled, isolated, and configurable ablations:
 *   1. Adaptive channel weighting (beta_adaptive) based purely on pre-change graph topology & historical support.
 *   2. Operation-aware edge weighting conditioned on pre-change git diff classification.
 *   3. Stereotype/entity dampening for passive data model sink nodes.
 */

'use strict';

export const EGCP_V3_DEFAULT_CONFIG = {
  // ── Random Walk & Diffusion Parameters ────────────────────────────────────
  dampingFactor: 0.85,              // Damping factor d = 0.85 (restart probability = 0.15)
  maxIterations: 50,                // Power iteration upper bound
  convergenceTolerance: 1e-4,       // L1 convergence threshold

  // ── In-Degree Hub Discounting ──────────────────────────────────────────────
  degreeDiscountExponent: 0.75,     // gamma: S_lift(v) = S_stationary(v) / (1 + inDegree(v))^gamma

  // ── Base Channel Mixing ───────────────────────────────────────────────────
  channelMixingBeta: 0.60,          // Default static beta: S_composite = beta * S_evo + (1 - beta) * S_struct

  // ── Ablation 1: Adaptive Channel Weighting (beta_adaptive) ─────────────────
  enableAdaptiveBeta: false,        // When true, dynamically balances beta per-case
  adaptiveTau: 10.0,                // Prior support scale: beta = d_evo / (d_evo + tau)
  minAdaptiveBeta: 0.10,            // Floor to preserve minimum multi-channel participation
  maxAdaptiveBeta: 0.95,            // Ceiling to retain basic structural grounding

  // ── Ablation 2: Operation-Aware Edge Weighting ─────────────────────────────
  enableOperationAwareWeights: false, // When true, adjusts structural edge weights based on edit operation
  operationWeightMultipliers: {
    METHOD_SIGNATURE_OR_DECLARATION: {
      CALLS: 1.5,
      IMPLEMENTS: 1.5,
      EXTENDS: 1.3,
      TESTS: 1.2,
      REFERENCES: 0.8,
      USES: 0.8
    },
    METHOD_BODY_OR_IMPLEMENTATION: {
      TESTS: 1.5,
      CALLS: 1.1,
      IMPLEMENTS: 1.0,
      EXTENDS: 1.0,
      REFERENCES: 0.7
    },
    FIELD_OR_DATA_SHAPE: {
      USES: 1.5,
      REFERENCES: 1.3,
      CALLS: 1.2,
      TESTS: 1.0
    },
    TYPE_OR_INHERITANCE: {
      EXTENDS: 1.6,
      IMPLEMENTS: 1.6,
      CALLS: 1.2,
      TESTS: 1.2
    },
    ADD_DELETE_OR_RENAME: {
      CALLS: 1.3,
      EXTENDS: 1.3,
      IMPLEMENTS: 1.3,
      TESTS: 1.3
    },
    UNKNOWN_OR_MIXED: {}
  },

  // ── Ablation 3: Stereotype / Entity Dampening ──────────────────────────────
  enableStereotypeDampening: false,  // When true, dampens passive data model hubs
  entityDampeningFactor: 0.25,      // Multiplier applied to entity/model candidates when seed is active logic

  // ── Structural Edge Weights (Identical to EGCP v2) ────────────────────────
  structuralEdgeWeights: {
    EXTENDS: 1.0,
    IMPLEMENTS: 0.9,
    DEPENDS_ON: 0.8,
    USES: 0.7,
    REFERENCES: 0.5,
    TESTS: 0.4
  },
  defaultStructuralWeight: 0.50,
  reverseEdgeWeightFactor: 0.35,     // Bidirectional information flow scaling

  // ── Evolutionary Co-Change Edge Weights ───────────────────────────────────
  minEvoSupport: 1                  // Minimum co-change frequency threshold
};
