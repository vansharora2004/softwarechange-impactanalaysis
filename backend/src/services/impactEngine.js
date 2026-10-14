import { getDriver, verifyConnection } from './neo4jService.js';
import fs from 'fs';
import path from 'path';

// Load intermediate JSON output for in-memory fallback if needed
function loadFallbackData() {
  try {
    const filePath = path.join(import.meta.dirname || '.', '../../analysis_output.json');
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load fallback data:', err);
  }
  return { components: [], relationships: [] };
}

/**
 * Computes potentially impacted components using Neo4j.
 */
async function analyzeImpactNeo4j(changedIds) {
  const d = getDriver();
  const session = d.session();
  
  try {
    const query = `
      MATCH path = (a:Component)-[r:DEPENDS_ON|USES|TESTS*1..2]-(b:Component)
      WHERE b.id IN $changedIds AND NOT a.id IN $changedIds
      RETURN path
    `;
    const res = await session.run(query, { changedIds });
    
    const impacts = processNeo4jPaths(res.records, changedIds);
    return impacts;
  } finally {
    await session.close();
  }
}

/**
 * Processes Neo4j path records and builds the explainable impact report.
 */
function processNeo4jPaths(records, changedIds) {
  const impactMap = new Map();

  for (const record of records) {
    const pathObj = record.get('path');
    const segments = pathObj.segments;
    
    const startNode = pathObj.start;
    const endNode = pathObj.end;
    
    let targetComponentNode; 
    let sourceChangedNode;    
    let isStartChanged = changedIds.includes(startNode.properties.id);
    let isEndChanged = changedIds.includes(endNode.properties.id);

    if (isStartChanged && !isEndChanged) {
      sourceChangedNode = startNode;
      targetComponentNode = endNode;
    } else if (!isStartChanged && isEndChanged) {
      sourceChangedNode = endNode;
      targetComponentNode = startNode;
    } else {
      continue;
    }

    const impactedId = targetComponentNode.properties.id;
    const impactedType = targetComponentNode.properties.type;
    
    const pathNodes = segments.map(seg => seg.start.properties.id);
    pathNodes.push(segments[segments.length - 1].end.properties.id);
    
    const pathRels = segments.map(seg => seg.relationship.type);

    let impactLevel = 'Low';
    let reason = '';
    let reasoningPath = '';

    if (segments.length === 1) {
      const seg = segments[0];
      const relType = seg.relationship.type;
      const startId = seg.start.properties.id;
      const endId = seg.end.properties.id;

      if (relType === 'TESTS') {
        impactLevel = 'High';
        reason = `${impactedId} directly tests the changed component ${sourceChangedNode.properties.id}.`;
        reasoningPath = `${impactedId} ➔ [TESTS] ➔ ${sourceChangedNode.properties.id}`;
      } else if (relType === 'DEPENDS_ON') {
        if (startId === impactedId) {
          impactLevel = 'High';
          reason = `${impactedId} depends directly (via injection) on the changed component ${sourceChangedNode.properties.id}.`;
          reasoningPath = `${impactedId} ➔ [DEPENDS_ON] ➔ ${sourceChangedNode.properties.id}`;
        } else {
          impactLevel = 'Medium';
          reason = `${impactedId} is directly used (via injection) by the changed component ${sourceChangedNode.properties.id}; changes in behavior may affect interactions.`;
          reasoningPath = `${sourceChangedNode.properties.id} ➔ [DEPENDS_ON] ➔ ${impactedId}`;
        }
      } else if (relType === 'USES') {
        // Skip passive data structures/helpers for standard USES relationships
        if (impactedType === 'Entity/Model' || impactedType === 'Other') {
          continue;
        }

        if (startId === impactedId) {
          impactLevel = 'High';
          reason = `${impactedId} directly references the changed component ${sourceChangedNode.properties.id}.`;
          reasoningPath = `${impactedId} ➔ [USES] ➔ ${sourceChangedNode.properties.id}`;
        } else {
          impactLevel = 'Medium';
          reason = `${impactedId} is directly referenced by the changed component ${sourceChangedNode.properties.id}; changes in behavior may affect interactions.`;
          reasoningPath = `${sourceChangedNode.properties.id} ➔ [USES] ➔ ${impactedId}`;
        }
      }
    } else if (segments.length === 2) {
      const seg1 = segments[0];
      const seg2 = segments[1];
      const n0 = seg1.start.properties.id;
      const n1 = seg1.end.properties.id; // mid node
      const n2 = seg2.end.properties.id;
      
      const rel1 = seg1.relationship.type;
      const rel2 = seg2.relationship.type;

      // Skip passive structures from 2-hop propagation report
      if (impactedType === 'Entity/Model' || impactedType === 'Other') {
        continue;
      }

      impactLevel = 'Low';
      
      if (changedIds.includes(n2) && n0 === impactedId && 
          (rel1 === 'USES' || rel1 === 'DEPENDS_ON') && 
          (rel2 === 'USES' || rel2 === 'DEPENDS_ON')) {
        reason = `${impactedId} depends indirectly on the changed component ${n2} via ${n1}.`;
        reasoningPath = `${impactedId} ➔ [${rel1}] ➔ ${n1} ➔ [${rel2}] ➔ ${n2}`;
      }
      else if (changedIds.includes(n0) && n2 === impactedId && 
               (rel1 === 'USES' || rel1 === 'DEPENDS_ON') && 
               (rel2 === 'USES' || rel2 === 'DEPENDS_ON')) {
        reason = `${impactedId} is indirectly used by the changed component ${n0} via ${n1}.`;
        reasoningPath = `${n0} ➔ [${rel1}] ➔ ${n1} ➔ [${rel2}] ➔ ${impactedId}`;
      }
      else if (changedIds.includes(n2) && n0 === impactedId && 
               rel1 === 'TESTS' && 
               (rel2 === 'USES' || rel2 === 'DEPENDS_ON')) {
        reason = `${impactedId} tests ${n1}, which directly depends on the changed component ${n2}.`;
        reasoningPath = `${impactedId} ➔ [TESTS] ➔ ${n1} ➔ [${rel2}] ➔ ${n2}`;
      }
      else {
        reason = `${impactedId} is connected via indirect path to ${sourceChangedNode.properties.id}.`;
        reasoningPath = `${pathNodes[0]} ➔ [${pathRels[0]}] ➔ ${pathNodes[1]} ➔ [${pathRels[1]}] ➔ ${pathNodes[2]}`;
      }
    }

    const existing = impactMap.get(impactedId);
    if (!existing || getImpactPriority(impactLevel) > getImpactPriority(existing.impactLevel)) {
      impactMap.set(impactedId, {
        name: impactedId,
        type: impactedType,
        impactLevel,
        reason,
        reasoningPath
      });
    }
  }

  return Array.from(impactMap.values()).sort((a, b) => getImpactPriority(b.impactLevel) - getImpactPriority(a.impactLevel));
}

function getImpactPriority(level) {
  if (level === 'High') return 3;
  if (level === 'Medium') return 2;
  return 1;
}

/**
 * In-memory fallback impact analyzer.
 * Accepts optional options { components, relationships } for deterministic testing.
 */
export function analyzeImpactInMemory(changedIds, options = {}) {
  if (!changedIds || !Array.isArray(changedIds) || changedIds.length === 0) {
    return [];
  }

  const data = options.data || (options.components ? { components: options.components, relationships: options.relationships } : loadFallbackData());
  const components = options.components || data.components || [];
  const relationships = options.relationships || data.relationships || [];

  const compMap = new Map(components.map(c => [c.id, c]));
  
  // Build adjacency
  const adj = {};
  components.forEach(c => {
    adj[c.id] = [];
  });
  relationships.forEach(r => {
    if (adj[r.source] && adj[r.target]) {
      adj[r.source].push({ target: r.target, type: r.type, detail: r.detail, direction: 'outgoing' });
      adj[r.target].push({ target: r.source, type: r.type, detail: r.detail, direction: 'incoming' });
    }
  });

  const impactMap = new Map();
  const validTypes = ['USES', 'DEPENDS_ON', 'TESTS'];

  // Find 1-hop connections
  for (const changedId of changedIds) {
    const connections = adj[changedId] || [];
    for (const conn of connections) {
      if (!validTypes.includes(conn.type)) continue;

      const neighborId = conn.target;
      if (changedIds.includes(neighborId)) continue; 

      const neighbor = compMap.get(neighborId);
      if (!neighbor) continue;

      // Filter passive data models from direct USES dependencies
      if (conn.type === 'USES' && (neighbor.type === 'Entity/Model' || neighbor.type === 'Other')) {
        continue;
      }

      let impactLevel = 'Low';
      let reason = '';
      let reasoningPath = '';

      if (conn.type === 'TESTS') {
        if (conn.direction === 'incoming') {
          impactLevel = 'High';
          reason = `${neighborId} directly tests the changed component ${changedId}.`;
          reasoningPath = `${neighborId} ➔ [TESTS] ➔ ${changedId}`;
        }
      } else if (conn.type === 'DEPENDS_ON') {
        if (conn.direction === 'incoming') {
          impactLevel = 'High';
          reason = `${neighborId} depends directly (via injection) on the changed component ${changedId}.`;
          reasoningPath = `${neighborId} ➔ [DEPENDS_ON] ➔ ${changedId}`;
        } else {
          impactLevel = 'Medium';
          reason = `${neighborId} is directly used (via injection) by the changed component ${changedId}; changes in behavior may affect interactions.`;
          reasoningPath = `${changedId} ➔ [DEPENDS_ON] ➔ ${neighborId}`;
        }
      } else if (conn.type === 'USES') {
        if (conn.direction === 'incoming') {
          impactLevel = 'High';
          reason = `${neighborId} directly references the changed component ${changedId}.`;
          reasoningPath = `${neighborId} ➔ [USES] ➔ ${changedId}`;
        } else {
          impactLevel = 'Medium';
          reason = `${neighborId} is directly referenced by the changed component ${changedId}; changes in behavior may affect interactions.`;
          reasoningPath = `${changedId} ➔ [USES] ➔ ${neighborId}`;
        }
      }

      const existing = impactMap.get(neighborId);
      if (!existing || getImpactPriority(impactLevel) > getImpactPriority(existing.impactLevel)) {
        impactMap.set(neighborId, {
          id: neighborId,
          name: neighbor.name || neighborId,
          displayName: neighbor.name || neighborId,
          type: neighbor.type,
          impactLevel,
          reason,
          reasoningPath,
          hopDistance: 1
        });
      }
    }
  }

  // Find 2-hop connections
  for (const changedId of changedIds) {
    const connections1 = adj[changedId] || [];
    for (const conn1 of connections1) {
      if (!validTypes.includes(conn1.type)) continue;
      const midId = conn1.target;
      
      const connections2 = adj[midId] || [];
      for (const conn2 of connections2) {
        if (!validTypes.includes(conn2.type)) continue;
        const leafId = conn2.target;
        if (changedIds.includes(leafId) || leafId === midId) continue;

        const leaf = compMap.get(leafId);
        if (!leaf) continue;

        // Skip passive structures from 2-hop propagation
        if (leaf.type === 'Entity/Model' || leaf.type === 'Other') {
          continue;
        }

        let reason = '';
        let reasoningPath = '';
        let valid = false;

        if (conn2.direction === 'incoming' && conn1.direction === 'incoming') {
          reason = `${leafId} depends indirectly on the changed component ${changedId} via ${midId}.`;
          reasoningPath = `${leafId} ➔ [${conn2.type}] ➔ ${midId} ➔ [${conn1.type}] ➔ ${changedId}`;
          valid = true;
        }
        else if (conn1.direction === 'outgoing' && conn2.direction === 'outgoing') {
          reason = `${leafId} is indirectly used by the changed component ${changedId} via ${midId}.`;
          reasoningPath = `${changedId} ➔ [${conn1.type}] ➔ ${midId} ➔ [${conn2.type}] ➔ ${leafId}`;
          valid = true;
        }
        else if (conn2.type === 'TESTS' && conn2.direction === 'incoming' && conn1.direction === 'incoming') {
          reason = `${leafId} tests ${midId}, which directly depends on the changed component ${changedId}.`;
          reasoningPath = `${leafId} ➔ [TESTS] ➔ ${midId} ➔ [${conn1.type}] ➔ ${changedId}`;
          valid = true;
        }

        if (valid) {
          const existing = impactMap.get(leafId);
          if (!existing || getImpactPriority('Low') > getImpactPriority(existing.impactLevel)) {
            impactMap.set(leafId, {
              id: leafId,
              name: leaf.name || leafId,
              displayName: leaf.name || leafId,
              type: leaf.type,
              impactLevel: 'Low',
              reason,
              reasoningPath,
              hopDistance: 2
            });
          }
        }
      }
    }
  }

  // Deterministic sorting with tie-breaker
  return Array.from(impactMap.values()).sort((a, b) => {
    const priDiff = getImpactPriority(b.impactLevel) - getImpactPriority(a.impactLevel);
    if (priDiff !== 0) return priDiff;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Main entry point for change impact analysis.
 */
export async function analyzeImpact(changedIds, options = {}) {
  if (!changedIds || !Array.isArray(changedIds) || changedIds.length === 0) {
    return [];
  }

  const isNeo4jConnected = await verifyConnection();
  if (isNeo4jConnected) {
    console.log('🔗 [BaselineEngine] Running Change Impact Analysis using live Neo4j database...');
    return await analyzeImpactNeo4j(changedIds);
  } else {
    console.log('⚡ [BaselineEngine] Neo4j is offline; running via in-memory fallback graph.');
    return analyzeImpactInMemory(changedIds, options);
  }
}
