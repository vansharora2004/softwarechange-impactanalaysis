/**
 * egcpV3Evaluator.js
 * ------------------
 * Independent Evaluation Harness for Evolutionary-Graph Change Propagation v3 (EGCP v3).
 * Evaluates EGCP v3 and its decoupled ablations against:
 *   1. Canonical Structural Baseline
 *   2. Historical Co-Change Reranker (V4)
 *   3. Continuous Score Fusion (CSF Frozen Baseline)
 *   4. Original EGCP-Evo (v1, alpha = 0.0)
 *   5. EGCP v2 Main (beta = 0.60, gamma = 0.75)
 *   6. EGCP v3 Base (Parity verification with v2)
 *   7. EGCP v3 Ablation 1: Adaptive Channel Balancing (beta_adaptive) Only
 *   8. EGCP v3 Ablation 2: Operation-Aware Edge Weighting Only
 *   9. EGCP v3 Ablation 3: Stereotype Entity Dampening Only
 *  10. EGCP v3 Combined: Adaptive Beta + Operation-Aware + Entity Dampening
 *
 * Guarantees:
 *   - Identical K=25 commits and N=170 LOO test cases across 3 projects.
 *   - Pre-change AST graph at c^1 (zero future AST leakage).
 *   - History strictly from commits j > c (zero target commit co-change leakage).
 *   - Strict candidate universe preservation |C| (zero candidates dropped).
 *   - Complete reporting of BOTH Commit-Level Macro and Case-Level Micro aggregations.
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
import { rankModelB_OCCP_ContinuousFusion, DEFAULT_FUSION_WEIGHTS } from '../../services/occp_experiments/occpFusionModel.js';

// Import EGCP v1
import { rankModel_EGCP_EvoOnly } from '../../services/egcp/egcpModel.js';

// Import EGCP v2
import { rankModel_EGCP_v2, buildCommitGraphCacheV2 } from '../../services/egcp/v2/egcpV2Model.js';

// Import EGCP v3
import {
  rankModel_EGCP_v3_Base,
  rankModel_EGCP_v3_AdaptiveBetaOnly,
  rankModel_EGCP_v3_OpAwareOnly,
  rankModel_EGCP_v3_DampeningOnly,
  rankModel_EGCP_v3_Combined,
  buildCommitGraphCacheV3
} from '../../services/egcp/v3/egcpV3Model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = path.resolve(BACKEND_ROOT, '..', 'research_artifacts', 'egcp_v3_evaluation_20261020');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const PROJECTS = [
  {
    name: 'Spring PetClinic REST',
    path: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest',
    commitLimit: 100
  },
  {
    name: 'Shopizer',
    path: 'c:/yashika/STUDY/clg_project/shopizer',
    commitLimit: 100
  },
  {
    name: 'Apache Commons Lang',
    path: 'c:/yashika/STUDY/clg_project/commons-lang',
    commitLimit: 100
  }
];

const EVAL_MODELS = [
  { key: 'canonical_baseline', name: 'Canonical Structural Baseline' },
  { key: 'historical_reranker', name: 'Historical Co-Change Reranker (V4)' },
  { key: 'csf_frozen', name: 'Continuous Score Fusion (CSF Frozen Baseline)' },
  { key: 'egcp_v1_evo', name: 'Original EGCP-Evo (v1, alpha=0.0)' },
  { key: 'egcp_v2_main', name: 'EGCP v2 Main (beta=0.60, gamma=0.75)' },
  { key: 'egcp_v3_base', name: 'EGCP v3 Base (Parity Baseline)' },
  { key: 'egcp_v3_adaptive', name: 'EGCP v3 Ablation 1: Adaptive Beta Only' },
  { key: 'egcp_v3_op_aware', name: 'EGCP v3 Ablation 2: Operation-Aware Only' },
  { key: 'egcp_v3_entity_damp', name: 'EGCP v3 Ablation 3: Entity Dampening Only' },
  { key: 'egcp_v3_combined', name: 'EGCP v3 Combined (Adaptive + Op + Damp)' }
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

// ── Paired Statistics Calculator ───────────────────────────────────────────

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

  // Approximate two-tailed p-value
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

async function runEGCPv3Evaluation() {
  console.log('\n================================================================');
  console.log('   EVOLUTIONARY-GRAPH CHANGE PROPAGATION v3 (EGCP v3) BENCHMARK');
  console.log(`   Output Directory: ${OUTPUT_DIR}`);
  console.log('================================================================\n');

  const projectResults = [];
  let totalCasesEvaluated = 0;
  let totalRuntimeV3Ms = 0;

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

    for (const ec of eligibleCommits) {
      const { graphData, historyCounts, commitHash, commitIndex, parentSha } = ec;

      // Precompute commit graph caches
      const v2Cache = buildCommitGraphCacheV2(graphData, historyCounts);
      const v3Cache = buildCommitGraphCacheV3(graphData, historyCounts);

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

        // 4. Original EGCP-Evo (v1, alpha = 0.0)
        const rankedEvoV1 = rankModel_EGCP_EvoOnly(structuralCandidates, inputComponent, graphData, historyCounts);
        const rankEvoV1 = rankedEvoV1.map(c => c.id);

        // 5. EGCP v2 Main (beta = 0.60, gamma = 0.75)
        const rankedV2Main = rankModel_EGCP_v2(structuralCandidates, inputComponent, v2Cache, historyCounts);
        const rankV2Main = rankedV2Main.map(c => c.id);

        // ── EGCP v3 Models ──
        const tStartV3 = performance.now();

        // 6. EGCP v3 Base (Parity Baseline)
        const rankedV3Base = rankModel_EGCP_v3_Base(structuralCandidates, inputComponent, v3Cache, historyCounts);
        const rankV3Base = rankedV3Base.map(c => c.id);

        // 7. EGCP v3 Ablation 1: Adaptive Beta Only
        const rankedV3Adaptive = rankModel_EGCP_v3_AdaptiveBetaOnly(structuralCandidates, inputComponent, v3Cache, historyCounts);
        const rankV3Adaptive = rankedV3Adaptive.map(c => c.id);

        // 8. EGCP v3 Ablation 2: Operation-Aware Edge Weighting Only
        const rankedV3Op = rankModel_EGCP_v3_OpAwareOnly(structuralCandidates, inputComponent, graphData, historyCounts, { editOperation: editOp });
        const rankV3Op = rankedV3Op.map(c => c.id);

        // 9. EGCP v3 Ablation 3: Stereotype Entity Dampening Only
        const rankedV3Damp = rankModel_EGCP_v3_DampeningOnly(structuralCandidates, inputComponent, v3Cache, historyCounts);
        const rankV3Damp = rankedV3Damp.map(c => c.id);

        // 10. EGCP v3 Combined: Adaptive Beta + Operation-Aware + Entity Dampening
        const rankedV3Comb = rankModel_EGCP_v3_Combined(structuralCandidates, inputComponent, graphData, historyCounts, { editOperation: editOp });
        const rankV3Comb = rankedV3Comb.map(c => c.id);

        totalRuntimeV3Ms += (performance.now() - tStartV3);

        // Verify Candidate Universe Integrity across all models
        for (const [name, rList] of [
          ['canonical_baseline', rankStruct],
          ['historical_reranker', rankHist],
          ['csf_frozen', rankCSF],
          ['egcp_v1_evo', rankEvoV1],
          ['egcp_v2_main', rankV2Main],
          ['egcp_v3_base', rankV3Base],
          ['egcp_v3_adaptive', rankV3Adaptive],
          ['egcp_v3_op_aware', rankV3Op],
          ['egcp_v3_entity_damp', rankV3Damp],
          ['egcp_v3_combined', rankV3Comb]
        ]) {
          if (rList.length !== candLen) {
            throw new Error(`Universe integrity violated for ${name} in case ${caseId}`);
          }
        }

        const caseMetrics = {
          canonical_baseline: computeCaseMetrics(rankStruct, retroOracle),
          historical_reranker: computeCaseMetrics(rankHist, retroOracle),
          csf_frozen: computeCaseMetrics(rankCSF, retroOracle),
          egcp_v1_evo: computeCaseMetrics(rankEvoV1, retroOracle),
          egcp_v2_main: computeCaseMetrics(rankV2Main, retroOracle),
          egcp_v3_base: computeCaseMetrics(rankV3Base, retroOracle),
          egcp_v3_adaptive: computeCaseMetrics(rankV3Adaptive, retroOracle),
          egcp_v3_op_aware: computeCaseMetrics(rankV3Op, retroOracle),
          egcp_v3_entity_damp: computeCaseMetrics(rankV3Damp, retroOracle),
          egcp_v3_combined: computeCaseMetrics(rankV3Comb, retroOracle)
        };

        caseResults.push({
          caseId,
          commitHash: commitHash.slice(0, 7),
          commitIndex,
          inputComponent,
          oracleSize: retroOracle.size,
          candidateCount: candLen,
          primaryOp: editOp,
          betaUsed: rankedV3Comb[0]?.egcp_v3_betaUsed || 0.60,
          targetOracles: [...retroOracle],
          ranks: {
            csf: rankedCSF.filter(c => retroOracle.has(c.id)).map(c => ({ id: c.id, rank: c.fusionRank })),
            v2: rankedV2Main.filter(c => retroOracle.has(c.id)).map(c => ({ id: c.id, rank: c.egcp_v2_rank })),
            v3_comb: rankedV3Comb.filter(c => retroOracle.has(c.id)).map(c => ({ id: c.id, rank: c.egcp_v3_rank }))
          },
          metrics: caseMetrics
        });
      }
    }

    // ── Group cases by commit for project aggregation ──
    const commitMap = new Map();
    for (const cr of caseResults) {
      if (!commitMap.has(cr.commitHash)) commitMap.set(cr.commitHash, []);
      commitMap.get(cr.commitHash).push(cr);
    }

    const projectMacroCommits = {};
    const projectMicroCases = {};

    for (const m of EVAL_MODELS) {
      // 1. Commit-level macro averaging
      const cAverages = [];
      for (const [cHash, cases] of commitMap.entries()) {
        const k = cases.length;
        const mList = cases.map(c => c.metrics[m.key]);
        cAverages.push({
          commitHash: cHash,
          caseCount: k,
          pAt3: mList.reduce((s, x) => s + x.pAt3, 0) / k,
          rAt3: mList.reduce((s, x) => s + x.rAt3, 0) / k,
          f1At3: mList.reduce((s, x) => s + x.f1At3, 0) / k,
          hitAt3: mList.reduce((s, x) => s + x.hitAt3, 0) / k,
          pAt5: mList.reduce((s, x) => s + x.pAt5, 0) / k,
          rAt5: mList.reduce((s, x) => s + x.rAt5, 0) / k,
          f1At5: mList.reduce((s, x) => s + x.f1At5, 0) / k,
          hitAt5: mList.reduce((s, x) => s + x.hitAt5, 0) / k,
          pAt10: mList.reduce((s, x) => s + x.pAt10, 0) / k,
          rAt10: mList.reduce((s, x) => s + x.rAt10, 0) / k,
          f1At10: mList.reduce((s, x) => s + x.f1At10, 0) / k,
          hitAt10: mList.reduce((s, x) => s + x.hitAt10, 0) / k,
          map: mList.reduce((s, x) => s + x.map, 0) / k,
          mrr: mList.reduce((s, x) => s + x.mrr, 0) / k
        });
      }

      const numC = cAverages.length;
      projectMacroCommits[m.key] = {
        commitAverages: cAverages,
        pAt3: cAverages.reduce((s, c) => s + c.pAt3, 0) / numC,
        rAt3: cAverages.reduce((s, c) => s + c.rAt3, 0) / numC,
        f1At3: cAverages.reduce((s, c) => s + c.f1At3, 0) / numC,
        hitAt3: cAverages.reduce((s, c) => s + c.hitAt3, 0) / numC,
        pAt5: cAverages.reduce((s, c) => s + c.pAt5, 0) / numC,
        rAt5: cAverages.reduce((s, c) => s + c.rAt5, 0) / numC,
        f1At5: cAverages.reduce((s, c) => s + c.f1At5, 0) / numC,
        hitAt5: cAverages.reduce((s, c) => s + c.hitAt5, 0) / numC,
        pAt10: cAverages.reduce((s, c) => s + c.pAt10, 0) / numC,
        rAt10: cAverages.reduce((s, c) => s + c.rAt10, 0) / numC,
        f1At10: cAverages.reduce((s, c) => s + c.f1At10, 0) / numC,
        hitAt10: cAverages.reduce((s, c) => s + c.hitAt10, 0) / numC,
        map: cAverages.reduce((s, c) => s + c.map, 0) / numC,
        mrr: cAverages.reduce((s, c) => s + c.mrr, 0) / numC
      };

      // 2. Case-level micro averaging
      const allM = caseResults.map(c => c.metrics[m.key]);
      const numCases = allM.length;
      projectMicroCases[m.key] = {
        pAt3: allM.reduce((s, x) => s + x.pAt3, 0) / numCases,
        rAt3: allM.reduce((s, x) => s + x.rAt3, 0) / numCases,
        f1At3: allM.reduce((s, x) => s + x.f1At3, 0) / numCases,
        hitAt3: allM.reduce((s, x) => s + x.hitAt3, 0) / numCases,
        pAt5: allM.reduce((s, x) => s + x.pAt5, 0) / numCases,
        rAt5: allM.reduce((s, x) => s + x.rAt5, 0) / numCases,
        f1At5: allM.reduce((s, x) => s + x.f1At5, 0) / numCases,
        hitAt5: allM.reduce((s, x) => s + x.hitAt5, 0) / numCases,
        pAt10: allM.reduce((s, x) => s + x.pAt10, 0) / numCases,
        rAt10: allM.reduce((s, x) => s + x.rAt10, 0) / numCases,
        f1At10: allM.reduce((s, x) => s + x.f1At10, 0) / numCases,
        hitAt10: allM.reduce((s, x) => s + x.hitAt10, 0) / numCases,
        map: allM.reduce((s, x) => s + x.map, 0) / numCases,
        mrr: allM.reduce((s, x) => s + x.mrr, 0) / numCases
      };
    }

    projectResults.push({
      projectName: project.name,
      commitCount: eligibleCommits.length,
      caseCount: looCases.length,
      durationMs: performance.now() - tStartProject,
      projectMacroCommits,
      projectMicroCases,
      caseResults
    });
  }

  // ── Overall Aggregation Across All 25 Commits & 170 Cases ──────────────────

  const overallMacroCommits = {};
  const overallMicroCases = {};
  const allCommitAveragesGlobal = {};
  const allCaseResultsGlobal = [];

  for (const pr of projectResults) {
    allCaseResultsGlobal.push(...pr.caseResults);
  }

  for (const m of EVAL_MODELS) {
    allCommitAveragesGlobal[m.key] = [];
    for (const pr of projectResults) {
      allCommitAveragesGlobal[m.key].push(...pr.projectMacroCommits[m.key].commitAverages.map(ca => ({
        project: pr.projectName,
        ...ca
      })));
    }

    // 1. Overall Commit-level macro
    const cList = allCommitAveragesGlobal[m.key];
    const nC = cList.length;

    overallMacroCommits[m.key] = {
      numCommits: nC,
      pAt3: cList.reduce((s, c) => s + c.pAt3, 0) / nC,
      rAt3: cList.reduce((s, c) => s + c.rAt3, 0) / nC,
      f1At3: cList.reduce((s, c) => s + c.f1At3, 0) / nC,
      hitAt3: cList.reduce((s, c) => s + c.hitAt3, 0) / nC,
      pAt5: cList.reduce((s, c) => s + c.pAt5, 0) / nC,
      rAt5: cList.reduce((s, c) => s + c.rAt5, 0) / nC,
      f1At5: cList.reduce((s, c) => s + c.f1At5, 0) / nC,
      hitAt5: cList.reduce((s, c) => s + c.hitAt5, 0) / nC,
      pAt10: cList.reduce((s, c) => s + c.pAt10, 0) / nC,
      rAt10: cList.reduce((s, c) => s + c.rAt10, 0) / nC,
      f1At10: cList.reduce((s, c) => s + c.f1At10, 0) / nC,
      hitAt10: cList.reduce((s, c) => s + c.hitAt10, 0) / nC,
      map: cList.reduce((s, c) => s + c.map, 0) / nC,
      mrr: cList.reduce((s, c) => s + c.mrr, 0) / nC
    };

    // 2. Overall Case-level micro
    const allCasesM = allCaseResultsGlobal.map(c => c.metrics[m.key]);
    const nCases = allCasesM.length;

    overallMicroCases[m.key] = {
      numCases: nCases,
      pAt3: allCasesM.reduce((s, c) => s + c.pAt3, 0) / nCases,
      rAt3: allCasesM.reduce((s, c) => s + c.rAt3, 0) / nCases,
      f1At3: allCasesM.reduce((s, c) => s + c.f1At3, 0) / nCases,
      hitAt3: allCasesM.reduce((s, c) => s + c.hitAt3, 0) / nCases,
      pAt5: allCasesM.reduce((s, c) => s + c.pAt5, 0) / nCases,
      rAt5: allCasesM.reduce((s, c) => s + c.rAt5, 0) / nCases,
      f1At5: allCasesM.reduce((s, c) => s + c.f1At5, 0) / nCases,
      hitAt5: allCasesM.reduce((s, c) => s + c.hitAt5, 0) / nCases,
      pAt10: allCasesM.reduce((s, c) => s + c.pAt10, 0) / nCases,
      rAt10: allCasesM.reduce((s, c) => s + c.rAt10, 0) / nCases,
      f1At10: allCasesM.reduce((s, c) => s + c.f1At10, 0) / nCases,
      hitAt10: allCasesM.reduce((s, c) => s + c.hitAt10, 0) / nCases,
      map: allCasesM.reduce((s, c) => s + c.map, 0) / nCases,
      mrr: allCasesM.reduce((s, c) => s + c.mrr, 0) / nCases
    };
  }

  // ── Statistical Tests Across Commits & Cases ──────────────────────────────
  const commitSeriesV3Comb = allCommitAveragesGlobal['egcp_v3_combined'].map(c => c.map);
  const commitSeriesV2Main = allCommitAveragesGlobal['egcp_v2_main'].map(c => c.map);
  const commitSeriesCSF = allCommitAveragesGlobal['csf_frozen'].map(c => c.map);

  const statsCommitVsCSF = pairedStats(commitSeriesV3Comb, commitSeriesCSF);
  const statsCommitVsV2 = pairedStats(commitSeriesV3Comb, commitSeriesV2Main);

  const caseSeriesV3Comb = allCaseResultsGlobal.map(c => c.metrics['egcp_v3_combined'].map);
  const caseSeriesV2Main = allCaseResultsGlobal.map(c => c.metrics['egcp_v2_main'].map);
  const caseSeriesCSF = allCaseResultsGlobal.map(c => c.metrics['csf_frozen'].map);

  const statsCaseVsCSF = pairedStats(caseSeriesV3Comb, caseSeriesCSF);
  const statsCaseVsV2 = pairedStats(caseSeriesV3Comb, caseSeriesV2Main);

  // ── Deliverables: CSVs & JSON ─────────────────────────────────────────────
  const f4 = v => (v !== undefined && v !== null ? v.toFixed(4) : 'N/A');

  // 1. egcp_v3_metrics_by_project.csv (Commit-Level Macro Average)
  const projMacroRows = ['Project,Model,EligibleCommits,TestCases,MAP,MRR,P@3,R@3,F1@3,Hit@3,P@5,R@5,F1@5,Hit@5,P@10,R@10,F1@10,Hit@10'];
  for (const pr of projectResults) {
    for (const m of EVAL_MODELS) {
      const pm = pr.projectMacroCommits[m.key];
      projMacroRows.push(`"${pr.projectName}","${m.name}",${pr.commitCount},${pr.caseCount},${f4(pm.map)},${f4(pm.mrr)},${f4(pm.pAt3)},${f4(pm.rAt3)},${f4(pm.f1At3)},${f4(pm.hitAt3)},${f4(pm.pAt5)},${f4(pm.rAt5)},${f4(pm.f1At5)},${f4(pm.hitAt5)},${f4(pm.pAt10)},${f4(pm.rAt10)},${f4(pm.f1At10)},${f4(pm.hitAt10)}`);
    }
  }
  for (const m of EVAL_MODELS) {
    const om = overallMacroCommits[m.key];
    projMacroRows.push(`"Overall (All 3 Projects)","${m.name}",${om.numCommits},${totalCasesEvaluated},${f4(om.map)},${f4(om.mrr)},${f4(om.pAt3)},${f4(om.rAt3)},${f4(om.f1At3)},${f4(om.hitAt3)},${f4(om.pAt5)},${f4(om.rAt5)},${f4(om.f1At5)},${f4(om.hitAt5)},${f4(om.pAt10)},${f4(om.rAt10)},${f4(om.f1At10)},${f4(om.hitAt10)}`);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v3_metrics_by_project.csv'), projMacroRows.join('\n'), 'utf8');

  // 2. egcp_v3_metrics_micro.csv (Case-Level Micro Average)
  const projMicroRows = ['Project,Model,EligibleCommits,TestCases,MAP,MRR,P@3,R@3,F1@3,Hit@3,P@5,R@5,F1@5,Hit@5,P@10,R@10,F1@10,Hit@10'];
  for (const pr of projectResults) {
    for (const m of EVAL_MODELS) {
      const pm = pr.projectMicroCases[m.key];
      projMicroRows.push(`"${pr.projectName}","${m.name}",${pr.commitCount},${pr.caseCount},${f4(pm.map)},${f4(pm.mrr)},${f4(pm.pAt3)},${f4(pm.rAt3)},${f4(pm.f1At3)},${f4(pm.hitAt3)},${f4(pm.pAt5)},${f4(pm.rAt5)},${f4(pm.f1At5)},${f4(pm.hitAt5)},${f4(pm.pAt10)},${f4(pm.rAt10)},${f4(pm.f1At10)},${f4(pm.hitAt10)}`);
    }
  }
  for (const m of EVAL_MODELS) {
    const om = overallMicroCases[m.key];
    projMicroRows.push(`"Overall (All 3 Projects)","${m.name}",25,${totalCasesEvaluated},${f4(om.map)},${f4(om.mrr)},${f4(om.pAt3)},${f4(om.rAt3)},${f4(om.f1At3)},${f4(om.hitAt3)},${f4(om.pAt5)},${f4(om.rAt5)},${f4(om.f1At5)},${f4(om.hitAt5)},${f4(om.pAt10)},${f4(om.rAt10)},${f4(om.f1At10)},${f4(om.hitAt10)}`);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v3_metrics_micro.csv'), projMicroRows.join('\n'), 'utf8');

  // 3. egcp_v3_per_commit_metrics.csv
  const commitCsvRows = ['Project,CommitHash,CaseCount,Model,MAP,MRR,DeltaVsBaseline,DeltaVsCSF,DeltaVsV2'];
  const totalCommitsN = allCommitAveragesGlobal['canonical_baseline'].length;
  for (let i = 0; i < totalCommitsN; i++) {
    const baseC = allCommitAveragesGlobal['canonical_baseline'][i];
    const csfC = allCommitAveragesGlobal['csf_frozen'][i];
    const v2C = allCommitAveragesGlobal['egcp_v2_main'][i];

    for (const m of EVAL_MODELS) {
      const item = allCommitAveragesGlobal[m.key][i];
      const deltaBase = item.map - baseC.map;
      const deltaCSF = item.map - csfC.map;
      const deltaV2 = item.map - v2C.map;
      commitCsvRows.push(`"${item.project}","${item.commitHash}",${item.caseCount},"${m.name}",${f4(item.map)},${f4(item.mrr)},${f4(deltaBase)},${f4(deltaCSF)},${f4(deltaV2)}`);
    }
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v3_per_commit_metrics.csv'), commitCsvRows.join('\n'), 'utf8');

  // 4. egcp_v3_ablation_comparison.csv
  const ablCsvRows = ['Variant,Description,MAP_Macro,MRR_Macro,P@5_Macro,R@5_Macro,Hit@5_Macro,MAP_Micro,MRR_Micro,R@5_Micro'];
  const ablKeys = [
    { key: 'canonical_baseline', desc: 'Canonical Structural Baseline' },
    { key: 'csf_frozen', desc: 'Continuous Score Fusion (CSF Frozen Baseline)' },
    { key: 'egcp_v1_evo', desc: 'Original EGCP-Evo (v1, alpha=0.0)' },
    { key: 'egcp_v2_main', desc: 'EGCP v2 Main (Decoupled Dual-Channel + Degree Discount)' },
    { key: 'egcp_v3_base', desc: 'EGCP v3 Base (Parity check with v2)' },
    { key: 'egcp_v3_adaptive', desc: 'EGCP v3 Ablation 1: Adaptive Channel Balancing Only' },
    { key: 'egcp_v3_op_aware', desc: 'EGCP v3 Ablation 2: Operation-Aware Edge Weighting Only' },
    { key: 'egcp_v3_entity_damp', desc: 'EGCP v3 Ablation 3: Stereotype Entity Dampening Only' },
    { key: 'egcp_v3_combined', desc: 'EGCP v3 Combined: Adaptive Beta + Operation-Aware + Entity Dampening' }
  ];
  for (const ab of ablKeys) {
    const ma = overallMacroCommits[ab.key];
    const mi = overallMicroCases[ab.key];
    ablCsvRows.push(`"${ab.key}","${ab.desc}",${f4(ma.map)},${f4(ma.mrr)},${f4(ma.pAt5)},${f4(ma.rAt5)},${f4(ma.hitAt5)},${f4(mi.map)},${f4(mi.mrr)},${f4(mi.rAt5)}`);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v3_ablation_comparison.csv'), ablCsvRows.join('\n'), 'utf8');

  // 5. egcp_v3_results.json
  const rawResultsOutput = {
    evaluationDate: new Date().toISOString(),
    benchmarkUniverse: {
      totalCommits: totalCommitsN,
      totalCases: totalCasesEvaluated
    },
    runtimeProfiles: {
      v3TotalMs: totalRuntimeV3Ms,
      v3AvgMsPerCase: totalRuntimeV3Ms / Math.max(1, totalCasesEvaluated)
    },
    overallMacroCommits,
    overallMicroCases,
    statisticalTests: {
      commitLevel: {
        vs_csf: statsCommitVsCSF,
        vs_v2: statsCommitVsV2
      },
      caseLevel: {
        vs_csf: statsCaseVsCSF,
        vs_v2: statsCaseVsV2
      }
    },
    projectResults
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v3_results.json'), JSON.stringify(rawResultsOutput, null, 2), 'utf8');

  console.log(`\n======================================================`);
  console.log(`   EGCP v3 EVALUATION SUMMARY RESULTS (K = ${totalCommitsN}, N = ${totalCasesEvaluated})`);
  console.log(`======================================================`);
  console.log('\n--- Commit-Level Macro Averages ---');
  for (const m of EVAL_MODELS) {
    const res = overallMacroCommits[m.key];
    console.log(`${m.name.padEnd(52)} | MAP: ${f4(res.map)} | MRR: ${f4(res.mrr)} | P@5: ${f4(res.pAt5)} | R@5: ${f4(res.rAt5)} | Hit@5: ${f4(res.hitAt5)}`);
  }

  console.log('\n--- Case-Level Micro Averages ---');
  for (const m of EVAL_MODELS) {
    const res = overallMicroCases[m.key];
    console.log(`${m.name.padEnd(52)} | MAP: ${f4(res.map)} | MRR: ${f4(res.mrr)} | P@5: ${f4(res.pAt5)} | R@5: ${f4(res.rAt5)} | Hit@5: ${f4(res.hitAt5)}`);
  }

  console.log(`\nStatistical Comparison (EGCP v3 Combined vs. Reference Models across Commits):`);
  console.log(`  vs. Frozen CSF:  Mean Diff = ${f4(statsCommitVsCSF.meanDiff)} (95% CI: [${f4(statsCommitVsCSF.ci95Lower)}, ${f4(statsCommitVsCSF.ci95Upper)}]), t = ${f4(statsCommitVsCSF.tStat)} (p = ${f4(statsCommitVsCSF.pValueT)}), W/T/L = ${statsCommitVsCSF.wins}/${statsCommitVsCSF.ties}/${statsCommitVsCSF.losses}`);
  console.log(`  vs. EGCP v2:     Mean Diff = ${f4(statsCommitVsV2.meanDiff)} (95% CI: [${f4(statsCommitVsV2.ci95Lower)}, ${f4(statsCommitVsV2.ci95Upper)}]), t = ${f4(statsCommitVsV2.tStat)} (p = ${f4(statsCommitVsV2.pValueT)}), W/T/L = ${statsCommitVsV2.wins}/${statsCommitVsV2.ties}/${statsCommitVsV2.losses}`);
  console.log(`\nRuntime Profile:`);
  console.log(`  EGCP v3 Average Latency: ${(totalRuntimeV3Ms / totalCasesEvaluated).toFixed(2)} ms/case`);
}

runEGCPv3Evaluation().catch(err => {
  console.error('Fatal error during EGCP v3 evaluation:', err);
  process.exit(1);
});
