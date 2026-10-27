/**
 * occpSmoothedModel.js
 * --------------------
 * Experimental Variant 1: Laplace / Additive Smoothed OCCP Model.
 *
 * Replaces unregularized empirical frequency:
 *   confidence(o, p) = positive(o, p) / total(o, p)
 * with Laplace/additive smoothing:
 *   confidence_smooth(o, p; lambda) = (positive(o, p) + lambda) / (total(o, p) + 2 * lambda)
 *
 * Properties:
 *   - Configurable lambda >= 0 (default: 0.5; tested at 0.1, 0.5, 1.0).
 *   - When lambda = 0, exactly reproduces empirical MLE.
 *   - When lambda > 0, shrinks low-sample estimates towards 0.5 (Bayesian Beta(lambda, lambda) prior).
 *   - Strictly leak-free, preserves identical candidate universe and fallback hierarchy.
 */

'use strict';

/**
 * Computes smoothed probability given positive count, total count, and lambda.
 *
 * @param {number} positive - Positive co-change occurrences
 * @param {number} total - Total path traversal opportunities
 * @param {number} lambda - Smoothing parameter (lambda >= 0)
 * @returns {number} Smoothed probability in [0, 1]
 */
export function computeSmoothedProbability(positive, total, lambda = 0.5) {
  if (total <= 0) return 0;
  if (lambda <= 0) return positive / total;
  return (positive + lambda) / (total + 2 * lambda);
}

/**
 * Ranks structural candidates using Laplace-smoothed OCCP.
 *
 * @param {Array<Object>} structuralCandidates - Candidates from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Changed seed component ID
 * @param {Object} sourceOpClass - Output of classifyOperation on source component
 * @param {Map<string, Array<Object>>} candidatePathsMap - candidateId -> Array<PathInfo>
 * @param {Map<string, Object>} conditionedPathStats - `${cat}|${sig}` -> { positive, total }
 * @param {Map<string, Object>} genericPathStats - signature -> { positive, total }
 * @param {Map<string, number>|Object} historyCounts - Co-change pair counts
 * @param {number} lambda - Additive smoothing parameter (default: 0.5)
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModelB_OCCP_Smoothed(
  structuralCandidates,
  sourceId,
  sourceOpClass,
  candidatePathsMap,
  conditionedPathStats,
  genericPathStats,
  historyCounts = null,
  lambda = 0.5
) {
  const sourceCategories = (sourceOpClass?.detectedCategories && sourceOpClass.detectedCategories.length > 0)
    ? sourceOpClass.detectedCategories
    : [sourceOpClass?.primaryCategory || 'UNKNOWN_OR_MIXED'];

  const getCoChangeCount = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  const ranked = structuralCandidates.map(c => {
    const paths = candidatePathsMap.get(c.id) || [];
    const uniqueSigs = [...new Set(paths.map(p => p.signature))];

    // 1. Conditioned Evidence (o, p)
    let bestCondConf = -1;
    let bestCondPos = 0;
    let bestCondTot = 0;
    let bestCondSig = null;
    let bestCondCat = null;
    let hasConditionedSupport = false;

    for (const cat of sourceCategories) {
      for (const sig of uniqueSigs) {
        const condKey = `${cat}|${sig}`;
        const stat = conditionedPathStats.get(condKey);
        if (stat && stat.total > 0 && stat.positive > 0) {
          const conf = computeSmoothedProbability(stat.positive, stat.total, lambda);
          if (
            conf > bestCondConf ||
            (conf === bestCondConf && stat.positive > bestCondPos) ||
            (conf === bestCondConf && stat.positive === bestCondPos && stat.total > bestCondTot)
          ) {
            bestCondConf = conf;
            bestCondPos = stat.positive;
            bestCondTot = stat.total;
            bestCondSig = sig;
            bestCondCat = cat;
            hasConditionedSupport = true;
          }
        }
      }
    }

    // 2. Generic Path Evidence (p)
    let bestGenConf = -1;
    let bestGenPos = 0;
    let bestGenTot = 0;
    let bestGenSig = null;
    let hasGenericSupport = false;

    for (const sig of uniqueSigs) {
      const stat = genericPathStats.get(sig);
      if (stat && stat.total > 0 && stat.positive > 0) {
        const conf = computeSmoothedProbability(stat.positive, stat.total, lambda);
        if (
          conf > bestGenConf ||
          (conf === bestGenConf && stat.positive > bestGenPos) ||
          (conf === bestGenConf && stat.positive === bestGenPos && stat.total > bestGenTot)
        ) {
          bestGenConf = conf;
          bestGenPos = stat.positive;
          bestGenTot = stat.total;
          bestGenSig = sig;
          hasGenericSupport = true;
        }
      }
    }

    // 3. Co-Change count
    const coChange = getCoChangeCount(sourceId, c.id);
    const hasCoChange = coChange > 0;

    // Fallback level determination
    let fallbackLevel = 'structural_baseline';
    let rankTier = 4;

    if (hasConditionedSupport) {
      fallbackLevel = 'operation_conditioned';
      rankTier = 1;
    } else if (hasGenericSupport) {
      fallbackLevel = 'generic_path';
      rankTier = 2;
    } else if (hasCoChange) {
      fallbackLevel = 'historical_cochange';
      rankTier = 3;
    } else {
      fallbackLevel = 'structural_baseline';
      rankTier = 4;
    }

    return {
      ...c,
      occp_rankTier: rankTier,
      occp_fallbackLevel: fallbackLevel,
      occp_smoothingLambda: lambda,
      occp_hasConditionedSupport: hasConditionedSupport,
      occp_condConfidence: hasConditionedSupport ? bestCondConf : 0,
      occp_condPositive: bestCondPos,
      occp_condTotal: bestCondTot,
      occp_condCategory: bestCondCat,
      occp_condSignature: bestCondSig,

      occp_hasGenericSupport: hasGenericSupport,
      occp_genConfidence: hasGenericSupport ? bestGenConf : 0,
      occp_genPositive: bestGenPos,
      occp_genTotal: bestGenTot,
      occp_genSignature: bestGenSig,

      occp_coChangeCount: coChange
    };
  });

  // Strict OCCP ranking with smoothed confidences
  ranked.sort((a, b) => {
    // Tier comparison
    if (a.occp_rankTier !== b.occp_rankTier) {
      return a.occp_rankTier - b.occp_rankTier;
    }

    // Tier 1: Conditioned confidence -> positive -> total -> hop -> structRank -> ID
    if (a.occp_rankTier === 1) {
      if (b.occp_condConfidence !== a.occp_condConfidence) {
        return b.occp_condConfidence - a.occp_condConfidence;
      }
      if (b.occp_condPositive !== a.occp_condPositive) {
        return b.occp_condPositive - a.occp_condPositive;
      }
      if (b.occp_condTotal !== a.occp_condTotal) {
        return b.occp_condTotal - a.occp_condTotal;
      }
      if (a.minHop !== b.minHop) {
        return a.minHop - b.minHop;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    // Tier 2: Generic confidence -> positive -> total -> hop -> structRank -> ID
    if (a.occp_rankTier === 2) {
      if (b.occp_genConfidence !== a.occp_genConfidence) {
        return b.occp_genConfidence - a.occp_genConfidence;
      }
      if (b.occp_genPositive !== a.occp_genPositive) {
        return b.occp_genPositive - a.occp_genPositive;
      }
      if (b.occp_genTotal !== a.occp_genTotal) {
        return b.occp_genTotal - a.occp_genTotal;
      }
      if (a.minHop !== b.minHop) {
        return a.minHop - b.minHop;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    // Tier 3: Co-change count -> structRank -> ID
    if (a.occp_rankTier === 3) {
      if (b.occp_coChangeCount !== a.occp_coChangeCount) {
        return b.occp_coChangeCount - a.occp_coChangeCount;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    // Tier 4: Structural baseline rank -> ID
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    return a.id.localeCompare(b.id);
  });

  ranked.forEach((c, idx) => {
    c.occp_smoothed_rank = idx + 1;
  });

  return ranked;
}
