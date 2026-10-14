import { getDriver, verifyConnection } from './neo4jService.js';
import fs from 'fs';
import path from 'path';

// 1. Configurable Parameters for the Context-Aware Model
export const MODEL_CONFIG = {
  alpha: 0.7,
  beta: 0.3,
  hopWeights: { 1: 1.0, 2: 0.5 },
  relWeights: { 
    DEPENDS_ON: 1.0, 
    IMPLEMENTS: 1.0, 
    EXTENDS: 1.0, 
    USES: 0.7, 
    TESTS: 0.0 // Handled separately
  },
  historySaturationThreshold: 20,
  artifactContextWeights: {
    'Repository->Service': 0.2,
    'Service->Controller': 0.15,
    'Entity/Model->Controller': 0.25,
    'Entity/Model->Service': 0.25,
    'Entity/Model->Repository': 0.25,
    'Controller->Service': 0.0
  },
  ablation: {
    enableArtifactContext: true,
    enableHistory: true,
    enableTestingContext: true
  }
};

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

export async function analyzeContextAwareImpact(changedIds, options = {}) {
  if (!changedIds || !Array.isArray(changedIds) || changedIds.length === 0) {
    return [];
  }

  // If synthetic data is provided via options, use in-memory directly
  if (options.components && options.relationships) {
    return analyzeInMemory(changedIds, options);
  }

  const isNeo4jOnline = await verifyConnection();
  if (isNeo4jOnline) {
    console.log('🔗 [ContextAwareEngine] Running via live Neo4j Knowledge Graph...');
    return analyzeNeo4j(changedIds, options);
  } else {
    console.log('⚡ [ContextAwareEngine] Neo4j is offline; running via in-memory fallback graph.');
    return analyzeInMemory(changedIds, options);
  }
}

async function analyzeNeo4j(changedIds, options = {}) {
  const d = getDriver();
  const session = d.session();
  try {
    const query = `
      MATCH path = (impacted:Component)-[r:DEPENDS_ON|USES|IMPLEMENTS|EXTENDS|TESTS*1..2]-(changed:Component)
      WHERE changed.id IN $changedIds AND NOT impacted.id IN $changedIds
      OPTIONAL MATCH (impacted)-[hist:CO_CHANGED_WITH]-(changed)
      RETURN path, hist.count AS histCount
    `;
    const res = await session.run(query, { changedIds });
    return processPaths(res.records, changedIds, options);
  } finally {
    await session.close();
  }
}

/**
 * In-memory fallback impact analyzer.
 * Supports both 1-hop and 2-hop traversals, optional history counts, and synthetic test fixtures.
 */
export function analyzeInMemory(changedIds, options = {}) {
  if (!changedIds || !Array.isArray(changedIds) || changedIds.length === 0) {
    return [];
  }

  const data = options.data || (options.components ? { components: options.components, relationships: options.relationships } : loadFallbackData());
  const components = options.components || data.components || [];
  const relationships = options.relationships || data.relationships || [];
  const historyCounts = options.historyCounts || null;

  const compMap = new Map(components.map(c => [c.id, c]));
  const VALID = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'IMPLEMENTS', 'EXTENDS']);

  const adj = {};
  components.forEach(c => { adj[c.id] = []; });
  relationships.forEach(r => {
    if (!VALID.has(r.type)) return;
    if (adj[r.source] && adj[r.target]) {
      adj[r.source].push({ target: r.target, type: r.type, direction: 'outgoing' });
      adj[r.target].push({ target: r.source, type: r.type, direction: 'incoming' });
    }
  });

  // Extract co-change counts from relationships if historyCounts not explicitly passed
  const coChangeMap = historyCounts || new Map();
  if (!historyCounts) {
    for (const r of relationships) {
      if (r.type === 'CO_CHANGED_WITH' && r.count) {
        let a = r.source, b = r.target;
        if (a > b) { const t = a; a = b; b = t; }
        coChangeMap.set(`${a}|${b}`, r.count);
      }
    }
  }

  const fakeRecords = [];

  // Helper to build a record object matching Neo4j result format
  function createRecord(sourceComp, targetComp, segments, histCount) {
    return {
      get: (key) => {
        if (key === 'histCount') {
          return histCount ? { toNumber: () => histCount } : null;
        }
        if (key === 'path') {
          return {
            start: { properties: targetComp },
            end: { properties: sourceComp },
            segments: segments.map(seg => ({
              start: { properties: seg.startComp },
              end: { properties: seg.endComp },
              relationship: { type: seg.type }
            }))
          };
        }
      }
    };
  }

  function getHistCount(id1, id2) {
    let a = id1, b = id2;
    if (a > b) { const t = a; a = b; b = t; }
    return coChangeMap.get(`${a}|${b}`) || 0;
  }

  // 1-hop traversal
  for (const changedId of changedIds) {
    const changedComp = compMap.get(changedId);
    if (!changedComp) continue;

    for (const conn of (adj[changedId] || [])) {
      const impactedId = conn.target;
      if (changedIds.includes(impactedId)) continue;
      const impactedComp = compMap.get(impactedId);
      if (!impactedComp) continue;

      const seg = {
        startComp: conn.direction === 'outgoing' ? changedComp : impactedComp,
        endComp: conn.direction === 'outgoing' ? impactedComp : changedComp,
        type: conn.type
      };
      const hist = getHistCount(changedId, impactedId);
      fakeRecords.push(createRecord(changedComp, impactedComp, [seg], hist));
    }
  }

  // 2-hop traversal
  for (const changedId of changedIds) {
    const changedComp = compMap.get(changedId);
    if (!changedComp) continue;

    for (const conn1 of (adj[changedId] || [])) {
      const midId = conn1.target;
      const midComp = compMap.get(midId);
      if (!midComp) continue;

      for (const conn2 of (adj[midId] || [])) {
        const leafId = conn2.target;
        if (changedIds.includes(leafId) || leafId === midId) continue;
        const leafComp = compMap.get(leafId);
        if (!leafComp) continue;

        const seg1 = {
          startComp: conn1.direction === 'outgoing' ? changedComp : midComp,
          endComp: conn1.direction === 'outgoing' ? midComp : changedComp,
          type: conn1.type
        };
        const seg2 = {
          startComp: conn2.direction === 'outgoing' ? midComp : leafComp,
          endComp: conn2.direction === 'outgoing' ? leafComp : midComp,
          type: conn2.type
        };

        const hist = getHistCount(changedId, leafId);
        fakeRecords.push(createRecord(changedComp, leafComp, [seg1, seg2], hist));
      }
    }
  }

  return processPaths(fakeRecords, changedIds, options);
}

function processPaths(records, changedIds, options = {}) {
  const config = { ...MODEL_CONFIG, ...(options.configOverride || {}) };
  const ablation = { ...MODEL_CONFIG.ablation, ...(options.configOverride?.ablation || {}) };
  config.ablation = ablation;

  const impactMap = new Map();

  for (const record of records) {
    const pathObj = record.get('path');
    const rawHist = record.get('histCount');
    const histCount = rawHist ? (typeof rawHist.toNumber === 'function' ? rawHist.toNumber() : Number(rawHist)) : 0;
    
    const startNode = pathObj.start; 
    const endNode = pathObj.end; 
    
    let targetNode = startNode;
    let sourceNode = endNode;
    
    if (changedIds.includes(startNode.properties.id)) {
      sourceNode = startNode;
      targetNode = endNode;
    }

    const changedId = sourceNode.properties.id;
    const changedType = sourceNode.properties.type;
    const impactedId = targetNode.properties.id;
    const impactedType = targetNode.properties.type;
    const impactedName = targetNode.properties.name || impactedId;

    const hopCount = pathObj.segments.length;
    
    let pathRelWeight = 1.0;
    let hasTestsRel = false;
    const relTypes = [];
    
    for (const seg of pathObj.segments) {
      const rType = seg.relationship.type;
      relTypes.push(rType);
      if (rType === 'TESTS') hasTestsRel = true;
      pathRelWeight *= (config.relWeights[rType] ?? 0.5);
    }

    const w_h = config.hopWeights[hopCount] ?? 0;
    let baseInfluence = w_h * pathRelWeight;
    baseInfluence = Math.max(0, Math.min(baseInfluence, 1.0));

    let artifactWeight = 0;
    if (config.ablation.enableArtifactContext) {
      const flowKey = `${changedType}->${impactedType}`;
      artifactWeight = config.artifactContextWeights[flowKey] || 0;
      artifactWeight = Math.max(0, Math.min(artifactWeight, 1.0));
    }

    let historyWeight = 0;
    if (config.ablation.enableHistory && histCount > 0) {
      historyWeight = Math.min(histCount / config.historySaturationThreshold, 1.0);
      historyWeight = Math.max(0, Math.min(historyWeight, 1.0));
    }

    let contextInfluence = artifactWeight + historyWeight;
    contextInfluence = Math.max(0, Math.min(contextInfluence, 1.0));

    let influenceScore = (config.alpha * baseInfluence) + (config.beta * contextInfluence);
    influenceScore = Math.max(0, Math.min(influenceScore, 1.0));

    let category = 'Impacted Component';
    if (config.ablation.enableTestingContext && hasTestsRel && impactedType === 'Test') {
      category = 'Regression Tests';
      influenceScore = 1.0; 
    }

    let severity = 'Low';
    if (influenceScore >= 0.75) severity = 'High';
    else if (influenceScore >= 0.40) severity = 'Medium';

    const reasoningString = `${hopCount}-hop path via [${relTypes.join(', ')}] from ${changedId}`;

    // Traceable evidence classification
    const evidenceSources = ['structural'];
    if (historyWeight > 0) evidenceSources.push('historical_co_change');
    if (artifactWeight > 0) evidenceSources.push('artifact_context');
    if (category === 'Regression Tests') evidenceSources.push('regression_test');

    const evidenceStatus = {
      history: histCount > 0 ? 'available' : 'unavailable',
      artifact: artifactWeight > 0 ? 'available' : 'unavailable'
    };

    const pathData = {
      score: influenceScore,
      severity,
      category,
      reasoningString,
      evidenceSources,
      evidenceStatus,
      evidence: {
        hopDistance: hopCount,
        relationshipSemantics: relTypes,
        historicalCoChanges: histCount,
        artifactFlow: `${changedType}->${impactedType}`,
        baseInfluence: parseFloat(baseInfluence.toFixed(3)),
        contextInfluence: parseFloat(contextInfluence.toFixed(3))
      }
    };

    if (!impactMap.has(impactedId)) {
      impactMap.set(impactedId, {
        id: impactedId,
        component: impactedId,
        name: impactedName,
        displayName: impactedName,
        impactedType,
        influenceScore: influenceScore,
        severity,
        category,
        evidenceSources,
        evidenceStatus,
        primaryReasoningPath: reasoningString,
        allSupportingPaths: [pathData],
        relationshipEvidence: relTypes,
        hopDistance: hopCount,
        historicalEvidence: histCount,
        artifactContext: `${changedType}->${impactedType}`
      });
    } else {
      const existing = impactMap.get(impactedId);
      existing.allSupportingPaths.push(pathData);
      
      // Union of evidence sources across paths
      for (const src of evidenceSources) {
        if (!existing.evidenceSources.includes(src)) {
          existing.evidenceSources.push(src);
        }
      }
      if (histCount > existing.historicalEvidence) {
        existing.historicalEvidence = histCount;
        existing.evidenceStatus.history = 'available';
      }

      if (influenceScore > existing.influenceScore) {
        existing.influenceScore = influenceScore;
        existing.severity = severity;
        existing.category = category;
        existing.primaryReasoningPath = reasoningString;
        existing.relationshipEvidence = relTypes;
        existing.hopDistance = hopCount;
        existing.artifactContext = `${changedType}->${impactedType}`;
      }
    }
  }

  // Deterministic sorting with tie-breaker
  const results = Array.from(impactMap.values()).sort((a, b) => {
    const diff = b.influenceScore - a.influenceScore;
    if (Math.abs(diff) > 1e-6) return diff;
    return a.component.localeCompare(b.component);
  });
  
  // Assign deterministic rank
  results.forEach((r, idx) => {
    r.rank = idx + 1;
    r.influenceScore = parseFloat(r.influenceScore.toFixed(3));
  });

  // Apply optional threshold if provided
  if (options.threshold !== undefined && options.threshold > 0) {
    return results.filter(r => r.category === 'Regression Tests' || r.influenceScore >= options.threshold);
  }

  return results;
}
