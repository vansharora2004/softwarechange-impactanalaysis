/**
 * egcpV3Scorer.js
 * ---------------
 * Ranks candidate components using decoupled dual-channel degree-discounted lift scores,
 * dynamic channel weighting, and optional stereotype entity dampening.
 * Enforces deterministic tie-breaking and 100% candidate universe preservation.
 */

'use strict';

import { EGCP_V3_DEFAULT_CONFIG } from './egcpV3Config.js';

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
 * Scores and deterministically ranks candidate components for EGCP v3.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Seed component ID
 * @param {Map<string, number>} nodeIndex - Component ID to graph node index mapping
 * @param {Float64Array} structLift - Degree-discounted structural lift scores
 * @param {Float64Array} evoLift - Degree-discounted evolutionary lift scores
 * @param {number} effectiveBeta - Balanced channel fusion weight (from static or adaptive computation)
 * @param {Map<string, number>|Object} historyCounts - Direct co-change counts
 * @param {Object} [config] - Scoring configuration options
 * @returns {Array<Object>} Ranked candidates with EGCP v3 scores and ranks
 */
export function rankCandidatesWithEGCPv3(
  structuralCandidates,
  sourceId,
  nodeIndex,
  structLift,
  evoLift,
  effectiveBeta,
  historyCounts = null,
  config = EGCP_V3_DEFAULT_CONFIG
) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  const beta = effectiveBeta !== undefined ? effectiveBeta : (config.channelMixingBeta ?? EGCP_V3_DEFAULT_CONFIG.channelMixingBeta);

  const getCoChange = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  const seedIsLogic = isBusinessLogicComponent(sourceId);
  const dampeningEnabled = Boolean(config.enableStereotypeDampening && seedIsLogic);
  const dampeningFactor = config.entityDampeningFactor ?? EGCP_V3_DEFAULT_CONFIG.entityDampeningFactor;

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

    // Fused v3 score
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
      egcp_v3_score: compositeScore,
      egcp_v3_structScore: normStruct,
      egcp_v3_evoScore: normEvo,
      egcp_v3_evoCoChange: directCoChange,
      egcp_v3_betaUsed: beta
    };
  });

  // 3. Deterministic tie-breaking hierarchy (Identical to EGCP v2)
  scored.sort((a, b) => {
    // 1. Highest composite score descending
    if (Math.abs(b.egcp_v3_score - a.egcp_v3_score) > 1e-12) {
      return b.egcp_v3_score - a.egcp_v3_score;
    }
    // 2. Higher direct evolutionary co-change descending
    if (b.egcp_v3_evoCoChange !== a.egcp_v3_evoCoChange) {
      return b.egcp_v3_evoCoChange - a.egcp_v3_evoCoChange;
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
    egcp_v3_rank: idx + 1
  }));
}
