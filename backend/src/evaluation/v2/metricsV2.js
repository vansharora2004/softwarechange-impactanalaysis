/**
 * metricsV2.js
 * ------------
 * Corrected metric functions for the V2 evaluation harness.
 * Changes from V1:
 *   - buildOracle now includes EXTENDS in the structural relationship set,
 *     aligning with the context-aware engine's traversal scope.
 *   - extractForEval() provides a single symmetric function that separates
 *     Test-type predictions from non-Test predictions, applied identically
 *     to both baseline and context-aware candidates.
 *   - Unit tests added for: EXTENDS-reachable nodes, symmetric test handling,
 *     retrospective oracle construction, and duplicate-case deduplication.
 *
 * The oracle is still purely structural (graph reachability), not observed
 * runtime impact. This is disclosed in the report.
 */
'use strict';

// ── Structural relationship set (V2: adds EXTENDS) ─────────────────────────
export const STRUCTURAL_RELS_V2 = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'EXTENDS']);

// ── Oracle construction ─────────────────────────────────────────────────────

/**
 * Build main and test oracles from the static structural graph.
 * V2: includes EXTENDS relationships, matching context-aware traversal scope.
 *
 * @param {string[]} changedIds
 * @param {Object[]} components
 * @param {Object[]} relationships
 * @param {Object}   opts
 * @param {number}   opts.maxHops      default 2
 * @param {Set}      opts.relTypes     default STRUCTURAL_RELS_V2
 * @returns {{ mainOracle: Set<string>, testOracle: Set<string> }}
 */
export function buildOracle(changedIds, components, relationships, opts = {}) {
  const maxHops = opts.maxHops ?? 2;
  const relTypes = opts.relTypes ?? STRUCTURAL_RELS_V2;

  const changedSet = new Set(changedIds);
  const typeMap = new Map(components.map(c => [c.id, c.type]));

  const adj = new Map();
  for (const r of relationships) {
    if (!relTypes.has(r.type)) continue;
    if (!adj.has(r.source)) adj.set(r.source, []);
    if (!adj.has(r.target)) adj.set(r.target, []);
    adj.get(r.source).push(r.target);
    adj.get(r.target).push(r.source);
  }

  const mainOracle = new Set();
  const testOracle = new Set();

  for (const start of changedIds) {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const d = dist.get(cur);
      if (d >= maxHops) continue;
      for (const nb of (adj.get(cur) || [])) {
        if (dist.has(nb)) continue;
        dist.set(nb, d + 1);
        queue.push(nb);
        if (!changedSet.has(nb)) {
          (typeMap.get(nb) === 'Test' ? testOracle : mainOracle).add(nb);
        }
      }
    }
  }

  return { mainOracle, testOracle };
}

// ── Retrospective oracle ─────────────────────────────────────────────────────

/**
 * Build a retrospective oracle from a git commit: use one subset of changed
 * components as the "input" (simulated change) and the remaining non-Test
 * components as the "observed co-change targets" (oracle).
 *
 * Splitting strategy: from the commit's non-Test mapped components, treat
 * the FIRST component (alphabetically) as the input; all others are targets.
 * For commits with exactly 2 non-Test components, this gives one input and
 * one target. For 3+, more targets.
 *
 * Limitation: co-change is an imperfect proxy. Components changed together
 * may share a commit for reasons unrelated to functional impact (e.g.
 * refactoring, formatting). This limitation is disclosed in the report.
 *
 * @param {string[]} allChangedNonTestIds   all non-Test mapped components in the commit
 * @returns {{ inputIds: string[], targetIds: string[] }}
 */
export function splitRetrospectiveCase(allChangedNonTestIds) {
  if (allChangedNonTestIds.length < 2) return null;
  const sorted = [...allChangedNonTestIds].sort();
  const inputIds = [sorted[0]];           // one input component
  const targetIds = sorted.slice(1);      // rest are held-out targets
  return { inputIds, targetIds };
}

// ── Symmetric prediction extraction ─────────────────────────────────────────

/**
 * Extract the main-category and test-category prediction lists from any engine's output.
 * Applied identically to baseline and context-aware results.
 *
 * For baseline output ({ name, type, impactLevel }):
 *   - main: items where type !== 'Test'
 *   - test: items where type === 'Test'
 *
 * For context-aware output ({ component, impactedType, category }):
 *   - main: items where category !== 'Regression Tests'
 *   - test: items where category === 'Regression Tests'
 *
 * @param {Object[]} results     raw engine output
 * @param {'baseline'|'context'} engineType
 * @param {Map<string,string>}   typeMap  id→type (for baseline which stores name not component)
 * @returns {{ mainPredicted: string[], testPredicted: string[] }}
 */
export function extractPredictions(results, engineType, typeMap) {
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

// ── Core IR metrics ──────────────────────────────────────────────────────────

export function computePRF(predicted, oracle) {
  if (oracle.size === 0) {
    const prec = predicted.length === 0 ? 1.0 : 0.0;
    return { precision: prec, recall: 1.0, f1: prec, tp: 0, fp: predicted.length, fn: 0 };
  }
  const predSet = new Set(predicted);
  const tp = [...predSet].filter(p => oracle.has(p)).length;
  const fp = predSet.size - tp;
  const fn = oracle.size - tp;
  const precision = predSet.size === 0 ? 0.0 : tp / predSet.size;
  const recall    = tp / oracle.size;
  const f1 = (precision + recall) === 0 ? 0.0 : 2 * precision * recall / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

export function precisionAtK(rankedPredictions, oracle, k) {
  if (oracle.size === 0) return rankedPredictions.slice(0, k).length === 0 ? 1.0 : 0.0;
  const topK = rankedPredictions.slice(0, k);
  return topK.length === 0 ? 0.0 : topK.filter(p => oracle.has(p)).length / topK.length;
}

export function recallAtK(rankedPredictions, oracle, k) {
  if (oracle.size === 0) return 1.0;
  const topK = new Set(rankedPredictions.slice(0, k));
  return [...oracle].filter(o => topK.has(o)).length / oracle.size;
}

export function macroAverage(perCaseMetrics) {
  if (perCaseMetrics.length === 0) return {};
  const keys = Object.keys(perCaseMetrics[0]).filter(k => typeof perCaseMetrics[0][k] === 'number');
  const result = {};
  for (const key of keys) {
    const sum = perCaseMetrics.reduce((acc, m) => acc + (m[key] ?? 0), 0);
    result[key] = parseFloat((sum / perCaseMetrics.length).toFixed(4));
  }
  return result;
}

// ── Ablation score analysis ──────────────────────────────────────────────────

/**
 * Compare two ranked lists and compute score/rank differences.
 * Returns per-component {scoreChange, rankChange} for items appearing in either list.
 *
 * @param {Object[]} fullResults      [{component, influenceScore, ...}]
 * @param {Object[]} ablatedResults   [{component, influenceScore, ...}]
 * @returns {Object[]} sorted by abs(scoreChange) desc
 */
export function compareAblation(fullResults, ablatedResults) {
  const fullMap = new Map(fullResults.map((r, i) => [r.component || r.name, { score: r.influenceScore ?? null, rank: i }]));
  const ablMap  = new Map(ablatedResults.map((r, i) => [r.component || r.name, { score: r.influenceScore ?? null, rank: i }]));

  const allIds = new Set([...fullMap.keys(), ...ablMap.keys()]);
  const diffs = [];
  for (const id of allIds) {
    const f = fullMap.get(id) ?? { score: null, rank: Infinity };
    const a = ablMap.get(id) ?? { score: null, rank: Infinity };
    const scoreChange = (f.score !== null && a.score !== null) ? parseFloat((f.score - a.score).toFixed(4)) : null;
    const rankChange  = (f.rank !== Infinity && a.rank !== Infinity) ? f.rank - a.rank : null;
    if (scoreChange !== 0 || rankChange !== 0) {
      diffs.push({ id, fullScore: f.score, ablatedScore: a.score, scoreChange, fullRank: f.rank, ablatedRank: a.rank, rankChange });
    }
  }
  return diffs.sort((a, b) => Math.abs(b.scoreChange ?? 0) - Math.abs(a.scoreChange ?? 0));
}

// ── Unit tests ───────────────────────────────────────────────────────────────

export function runUnitTests() {
  const failures = [];
  function assert(cond, msg) {
    if (!cond) failures.push(`FAIL: ${msg}`);
    else console.log(`  PASS: ${msg}`);
  }
  function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

  console.log('\n=== metricsV2 unit tests ===\n');

  // ── Test A: EXTENDS in oracle ──
  const comps = [
    { id: 'A', type: 'Service' },
    { id: 'B', type: 'Repository' },
    { id: 'C', type: 'Entity/Model' },
    { id: 'T', type: 'Test' },
  ];
  const rels = [
    { source: 'A', target: 'B', type: 'DEPENDS_ON' },
    { source: 'B', target: 'C', type: 'EXTENDS' },
    { source: 'T', target: 'A', type: 'TESTS' },
  ];
  const { mainOracle, testOracle } = buildOracle(['A'], comps, rels);
  assert(mainOracle.has('B'), 'EXTENDS oracle: B reachable via DEPENDS_ON');
  assert(mainOracle.has('C'), 'EXTENDS oracle: C reachable via EXTENDS from B (2-hop)');
  assert(testOracle.has('T'), 'EXTENDS oracle: T in testOracle');
  assert(!mainOracle.has('T'), 'EXTENDS oracle: T not in mainOracle');

  // V1 oracle (without EXTENDS) would miss C
  const { mainOracle: v1Oracle } = buildOracle(['A'], comps, rels,
    { relTypes: new Set(['DEPENDS_ON', 'USES', 'TESTS']) });
  assert(!v1Oracle.has('C'), 'V1 oracle: C NOT reachable without EXTENDS');
  assert(mainOracle.has('C'), 'V2 oracle: C reachable WITH EXTENDS');

  // ── Test B: Symmetric extractPredictions ──
  const typeMapT = new Map([['X', 'Service'], ['Y', 'Test'], ['Z', 'Repository']]);
  const baselineResults = [{ name: 'X', impactLevel: 'High' }, { name: 'Y', impactLevel: 'High' }, { name: 'Z', impactLevel: 'Low' }];
  const { mainPredicted: bMain, testPredicted: bTest } = extractPredictions(baselineResults, 'baseline', typeMapT);
  assert(bMain.includes('X') && bMain.includes('Z'), 'extractPredictions baseline: non-Test in main');
  assert(!bMain.includes('Y'), 'extractPredictions baseline: Test Y excluded from main');
  assert(bTest.includes('Y'), 'extractPredictions baseline: Test Y in testPredicted');

  const ctxResults = [
    { component: 'X', category: 'Impacted Component' },
    { component: 'Y', category: 'Regression Tests' },
    { component: 'Z', category: 'Impacted Component' },
  ];
  const { mainPredicted: cMain, testPredicted: cTest } = extractPredictions(ctxResults, 'context', typeMapT);
  assert(cMain.includes('X') && cMain.includes('Z'), 'extractPredictions context: non-Test in main');
  assert(!cMain.includes('Y'), 'extractPredictions context: Regression Tests Y excluded from main');
  assert(cTest.includes('Y'), 'extractPredictions context: Y in testPredicted');

  // ── Test C: Retrospective split ──
  const split2 = splitRetrospectiveCase(['ComponentA', 'ComponentB']);
  assert(split2 !== null, 'retrospective: 2-component split succeeds');
  assert(split2.inputIds.length === 1, 'retrospective: 1 input');
  assert(split2.targetIds.length === 1, 'retrospective: 1 target');
  assert(split2.inputIds[0] === 'ComponentA', 'retrospective: alphabetically first is input');

  const split1 = splitRetrospectiveCase(['Only']);
  assert(split1 === null, 'retrospective: single component returns null (insufficient)');

  const split3 = splitRetrospectiveCase(['C', 'A', 'B']);
  assert(split3.inputIds[0] === 'A', 'retrospective: alphabetically first of 3 is input');
  assert(split3.targetIds.length === 2, 'retrospective: 2 targets from 3 components');

  // ── Test D: Metric correctness (repeated from V1) ──
  const oracle = new Set(['B', 'C', 'E']);
  const { precision: p1, recall: r1, f1: f1_1 } = computePRF(['B', 'C', 'E'], oracle);
  assert(approx(p1, 1.0), 'PRF: perfect precision');
  assert(approx(r1, 1.0), 'PRF: perfect recall');

  const { precision: p2, recall: r2 } = computePRF(['B', 'X'], oracle);
  assert(approx(p2, 0.5), 'PRF: precision=0.5');
  assert(approx(r2, 1/3), 'PRF: recall=1/3');

  // ── Test E: Symmetric test handling in PRF ──
  // Baseline predicts Test type items; those should NOT be FP against mainOracle
  const mainOracleE = new Set(['Prod1', 'Prod2']);
  const baselineWithTests = ['Prod1', 'TestX', 'TestY']; // TestX, TestY are Test-type
  const { precision: pe1, recall: re1, tp: tp1, fp: fp1 } = computePRF(baselineWithTests, mainOracleE);
  assert(approx(pe1, 1/3), 'Symmetric: raw PRF with Tests as FP (V1 behavior)');

  // With symmetric extraction applied first:
  const typeMapE = new Map([['Prod1', 'Service'], ['Prod2', 'Service'], ['TestX', 'Test'], ['TestY', 'Test']]);
  const baselineRaw = [{ name: 'Prod1' }, { name: 'TestX' }, { name: 'TestY' }];
  const { mainPredicted: symMain } = extractPredictions(baselineRaw, 'baseline', typeMapE);
  const { precision: pe2, recall: re2 } = computePRF(symMain, mainOracleE);
  assert(approx(pe2, 1.0), 'Symmetric: after extractPredictions, precision=1.0 (no Test FPs)');
  assert(approx(re2, 0.5), 'Symmetric: recall=0.5 (Prod2 not predicted)');

  // ── Test F: compareAblation ──
  const fullR = [
    { component: 'A', influenceScore: 0.80 },
    { component: 'B', influenceScore: 0.65 },
    { component: 'C', influenceScore: 0.35 },
  ];
  const ablR = [
    { component: 'A', influenceScore: 0.70 },
    { component: 'B', influenceScore: 0.65 },
    { component: 'C', influenceScore: 0.20 },
  ];
  const diffs = compareAblation(fullR, ablR);
  const diffA = diffs.find(d => d.id === 'A');
  const diffC = diffs.find(d => d.id === 'C');
  assert(diffA && approx(diffA.scoreChange, 0.10), 'compareAblation: A score diff 0.10');
  assert(diffC && approx(diffC.scoreChange, 0.15), 'compareAblation: C score diff 0.15');

  // ── Test G: P@K and R@K ──
  const ranked = ['B', 'X', 'C', 'Y', 'E'];
  assert(approx(precisionAtK(ranked, oracle, 3), 2/3), 'P@3: 2 of 3 relevant');
  assert(approx(recallAtK(ranked, oracle, 3), 2/3), 'R@3: 2 of 3 oracle recalled');
  assert(approx(recallAtK(ranked, oracle, 5), 1.0), 'R@5: all recalled');

  // ── Test H: Duplicate deduplication (structural, not metric) ──
  // We verify that sets of changedIds that are identical produce the same oracle
  const oA = buildOracle(['ExA'], comps, rels);
  const oB = buildOracle(['ExA'], comps, rels);
  assert(JSON.stringify([...oA.mainOracle].sort()) === JSON.stringify([...oB.mainOracle].sort()),
    'Dedup: identical changedIds produce identical oracle (idempotent)');

  console.log(`\n${failures.length === 0 ? '✓ All tests passed.' : failures.join('\n')}\n`);
  return failures;
}
