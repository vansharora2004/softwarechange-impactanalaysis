/**
 * metrics.js
 * ----------
 * Pure, stateless metric functions for the Phase 5 evaluation harness.
 * No side effects, no I/O. Every function is independently unit-testable.
 *
 * Ground-truth oracle definition
 * --------------------------------
 * The "relevant" set for a given set of changed components C is defined as:
 *   R = { x ∈ Components | ∃ r ∈ Relationships : (r.source ∈ C ∨ r.target ∈ C)
 *                          ∧ (r.source = x ∨ r.target = x)
 *                          ∧ x ∉ C
 *                          ∧ r.type ∈ { DEPENDS_ON, USES, TESTS } }
 * This is deliberately limited to structural relationships (≤ 2-hop) so the
 * oracle is consistent with what either engine can observe.
 *
 * Regression-test handling
 * -------------------------
 * Components of type 'Test' that appear in candidate lists are evaluated in a
 * SEPARATE test-oracle set and NOT counted in the main IR metrics. This
 * prevents test components from dominating precision/recall in either direction.
 */

'use strict';

// ---------------------------------------------------------------------------
// Oracle construction
// ---------------------------------------------------------------------------

/**
 * Build the ground-truth oracle from a static graph.
 *
 * @param {string[]} changedIds   - IDs of the simulated changed components
 * @param {Object[]} components   - full component list from analysis_output.json
 * @param {Object[]} relationships - full relationship list from analysis_output.json
 * @param {Object}  options
 * @param {number}  options.maxHops  - traverse up to this many hops (1 or 2)
 * @returns {{ mainOracle: Set<string>, testOracle: Set<string> }}
 *    mainOracle: non-Test components reachable within maxHops
 *    testOracle: Test components reachable within maxHops
 */
export function buildOracle(changedIds, components, relationships, { maxHops = 2 } = {}) {
  const STRUCTURAL_RELS = new Set(['DEPENDS_ON', 'USES', 'TESTS']);
  const changedSet = new Set(changedIds);
  const compTypeMap = new Map(components.map(c => [c.id, c.type]));

  // Build bidirectional adjacency for structural rels only
  const adj = new Map();
  for (const r of relationships) {
    if (!STRUCTURAL_RELS.has(r.type)) continue;
    if (!adj.has(r.source)) adj.set(r.source, []);
    if (!adj.has(r.target)) adj.set(r.target, []);
    adj.get(r.source).push(r.target);
    adj.get(r.target).push(r.source);
  }

  const mainOracle = new Set();
  const testOracle = new Set();

  // BFS from every changed component up to maxHops
  for (const startId of changedIds) {
    const visited = new Map(); // id -> hop distance
    visited.set(startId, 0);
    const queue = [startId];

    while (queue.length > 0) {
      const current = queue.shift();
      const currentHop = visited.get(current);
      if (currentHop >= maxHops) continue;

      for (const neighbor of (adj.get(current) || [])) {
        if (visited.has(neighbor)) continue;
        visited.set(neighbor, currentHop + 1);
        queue.push(neighbor);

        if (!changedSet.has(neighbor)) {
          const type = compTypeMap.get(neighbor) || 'Other';
          if (type === 'Test') {
            testOracle.add(neighbor);
          } else {
            mainOracle.add(neighbor);
          }
        }
      }
    }
  }

  return { mainOracle, testOracle };
}

// ---------------------------------------------------------------------------
// Core IR metrics
// ---------------------------------------------------------------------------

/**
 * Compute Precision, Recall, F1 for a retrieval result vs. oracle.
 *
 * @param {string[]} predicted  - ordered list of retrieved component IDs
 * @param {Set<string>} oracle  - ground-truth relevant set
 * @returns {{ precision: number, recall: number, f1: number, tp: number, fp: number, fn: number }}
 */
export function computePRF(predicted, oracle) {
  if (oracle.size === 0) {
    // If oracle is empty, a model that predicts nothing is perfect; predicting something is wrong.
    const precision = predicted.length === 0 ? 1.0 : 0.0;
    return { precision, recall: 1.0, f1: precision, tp: 0, fp: predicted.length, fn: 0 };
  }

  const predSet = new Set(predicted);
  const tp = [...predSet].filter(p => oracle.has(p)).length;
  const fp = predSet.size - tp;
  const fn = oracle.size - tp;

  const precision = predSet.size === 0 ? 0.0 : tp / predSet.size;
  const recall    = tp / oracle.size;
  const f1        = (precision + recall) === 0 ? 0.0 : 2 * precision * recall / (precision + recall);

  return { precision, recall, f1, tp, fp, fn };
}

/**
 * Precision@K: of the top-K predictions, what fraction are relevant?
 *
 * @param {string[]} rankedPredictions - predictions in ranked order (best first)
 * @param {Set<string>} oracle
 * @param {number} k
 * @returns {number}
 */
export function precisionAtK(rankedPredictions, oracle, k) {
  if (oracle.size === 0) return rankedPredictions.slice(0, k).length === 0 ? 1.0 : 0.0;
  const topK = rankedPredictions.slice(0, k);
  const hits = topK.filter(p => oracle.has(p)).length;
  return topK.length === 0 ? 0.0 : hits / topK.length;
}

/**
 * Recall@K: of all relevant items, how many appear in the top-K predictions?
 *
 * @param {string[]} rankedPredictions - predictions in ranked order (best first)
 * @param {Set<string>} oracle
 * @param {number} k
 * @returns {number}
 */
export function recallAtK(rankedPredictions, oracle, k) {
  if (oracle.size === 0) return 1.0;
  const topK = new Set(rankedPredictions.slice(0, k));
  const hits = [...oracle].filter(o => topK.has(o)).length;
  return hits / oracle.size;
}

/**
 * Macro-average a list of per-case metric objects.
 * Each object must have the same numeric keys.
 *
 * @param {Object[]} perCaseMetrics
 * @returns {Object} macro-averaged object with same keys
 */
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

// ---------------------------------------------------------------------------
// Unit tests (self-contained, run with --test flag)
// ---------------------------------------------------------------------------

export function runUnitTests() {
  const failures = [];

  function assert(condition, message) {
    if (!condition) failures.push(`FAIL: ${message}`);
    else console.log(`  PASS: ${message}`);
  }

  function approxEqual(a, b, eps = 1e-6) {
    return Math.abs(a - b) < eps;
  }

  console.log('\n=== metrics.js unit tests ===\n');

  // --- buildOracle ---
  const comps = [
    { id: 'A', type: 'Controller' },
    { id: 'B', type: 'Service' },
    { id: 'C', type: 'Repository' },
    { id: 'D', type: 'Test' },
    { id: 'E', type: 'Controller' },
  ];
  const rels = [
    { source: 'A', target: 'B', type: 'DEPENDS_ON' },
    { source: 'B', target: 'C', type: 'USES' },
    { source: 'D', target: 'A', type: 'TESTS' },
    { source: 'E', target: 'B', type: 'DEPENDS_ON' },
  ];

  const { mainOracle, testOracle } = buildOracle(['A'], comps, rels, { maxHops: 2 });
  assert(mainOracle.has('B'), 'buildOracle: B is 1-hop from A via DEPENDS_ON');
  assert(mainOracle.has('C'), 'buildOracle: C is 2-hop from A via B');
  assert(mainOracle.has('E'), 'buildOracle: E is 2-hop from A via B (reverse)');
  assert(testOracle.has('D'), 'buildOracle: D (Test) is in testOracle not mainOracle');
  assert(!mainOracle.has('D'), 'buildOracle: D not in mainOracle');
  assert(!mainOracle.has('A'), 'buildOracle: A (changed) not in oracle');

  const { mainOracle: o1hop } = buildOracle(['A'], comps, rels, { maxHops: 1 });
  assert(o1hop.has('B'), 'buildOracle 1-hop: B reachable');
  assert(!o1hop.has('C'), 'buildOracle 1-hop: C not reachable at maxHops=1');

  // --- computePRF ---
  const oracle = new Set(['B', 'C', 'E']);

  const { precision: p1, recall: r1, f1: f1_1 } = computePRF(['B', 'C', 'E'], oracle);
  assert(approxEqual(p1, 1.0), 'PRF: perfect precision');
  assert(approxEqual(r1, 1.0), 'PRF: perfect recall');
  assert(approxEqual(f1_1, 1.0), 'PRF: perfect f1');

  const { precision: p2, recall: r2 } = computePRF(['B', 'X'], oracle);
  assert(approxEqual(p2, 0.5), 'PRF: precision=0.5 for 1/2 predicted correct');
  assert(approxEqual(r2, 1/3), 'PRF: recall=1/3 for 1/3 oracle recalled');

  const { precision: p3, recall: r3 } = computePRF([], oracle);
  assert(approxEqual(p3, 0.0), 'PRF: empty prediction precision=0');
  assert(approxEqual(r3, 0.0), 'PRF: empty prediction recall=0');

  const { precision: p4, recall: r4 } = computePRF(['X'], new Set());
  assert(approxEqual(p4, 0.0), 'PRF: empty oracle with predictions → precision=0');
  assert(approxEqual(r4, 1.0), 'PRF: empty oracle recall=1 (nothing to miss)');

  // --- precisionAtK ---
  const ranked = ['B', 'X', 'C', 'Y', 'E'];
  assert(approxEqual(precisionAtK(ranked, oracle, 1), 1.0), 'P@1: top-1 is relevant');
  assert(approxEqual(precisionAtK(ranked, oracle, 2), 0.5), 'P@2: 1 of 2 relevant');
  assert(approxEqual(precisionAtK(ranked, oracle, 3), 2/3), 'P@3: 2 of 3 relevant');
  assert(approxEqual(precisionAtK(ranked, oracle, 5), 3/5), 'P@5: 3 of 5 relevant');

  // --- recallAtK ---
  assert(approxEqual(recallAtK(ranked, oracle, 1), 1/3), 'R@1: 1 of 3 recalled');
  assert(approxEqual(recallAtK(ranked, oracle, 3), 2/3), 'R@3: 2 of 3 recalled');
  assert(approxEqual(recallAtK(ranked, oracle, 5), 1.0), 'R@5: all recalled');

  // --- macroAverage ---
  const cases = [
    { precision: 1.0, recall: 0.5, f1: 2/3 },
    { precision: 0.0, recall: 1.0, f1: 0.0 },
  ];
  const avg = macroAverage(cases);
  assert(approxEqual(avg.precision, 0.5), 'macroAverage: precision avg');
  assert(approxEqual(avg.recall, 0.75), 'macroAverage: recall avg');

  console.log(`\n${failures.length === 0 ? '✓ All tests passed.' : failures.join('\n')}\n`);
  return failures;
}
