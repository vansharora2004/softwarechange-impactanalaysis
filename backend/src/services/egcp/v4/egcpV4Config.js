/**
 * egcpV4Config.js
 * ---------------
 * Configuration for Evolutionary-Graph Change Propagation v4 (EGCP v4).
 *
 * Base parameters are identical to v3/v2 for compatibility.
 * Three new, decoupled v4 ablations are introduced:
 *
 *   A. Graph-Entropy Adaptive Beta
 *      - Replaces the fixed tau=10.0 in v3 with a topology-aware tau computed from
 *        the structural graph's in-degree entropy. High-entropy (bushy, balanced) graphs
 *        get a higher tau (trust structure more), low-entropy (sparse, hub-dominated)
 *        graphs get a lower tau (trust evolutionary history more).
 *      - Strictly pre-change: uses only the c^1 AST graph and j>c history.
 *
 *   B. Progressive Hub Exclusion
 *      - Nodes whose in-degree exceeds a configurable percentile threshold are
 *        progressively attenuated in the structural transition matrix (not removed).
 *        Attenuation follows a sigmoid curve centered on the threshold.
 *      - Strictly pre-change: based only on c^1 graph topology.
 *      - The same threshold applies to all projects; no project-specific rules.
 *
 *   C. Evidence-Gated Operation-Aware Weights
 *      - Operation-aware edge multipliers are applied ONLY when both conditions hold:
 *        (a) The seed has sparse evolutionary support (evoSupport <= sparseEvoThreshold)
 *        (b) The seed is classified as business-logic (service/controller/handler)
 *      - When both conditions hold, op-aware weighting is effectively a "structural
 *        chain boost for cold-start logic nodes."
 *      - This avoids hurting Commons Lang (abundant evo evidence → multipliers suppressed).
 *
 * Combinations:
 *   - v4_entropy_beta: A only
 *   - v4_hub_excl: B only
 *   - v4_gated_op: C only
 *   - v4_entropy_hub: A + B
 *   - v4_combined: A + B + C (full v4)
 */

'use strict';

export const EGCP_V4_DEFAULT_CONFIG = {
  // ── Random Walk & Diffusion Parameters (identical to v2/v3) ───────────────
  dampingFactor: 0.85,
  maxIterations: 50,
  convergenceTolerance: 1e-4,

  // ── In-Degree Hub Discounting (identical to v2/v3) ─────────────────────────
  degreeDiscountExponent: 0.75,

  // ── Base Channel Mixing (identical to v2/v3 static) ────────────────────────
  channelMixingBeta: 0.60,

  // ── Ablation A: Graph-Entropy Adaptive Beta ────────────────────────────────
  enableEntropyAdaptiveBeta: false,
  // Tau scaling: tau_effective = baseTau * (1 + entropyScale * graphEntropy)
  // graphEntropy = normalized Shannon entropy of in-degree distribution ∈ [0, 1]
  // High entropy (balanced): higher tau → trust structure; Low entropy (hub): lower tau → trust evo
  entropyBaseTau: 5.0,          // Minimum tau when graph is maximally hub-dominated (entropy → 0)
  entropyTauScale: 20.0,        // Additional tau added for max entropy graphs
  minAdaptiveBeta: 0.10,        // Floor on beta
  maxAdaptiveBeta: 0.95,        // Ceiling on beta

  // ── Ablation B: Progressive Hub Exclusion ─────────────────────────────────
  enableProgressiveHubExclusion: false,
  // Nodes above hubPercentileThreshold get structural probability attenuated
  // via: weight_eff = w * sigmoid_attenuation(inDegree, threshold, slope)
  hubPercentileThreshold: 0.90,   // Top 10% in-degree nodes considered "hubs"
  hubAttenuationSlope: 0.005,     // Slope of sigmoid curve at threshold
  hubMinAttenuation: 0.05,        // Floor on hub attenuation multiplier

  // ── Ablation C: Evidence-Gated Operation-Aware Weights ─────────────────────
  enableGatedOperationWeights: false,
  sparseEvoThreshold: 5.0,       // evoSupport <= this → "cold start" (apply op weights)
  // Op multipliers (conservative subset, only applied when gated conditions hold)
  gatedOpMultipliers: {
    METHOD_SIGNATURE_OR_DECLARATION: {
      CALLS: 1.4,
      IMPLEMENTS: 1.4,
      EXTENDS: 1.2,
      TESTS: 1.15
    },
    METHOD_BODY_OR_IMPLEMENTATION: {
      TESTS: 1.3,
      CALLS: 1.1
    },
    FIELD_OR_DATA_SHAPE: {
      USES: 1.3,
      REFERENCES: 1.2
    },
    TYPE_OR_INHERITANCE: {
      EXTENDS: 1.5,
      IMPLEMENTS: 1.5
    },
    ADD_DELETE_OR_RENAME: {
      CALLS: 1.2,
      EXTENDS: 1.2,
      IMPLEMENTS: 1.2
    },
    UNKNOWN_OR_MIXED: {}
  },

  // ── Structural Edge Weights (identical to v2/v3) ───────────────────────────
  structuralEdgeWeights: {
    EXTENDS: 1.0,
    IMPLEMENTS: 0.9,
    DEPENDS_ON: 0.8,
    USES: 0.7,
    REFERENCES: 0.5,
    TESTS: 0.4
  },
  defaultStructuralWeight: 0.50,
  reverseEdgeWeightFactor: 0.35,

  // ── Evolutionary Co-Change Edge Weights ───────────────────────────────────
  minEvoSupport: 1,

  // ── Entity Dampening (carry forward from v3, always enabled in v4 combined) ─
  enableStereotypeDampening: true,
  entityDampeningFactor: 0.25
};
