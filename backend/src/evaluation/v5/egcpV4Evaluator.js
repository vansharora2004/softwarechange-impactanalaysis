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

import { parseGitLogCommits } from '../../services/gitChangeDetector.js';
import {
  EVAL_MODELS,
  buildHistoricalCasesFast,
  indexHistoricalEpisodesSafe,
  pairedStats,
  computeMacroMetrics,
  computeMicroMetrics,
  evaluateProjectCases
} from './egcpV4EvalCore.js';

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

    const tStartProject = performance.now();
    const { caseResults, runtimeV4Ms } = evaluateProjectCases(
      project.path, eligibleCommits, allCommits, historicalEpisodes, { trainCommits: project.trainCommits }
    );
    totalRuntimeV4Ms += runtimeV4Ms;

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
