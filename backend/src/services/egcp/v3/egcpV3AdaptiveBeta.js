/**
 * egcpV3AdaptiveBeta.js
 * ---------------------
 * Computes a leak-free dynamic channel fusion parameter (beta_adaptive) for EGCP v3.
 *
 * Grounded in Bayesian evidence balancing:
 *   - The evolutionary channel represents empirical co-change likelihood.
 *   - The structural channel represents static syntactic dependency reachability.
 *   - When historical co-change evidence is sparse or absent (cold-start / utility library),
 *     beta shifts toward the structural channel (beta -> minAdaptiveBeta).
 *   - When historical co-change evidence is rich and mature (established enterprise service),
 *     beta shifts toward the evolutionary channel (beta -> maxAdaptiveBeta).
 *
 * Properties:
 *   - Purely pre-change: Computed strictly using historical counts from commits j > c
 *     and structural edges at c^1.
 *   - Zero project hardcoding: Dependent only on topological and historical evidence metrics.
 *   - Transparent, smooth, monotonically non-decreasing in historical support.
 */

'use strict';

import { EGCP_V3_DEFAULT_CONFIG } from './egcpV3Config.js';

/**
 * Calculates adaptive beta for a given seed component.
 *
 * @param {string} seedId - Changed seed component identifier
 * @param {Map<string, number>|Object} historyCounts - Pairwise co-change counts (j > c only)
 * @param {Object} [egcpGraph] - Precomputed EGCP v3 graph structure
 * @param {Object} [config] - EGCP v3 configuration options
 * @returns {{ beta: number, evoDegree: number, evoSupport: number, structDegree: number, formula: string }}
 */
export function computeAdaptiveBeta(seedId, historyCounts = null, egcpGraph = null, config = EGCP_V3_DEFAULT_CONFIG) {
  const tau = config.adaptiveTau ?? EGCP_V3_DEFAULT_CONFIG.adaptiveTau;
  const minBeta = config.minAdaptiveBeta ?? EGCP_V3_DEFAULT_CONFIG.minAdaptiveBeta;
  const maxBeta = config.maxAdaptiveBeta ?? EGCP_V3_DEFAULT_CONFIG.maxAdaptiveBeta;
  const staticBeta = config.channelMixingBeta ?? EGCP_V3_DEFAULT_CONFIG.channelMixingBeta;

  if (!config.enableAdaptiveBeta) {
    return {
      beta: staticBeta,
      evoDegree: 0,
      evoSupport: 0,
      structDegree: 0,
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

  // 2. Calculate Seed Pre-Change Structural Degree (Commit c^1)
  let structDegree = 0;
  if (egcpGraph && egcpGraph.nodeIndex && egcpGraph.structInDegree) {
    const idx = egcpGraph.nodeIndex.get(seedId);
    if (idx !== undefined) {
      const inDeg = egcpGraph.structInDegree[idx] || 0;
      const outDeg = (egcpGraph.structTrans && egcpGraph.structTrans[idx])
        ? egcpGraph.structTrans[idx].length
        : 0;
      structDegree = inDeg + outDeg;
    }
  }

  // 3. Monotonic Adaptive Formulation
  // Evidence weight d_evo balances against prior scale tau
  // beta_raw = evoSupport / (evoSupport + tau)
  let rawBeta = minBeta;
  if (evoSupport > 0) {
    rawBeta = evoSupport / (evoSupport + tau);
  }

  // Clamp within configured limits [minBeta, maxBeta]
  const clampedBeta = Math.max(minBeta, Math.min(maxBeta, rawBeta));

  return {
    beta: clampedBeta,
    evoDegree,
    evoSupport,
    structDegree,
    formula: `beta = clamp(${rawBeta.toFixed(4)}, ${minBeta}, ${maxBeta}) [evoSupport=${evoSupport}, tau=${tau}]`
  };
}
