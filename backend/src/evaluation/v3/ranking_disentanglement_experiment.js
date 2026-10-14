/**
 * ranking_disentanglement_experiment.js
 * -------------------------------------
 * Isolated diagnostic script to disentangle:
 *   A. Coverage effect: Improvement resulting from broader graph traversal & relationship types (EXTENDS, bidirectional).
 *   B. Context-aware ranking effect: Improvement resulting from artifact weights and historical co-change on a common candidate pool.
 *
 * Evaluates 3 ranking methods on the exact same 53 LOO retrospective cases:
 *   1. Full Context-Aware: Traversal + Artifact Context + History weights (threshold=0.35).
 *   2. Pure Structural BFS (Ablated Context): Same 2-hop traversal + EXTENDS, but alpha=1.0, beta=0.0 (no artifact, no history).
 *   3. Baseline Engine: Existing production directed traversal (USES, DEPENDS_ON, TESTS).
 *
 * Runs non-destructively and outputs summary statistics.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..', '..', '..');

const v3Data = JSON.parse(fs.readFileSync(path.join(BACKEND, 'evaluation_results_v3.json'), 'utf8'));
const graphData = JSON.parse(fs.readFileSync(path.join(BACKEND, 'analysis_output.json'), 'utf8'));
const cases = v3Data.caseResults;

const components = graphData.components;
const relationships = graphData.relationships;
const compMap = new Map(components.map(c => [c.id, c]));

// Adjacency for 2-hop undirected traversal across all 5 relationship types
const adjAll = {};
components.forEach(c => { adjAll[c.id] = []; });
relationships.forEach(r => {
  if (['DEPENDS_ON', 'USES', 'TESTS', 'IMPLEMENTS', 'EXTENDS'].includes(r.type)) {
    if (adjAll[r.source]) adjAll[r.source].push({ id: r.target, type: r.type });
    if (adjAll[r.target]) adjAll[r.target].push({ id: r.source, type: r.type });
  }
});

// Structural-Only Scorer (alpha=1.0, beta=0.0: hop weights * rel weights only, NO artifact weights, NO history)
function runStructuralOnly(changedIds, threshold = 0.35) {
  const hopWeights = { 1: 1.0, 2: 0.5 };
  const relWeights = { DEPENDS_ON: 1.0, IMPLEMENTS: 1.0, EXTENDS: 1.0, USES: 0.7, TESTS: 0.0 };
  const impactMap = new Map();

  function process(src, target, relTypes, hops) {
    if (changedIds.includes(target)) return;
    const comp = compMap.get(target);
    if (!comp || comp.type === 'Test') return;

    let pathRel = 1.0;
    for (const t of relTypes) pathRel *= (relWeights[t] ?? 0.5);
    const score = (hopWeights[hops] ?? 0) * pathRel;

    if (!impactMap.has(target) || score > impactMap.get(target)) {
      impactMap.set(target, score);
    }
  }

  for (const cid of changedIds) {
    for (const { id, type } of (adjAll[cid] || [])) process(cid, id, [type], 1);
  }
  for (const cid of changedIds) {
    for (const { id: mid, type: t1 } of (adjAll[cid] || [])) {
      for (const { id: leaf, type: t2 } of (adjAll[mid] || [])) {
        if (leaf !== mid && !changedIds.includes(leaf)) process(cid, leaf, [t1, t2], 2);
      }
    }
  }

  return Array.from(impactMap.entries())
    .map(([id, score]) => ({ component: id, score: parseFloat(score.toFixed(3)) }))
    .sort((a, b) => b.score - a.score)
    .filter(r => r.score >= threshold);
}

// Evaluate across all 53 cases
const structResults = [];

for (const c of cases) {
  const oracle = new Set(c.oracle);
  const structOut = runStructuralOnly(c.changedIds, 0.35);
  const structPred = structOut.map(r => r.component);

  const tp = structPred.filter(p => oracle.has(p)).length;
  const fp = structPred.length - tp;
  const fn = oracle.size - tp;
  const precision = structPred.length === 0 ? 0 : tp / structPred.length;
  const recall = oracle.size === 0 ? 1 : tp / oracle.size;
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const pAtK = (k) => {
    const topK = structPred.slice(0, k);
    return topK.length === 0 ? 0 : topK.filter(p => oracle.has(p)).length / topK.length;
  };
  const rAtK = (k) => {
    if (oracle.size === 0) return 1;
    const topK = new Set(structPred.slice(0, k));
    return [...oracle].filter(o => topK.has(o)).length / oracle.size;
  };

  structResults.push({
    commitHash: c.commitHash,
    caseId: c.caseId,
    precision, recall, f1,
    'P@3': pAtK(3), 'R@3': rAtK(3),
    'P@5': pAtK(5), 'R@5': rAtK(5),
    'P@10': pAtK(10), 'R@10': rAtK(10)
  });
}

// Two-level macro aggregation
function twoLevelMacro(results) {
  const byCommit = {};
  for (const r of results) {
    if (!byCommit[r.commitHash]) byCommit[r.commitHash] = [];
    byCommit[r.commitHash].push(r);
  }
  const commits = Object.keys(byCommit);
  const keys = ['precision', 'recall', 'f1', 'P@3', 'R@3', 'P@5', 'R@5', 'P@10', 'R@10'];
  
  const commitMeans = commits.map(h => {
    const list = byCommit[h];
    const meanObj = {};
    for (const k of keys) meanObj[k] = list.reduce((s, x) => s + x[k], 0) / list.length;
    return meanObj;
  });

  const macro = {};
  for (const k of keys) macro[k] = parseFloat((commitMeans.reduce((s, x) => s + x[k], 0) / commits.length).toFixed(4));
  return macro;
}

const structMacro = twoLevelMacro(structResults);
const baselineMacro = v3Data.commitAggregates.baseline;
const contextFullMacro = v3Data.commitAggregates.context_full;

console.log('=== DISENTANGLEMENT EXPERIMENT RESULTS (TWO-LEVEL MACRO) ===\n');
console.log('Model Variant                                        Precision   Recall       F1      P@3      R@3      P@5      R@5');
console.log('----------------------------------------------------------------------------------------------------------');
const fmt = (lbl, m) => `${lbl.padEnd(52)} ${String(m.precision).padStart(7)} ${String(m.recall).padStart(7)} ${String(m.f1).padStart(7)} ${String(m['P@3']).padStart(7)} ${String(m['R@3']).padStart(7)} ${String(m['P@5']).padStart(7)} ${String(m['R@5']).padStart(7)}`;

console.log(fmt('1. Baseline (Directed, 3 relationship types)', baselineMacro));
console.log(fmt('2. Structural BFS Only (Undirected, 5 relations)', structMacro));
console.log(fmt('3. Full Context-Aware (BFS + Artifact + History)', contextFullMacro));
console.log('----------------------------------------------------------------------------------------------------------\n');

// Analysis of rank preservation
let rankPreservedCount = 0;
let rankInvertedCount = 0;

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const sPred = runStructuralOnly(c.changedIds, 0.35).map(r => r.component);
  const cPred = c.context_full.mainPredicted;
  // Compare top 3
  const sTop3 = sPred.slice(0, 3).join(',');
  const cTop3 = cPred.slice(0, 3).join(',');
  if (sTop3 === cTop3) rankPreservedCount++;
  else rankInvertedCount++;
}

console.log(`Top-3 Ranking Comparison across all 53 cases:`);
console.log(`- Exact same Top-3 ranking between Pure BFS and Context-Aware: ${rankPreservedCount} / ${cases.length} (${(rankPreservedCount/cases.length*100).toFixed(1)}%)`);
console.log(`- Re-ranked Top-3 due to Artifact/History context weights:      ${rankInvertedCount} / ${cases.length} (${(rankInvertedCount/cases.length*100).toFixed(1)}%)`);
