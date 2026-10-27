/**
 * pathSignature.js
 * ----------------
 * Deterministic, direction-aware typed path signature generator for
 * Operation-Conditioned Change Propagation (OCCP).
 *
 * Rules:
 *   1. Explicit relationship types: DEPENDS_ON, USES, EXTENDS, IMPLEMENTS, TESTS.
 *   2. Strict distinction between EXTENDS and IMPLEMENTS.
 *   3. Direction awareness: incoming (🡸) vs outgoing (➔).
 *   4. Component types included: Controller, Service, Repository, Entity/Model, Test, Config, Other.
 *   5. Deduplication: identical signatures between a source and candidate in a case are counted at most once.
 */

'use strict';

import { STRUCTURAL_REL_TYPES } from '../structuralHistoryReranker.js';

/**
 * Builds a canonical string signature for a traversal path.
 *
 * Format:
 *   1-hop: (SourceType)-[dir:REL_TYPE]->(DestType)
 *   2-hop: (SourceType)-[dir1:REL1]->(MidType)-[dir2:REL2]->(DestType)
 *   3-hop: (SourceType)-[dir1:REL1]->(Mid1Type)-[dir2:REL2]->(Mid2Type)-[dir3:REL3]->(DestType)
 *
 * @param {string[]} nodeIds - Array of node IDs along the path
 * @param {string[]} relTypes - Array of relationship types along the path
 * @param {string[]} directions - Array of directions ('outgoing'|'incoming')
 * @param {Map<string, Object>} compMap - Map of component ID to component object
 * @returns {string} Canonical typed path signature
 */
export function buildPathSignature(nodeIds, relTypes, directions, compMap) {
  if (!nodeIds || nodeIds.length < 2) return '';

  let sig = '';
  for (let i = 0; i < nodeIds.length; i++) {
    const comp = compMap.get(nodeIds[i]);
    const compType = (comp && comp.type) ? comp.type : 'Other';

    if (i === 0) {
      sig += `(${compType})`;
    } else {
      const rel = relTypes[i - 1] || 'UNKNOWN';
      const dir = directions[i - 1] || 'outgoing';
      sig += `-[${dir}:${rel}]->(${compType})`;
    }
  }

  return sig;
}

/**
 * Traverses the graph from a changed seed component and extracts all valid paths
 * up to maxHops, mapping each candidate to its distinct typed path signatures.
 *
 * Adheres strictly to structural traversal rules from structuralHistoryReranker:
 *   - Only valid STRUCTURAL_REL_TYPES: DEPENDS_ON, USES, EXTENDS, IMPLEMENTS, TESTS.
 *   - Avoids self-reference to the seed.
 *   - Filters passive Entity/Other nodes at hop 1 when outgoing USES.
 *   - Deduplicates identical signatures per candidate.
 *
 * @param {string} seedId - Seed changed component ID
 * @param {Object} graphData - { components: [], relationships: [] }
 * @param {number} maxHops - Maximum traversal depth (default: 2)
 * @returns {Map<string, Array<{ signature: string, hop: number, rels: string[], dirs: string[], nodes: string[] }>>}
 */
export function extractCandidatePathsFromSeed(seedId, graphData, maxHops = 2) {
  const components = graphData.components || [];
  const relationships = graphData.relationships || [];
  const compMap = new Map(components.map(c => [c.id, c]));

  // Build adjacency
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

  const candidatePathsMap = new Map(); // candidateId -> Array<PathInfo>
  const candidateSignaturesMap = new Map(); // candidateId -> Set<signature>

  const queue = [{
    currentId: seedId,
    hop: 0,
    nodes: [seedId],
    rels: [],
    dirs: []
  }];

  const visitedHops = new Map();
  visitedHops.set(seedId, 0);

  while (queue.length > 0) {
    const { currentId, hop, nodes, rels, dirs } = queue.shift();

    if (hop >= maxHops) continue;

    const neighbors = adj.get(currentId) || [];
    for (const edge of neighbors) {
      const nextId = edge.neighbor;
      const nextHop = hop + 1;

      // Seed exclusion
      if (nextId === seedId) continue;

      // In 2-hop traversal, passive Entity/Other nodes are filtered as intermediaries
      // when outgoing USES, matching structuralHistoryReranker
      const nextComp = compMap.get(nextId);
      if (nextHop === 1 && nextComp && (nextComp.type === 'Entity/Model' || nextComp.type === 'Other') && edge.type === 'USES') {
        if (edge.direction === 'outgoing') continue;
      }

      const nextNodes = [...nodes, nextId];
      const nextRels = [...rels, edge.type];
      const nextDirs = [...dirs, edge.direction];

      const signature = buildPathSignature(nextNodes, nextRels, nextDirs, compMap);

      if (!candidateSignaturesMap.has(nextId)) {
        candidateSignaturesMap.set(nextId, new Set());
        candidatePathsMap.set(nextId, []);
      }

      const sigSet = candidateSignaturesMap.get(nextId);
      // Deduplicate identical signatures between this seed and this candidate
      if (!sigSet.has(signature)) {
        sigSet.add(signature);
        candidatePathsMap.get(nextId).push({
          signature,
          hop: nextHop,
          rels: nextRels,
          dirs: nextDirs,
          nodes: nextNodes
        });
      }

      const prevSeenHop = visitedHops.get(nextId);
      if (prevSeenHop === undefined || nextHop < prevSeenHop) {
        visitedHops.set(nextId, nextHop);
        queue.push({
          currentId: nextId,
          hop: nextHop,
          nodes: nextNodes,
          rels: nextRels,
          dirs: nextDirs
        });
      }
    }
  }

  return candidatePathsMap;
}
