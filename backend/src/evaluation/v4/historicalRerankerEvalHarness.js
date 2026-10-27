/**
 * historicalRerankerEvalHarness.js
 * --------------------------------
 * Retrospective Evaluation and Hop-Depth Sensitivity Harness with
 * Pre-Change Historical Knowledge Graph Reconstruction.
 *
 * Implements:
 *   1. Reconstructed pre-change structural knowledge graph for each evaluated commit C (parent revision C^1).
 *   2. Evaluation across BOTH Spring PetClinic and Shopizer.
 *   3. Comparison of:
 *      - Structural Baseline (1-hop, 2-hop [operating], 3-hop)
 *      - Proposed Historical Reranker (1-hop, 2-hop [operating], 3-hop)
 *      - Legacy Weighted Model (S = 0.70 B + 0.30 C at theta = 0.35 reference)
 *   4. Identical evaluation cases and candidate sets between baseline and reranker.
 *   5. Metric suite:
 *      - Candidate set size (|C|)
 *      - Precision, Recall, F1
 *      - P@3, R@3, P@5, R@5, P@10, R@10
 *      - MAP, MRR, Test Recall
 *   6. Hop-depth sensitivity across 1, 2, and 3 hops.
 *
 * Outputs:
 *   - backend/historical_reranker_evaluation_results.json
 *   - backend/historical_hop_sensitivity_results.json
 *   - backend/historical_reranker_evaluation_report.md
 *   - research_artifacts/historical_reranker_evaluation_results.json
 *   - research_artifacts/historical_hop_sensitivity_results.json
 *   - research_artifacts/historical_reranker_evaluation_report.md
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildHistoricalCases } from './historicalCaseBuilder.js';
import {
  generateStructuralCandidatesInMemory,
  rerankCandidatesWithHistory
} from '../../services/structuralHistoryReranker.js';
import { analyzeInMemory as analyzeLegacyContext } from '../../services/contextAwareImpactAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const ARTIFACTS_DIR = path.resolve(BACKEND_ROOT, '..', 'research_artifacts');

const PETCLINIC_REPO = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const SHOPIZER_REPO = 'c:/yashika/STUDY/clg_project/shopizer';

const OUT_JSON = path.join(BACKEND_ROOT, 'historical_reranker_evaluation_results.json');
const OUT_SENSITIVITY_JSON = path.join(BACKEND_ROOT, 'historical_hop_sensitivity_results.json');
const OUT_MD = path.join(BACKEND_ROOT, 'historical_reranker_evaluation_report.md');

// ── Metric Computation Helpers ──────────────────────────────────────────────

function computePRF(predicted, oracle) {
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

function precisionAtK(rankedPredictions, oracle, k) {
  if (!oracle || oracle.size === 0) return 0.0;
  const topK = (rankedPredictions || []).slice(0, k);
  if (topK.length === 0) return 0.0;
  return topK.filter(p => oracle.has(p)).length / topK.length;
}

function recallAtK(rankedPredictions, oracle, k) {
  if (!oracle || oracle.size === 0) return 1.0;
  const topK = new Set((rankedPredictions || []).slice(0, k));
  return [...oracle].filter(o => topK.has(o)).length / oracle.size;
}

function computeAP(rankedPredictions, oracle) {
  if (!oracle || oracle.size === 0) return 0.0;
  const preds = rankedPredictions || [];
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

function computeRR(rankedPredictions, oracle) {
  if (!oracle || oracle.size === 0) return 0.0;
  const preds = rankedPredictions || [];
  for (let i = 0; i < preds.length; i++) {
    if (oracle.has(preds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0.0;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function aggregateMetrics(caseResults, configKey) {
  if (!caseResults || caseResults.length === 0) {
    return { perCommit: [], macroAcrossCommits: {}, pooledAverage: {} };
  }

  const metricKeys = [
    'candidateCount', 'precision', 'recall', 'f1',
    'P@3', 'R@3', 'P@5', 'R@5', 'P@10', 'R@10',
    'map', 'mrr', 'testRecall'
  ];

  const commitGroups = new Map();
  for (const cr of caseResults) {
    if (!commitGroups.has(cr.commitHash)) {
      commitGroups.set(cr.commitHash, []);
    }
    commitGroups.get(cr.commitHash).push(cr[configKey]);
  }

  const perCommit = [];
  for (const [hash, cases] of commitGroups.entries()) {
    const commitAvg = { commitHash: hash, caseCount: cases.length };
    for (const key of metricKeys) {
      const sum = cases.reduce((acc, c) => acc + (c[key] ?? 0), 0);
      commitAvg[key] = parseFloat((sum / cases.length).toFixed(4));
    }
    perCommit.push(commitAvg);
  }

  const macroAcrossCommits = { commitCount: perCommit.length };
  for (const key of metricKeys) {
    const sum = perCommit.reduce((acc, c) => acc + (c[key] ?? 0), 0);
    macroAcrossCommits[key] = parseFloat((sum / perCommit.length).toFixed(4));
  }

  const pooledAverage = { totalCases: caseResults.length };
  for (const key of metricKeys) {
    const sum = caseResults.reduce((acc, cr) => acc + (cr[configKey][key] ?? 0), 0);
    pooledAverage[key] = parseFloat((sum / caseResults.length).toFixed(4));
  }

  return { perCommit, macroAcrossCommits, pooledAverage };
}

// ── Case Evaluator ──────────────────────────────────────────────────────────

function evaluateHistoricalCase(c) {
  const { inputComponent, retroOracle, retroTestOracle, historyCounts, graphData, compMap } = c;
  const changedIds = [inputComponent];

  const caseMetrics = {
    caseId: c.caseId,
    commitHash: c.commitHash,
    parentSha: c.parentSha,
    commitIndex: c.commitIndex,
    inputComponent,
    oracleCount: retroOracle.size,
    testOracleCount: retroTestOracle.size,
    graphComponentsCount: c.graphComponentsCount,
    graphRelationshipsCount: c.graphRelationshipsCount,
    graphFromCache: c.graphFromCache
  };

  function extractResults(candidateList) {
    const mainPredicted = [];
    const testPredicted = [];
    for (const cand of candidateList) {
      const id = cand.id || cand.name || cand.component;
      const comp = compMap.get(id);
      const isTest = (comp && comp.type === 'Test') || cand.category === 'Regression Tests' || cand.type === 'Test';
      if (isTest) {
        testPredicted.push(id);
      } else {
        mainPredicted.push(id);
      }
    }
    return { mainPredicted, testPredicted };
  }

  function scoreRankedList(rankedList) {
    const { mainPredicted, testPredicted } = extractResults(rankedList);
    const prf = computePRF(mainPredicted, retroOracle);
    const p3 = precisionAtK(mainPredicted, retroOracle, 3);
    const r3 = recallAtK(mainPredicted, retroOracle, 3);
    const p5 = precisionAtK(mainPredicted, retroOracle, 5);
    const r5 = recallAtK(mainPredicted, retroOracle, 5);
    const p10 = precisionAtK(mainPredicted, retroOracle, 10);
    const r10 = recallAtK(mainPredicted, retroOracle, 10);
    const ap = computeAP(mainPredicted, retroOracle);
    const rr = computeRR(mainPredicted, retroOracle);

    let testRecall = 0.0;
    if (retroTestOracle.size > 0) {
      const testSet = new Set(testPredicted);
      const testHits = [...retroTestOracle].filter(t => testSet.has(t)).length;
      testRecall = testHits / retroTestOracle.size;
    }

    return {
      candidateCount: mainPredicted.length,
      precision: parseFloat(prf.precision.toFixed(4)),
      recall: parseFloat(prf.recall.toFixed(4)),
      f1: parseFloat(prf.f1.toFixed(4)),
      'P@3': parseFloat(p3.toFixed(4)),
      'R@3': parseFloat(r3.toFixed(4)),
      'P@5': parseFloat(p5.toFixed(4)),
      'R@5': parseFloat(r5.toFixed(4)),
      'P@10': parseFloat(p10.toFixed(4)),
      'R@10': parseFloat(r10.toFixed(4)),
      map: parseFloat(ap.toFixed(4)),
      mrr: parseFloat(rr.toFixed(4)),
      testRecall: parseFloat(testRecall.toFixed(4))
    };
  }

  // 1. Structural Baseline at 1-hop, 2-hop, 3-hop on historical pre-change graph
  const struct1 = generateStructuralCandidatesInMemory(changedIds, graphData, 1);
  const struct2 = generateStructuralCandidatesInMemory(changedIds, graphData, 2);
  const struct3 = generateStructuralCandidatesInMemory(changedIds, graphData, 3);

  caseMetrics.structural_1hop = scoreRankedList(struct1);
  caseMetrics.structural_2hop = scoreRankedList(struct2);
  caseMetrics.structural_3hop = scoreRankedList(struct3);

  // 2. Proposed Historical Reranker at 1-hop, 2-hop, 3-hop on identical candidates
  const prop1 = rerankCandidatesWithHistory(struct1, changedIds, historyCounts);
  const prop2 = rerankCandidatesWithHistory(struct2, changedIds, historyCounts);
  const prop3 = rerankCandidatesWithHistory(struct3, changedIds, historyCounts);

  caseMetrics.proposed_1hop = scoreRankedList(prop1);
  caseMetrics.proposed_2hop = scoreRankedList(prop2);
  caseMetrics.proposed_3hop = scoreRankedList(prop3);

  // 3. Legacy Weighted Model (at theta = 0.35)
  const legacyRaw = analyzeLegacyContext(changedIds, {
    components: graphData.components,
    relationships: graphData.relationships,
    historyCounts
  });
  const legacyFiltered = legacyRaw.filter(r => (r.influenceScore ?? 0) >= 0.35);
  caseMetrics.legacy_weighted = scoreRankedList(legacyFiltered);

  return caseMetrics;
}

// ── Main Execution ──────────────────────────────────────────────────────────

export async function runHistoricalEvaluation() {
  console.log('================================================================');
  console.log('Rigorous Historical Evaluation & Pre-Change Graph Reconstruction');
  console.log('Temporally Leak-Free Knowledge Graph Traversal & Historical Reranking');
  console.log('================================================================\n');

  const CONFIG_KEYS = [
    'structural_1hop', 'structural_2hop', 'structural_3hop',
    'proposed_1hop', 'proposed_2hop', 'proposed_3hop',
    'legacy_weighted'
  ];

  // ── 1. Spring PetClinic ────────────────────────────────────────────────────
  console.log('▶ Reconstructing and Evaluating Spring PetClinic (spring-petclinic-rest)...');
  const petclinicData = await buildHistoricalCases(PETCLINIC_REPO, 100);
  console.log(`  Reconstructed ${petclinicData.looCases.length} LOO cases across ${petclinicData.eligibleCommits.length} eligible commits`);
  console.log(`  Exclusions: ${petclinicData.exclusions.length} commits`);

  const petclinicCaseResults = petclinicData.looCases.map(evaluateHistoricalCase);
  const petclinicAggregations = {};
  for (const k of CONFIG_KEYS) {
    petclinicAggregations[k] = aggregateMetrics(petclinicCaseResults, k);
  }

  // ── 2. Shopizer ───────────────────────────────────────────────────────────
  console.log('\n▶ Reconstructing and Evaluating Shopizer (shopizer)...');
  const shopizerData = await buildHistoricalCases(SHOPIZER_REPO, 100);
  console.log(`  Reconstructed ${shopizerData.looCases.length} LOO cases across ${shopizerData.eligibleCommits.length} eligible commits`);
  console.log(`  Exclusions: ${shopizerData.exclusions.length} commits`);

  const shopizerCaseResults = shopizerData.looCases.map(evaluateHistoricalCase);
  const shopizerAggregations = {};
  for (const k of CONFIG_KEYS) {
    shopizerAggregations[k] = aggregateMetrics(shopizerCaseResults, k);
  }

  // ── Build Sensitivity Summary ─────────────────────────────────────────────
  const hopSensitivity = {
    metadata: {
      generatedAt: new Date().toISOString(),
      evaluationType: 'Pre-Change Historical Graph Reconstruction (Leak-Free)',
      hopsEvaluated: [1, 2, 3]
    },
    springPetClinic: {
      hop1: {
        baseline: petclinicAggregations.structural_1hop.macroAcrossCommits,
        proposed: petclinicAggregations.proposed_1hop.macroAcrossCommits
      },
      hop2_operating: {
        baseline: petclinicAggregations.structural_2hop.macroAcrossCommits,
        proposed: petclinicAggregations.proposed_2hop.macroAcrossCommits
      },
      hop3: {
        baseline: petclinicAggregations.structural_3hop.macroAcrossCommits,
        proposed: petclinicAggregations.proposed_3hop.macroAcrossCommits
      }
    },
    shopizer: {
      hop1: {
        baseline: shopizerAggregations.structural_1hop.macroAcrossCommits,
        proposed: shopizerAggregations.proposed_1hop.macroAcrossCommits
      },
      hop2_operating: {
        baseline: shopizerAggregations.structural_2hop.macroAcrossCommits,
        proposed: shopizerAggregations.proposed_2hop.macroAcrossCommits
      },
      hop3: {
        baseline: shopizerAggregations.structural_3hop.macroAcrossCommits,
        proposed: shopizerAggregations.proposed_3hop.macroAcrossCommits
      }
    }
  };

  // ── Build Full Output JSON ────────────────────────────────────────────────
  const fullResults = {
    metadata: {
      title: 'Historical Software Change Impact Analysis Evaluation Results',
      evaluationProtocol: 'Retrospective Leave-One-Out with Pre-Change Knowledge Graph Reconstruction',
      generatedAt: new Date().toISOString(),
      temporalIntegrity: {
        graphRevision: 'Parent commit of evaluated commit (C^1)',
        coChangeLookback: 'Strictly older commits (> commitIndex)',
        candidatePruning: 'None (no arbitrary score threshold; zero-cochange candidates retained)',
        weights: 'None (pure structural BFS + co-change count sorting)'
      }
    },
    springPetClinic: {
      repoPath: PETCLINIC_REPO,
      eligibleCommitsCount: petclinicData.eligibleCommits.length,
      eligibleCommits: petclinicData.eligibleCommits,
      looCasesCount: petclinicData.looCases.length,
      exclusionsCount: petclinicData.exclusions.length,
      exclusions: petclinicData.exclusions,
      aggregations: petclinicAggregations,
      perCaseResults: petclinicCaseResults
    },
    shopizer: {
      repoPath: SHOPIZER_REPO,
      eligibleCommitsCount: shopizerData.eligibleCommits.length,
      eligibleCommits: shopizerData.eligibleCommits,
      looCasesCount: shopizerData.looCases.length,
      exclusionsCount: shopizerData.exclusions.length,
      exclusions: shopizerData.exclusions,
      aggregations: shopizerAggregations,
      perCaseResults: shopizerCaseResults
    }
  };

  // ── Generate Markdown Report ──────────────────────────────────────────────
  const p2MacroB = petclinicAggregations.structural_2hop.macroAcrossCommits;
  const p2MacroP = petclinicAggregations.proposed_2hop.macroAcrossCommits;
  const s2MacroB = shopizerAggregations.structural_2hop.macroAcrossCommits;
  const s2MacroP = shopizerAggregations.proposed_2hop.macroAcrossCommits;

  const mdReport = `# Historical Evaluation Report: Pre-Change Structural Graph Reconstruction + Historical Reranking

**Project:** Context-Aware Software Change Impact Analysis Framework Using Multi-Layer Software Knowledge Graphs  
**Date:** ${new Date().toISOString()}  
**Evaluation Protocol:** Retrospective Leave-One-Out (LOO) with Pre-Change Structural Graphs at Parent Revisions  

---

## 1. Temporal Integrity & Methodology

This evaluation resolves the static HEAD graph limitation. For every evaluated commit $C$:
1. **Pre-Change Knowledge Graph ($G_P$):** The structural graph is reconstructed from the repository state at parent revision $P = C^1$.
2. **Leak-Free Co-Change History:** Derived exclusively from commits strictly older than $C$ ($i + 1 \dots N$).
3. **Identical Candidate Sets:** Structural baseline and proposed reranker receive identical candidates; candidates with zero co-change are retained.
4. **No Arbitrary Thresholds:** Candidate generation is bounded strictly by graph topology.

---

## 2. Spring PetClinic Results (${petclinicData.looCases.length} LOO Cases across ${petclinicData.eligibleCommits.length} Commits)

| Configuration | Depth | |C| | Precision | Recall | F1 | P@3 | P@5 | P@10 | MAP | MRR | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Structural Baseline (Hop 1)** | 1-hop | ${petclinicAggregations.structural_1hop.macroAcrossCommits.candidateCount} | ${petclinicAggregations.structural_1hop.macroAcrossCommits.precision} | ${petclinicAggregations.structural_1hop.macroAcrossCommits.recall} | ${petclinicAggregations.structural_1hop.macroAcrossCommits.f1} | ${petclinicAggregations.structural_1hop.macroAcrossCommits['P@3']} | ${petclinicAggregations.structural_1hop.macroAcrossCommits['P@5']} | ${petclinicAggregations.structural_1hop.macroAcrossCommits['P@10']} | ${petclinicAggregations.structural_1hop.macroAcrossCommits.map} | ${petclinicAggregations.structural_1hop.macroAcrossCommits.mrr} | ${petclinicAggregations.structural_1hop.macroAcrossCommits.testRecall} |
| **Structural Baseline (Hop 2)** | 2-hop | ${p2MacroB.candidateCount} | ${p2MacroB.precision} | ${p2MacroB.recall} | ${p2MacroB.f1} | ${p2MacroB['P@3']} | ${p2MacroB['P@5']} | ${p2MacroB['P@10']} | ${p2MacroB.map} | ${p2MacroB.mrr} | ${p2MacroB.testRecall} |
| **Structural Baseline (Hop 3)** | 3-hop | ${petclinicAggregations.structural_3hop.macroAcrossCommits.candidateCount} | ${petclinicAggregations.structural_3hop.macroAcrossCommits.precision} | ${petclinicAggregations.structural_3hop.macroAcrossCommits.recall} | ${petclinicAggregations.structural_3hop.macroAcrossCommits.f1} | ${petclinicAggregations.structural_3hop.macroAcrossCommits['P@3']} | ${petclinicAggregations.structural_3hop.macroAcrossCommits['P@5']} | ${petclinicAggregations.structural_3hop.macroAcrossCommits['P@10']} | ${petclinicAggregations.structural_3hop.macroAcrossCommits.map} | ${petclinicAggregations.structural_3hop.macroAcrossCommits.mrr} | ${petclinicAggregations.structural_3hop.macroAcrossCommits.testRecall} |
| **Proposed Reranker (Hop 1)** | 1-hop | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.candidateCount} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.precision} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.recall} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.f1} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits['P@3']} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits['P@5']} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits['P@10']} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.map} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.mrr} | ${petclinicAggregations.proposed_1hop.macroAcrossCommits.testRecall} |
| **Proposed Reranker (Hop 2)** | 2-hop | ${p2MacroP.candidateCount} | ${p2MacroP.precision} | ${p2MacroP.recall} | ${p2MacroP.f1} | ${p2MacroP['P@3']} | ${p2MacroP['P@5']} | ${p2MacroP['P@10']} | ${p2MacroP.map} | ${p2MacroP.mrr} | ${p2MacroP.testRecall} |
| **Proposed Reranker (Hop 3)** | 3-hop | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.candidateCount} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.precision} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.recall} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.f1} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits['P@3']} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits['P@5']} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits['P@10']} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.map} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.mrr} | ${petclinicAggregations.proposed_3hop.macroAcrossCommits.testRecall} |

---

## 3. Shopizer Results (${shopizerData.looCases.length} LOO Cases across ${shopizerData.eligibleCommits.length} Commits)

| Configuration | Depth | |C| | Precision | Recall | F1 | P@3 | P@5 | P@10 | MAP | MRR | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Structural Baseline (Hop 1)** | 1-hop | ${shopizerAggregations.structural_1hop.macroAcrossCommits.candidateCount} | ${shopizerAggregations.structural_1hop.macroAcrossCommits.precision} | ${shopizerAggregations.structural_1hop.macroAcrossCommits.recall} | ${shopizerAggregations.structural_1hop.macroAcrossCommits.f1} | ${shopizerAggregations.structural_1hop.macroAcrossCommits['P@3']} | ${shopizerAggregations.structural_1hop.macroAcrossCommits['P@5']} | ${shopizerAggregations.structural_1hop.macroAcrossCommits['P@10']} | ${shopizerAggregations.structural_1hop.macroAcrossCommits.map} | ${shopizerAggregations.structural_1hop.macroAcrossCommits.mrr} | ${shopizerAggregations.structural_1hop.macroAcrossCommits.testRecall} |
| **Structural Baseline (Hop 2)** | 2-hop | ${s2MacroB.candidateCount} | ${s2MacroB.precision} | ${s2MacroB.recall} | ${s2MacroB.f1} | ${s2MacroB['P@3']} | ${s2MacroB['P@5']} | ${s2MacroB['P@10']} | ${s2MacroB.map} | ${s2MacroB.mrr} | ${s2MacroB.testRecall} |
| **Structural Baseline (Hop 3)** | 3-hop | ${shopizerAggregations.structural_3hop.macroAcrossCommits.candidateCount} | ${shopizerAggregations.structural_3hop.macroAcrossCommits.precision} | ${shopizerAggregations.structural_3hop.macroAcrossCommits.recall} | ${shopizerAggregations.structural_3hop.macroAcrossCommits.f1} | ${shopizerAggregations.structural_3hop.macroAcrossCommits['P@3']} | ${shopizerAggregations.structural_3hop.macroAcrossCommits['P@5']} | ${shopizerAggregations.structural_3hop.macroAcrossCommits['P@10']} | ${shopizerAggregations.structural_3hop.macroAcrossCommits.map} | ${shopizerAggregations.structural_3hop.macroAcrossCommits.mrr} | ${shopizerAggregations.structural_3hop.macroAcrossCommits.testRecall} |
| **Proposed Reranker (Hop 1)** | 1-hop | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.candidateCount} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.precision} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.recall} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.f1} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits['P@3']} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits['P@5']} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits['P@10']} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.map} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.mrr} | ${shopizerAggregations.proposed_1hop.macroAcrossCommits.testRecall} |
| **Proposed Reranker (Hop 2)** | 2-hop | ${s2MacroP.candidateCount} | ${s2MacroP.precision} | ${s2MacroP.recall} | ${s2MacroP.f1} | ${s2MacroP['P@3']} | ${s2MacroP['P@5']} | ${s2MacroP['P@10']} | ${s2MacroP.map} | ${s2MacroP.mrr} | ${s2MacroP.testRecall} |
| **Proposed Reranker (Hop 3)** | 3-hop | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.candidateCount} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.precision} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.recall} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.f1} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits['P@3']} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits['P@5']} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits['P@10']} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.map} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.mrr} | ${shopizerAggregations.proposed_3hop.macroAcrossCommits.testRecall} |
`;

  // ── Write Artifacts ───────────────────────────────────────────────────────
  fs.writeFileSync(OUT_JSON, JSON.stringify(fullResults, null, 2), 'utf-8');
  fs.writeFileSync(OUT_SENSITIVITY_JSON, JSON.stringify(hopSensitivity, null, 2), 'utf-8');
  fs.writeFileSync(OUT_MD, mdReport, 'utf-8');

  // Copy to research_artifacts
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'historical_reranker_evaluation_results.json'), JSON.stringify(fullResults, null, 2), 'utf-8');
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'historical_hop_sensitivity_results.json'), JSON.stringify(hopSensitivity, null, 2), 'utf-8');
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'historical_reranker_evaluation_report.md'), mdReport, 'utf-8');

  console.log(`\n✓ Results written to:`);
  console.log(`  - ${OUT_JSON}`);
  console.log(`  - ${OUT_SENSITIVITY_JSON}`);
  console.log(`  - ${OUT_MD}`);
  console.log(`  - ${path.join(ARTIFACTS_DIR, 'historical_reranker_evaluation_results.json')}`);
  console.log(`  - ${path.join(ARTIFACTS_DIR, 'historical_hop_sensitivity_results.json')}`);
  console.log(`  - ${path.join(ARTIFACTS_DIR, 'historical_reranker_evaluation_report.md')}`);

  return { fullResults, hopSensitivity };
}

if (process.argv[1] && process.argv[1].endsWith('historicalRerankerEvalHarness.js')) {
  runHistoricalEvaluation()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Historical evaluation failed:', err);
      process.exit(1);
    });
}
