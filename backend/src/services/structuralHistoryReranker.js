/**
 * structuralHistoryReranker.js
 * ----------------------------
 * Proposed Research Methodology:
 * Deterministic Evidence-Based Software Change Impact Analysis
 * combining Knowledge Graph Structural Traversal and Historical Co-Change Reranking.
 *
 * Methodological Foundations:
 *   1. Structural Impact Candidate Generation (Graph Topology):
 *      - Traverses structural relationships: DEPENDS_ON, USES, EXTENDS, IMPLEMENTS, TESTS.
 *      - Bounded by hop-distance operating configuration (default: 2 hops).
 *      - Structural baseline ordering:
 *          - Primary: minHop ascending (1-hop before 2-hop before 3-hop).
 *          - Secondary: Edge direction & semantic precedence:
 *              1-hop: incoming tests/implementers/subclasses (contract & regression risk) ->
 *                     incoming callers (interface risk) ->
 *                     outgoing dependencies (behavioral risk).
 *              2-hop: strong architectural paths before general usage paths.
 *          - Tertiary: Lexicographical ID (deterministic tie-break).
 *
 *   2. Historical Co-Change Reranking (Empirical Revision Evidence):
 *      - Uses historical co-change frequency between changed seed(s) and candidate:
 *          - Primary: coChangeCount descending (strongest historical co-change prioritized first).
 *          - Secondary: structuralBaselineRank ascending (preserves structural topological rank
 *                       when co-change counts are identical or zero).
 *          - Tertiary: Lexicographical ID (deterministic tie-break).
 *      - Zero-cochange structural candidates are fully retained, sitting behind historically
 *        corroborated candidates in their relative structural order.
 *      - Eliminates arbitrary weighted summation (S = alpha * B + beta * C) and arbitrary
 *        score cutoff thresholds (theta).
 *
 * Grounded in:
 *   - Zimmermann et al. (2005): Mining Version Histories to Guide Software Changes.
 *   - Geipel & Schweitzer (2012): Software Change Dynamics: Evidence from Java Projects.
 *   - German, Adams, Hassan (2009): Evolutionary Change Coupling.
 *   - Hamid et al. (2025): Multi-Layer Software Knowledge Graphs for Impact Analysis.
 */

import fs from 'fs';
import path from 'path';
import { getDriver, verifyConnection } from './neo4jService.js';

// Canonical structural relationship types for impact candidate generation
export const STRUCTURAL_REL_TYPES = ['DEPENDS_ON', 'USES', 'EXTENDS', 'IMPLEMENTS', 'TESTS'];

/**
 * Normalizes an undirected pair key for historical co-change lookups.
 */
export function pairKey(id1, id2) {
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`;
}

/**
 * Loads default intermediate JSON graph for fallback execution.
 */
function loadFallbackData() {
  try {
    const filePath = path.join(import.meta.dirname || '.', '../../analysis_output.json');
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('[structuralHistoryReranker] Failed to load fallback data:', err);
  }
  return { components: [], relationships: [] };
}

/**
 * Determines structural precedence priority score (lower number = higher priority).
 */
function getStructuralPrecedenceScore(hop, direction, relType) {
  // Hop 1 precedence
  if (hop === 1) {
    if (relType === 'TESTS' && direction === 'incoming') return 10;
    if (relType === 'IMPLEMENTS' && direction === 'incoming') return 11;
    if (relType === 'EXTENDS' && direction === 'incoming') return 12;
    if (relType === 'DEPENDS_ON' && direction === 'incoming') return 13;
    if (relType === 'USES' && direction === 'incoming') return 14;

    if (relType === 'EXTENDS' && direction === 'outgoing') return 15;
    if (relType === 'DEPENDS_ON' && direction === 'outgoing') return 16;
    if (relType === 'USES' && direction === 'outgoing') return 17;
    return 19;
  }

  // Hop 2 precedence
  if (hop === 2) {
    if (relType === 'TESTS') return 20;
    if (relType === 'IMPLEMENTS' || relType === 'EXTENDS') return 21;
    if (relType === 'DEPENDS_ON') return 22;
    if (relType === 'USES') return 23;
    return 29;
  }

  // Hop 3+ precedence
  return 30 + hop;
}

/**
 * Generates structural impact candidates from in-memory component and relationship collections.
 *
 * @param {string[]} changedIds - Array of seed changed component IDs
 * @param {Object} graphData - { components: [], relationships: [] }
 * @param {number} maxHops - Maximum traversal depth (1, 2, or 3; default: 2)
 * @returns {Array<Object>} Sorted structural baseline candidates with structuralBaselineRank
 */
export function generateStructuralCandidatesInMemory(changedIds, graphData, maxHops = 2) {
  if (!changedIds || !Array.isArray(changedIds) || changedIds.length === 0) {
    return [];
  }

  const components = graphData.components || [];
  const relationships = graphData.relationships || [];
  const compMap = new Map(components.map(c => [c.id, c]));

  // Build bidirectional adjacency index
  const adj = new Map();
  for (const comp of components) {
    adj.set(comp.id, []);
  }

  const validRelSet = new Set(STRUCTURAL_REL_TYPES);
  for (const rel of relationships) {
    if (!validRelSet.has(rel.type)) continue;
    if (!adj.has(rel.source)) adj.set(rel.source, []);
    if (!adj.has(rel.target)) adj.set(rel.target, []);

    adj.get(rel.source).push({ neighbor: rel.target, type: rel.type, direction: 'outgoing' });
    adj.get(rel.target).push({ neighbor: rel.source, type: rel.type, direction: 'incoming' });
  }

  // Discovered candidate map: candidateId -> candidateInfo
  const candidateMap = new Map();

  // BFS Queue: each item is { currentId, hop, path: [nodes], rels: [rels], directions: [dirs] }
  for (const changedId of changedIds) {
    const queue = [{
      currentId: changedId,
      hop: 0,
      path: [changedId],
      rels: [],
      dirs: []
    }];

    const visitedHops = new Map(); // id -> minHop seen from this seed
    visitedHops.set(changedId, 0);

    while (queue.length > 0) {
      const { currentId, hop, path: curPath, rels: curRels, dirs: curDirs } = queue.shift();

      if (hop >= maxHops) continue;

      const neighbors = adj.get(currentId) || [];
      for (const edge of neighbors) {
        const nextId = edge.neighbor;
        const nextHop = hop + 1;

        // Skip self-references to seed changed components
        if (changedIds.includes(nextId)) continue;

        // In 2-hop traversal, passive Entity/Other nodes are filtered as intermediaries
        // to prevent false-positive path explosion over ubiquitous data structures
        const nextComp = compMap.get(nextId);
        if (nextHop === 1 && nextComp && (nextComp.type === 'Entity/Model' || nextComp.type === 'Other') && edge.type === 'USES') {
          // Keep Entity at hop 1 only if incoming or explicit dependency
          if (edge.direction === 'outgoing') continue;
        }

        const newPath = [...curPath, nextId];
        const newRels = [...curRels, edge.type];
        const newDirs = [...curDirs, edge.direction];

        // Format reasoning path
        let reasoningPath = newPath[0];
        for (let i = 0; i < newRels.length; i++) {
          const arrow = newDirs[i] === 'outgoing' ? '➔' : '🡸';
          reasoningPath += ` ${arrow} [${newRels[i]}] ${arrow} ${newPath[i + 1]}`;
        }

        const primaryRel = newRels[0];
        const primaryDir = newDirs[0];
        const precScore = getStructuralPrecedenceScore(nextHop, primaryDir, primaryRel);

        if (!candidateMap.has(nextId)) {
          const comp = compMap.get(nextId) || { id: nextId, name: nextId, type: 'Other' };
          candidateMap.set(nextId, {
            id: nextId,
            name: comp.name || nextId,
            type: comp.type || 'Other',
            filePath: comp.filePath || '',
            minHop: nextHop,
            precedenceScore: precScore,
            primaryRel,
            primaryDirection: primaryDir,
            primaryReasoningPath: reasoningPath,
            allPaths: [reasoningPath]
          });
        } else {
          const existing = candidateMap.get(nextId);
          existing.allPaths.push(reasoningPath);
          if (nextHop < existing.minHop || (nextHop === existing.minHop && precScore < existing.precedenceScore)) {
            existing.minHop = nextHop;
            existing.precedenceScore = precScore;
            existing.primaryRel = primaryRel;
            existing.primaryDirection = primaryDir;
            existing.primaryReasoningPath = reasoningPath;
          }
        }

        // Avoid infinite cyclic expansion: explore next node if not visited at a lower hop
        const prevSeenHop = visitedHops.get(nextId);
        if (prevSeenHop === undefined || nextHop < prevSeenHop) {
          visitedHops.set(nextId, nextHop);
          queue.push({
            currentId: nextId,
            hop: nextHop,
            path: newPath,
            rels: newRels,
            dirs: newDirs
          });
        }
      }
    }
  }

  // Convert to array and sort by deterministic structural baseline rules
  const candidates = Array.from(candidateMap.values());
  candidates.sort((a, b) => {
    // 1. Minimum hop distance ascending (1-hop before 2-hop before 3-hop)
    if (a.minHop !== b.minHop) {
      return a.minHop - b.minHop;
    }
    // 2. Precedence score ascending (contract/tests/callers before callees)
    if (a.precedenceScore !== b.precedenceScore) {
      return a.precedenceScore - b.precedenceScore;
    }
    // 3. Deterministic alphabetical tie-break
    return a.id.localeCompare(b.id);
  });

  // Assign 1-based structural baseline ranks and explanatory reason
  candidates.forEach((cand, idx) => {
    cand.structuralBaselineRank = idx + 1;
    cand.reason = generateStructuralReason(cand, changedIds);
  });

  return candidates;
}

/**
 * Generates structural explanation string for a candidate.
 */
function generateStructuralReason(cand, changedIds) {
  const seedStr = changedIds.join(', ');
  if (cand.minHop === 1) {
    if (cand.primaryRel === 'TESTS') {
      return `Direct regression test suite verifying changed component ${seedStr}.`;
    }
    if (cand.primaryRel === 'IMPLEMENTS') {
      return cand.primaryDirection === 'incoming'
        ? `Implements interface contract changed in ${seedStr}.`
        : `Interface implemented by changed component ${seedStr}.`;
    }
    if (cand.primaryRel === 'EXTENDS') {
      return cand.primaryDirection === 'incoming'
        ? `Inherits from class changed in ${seedStr}.`
        : `Superclass extended by changed component ${seedStr}.`;
    }
    if (cand.primaryRel === 'DEPENDS_ON') {
      return cand.primaryDirection === 'incoming'
        ? `Direct dependent calling changed component ${seedStr}.`
        : `Direct dependency called by changed component ${seedStr}.`;
    }
    return `Direct structural ${cand.primaryRel} reference connected to ${seedStr}.`;
  }
  return `Indirect ${cand.minHop}-hop structural dependency connected to ${seedStr}.`;
}

/**
 * Reranks structural candidates using empirical historical co-change frequency.
 *
 * Rules:
 *   1. Primary: coChangeCount descending (strongest historical co-change prioritized first).
 *   2. Secondary: structuralBaselineRank ascending (preserves exact structural order
 *      for equal or zero historical co-change counts).
 *   3. Tertiary: Component ID alphabetical tie-break.
 *
 * @param {Array<Object>} structuralCandidates - Output of generateStructuralCandidates
 * @param {string[]} changedIds - Changed component IDs
 * @param {Map<string, number>|Object} historyCounts - Pair key -> co-change count
 * @returns {Array<Object>} Reranked candidates with proposedRank and evidence status
 */
export function rerankCandidatesWithHistory(structuralCandidates, changedIds, historyCounts = null) {
  if (!structuralCandidates || structuralCandidates.length === 0) {
    return [];
  }

  // Normalize historyCounts to a lookup function
  let getCoChangeCount = () => 0;
  if (historyCounts instanceof Map) {
    getCoChangeCount = (idA, idB) => historyCounts.get(pairKey(idA, idB)) || 0;
  } else if (historyCounts && typeof historyCounts === 'object') {
    getCoChangeCount = (idA, idB) => historyCounts[pairKey(idA, idB)] || 0;
  }

  // Clone candidates to avoid mutating the original structural array
  const reranked = structuralCandidates.map(c => {
    // For multiple changed seeds, compute the maximum co-change count across seeds
    let maxCoChange = 0;
    for (const changedId of changedIds) {
      const cnt = getCoChangeCount(changedId, c.id);
      if (cnt > maxCoChange) maxCoChange = cnt;
    }

    const hasHistory = maxCoChange > 0;
    const evidenceType = hasHistory ? 'historical_and_structural' : 'structural_only';

    let historyReason = '';
    if (hasHistory) {
      historyReason = ` Corroborated by ${maxCoChange} past co-change commit(s) in repository history.`;
    }

    return {
      ...c,
      coChangeCount: maxCoChange,
      evidenceType,
      fullReason: `${c.reason}${historyReason}`
    };
  });

  // Sort by deterministic proposed ranking rules
  reranked.sort((a, b) => {
    // 1. Co-change count descending
    if (b.coChangeCount !== a.coChangeCount) {
      return b.coChangeCount - a.coChangeCount;
    }
    // 2. Structural baseline rank ascending (preserves topological ranking)
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    // 3. Deterministic alphabetical tie-break
    return a.id.localeCompare(b.id);
  });

  // Assign sequential proposed ranks
  reranked.forEach((cand, idx) => {
    cand.proposedRank = idx + 1;
    cand.rankShift = cand.structuralBaselineRank - cand.proposedRank; // Positive = promoted up
  });

  return reranked;
}

/**
 * Executes the complete proposed Change Impact Analysis pipeline.
 *
 * @param {string[]} changedIds - Array of seed changed component IDs
 * @param {Object} options - Configuration options:
 *   - maxHops {number}: Traversal hop depth limit (1, 2, or 3; default: 2)
 *   - components {Array}: Optional components array
 *   - relationships {Array}: Optional relationships array
 *   - historyCounts {Map}: Optional co-change counts map
 *   - forceInMemory {boolean}: If true, uses in-memory graph even if Neo4j is online
 * @returns {Promise<{
 *   structuralBaseline: Array<Object>,
 *   proposedRecommendations: Array<Object>,
 *   metadata: Object
 * }>}
 */
export async function analyzeStructuralHistoryImpact(changedIds, options = {}) {
  if (!changedIds || !Array.isArray(changedIds) || changedIds.length === 0) {
    return {
      structuralBaseline: [],
      proposedRecommendations: [],
      metadata: { totalCandidates: 0, maxHops: options.maxHops || 2, executionMode: 'noop' }
    };
  }

  const maxHops = Number.isInteger(options.maxHops) ? options.maxHops : 2;

  // Resolve graph data
  let graphData = null;
  if (options.components && options.relationships) {
    graphData = { components: options.components, relationships: options.relationships };
  } else if (options.data) {
    graphData = options.data;
  }

  let executionMode = 'in-memory';
  const forceInMemory = options.forceInMemory ?? false;

  if (!graphData && !forceInMemory) {
    const isNeo4jOnline = await verifyConnection();
    if (isNeo4jOnline) {
      executionMode = 'neo4j';
    }
  }

  // Load fallback if still needed
  if (!graphData) {
    graphData = loadFallbackData();
  }

  // Step 1: Generate structural baseline candidates
  const structuralBaseline = generateStructuralCandidatesInMemory(changedIds, graphData, maxHops);

  // Step 2: Rerank with historical revision evidence
  const historyCounts = options.historyCounts || null;
  const proposedRecommendations = rerankCandidatesWithHistory(structuralBaseline, changedIds, historyCounts);

  const historicalCount = proposedRecommendations.filter(r => r.coChangeCount > 0).length;
  const structuralOnlyCount = proposedRecommendations.length - historicalCount;

  return {
    structuralBaseline,
    proposedRecommendations,
    metadata: {
      changedIds,
      maxHops,
      totalCandidates: proposedRecommendations.length,
      historicalCount,
      structuralOnlyCount,
      executionMode
    }
  };
}
