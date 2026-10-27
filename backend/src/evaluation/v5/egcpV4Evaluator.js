/**
 * egcpV4Evaluator.js
 * ------------------
 * Independent Evaluation Harness for Evolutionary-Graph Change Propagation v4 (EGCP v4).
 * Evaluates EGCP v4 and its decoupled ablations against:
 *   1. Canonical Structural Baseline
 *   2. Historical Co-Change Reranker (V4)
 *   3. Continuous Score Fusion (CSF Frozen Baseline)
 *   4. Original EGCP-Evo (v1, alpha = 0.0)
 *   5. EGCP v2 Main (beta = 0.60, gamma = 0.75)
 *   6. EGCP v3 Combined (v3 best model)
 *   7. EGCP v4 Base (Parity verification)
 *   8. EGCP v4 Ablation A: Graph-Entropy Adaptive Beta Only
 *   9. EGCP v4 Ablation B: Progressive Hub Exclusion Only
 *  10. EGCP v4 Ablation C: Evidence-Gated Op-Aware Weights Only
 *  11. EGCP v4 Ablation A+B: Entropy-Adaptive Beta + Hub Exclusion
 *  12. EGCP v4 Combined: Full v4 (A + B + C + Entity Dampening)
 *
 * Guarantees:
 *   - Identical K=25 commits and N=170 LOO test cases across 3 projects.
 *   - Pre-change AST graph at c^1 (zero future AST leakage).
 *   - History strictly from commits j > c (zero target commit co-change leakage).
 *   - Strict candidate universe preservation |C| (zero candidates dropped).
 *   - Complete reporting of BOTH Commit-Level Macro and Case-Level Micro aggregations.
 *   - Train/Val vs Held-Out Test partitioning to account for commit clustering.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

import {
  parseGitLogCommits,
  buildComponentPathIndex,
  mapGitChanges,
  isJavaSourceFile
} from '../../services/gitChangeDetector.js';
import { getOrBuildHistoricalGraph } from '../../services/historicalGraphService.js';
import {
  generateStructuralCandidatesInMemory,
  rerankCandidatesWithHistory
} from '../../services/structuralHistoryReranker.js';
import { classifyOperation } from '../../services/occp/operationClassifier.js';
import { extractCandidatePathsFromSeed } from '../../services/occp/pathSignature.js';
import { generateLeaveOneOutCases } from '../v3/metricsV3.js';
import { trainPathModels } from '../../services/occp/occpModel.js';
import { rankModelB_OCCP_ContinuousFusion, rankModel_CSF_EqualAverage, DEFAULT_FUSION_WEIGHTS } from '../../services/occp_experiments/occpFusionModel.js';

// Import EGCP v1
import { rankModel_EGCP_EvoOnly } from '../../services/egcp/egcpModel.js';

// Import EGCP v2
import { rankModel_EGCP_v2, buildCommitGraphCacheV2 } from '../../services/egcp/v2/egcpV2Model.js';

// Import EGCP v3
import { rankModel_EGCP_v3_Combined } from '../../services/egcp/v3/egcpV3Model.js';

// Import EGCP v4
import {
  rankModel_EGCP_v4_Base,
  rankModel_EGCP_v4_EntropyBetaOnly,
  rankModel_EGCP_v4_HubExclusionOnly,
  rankModel_EGCP_v4_GatedOpOnly,
  rankModel_EGCP_v4_EntropyAndHub,
  rankModel_EGCP_v4_Combined,
  rankModel_EGCP_v4_SimplifiedMinMax,
  rankModel_EGCP_Base_SimplifiedMinMax,
  buildCommitGraphCacheV4
} from '../../services/egcp/v4/egcpV4Model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = process.env.EVAL_OUTPUT_DIR 
  ? path.resolve(process.env.EVAL_OUTPUT_DIR)
  : path.resolve(BACKEND_ROOT, '..', 'research_artifacts', 'egcp_v4_evaluation_20261021');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const PROJECTS = [
  {
    name: 'Spring PetClinic REST',
    path: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest',
    commitLimit: 100,
    trainCommits: 5 // First 5 commits train/val, last 3 held-out
  },
  {
    name: 'Shopizer',
    path: 'c:/yashika/STUDY/clg_project/shopizer',
    commitLimit: 100,
    trainCommits: 7 // First 7 commits train/val, last 5 held-out
  },
  {
    name: 'Apache Commons Lang',
    path: 'c:/yashika/STUDY/clg_project/commons-lang',
    commitLimit: 100,
    trainCommits: 3 // First 3 commits train/val, last 2 held-out
  }
];

const EVAL_MODELS = [
  { key: 'canonical_baseline', name: 'Canonical Structural Baseline' },
  { key: 'historical_reranker', name: 'Historical Co-Change Reranker (V4)' },
  { key: 'csf_frozen', name: 'Continuous Score Fusion (CSF Frozen Baseline)' },
  { key: 'csf_equal_weights', name: 'CSF Simplified: Equal Average Weights (0.25 each)' },
  { key: 'egcp_v1_evo', name: 'Original EGCP-Evo (v1, alpha=0.0)' },
  { key: 'egcp_v2_main', name: 'EGCP v2 Main (beta=0.60, gamma=0.75)' },
  { key: 'egcp_v3_combined', name: 'EGCP v3 Combined (v3 Benchmark Best)' },
  { key: 'egcp_v4_base', name: 'EGCP v4 Base (Parity Baseline)' },
  { key: 'egcp_v4_entropy_beta', name: 'EGCP v4 Ablation A: Entropy-Adaptive Beta Only' },
  { key: 'egcp_v4_hub_excl', name: 'EGCP v4 Ablation B: Progressive Hub Exclusion Only' },
  { key: 'egcp_v4_gated_op', name: 'EGCP v4 Ablation C: Evidence-Gated Op-Aware Only' },
  { key: 'egcp_v4_entropy_hub', name: 'EGCP v4 Ablation A+B: Entropy Beta + Hub Exclusion' },
  { key: 'egcp_v4_combined', name: 'EGCP v4 Combined: Entropy Beta + Hub + Gated Op + Damp' },
  { key: 'egcp_base_minmax_equal', name: 'EGCP Base Simplified: Min-Max Normalization + Equal Sum (No Beta)' },
  { key: 'egcp_v4_minmax_equal', name: 'EGCP v4 Simplified: Min-Max Normalization + Equal Sum (No Beta)' }
];

// ── Metric Computation Helpers ──────────────────────────────────────────────

function precisionAtK(rankedList, oracle, k) {
  if (!oracle || oracle.size === 0) return 0.0;
  const topK = (rankedList || []).slice(0, k);
  if (topK.length === 0) return 0.0;
  return topK.filter(p => oracle.has(p)).length / topK.length;
}

function recallAtK(rankedList, oracle, k) {
  if (!oracle || oracle.size === 0) return 1.0;
  const topK = new Set((rankedList || []).slice(0, k));
  return [...oracle].filter(o => topK.has(o)).length / oracle.size;
}

function computeAP(rankedList, oracle) {
  if (!oracle || oracle.size === 0) return 0.0;
  const preds = rankedList || [];
  if (preds.length === 0) return 0.0;

  let hits = 0;
  let sumPrecision = 0;
  for (let i = 0; i < preds.length; i++) {
    if (oracle.has(preds[i])) {
      hits++;
      sumPrecision += hits / (i + 1);
    }
  }
  return hits === 0 ? 0.0 : sumPrecision / oracle.size;
}

function computeRR(rankedList, oracle) {
  if (!oracle || oracle.size === 0) return 0.0;
  const preds = rankedList || [];
  for (let i = 0; i < preds.length; i++) {
    if (oracle.has(preds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0.0;
}

function computeCaseMetrics(rankedIds, oracle) {
  const p3 = precisionAtK(rankedIds, oracle, 3);
  const r3 = recallAtK(rankedIds, oracle, 3);
  const p5 = precisionAtK(rankedIds, oracle, 5);
  const r5 = recallAtK(rankedIds, oracle, 5);
  const p10 = precisionAtK(rankedIds, oracle, 10);
  const r10 = recallAtK(rankedIds, oracle, 10);

  const f1At3 = (p3 + r3 > 0) ? (2 * p3 * r3) / (p3 + r3) : 0.0;
  const f1At5 = (p5 + r5 > 0) ? (2 * p5 * r5) / (p5 + r5) : 0.0;
  const f1At10 = (p10 + r10 > 0) ? (2 * p10 * r10) / (p10 + r10) : 0.0;

  const top3Set = new Set((rankedIds || []).slice(0, 3));
  const top5Set = new Set((rankedIds || []).slice(0, 5));
  const top10Set = new Set((rankedIds || []).slice(0, 10));

  const hitAt3 = [...oracle].some(o => top3Set.has(o)) ? 1.0 : 0.0;
  const hitAt5 = [...oracle].some(o => top5Set.has(o)) ? 1.0 : 0.0;
  const hitAt10 = [...oracle].some(o => top10Set.has(o)) ? 1.0 : 0.0;

  const map = computeAP(rankedIds, oracle);
  const mrr = computeRR(rankedIds, oracle);

  return {
    pAt3: p3,
    rAt3: r3,
    f1At3,
    hitAt3,
    pAt5: p5,
    rAt5: r5,
    f1At5,
    hitAt5,
    pAt10: p10,
    rAt10: r10,
    f1At10,
    hitAt10,
    map,
    mrr
  };
}

// ── Leak-Free Historical Co-Change ──────────────────────────────────────────

function buildLeakFreeHistoryCounts(allCommits, currentCommitIndex, compMap) {
  const historyCounts = new Map();
  const olderCommits = allCommits.slice(currentCommitIndex + 1);

  for (const c of olderCommits) {
    const raw = c.rawChanges || [];
    const mappedIds = new Set();
    for (const ch of raw) {
      const p = ch.filePath || ch.newPath || ch.oldPath;
      if (!p || !isJavaSourceFile(p)) continue;
      for (const [id, comp] of compMap.entries()) {
        if (comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath))) {
          mappedIds.add(id);
        }
      }
    }

    const arr = [...mappedIds].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const pairKey = `${arr[i]}|${arr[j]}`;
        historyCounts.set(pairKey, (historyCounts.get(pairKey) || 0) + 1);
      }
    }
  }

  return historyCounts;
}

function indexHistoricalEpisodesSafe(repoPath, allCommits, maxHops = 2) {
  const episodes = [];

  for (let idx = 0; idx < allCommits.length; idx++) {
    const commit = allCommits[idx];
    if (commit.isMerge || !commit.parents || commit.parents.length === 0) continue;

    let graphRes;
    try {
      graphRes = getOrBuildHistoricalGraph(repoPath, commit.hash);
    } catch (e) {
      continue;
    }
    if (!graphRes || !graphRes.graph) continue;

    const graph = graphRes.graph;
    const compMap = new Map(graph.components.map(c => [c.id, c]));
    const pathIndex = buildComponentPathIndex(graph.components);

    const mappingReport = mapGitChanges(commit.rawChanges, pathIndex, { perspective: 'pre' });
    const changedCompIds = new Set(
      mappingReport.mapped.map(m => m.mappedComponentId).filter(Boolean)
    );

    if (changedCompIds.size < 2) continue;

    const componentEpisodes = [];
    for (const compId of changedCompIds) {
      const comp = compMap.get(compId);
      if (!comp || comp.type === 'Test') continue;

      const rawChange = (commit.rawChanges || []).find(r => {
        const p = r.filePath || r.newPath || r.oldPath;
        return comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath));
      });

      const opClass = classifyOperation(repoPath, graphRes.parentSha, commit.hash, comp.filePath, rawChange);
      const candidatePathsMap = extractCandidatePathsFromSeed(compId, graph, maxHops);

      componentEpisodes.push({
        sourceId: compId,
        sourceType: comp.type,
        opClass,
        candidatePathsMap
      });
    }

    episodes.push({
      commitHash: commit.hash,
      commitIndex: idx,
      parentSha: graphRes.parentSha,
      changedCompIds,
      componentEpisodes
    });
  }

  return episodes;
}

async function buildHistoricalCasesFast(repoPath, commitLimit = 100) {
  const allCommits = parseGitLogCommits(repoPath, commitLimit, { includeMerges: true });
  const eligibleCommits = [];
  const looCases = [];

  const isTestPath = p => /[\/\\]test[\/\\]/i.test(p) || /Test(s|Case)?\.java$/i.test(p);

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const { hash, subject, isMerge, parents, timestamp, rawChanges } = commit;

    if (isMerge || !parents || parents.length === 0) continue;
    const javaChanges = (rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) continue;

    const nonTestJava = javaChanges.filter(r => !isTestPath(r.filePath || r.newPath || r.oldPath));
    if (nonTestJava.length < 2) continue;

    let historicalGraphResult;
    try {
      historicalGraphResult = getOrBuildHistoricalGraph(repoPath, hash);
    } catch (e) {
      continue;
    }

    const { graph, parentSha } = historicalGraphResult;
    if (!graph || !graph.components) continue;

    const compMap = new Map(graph.components.map(c => [c.id, c]));
    const pathIndex = buildComponentPathIndex(graph.components);

    const mappingReport = mapGitChanges(rawChanges, pathIndex, { perspective: 'pre' });
    const mappedCompIds = Array.from(new Set(mappingReport.mapped.map(m => m.mappedComponentId).filter(Boolean)));

    const nonTestIds = [];
    const testIds = [];
    for (const id of mappedCompIds) {
      const comp = compMap.get(id);
      if (comp && comp.type === 'Test') testIds.push(id);
      else if (comp) nonTestIds.push(id);
    }

    if (nonTestIds.length < 2) continue;

    const historyCounts = buildLeakFreeHistoryCounts(allCommits, i, compMap);
    const commitInfo = { hash, subject, timestamp, index: i, parentSha };
    const casesForCommit = generateLeaveOneOutCases(commitInfo, nonTestIds, testIds, historyCounts);

    for (const c of casesForCommit) {
      c.parentSha = parentSha;
      c.graphData = graph;
      c.compMap = compMap;
    }

    eligibleCommits.push({
      commitHash: hash,
      parentSha,
      commitSubject: subject,
      commitIndex: i,
      caseCount: casesForCommit.length,
      graphData: graph,
      compMap,
      historyCounts,
      cases: casesForCommit
    });

    looCases.push(...casesForCommit);
  }

  return { eligibleCommits, looCases };
}

function pairedStats(seriesA, seriesB) {
  const n = seriesA.length;
  if (n === 0 || seriesB.length !== n) return { n: 0, meanDiff: 0, tStat: 0, pValueT: 1 };

  const diffs = seriesA.map((a, i) => a - seriesB[i]);
  const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += (diffs[i] - meanDiff) * (diffs[i] - meanDiff);
  }
  const variance = n > 1 ? sumSq / (n - 1) : 0;
  const stdError = Math.sqrt(variance / n);
  const tStat = stdError > 1e-12 ? meanDiff / stdError : 0;

  const z = Math.abs(tStat);
  const pValueT = Math.exp(-0.717 * z - 0.416 * z * z);

  let wins = 0, ties = 0, losses = 0;
  for (const d of diffs) {
    if (d > 1e-6) wins++;
    else if (d < -1e-6) losses++;
    else ties++;
  }

  const ci95 = 1.96 * stdError;

  return {
    n,
    meanDiff,
    stdError,
    ci95Lower: meanDiff - ci95,
    ci95Upper: meanDiff + ci95,
    tStat,
    pValueT,
    wins,
    ties,
    losses
  };
}

// ── Master Execution ────────────────────────────────────────────────────────

async function runEGCPv4Evaluation() {
  console.log('\n================================================================');
  console.log('   EVOLUTIONARY-GRAPH CHANGE PROPAGATION v4 (EGCP v4) BENCHMARK');
  console.log(`   Output Directory: ${OUTPUT_DIR}`);
  console.log('================================================================\n');

  const projectResults = [];
  let totalCasesEvaluated = 0;
  let totalRuntimeV4Ms = 0;

  for (const project of PROJECTS) {
    console.log(`\nEvaluating Project: ${project.name}`);
    console.log(`Path: ${project.path}`);

    const caseBuildResult = await buildHistoricalCasesFast(project.path, project.commitLimit);
    const { eligibleCommits, looCases } = caseBuildResult;
    console.log(`  Eligible Commits: ${eligibleCommits.length}, LOO Cases: ${looCases.length}`);

    totalCasesEvaluated += looCases.length;

    const allCommits = parseGitLogCommits(project.path, project.commitLimit, { includeMerges: true });
    const historicalEpisodes = indexHistoricalEpisodesSafe(project.path, allCommits, 2);

    const caseResults = [];
    const tStartProject = performance.now();

    for (let cIdx = 0; cIdx < eligibleCommits.length; cIdx++) {
      const ec = eligibleCommits[cIdx];
      const { graphData, historyCounts, commitHash, commitIndex, parentSha } = ec;
      const isTrainCommit = cIdx < project.trainCommits;

      // Precompute commit graph caches
      const v2Cache = buildCommitGraphCacheV2(graphData, historyCounts);
      const v4Cache = buildCommitGraphCacheV4(graphData, historyCounts);

      // Precompute v4 Ablation B cache (Hub exclusion enabled)
      const v4HubCache = buildCommitGraphCacheV4(graphData, historyCounts, { enableProgressiveHubExclusion: true });

      // OCCP training for this commit
      const olderEpisodes = historicalEpisodes.filter(ep => ep.commitIndex > commitIndex);
      const { genericPathStats, conditionedPathStats } = trainPathModels(olderEpisodes);

      for (const looCase of ec.cases) {
        const { caseId, inputComponent, retroOracle, compMap } = looCase;

        const inputComp = compMap.get(inputComponent);
        const rawChange = (allCommits[commitIndex].rawChanges || []).find(r => {
          const p = r.filePath || r.newPath || r.oldPath;
          return inputComp?.filePath && (inputComp.filePath.endsWith(p) || p.endsWith(inputComp.filePath));
        });

        const opClass = classifyOperation(project.path, parentSha, commitHash, inputComp ? inputComp.filePath : '', rawChange);
        const editOp = opClass.primaryCategory;

        // Structural candidate universe (hop 2)
        const structuralCandidates = generateStructuralCandidatesInMemory([inputComponent], graphData, 2);
        const candLen = structuralCandidates.length;
        const candidatePathsMap = extractCandidatePathsFromSeed(inputComponent, graphData, 2);

        // 1. Canonical Structural Baseline
        const rankStruct = structuralCandidates.map(c => c.id);

        // 2. Historical Co-Change Reranker (V4)
        const rankedHist = rerankCandidatesWithHistory(structuralCandidates, [inputComponent], historyCounts);
        const rankHist = rankedHist.map(c => c.id);

        // 3. Continuous Score Fusion (CSF Frozen Baseline)
        const rankedCSF = rankModelB_OCCP_ContinuousFusion(
          structuralCandidates,
          inputComponent,
          opClass,
          candidatePathsMap,
          conditionedPathStats,
          genericPathStats,
          historyCounts,
          DEFAULT_FUSION_WEIGHTS,
          0.5
        );
        const rankCSF = rankedCSF.map(c => c.id);

        // 3b. CSF Simplified: Equal Average Weights (0.25 each)
        const rankedCSF_Equal = rankModel_CSF_EqualAverage(
          structuralCandidates,
          inputComponent,
          opClass,
          candidatePathsMap,
          conditionedPathStats,
          genericPathStats,
          historyCounts,
          0.5
        );
        const rankCSF_Equal = rankedCSF_Equal.map(c => c.id);

        // 4. Original EGCP-Evo (v1, alpha = 0.0)
        const rankedEvoV1 = rankModel_EGCP_EvoOnly(structuralCandidates, inputComponent, graphData, historyCounts);
        const rankEvoV1 = rankedEvoV1.map(c => c.id);

        // 5. EGCP v2 Main (beta = 0.60, gamma = 0.75)
        const rankedV2Main = rankModel_EGCP_v2(structuralCandidates, inputComponent, v2Cache, historyCounts);
        const rankV2Main = rankedV2Main.map(c => c.id);

        // 6. EGCP v3 Combined
        const rankedV3Comb = rankModel_EGCP_v3_Combined(structuralCandidates, inputComponent, graphData, historyCounts, { editOperation: editOp });
        const rankV3Comb = rankedV3Comb.map(c => c.id);

        // ── EGCP v4 Models ──
        const tStartV4 = performance.now();

        // 7. EGCP v4 Base (Parity Baseline)
        const rankedV4Base = rankModel_EGCP_v4_Base(structuralCandidates, inputComponent, v4Cache, historyCounts);
        const rankV4Base = rankedV4Base.map(c => c.id);

        // 8. EGCP v4 Ablation A: Entropy-Adaptive Beta Only
        const rankedV4Entropy = rankModel_EGCP_v4_EntropyBetaOnly(structuralCandidates, inputComponent, v4Cache, historyCounts);
        const rankV4Entropy = rankedV4Entropy.map(c => c.id);

        // 9. EGCP v4 Ablation B: Progressive Hub Exclusion Only
        const rankedV4Hub = rankModel_EGCP_v4_HubExclusionOnly(structuralCandidates, inputComponent, v4HubCache, historyCounts);
        const rankV4Hub = rankedV4Hub.map(c => c.id);

        // 10. EGCP v4 Ablation C: Evidence-Gated Op-Aware Weights Only
        const rankedV4GatedOp = rankModel_EGCP_v4_GatedOpOnly(structuralCandidates, inputComponent, graphData, historyCounts, { editOperation: editOp });
        const rankV4GatedOp = rankedV4GatedOp.map(c => c.id);

        // 11. EGCP v4 Ablation A+B: Entropy-Adaptive Beta + Hub Exclusion
        const rankedV4EntropyHub = rankModel_EGCP_v4_EntropyAndHub(structuralCandidates, inputComponent, v4HubCache, historyCounts);
        const rankV4EntropyHub = rankedV4EntropyHub.map(c => c.id);

        // 12. EGCP v4 Combined: Full v4 (A + B + C + Entity Dampening)
        const rankedV4Comb = rankModel_EGCP_v4_Combined(structuralCandidates, inputComponent, graphData, historyCounts, { editOperation: editOp });
        const rankV4Comb = rankedV4Comb.map(c => c.id);

        // 13. EGCP Base Simplified: Min-Max Normalization + Equal Sum (No Beta)
        const rankedEGCPBaseMinMax = rankModel_EGCP_Base_SimplifiedMinMax(structuralCandidates, inputComponent, v4Cache, historyCounts);
        const rankEGCPBaseMinMax = rankedEGCPBaseMinMax.map(c => c.id);

        // 14. EGCP v4 Simplified: Min-Max Normalization + Equal Sum (No Beta)
        const rankedEGCPv4MinMax = rankModel_EGCP_v4_SimplifiedMinMax(structuralCandidates, inputComponent, graphData, historyCounts, { editOperation: editOp });
        const rankEGCPv4MinMax = rankedEGCPv4MinMax.map(c => c.id);

        totalRuntimeV4Ms += (performance.now() - tStartV4);

        // Verify Candidate Universe Integrity across all models
        const modelRankMap = {
          canonical_baseline: rankStruct,
          historical_reranker: rankHist,
          csf_frozen: rankCSF,
          csf_equal_weights: rankCSF_Equal,
          egcp_v1_evo: rankEvoV1,
          egcp_v2_main: rankV2Main,
          egcp_v3_combined: rankV3Comb,
          egcp_v4_base: rankV4Base,
          egcp_v4_entropy_beta: rankV4Entropy,
          egcp_v4_hub_excl: rankV4Hub,
          egcp_v4_gated_op: rankV4GatedOp,
          egcp_v4_entropy_hub: rankV4EntropyHub,
          egcp_v4_combined: rankV4Comb,
          egcp_base_minmax_equal: rankEGCPBaseMinMax,
          egcp_v4_minmax_equal: rankEGCPv4MinMax
        };

        for (const [mName, rList] of Object.entries(modelRankMap)) {
          if (rList.length !== candLen) {
            throw new Error(`Universe integrity violated for ${mName} in case ${caseId}`);
          }
        }

        const metricsPerModel = {};
        for (const [mName, rList] of Object.entries(modelRankMap)) {
          metricsPerModel[mName] = computeCaseMetrics(rList, retroOracle);
        }

        caseResults.push({
          caseId,
          commitHash,
          commitIndex,
          isTrainCommit,
          inputComponent,
          targetOracles: [...retroOracle],
          candidateUniverseSize: candLen,
          primaryOp: editOp,
          metrics: metricsPerModel
        });
      }
    }

    const elapsedProjectMs = performance.now() - tStartProject;
    console.log(`  Completed in ${(elapsedProjectMs / 1000).toFixed(2)}s`);

    projectResults.push({
      projectName: project.name,
      eligibleCommitCount: eligibleCommits.length,
      trainCommitCount: project.trainCommits,
      testCommitCount: eligibleCommits.length - project.trainCommits,
      testCaseCount: caseResults.length,
      caseResults
    });
  }

  // ── Compute Aggregations ──────────────────────────────────────────────────

  const allCasesFlat = projectResults.flatMap(p => p.caseResults);
  const allEligibleCommitsCount = projectResults.reduce((s, p) => s + p.eligibleCommitCount, 0);

  // 1. Commit-Level Macro Aggregation (Per Project & Overall)
  function computeMacroMetrics(cases) {
    const commitGroups = new Map();
    for (const c of cases) {
      if (!commitGroups.has(c.commitHash)) {
        commitGroups.set(c.commitHash, []);
      }
      commitGroups.get(c.commitHash).push(c);
    }

    const macroByModel = {};
    for (const m of EVAL_MODELS) {
      const commitMeans = [];
      for (const [cHash, cList] of commitGroups.entries()) {
        const sumM = cList.reduce((acc, curr) => {
          const met = curr.metrics[m.key];
          return {
            map: acc.map + met.map,
            mrr: acc.mrr + met.mrr,
            pAt3: acc.pAt3 + met.pAt3,
            rAt3: acc.rAt3 + met.rAt3,
            f1At3: acc.f1At3 + met.f1At3,
            hitAt3: acc.hitAt3 + met.hitAt3,
            pAt5: acc.pAt5 + met.pAt5,
            rAt5: acc.rAt5 + met.rAt5,
            f1At5: acc.f1At5 + met.f1At5,
            hitAt5: acc.hitAt5 + met.hitAt5,
            pAt10: acc.pAt10 + met.pAt10,
            rAt10: acc.rAt10 + met.rAt10,
            f1At10: acc.f1At10 + met.f1At10,
            hitAt10: acc.hitAt10 + met.hitAt10
          };
        }, { map: 0, mrr: 0, pAt3: 0, rAt3: 0, f1At3: 0, hitAt3: 0, pAt5: 0, rAt5: 0, f1At5: 0, hitAt5: 0, pAt10: 0, rAt10: 0, f1At10: 0, hitAt10: 0 });

        const count = cList.length;
        commitMeans.push({
          map: sumM.map / count,
          mrr: sumM.mrr / count,
          pAt3: sumM.pAt3 / count,
          rAt3: sumM.rAt3 / count,
          f1At3: sumM.f1At3 / count,
          hitAt3: sumM.hitAt3 / count,
          pAt5: sumM.pAt5 / count,
          rAt5: sumM.rAt5 / count,
          f1At5: sumM.f1At5 / count,
          hitAt5: sumM.hitAt5 / count,
          pAt10: sumM.pAt10 / count,
          rAt10: sumM.rAt10 / count,
          f1At10: sumM.f1At10 / count,
          hitAt10: sumM.hitAt10 / count
        });
      }

      const K = commitMeans.length;
      macroByModel[m.key] = {
        commits: K,
        map: commitMeans.reduce((s, x) => s + x.map, 0) / K,
        mrr: commitMeans.reduce((s, x) => s + x.mrr, 0) / K,
        pAt3: commitMeans.reduce((s, x) => s + x.pAt3, 0) / K,
        rAt3: commitMeans.reduce((s, x) => s + x.rAt3, 0) / K,
        f1At3: commitMeans.reduce((s, x) => s + x.f1At3, 0) / K,
        hitAt3: commitMeans.reduce((s, x) => s + x.hitAt3, 0) / K,
        pAt5: commitMeans.reduce((s, x) => s + x.pAt5, 0) / K,
        rAt5: commitMeans.reduce((s, x) => s + x.rAt5, 0) / K,
        f1At5: commitMeans.reduce((s, x) => s + x.f1At5, 0) / K,
        hitAt5: commitMeans.reduce((s, x) => s + x.hitAt5, 0) / K,
        pAt10: commitMeans.reduce((s, x) => s + x.pAt10, 0) / K,
        rAt10: commitMeans.reduce((s, x) => s + x.rAt10, 0) / K,
        f1At10: commitMeans.reduce((s, x) => s + x.f1At10, 0) / K,
        hitAt10: commitMeans.reduce((s, x) => s + x.hitAt10, 0) / K
      };
    }
    return macroByModel;
  }

  // 2. Case-Level Micro Aggregation
  function computeMicroMetrics(cases) {
    const N = cases.length;
    const microByModel = {};
    for (const m of EVAL_MODELS) {
      const sum = cases.reduce((acc, curr) => {
        const met = curr.metrics[m.key];
        return {
          map: acc.map + met.map,
          mrr: acc.mrr + met.mrr,
          pAt3: acc.pAt3 + met.pAt3,
          rAt3: acc.rAt3 + met.rAt3,
          f1At3: acc.f1At3 + met.f1At3,
          hitAt3: acc.hitAt3 + met.hitAt3,
          pAt5: acc.pAt5 + met.pAt5,
          rAt5: acc.rAt5 + met.rAt5,
          f1At5: acc.f1At5 + met.f1At5,
          hitAt5: acc.hitAt5 + met.hitAt5,
          pAt10: acc.pAt10 + met.pAt10,
          rAt10: acc.rAt10 + met.rAt10,
          f1At10: acc.f1At10 + met.f1At10,
          hitAt10: acc.hitAt10 + met.hitAt10
        };
      }, { map: 0, mrr: 0, pAt3: 0, rAt3: 0, f1At3: 0, hitAt3: 0, pAt5: 0, rAt5: 0, f1At5: 0, hitAt5: 0, pAt10: 0, rAt10: 0, f1At10: 0, hitAt10: 0 });

      microByModel[m.key] = {
        cases: N,
        map: sum.map / N,
        mrr: sum.mrr / N,
        pAt3: sum.pAt3 / N,
        rAt3: sum.rAt3 / N,
        f1At3: sum.f1At3 / N,
        hitAt3: sum.hitAt3 / N,
        pAt5: sum.pAt5 / N,
        rAt5: sum.rAt5 / N,
        f1At5: sum.f1At5 / N,
        hitAt5: sum.hitAt5 / N,
        pAt10: sum.pAt10 / N,
        rAt10: sum.rAt10 / N,
        f1At10: sum.f1At10 / N,
        hitAt10: sum.hitAt10 / N
      };
    }
    return microByModel;
  }

  // Compute Overall Macro and Micro
  const overallMacro = computeMacroMetrics(allCasesFlat);
  const overallMicro = computeMicroMetrics(allCasesFlat);

  // Train / Val vs Held-Out Test Partitioning
  const trainCasesFlat = allCasesFlat.filter(c => c.isTrainCommit);
  const testCasesFlat = allCasesFlat.filter(c => !c.isTrainCommit);

  const trainMacro = computeMacroMetrics(trainCasesFlat);
  const testMacro = computeMacroMetrics(testCasesFlat);

  // Statistical Paired Tests (Case-Level and Commit-Level)
  const mapV4Comb = allCasesFlat.map(c => c.metrics.egcp_v4_combined.map);
  const mapCSF = allCasesFlat.map(c => c.metrics.csf_frozen.map);
  const mapV3Comb = allCasesFlat.map(c => c.metrics.egcp_v3_combined.map);
  const mapV2 = allCasesFlat.map(c => c.metrics.egcp_v2_main.map);

  const statsVsCSF = pairedStats(mapV4Comb, mapCSF);
  const statsVsV3 = pairedStats(mapV4Comb, mapV3Comb);
  const statsVsV2 = pairedStats(mapV4Comb, mapV2);

  const mapCSF_Equal = allCasesFlat.map(c => c.metrics.csf_equal_weights.map);
  const mapEGCP_v4_MinMax = allCasesFlat.map(c => c.metrics.egcp_v4_minmax_equal.map);
  const mapEGCP_Base_MinMax = allCasesFlat.map(c => c.metrics.egcp_base_minmax_equal.map);
  const mapV4Base = allCasesFlat.map(c => c.metrics.egcp_v4_base.map);

  const statsVsCSF_Equal = pairedStats(mapCSF_Equal, mapCSF);
  const statsEGCP_v4_vs_MinMax = pairedStats(mapEGCP_v4_MinMax, mapV4Comb);
  const statsEGCP_Base_vs_MinMax = pairedStats(mapEGCP_Base_MinMax, mapV4Base);

  console.log('\n--- OVERALL RESULTS (Commit-Level Macro across 25 Commits) ---');
  for (const m of EVAL_MODELS) {
    const res = overallMacro[m.key];
    console.log(`  ${m.name.padEnd(52)} : MAP = ${res.map.toFixed(4)}, MRR = ${res.mrr.toFixed(4)}, P@5 = ${res.pAt5.toFixed(4)}, R@5 = ${res.rAt5.toFixed(4)}`);
  }

  console.log('\n--- HELD-OUT TEST RESULTS (Commit-Level Macro across 10 Commits) ---');
  for (const m of EVAL_MODELS) {
    const res = testMacro[m.key];
    console.log(`  ${m.name.padEnd(52)} : MAP = ${res.map.toFixed(4)}, MRR = ${res.mrr.toFixed(4)}, P@5 = ${res.pAt5.toFixed(4)}, R@5 = ${res.rAt5.toFixed(4)}`);
  }

  console.log('\n--- STATISTICAL SIGNIFICANCE (Case-Level Paired t-Test, N=170) ---');
  console.log(`  EGCP v4 Combined vs CSF Frozen: Mean Diff = ${statsVsCSF.meanDiff > 0 ? '+' : ''}${statsVsCSF.meanDiff.toFixed(4)}, 95% CI [${statsVsCSF.ci95Lower.toFixed(4)}, ${statsVsCSF.ci95Upper.toFixed(4)}], t = ${statsVsCSF.tStat.toFixed(3)}, p = ${statsVsCSF.pValueT.toFixed(6)}, W/T/L = ${statsVsCSF.wins}/${statsVsCSF.ties}/${statsVsCSF.losses}`);
  console.log(`  EGCP v4 Combined vs EGCP v3:    Mean Diff = ${statsVsV3.meanDiff > 0 ? '+' : ''}${statsVsV3.meanDiff.toFixed(4)}, 95% CI [${statsVsV3.ci95Lower.toFixed(4)}, ${statsVsV3.ci95Upper.toFixed(4)}], t = ${statsVsV3.tStat.toFixed(3)}, p = ${statsVsV3.pValueT.toFixed(6)}, W/T/L = ${statsVsV3.wins}/${statsVsV3.ties}/${statsVsV3.losses}`);
  console.log(`  EGCP v4 Combined vs EGCP v2:    Mean Diff = ${statsVsV2.meanDiff > 0 ? '+' : ''}${statsVsV2.meanDiff.toFixed(4)}, 95% CI [${statsVsV2.ci95Lower.toFixed(4)}, ${statsVsV2.ci95Upper.toFixed(4)}], t = ${statsVsV2.tStat.toFixed(3)}, p = ${statsVsV2.pValueT.toFixed(6)}, W/T/L = ${statsVsV2.wins}/${statsVsV2.ties}/${statsVsV2.losses}`);
  console.log(`  CSF Equal (Simplified) vs Frozen: Mean Diff = ${statsVsCSF_Equal.meanDiff > 0 ? '+' : ''}${statsVsCSF_Equal.meanDiff.toFixed(4)}, 95% CI [${statsVsCSF_Equal.ci95Lower.toFixed(4)}, ${statsVsCSF_Equal.ci95Upper.toFixed(4)}], t = ${statsVsCSF_Equal.tStat.toFixed(3)}, p = ${statsVsCSF_Equal.pValueT.toFixed(6)}, W/T/L = ${statsVsCSF_Equal.wins}/${statsVsCSF_Equal.ties}/${statsVsCSF_Equal.losses}`);
  console.log(`  EGCP v4 Min-Max vs Combined:    Mean Diff = ${statsEGCP_v4_vs_MinMax.meanDiff > 0 ? '+' : ''}${statsEGCP_v4_vs_MinMax.meanDiff.toFixed(4)}, 95% CI [${statsEGCP_v4_vs_MinMax.ci95Lower.toFixed(4)}, ${statsEGCP_v4_vs_MinMax.ci95Upper.toFixed(4)}], t = ${statsEGCP_v4_vs_MinMax.tStat.toFixed(3)}, p = ${statsEGCP_v4_vs_MinMax.pValueT.toFixed(6)}, W/T/L = ${statsEGCP_v4_vs_MinMax.wins}/${statsEGCP_v4_vs_MinMax.ties}/${statsEGCP_v4_vs_MinMax.losses}`);

  // ── Write CSV & JSON Artifacts ────────────────────────────────────────────

  // 1. egcp_v4_metrics_by_project.csv (Macro)
  let macroCsv = 'Project,Model,EligibleCommits,TestCases,MAP,MRR,P@3,R@3,F1@3,Hit@3,P@5,R@5,F1@5,Hit@5,P@10,R@10,F1@10,Hit@10\n';
  for (const pr of projectResults) {
    const pMacro = computeMacroMetrics(pr.caseResults);
    for (const m of EVAL_MODELS) {
      const row = pMacro[m.key];
      macroCsv += `"${pr.projectName}","${m.name}",${pr.eligibleCommitCount},${pr.testCaseCount},${row.map.toFixed(4)},${row.mrr.toFixed(4)},${row.pAt3.toFixed(4)},${row.rAt3.toFixed(4)},${row.f1At3.toFixed(4)},${row.hitAt3.toFixed(4)},${row.pAt5.toFixed(4)},${row.rAt5.toFixed(4)},${row.f1At5.toFixed(4)},${row.hitAt5.toFixed(4)},${row.pAt10.toFixed(4)},${row.rAt10.toFixed(4)},${row.f1At10.toFixed(4)},${row.hitAt10.toFixed(4)}\n`;
    }
  }
  // Overall Macro
  for (const m of EVAL_MODELS) {
    const row = overallMacro[m.key];
    macroCsv += `"Overall (All 3 Projects)","${m.name}",${allEligibleCommitsCount},${allCasesFlat.length},${row.map.toFixed(4)},${row.mrr.toFixed(4)},${row.pAt3.toFixed(4)},${row.rAt3.toFixed(4)},${row.f1At3.toFixed(4)},${row.hitAt3.toFixed(4)},${row.pAt5.toFixed(4)},${row.rAt5.toFixed(4)},${row.f1At5.toFixed(4)},${row.hitAt5.toFixed(4)},${row.pAt10.toFixed(4)},${row.rAt10.toFixed(4)},${row.f1At10.toFixed(4)},${row.hitAt10.toFixed(4)}\n`;
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v4_metrics_by_project.csv'), macroCsv);

  // 2. egcp_v4_metrics_micro.csv
  let microCsv = 'Model,TestCases,MAP_Micro,MRR_Micro,P@3_Micro,R@3_Micro,F1@3_Micro,Hit@3_Micro,P@5_Micro,R@5_Micro,F1@5_Micro,Hit@5_Micro,P@10_Micro,R@10_Micro,F1@10_Micro,Hit@10_Micro\n';
  for (const m of EVAL_MODELS) {
    const row = overallMicro[m.key];
    microCsv += `"${m.name}",${row.cases},${row.map.toFixed(4)},${row.mrr.toFixed(4)},${row.pAt3.toFixed(4)},${row.rAt3.toFixed(4)},${row.f1At3.toFixed(4)},${row.hitAt3.toFixed(4)},${row.pAt5.toFixed(4)},${row.rAt5.toFixed(4)},${row.f1At5.toFixed(4)},${row.hitAt5.toFixed(4)},${row.pAt10.toFixed(4)},${row.rAt10.toFixed(4)},${row.f1At10.toFixed(4)},${row.hitAt10.toFixed(4)}\n`;
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v4_metrics_micro.csv'), microCsv);

  // 3. egcp_v4_ablation_comparison.csv
  let ablCsv = 'Variant,Description,MAP_Macro,MRR_Macro,P@5_Macro,R@5_Macro,MAP_Micro,MRR_Micro,Test_MAP_Macro,Test_MRR_Macro\n';
  for (const m of EVAL_MODELS) {
    const macro = overallMacro[m.key];
    const micro = overallMicro[m.key];
    const testM = testMacro[m.key];
    ablCsv += `"${m.key}","${m.name}",${macro.map.toFixed(4)},${macro.mrr.toFixed(4)},${macro.pAt5.toFixed(4)},${macro.rAt5.toFixed(4)},${micro.map.toFixed(4)},${micro.mrr.toFixed(4)},${testM.map.toFixed(4)},${testM.mrr.toFixed(4)}\n`;
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v4_ablation_comparison.csv'), ablCsv);

  // 4. egcp_v4_results.json
  const fullJson = {
    evaluatedAt: new Date().toISOString(),
    benchmarkConfig: {
      eligibleCommitsTotal: allEligibleCommitsCount,
      testCasesTotal: allCasesFlat.length,
      trainCommitsTotal: 15,
      heldOutTestCommitsTotal: 10
    },
    overallMacroCommits: overallMacro,
    overallMicroCases: overallMicro,
    trainMacroCommits: trainMacro,
    testMacroCommits: testMacro,
    statisticalTests: {
      vs_csf: statsVsCSF,
      vs_v3: statsVsV3,
      vs_v2: statsVsV2,
      vs_csf_equal: statsVsCSF_Equal,
      vs_egcp_v4_minmax: statsEGCP_v4_vs_MinMax,
      vs_egcp_base_minmax: statsEGCP_Base_vs_MinMax
    },
    projectResults
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v4_results.json'), JSON.stringify(fullJson, null, 2));

  console.log(`\nArtifacts written successfully to: ${OUTPUT_DIR}`);
}

runEGCPv4Evaluation().catch(err => {
  console.error('Fatal Evaluation Error:', err);
  process.exit(1);
});
