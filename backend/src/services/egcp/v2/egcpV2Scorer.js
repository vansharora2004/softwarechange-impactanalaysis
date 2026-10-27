/**
 * egcpV2Scorer.js
 * ---------------
 * Ranks candidate components using decoupled dual-channel degree-discounted lift scores.
 * Enforces deterministic tie-breaking and 100% candidate universe preservation.
 */

'use strict';

import { EGCP_V2_DEFAULT_CONFIG } from './egcpV2Config.js';

/**
 * Scores and deterministically ranks candidate components for EGCP v2.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Seed component ID
 * @param {Map<string, number>} nodeIndex - Component ID to graph node index mapping
 * @param {Float64Array} structLift - Degree-discounted structural lift scores
 * @param {Float64Array} evoLift - Degree-discounted evolutionary lift scores
 * @param {Map<string, number>|Object} historyCounts - Direct co-change counts
 * @param {Object} [config] - Scoring configuration options
 * @returns {Array<Object>} Ranked candidates with EGCP v2 scores and ranks
 */
export function rankCandidatesWithEGCPv2(
  structuralCandidates,
  sourceId,
  nodeIndex,
  structLift,
  evoLift,
  historyCounts = null,
  config = EGCP_V2_DEFAULT_CONFIG
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const beta = config.channelMixingBeta ?? EGCP_V2_DEFAULT_CONFIG.channelMixingBeta;

  const getCoChange = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  // 1. Compute raw lift scores for all candidates in universe
  let maxStructLift = 0.0;
  let maxEvoLift = 0.0;

  const candidateScores = structuralCandidates.map(c => {
    const idx = nodeIndex.get(c.id);
    const sLift = (idx !== undefined && structLift) ? structLift[idx] : 0.0;
    const eLift = (idx !== undefined && evoLift) ? evoLift[idx] : 0.0;
    const directCoChange = getCoChange(sourceId, c.id);

    if (sLift > maxStructLift) maxStructLift = sLift;
    if (eLift > maxEvoLift) maxEvoLift = eLift;

    return {
      candidate: c,
      sLift,
      eLift,
      directCoChange
    };
  });

  // 2. Normalize channel lifts relative to candidate universe maximums and combine
  const scored = candidateScores.map(({ candidate, sLift, eLift, directCoChange }) => {
    const normStruct = maxStructLift > 0 ? sLift / maxStructLift : 0.0;
    const normEvo = maxEvoLift > 0 ? eLift / maxEvoLift : 0.0;

    // Fused v2 score
    let compositeScore = 0.0;
    if (beta >= 1.0) {
      compositeScore = normEvo;
    } else if (beta <= 0.0) {
      compositeScore = normStruct;
    } else {
      compositeScore = (beta * normEvo) + ((1.0 - beta) * normStruct);
    }

    return {
      ...candidate,
      egcp_v2_score: compositeScore,
      egcp_v2_structScore: normStruct,
      egcp_v2_evoScore: normEvo,
      egcp_v2_evoCoChange: directCoChange
    };
  });

  // 3. Deterministic tie-breaking hierarchy
  scored.sort((a, b) => {
    // 1. Highest composite score descending
    if (Math.abs(b.egcp_v2_score - a.egcp_v2_score) > 1e-12) {
      return b.egcp_v2_score - a.egcp_v2_score;
    }
    // 2. Higher direct evolutionary co-change descending
    if (b.egcp_v2_evoCoChange !== a.egcp_v2_evoCoChange) {
      return b.egcp_v2_evoCoChange - a.egcp_v2_evoCoChange;
    }
    // 3. Shorter structural hop distance ascending
    if (a.minHop !== b.minHop) {
      return a.minHop - b.minHop;
    }
    // 4. Canonical structural baseline rank ascending
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    // 5. Deterministic alphabetical component ID
    return a.id.localeCompare(b.id);
  });

  scored.forEach((c, idx) => {
    c.egcp_v2_rank = idx + 1;
  });

  return scored;
}
