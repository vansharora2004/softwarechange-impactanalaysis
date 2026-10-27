/**
 * occpEnhancedModel.js
 * --------------------
 * Enhanced OCCP Model integrating:
 *   1. Dominant Operation Classification: Resolves UNKNOWN_OR_MIXED when one category comprises >= 70% of diff hunks.
 *   2. Support-Aware Credibility Shrinkage: Scales path confidence by tot / (tot + kappa) to prevent single-observation noise from dominating.
 *   3. Continuous Multi-Channel Score Fusion: Smoothly combines conditioned paths, generic paths, historical co-change, and structural topology without rigid tier cliffs.
 *   4. Zero candidate dropping: strictly preserves candidate universe |C|.
 *   5. Deterministic tie-breaking.
 */

'use strict';

import { computeSmoothedProbability } from './occpSmoothedModel.js';
import { DEFAULT_FUSION_WEIGHTS } from './occpFusionModel.js';

export const ENHANCED_CONFIG = {
  lambda: 0.5,
  kappa: 2.0, // Support shrinkage factor
  dominanceRatio: 0.70, // 70% threshold for dominant operation
  weights: {
    w_cond: 0.35,
    w_gen: 0.15,
    w_hist: 0.35,
    w_struct: 0.15
  }
};

/**
 * Refines operation classification by determining dominant category when multiple categories are detected.
 *
 * @param {Object} opClass - Output of classifyOperation
 * @param {number} dominanceRatio - Minimum fraction of hunk lines to declare dominance (default: 0.70)
 * @returns {Object} Refined opClass with updated primaryCategory and isDominant flag
 */
export function resolveDominantOperation(opClass, dominanceRatio = 0.70) {
  if (!opClass || !opClass.hunkCounts) return opClass;
  if (opClass.primaryCategory !== 'UNKNOWN_OR_MIXED') return opClass;

  const counts = opClass.hunkCounts;
  const categories = Object.keys(counts).filter(k => counts[k] > 0);
  if (categories.length <= 1) return opClass;

  const totalLines = categories.reduce((sum, k) => sum + counts[k], 0);
  if (totalLines === 0) return opClass;

  // Find max category
  let maxCat = null;
  let maxCount = 0;
  for (const cat of categories) {
    if (counts[cat] > maxCount) {
      maxCount = counts[cat];
      maxCat = cat;
    }
  }

  if (maxCat && (maxCount / totalLines) >= dominanceRatio) {
    return {
      ...opClass,
      primaryCategory: maxCat,
      isDominant: true,
      dominanceFraction: maxCount / totalLines
    };
  }

  return opClass;
}

/**
 * Computes support-aware credibility factor: tot / (tot + kappa).
 *
 * @param {number} total - Total observations
 * @param {number} kappa - Shrinkage constant (default: 2.0)
 * @returns {number} Credibility multiplier in [0, 1]
 */
export function computeSupportWeight(total, kappa = 2.0) {
  if (total <= 0) return 0;
  return total / (total + kappa);
}

/**
 * Enhanced OCCP Ranking combining dominant operation resolution, support-aware shrinkage, and continuous fusion.
 *
 * @param {Array<Object>} structuralCandidates - Candidates from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Changed seed component ID
 * @param {Object} rawOpClass - Output of classifyOperation on source component
 * @param {Map<string, Array<Object>>} candidatePathsMap - candidateId -> Array<PathInfo>
 * @param {Map<string, Object>} conditionedPathStats - `${cat}|${sig}` -> { positive, total }
 * @param {Map<string, Object>} genericPathStats - signature -> { positive, total }
 * @param {Map<string, number>|Object} historyCounts - Co-change pair counts
 * @param {Object} config - { lambda, kappa, dominanceRatio, weights }
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModelB_OCCP_Enhanced(
  structuralCandidates,
  sourceId,
  rawOpClass,
  candidatePathsMap,
  conditionedPathStats,
  genericPathStats,
  historyCounts = null,
  config = ENHANCED_CONFIG
) {
  const {
    lambda = 0.5,
    kappa = 2.0,
    dominanceRatio = 0.70,
    weights = DEFAULT_FUSION_WEIGHTS
  } = config;

  // 1. Resolve dominant operation category
  const resolvedOpClass = resolveDominantOperation(rawOpClass, dominanceRatio);
  const sourceCategories = (resolvedOpClass?.detectedCategories && resolvedOpClass.detectedCategories.length > 0)
    ? resolvedOpClass.detectedCategories
    : [resolvedOpClass?.primaryCategory || 'UNKNOWN_OR_MIXED'];

  // Add primary dominant category to front of search list if present
  if (resolvedOpClass?.primaryCategory && !sourceCategories.includes(resolvedOpClass.primaryCategory)) {
    sourceCategories.unshift(resolvedOpClass.primaryCategory);
  }

  const getCoChangeCount = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  // Find max co-change count
  let maxCoChange = 0;
  for (const c of structuralCandidates) {
    const cc = getCoChangeCount(sourceId, c.id);
    if (cc > maxCoChange) maxCoChange = cc;
  }

  const scored = structuralCandidates.map(c => {
    const paths = candidatePathsMap.get(c.id) || [];
    const uniqueSigs = [...new Set(paths.map(p => p.signature))];

    // 1. Support-Aware Conditioned Path Score
    let bestCondScore = 0;
    let bestCondPos = 0;
    let bestCondTot = 0;
    let bestCondSig = null;
    let hasConditionedSupport = false;

    for (const cat of sourceCategories) {
      for (const sig of uniqueSigs) {
        const condKey = `${cat}|${sig}`;
        const stat = conditionedPathStats.get(condKey);
        if (stat && stat.total > 0 && stat.positive > 0) {
          const rawProb = computeSmoothedProbability(stat.positive, stat.total, lambda);
          const supportFactor = computeSupportWeight(stat.total, kappa);
          const score = rawProb * supportFactor;

          if (score > bestCondScore) {
            bestCondScore = score;
            bestCondPos = stat.positive;
            bestCondTot = stat.total;
            bestCondSig = sig;
            hasConditionedSupport = true;
          }
        }
      }
    }

    // 2. Support-Aware Generic Path Score
    let bestGenScore = 0;
    let bestGenPos = 0;
    let bestGenTot = 0;
    let bestGenSig = null;
    let hasGenericSupport = false;

    for (const sig of uniqueSigs) {
      const stat = genericPathStats.get(sig);
      if (stat && stat.total > 0 && stat.positive > 0) {
        const rawProb = computeSmoothedProbability(stat.positive, stat.total, lambda);
        const supportFactor = computeSupportWeight(stat.total, kappa);
        const score = rawProb * supportFactor;

        if (score > bestGenScore) {
          bestGenScore = score;
          bestGenPos = stat.positive;
          bestGenTot = stat.total;
          bestGenSig = sig;
          hasGenericSupport = true;
        }
      }
    }

    // 3. Historical Co-Change Score
    const coChange = getCoChangeCount(sourceId, c.id);
    const histScore = maxCoChange > 0 ? (coChange / maxCoChange) : 0;

    // 4. Structural Reciprocal Rank Score
    const structRank = c.structuralBaselineRank || 9999;
    const structScore = 1.0 / structRank;

    // Linear composite fusion score
    const fusionScore =
      (weights.w_cond * bestCondScore) +
      (weights.w_gen * bestGenScore) +
      (weights.w_hist * histScore) +
      (weights.w_struct * structScore);

    return {
      ...c,
      enhanced_fusion_score: fusionScore,
      enhanced_s_cond: bestCondScore,
      enhanced_s_gen: bestGenScore,
      enhanced_s_hist: histScore,
      enhanced_s_struct: structScore,
      enhanced_hasConditionedSupport: hasConditionedSupport,
      enhanced_condPositive: bestCondPos,
      enhanced_condTotal: bestCondTot,
      enhanced_condSignature: bestCondSig,
      enhanced_hasGenericSupport: hasGenericSupport,
      enhanced_genPositive: bestGenPos,
      enhanced_genTotal: bestGenTot,
      enhanced_coChangeCount: coChange,
      enhanced_primaryOp: resolvedOpClass.primaryCategory
    };
  });

  // Deterministic sorting
  scored.sort((a, b) => {
    // 1. Composite score descending
    if (b.enhanced_fusion_score !== a.enhanced_fusion_score) {
      return b.enhanced_fusion_score - a.enhanced_fusion_score;
    }
    // 2. Historical co-change score descending
    if (b.enhanced_s_hist !== a.enhanced_s_hist) {
      return b.enhanced_s_hist - a.enhanced_s_hist;
    }
    // 3. Shorter hop distance
    if (a.minHop !== b.minHop) {
      return a.minHop - b.minHop;
    }
    // 4. Better structural baseline rank
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    // 5. Alphabetical ID
    return a.id.localeCompare(b.id);
  });

  scored.forEach((c, idx) => {
    c.occp_enhanced_rank = idx + 1;
  });

  return scored;
}
