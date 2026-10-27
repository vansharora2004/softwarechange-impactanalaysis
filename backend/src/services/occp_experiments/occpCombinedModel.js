/**
 * occpCombinedModel.js
 * --------------------
 * Combined Experimental Variant: Smoothed Probabilities + Minimum Support Threshold.
 *
 * Integrates Laplace smoothing with threshold filtering:
 *   1. Threshold gate: only considers conditioned or generic paths with total >= minSupport.
 *   2. Smoothed probability: computes (pos + lambda) / (total + 2 * lambda) for eligible paths.
 *   3. If candidate meets threshold for conditioned paths -> Tier 1.
 *      Else if meets threshold for generic paths -> Tier 2.
 *      Else if coChange > 0 -> Tier 3.
 *      Else -> Tier 4 (structural baseline).
 */

'use strict';

import { computeSmoothedProbability } from './occpSmoothedModel.js';

export function rankModelB_OCCP_Combined(
  structuralCandidates,
  sourceId,
  sourceOpClass,
  candidatePathsMap,
  conditionedPathStats,
  genericPathStats,
  historyCounts = null,
  options = { lambda: 0.5, minSupport: 2 }
) {
  const { lambda = 0.5, minSupport = 2 } = options;

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

    // 1. Conditioned Evidence (o, p) with total >= minSupport and pos > 0
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
        if (stat && stat.total >= minSupport && stat.positive > 0) {
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

    // 2. Generic Path Evidence (p) with total >= minSupport and pos > 0
    let bestGenConf = -1;
    let bestGenPos = 0;
    let bestGenTot = 0;
    let bestGenSig = null;
    let hasGenericSupport = false;

    for (const sig of uniqueSigs) {
      const stat = genericPathStats.get(sig);
      if (stat && stat.total >= minSupport && stat.positive > 0) {
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
      occp_combinedOptions: { lambda, minSupport },
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

  ranked.sort((a, b) => {
    if (a.occp_rankTier !== b.occp_rankTier) {
      return a.occp_rankTier - b.occp_rankTier;
    }

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

    if (a.occp_rankTier === 3) {
      if (b.occp_coChangeCount !== a.occp_coChangeCount) {
        return b.occp_coChangeCount - a.occp_coChangeCount;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    return a.id.localeCompare(b.id);
  });

  ranked.forEach((c, idx) => {
    c.occp_combined_rank = idx + 1;
  });

  return ranked;
}
