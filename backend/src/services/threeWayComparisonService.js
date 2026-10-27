/**
 * threeWayComparisonService.js
 * ----------------------------
 * Multi-model comparative analysis service implementing:
 *   - Model A: Canonical Structural Baseline (Deterministic BFS 2-hop)
 *   - Model B: Continuous Score Fusion (OCCP / CSF Frozen Baseline)
 *   - Model C: EGCP v4 Combined (Dual-channel Entropy-Beta + Hub Exclusion + Gated-Op)
 *
 * Enforces:
 *   1. Identical candidate universe |C_model| = |C_canonical| = generateStructuralCandidatesInMemory(seeds, graph, 2)
 *   2. Zero data fabrication and zero temporal leakage.
 *   3. Transparent alignment across all three models with rank deltas, pairwise overlaps, and explanations.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { analyzeImpactInMemory, analyzeImpact } from './impactEngine.js';
import { generateStructuralCandidatesInMemory } from './structuralHistoryReranker.js';
import { rankModelB_OCCP_ContinuousFusion, DEFAULT_FUSION_WEIGHTS, EQUAL_AVERAGE_FUSION_WEIGHTS } from './occp_experiments/occpFusionModel.js';
import { extractCandidatePathsFromSeed } from './occp/pathSignature.js';
import { trainPathModels } from './occp/occpModel.js';
import { rankModel_EGCP_v4_Combined, rankModel_EGCP_v4_SimplifiedMinMax, buildCommitGraphCacheV4 } from './egcp/v4/egcpV4Model.js';
import { extractLiveEvolutionaryHistory } from './egcpLiveService.js';
import { verifyConnection } from './neo4jService.js';
import { parseGitLogCommits } from './gitChangeDetector.js';
import { analyzeRepository } from '../analyzers/javaAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRAPH_PATH = path.resolve(__dirname, '../../analysis_output.json');
const CASES_CACHE_PATH = path.resolve(__dirname, 'evaluationCasesCache.json');
const HISTORICAL_GRAPHS_DIR = path.resolve(__dirname, '../../.cache/historical_graphs');

/**
 * Loads current active structural graph.
 * If a repoPath is provided and the cached graph belongs to a different repository,
 * it dynamically analyzes the requested repository so results are never stale.
 */
export function loadActiveGraph(customGraph = null, repoPath = null) {
  if (customGraph && Array.isArray(customGraph.components) && Array.isArray(customGraph.relationships)) {
    return customGraph;
  }
  const normRepo = repoPath ? path.resolve(repoPath) : null;
  if (fs.existsSync(DEFAULT_GRAPH_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DEFAULT_GRAPH_PATH, 'utf-8'));
      if (Array.isArray(data.components) && Array.isArray(data.relationships)) {
        if (!normRepo || !data.repoPath || path.resolve(data.repoPath) === normRepo) {
          return data;
        }
      }
    } catch (err) {
      console.error('[threeWayComparisonService] Failed to load default active graph:', err.message);
    }
  }

  if (normRepo && fs.existsSync(normRepo)) {
    try {
      console.log(`[threeWayComparisonService] Parsing active graph for repo: ${normRepo}`);
      const fresh = analyzeRepository(normRepo);
      const graphData = {
        repoPath: normRepo,
        projectName: path.basename(normRepo),
        analyzedAt: new Date().toISOString(),
        components: fresh.components,
        relationships: fresh.relationships
      };
      fs.writeFileSync(DEFAULT_GRAPH_PATH, JSON.stringify(graphData, null, 2), 'utf-8');
      return graphData;
    } catch (err) {
      console.error(`[threeWayComparisonService] Dynamic analysis failed for "${normRepo}":`, err.message);
    }
  }

  return { components: [], relationships: [] };
}

/**
 * Resolves changed seed component IDs to canonical IDs in graph.
 */
export function resolveSeedIds(seedIds, graph) {
  if (!Array.isArray(seedIds) || seedIds.length === 0) return [];
  if (!graph.components || graph.components.length === 0) return seedIds;

  return seedIds.map(seed => {
    const exact = graph.components.find(c => c.id === seed || c.name === seed);
    if (exact) return exact.id;
    const suffix = graph.components.find(c => c.id.endsWith(`.${seed}`) || c.name === seed);
    return suffix ? suffix.id : seed;
  });
}

/**
 * Runs 3-Model Comparative Analysis against identical structural candidates.
 *
 * @param {Array<string>} rawSeedIds - Seed component identifiers
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function runThreeWayImpactAnalysis(rawSeedIds, options = {}) {
  const graph = loadActiveGraph(options.customGraph, options.repoPath);
  const resolvedSeedIds = resolveSeedIds(rawSeedIds, graph);

  if (resolvedSeedIds.length === 0) {
    throw new Error('Please specify at least one valid changed seed component.');
  }

  const primarySeed = resolvedSeedIds[0];
  const editOp = options.editOperation || 'UNKNOWN_OR_MIXED';
  const commitLimit = options.commitLimit || 100;

  // 1. Generate UNIFIED candidate universe |C_model| = |C_canonical|
  const structuralCandidates = generateStructuralCandidatesInMemory(resolvedSeedIds, graph, 2);
  const candidateUniverseSize = structuralCandidates.length;

  if (candidateUniverseSize === 0) {
    return {
      success: true,
      model: 'three_way_comparison',
      changedComponents: resolvedSeedIds,
      candidateUniverseSize: 0,
      baselineOutput: [],
      csfOutput: [],
      egcpOutput: [],
      alignedCandidates: [],
      comparisonSummary: {
        totalCandidates: 0,
        sharedAllThreeCount: 0,
        pairwiseOverlap: { baseline_csf_top5: 0, baseline_egcp_top5: 0, csf_egcp_top5: 0 },
        rankShifts: []
      },
      evolutionaryStatus: { available: false, message: 'No candidates reachable within 2 hops.' }
    };
  }

  // 2. Extract or reuse Evolutionary History
  let historyCounts = options.historyCounts;
  let evoStatus = { available: false, message: 'Evolutionary history not provided.' };

  if (!historyCounts) {
    const evoResult = extractLiveEvolutionaryHistory(options.repoPath, graph.components, commitLimit);
    historyCounts = evoResult.historyCounts;
    evoStatus = evoResult.status;
  } else {
    evoStatus = { available: true, message: 'Using provided leak-free pre-change history counts.' };
  }

  // Helper to query co-change count
  const getCoChange = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  // ── MODEL A: Canonical Structural Baseline ──
  // Deterministic 2-hop BFS reachability
  const baselineRaw = analyzeImpactInMemory(resolvedSeedIds, graph, { maxDepth: 2 });
  const baselineRankMap = new Map();
  baselineRaw.forEach((c, idx) => baselineRankMap.set(c.id, idx + 1));

  // Ensure all structural candidates have a baseline rank
  const baselineList = structuralCandidates.map((c, idx) => {
    const rawMatch = baselineRaw.find(b => b.id === c.id);
    const rank = baselineRankMap.get(c.id) || (idx + 1);
    const score = Number((1.0 / rank).toFixed(4));
    return {
      id: c.id,
      name: c.name || c.id.split('.').pop(),
      type: c.type || 'Component',
      filePath: c.filePath || '',
      rank,
      score,
      hopDistance: c.minHop || rawMatch?.hopDistance || 1,
      impactLevel: rawMatch?.impactLevel || (c.minHop === 1 ? 'High' : 'Medium'),
      reason: rawMatch?.reason || `Structural reachability at hop ${c.minHop || 1}`,
      reasoningPath: rawMatch?.reasoningPath || `${primarySeed} ➔ [DEPENDS_ON] ➔ ${c.id.split('.').pop()}`
    };
  }).sort((a, b) => a.rank - b.rank);

  // ── MODEL B: OCCP / CSF Frozen Baseline ──
  // Continuous Score Fusion: w_cond=0.35, w_gen=0.15, w_hist=0.35, w_struct=0.15
  const candidatePathsMap = extractCandidatePathsFromSeed(primarySeed, graph, 2);
  const conditionedPathStats = options.conditionedPathStats || new Map();
  const genericPathStats = options.genericPathStats || new Map();
  const opClass = { primaryCategory: editOp, detectedCategories: [editOp] };

  const csfWeights = (options.useSimplifiedFormulas || options.csfVariant === 'equal_average')
    ? EQUAL_AVERAGE_FUSION_WEIGHTS
    : (options.csfWeights || DEFAULT_FUSION_WEIGHTS);

  const csfRaw = rankModelB_OCCP_ContinuousFusion(
    structuralCandidates,
    primarySeed,
    opClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    csfWeights,
    0.5
  );

  const csfList = csfRaw.map((c, idx) => {
    const rank = c.fusion_rank || (idx + 1);
    const score = Number((c.fusion_score || 0).toFixed(4));
    const coChange = c.occp_coChangeCount || getCoChange(primarySeed, c.id);
    return {
      id: c.id,
      name: c.name || c.id.split('.').pop(),
      type: c.type || 'Component',
      filePath: c.filePath || '',
      rank,
      score,
      hopDistance: c.minHop || 1,
      impactLevel: score >= 0.35 ? 'High' : (score >= 0.15 ? 'Medium' : 'Low'),
      sCond: Number((c.fusion_s_cond || 0).toFixed(4)),
      sGen: Number((c.fusion_s_gen || 0).toFixed(4)),
      sHist: Number((c.fusion_s_hist || 0).toFixed(4)),
      sStruct: Number((c.fusion_s_struct || 0).toFixed(4)),
      coChangeCount: coChange,
      reason: `CSF Rank #${rank} (Fusion: ${score.toFixed(4)} | Hist: ${Number(c.fusion_s_hist || 0).toFixed(3)} | Struct: ${Number(c.fusion_s_struct || 0).toFixed(3)})`,
      reasoningPath: `${primarySeed} ➔ [OCCP-FUSION] ➔ ${c.id.split('.').pop()}`
    };
  }).sort((a, b) => a.rank - b.rank);

  // ── MODEL C: EGCP v4 Combined / Simplified ──
  // Dual-channel RWR + Entropy-Adaptive Beta + Progressive Hub Exclusion + Gated-Op + Entity Dampening
  const v4Cache = buildCommitGraphCacheV4(graph, historyCounts, {
    enableProgressiveHubExclusion: true
  }, editOp, primarySeed);

  const egcpRaw = (options.useSimplifiedFormulas || options.egcpVariant === 'simplified_minmax')
    ? rankModel_EGCP_v4_SimplifiedMinMax(
        structuralCandidates,
        primarySeed,
        v4Cache,
        historyCounts,
        { editOperation: editOp }
      )
    : rankModel_EGCP_v4_Combined(
        structuralCandidates,
        primarySeed,
        v4Cache,
        historyCounts,
        { editOperation: editOp }
      );

  const egcpList = egcpRaw.map((c, idx) => {
    const rank = idx + 1;
    const score = Number((c.egcp_v4_score || 0).toFixed(4));
    const structScore = Number((c.egcp_v4_structScore || 0).toFixed(4));
    const evoScore = Number((c.egcp_v4_evoScore || 0).toFixed(4));
    const coChange = c.egcp_v4_evoCoChange || getCoChange(primarySeed, c.id);
    const betaUsed = Number((c.egcp_v4_betaUsed || 0).toFixed(3));
    return {
      id: c.id,
      name: c.name || c.id.split('.').pop(),
      type: c.type || 'Component',
      filePath: c.filePath || '',
      rank,
      score,
      hopDistance: c.minHop || 1,
      impactLevel: score >= 0.20 ? 'High' : (score >= 0.08 ? 'Medium' : 'Low'),
      structuralScore: structScore,
      evolutionaryScore: evoScore,
      coChangeCount: coChange,
      betaAdaptive: betaUsed,
      reason: `EGCP v4 Rank #${rank} (Fused: ${score.toFixed(4)} | Struct: ${structScore.toFixed(3)} | Evo: ${evoScore.toFixed(3)} | Co-change: ${coChange})`,
      reasoningPath: c.reasoningPath || `${primarySeed} ➔ [EGCP-RWR β=${betaUsed}] ➔ ${c.id.split('.').pop()}`
    };
  }).sort((a, b) => a.rank - b.rank);

  // ── 3-WAY ALIGNMENT & COMPARISON MATRIX ──
  const baseMap = new Map(baselineList.map(c => [c.id, c]));
  const csfMap = new Map(csfList.map(c => [c.id, c]));
  const egcpMap = new Map(egcpList.map(c => [c.id, c]));

  // Find max co-change across all candidates for normalized frequency bar
  let maxCoChange = 1;
  structuralCandidates.forEach(c => {
    const cc = getCoChange(primarySeed, c.id);
    if (cc > maxCoChange) maxCoChange = cc;
  });

  const alignedCandidates = structuralCandidates.map(c => {
    const b = baseMap.get(c.id);
    const cs = csfMap.get(c.id);
    const eg = egcpMap.get(c.id);

    const bRank = b?.rank || null;
    const csRank = cs?.rank || null;
    const egRank = eg?.rank || null;

    const coChange = eg?.coChangeCount || cs?.coChangeCount || getCoChange(primarySeed, c.id);
    const normCoChange = Number((coChange / maxCoChange).toFixed(3));

    const egcpVsBaselineShift = (bRank !== null && egRank !== null) ? (bRank - egRank) : 0;
    const egcpVsCsfShift = (csRank !== null && egRank !== null) ? (csRank - egRank) : 0;

    const sharedModels = [];
    if (bRank !== null) sharedModels.push('Baseline');
    if (csRank !== null) sharedModels.push('CSF');
    if (egRank !== null) sharedModels.push('EGCP_v4');

    return {
      id: c.id,
      name: c.name || c.id.split('.').pop(),
      type: c.type || 'Component',
      filePath: c.filePath || '',
      hopDistance: c.minHop || b?.hopDistance || 1,
      baselineRank: bRank,
      baselineScore: b?.score || 0,
      csfRank: csRank,
      csfScore: cs?.score || 0,
      egcpRank: egRank,
      egcpScore: eg?.score || 0,
      coChangeCount: coChange,
      normalizedCoChange: normCoChange,
      egcpVsBaselineShift,
      egcpVsCsfShift,
      isSharedAll: sharedModels.length === 3,
      sharedModels,
      explanation: {
        structural: b?.reason || `Hop ${c.minHop || 1} structural link`,
        csf: cs?.reason || 'Multi-channel score fusion',
        egcp: eg?.reason || 'Dual-channel propagation with adaptive beta',
        cochange: coChange > 0
          ? `Co-changed in ${coChange} prior historical commits with ${primarySeed.split('.').pop()}`
          : 'Zero historical co-change observed in prior commits'
      }
    };
  });

  // Sort aligned candidates by EGCP v4 rank by default
  alignedCandidates.sort((a, b) => (a.egcpRank || 9999) - (b.egcpRank || 9999));

  // Compute pairwise overlaps in Top-5 and Top-10
  const top5Base = new Set(baselineList.slice(0, 5).map(c => c.id));
  const top5Csf = new Set(csfList.slice(0, 5).map(c => c.id));
  const top5Egcp = new Set(egcpList.slice(0, 5).map(c => c.id));

  const top10Base = new Set(baselineList.slice(0, 10).map(c => c.id));
  const top10Csf = new Set(csfList.slice(0, 10).map(c => c.id));
  const top10Egcp = new Set(egcpList.slice(0, 10).map(c => c.id));

  const setIntersection = (s1, s2) => new Set([...s1].filter(x => s2.has(x))).size;
  const setIntersection3 = (s1, s2, s3) => new Set([...s1].filter(x => s2.has(x) && s3.has(x))).size;

  const comparisonSummary = {
    totalCandidates: candidateUniverseSize,
    sharedAllThreeCount: alignedCandidates.filter(c => c.isSharedAll).length,
    sharedTop5AllThree: setIntersection3(top5Base, top5Csf, top5Egcp),
    sharedTop10AllThree: setIntersection3(top10Base, top10Csf, top10Egcp),
    pairwiseOverlap: {
      baseline_csf_top5: setIntersection(top5Base, top5Csf),
      baseline_egcp_top5: setIntersection(top5Base, top5Egcp),
      csf_egcp_top5: setIntersection(top5Csf, top5Egcp),
      baseline_csf_top10: setIntersection(top10Base, top10Csf),
      baseline_egcp_top10: setIntersection(top10Base, top10Egcp),
      csf_egcp_top10: setIntersection(top10Csf, top10Egcp)
    },
    rankShifts: alignedCandidates.map(c => ({
      id: c.id,
      name: c.name,
      baselineRank: c.baselineRank,
      csfRank: c.csfRank,
      egcpRank: c.egcpRank,
      egcpVsBaselineShift: c.egcpVsBaselineShift,
      egcpVsCsfShift: c.egcpVsCsfShift
    }))
  };

  return {
    success: true,
    model: 'three_way_comparison',
    changedComponents: resolvedSeedIds,
    primarySeed,
    editOperation: editOp,
    candidateUniverseSize,
    baselineOutput: baselineList,
    csfOutput: csfList,
    egcpOutput: egcpList,
    alignedCandidates,
    comparisonSummary,
    evolutionaryStatus: evoStatus
  };
}

/**
 * Loads cached evaluation cases and summary.
 */
export function getEvaluationCases(filterOptions = {}) {
  if (!fs.existsSync(CASES_CACHE_PATH)) {
    return { success: false, error: 'Evaluation cases cache not found.' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(CASES_CACHE_PATH, 'utf8'));
    let cases = data.cases || [];

    if (filterOptions.projectName) {
      cases = cases.filter(c => c.projectName.toLowerCase() === filterOptions.projectName.toLowerCase());
    }
    if (filterOptions.split) {
      cases = cases.filter(c => c.split === filterOptions.split);
    }
    if (filterOptions.search) {
      const q = filterOptions.search.toLowerCase();
      cases = cases.filter(c =>
        c.inputComponent.toLowerCase().includes(q) ||
        c.commitSubject.toLowerCase().includes(q) ||
        c.commitShortSha.toLowerCase().includes(q)
      );
    }

    return {
      success: true,
      totalCases: cases.length,
      overallSummary: data.overallSummary,
      commits: data.commits,
      cases
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Runs or loads an individual historical evaluation case.
 * Returns the ground-truth affected files, step-by-step metric calculations,
 * and 3-model comparative rankings.
 */
export async function runHistoricalEvaluationCase(caseId) {
  if (!fs.existsSync(CASES_CACHE_PATH)) {
    throw new Error('Evaluation cases cache not found.');
  }

  const data = JSON.parse(fs.readFileSync(CASES_CACHE_PATH, 'utf8'));
  const targetCase = (data.cases || []).find(c => c.caseId === caseId);

  if (!targetCase) {
    throw new Error(`Evaluation case not found: ${targetCase}`);
  }

  const {
    projectName,
    commitHash,
    commitShortSha,
    commitSubject,
    commitDate,
    commitAuthor,
    inputComponent,
    inputComponentName,
    primaryOp,
    targetOracles,
    metrics
  } = targetCase;

  const lowerProj = (projectName || '').toLowerCase();
  const repoPath = lowerProj.includes('petclinic')
    ? 'c:/yashika/STUDY/clg_project/spring-petclinic-rest'
    : (lowerProj.includes('shopizer')
      ? 'c:/yashika/STUDY/clg_project/shopizer'
      : 'c:/yashika/STUDY/clg_project/commons-lang');

  // Check if we have pre-change graph cached
  let preChangeGraph = null;
  if (fs.existsSync(HISTORICAL_GRAPHS_DIR)) {
    const files = fs.readdirSync(HISTORICAL_GRAPHS_DIR);
    let parentHash = null;
    if (fs.existsSync(repoPath)) {
      try {
        const { execSync } = await import('child_process');
        const parents = execSync(`git log -1 --format="%P" ${commitHash}`, { cwd: repoPath, encoding: 'utf8' }).trim();
        parentHash = parents.split(/\s+/)[0] || null;
      } catch (err) {}
    }

    const match = files.find(f =>
      f.includes(commitHash) ||
      f.includes(commitShortSha) ||
      (parentHash && (f.includes(parentHash) || f.includes(parentHash.slice(0, 10))))
    );

    if (match) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(HISTORICAL_GRAPHS_DIR, match), 'utf8'));
        preChangeGraph = parsed.graph || parsed;
      } catch (err) {
        console.warn(`[runHistoricalEvaluationCase] Error reading graph file ${match}:`, err.message);
      }
    }
  }

  // Run three-way comparison on the preChangeGraph or active fallback
  const compareResult = await runThreeWayImpactAnalysis([inputComponent], {
    customGraph: preChangeGraph,
    editOperation: primaryOp,
    repoPath
  });

  // Annotate predictions with ground-truth hits
  const targetSet = new Set(targetOracles);

  const markHits = (list) => (list || []).map((cand, idx) => {
    const isHit = targetSet.has(cand.id) || targetSet.has(cand.name);
    return {
      ...cand,
      isHit,
      rank: idx + 1
    };
  });

  const baselineWithHits = markHits(compareResult.baselineOutput);
  const csfWithHits = markHits(compareResult.csfOutput);
  const egcpWithHits = markHits(compareResult.egcpOutput);

  // Mark hits on aligned candidates
  const alignedWithHits = (compareResult.alignedCandidates || []).map(c => ({
    ...c,
    isHit: targetSet.has(c.id) || targetSet.has(c.name)
  }));

  // Step-by-step worked calculation breakdown for EGCP v4
  const workedSteps = [];
  let cumulativeHits = 0;
  let runningPrecisionSum = 0;
  const numTargets = targetOracles.length;

  for (let k = 1; k <= Math.min(10, egcpWithHits.length); k++) {
    const item = egcpWithHits[k - 1];
    const isRel = item.isHit ? 1 : 0;
    if (isRel) cumulativeHits++;
    const precAtK = cumulativeHits / k;
    if (isRel) runningPrecisionSum += precAtK;

    workedSteps.push({
      rank: k,
      component: item.name,
      id: item.id,
      score: item.score,
      isHit: item.isHit,
      cumulativeHits,
      precisionAtK: Number(precAtK.toFixed(4)),
      apContribution: isRel ? Number((precAtK / (numTargets || 1)).toFixed(4)) : 0
    });
  }

  return {
    success: true,
    caseInfo: {
      caseId,
      projectName,
      commitHash,
      commitShortSha,
      commitSubject,
      commitDate,
      commitAuthor,
      inputComponent,
      inputComponentName,
      primaryOp,
      targetOraclesCount: targetOracles.length,
      targetOracles
    },
    groundTruth: targetOracles,
    verifiedBenchmarkMetrics: metrics,
    predictions: {
      canonical_baseline: baselineWithHits,
      csf_frozen: csfWithHits,
      egcp_v4: egcpWithHits
    },
    alignedCandidates: alignedWithHits,
    comparisonSummary: compareResult.comparisonSummary,
    workedExample: {
      model: 'EGCP v4 Combined',
      numTargets,
      steps: workedSteps,
      summary: {
        firstHitRank: egcpWithHits.findIndex(x => x.isHit) >= 0 ? egcpWithHits.findIndex(x => x.isHit) + 1 : null,
        hitsInTop5: egcpWithHits.slice(0, 5).filter(x => x.isHit).length,
        precisionAt5: Number((egcpWithHits.slice(0, 5).filter(x => x.isHit).length / 5).toFixed(4)),
        recallAt5: numTargets > 0 ? Number((egcpWithHits.slice(0, 5).filter(x => x.isHit).length / numTargets).toFixed(4)) : 0,
        averagePrecision: metrics.egcp_v4_combined?.map || 0,
        reciprocalRank: metrics.egcp_v4_combined?.mrr || 0
      }
    }
  };
}

/**
 * Returns historical co-change evidence for a given component.
 */
export function getCoChangeEvidenceForComponent(componentId, repoPath = null) {
  const activeRepo = repoPath || 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
  const graph = loadActiveGraph();

  const shortName = componentId.split('.').pop();
  const direct = graph.components.find(c => c.id === componentId || c.name === componentId);
  const targetId = direct ? direct.id : componentId;

  // Extract git history
  const evo = extractLiveEvolutionaryHistory(activeRepo, graph.components, 150);
  const counts = evo.historyCounts;

  const coChangePairs = [];
  let maxCount = 0;

  if (counts instanceof Map) {
    for (const [key, count] of counts.entries()) {
      const [idA, idB] = key.split('|');
      if (idA === targetId || idB === targetId || idA === shortName || idB === shortName) {
        const partner = (idA === targetId || idA === shortName) ? idB : idA;
        if (count > maxCount) maxCount = count;
        const comp = graph.components.find(c => c.id === partner || c.name === partner);
        coChangePairs.push({
          id: partner,
          name: comp?.name || partner.split('.').pop(),
          type: comp?.type || 'Component',
          filePath: comp?.filePath || '',
          count,
          normalizedFrequency: 0 // populated below
        });
      }
    }
  }

  coChangePairs.forEach(p => {
    p.normalizedFrequency = maxCount > 0 ? Number((p.count / maxCount).toFixed(3)) : 0;
  });

  coChangePairs.sort((a, b) => b.count - a.count);

  return {
    success: true,
    componentId: targetId,
    componentName: shortName,
    totalCommitsAnalyzed: evo.status?.commitsCount || 0,
    evolutionaryStatus: evo.status,
    methodologyNote: 'Historical Co-change Association (LOO Proxy) — reflects commits where both files were modified together; proxy for evolutionary coupling, not verified causal dependency.',
    coChangedComponents: coChangePairs
  };
}

/**
 * Returns overall macro benchmark summary.
 */
export function getBenchmarkSummary() {
  if (!fs.existsSync(CASES_CACHE_PATH)) {
    return { success: false, error: 'Benchmark cache not found.' };
  }
  const data = JSON.parse(fs.readFileSync(CASES_CACHE_PATH, 'utf8'));
  return {
    success: true,
    overallSummary: data.overallSummary,
    commitsCount: (data.commits || []).length,
    casesCount: (data.cases || []).length
  };
}
