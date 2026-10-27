/**
 * egcpLiveService.js
 * ------------------
 * Live execution adapter for Evolutionary-Graph Change Propagation v4 (EGCP v4).
 * Reuses the exact evaluated EGCP v4 Combined model from research artifacts
 * while enforcing:
 *   1. 100% candidate universe preservation |C_model| = |C_canonical|.
 *   2. Real git history extraction without data fabrication.
 *   3. Explicit warnings and zero-evolutionary fallback when git history is absent.
 *   4. Side-by-side comparison with the Canonical Structural Baseline.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { rankModel_EGCP_v4_Combined } from './egcp/v4/egcpV4Model.js';
import { generateStructuralCandidatesInMemory } from './structuralHistoryReranker.js';
import { parseGitLogCommits, isJavaSourceFile } from './gitChangeDetector.js';
import { analyzeImpact } from './impactEngine.js';
import { analyzeRepository } from '../analyzers/javaAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FALLBACK_GRAPH = path.resolve(__dirname, '..', '..', 'analysis_output.json');

/**
 * Loads current structural graph from JSON file or memory.
 * If a repoPath is provided and the cached graph belongs to a different repository,
 * it dynamically analyzes the requested repository so results are never stale.
 */
function loadActiveGraph(customGraph = null, repoPath = null) {
  if (customGraph && Array.isArray(customGraph.components) && Array.isArray(customGraph.relationships)) {
    return customGraph;
  }
  const normRepo = repoPath ? path.resolve(repoPath) : null;
  if (fs.existsSync(DEFAULT_FALLBACK_GRAPH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DEFAULT_FALLBACK_GRAPH, 'utf-8'));
      if (Array.isArray(data.components) && Array.isArray(data.relationships)) {
        if (!normRepo || !data.repoPath || path.resolve(data.repoPath) === normRepo) {
          return data;
        }
      }
    } catch (err) {
      console.error('[egcpLiveService] Failed to parse active graph fallback:', err.message);
    }
  }

  if (normRepo && fs.existsSync(normRepo)) {
    try {
      console.log(`[egcpLiveService] Parsing active graph for repo: ${normRepo}`);
      const fresh = analyzeRepository(normRepo);
      const graphData = {
        repoPath: normRepo,
        projectName: path.basename(normRepo),
        analyzedAt: new Date().toISOString(),
        components: fresh.components,
        relationships: fresh.relationships
      };
      fs.writeFileSync(DEFAULT_FALLBACK_GRAPH, JSON.stringify(graphData, null, 2), 'utf-8');
      return graphData;
    } catch (err) {
      console.error(`[egcpLiveService] Dynamic analysis failed for "${normRepo}":`, err.message);
    }
  }

  return { components: [], relationships: [] };
}

/**
 * Extracts live evolutionary co-change history from repository.
 */
export function extractLiveEvolutionaryHistory(repoPath, components = [], commitLimit = 100) {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return {
      historyCounts: new Map(),
      status: {
        available: false,
        reason: `Repository directory not found at '${repoPath}'. Evolutionary channel operates in zero-evidence mode.`,
        commitsCount: 0,
        coChangePairsCount: 0
      }
    };
  }

  // Check if .git directory exists
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      historyCounts: new Map(),
      status: {
        available: false,
        reason: `No .git repository found in '${repoPath}'. Evolutionary history is unavailable.`,
        commitsCount: 0,
        coChangePairsCount: 0
      }
    };
  }

  let allCommits;
  try {
    allCommits = parseGitLogCommits(repoPath, commitLimit, { includeMerges: true });
  } catch (err) {
    return {
      historyCounts: new Map(),
      status: {
        available: false,
        reason: `Failed to parse git log: ${err.message}`,
        commitsCount: 0,
        coChangePairsCount: 0
      }
    };
  }

  if (!allCommits || allCommits.length === 0) {
    return {
      historyCounts: new Map(),
      status: {
        available: false,
        reason: 'Git log returned 0 commits for the specified repository.',
        commitsCount: 0,
        coChangePairsCount: 0
      }
    };
  }

  const compMap = new Map(components.map(c => [c.id, c]));
  const historyCounts = new Map();

  for (const commit of allCommits) {
    const raw = commit.rawChanges || [];
    const mappedIds = new Set();

    for (const ch of raw) {
      const p = ch.filePath || ch.newPath || ch.oldPath;
      if (!p || !isJavaSourceFile(p)) continue;
      const cleanP = p.replace(/\\/g, '/').toLowerCase();

      for (const [id, comp] of compMap.entries()) {
        const compPath = (comp.filePath || '').replace(/\\/g, '/').toLowerCase();
        if (compPath && (compPath.endsWith(cleanP) || cleanP.endsWith(compPath))) {
          mappedIds.add(id);
        }
      }
    }

    const arr = [...mappedIds].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}|${arr[j]}`;
        historyCounts.set(key, (historyCounts.get(key) || 0) + 1);
      }
    }
  }

  return {
    historyCounts,
    status: {
      available: true,
      reason: null,
      commitsCount: allCommits.length,
      coChangePairsCount: historyCounts.size
    }
  };
}

/**
 * Runs EGCP v4 Combined Model on live changed seed components.
 *
 * @param {Array<string>} changedSeedIds
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function runLiveEGCPv4(changedSeedIds, options = {}) {
  if (!changedSeedIds || !Array.isArray(changedSeedIds) || changedSeedIds.length === 0) {
    throw new Error('Please provide at least one changed seed component.');
  }

  const graph = loadActiveGraph(options.customGraph, options.repoPath);
  const repoPath = options.repoPath || graph.repoPath || '';

  if (!graph.components || graph.components.length === 0) {
    throw new Error('Active software graph has zero components. Scan a repository first.');
  }

  // Resolve seed IDs against graph components (supports simple names and FQCNs)
  const resolvedSeedIds = changedSeedIds.map(seed => {
    const direct = graph.components.find(c => c.id === seed || c.name === seed);
    if (direct) return direct.id;
    const suffix = graph.components.find(c => c.id.endsWith(`.${seed}`));
    return suffix ? suffix.id : seed;
  });

  // 1. Generate structural candidate universe (2 hops)
  const structuralCandidates = generateStructuralCandidatesInMemory(resolvedSeedIds, graph, 2);

  if (structuralCandidates.length === 0) {
    return {
      success: true,
      modelUsed: 'egcp_v4_combined',
      changedComponents: resolvedSeedIds,
      candidateUniverseSize: 0,
      potentiallyImpactedComponents: [],
      rankedImpacts: [],
      evolutionaryStatus: { available: false, reason: 'No structural candidates found in 2-hop graph neighborhood.' }
    };
  }

  // 2. Extract evolutionary history
  const { historyCounts, status: evoStatus } = extractLiveEvolutionaryHistory(
    repoPath,
    graph.components,
    options.commitLimit || 100
  );

  // 3. Score candidates with EGCP v4 Combined
  // If multiple seeds are provided, score against each seed and aggregate by max score
  let rankedPerSeed = [];
  for (const seed of resolvedSeedIds) {
    const seedRanked = rankModel_EGCP_v4_Combined(
      structuralCandidates,
      seed,
      graph,
      historyCounts,
      { editOperation: options.editOperation || null }
    );
    rankedPerSeed.push({ seed, candidates: seedRanked });
  }

  // Merge scores across seeds (using best score per candidate)
  const mergedMap = new Map();
  for (const { seed, candidates } of rankedPerSeed) {
    for (const c of candidates) {
      const existing = mergedMap.get(c.id);
      if (!existing || c.egcp_v4_score > existing.egcp_v4_score) {
        mergedMap.set(c.id, {
          ...c,
          bestSeed: seed
        });
      }
    }
  }

  const finalRanked = Array.from(mergedMap.values());

  // Deterministic tie-breaking hierarchy matching research evaluator
  finalRanked.sort((a, b) => {
    if (Math.abs(b.egcp_v4_score - a.egcp_v4_score) > 1e-12) {
      return b.egcp_v4_score - a.egcp_v4_score;
    }
    if (b.egcp_v4_evoCoChange !== a.egcp_v4_evoCoChange) {
      return (b.egcp_v4_evoCoChange || 0) - (a.egcp_v4_evoCoChange || 0);
    }
    if (a.minHop !== b.minHop) {
      return (a.minHop || 99) - (b.minHop || 99);
    }
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return (a.structuralBaselineRank || 9999) - (b.structuralBaselineRank || 9999);
    }
    return a.id.localeCompare(b.id);
  });

  // Assign 1-indexed ranks and severity bands
  const total = finalRanked.length;
  const highCutoff = Math.max(1, Math.ceil(total * 0.20));
  const medCutoff = Math.max(highCutoff + 1, Math.ceil(total * 0.50));

  const formattedImpacts = finalRanked.map((c, idx) => {
    const rank = idx + 1;
    const impactLevel = rank <= highCutoff ? 'High' : (rank <= medCutoff ? 'Medium' : 'Low');

    return {
      id: c.id,
      name: c.name,
      type: c.type,
      filePath: c.filePath,
      impactLevel,
      hopDistance: c.minHop || 1,
      egcp_v4_rank: rank,
      egcp_v4_score: Number(c.egcp_v4_score.toFixed(4)),
      egcp_v4_structScore: Number((c.egcp_v4_structScore || 0).toFixed(4)),
      egcp_v4_evoScore: Number((c.egcp_v4_evoScore || 0).toFixed(4)),
      egcp_v4_evoCoChange: c.egcp_v4_evoCoChange || 0,
      egcp_v4_betaUsed: Number((c.egcp_v4_betaUsed || 0).toFixed(3)),
      reason: `EGCP v4 Rank #${rank} (Fused Score: ${c.egcp_v4_score.toFixed(4)} | Struct: ${(c.egcp_v4_structScore || 0).toFixed(3)} | Evo: ${(c.egcp_v4_evoScore || 0).toFixed(3)} | Co-change: ${c.egcp_v4_evoCoChange || 0})`,
      reasoningPath: c.reasoningPath || `${c.bestSeed || changedSeedIds[0]} ➔ [DEPENDS_ON] ➔ ${c.name}`
    };
  });

  return {
    success: true,
    modelUsed: 'egcp_v4_combined',
    changedComponents: resolvedSeedIds,
    candidateUniverseSize: structuralCandidates.length,
    potentiallyImpactedComponents: formattedImpacts,
    rankedImpacts: formattedImpacts,
    evolutionaryStatus: evoStatus
  };
}

/**
 * Runs comparative analysis executing BOTH Canonical Baseline and EGCP v4 on identical seeds.
 *
 * @param {Array<string>} changedSeedIds
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function runComparativeImpactAnalysis(changedSeedIds, options = {}) {
  const graph = loadActiveGraph(options.customGraph);
  const resolvedSeedIds = (graph.components && graph.components.length > 0)
    ? changedSeedIds.map(seed => {
        const direct = graph.components.find(c => c.id === seed || c.name === seed);
        if (direct) return direct.id;
        const suffix = graph.components.find(c => c.id.endsWith(`.${seed}`));
        return suffix ? suffix.id : seed;
      })
    : changedSeedIds;

  // 1. Run Canonical Structural Baseline
  const rawBaseline = await analyzeImpact(resolvedSeedIds, { repoPath: options.repoPath });
  const baselineReport = Array.isArray(rawBaseline) ? rawBaseline : [];

  // 2. Run EGCP v4 Combined
  const egcpResult = await runLiveEGCPv4(resolvedSeedIds, options);
  const egcpReport = Array.isArray(egcpResult?.potentiallyImpactedComponents)
    ? egcpResult.potentiallyImpactedComponents
    : (Array.isArray(egcpResult?.rankedImpacts) ? egcpResult.rankedImpacts : []);

  // 3. Compute Comparison Metrics & Rank Shifts
  const baselineRankMap = new Map(baselineReport.map((c, idx) => [c.id, idx + 1]));
  const egcpRankMap = new Map(egcpReport.map((c, idx) => [c.id, idx + 1]));

  const allCandidateIds = Array.from(new Set([...baselineRankMap.keys(), ...egcpRankMap.keys()]));

  const rankDeltas = allCandidateIds.map(id => {
    const bRank = baselineRankMap.get(id) || null;
    const eRank = egcpRankMap.get(id) || null;
    const item = egcpReport.find(c => c.id === id) || baselineReport.find(c => c.id === id);

    const shift = (bRank !== null && eRank !== null) ? (bRank - eRank) : null; // Positive shift = promoted by EGCP

    return {
      id,
      name: item?.name || id.split('.').pop(),
      type: item?.type || 'Component',
      baselineRank: bRank,
      egcpRank: eRank,
      rankShift: shift, // +N means promoted by N positions, -N means demoted
      isCommon: bRank !== null && eRank !== null,
      isBaselineOnly: bRank !== null && eRank === null,
      isEgcpOnly: bRank === null && eRank !== null
    };
  });

  // Sort rank shifts by absolute shift descending
  rankDeltas.sort((a, b) => Math.abs(b.rankShift || 0) - Math.abs(a.rankShift || 0));

  const commonCount = rankDeltas.filter(r => r.isCommon).length;
  const promotedCount = rankDeltas.filter(r => (r.rankShift || 0) > 0).length;
  const demotedCount = rankDeltas.filter(r => (r.rankShift || 0) < 0).length;
  const unchangedCount = rankDeltas.filter(r => (r.rankShift || 0) === 0).length;

  return {
    success: true,
    model: 'compare',
    changedComponents: changedSeedIds,
    baselineOutput: baselineReport,
    egcpOutput: egcpReport,
    potentiallyImpactedComponents: egcpReport, // Default canvas highlight to EGCP v4 in compare mode
    comparison: {
      totalCandidates: allCandidateIds.length,
      commonCount,
      promotedCount,
      demotedCount,
      unchangedCount,
      rankDeltas
    },
    evolutionaryStatus: egcpResult.evolutionaryStatus
  };
}
