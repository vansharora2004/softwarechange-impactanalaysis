/**
 * egcpV4Scorer.js
 * ---------------
 * Ranks candidate components for EGCP v4 using decoupled dual-channel lift scores,
 * dynamic channel weighting, and optional stereotype entity dampening.
 * Enforces deterministic tie-breaking and 100% candidate universe preservation.
 */

'use strict';

import { EGCP_V4_DEFAULT_CONFIG } from './egcpV4Config.js';

function isDataEntityComponent(candidate) {
  if (!candidate) return false;
  if (candidate.type === 'Entity' || candidate.type === 'Model') return true;
  const id = candidate.id || candidate.name || '';
  return /\.(model|entity|entities)\./i.test(id) && !/(service|controller|repository|api|impl|test)/i.test(id);
}

function isBusinessLogicComponent(sourceId) {
  if (!sourceId) return false;
  return /(service|controller|api|manager|handler|resource|endpoint)/i.test(sourceId);
}

/**
 * Scores and deterministically ranks candidate components for EGCP v4.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Seed component ID
 * @param {Map<string, number>} nodeIndex - Component ID to graph node index mapping
 * @param {Float64Array} structLift - Degree-discounted structural lift scores
 * @param {Float64Array} evoLift - Degree-discounted evolutionary lift scores
 * @param {number} effectiveBeta - Balanced channel fusion weight
 * @param {Map<string, number>|Object} historyCounts - Direct co-change counts
 * @param {Object} [config] - Scoring configuration options
 * @returns {Array<Object>} Ranked candidates with EGCP v4 scores and ranks
 */
export function rankCandidatesWithEGCPv4(
  structuralCandidates,
  sourceId,
  nodeIndex,
  structLift,
  evoLift,
  effectiveBeta,
  historyCounts = null,
  config = EGCP_V4_DEFAULT_CONFIG
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const beta = effectiveBeta !== undefined ? effectiveBeta : (config.channelMixingBeta ?? EGCP_V4_DEFAULT_CONFIG.channelMixingBeta);

  const getCoChange = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  const seedIsLogic = isBusinessLogicComponent(sourceId);
  const dampeningEnabled = Boolean(config.enableStereotypeDampening && seedIsLogic);
  const dampeningFactor = config.entityDampeningFactor ?? EGCP_V4_DEFAULT_CONFIG.entityDampeningFactor;

  // 1. Compute raw lift scores for all candidates in universe
  let maxStructLift = 0.0;
  let maxEvoLift = 0.0;

  const candidateScores = structuralCandidates.map(c => {
    const idx = nodeIndex.get(c.id);
    let sLift = (idx !== undefined && structLift) ? structLift[idx] : 0.0;
    const eLift = (idx !== undefined && evoLift) ? evoLift[idx] : 0.0;
    const directCoChange = getCoChange(sourceId, c.id);

    // Apply Stereotype Entity Dampening if enabled
    if (dampeningEnabled && isDataEntityComponent(c)) {
      sLift *= dampeningFactor;
    }

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

    // Fused v4 score
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
      egcp_v4_score: compositeScore,
      egcp_v4_structScore: normStruct,
      egcp_v4_evoScore: normEvo,
      egcp_v4_evoCoChange: directCoChange,
      egcp_v4_betaUsed: beta
    };
  });

  // 3. Deterministic tie-breaking hierarchy
  scored.sort((a, b) => {
    // 1. Highest composite score descending
    if (Math.abs(b.egcp_v4_score - a.egcp_v4_score) > 1e-12) {
      return b.egcp_v4_score - a.egcp_v4_score;
    }
    // 2. Higher direct evolutionary co-change descending
    if (b.egcp_v4_evoCoChange !== a.egcp_v4_evoCoChange) {
      return b.egcp_v4_evoCoChange - a.egcp_v4_evoCoChange;
    }
    // 3. Shorter structural hop distance ascending
    if (a.minHop !== b.minHop) {
      return (a.minHop || 99) - (b.minHop || 99);
    }
    // 4. Canonical structural baseline rank ascending
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return (a.structuralBaselineRank || 9999) - (b.structuralBaselineRank || 9999);
    }
    // 5. Deterministic alphabetical component ID
    return a.id.localeCompare(b.id);
  });

  // Assign 1-indexed ranks
  return scored.map((c, idx) => ({
    ...c,
    egcp_v4_rank: idx + 1
  }));
}

/**
 * Simplified EGCP Scorer:
 * Uses Min-Max normalization for both evolutionary and structural channels across the candidate set,
 * handling the edge case where maximum equals minimum (safely returning 0.0 without division by zero).
 *
 * Then calculates the equal-importance combination without adaptive fusion weighting:
 *   S_EGCP(c) = S_evo_normalized(c) + S_struct_normalized(c)
 *
 * Enforces deterministic tie-breaking and 100% candidate universe preservation.
 *
 * @param {Array<Object>} structuralCandidates
 * @param {string} sourceId
 * @param {Map<string, number>} nodeIndex
 * @param {Float64Array} structLift
 * @param {Float64Array} evoLift
 * @param {Map<string, number>|Object} historyCounts
 * @param {Object} [config]
 * @returns {Array<Object>}
 */
export function rankCandidatesWithEGCP_SimplifiedMinMax(
  structuralCandidates,
  sourceId,
  nodeIndex,
  structLift,
  evoLift,
  historyCounts = null,
  config = EGCP_V4_DEFAULT_CONFIG
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const getCoChange = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  const seedIsLogic = isBusinessLogicComponent(sourceId);
  const dampeningEnabled = Boolean(config.enableStereotypeDampening && seedIsLogic);
  const dampeningFactor = config.entityDampeningFactor ?? EGCP_V4_DEFAULT_CONFIG.entityDampeningFactor;

  // 1. Compute raw lift scores and track min & max for Min-Max normalization
  let minStructLift = Infinity;
  let maxStructLift = -Infinity;
  let minEvoLift = Infinity;
  let maxEvoLift = -Infinity;

  const candidateScores = structuralCandidates.map(c => {
    const idx = nodeIndex.get(c.id);
    let sLift = (idx !== undefined && structLift) ? structLift[idx] : 0.0;
    const eLift = (idx !== undefined && evoLift) ? evoLift[idx] : 0.0;
    const directCoChange = getCoChange(sourceId, c.id);

    if (dampeningEnabled && isDataEntityComponent(c)) {
      sLift *= dampeningFactor;
    }

    if (sLift < minStructLift) minStructLift = sLift;
    if (sLift > maxStructLift) maxStructLift = sLift;
    if (eLift < minEvoLift) minEvoLift = eLift;
    if (eLift > maxEvoLift) maxEvoLift = eLift;

    return {
      candidate: c,
      sLift,
      eLift,
      directCoChange
    };
  });

  // Handle case where maximum equals minimum
  const structRange = maxStructLift - minStructLift;
  const evoRange = maxEvoLift - minEvoLift;

  // 2. Min-Max normalization across candidate set and unweighted combination:
  // S_EGCP(c) = S_evo_normalized(c) + S_struct_normalized(c)
  const scored = candidateScores.map(({ candidate, sLift, eLift, directCoChange }) => {
    const normStruct = structRange > 1e-12 ? (sLift - minStructLift) / structRange : 0.0;
    const normEvo = evoRange > 1e-12 ? (eLift - minEvoLift) / evoRange : 0.0;

    const compositeScore = normEvo + normStruct;

    return {
      ...candidate,
      egcp_v4_score: compositeScore,
      egcp_score: compositeScore,
      egcp_v4_structScore: normStruct,
      egcp_v4_evoScore: normEvo,
      egcp_structScore: normStruct,
      egcp_evoScore: normEvo,
      egcp_v4_evoCoChange: directCoChange,
      egcp_evoCoChange: directCoChange,
      egcp_model: 'simplified_minmax'
    };
  });

  // 3. Deterministic tie-breaking hierarchy
  scored.sort((a, b) => {
    // 1. Highest composite score descending
    if (Math.abs(b.egcp_v4_score - a.egcp_v4_score) > 1e-12) {
      return b.egcp_v4_score - a.egcp_v4_score;
    }
    // 2. Higher direct evolutionary co-change descending
    if (b.egcp_v4_evoCoChange !== a.egcp_v4_evoCoChange) {
      return b.egcp_v4_evoCoChange - a.egcp_v4_evoCoChange;
    }
    // 3. Shorter structural hop distance ascending
    if (a.minHop !== b.minHop) {
      return (a.minHop || 99) - (b.minHop || 99);
    }
    // 4. Canonical structural baseline rank ascending
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return (a.structuralBaselineRank || 9999) - (b.structuralBaselineRank || 9999);
    }
    // 5. Deterministic alphabetical component ID
    return a.id.localeCompare(b.id);
  });

  // Assign 1-indexed ranks
  return scored.map((c, idx) => ({
    ...c,
    egcp_v4_rank: idx + 1,
    egcp_rank: idx + 1
  }));
}

