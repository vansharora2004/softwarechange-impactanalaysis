/**
 * egcpScorer.js
 * -------------
 * Ranks candidate components using stationary evolutionary energy distribution
 * with deterministic tie-breaking, preserving the exact candidate universe |C|.
 */

'use strict';

/**
 * Scores and ranks structural candidates based on propagated EGCP energy.
 *
 * @param {Array<Object>} structuralCandidates - Candidate universe from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Seed component ID
 * @param {Object} egcpGraph - Output of buildEGCPGraph { nodes, nodeIndex, ... }
 * @param {Float64Array} stationaryScores - Stationary distribution from propagateEvolutionaryEnergy
 * @param {Map<string, number>|Object} historyCounts - Historical co-change pair counts
 * @returns {Array<Object>} Ranked candidates with EGCP scores and ranks
 */
export function rankCandidatesWithEGCP(
  structuralCandidates,
  sourceId,
  egcpGraph,
  stationaryScores,
  historyCounts = null
) {
  const { nodeIndex } = egcpGraph;

  const getCoChange = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  const scored = structuralCandidates.map(c => {
    const idx = nodeIndex.get(c.id);
    const score = (idx !== undefined && stationaryScores) ? stationaryScores[idx] : 0.0;
    const directCoChange = getCoChange(sourceId, c.id);

    return {
      ...c,
      egcp_score: score,
      egcp_evoCoChange: directCoChange
    };
  });

  // Sort by deterministic EGCP hierarchy
  scored.sort((a, b) => {
    // 1. Stationary energy descending
    if (b.egcp_score !== a.egcp_score) {
      return b.egcp_score - a.egcp_score;
    }
    // 2. Direct evolutionary co-change descending
    if (b.egcp_evoCoChange !== a.egcp_evoCoChange) {
      return b.egcp_evoCoChange - a.egcp_evoCoChange;
    }
    // 3. Shorter structural hop distance
    if (a.minHop !== b.minHop) {
      return a.minHop - b.minHop;
    }
    // 4. Canonical structural baseline rank
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    // 5. Deterministic alphabetical component ID
    return a.id.localeCompare(b.id);
  });

  scored.forEach((c, idx) => {
    c.egcp_rank = idx + 1;
  });

  return scored;
}
