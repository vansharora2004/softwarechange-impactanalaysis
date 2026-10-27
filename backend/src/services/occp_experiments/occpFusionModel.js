/**
 * occpFusionModel.js
 * ------------------
 * Experimental Variant 3: Continuous Score Fusion Model.
 *
 * Eliminates rigid ordinal tier barriers (Tier 1 > Tier 2 > Tier 3 > Tier 4)
 * by combining normalized signals from all four evidence channels into a continuous score:
 *
 * S_fusion(c) = w_cond * S_cond(c) + w_gen * S_gen(c) + w_hist * S_hist(c) + w_struct * S_struct(c)
 *
 * Signal definitions (each normalized in [0, 1]):
 *   1. S_cond(c): Smoothed probability (pos + lambda) / (total + 2*lambda) if positive > 0, else 0
 *   2. S_gen(c):  Smoothed probability (pos + lambda) / (total + 2*lambda) if positive > 0, else 0
 *   3. S_hist(c): coChange(source, c) / max_cand(coChange) if max > 0, else 0
 *   4. S_struct(c): 1.0 / structuralBaselineRank(c)
 *
 * Default weights:
 *   w_cond = 0.35, w_gen = 0.15, w_hist = 0.35, w_struct = 0.15 (sum = 1.0)
 *
 * Preserves identical candidate universe (0 candidates dropped), strictly leak-free.
 */

'use strict';

import { computeSmoothedProbability } from './occpSmoothedModel.js';

export const DEFAULT_FUSION_WEIGHTS = {
  w_cond: 0.35,
  w_gen: 0.15,
  w_hist: 0.35,
  w_struct: 0.15
};

export const EQUAL_AVERAGE_FUSION_WEIGHTS = {
  w_cond: 0.25,
  w_gen: 0.25,
  w_hist: 0.25,
  w_struct: 0.25
};

/**
 * Ranks structural candidates using continuous multi-channel score fusion.
 *
 * @param {Array<Object>} structuralCandidates - Candidates from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Changed seed component ID
 * @param {Object} sourceOpClass - Output of classifyOperation on source component
 * @param {Map<string, Array<Object>>} candidatePathsMap - candidateId -> Array<PathInfo>
 * @param {Map<string, Object>} conditionedPathStats - `${cat}|${sig}` -> { positive, total }
 * @param {Map<string, Object>} genericPathStats - signature -> { positive, total }
 * @param {Map<string, number>|Object} historyCounts - Co-change pair counts
 * @param {Object} weights - Channel weights { w_cond, w_gen, w_hist, w_struct }
 * @param {number} lambda - Smoothing parameter for path probabilities (default: 0.5)
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModelB_OCCP_ContinuousFusion(
  structuralCandidates,
  sourceId,
  sourceOpClass,
  candidatePathsMap,
  conditionedPathStats,
  genericPathStats,
  historyCounts = null,
  weights = DEFAULT_FUSION_WEIGHTS,
  lambda = 0.5
) {
  const {
    w_cond = 0.35,
    w_gen = 0.15,
    w_hist = 0.35,
    w_struct = 0.15
  } = weights;

  const sourceCategories = (sourceOpClass?.detectedCategories && sourceOpClass.detectedCategories.length > 0)
    ? sourceOpClass.detectedCategories
    : [sourceOpClass?.primaryCategory || 'UNKNOWN_OR_MIXED'];

  const getCoChangeCount = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  // Find max co-change count among candidates for normalization
  let maxCoChange = 0;
  for (const c of structuralCandidates) {
    const cc = getCoChangeCount(sourceId, c.id);
    if (cc > maxCoChange) maxCoChange = cc;
  }

  const scored = structuralCandidates.map(c => {
    const paths = candidatePathsMap.get(c.id) || [];
    const uniqueSigs = [...new Set(paths.map(p => p.signature))];

    // 1. Conditioned Path Score
    let bestCondScore = 0;
    let bestCondPos = 0;
    let bestCondTot = 0;
    let hasConditionedSupport = false;

    for (const cat of sourceCategories) {
      for (const sig of uniqueSigs) {
        const condKey = `${cat}|${sig}`;
        const stat = conditionedPathStats.get(condKey);
        if (stat && stat.total > 0 && stat.positive > 0) {
          const s = computeSmoothedProbability(stat.positive, stat.total, lambda);
          if (s > bestCondScore) {
            bestCondScore = s;
            bestCondPos = stat.positive;
            bestCondTot = stat.total;
            hasConditionedSupport = true;
          }
        }
      }
    }

    // 2. Generic Path Score
    let bestGenScore = 0;
    let bestGenPos = 0;
    let bestGenTot = 0;
    let hasGenericSupport = false;

    for (const sig of uniqueSigs) {
      const stat = genericPathStats.get(sig);
      if (stat && stat.total > 0 && stat.positive > 0) {
        const s = computeSmoothedProbability(stat.positive, stat.total, lambda);
        if (s > bestGenScore) {
          bestGenScore = s;
          bestGenPos = stat.positive;
          bestGenTot = stat.total;
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

    // Linear composite score
    const fusionScore =
      (w_cond * bestCondScore) +
      (w_gen * bestGenScore) +
      (w_hist * histScore) +
      (w_struct * structScore);

    return {
      ...c,
      fusion_score: fusionScore,
      fusion_s_cond: bestCondScore,
      fusion_s_gen: bestGenScore,
      fusion_s_hist: histScore,
      fusion_s_struct: structScore,
      occp_hasConditionedSupport: hasConditionedSupport,
      occp_condPositive: bestCondPos,
      occp_condTotal: bestCondTot,
      occp_hasGenericSupport: hasGenericSupport,
      occp_genPositive: bestGenPos,
      occp_genTotal: bestGenTot,
      occp_coChangeCount: coChange
    };
  });

  // Sort by continuous fusion score
  scored.sort((a, b) => {
    // 1. Highest composite score
    if (b.fusion_score !== a.fusion_score) {
      return b.fusion_score - a.fusion_score;
    }
    // 2. Higher co-change score
    if (b.fusion_s_hist !== a.fusion_s_hist) {
      return b.fusion_s_hist - a.fusion_s_hist;
    }
    // 3. Shorter hop distance
    if (a.minHop !== b.minHop) {
      return a.minHop - b.minHop;
    }
    // 4. Better structural baseline rank
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    // 5. Deterministic tie-break
    return a.id.localeCompare(b.id);
  });

  scored.forEach((c, idx) => {
    c.fusion_rank = idx + 1;
  });

  return scored;
}

/**
 * Simplified CSF Model:
 * Replaces the unequal weights (0.35, 0.15, 0.35, 0.15) with an unweighted equal average:
 *   S_CSF(c) = (S_cond(c) + S_gen(c) + S_hist(c) + S_struct(c)) / 4
 *
 * All four constituent signals are confirmed in [0, 1]:
 *   - S_cond: Smoothed conditional path probability in [0, 1]
 *   - S_gen: Smoothed generic path probability in [0, 1]
 *   - S_hist: Normalized co-change frequency in [0, 1]
 *   - S_struct: Reciprocal structural baseline rank (1.0 / rank) in (0, 1]
 */
export function rankModel_CSF_EqualAverage(
  structuralCandidates,
  sourceId,
  sourceOpClass,
  candidatePathsMap,
  conditionedPathStats,
  genericPathStats,
  historyCounts = null,
  lambda = 0.5
) {
  return rankModelB_OCCP_ContinuousFusion(
    structuralCandidates,
    sourceId,
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    EQUAL_AVERAGE_FUSION_WEIGHTS,
    lambda
  );
}

