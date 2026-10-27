/**
 * egcpEvaluator.js
 * ----------------
 * Independent Evaluation Harness for Evolutionary-Graph Change Propagation (EGCP).
 * Evaluates EGCP, its ablations, and compares directly against the frozen CSF baseline,
 * Original OCCP, V4 Historical Reranker, and Canonical Structural Baseline across
 * the frozen 25 commits and 170 test cases of:
 *   1. Spring PetClinic REST (K=8, N=57)
 *   2. Shopizer (K=12, N=46)
 *   3. Apache Commons Lang (K=5, N=67)
 *
 * Strict Temporal Guarantee:
 *   - Pre-change graph reconstructed at c^1.
 *   - Historical co-change strictly from commits older than target (j < c).
 *   - Candidate universe |C| identical for all models (0 candidates dropped).
 *   - Target labels held out exclusively for scoring.
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

// Import EGCP Modules
import {
  rankModel_EGCP,
  rankModel_EGCP_StructOnly,
  rankModel_EGCP_EvoOnly,
  rankModel_EGCP_Dual
} from '../../services/egcp/egcpModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = path.resolve(BACKEND_ROOT, '..', 'research_artifacts', 'egcp_evaluation_20261020');

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
  { key: 'egcp_dual', name: 'EGCP (Dual Evolutionary-Structural Diffusion)' },
  { key: 'egcp_struct_ablation', name: 'EGCP-Struct (Structural-Only Diffusion, alpha=1.0)' },
  { key: 'egcp_evo_ablation', name: 'EGCP-Evo (Evolutionary-Only Diffusion, alpha=0.0)' }
];

// ── Metric Helpers ──────────────────────────────────────────────────────────

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

  const nonZero = diffs.filter(d => Math.abs(d) > 1e-9);
  const nNZ = nonZero.length;
  let wilcoxonW = 0;
  let wilcoxonP = 1.0;
  if (nNZ > 0) {
    const absSorted = nonZero.map(d => ({ diff: d, abs: Math.abs(d) })).sort((a, b) => a.abs - b.abs);
    const ranks = [];
    let i = 0;
    while (i < nNZ) {
      let j = i;
      while (j < nNZ - 1 && Math.abs(absSorted[j + 1].abs - absSorted[j].abs) < 1e-9) j++;
      const avgRank = (i + 1 + j + 1) / 2;
      for (let k = i; k <= j; k++) ranks[k] = avgRank;
      i = j + 1;
    }
    let wPlus = 0;
    let wMinus = 0;
    for (let k = 0; k < nNZ; k++) {
      if (absSorted[k].diff > 0) wPlus += ranks[k];
      else wMinus += ranks[k];
    }
    wilcoxonW = Math.min(wPlus, wMinus);
    const meanW = (nNZ * (nNZ + 1)) / 4;
    const stdW = Math.sqrt((nNZ * (nNZ + 1) * (2 * nNZ + 1)) / 24);
    const zW = stdW > 0 ? (wPlus - meanW) / stdW : 0;
    wilcoxonP = 2 * (1 - normalCdf(Math.abs(zW)));
  }

  return {
    n,
    meanDiff,
    stdDiff,
    stderr,
    ci95Lower,
    ci95Upper,
    tStat,
    pValueT: pValT,
    wilcoxonW,
    wilcoxonP,
    wins: diffs.filter(d => d > 1e-6).length,
    ties: diffs.filter(d => Math.abs(d) <= 1e-6).length,
    losses: diffs.filter(d => d < -1e-6).length
  };
}

// ── Historical Case Builder (Leak-Free) ──────────────────────────────────────

function buildLeakFreeHistoryCounts(allCommits, testIndex, componentMap) {
  const historicalCommits = allCommits.slice(testIndex + 1);
  const counts = new Map();

  for (const commit of historicalCommits) {
    if (commit.isMerge) continue;

    const touchedCompIds = new Set();
    for (const item of commit.rawChanges || []) {
      const p = item.oldPath || item.filePath || item.newPath;
      if (!p || !isJavaSourceFile(p)) continue;

      for (const [id, comp] of componentMap.entries()) {
        if (comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath))) {
          touchedCompIds.add(id);
        }
      }
    }

    const ids = Array.from(touchedCompIds).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
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
      caseCount: casesForCommit.length
    });

    looCases.push(...casesForCommit);
  }

  return { eligibleCommits, looCases };
}

// ── Evaluation Execution ────────────────────────────────────────────────────

async function runEGCPEvaluation() {
  console.log(`\n=================================================================`);
  console.log(`   EGCP Master Evaluation against Frozen CSF & Reference Baselines`);
  console.log(`   Output Directory: ${OUTPUT_DIR}`);
  console.log(`=================================================================\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const projectResults = [];
  const allCommitRows = [];
  let totalEGCPRuntimeMs = 0;
  let totalCasesEvaluated = 0;

  for (const project of PROJECTS) {
    console.log(`\nEvaluating Project: ${project.name}`);
    console.log(`Path: ${project.path}`);

    const caseBuildResult = await buildHistoricalCasesFast(project.path, project.commitLimit);
    const { eligibleCommits, looCases } = caseBuildResult;
    console.log(`  Eligible Commits: ${eligibleCommits.length}, LOO Cases: ${looCases.length}`);

    const allCommits = parseGitLogCommits(project.path, project.commitLimit, { includeMerges: true });
    const historicalEpisodes = indexHistoricalEpisodesSafe(project.path, allCommits, 2);

    const caseResults = [];

    for (let cIdx = 0; cIdx < looCases.length; cIdx++) {
      const testCase = looCases[cIdx];
      const {
        caseId,
        commitHash,
        commitIndex,
        inputComponent,
        retroOracle,
        graphData,
        compMap,
        historyCounts
      } = testCase;

      // 1. Candidate Universe Generation (2 hops from seed on pre-change graph)
      const structuralCandidates = generateStructuralCandidatesInMemory([inputComponent], graphData, 2);
      const rankStruct = structuralCandidates.map(c => c.id);

      // 2. Historical Co-Change Reranker (V4)
      const rankedHist = rerankCandidatesWithHistory(structuralCandidates, [inputComponent], historyCounts);
      const rankHist = rankedHist.map(c => c.id);

      // 3. Train OCCP models strictly on older episodes
      const olderEpisodes = historicalEpisodes.filter(ep => ep.commitIndex > commitIndex);
      const { genericPathStats, conditionedPathStats } = trainPathModels(olderEpisodes);

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

      // 6. EGCP Models (Measured runtime)
      const egcpStart = performance.now();
      const rankedEGCPDual = rankModel_EGCP_Dual(structuralCandidates, inputComponent, graphData, historyCounts);
      const egcpEnd = performance.now();
      totalEGCPRuntimeMs += (egcpEnd - egcpStart);
      totalCasesEvaluated++;

      const rankEGCPDual = rankedEGCPDual.map(c => c.id);

      // EGCP Ablations
      const rankedEGCPStruct = rankModel_EGCP_StructOnly(structuralCandidates, inputComponent, graphData, historyCounts);
      const rankEGCPStruct = rankedEGCPStruct.map(c => c.id);

      const rankedEGCPEvo = rankModel_EGCP_EvoOnly(structuralCandidates, inputComponent, graphData, historyCounts);
      const rankEGCPEvo = rankedEGCPEvo.map(c => c.id);

      // Verify Candidate Universe Integrity
      const candLen = structuralCandidates.length;
      if (
        rankStruct.length !== candLen ||
        rankHist.length !== candLen ||
        rankOCCP.length !== candLen ||
        rankCSF.length !== candLen ||
        rankEGCPDual.length !== candLen ||
        rankEGCPStruct.length !== candLen ||
        rankEGCPEvo.length !== candLen
      ) {
        throw new Error(`Candidate universe violation in case ${caseId}`);
      }

      // Compute case metrics for all models
      const metrics = {
        canonical_baseline: computeCaseMetrics(rankStruct, retroOracle),
        historical_reranker: computeCaseMetrics(rankHist, retroOracle),
        original_occp: computeCaseMetrics(rankOCCP, retroOracle),
        csf_frozen: computeCaseMetrics(rankCSF, retroOracle),
        egcp_dual: computeCaseMetrics(rankEGCPDual, retroOracle),
        egcp_struct_ablation: computeCaseMetrics(rankEGCPStruct, retroOracle),
        egcp_evo_ablation: computeCaseMetrics(rankEGCPEvo, retroOracle)
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
      modelName: m.name,
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

  // ── Paired Hypothesis Testing (EGCP Dual vs. Baselines) ─────────────────────

  const egcpSeries = allCommitAveragesGlobal['egcp_dual'].map(c => c.map);
  const csfSeries = allCommitAveragesGlobal['csf_frozen'].map(c => c.map);
  const occpSeries = allCommitAveragesGlobal['original_occp'].map(c => c.map);
  const histSeries = allCommitAveragesGlobal['historical_reranker'].map(c => c.map);
  const structSeries = allCommitAveragesGlobal['canonical_baseline'].map(c => c.map);

  const statsVsCSF = pairedStats(egcpSeries, csfSeries);
  const statsVsOCCP = pairedStats(egcpSeries, occpSeries);
  const statsVsHist = pairedStats(egcpSeries, histSeries);
  const statsVsStruct = pairedStats(egcpSeries, structSeries);

  // ── CSV & JSON Deliverables ────────────────────────────────────────────────

  const f4 = v => (v !== undefined && v !== null ? v.toFixed(4) : 'N/A');

  // 1. egcp_metrics_by_project.csv
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
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_metrics_by_project.csv'), projCsvRows.join('\n'), 'utf8');

  // 2. egcp_per_commit_metrics.csv
  const commitCsvRows = ['Project,CommitHash,CaseCount,Model,MAP,MRR,DeltaVsBaseline,DeltaVsHistorical,DeltaVsCSF'];
  const totalCommitsN = allCommitAveragesGlobal['canonical_baseline'].length;
  for (let i = 0; i < totalCommitsN; i++) {
    const baseC = allCommitAveragesGlobal['canonical_baseline'][i];
    const histC = allCommitAveragesGlobal['historical_reranker'][i];
    const csfC = allCommitAveragesGlobal['csf_frozen'][i];

    for (const m of EVAL_MODELS) {
      const item = allCommitAveragesGlobal[m.key][i];
      const deltaBase = item.map - baseC.map;
      const deltaHist = item.map - histC.map;
      const deltaCSF = item.map - csfC.map;
      commitCsvRows.push(`"${item.project}","${item.commitHash}",${item.caseCount},"${m.name}",${f4(item.map)},${f4(item.mrr)},${f4(deltaBase)},${f4(deltaHist)},${f4(deltaCSF)}`);
    }
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_per_commit_metrics.csv'), commitCsvRows.join('\n'), 'utf8');

  // 3. egcp_ablation_comparison.csv
  const ablCsvRows = ['Configuration,Alpha,Description,MAP,MRR,P@5,R@5,F1@5,Hit@5'];
  ablCsvRows.push(`"EGCP-Dual",0.5,"Full Dual Evolutionary-Structural Diffusion",${f4(overallMacroCommits['egcp_dual'].map)},${f4(overallMacroCommits['egcp_dual'].mrr)},${f4(overallMacroCommits['egcp_dual'].pAt5)},${f4(overallMacroCommits['egcp_dual'].rAt5)},${f4(overallMacroCommits['egcp_dual'].f1At5)},${f4(overallMacroCommits['egcp_dual'].hitAt5)}`);
  ablCsvRows.push(`"EGCP-Struct",1.0,"Pure Structural Diffusion (zero evolutionary weights)",${f4(overallMacroCommits['egcp_struct_ablation'].map)},${f4(overallMacroCommits['egcp_struct_ablation'].mrr)},${f4(overallMacroCommits['egcp_struct_ablation'].pAt5)},${f4(overallMacroCommits['egcp_struct_ablation'].rAt5)},${f4(overallMacroCommits['egcp_struct_ablation'].f1At5)},${f4(overallMacroCommits['egcp_struct_ablation'].hitAt5)}`);
  ablCsvRows.push(`"EGCP-Evo",0.0,"Pure Evolutionary Diffusion (zero structural weights)",${f4(overallMacroCommits['egcp_evo_ablation'].map)},${f4(overallMacroCommits['egcp_evo_ablation'].mrr)},${f4(overallMacroCommits['egcp_evo_ablation'].pAt5)},${f4(overallMacroCommits['egcp_evo_ablation'].rAt5)},${f4(overallMacroCommits['egcp_evo_ablation'].f1At5)},${f4(overallMacroCommits['egcp_evo_ablation'].hitAt5)}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_ablation_comparison.csv'), ablCsvRows.join('\n'), 'utf8');

  // 4. egcp_results.json
  const rawResultsOutput = {
    evaluationDate: new Date().toISOString(),
    benchmarkUniverse: {
      totalCommits: totalCommitsN,
      totalCases: totalCasesEvaluated
    },
    performanceMetrics: {
      totalEGCPRuntimeMs,
      avgEGCPRuntimePerCaseMs: totalEGCPRuntimeMs / Math.max(1, totalCasesEvaluated),
      memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    },
    overallMacroCommits,
    statisticalTests: {
      vs_canonical_baseline: statsVsStruct,
      vs_historical_reranker: statsVsHist,
      vs_original_occp: statsVsOCCP,
      vs_csf_frozen: statsVsCSF
    },
    projectResults
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'egcp_results.json'), JSON.stringify(rawResultsOutput, null, 2), 'utf8');

  console.log(`\n======================================================`);
  console.log(`   EGCP EVALUATION SUMMARY RESULTS (K = ${totalCommitsN}, N = ${totalCasesEvaluated})`);
  console.log(`======================================================`);
  for (const m of EVAL_MODELS) {
    const res = overallMacroCommits[m.key];
    console.log(`${m.name.padEnd(48)} | MAP: ${f4(res.map)} | MRR: ${f4(res.mrr)} | P@5: ${f4(res.pAt5)} | R@5: ${f4(res.rAt5)} | F1@5: ${f4(res.f1At5)}`);
  }

  console.log(`\nStatistical Comparison (EGCP-Dual vs. Baselines):`);
  console.log(`  vs. Canonical Baseline: Mean Diff = ${f4(statsVsStruct.meanDiff)}, t = ${f4(statsVsStruct.tStat)} (p = ${f4(statsVsStruct.pValueT)}), W/T/L = ${statsVsStruct.wins}/${statsVsStruct.ties}/${statsVsStruct.losses}`);
  console.log(`  vs. Historical (V4):    Mean Diff = ${f4(statsVsHist.meanDiff)}, t = ${f4(statsVsHist.tStat)} (p = ${f4(statsVsHist.pValueT)}), W/T/L = ${statsVsHist.wins}/${statsVsHist.ties}/${statsVsHist.losses}`);
  console.log(`  vs. CSF Frozen:         Mean Diff = ${f4(statsVsCSF.meanDiff)}, t = ${f4(statsVsCSF.tStat)} (p = ${f4(statsVsCSF.pValueT)}), W/T/L = ${statsVsCSF.wins}/${statsVsCSF.ties}/${statsVsCSF.losses}`);
  console.log(`\nAverage EGCP runtime per case: ${(totalEGCPRuntimeMs / totalCasesEvaluated).toFixed(2)} ms`);
}

runEGCPEvaluation().catch(err => {
  console.error('Fatal error during EGCP evaluation:', err);
  process.exit(1);
});
