/**
 * egcpV4AdaptiveBeta.js
 * ---------------------
 * Computes a leak-free dynamic channel fusion parameter (beta_adaptive) for EGCP v4
 * using pre-change graph-entropy-scaled prior support (Ablation A).
 *
 * Mathematical formulation:
 *   1. Calculate normalized Shannon entropy of structural in-degree distribution H_norm:
 *      - p_i = inDegree(v_i) / sum(inDegree)
 *      - H = - sum(p_i * ln(p_i))
 *      - H_norm = H / ln(N) (normalized to [0, 1])
 *   2. When H_norm is high (balanced, decentralized connectivity):
 *      - Static structural paths are reliable across the whole graph.
 *      - Prior support scale tau increases: tau = baseTau + tauScale * H_norm
 *      - This keeps beta closer to the structural channel unless evolutionary support is vast.
 *   3. When H_norm is low (centralized, heavy hub dominance like Shopizer):
 *      - Static structural paths are noisy and leak into giant sinks.
 *      - Prior support scale tau decreases: tau = baseTau
 *      - Low evolutionary support is sufficient to shift weight to the evolutionary channel.
 *
 * Guarantees:
 *   - Strictly pre-change: Structural graph is at c^1, history is strictly j > c.
 *   - Purely topological & historical: Zero project names or hardcoded thresholds.
 */

'use strict';

import { EGCP_V4_DEFAULT_CONFIG } from './egcpV4Config.js';

/**
 * Computes normalized Shannon entropy of in-degree distribution.
 *
 * @param {Uint32Array|Array<number>} inDegrees
 * @returns {number} Normalized entropy in [0, 1]
 */
export function computeGraphInDegreeEntropy(inDegrees) {
  if (!inDegrees || inDegrees.length <= 1) return 1.0;

  const N = inDegrees.length;
  let totalDeg = 0;
  for (let i = 0; i < N; i++) {
    totalDeg += inDegrees[i];
  }

  if (totalDeg === 0) return 1.0;

  let entropy = 0.0;
  for (let i = 0; i < N; i++) {
    const deg = inDegrees[i];
    if (deg > 0) {
      const p = deg / totalDeg;
      entropy -= p * Math.log(p);
    }
  }

  const maxEntropy = Math.log(N);
  if (maxEntropy <= 0) return 1.0;

  const normEntropy = entropy / maxEntropy;
  return Math.max(0.0, Math.min(1.0, normEntropy));
}

/**
 * Calculates adaptive beta for a given seed component in EGCP v4.
 *
 * @param {string} seedId - Changed seed component identifier
 * @param {Map<string, number>|Object} historyCounts - Pairwise co-change counts (j > c only)
 * @param {Object} [egcpGraph] - Precomputed EGCP v4 graph structure
 * @param {Object} [config] - EGCP v4 configuration options
 * @returns {{ beta: number, evoDegree: number, evoSupport: number, structDegree: number, tau: number, entropy: number, formula: string }}
 */
export function computeAdaptiveBetaV4(seedId, historyCounts = null, egcpGraph = null, config = EGCP_V4_DEFAULT_CONFIG) {
  const minBeta = config.minAdaptiveBeta ?? EGCP_V4_DEFAULT_CONFIG.minAdaptiveBeta;
  const maxBeta = config.maxAdaptiveBeta ?? EGCP_V4_DEFAULT_CONFIG.maxAdaptiveBeta;
  const staticBeta = config.channelMixingBeta ?? EGCP_V4_DEFAULT_CONFIG.channelMixingBeta;

  if (!config.enableEntropyAdaptiveBeta) {
    return {
      beta: staticBeta,
      evoDegree: 0,
      evoSupport: 0,
      structDegree: 0,
      tau: 10.0,
      entropy: 1.0,
      formula: 'static'
    };
  }

  // 1. Calculate Seed Historical Evolutionary Support (Commits j > c)
  let evoDegree = 0;
  let evoSupport = 0;

  if (historyCounts) {
    const entries = historyCounts instanceof Map
      ? Array.from(historyCounts.entries())
      : Object.entries(historyCounts);

    for (const [key, count] of entries) {
      if (!count || count <= 0) continue;
      const parts = key.split('|');
      if (parts.length === 2 && (parts[0] === seedId || parts[1] === seedId)) {
        evoDegree++;
        evoSupport += count;
      }
    }
  }

  // 2. Structural Degree and Graph In-Degree Entropy (at c^1)
  let structDegree = 0;
  let normEntropy = 0.5; // Neutral default

  if (egcpGraph) {
    if (egcpGraph.graphEntropy !== undefined) {
      normEntropy = egcpGraph.graphEntropy;
    } else if (egcpGraph.structInDegree) {
      normEntropy = computeGraphInDegreeEntropy(egcpGraph.structInDegree);
    }

    if (egcpGraph.nodeIndex && egcpGraph.structInDegree) {
      const idx = egcpGraph.nodeIndex.get(seedId);
      if (idx !== undefined) {
        const inDeg = egcpGraph.structInDegree[idx] || 0;
        const outDeg = (egcpGraph.structTrans && egcpGraph.structTrans[idx])
          ? egcpGraph.structTrans[idx].length
          : 0;
        structDegree = inDeg + outDeg;
      }
    }
  }

  // 3. Topology-Aware Dynamic Tau Scaling
  const baseTau = config.entropyBaseTau ?? EGCP_V4_DEFAULT_CONFIG.entropyBaseTau;
  const tauScale = config.entropyTauScale ?? EGCP_V4_DEFAULT_CONFIG.entropyTauScale;
  const effectiveTau = baseTau + (tauScale * normEntropy);

  // 4. Bayesian balance formula
  let rawBeta = minBeta;
  if (evoSupport > 0) {
    rawBeta = evoSupport / (evoSupport + effectiveTau);
  }

  const clampedBeta = Math.max(minBeta, Math.min(maxBeta, rawBeta));

  return {
    beta: clampedBeta,
    evoDegree,
    evoSupport,
    structDegree,
    tau: effectiveTau,
    entropy: normEntropy,
    formula: `beta = clamp(${rawBeta.toFixed(4)}, ${minBeta}, ${maxBeta}) [evoSupport=${evoSupport}, tau=${effectiveTau.toFixed(2)}, entropy=${normEntropy.toFixed(3)}]`
  };
}
