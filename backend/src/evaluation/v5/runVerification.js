import fs from 'fs';
import path from 'path';

const INPUT_JSON = 'c:/yashika/STUDY/clg_project/software_change/research_artifacts/occp_final_evaluation_20261020/experiment_results.json';
const OUTPUT_DIR = 'c:/yashika/STUDY/clg_project/software_change/research_artifacts/occp_final_verification_20261020';

const rawData = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf8'));

const MODELS = [
  { key: 'structural_baseline', name: 'Canonical Structural Baseline' },
  { key: 'historical_reranker', name: 'Historical Co-Change Reranker (V4)' },
  { key: 'modelA_context_free', name: 'Context-Independent Typed Path (Model A)' },
  { key: 'modelB_occp', name: 'Original OCCP (Unregularized MLE)' },
  { key: 'occp_fusion', name: 'Continuous Score Fusion' },
  { key: 'occp_enhanced', name: 'Enhanced OCCP (Selected Best)' }
];

function normalCdf(z) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1.0 - prob : prob;
}

function tDistCdfApprox(t, df) {
  // Hill's approximation or normal approx for df >= 20
  const z = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + t * t / (2 * df));
  return normalCdf(z);
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
  const df = n - 1;
  const pValT = 2 * (1 - normalCdf(Math.abs(tStat))); // large sample approx
  const ci95Lower = meanDiff - 2.064 * stderr; // using t_0.025 for df=24 ~ 2.064
  const ci95Upper = meanDiff + 2.064 * stderr;

  // Wilcoxon
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

  const sortedDiffs = [...diffs].sort((a, b) => a - b);
  const medianDiff = n % 2 === 1 ? sortedDiffs[Math.floor(n / 2)] : (sortedDiffs[n / 2 - 1] + sortedDiffs[n / 2]) / 2;

  return {
    n,
    df,
    meanDiff,
    medianDiff,
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

console.log('Verifying all metrics from raw case results...');

const verifiedProjectSummaries = [];
const verifiedPerCommitRows = [];
const allCommitAveragesGlobal = {};
for (const m of MODELS) {
  allCommitAveragesGlobal[m.key] = [];
}

let candidateAlignmentViolations = 0;

for (const p of rawData.projectResults) {
  const pName = p.projectName;
  const caseResults = p.caseResults;

  // 1. Candidate Alignment Check
  for (const cr of caseResults) {
    // candidateCount is recorded
    const cCount = cr.candidateCount;
    for (const m of MODELS) {
      if (cr.metrics[m.key].candidateCount !== cCount) {
        candidateAlignmentViolations++;
        console.error(`Mismatch in candidateCount in case ${cr.caseId}: expected ${cCount}, got ${cr.metrics[m.key].candidateCount}`);
      }
    }
  }

  // 2. Aggregate per Commit
  const commitMap = new Map();
  for (const cr of caseResults) {
    if (!commitMap.has(cr.commitHash)) {
      commitMap.set(cr.commitHash, []);
    }
    commitMap.get(cr.commitHash).push(cr);
  }

  const commitList = Array.from(commitMap.keys());
  const numCommits = commitList.length;

  for (const m of MODELS) {
    const commitAveragesForModel = [];

    for (const cHash of commitList) {
      const casesInCommit = commitMap.get(cHash);
      const k = casesInCommit.length;
      const mList = casesInCommit.map(c => c.metrics[m.key]);

      const cAvg = {
        commitHash: cHash,
        caseCount: k,
        pAt3: mList.reduce((s, x) => s + x.pAt3, 0) / k,
        rAt3: mList.reduce((s, x) => s + x.rAt3, 0) / k,
        pAt5: mList.reduce((s, x) => s + x.pAt5, 0) / k,
        rAt5: mList.reduce((s, x) => s + x.rAt5, 0) / k,
        pAt10: mList.reduce((s, x) => s + x.pAt10, 0) / k,
        rAt10: mList.reduce((s, x) => s + x.rAt10, 0) / k,
        map: mList.reduce((s, x) => s + x.map, 0) / k,
        mrr: mList.reduce((s, x) => s + x.mrr, 0) / k
      };
      commitAveragesForModel.push(cAvg);

      // Save commit row for per_commit_metrics.csv
      // We will compute deltas after baseline is known
    }

    allCommitAveragesGlobal[m.key].push(...commitAveragesForModel.map(ca => ({ project: pName, ...ca })));

    // Macro across commits for this project
    const macroProject = {
      project: pName,
      modelKey: m.key,
      modelName: m.name,
      eligibleCommits: numCommits,
      testCases: caseResults.length,
      pAt3: commitAveragesForModel.reduce((s, c) => s + c.pAt3, 0) / numCommits,
      rAt3: commitAveragesForModel.reduce((s, c) => s + c.rAt3, 0) / numCommits,
      pAt5: commitAveragesForModel.reduce((s, c) => s + c.pAt5, 0) / numCommits,
      rAt5: commitAveragesForModel.reduce((s, c) => s + c.rAt5, 0) / numCommits,
      pAt10: commitAveragesForModel.reduce((s, c) => s + c.pAt10, 0) / numCommits,
      rAt10: commitAveragesForModel.reduce((s, c) => s + c.rAt10, 0) / numCommits,
      map: commitAveragesForModel.reduce((s, c) => s + c.map, 0) / numCommits,
      mrr: commitAveragesForModel.reduce((s, c) => s + c.mrr, 0) / numCommits
    };
    verifiedProjectSummaries.push(macroProject);
  }
}

console.log(`Candidate Alignment Violations across all cases: ${candidateAlignmentViolations}`);

// Compute overall macro-average across all 25 commits
const totalCommitsGlobal = allCommitAveragesGlobal['structural_baseline'].length;
const totalCasesGlobal = rawData.projectResults.reduce((s, p) => s + p.looCasesCount, 0);

for (const m of MODELS) {
  const cList = allCommitAveragesGlobal[m.key];
  verifiedProjectSummaries.push({
    project: 'Overall (All 3 Projects)',
    modelKey: m.key,
    modelName: m.name,
    eligibleCommits: totalCommitsGlobal,
    testCases: totalCasesGlobal,
    pAt3: cList.reduce((s, c) => s + c.pAt3, 0) / totalCommitsGlobal,
    rAt3: cList.reduce((s, c) => s + c.rAt3, 0) / totalCommitsGlobal,
    pAt5: cList.reduce((s, c) => s + c.pAt5, 0) / totalCommitsGlobal,
    rAt5: cList.reduce((s, c) => s + c.rAt5, 0) / totalCommitsGlobal,
    pAt10: cList.reduce((s, c) => s + c.pAt10, 0) / totalCommitsGlobal,
    rAt10: cList.reduce((s, c) => s + c.rAt10, 0) / totalCommitsGlobal,
    map: cList.reduce((s, c) => s + c.map, 0) / totalCommitsGlobal,
    mrr: cList.reduce((s, c) => s + c.mrr, 0) / totalCommitsGlobal
  });
}

// Write verified_metrics_by_project.csv
const f4 = v => (v !== undefined && v !== null ? v.toFixed(4) : 'N/A');
const csvProjRows = ['Project,Model,EligibleCommits,TestCases,MAP,MRR,P@3,R@3,P@5,R@5,P@10,R@10'];
for (const row of verifiedProjectSummaries) {
  csvProjRows.push(`"${row.project}","${row.modelName}",${row.eligibleCommits},${row.testCases},${f4(row.map)},${f4(row.mrr)},${f4(row.pAt3)},${f4(row.rAt3)},${f4(row.pAt5)},${f4(row.rAt5)},${f4(row.pAt10)},${f4(row.rAt10)}`);
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'verified_metrics_by_project.csv'), csvProjRows.join('\n'), 'utf8');

// Build per-commit metrics with deltas
const csvCommitRows = ['Project,CommitHash,CaseCount,Model,MAP,MRR,DeltaVsBaseline,DeltaVsHistorical,DeltaVsOCCP'];
const structList = allCommitAveragesGlobal['structural_baseline'];
const histList = allCommitAveragesGlobal['historical_reranker'];
const occpList = allCommitAveragesGlobal['modelB_occp'];

for (let i = 0; i < totalCommitsGlobal; i++) {
  const structItem = structList[i];
  const histItem = histList[i];
  const occpItem = occpList[i];

  for (const m of MODELS) {
    const item = allCommitAveragesGlobal[m.key][i];
    const deltaBase = item.map - structItem.map;
    const deltaHist = item.map - histItem.map;
    const deltaOccp = item.map - occpItem.map;

    csvCommitRows.push(`"${item.project}","${item.commitHash}",${item.caseCount},"${m.name}",${f4(item.map)},${f4(item.mrr)},${f4(deltaBase)},${f4(deltaHist)},${f4(deltaOccp)}`);
  }
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'verified_per_commit_metrics.csv'), csvCommitRows.join('\n'), 'utf8');

// Statistical Tests
const structSeries = structList.map(c => c.map);
const histSeries = histList.map(c => c.map);
const occpSeries = occpList.map(c => c.map);

const statisticalTests = {
  vs_baseline: {},
  vs_historical: {},
  vs_occp: {}
};

for (const m of MODELS) {
  const mSeries = allCommitAveragesGlobal[m.key].map(c => c.map);
  if (m.key !== 'structural_baseline') {
    statisticalTests.vs_baseline[m.key] = pairedStats(mSeries, structSeries);
  }
  if (m.key !== 'historical_reranker') {
    statisticalTests.vs_historical[m.key] = pairedStats(mSeries, histSeries);
  }
  if (m.key !== 'modelB_occp') {
    statisticalTests.vs_occp[m.key] = pairedStats(mSeries, occpSeries);
  }
}

// 4-Commit Commons Lang Sensitivity Analysis (excluding ed31115)
const langIndices = [];
for (let i = 0; i < totalCommitsGlobal; i++) {
  if (structList[i].project === 'Apache Commons Lang') {
    langIndices.push(i);
  }
}
const lang4Indices = langIndices.filter(i => structList[i].commitHash !== 'ed31115');

const sensitivity4CommitsLang = {};
for (const m of MODELS) {
  const vals = lang4Indices.map(i => allCommitAveragesGlobal[m.key][i].map);
  const mrrs = lang4Indices.map(i => allCommitAveragesGlobal[m.key][i].mrr);
  sensitivity4CommitsLang[m.key] = {
    map: vals.reduce((s, v) => s + v, 0) / vals.length,
    mrr: mrrs.reduce((s, v) => s + v, 0) / mrrs.length
  };
}

// Fallback & Operation statistics
const fallbackSummaries = {};
const operationSummaries = {};
for (const p of rawData.projectResults) {
  fallbackSummaries[p.projectName] = p.fallbackStats;
  operationSummaries[p.projectName] = p.operationStats;
}

const verifiedResultsJson = {
  verifiedAt: new Date().toISOString(),
  targetRepositories: [
    'Spring PetClinic REST',
    'Shopizer',
    'Apache Commons Lang'
  ],
  commitUniverse: {
    totalEligibleCommits: totalCommitsGlobal,
    totalTestCases: totalCasesGlobal,
    projectBreakdown: {
      'Spring PetClinic REST': { commits: 8, cases: 57 },
      'Shopizer': { commits: 12, cases: 46 },
      'Apache Commons Lang': { commits: 5, cases: 67 }
    }
  },
  candidateAlignmentVerified: candidateAlignmentViolations === 0,
  modelsEvaluated: MODELS,
  verifiedProjectSummaries,
  statisticalTests,
  sensitivity4CommitsLang,
  fallbackSummaries,
  operationSummaries
};

fs.writeFileSync(path.join(OUTPUT_DIR, 'verified_results.json'), JSON.stringify(verifiedResultsJson, null, 2), 'utf8');

console.log('All verification calculations completed successfully!');
console.log('Statistical summary vs Historical Reranker:');
for (const k of Object.keys(statisticalTests.vs_historical)) {
  const s = statisticalTests.vs_historical[k];
  console.log(`  ${k}: meanDiff = ${f4(s.meanDiff)}, 95% CI [${f4(s.ci95Lower)}, ${f4(s.ci95Upper)}], t = ${f4(s.tStat)} (p = ${f4(s.pValueT)}), Wilcoxon p = ${f4(s.wilcoxonP)}, W/T/L = ${s.wins}/${s.ties}/${s.losses}`);
}
console.log('\n4-Commit Commons Lang Sensitivity (excluding ed31115):');
for (const k of Object.keys(sensitivity4CommitsLang)) {
  console.log(`  ${k}: MAP = ${f4(sensitivity4CommitsLang[k].map)}, MRR = ${f4(sensitivity4CommitsLang[k].mrr)}`);
}
