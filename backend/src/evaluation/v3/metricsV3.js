/**
 * metricsV3.js
 * ------------
 * Metrics and case-splitting utilities for the V3 Retrospective Evaluation.
 *
 * Key additions:
 *   1. generateLeaveOneOutCases:
 *      Given an eligible commit with M (>= 2) mapped non-Test components and
 *      T (>= 0) mapped Test components, produces M evaluation cases.
 *      Each case sets 1 non-Test component as input ('changedIds'), the other
 *      (M - 1) non-Test components as 'retroOracle', and all T Test components
 *      as 'retroTestOracle'.
 *   2. Symmetric prediction extraction:
 *      Applied identically to baseline and context-aware models.
 *   3. Two-level aggregation:
 *      First averages metrics per commit across its leave-one-out cases,
 *      then computes the macro-average across independent commits.
 *   4. Full ablation comparison with score and rank deltas.
 */

'use strict';

export const STRUCTURAL_RELS_V3 = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'EXTENDS']);

/**
 * Generate leave-one-out cases from a single commit's mapped components.
 *
 * @param {Object} commitInfo
 * @param {string} commitInfo.hash
 * @param {string} commitInfo.subject
 * @param {number} commitInfo.timestamp
 * @param {number} commitInfo.index
 * @param {string[]} nonTestIds   Mapped non-Test component IDs in the commit
 * @param {string[]} testIds      Mapped Test component IDs in the commit
 * @param {Map} historyCounts     Leak-free co-change counts (older commits only)
 * @returns {Object[]} array of LOO case objects
 */
export function generateLeaveOneOutCases(commitInfo, nonTestIds, testIds, historyCounts) {
  if (!nonTestIds || nonTestIds.length < 2) return [];

  const uniqueNonTest = [...new Set(nonTestIds)].sort();
  const uniqueTests = [...new Set(testIds || [])].sort();
  const cases = [];

  for (let i = 0; i < uniqueNonTest.length; i++) {
    const inputId = uniqueNonTest[i];
    const targetIds = uniqueNonTest.filter((_, idx) => idx !== i);

    // Leak check: input must never appear in oracle
    if (targetIds.includes(inputId)) {
      throw new Error(`Leakage detected in LOO split for ${inputId}`);
    }

    cases.push({
      caseId: `loo_${commitInfo.index}_${commitInfo.hash.slice(0, 7)}_${inputId}`,
      commitHash: commitInfo.hash,
      commitSubject: commitInfo.subject,
      commitTimestamp: commitInfo.timestamp,
      commitIndex: commitInfo.index,
      inputComponent: inputId,
      changedIds: [inputId],
      retroOracle: new Set(targetIds),
      retroTestOracle: new Set(uniqueTests),
      historyCounts,
      totalCommitNonTestCount: uniqueNonTest.length,
      totalCommitTestCount: uniqueTests.length
    });
  }

  return cases;
}

/**
 * Extract symmetric prediction lists from engine outputs.
 *
 * @param {Object[]} results
 * @param {'baseline'|'context'} engineType
 * @param {Map<string, string>} typeMap
 * @returns {{ mainPredicted: string[], testPredicted: string[] }}
 */
export function extractPredictionsV3(results, engineType, typeMap) {
  if (!Array.isArray(results)) return { mainPredicted: [], testPredicted: [] };

  if (engineType === 'baseline') {
    return {
      mainPredicted: results.filter(r => typeMap.get(r.name) !== 'Test').map(r => r.name),
      testPredicted: results.filter(r => typeMap.get(r.name) === 'Test').map(r => r.name),
    };
  } else {
    return {
      mainPredicted: results.filter(r => r.category !== 'Regression Tests').map(r => r.component),
      testPredicted: results.filter(r => r.category === 'Regression Tests').map(r => r.component),
    };
  }
}

/**
 * Compute standard IR metrics (Precision, Recall, F1).
 */
export function computePRFV3(predicted, oracle) {
  if (!oracle || oracle.size === 0) {
    const prec = (!predicted || predicted.length === 0) ? 1.0 : 0.0;
    return { precision: prec, recall: 1.0, f1: prec, tp: 0, fp: predicted ? predicted.length : 0, fn: 0 };
  }

  const predList = predicted || [];
  const predSet = new Set(predList);
  const tp = [...predSet].filter(p => oracle.has(p)).length;
  const fp = predSet.size - tp;
  const fn = oracle.size - tp;

  const precision = predSet.size === 0 ? 0.0 : tp / predSet.size;
  const recall = tp / oracle.size;
  const f1 = (precision + recall) === 0 ? 0.0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, tp, fp, fn };
}

export function precisionAtKV3(rankedPredictions, oracle, k) {
  if (!oracle || oracle.size === 0) return 0.0;
  const topK = (rankedPredictions || []).slice(0, k);
  if (topK.length === 0) return 0.0;
  return topK.filter(p => oracle.has(p)).length / topK.length;
}

export function recallAtKV3(rankedPredictions, oracle, k) {
  if (!oracle || oracle.size === 0) return 1.0;
  const topK = new Set((rankedPredictions || []).slice(0, k));
  return [...oracle].filter(o => topK.has(o)).length / oracle.size;
}

/**
 * Two-level aggregation:
 * Level 1: Average LOO cases within the same commit.
 * Level 2: Average commit-level metrics across all independent commits.
 *
 * @param {Object[]} caseResults Array of case result objects
 * @param {string} variantKey Model variant key (e.g. 'baseline', 'context_full')
 * @returns {{ perCommit: Object[], macroAcrossCommits: Object }}
 */
export function aggregateTwoLevel(caseResults, variantKey) {
  if (!caseResults || caseResults.length === 0) return { perCommit: [], macroAcrossCommits: {} };

  // Group by commitHash
  const commitGroups = new Map();
  for (const cr of caseResults) {
    if (!commitGroups.has(cr.commitHash)) {
      commitGroups.set(cr.commitHash, []);
    }
    commitGroups.get(cr.commitHash).push(cr[variantKey]);
  }

  const metricKeys = ['precision', 'recall', 'f1', 'P@3', 'R@3', 'P@5', 'R@5', 'P@10', 'R@10', 'testPrecision', 'testRecall', 'testF1'];
  const perCommit = [];

  for (const [hash, cases] of commitGroups.entries()) {
    const commitAvg = { commitHash: hash, caseCount: cases.length };
    for (const key of metricKeys) {
      const sum = cases.reduce((acc, c) => acc + (c[key] ?? 0), 0);
      commitAvg[key] = parseFloat((sum / cases.length).toFixed(4));
    }
    perCommit.push(commitAvg);
  }

  // Macro-average across commits
  const macroAcrossCommits = { commitCount: perCommit.length };
  for (const key of metricKeys) {
    const sum = perCommit.reduce((acc, c) => acc + (c[key] ?? 0), 0);
    macroAcrossCommits[key] = parseFloat((sum / perCommit.length).toFixed(4));
  }

  return { perCommit, macroAcrossCommits };
}

/**
 * Compare two ranked lists for score and rank deltas.
 */
export function compareAblationV3(fullResults, ablatedResults) {
  const fullMap = new Map((fullResults || []).map((r, i) => [r.component || r.name, { score: r.influenceScore ?? null, rank: i }]));
  const ablMap = new Map((ablatedResults || []).map((r, i) => [r.component || r.name, { score: r.influenceScore ?? null, rank: i }]));

  const allIds = new Set([...fullMap.keys(), ...ablMap.keys()]);
  const diffs = [];

  for (const id of allIds) {
    const f = fullMap.get(id) ?? { score: null, rank: Infinity };
    const a = ablMap.get(id) ?? { score: null, rank: Infinity };
    const scoreChange = (f.score !== null && a.score !== null) ? parseFloat((f.score - a.score).toFixed(4)) : null;
    const rankChange = (f.rank !== Infinity && a.rank !== Infinity) ? f.rank - a.rank : null;
    if (scoreChange !== 0 || rankChange !== 0) {
      diffs.push({ id, fullScore: f.score, ablatedScore: a.score, scoreChange, fullRank: f.rank, ablatedRank: a.rank, rankChange });
    }
  }

  return diffs.sort((a, b) => Math.abs(b.scoreChange ?? 0) - Math.abs(a.scoreChange ?? 0));
}

/**
 * Self-contained unit tests.
 */
export function runUnitTestsV3() {
  const failures = [];
  function assert(cond, msg) {
    if (!cond) failures.push(`FAIL: ${msg}`);
    else console.log(`  PASS: ${msg}`);
  }
  function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

  console.log('\n=== metricsV3 unit tests ===\n');

  // Test 1: LOO generation for 3 non-Test components
  const cInfo = { hash: 'abcdef123456789', subject: 'feat: multi change', timestamp: 123456, index: 5 };
  const nonTest = ['ServiceA', 'RepoB', 'ControllerC'];
  const testComps = ['TestA'];
  const looCases = generateLeaveOneOutCases(cInfo, nonTest, testComps, new Map());

  assert(looCases.length === 3, 'LOO generation: creates exactly 3 cases from 3 non-test components');
  assert(looCases[0].inputComponent === 'ControllerC', 'LOO generation: first sorted input is ControllerC');
  assert(!looCases[0].retroOracle.has('ControllerC'), 'LOO leakage: input not in retroOracle');
  assert(looCases[0].retroOracle.has('RepoB') && looCases[0].retroOracle.has('ServiceA'), 'LOO targets: other 2 components in oracle');
  assert(looCases[0].retroTestOracle.has('TestA'), 'LOO test isolation: TestA in retroTestOracle');

  // Test 2: LOO edge cases (<2 non-test components)
  const loo1 = generateLeaveOneOutCases(cInfo, ['SingleComp'], ['TestA'], new Map());
  assert(loo1.length === 0, 'LOO edge case: 1 non-test component returns 0 cases');

  // Test 3: Symmetric extraction
  const typeMap = new Map([['CompA', 'Service'], ['TestA', 'Test']]);
  const baseOut = [{ name: 'CompA' }, { name: 'TestA' }];
  const { mainPredicted: bMain, testPredicted: bTest } = extractPredictionsV3(baseOut, 'baseline', typeMap);
  assert(bMain.length === 1 && bMain[0] === 'CompA', 'Symmetric extraction baseline: main has only CompA');
  assert(bTest.length === 1 && bTest[0] === 'TestA', 'Symmetric extraction baseline: test has only TestA');

  const ctxOut = [{ component: 'CompA', category: 'Impacted Component' }, { component: 'TestA', category: 'Regression Tests' }];
  const { mainPredicted: cMain, testPredicted: cTest } = extractPredictionsV3(ctxOut, 'context', typeMap);
  assert(cMain.length === 1 && cMain[0] === 'CompA', 'Symmetric extraction context: main has only CompA');
  assert(cTest.length === 1 && cTest[0] === 'TestA', 'Symmetric extraction context: test has only TestA');

  // Test 4: Empty prediction set & empty oracle handling
  const emptyPredPRF = computePRFV3([], new Set(['TargetA']));
  assert(emptyPredPRF.precision === 0 && emptyPredPRF.recall === 0, 'Empty predictions: P=0, R=0');

  const emptyOraclePRF = computePRFV3([], new Set());
  assert(emptyOraclePRF.precision === 1 && emptyOraclePRF.recall === 1, 'Empty oracle & empty predictions: P=1, R=1');

  const emptyOracleWithPreds = computePRFV3(['PredA'], new Set());
  assert(emptyOracleWithPreds.precision === 0 && emptyOracleWithPreds.recall === 1, 'Empty oracle with predictions: P=0, R=1');

  // Test 5: P@K and R@K
  const oracle = new Set(['TargetA', 'TargetB']);
  const ranked = ['TargetA', 'Noise1', 'Noise2', 'TargetB'];
  assert(approx(precisionAtKV3(ranked, oracle, 3), 1 / 3), 'P@3: 1 of 3 relevant');
  assert(approx(recallAtKV3(ranked, oracle, 3), 0.5), 'R@3: 1 of 2 recalled');
  assert(approx(precisionAtKV3(ranked, oracle, 5), 2 / 4), 'P@5: 2 of 4 relevant');
  assert(approx(recallAtKV3(ranked, oracle, 5), 1.0), 'R@5: all recalled');

  // Test 6: Two-level aggregation
  const mockResults = [
    { commitHash: 'commit1', model: { precision: 1.0, recall: 0.5, f1: 0.6667, 'P@3': 1.0, 'R@3': 0.5, 'P@5': 0.5, 'R@5': 0.5, 'P@10': 0.5, 'R@10': 0.5, testPrecision: 1.0, testRecall: 1.0, testF1: 1.0 } },
    { commitHash: 'commit1', model: { precision: 0.0, recall: 0.0, f1: 0.0, 'P@3': 0.0, 'R@3': 0.0, 'P@5': 0.0, 'R@5': 0.0, 'P@10': 0.0, 'R@10': 0.0, testPrecision: 0.0, testRecall: 0.0, testF1: 0.0 } },
    { commitHash: 'commit2', model: { precision: 1.0, recall: 1.0, f1: 1.0, 'P@3': 1.0, 'R@3': 1.0, 'P@5': 1.0, 'R@5': 1.0, 'P@10': 1.0, 'R@10': 1.0, testPrecision: 1.0, testRecall: 1.0, testF1: 1.0 } }
  ];
  const agg = aggregateTwoLevel(mockResults, 'model');
  assert(agg.perCommit.length === 2, 'Two-level agg: 2 distinct commits');
  assert(approx(agg.perCommit[0].precision, 0.5), 'Two-level agg Level 1: commit1 avg precision = 0.5');
  assert(approx(agg.perCommit[1].precision, 1.0), 'Two-level agg Level 1: commit2 avg precision = 1.0');
  assert(approx(agg.macroAcrossCommits.precision, 0.75), 'Two-level agg Level 2: macro-average precision = 0.75');

  console.log(`\n${failures.length === 0 ? '✓ All unit tests passed.' : failures.join('\n')}\n`);
  return failures;
}
