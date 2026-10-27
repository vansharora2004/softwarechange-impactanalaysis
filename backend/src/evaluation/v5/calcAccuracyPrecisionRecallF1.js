import fs from 'fs';
import path from 'path';

const INPUT_JSON = 'c:/yashika/STUDY/clg_project/software_change/research_artifacts/occp_final_evaluation_20261020/experiment_results.json';
const rawData = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf8'));

const MODELS = [
  { key: 'structural_baseline', name: 'Canonical Structural Baseline' },
  { key: 'historical_reranker', name: 'Historical Co-Change Reranker (V4)' },
  { key: 'modelA_context_free', name: 'Context-Independent Typed Path (Model A)' },
  { key: 'modelB_occp', name: 'Original OCCP (Model B)' },
  { key: 'occp_fusion', name: 'Continuous Score Fusion' },
  { key: 'occp_enhanced', name: 'Enhanced OCCP' }
];

const K_VALUES = [3, 5, 10];

const resultsByProject = {};

for (const pr of rawData.projectResults) {
  const pName = pr.projectName;
  resultsByProject[pName] = {};

  // Group cases by commit
  const commitMap = new Map();
  for (const cr of pr.caseResults) {
    if (!commitMap.has(cr.commitHash)) commitMap.set(cr.commitHash, []);
    commitMap.get(cr.commitHash).push(cr);
  }

  const commitList = Array.from(commitMap.keys());
  const numCommits = commitList.length;

  for (const m of MODELS) {
    resultsByProject[pName][m.key] = {
      modelName: m.name,
      commitCount: numCommits,
      caseCount: pr.caseResults.length,
      metricsByK: {}
    };

    for (const k of K_VALUES) {
      const commitAverages = [];

      for (const cHash of commitList) {
        const cases = commitMap.get(cHash);
        const nCases = cases.length;

        let sumP = 0;
        let sumR = 0;
        let sumF1 = 0;
        let sumTopKAcc = 0;
        let sumBinAcc = 0;

        for (const cr of cases) {
          const met = cr.metrics[m.key];
          const p = met[`pAt${k}`];
          const r = met[`rAt${k}`];
          const f1 = (p + r > 0) ? (2 * p * r) / (p + r) : 0;
          const hits = Math.round(p * k);
          const topKAcc = hits > 0 ? 1 : 0;

          // Binary classification accuracy over candidate universe |C|
          const C = cr.candidateCount || 20;
          const oracle = cr.oracleSize || 1;
          const TP = hits;
          const FP = k - hits;
          const FN = Math.max(0, oracle - hits);
          const TN = Math.max(0, C - TP - FP - FN);
          const binAcc = (TP + TN) / Math.max(1, C);

          sumP += p;
          sumR += r;
          sumF1 += f1;
          sumTopKAcc += topKAcc;
          sumBinAcc += binAcc;
        }

        commitAverages.push({
          p: sumP / nCases,
          r: sumR / nCases,
          f1: sumF1 / nCases,
          topKAcc: sumTopKAcc / nCases,
          binAcc: sumBinAcc / nCases
        });
      }

      resultsByProject[pName][m.key].metricsByK[k] = {
        precision: commitAverages.reduce((s, c) => s + c.p, 0) / numCommits,
        recall: commitAverages.reduce((s, c) => s + c.r, 0) / numCommits,
        f1: commitAverages.reduce((s, c) => s + c.f1, 0) / numCommits,
        topKAccuracy: commitAverages.reduce((s, c) => s + c.topKAcc, 0) / numCommits,
        binaryAccuracy: commitAverages.reduce((s, c) => s + c.binAcc, 0) / numCommits
      };
    }
  }
}

// Compute Overall (Macro across all 25 commits)
const overallResults = {};
const allCommitsGlobal = [];
for (const pr of rawData.projectResults) {
  const commitMap = new Map();
  for (const cr of pr.caseResults) {
    if (!commitMap.has(cr.commitHash)) commitMap.set(cr.commitHash, []);
    commitMap.get(cr.commitHash).push(cr);
  }
  for (const [cHash, cases] of commitMap.entries()) {
    allCommitsGlobal.push({ project: pr.projectName, commitHash: cHash, cases });
  }
}

const totalCommitsGlobal = allCommitsGlobal.length;

for (const m of MODELS) {
  overallResults[m.key] = {
    modelName: m.name,
    commitCount: totalCommitsGlobal,
    caseCount: rawData.projectResults.reduce((s, p) => s + p.looCasesCount, 0),
    metricsByK: {}
  };

  for (const k of K_VALUES) {
    const commitAverages = [];

    for (const item of allCommitsGlobal) {
      const cases = item.cases;
      const nCases = cases.length;

      let sumP = 0;
      let sumR = 0;
      let sumF1 = 0;
      let sumTopKAcc = 0;
      let sumBinAcc = 0;

      for (const cr of cases) {
        const met = cr.metrics[m.key];
        const p = met[`pAt${k}`];
        const r = met[`rAt${k}`];
        const f1 = (p + r > 0) ? (2 * p * r) / (p + r) : 0;
        const hits = Math.round(p * k);
        const topKAcc = hits > 0 ? 1 : 0;

        const C = cr.candidateCount || 20;
        const oracle = cr.oracleSize || 1;
        const TP = hits;
        const FP = k - hits;
        const FN = Math.max(0, oracle - hits);
        const TN = Math.max(0, C - TP - FP - FN);
        const binAcc = (TP + TN) / Math.max(1, C);

        sumP += p;
        sumR += r;
        sumF1 += f1;
        sumTopKAcc += topKAcc;
        sumBinAcc += binAcc;
      }

      commitAverages.push({
        p: sumP / nCases,
        r: sumR / nCases,
        f1: sumF1 / nCases,
        topKAcc: sumTopKAcc / nCases,
        binAcc: sumBinAcc / nCases
      });
    }

    overallResults[m.key].metricsByK[k] = {
      precision: commitAverages.reduce((s, c) => s + c.p, 0) / totalCommitsGlobal,
      recall: commitAverages.reduce((s, c) => s + c.r, 0) / totalCommitsGlobal,
      f1: commitAverages.reduce((s, c) => s + c.f1, 0) / totalCommitsGlobal,
      topKAccuracy: commitAverages.reduce((s, c) => s + c.topKAcc, 0) / totalCommitsGlobal,
      binaryAccuracy: commitAverages.reduce((s, c) => s + c.binAcc, 0) / totalCommitsGlobal
    };
  }
}

const f4 = v => (v !== undefined && v !== null ? v.toFixed(4) : 'N/A');

console.log('=== OVERALL MACRO-AVERAGE ACROSS ALL 25 COMMITS ===');
console.log('Model | Cutoff | Accuracy (Hit@K) | Precision@K | Recall@K | F1@K | Binary Acc');
for (const m of MODELS) {
  for (const k of K_VALUES) {
    const res = overallResults[m.key].metricsByK[k];
    console.log(`${m.name.padEnd(35)} | @${k.toString().padEnd(2)} | ${f4(res.topKAccuracy)} | ${f4(res.precision)} | ${f4(res.recall)} | ${f4(res.f1)} | ${f4(res.binaryAccuracy)}`);
  }
}

console.log('\n=== PER PROJECT SUMMARY @ K=5 ===');
for (const pName of Object.keys(resultsByProject)) {
  console.log(`\nProject: ${pName}`);
  for (const m of MODELS) {
    const res = resultsByProject[pName][m.key].metricsByK[5];
    console.log(`  ${m.name.padEnd(35)}: Acc(Hit@5) = ${f4(res.topKAccuracy)}, P@5 = ${f4(res.precision)}, R@5 = ${f4(res.recall)}, F1@5 = ${f4(res.f1)}`);
  }
}

// Write to CSV
const csvRows = ['Project,Model,K,Accuracy_HitAtK,PrecisionAtK,RecallAtK,F1AtK,BinaryAccuracy'];
for (const pName of Object.keys(resultsByProject)) {
  for (const m of MODELS) {
    for (const k of K_VALUES) {
      const res = resultsByProject[pName][m.key].metricsByK[k];
      csvRows.push(`"${pName}","${m.name}",${k},${f4(res.topKAccuracy)},${f4(res.precision)},${f4(res.recall)},${f4(res.f1)},${f4(res.binaryAccuracy)}`);
    }
  }
}
for (const m of MODELS) {
  for (const k of K_VALUES) {
    const res = overallResults[m.key].metricsByK[k];
    csvRows.push(`"Overall (All 3 Projects)","${m.name}",${k},${f4(res.topKAccuracy)},${f4(res.precision)},${f4(res.recall)},${f4(res.f1)},${f4(res.binaryAccuracy)}`);
  }
}

const outPath = 'c:/yashika/STUDY/clg_project/software_change/research_artifacts/occp_final_verification_20261020/accuracy_precision_recall_f1_comparison.csv';
fs.writeFileSync(outPath, csvRows.join('\n'), 'utf8');
console.log(`\nSaved CSV to ${outPath}`);
