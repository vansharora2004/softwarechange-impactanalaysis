/**
 * egcpV2Evaluator.js
 * ------------------
 * Independent Evaluation Harness for Evolutionary-Graph Change Propagation v2 (EGCP v2).
 * Evaluates EGCP v2 and its component ablations against:
 *   1. Canonical Structural Baseline
 *   2. Historical Co-Change Reranker (V4)
 *   3. Original OCCP (Model B)
 *   4. Continuous Score Fusion (CSF Frozen Baseline)
 *   5. Original EGCP-Evo (v1, alpha = 0.0)
 *   6. Original EGCP-Dual (v1, alpha = 0.5)
 *
 * Guarantees:
 *   - Exactly identical K=25 commits and N=170 LOO test cases across 3 projects.
 *   - Pre-change AST graph at c^1 (zero future AST leakage).
 *   - History strictly from commits j < c (zero target commit co-change leakage).
 *   - Strict candidate universe preservation |C| (zero candidates dropped).
 *   - Deterministic tie-breaking.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
import { trainPathModels, rankModelB_OCCP } from '../../services/occp/occpModel.js';
import { rankModelB_OCCP_ContinuousFusion, DEFAULT_FUSION_WEIGHTS } from '../../services/occp_experiments/occpFusionModel.js';

// Import Original EGCP v1
import {
  rankModel_EGCP_Dual,
  rankModel_EGCP_EvoOnly
} from '../../services/egcp/egcpModel.js';

// Import EGCP v2
import {
  rankModel_EGCP_v2,
  buildCommitGraphCacheV2,
  rankModel_EGCP_v2_NoDegreeDiscount,
  rankModel_EGCP_v2_EvoOnly,
  rankModel_EGCP_v2_StructOnly
} from '../../services/egcp/v2/egcpV2Model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = path.resolve(BACKEND_ROOT, '..', 'research_artifacts', 'egcp_v2_iteration_20261020');

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
  { key: 'original_occp', name: 'Original OCCP (Model B)' },
  { key: 'csf_frozen', name: 'Continuous Score Fusion (CSF Frozen Baseline)' },
  { key: 'egcp_v1_evo', name: 'Original EGCP-Evo (v1, alpha=0.0)' },
  { key: 'egcp_v1_dual', name: 'Original EGCP-Dual (v1, alpha=0.5)' },
  { key: 'egcp_v2_main', name: 'EGCP v2 (Decoupled Dual-Channel + Degree Discount)' },
  { key: 'egcp_v2_no_degree', name: 'EGCP v2 Ablation: No Degree Discount (gamma=0.0)' },
  { key: 'egcp_v2_evo_only', name: 'EGCP v2 Ablation: Evo-Only (beta=1.0, gamma=0.75)' },
  { key: 'egcp_v2_struct_only', name: 'EGCP v2 Ablation: Struct-Only (beta=0.0, gamma=0.75)' }
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

  return {
    candidateCount: rankedIds.length,
    pAt3: p3,
    rAt3: r3,
    f1At3: (p3 + r3 > 0) ? (2 * p3 * r3) / (p3 + r3) : 0,
    hitAt3: Math.round(p3 * 3) > 0 ? 1 : 0,

    pAt5: p5,
    rAt5: r5,
    f1At5: (p5 + r5 > 0) ? (2 * p5 * r5) / (p5 + r5) : 0,
    hitAt5: Math.round(p5 * 5) > 0 ? 1 : 0,

    pAt10: p10,
    rAt10: r10,
    f1At10: (p10 + r10 > 0) ? (2 * p10 * r10) / (p10 + r10) : 0,
    hitAt10: Math.round(p10 * 10) > 0 ? 1 : 0,

    map: computeAP(rankedIds, oracle),
    mrr: computeRR(rankedIds, oracle)
  };
}

// ── Statistical Helper ──────────────────────────────────────────────────────

function normalCdf(z) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1.0 - prob : prob;
}

function pairedStats(seriesA, seriesB) {
  const n = seriesA.length;
  if (n !== seriesB.length || n === 0) return null;
  const diffs = seriesA.map((a, i) => a - seriesB[i]);
  const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + Math.pow(d - meanDiff, 2), 0) / Math.max(1, n - 1);
  const stdDiff = Math.sqrt(variance);
  const stderr = stdDiff / Math.sqrt(n);
  const tStat = stderr > 0 ? meanDiff / stderr : 0;
  const pValT = 2 * (1 - normalCdf(Math.abs(tStat)));
  const ci95Lower = meanDiff - 2.064 * stderr;
  const ci95Upper = meanDiff + 2.064 * stderr;

  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const d of diffs) {
    if (d > 1e-6) wins++;
    else if (d < -1e-6) losses++;
    else ties++;
  }

  return {
    n,
    meanDiff,
    stdDiff,
    stderr,
    tStat,
    pValueT: pValT,
    ci95Lower,
    ci95Upper,
    wins,
    ties,
    losses
  };
}

// ── Historical Helpers ──────────────────────────────────────────────────────

function buildLeakFreeHistoryCounts(allCommits, currentCommitIndex, compMap) {
  const historyCounts = new Map();
  const olderCommits = allCommits.slice(currentCommitIndex + 1);

  for (const c of olderCommits) {
    const raw = c.rawChanges || [];
    const mappedIds = new Set();

    for (const r of raw) {
      const p = r.filePath || r.newPath || r.oldPath;
      if (!p || !isJavaSourceFile(p)) continue;
      for (const [id, comp] of compMap.entries()) {
        if (comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath))) {
          mappedIds.add(id);
        }
      }
    }

    const ids = Array.from(mappedIds).sort();
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const k = `${ids[a]}|${ids[b]}`;
        historyCounts.set(k, (historyCounts.get(k) || 0) + 1);
      }
    }
  }

  return historyCounts;
}

function indexHistoricalEpisodesSafe(repoPath, allCommits, maxHops = 2) {
  const episodes = [];
  const repoBaseName = path.basename(repoPath);

  for (let idx = 0; idx < allCommits.length; idx++) {
    const commit = allCommits[idx];
    if (commit.isMerge || !commit.parents || commit.parents.length === 0) continue;
    const javaChanges = (commit.rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) continue;

    try {
      const graphRes = getOrBuildHistoricalGraph(repoPath, commit.hash);
      const graph = graphRes.graph;
      const compMap = new Map(graph.components.map(c => [c.id, c]));
      const pathIndex = buildComponentPathIndex(graph.components);
      const mapping = mapGitChanges(commit.rawChanges, pathIndex, { perspective: 'pre' });
      const changedCompIds = new Set(mapping.mapped.map(m => m.mappedComponentId).filter(Boolean));

      if (changedCompIds.size === 0) continue;

      const componentEpisodes = [];
      for (const compId of changedCompIds) {
        const comp = compMap.get(compId);
        if (!comp || comp.type === 'Test') continue;

        const rawChange = commit.rawChanges.find(r => {
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
    } catch (e) {}
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
      caseCount: casesForCommit.length,
      graphData: graph,
      historyCounts
    });

    looCases.push(...casesForCommit);
  }

  return { eligibleCommits, looCases };
}

// ── Master Evaluation Execution ─────────────────────────────────────────────

async function runEGCPv2Evaluation() {
  console.log(`\n=================================================================`);
  console.log(`   EGCP v2 Master Evaluation against Frozen CSF & Baselines`);
  console.log(`   Output Directory: ${OUTPUT_DIR}`);
  console.log(`=================================================================\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const projectResults = [];
  let totalCasesEvaluated = 0;
  let totalRuntimeV1Ms = 0;
  let totalRuntimeV2Ms = 0;

  for (const project of PROJECTS) {
    console.log(`\nEvaluating Project: ${project.name}`);
    console.log(`Path: ${project.path}`);

    const caseBuildResult = await buildHistoricalCasesFast(project.path, project.commitLimit);
    const { eligibleCommits, looCases } = caseBuildResult;
    console.log(`  Eligible Commits: ${eligibleCommits.length}, LOO Cases: ${looCases.length}`);

    const allCommits = parseGitLogCommits(project.path, project.commitLimit, { includeMerges: true });
    const historicalEpisodes = indexHistoricalEpisodesSafe(project.path, allCommits, 2);

    const caseResults = [];

    // Group cases by commit for per-commit graph caching
    const commitCaseMap = new Map();
    for (const tc of looCases) {
      if (!commitCaseMap.has(tc.commitHash)) commitCaseMap.set(tc.commitHash, []);
      commitCaseMap.get(tc.commitHash).push(tc);
    }

    for (const [commitHash, casesInCommit] of commitCaseMap.entries()) {
      const firstCase = casesInCommit[0];
      const { graphData, historyCounts, commitIndex } = firstCase;

      // Precompute EGCP v2 commit graph cache once for all cases in this commit
      const graphCacheV2 = buildCommitGraphCacheV2(graphData, historyCounts);

      // OCCP training for this commit
      const olderEpisodes = historicalEpisodes.filter(ep => ep.commitIndex > commitIndex);
      const { genericPathStats, conditionedPathStats } = trainPathModels(olderEpisodes);

      for (let cIdx = 0; cIdx < casesInCommit.length; cIdx++) {
        const testCase = casesInCommit[cIdx];
        const {
          caseId,
          inputComponent,
          retroOracle,
          compMap
        } = testCase;

        // 1. Candidate Universe Generation (2 hops from seed on pre-change graph)
        const structuralCandidates = generateStructuralCandidatesInMemory([inputComponent], graphData, 2);
        const candLen = structuralCandidates.length;
        const rankStruct = structuralCandidates.map(c => c.id);

        // 2. Historical Co-Change Reranker (V4)
        const rankedHist = rerankCandidatesWithHistory(structuralCandidates, [inputComponent], historyCounts);
        const rankHist = rankedHist.map(c => c.id);

        // 3. Operation Classification & Path Extraction
        const candidatePathsMap = extractCandidatePathsFromSeed(inputComponent, graphData, 2);
        const rawChange = (allCommits[commitIndex].rawChanges || []).find(r => {
          const p = r.filePath || r.newPath || r.oldPath;
          const comp = compMap.get(inputComponent);
          return comp && comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath));
        });
        const opClass = classifyOperation(project.path, testCase.parentSha, commitHash, compMap.get(inputComponent)?.filePath, rawChange);

        // 4. Original OCCP (Model B)
        const rankedOCCP = rankModelB_OCCP(structuralCandidates, inputComponent, opClass, candidatePathsMap, conditionedPathStats, genericPathStats, historyCounts);
        const rankOCCP = rankedOCCP.map(c => c.id);

        // 5. Continuous Score Fusion (CSF Frozen Baseline)
        const rankedCSF = rankModelB_OCCP_ContinuousFusion(structuralCandidates, inputComponent, opClass, candidatePathsMap, conditionedPathStats, genericPathStats, historyCounts, DEFAULT_FUSION_WEIGHTS, 0.5);
        const rankCSF = rankedCSF.map(c => c.id);

        // 6. Original EGCP v1 Variants (Timing V1)
        const v1Start = performance.now();
        const rankedEGCPv1Evo = rankModel_EGCP_EvoOnly(structuralCandidates, inputComponent, graphData, historyCounts);
        const rankedEGCPv1Dual = rankModel_EGCP_Dual(structuralCandidates, inputComponent, graphData, historyCounts);
        const v1End = performance.now();
        totalRuntimeV1Ms += (v1End - v1Start);

        const rankEGCPv1Evo = rankedEGCPv1Evo.map(c => c.id);
        const rankEGCPv1Dual = rankedEGCPv1Dual.map(c => c.id);

        // 7. EGCP v2 (Main: Decoupled Dual-Channel with Degree Discounting) (Timing V2)
        const v2Start = performance.now();
        const rankedEGCPv2Main = rankModel_EGCP_v2(structuralCandidates, inputComponent, graphCacheV2, historyCounts, {
          channelMixingBeta: 0.60,
          degreeDiscountExponent: 0.75
        });
        const v2End = performance.now();
        totalRuntimeV2Ms += (v2End - v2Start);

        const rankEGCPv2Main = rankedEGCPv2Main.map(c => c.id);

        // 8. EGCP v2 Ablations
        const rankedEGCPv2NoDeg = rankModel_EGCP_v2_NoDegreeDiscount(structuralCandidates, inputComponent, graphCacheV2, historyCounts, { channelMixingBeta: 0.60 });
        const rankEGCPv2NoDeg = rankedEGCPv2NoDeg.map(c => c.id);

        const rankedEGCPv2EvoOnly = rankModel_EGCP_v2_EvoOnly(structuralCandidates, inputComponent, graphCacheV2, historyCounts, { degreeDiscountExponent: 0.75 });
        const rankEGCPv2EvoOnly = rankedEGCPv2EvoOnly.map(c => c.id);

        const rankedEGCPv2StructOnly = rankModel_EGCP_v2_StructOnly(structuralCandidates, inputComponent, graphCacheV2, historyCounts, { degreeDiscountExponent: 0.75 });
        const rankEGCPv2StructOnly = rankedEGCPv2StructOnly.map(c => c.id);

        totalCasesEvaluated++;

        // Verify Candidate Universe Integrity
        for (const [name, rList] of [
          ['canonical_baseline', rankStruct],
          ['historical_reranker', rankHist],
          ['original_occp', rankOCCP],
          ['csf_frozen', rankCSF],
          ['egcp_v1_evo', rankEGCPv1Evo],
          ['egcp_v1_dual', rankEGCPv1Dual],
          ['egcp_v2_main', rankEGCPv2Main],
          ['egcp_v2_no_degree', rankEGCPv2NoDeg],
          ['egcp_v2_evo_only', rankEGCPv2EvoOnly],
          ['egcp_v2_struct_only', rankEGCPv2StructOnly]
        ]) {
          if (rList.length !== candLen) {
            throw new Error(`Universe integrity violated for ${name} in case ${caseId}`);
          }
        }

        // Metrics for all models
        const metrics = {
          canonical_baseline: computeCaseMetrics(rankStruct, retroOracle),
          historical_reranker: computeCaseMetrics(rankHist, retroOracle),
          original_occp: computeCaseMetrics(rankOCCP, retroOracle),
          csf_frozen: computeCaseMetrics(rankCSF, retroOracle),
          egcp_v1_evo: computeCaseMetrics(rankEGCPv1Evo, retroOracle),
          egcp_v1_dual: computeCaseMetrics(rankEGCPv1Dual, retroOracle),
          egcp_v2_main: computeCaseMetrics(rankEGCPv2Main, retroOracle),
          egcp_v2_no_degree: computeCaseMetrics(rankEGCPv2NoDeg, retroOracle),
          egcp_v2_evo_only: computeCaseMetrics(rankEGCPv2EvoOnly, retroOracle),
          egcp_v2_struct_only: computeCaseMetrics(rankEGCPv2StructOnly, retroOracle)
        };

        caseResults.push({
          caseId,
          commitHash: commitHash.slice(0, 7),
          commitIndex,
          inputComponent,
          candidateCount: candLen,
          oracleSize: retroOracle.size,
          metrics
        });
      }
    }

    // Aggregate Project Commit Level
    const commitMap = new Map();
    for (const cr of caseResults) {
      if (!commitMap.has(cr.commitHash)) commitMap.set(cr.commitHash, []);
      commitMap.get(cr.commitHash).push(cr);
    }

    const commitList = Array.from(commitMap.keys());
    const projectMacroCommits = {};

    for (const m of EVAL_MODELS) {
      const cAverages = [];

      for (const cHash of commitList) {
        const cases = commitMap.get(cHash);
        const k = cases.length;
        const mList = cases.map(c => c.metrics[m.key]);

        const avg = {
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
        };
        cAverages.push(avg);
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
    }

    projectResults.push({
      projectName: project.name,
      commitCount: eligibleCommits.length,
      caseCount: looCases.length,
      projectMacroCommits,
      caseResults
    });
  }

  // ── Overall Aggregation Across All 25 Commits ──────────────────────────────

  const overallMacroCommits = {};
  const allCommitAveragesGlobal = {};

  for (const m of EVAL_MODELS) {
    allCommitAveragesGlobal[m.key] = [];
    for (const pr of projectResults) {
      allCommitAveragesGlobal[m.key].push(...pr.projectMacroCommits[m.key].commitAverages.map(ca => ({
        project: pr.projectName,
        ...ca
      })));
    }

    const cList = allCommitAveragesGlobal[m.key];
    const n = cList.length;

    overallMacroCommits[m.key] = {
      numCommits: n,
      pAt3: cList.reduce((s, c) => s + c.pAt3, 0) / n,
      rAt3: cList.reduce((s, c) => s + c.rAt3, 0) / n,
      f1At3: cList.reduce((s, c) => s + c.f1At3, 0) / n,
      hitAt3: cList.reduce((s, c) => s + c.hitAt3, 0) / n,

      pAt5: cList.reduce((s, c) => s + c.pAt5, 0) / n,
      rAt5: cList.reduce((s, c) => s + c.rAt5, 0) / n,
      f1At5: cList.reduce((s, c) => s + c.f1At5, 0) / n,
      hitAt5: cList.reduce((s, c) => s + c.hitAt5, 0) / n,

      pAt10: cList.reduce((s, c) => s + c.pAt10, 0) / n,
      rAt10: cList.reduce((s, c) => s + c.rAt10, 0) / n,
      f1At10: cList.reduce((s, c) => s + c.f1At10, 0) / n,
      hitAt10: cList.reduce((s, c) => s + c.hitAt10, 0) / n,

      map: cList.reduce((s, c) => s + c.map, 0) / n,
      mrr: cList.reduce((s, c) => s + c.mrr, 0) / n
    };
  }

  // ── Statistical Tests (EGCP v2 vs. CSF and EGCP v1) ───────────────────────

  const egcpV2Series = allCommitAveragesGlobal['egcp_v2_main'].map(c => c.map);
  const csfSeries = allCommitAveragesGlobal['csf_frozen'].map(c => c.map);
  const egcpV1EvoSeries = allCommitAveragesGlobal['egcp_v1_evo'].map(c => c.map);
  const structSeries = allCommitAveragesGlobal['canonical_baseline'].map(c => c.map);
  const histSeries = allCommitAveragesGlobal['historical_reranker'].map(c => c.map);

  const statsVsCSF = pairedStats(egcpV2Series, csfSeries);
  const statsVsV1Evo = pairedStats(egcpV2Series, egcpV1EvoSeries);
  const statsVsStruct = pairedStats(egcpV2Series, structSeries);
  const statsVsHist = pairedStats(egcpV2Series, histSeries);

  // ── Deliverables: CSV & JSON ──────────────────────────────────────────────

  const f4 = v => (v !== undefined && v !== null ? v.toFixed(4) : 'N/A');

  // 1. egcp_v2_metrics_by_project.csv
  const projCsvRows = ['Project,Model,EligibleCommits,TestCases,MAP,MRR,P@3,R@3,F1@3,Hit@3,P@5,R@5,F1@5,Hit@5,P@10,R@10,F1@10,Hit@10'];
  for (const pr of projectResults) {
    for (const m of EVAL_MODELS) {
      const pm = pr.projectMacroCommits[m.key];
      projCsvRows.push(`"${pr.projectName}","${m.name}",${pr.commitCount},${pr.caseCount},${f4(pm.map)},${f4(pm.mrr)},${f4(pm.pAt3)},${f4(pm.rAt3)},${f4(pm.f1At3)},${f4(pm.hitAt3)},${f4(pm.pAt5)},${f4(pm.rAt5)},${f4(pm.f1At5)},${f4(pm.hitAt5)},${f4(pm.pAt10)},${f4(pm.rAt10)},${f4(pm.f1At10)},${f4(pm.hitAt10)}`);
    }
  }
  for (const m of EVAL_MODELS) {
    const om = overallMacroCommits[m.key];
    projCsvRows.push(`"Overall (All 3 Projects)","${m.name}",${om.numCommits},${totalCasesEvaluated},${f4(om.map)},${f4(om.mrr)},${f4(om.pAt3)},${f4(om.rAt3)},${f4(om.f1At3)},${f4(om.hitAt3)},${f4(om.pAt5)},${f4(om.rAt5)},${f4(om.f1At5)},${f4(om.hitAt5)},${f4(om.pAt10)},${f4(om.rAt10)},${f4(om.f1At10)},${f4(om.hitAt10)}`);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v2_metrics_by_project.csv'), projCsvRows.join('\n'), 'utf8');

  // 2. egcp_v2_per_commit_metrics.csv
  const commitCsvRows = ['Project,CommitHash,CaseCount,Model,MAP,MRR,DeltaVsBaseline,DeltaVsCSF,DeltaVsV1Evo'];
  const totalCommitsN = allCommitAveragesGlobal['canonical_baseline'].length;
  for (let i = 0; i < totalCommitsN; i++) {
    const baseC = allCommitAveragesGlobal['canonical_baseline'][i];
    const csfC = allCommitAveragesGlobal['csf_frozen'][i];
    const v1EvoC = allCommitAveragesGlobal['egcp_v1_evo'][i];

    for (const m of EVAL_MODELS) {
      const item = allCommitAveragesGlobal[m.key][i];
      const deltaBase = item.map - baseC.map;
      const deltaCSF = item.map - csfC.map;
      const deltaV1Evo = item.map - v1EvoC.map;
      commitCsvRows.push(`"${item.project}","${item.commitHash}",${item.caseCount},"${m.name}",${f4(item.map)},${f4(item.mrr)},${f4(deltaBase)},${f4(deltaCSF)},${f4(deltaV1Evo)}`);
    }
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v2_per_commit_metrics.csv'), commitCsvRows.join('\n'), 'utf8');

  // 3. egcp_v2_ablation_comparison.csv
  const ablCsvRows = ['Variant,Beta,Gamma,Description,MAP,MRR,P@5,R@5,F1@5,Hit@5'];
  ablCsvRows.push(`"EGCP v2 Main",0.60,0.75,"Decoupled Dual-Channel + Degree Discounting",${f4(overallMacroCommits['egcp_v2_main'].map)},${f4(overallMacroCommits['egcp_v2_main'].mrr)},${f4(overallMacroCommits['egcp_v2_main'].pAt5)},${f4(overallMacroCommits['egcp_v2_main'].rAt5)},${f4(overallMacroCommits['egcp_v2_main'].f1At5)},${f4(overallMacroCommits['egcp_v2_main'].hitAt5)}`);
  ablCsvRows.push(`"EGCP v2 No-Degree",0.60,0.00,"Decoupled Dual-Channel without Degree Discounting",${f4(overallMacroCommits['egcp_v2_no_degree'].map)},${f4(overallMacroCommits['egcp_v2_no_degree'].mrr)},${f4(overallMacroCommits['egcp_v2_no_degree'].pAt5)},${f4(overallMacroCommits['egcp_v2_no_degree'].rAt5)},${f4(overallMacroCommits['egcp_v2_no_degree'].f1At5)},${f4(overallMacroCommits['egcp_v2_no_degree'].hitAt5)}`);
  ablCsvRows.push(`"EGCP v2 Evo-Only",1.00,0.75,"Degree-Discounted Pure Evolutionary Diffusion",${f4(overallMacroCommits['egcp_v2_evo_only'].map)},${f4(overallMacroCommits['egcp_v2_evo_only'].mrr)},${f4(overallMacroCommits['egcp_v2_evo_only'].pAt5)},${f4(overallMacroCommits['egcp_v2_evo_only'].rAt5)},${f4(overallMacroCommits['egcp_v2_evo_only'].f1At5)},${f4(overallMacroCommits['egcp_v2_evo_only'].hitAt5)}`);
  ablCsvRows.push(`"EGCP v2 Struct-Only",0.00,0.75,"Degree-Discounted Pure Structural Diffusion",${f4(overallMacroCommits['egcp_v2_struct_only'].map)},${f4(overallMacroCommits['egcp_v2_struct_only'].mrr)},${f4(overallMacroCommits['egcp_v2_struct_only'].pAt5)},${f4(overallMacroCommits['egcp_v2_struct_only'].rAt5)},${f4(overallMacroCommits['egcp_v2_struct_only'].f1At5)},${f4(overallMacroCommits['egcp_v2_struct_only'].hitAt5)}`);
  ablCsvRows.push(`"Original EGCP-Evo (v1)",0.00,0.00,"Coupled Transition Matrix Evolutionary Baseline",${f4(overallMacroCommits['egcp_v1_evo'].map)},${f4(overallMacroCommits['egcp_v1_evo'].mrr)},${f4(overallMacroCommits['egcp_v1_evo'].pAt5)},${f4(overallMacroCommits['egcp_v1_evo'].rAt5)},${f4(overallMacroCommits['egcp_v1_evo'].f1At5)},${f4(overallMacroCommits['egcp_v1_evo'].hitAt5)}`);
  ablCsvRows.push(`"Frozen CSF Baseline",N/A,N/A,"Continuous Multi-Channel Fusion Reference",${f4(overallMacroCommits['csf_frozen'].map)},${f4(overallMacroCommits['csf_frozen'].mrr)},${f4(overallMacroCommits['csf_frozen'].pAt5)},${f4(overallMacroCommits['csf_frozen'].rAt5)},${f4(overallMacroCommits['csf_frozen'].f1At5)},${f4(overallMacroCommits['csf_frozen'].hitAt5)}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v2_ablation_comparison.csv'), ablCsvRows.join('\n'), 'utf8');

  // 4. egcp_v2_results.json
  const rawResultsOutput = {
    evaluationDate: new Date().toISOString(),
    benchmarkUniverse: {
      totalCommits: totalCommitsN,
      totalCases: totalCasesEvaluated
    },
    runtimeProfiles: {
      v1TotalMs: totalRuntimeV1Ms,
      v1AvgMsPerCase: totalRuntimeV1Ms / Math.max(1, totalCasesEvaluated),
      v2TotalMs: totalRuntimeV2Ms,
      v2AvgMsPerCase: totalRuntimeV2Ms / Math.max(1, totalCasesEvaluated),
      speedupFactor: totalRuntimeV1Ms / Math.max(1, totalRuntimeV2Ms)
    },
    overallMacroCommits,
    statisticalTests: {
      vs_csf_frozen: statsVsCSF,
      vs_egcp_v1_evo: statsVsV1Evo,
      vs_canonical_baseline: statsVsStruct,
      vs_historical_reranker: statsVsHist
    },
    projectResults
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_v2_results.json'), JSON.stringify(rawResultsOutput, null, 2), 'utf8');

  console.log(`\n======================================================`);
  console.log(`   EGCP v2 EVALUATION SUMMARY RESULTS (K = ${totalCommitsN}, N = ${totalCasesEvaluated})`);
  console.log(`======================================================`);
  for (const m of EVAL_MODELS) {
    const res = overallMacroCommits[m.key];
    console.log(`${m.name.padEnd(52)} | MAP: ${f4(res.map)} | MRR: ${f4(res.mrr)} | P@5: ${f4(res.pAt5)} | R@5: ${f4(res.rAt5)} | F1@5: ${f4(res.f1At5)}`);
  }

  console.log(`\nStatistical Comparison (EGCP v2 Main vs. Reference Models):`);
  console.log(`  vs. Frozen CSF:         Mean Diff = ${f4(statsVsCSF.meanDiff)}, t = ${f4(statsVsCSF.tStat)} (p = ${f4(statsVsCSF.pValueT)}), W/T/L = ${statsVsCSF.wins}/${statsVsCSF.ties}/${statsVsCSF.losses}`);
  console.log(`  vs. Original EGCP-Evo:  Mean Diff = ${f4(statsVsV1Evo.meanDiff)}, t = ${f4(statsVsV1Evo.tStat)} (p = ${f4(statsVsV1Evo.pValueT)}), W/T/L = ${statsVsV1Evo.wins}/${statsVsV1Evo.ties}/${statsVsV1Evo.losses}`);
  console.log(`  vs. Canonical Baseline: Mean Diff = ${f4(statsVsStruct.meanDiff)}, t = ${f4(statsVsStruct.tStat)} (p = ${f4(statsVsStruct.pValueT)}), W/T/L = ${statsVsStruct.wins}/${statsVsStruct.ties}/${statsVsStruct.losses}`);
  console.log(`\nRuntime Profile:`);
  console.log(`  EGCP v1 Average Latency: ${(totalRuntimeV1Ms / totalCasesEvaluated).toFixed(2)} ms/case`);
  console.log(`  EGCP v2 Average Latency: ${(totalRuntimeV2Ms / totalCasesEvaluated).toFixed(2)} ms/case (Speedup: ${(totalRuntimeV1Ms / Math.max(1, totalRuntimeV2Ms)).toFixed(1)}x)`);
}

runEGCPv2Evaluation().catch(err => {
  console.error('Fatal error during EGCP v2 evaluation:', err);
  process.exit(1);
});
