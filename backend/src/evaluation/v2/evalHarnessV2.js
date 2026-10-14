/**
 * evalHarnessV2.js
 * ----------------
 * Corrected Phase 5 evaluation harness (Version 2).
 *
 * Preserves all original V1 outputs unchanged.
 * Writes results to: evaluation_results_v2.json, evaluation_summary_v2.md
 *
 * CORRECTIONS FROM V1 (see eval_audit_report.md for details):
 *
 * P1 — Comparison fairness:
 *   - extractPredictions() applied to BOTH engines symmetrically: Test-type
 *     predictions evaluated against testOracle; non-Test against mainOracle.
 *   - Duplicate cases (identical changedIds) deduplicated — oldest commit kept.
 *
 * P2 — Relationship asymmetry:
 *   - Oracle now includes EXTENDS (50 edges) matching context-aware traversal.
 *   - Production engine traversal NOT changed.
 *
 * P3 — Independent retrospective evaluation:
 *   - Git commits with ≥2 non-Test mapped components produce retrospective
 *     cases: input = first component (alphabetically); oracle = remaining
 *     co-changed components observed in the same commit.
 *   - Co-change treated as imperfect proxy; limitation disclosed.
 *
 * P4 — Informative ablation:
 *   - Configurable SCORE_THRESHOLD (default 0.35) applied to context-aware
 *     predictions. Candidates below threshold excluded from prediction set.
 *   - compareAblation() reports score changes and rank changes per component.
 *   - P@K / R@K reported at K=3, 5, 10.
 *
 * NOTES:
 *   - Both engines run in-memory (no Neo4j) for reproducibility.
 *   - Engines are re-implemented inline; production files unchanged.
 *   - All limitations from V1 still apply and are disclosed.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildEvaluationCasesV2 } from './caseBuilderV2.js';
import {
  buildOracle,
  computePRF,
  precisionAtK,
  recallAtK,
  macroAverage,
  extractPredictions,
  compareAblation,
  runUnitTests,
} from './metricsV2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const ANALYSIS_OUTPUT = path.join(BACKEND_ROOT, 'analysis_output.json');
const REPO_PATH = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const RESULTS_JSON = path.join(BACKEND_ROOT, 'evaluation_results_v2.json');
const RESULTS_MD   = path.join(BACKEND_ROOT, 'evaluation_summary_v2.md');

// ── Configurable threshold ────────────────────────────────────────────────────
// Applied only to context-aware predictions (baseline uses severity levels, not scores).
// 0.35 is chosen as the midpoint between 0.0 and the Low/Medium boundary (0.40).
// Justification: it is NOT tuned on test cases — it is derived from the model's
// severity thresholds (Medium ≥ 0.40, High ≥ 0.75). 0.35 excludes components
// that score below both boundaries, i.e., those driven purely by weak base influence.
// The threshold is configurable via SCORE_THRESHOLD env var.
const SCORE_THRESHOLD = parseFloat(process.env.SCORE_THRESHOLD ?? '0.35');

function loadGraph() {
  if (!fs.existsSync(ANALYSIS_OUTPUT)) throw new Error(`analysis_output.json not found at ${ANALYSIS_OUTPUT}`);
  const data = JSON.parse(fs.readFileSync(ANALYSIS_OUTPUT, 'utf-8'));
  return { components: data.components || [], relationships: data.relationships || [] };
}

// ── In-memory baseline engine (identical to V1) ───────────────────────────────
function runBaseline(changedIds, components, relationships) {
  const compMap = new Map(components.map(c => [c.id, c]));
  const adj = {};
  components.forEach(c => { adj[c.id] = []; });
  relationships.forEach(r => {
    if (adj[r.source] && adj[r.target]) {
      adj[r.source].push({ target: r.target, type: r.type, direction: 'outgoing' });
      adj[r.target].push({ target: r.source, type: r.type, direction: 'incoming' });
    }
  });

  const VALID = new Set(['USES', 'DEPENDS_ON', 'TESTS']);
  const impactMap = new Map();
  const priority = l => l === 'High' ? 3 : l === 'Medium' ? 2 : 1;
  function trySet(id, level) {
    const ex = impactMap.get(id);
    if (!ex || priority(level) > priority(ex.impactLevel)) impactMap.set(id, { name: id, impactLevel: level });
  }

  for (const changedId of changedIds) {
    for (const conn of (adj[changedId] || [])) {
      if (!VALID.has(conn.type)) continue;
      const nb = conn.target;
      if (changedIds.includes(nb)) continue;
      const comp = compMap.get(nb);
      if (!comp) continue;
      if (conn.type === 'USES' && (comp.type === 'Entity/Model' || comp.type === 'Other')) continue;
      let level = 'Low';
      if (conn.type === 'TESTS' && conn.direction === 'incoming') level = 'High';
      else if (conn.type === 'DEPENDS_ON' && conn.direction === 'incoming') level = 'High';
      else if (conn.type === 'DEPENDS_ON' && conn.direction === 'outgoing') level = 'Medium';
      else if (conn.type === 'USES' && conn.direction === 'incoming') level = 'High';
      else if (conn.type === 'USES' && conn.direction === 'outgoing') level = 'Medium';
      trySet(nb, level);
    }
  }
  for (const changedId of changedIds) {
    for (const conn1 of (adj[changedId] || [])) {
      if (!VALID.has(conn1.type)) continue;
      const mid = conn1.target;
      for (const conn2 of (adj[mid] || [])) {
        if (!VALID.has(conn2.type)) continue;
        const leaf = conn2.target;
        if (changedIds.includes(leaf) || leaf === mid) continue;
        const comp = compMap.get(leaf);
        if (!comp || comp.type === 'Entity/Model' || comp.type === 'Other') continue;
        const valid =
          (conn1.direction === 'incoming' && conn2.direction === 'incoming') ||
          (conn1.direction === 'outgoing' && conn2.direction === 'outgoing') ||
          (conn2.type === 'TESTS' && conn2.direction === 'incoming' && conn1.direction === 'incoming');
        if (valid) trySet(leaf, 'Low');
      }
    }
  }
  return Array.from(impactMap.values()).sort((a, b) => priority(b.impactLevel) - priority(a.impactLevel));
}

// ── In-memory context-aware engine with threshold ────────────────────────────
const BASE_CONFIG = {
  alpha: 0.7, beta: 0.3,
  hopWeights: { 1: 1.0, 2: 0.5 },
  relWeights: { DEPENDS_ON: 1.0, IMPLEMENTS: 1.0, EXTENDS: 1.0, USES: 0.7, TESTS: 0.0 },
  historySaturationThreshold: 20,
  artifactContextWeights: {
    'Repository->Service': 0.2, 'Service->Controller': 0.15,
    'Entity/Model->Controller': 0.25, 'Entity/Model->Service': 0.25,
    'Entity/Model->Repository': 0.25, 'Controller->Service': 0.0,
  },
  ablation: { enableArtifactContext: true, enableHistory: true, enableTestingContext: true },
};

function runContextAware(changedIds, components, relationships, historyCounts, configOverride = {}, threshold = SCORE_THRESHOLD) {
  const config = { ...BASE_CONFIG, ...configOverride };
  const ablation = { ...BASE_CONFIG.ablation, ...(configOverride.ablation || {}) };
  config.ablation = ablation;

  const compMap = new Map(components.map(c => [c.id, c]));
  const VALID = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'IMPLEMENTS', 'EXTENDS']);
  const adj = {};
  components.forEach(c => { adj[c.id] = []; });
  relationships.forEach(r => {
    if (!VALID.has(r.type)) return;
    if (adj[r.source]) adj[r.source].push({ id: r.target, type: r.type });
    if (adj[r.target]) adj[r.target].push({ id: r.source, type: r.type });
  });

  const impactMap = new Map();

  function processPath(changedId, impactedId, relTypes, hopCount) {
    const changedComp = compMap.get(changedId);
    const impactedComp = compMap.get(impactedId);
    if (!changedComp || !impactedComp) return;
    if (changedIds.includes(impactedId)) return;

    const changedType = changedComp.type;
    const impactedType = impactedComp.type;
    const hasTests = relTypes.includes('TESTS');

    let pathRelWeight = 1.0;
    for (const t of relTypes) pathRelWeight *= (config.relWeights[t] ?? 0.5);

    const wh = config.hopWeights[hopCount] ?? 0;
    let baseInfluence = Math.max(0, Math.min(wh * pathRelWeight, 1.0));

    let artifactWeight = 0;
    if (ablation.enableArtifactContext) {
      const flowKey = `${changedType}->${impactedType}`;
      artifactWeight = Math.max(0, Math.min(config.artifactContextWeights[flowKey] || 0, 1.0));
    }

    let historyWeight = 0;
    if (ablation.enableHistory && historyCounts) {
      let a = changedId, b = impactedId;
      if (a > b) { const t = a; a = b; b = t; }
      const count = historyCounts.get(`${a}|${b}`) || 0;
      if (count > 0) historyWeight = Math.max(0, Math.min(count / config.historySaturationThreshold, 1.0));
    }

    let contextInfluence = Math.max(0, Math.min(artifactWeight + historyWeight, 1.0));
    let influenceScore = Math.max(0, Math.min(config.alpha * baseInfluence + config.beta * contextInfluence, 1.0));

    let category = 'Impacted Component';
    if (ablation.enableTestingContext && hasTests && impactedType === 'Test') {
      category = 'Regression Tests';
      influenceScore = 1.0;
    }

    let severity = 'Low';
    if (influenceScore >= 0.75) severity = 'High';
    else if (influenceScore >= 0.40) severity = 'Medium';

    const pathData = { score: influenceScore, relTypes, hopCount, changedId, baseInfluence, contextInfluence, artifactWeight, historyWeight };

    if (!impactMap.has(impactedId)) {
      impactMap.set(impactedId, { component: impactedId, impactedType, influenceScore, severity, category, paths: [pathData] });
    } else {
      const ex = impactMap.get(impactedId);
      ex.paths.push(pathData);
      if (influenceScore > ex.influenceScore) {
        ex.influenceScore = influenceScore;
        ex.severity = severity;
        if (category === 'Regression Tests') ex.category = category;
      }
    }
  }

  for (const changedId of changedIds) {
    for (const { id, type } of (adj[changedId] || [])) {
      if (!changedIds.includes(id)) processPath(changedId, id, [type], 1);
    }
  }
  for (const changedId of changedIds) {
    for (const { id: midId, type: t1 } of (adj[changedId] || [])) {
      for (const { id: leafId, type: t2 } of (adj[midId] || [])) {
        if (!changedIds.includes(leafId) && leafId !== midId) processPath(changedId, leafId, [t1, t2], 2);
      }
    }
  }

  return Array.from(impactMap.values())
    .sort((a, b) => b.influenceScore - a.influenceScore)
    .filter(r => r.category === 'Regression Tests' || r.influenceScore >= threshold)
    .map(r => ({ ...r, influenceScore: parseFloat(r.influenceScore.toFixed(3)) }));
}

// ── Model variants ─────────────────────────────────────────────────────────────
const typeMapForExtract = components => new Map(components.map(c => [c.id, c.type]));

function makeVariants(typeMap) {
  return [
    {
      id: 'baseline',
      label: 'Baseline (structural 2-hop)',
      engineType: 'baseline',
      run: (changedIds, comps, rels, hist) => runBaseline(changedIds, comps, rels),
    },
    {
      id: 'context_full',
      label: `Context-Aware (full, threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, comps, rels, hist) => runContextAware(changedIds, comps, rels, hist, {}),
    },
    {
      id: 'context_no_history',
      label: `Context-Aware (no history, threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, comps, rels, hist) => runContextAware(changedIds, comps, rels, hist,
        { ablation: { enableArtifactContext: true, enableHistory: false, enableTestingContext: true } }),
    },
    {
      id: 'context_no_artifact',
      label: `Context-Aware (no artifact ctx, threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, comps, rels, hist) => runContextAware(changedIds, comps, rels, hist,
        { ablation: { enableArtifactContext: false, enableHistory: true, enableTestingContext: true } }),
    },
  ];
}

// ── Evaluate one case ──────────────────────────────────────────────────────────
function evaluateCaseV2(evalCase, components, relationships, K_VALUES, variants, typeMap, oracleType = 'structural') {
  const isRetro = oracleType === 'retro';
  const mainOracle = isRetro ? evalCase.retroOracle : evalCase.mainOracle;
  const testOracle = isRetro ? evalCase.retroTestOracle : evalCase.testOracle;
  const { caseId, changedIds, historyCounts } = evalCase;

  const result = {
    caseId, changedIds, oracleType,
    oracleSize: mainOracle.size, testOracleSize: testOracle.size,
    oracle: [...mainOracle], testOracle: [...testOracle],
  };

  // Run full and ablated context-aware for score/rank comparison
  const fullCtxRaw = variants.find(v => v.id === 'context_full').run(changedIds, components, relationships, historyCounts);
  const noHistRaw  = variants.find(v => v.id === 'context_no_history').run(changedIds, components, relationships, historyCounts);
  const noArtRaw   = variants.find(v => v.id === 'context_no_artifact').run(changedIds, components, relationships, historyCounts);

  const ablationDiffHistory  = compareAblation(fullCtxRaw, noHistRaw);
  const ablationDiffArtifact = compareAblation(fullCtxRaw, noArtRaw);

  result.ablation = {
    full_vs_no_history_top5_changes: ablationDiffHistory.slice(0, 5),
    full_vs_no_artifact_top5_changes: ablationDiffArtifact.slice(0, 5),
    changed_ranks_no_history: ablationDiffHistory.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
    changed_ranks_no_artifact: ablationDiffArtifact.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
    changed_preds_no_history: ablationDiffHistory.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
    changed_preds_no_artifact: ablationDiffArtifact.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
  };

  for (const variant of variants) {
    const rawResults = variant.run(changedIds, components, relationships, historyCounts);
    const { mainPredicted, testPredicted } = extractPredictions(rawResults, variant.engineType, typeMap);

    const { precision, recall, f1, tp, fp, fn } = computePRF(mainPredicted, mainOracle);
    const kMetrics = {};
    for (const k of K_VALUES) {
      kMetrics[`P@${k}`] = parseFloat(precisionAtK(mainPredicted, mainOracle, k).toFixed(4));
      kMetrics[`R@${k}`] = parseFloat(recallAtK(mainPredicted, mainOracle, k).toFixed(4));
    }

    const testM = computePRF(testPredicted, testOracle);

    result[variant.id] = {
      label: variant.label,
      mainPredicted, testPredicted,
      precision: parseFloat(precision.toFixed(4)),
      recall: parseFloat(recall.toFixed(4)),
      f1: parseFloat(f1.toFixed(4)),
      tp, fp, fn,
      ...kMetrics,
      testPrecision: parseFloat(testM.precision.toFixed(4)),
      testRecall: parseFloat(testM.recall.toFixed(4)),
      testF1: parseFloat(testM.f1.toFixed(4)),
    };
  }

  return result;
}

// ── Markdown report ────────────────────────────────────────────────────────────
function generateMarkdownV2(structResults, retroResults, structAggs, retroAggs, meta) {
  const { totalCommitsInspected, rawCaseCount, structCases, retroCases, exclusions, deduplication, K_VALUES, generatedAt } = meta;
  const exclusionBuckets = {};
  for (const e of exclusions) exclusionBuckets[e.rule] = (exclusionBuckets[e.rule] || 0) + 1;

  let md = `# Phase 5 Evaluation Report — Version 2 (Corrected)\n\n`;
  md += `> Generated: ${generatedAt}  \n`;
  md += `> Commits inspected: ${totalCommitsInspected} | Raw cases before dedup: ${rawCaseCount} | Deduplicated to: ${structCases} | Retro cases: ${retroCases}\n\n`;
  md += `> Score threshold (context-aware only): **${SCORE_THRESHOLD}**  \n`;
  md += `> Oracle relationship types: DEPENDS_ON, USES, TESTS, EXTENDS  \n\n`;

  md += `---\n\n## Corrections vs V1\n\n`;
  md += `| Issue | V1 | V2 |\n|---|---|---|\n`;
  md += `| Baseline Test-type FP | Test predictions counted as FP against mainOracle | Test predictions evaluated against testOracle symmetrically |\n`;
  md += `| Duplicate cases | 5× ExceptionControllerAdvice | Deduplicated — oldest commit kept |\n`;
  md += `| Oracle relationship set | DEPENDS_ON, USES, TESTS | + EXTENDS (aligns with context-aware engine) |\n`;
  md += `| Ablation observable | No (threshold=0, all candidates predicted) | Yes (threshold=${SCORE_THRESHOLD} filters weak candidates) |\n`;
  md += `| Independent oracle | BFS only | BFS + retrospective co-change oracle |\n\n`;

  md += `---\n\n## ⚠️ Limitations\n\n`;
  md += `1. **Small sample size** (${structCases} structural, ${retroCases} retrospective). Not statistically reliable.\n`;
  md += `2. **Structural oracle ≠ causal ground truth.** BFS reachability approximates, not proves, impact.\n`;
  md += `3. **Co-change oracle ≠ causal ground truth.** Components co-changed may share a commit for non-functional reasons.\n`;
  md += `4. **Score threshold (${SCORE_THRESHOLD}) was not tuned on test data** — derived from model severity boundaries. It may not be optimal.\n`;
  md += `5. **In-memory engines only.** No Neo4j. CO_CHANGED_WITH history counts come from git log, not Neo4j.\n`;
  md += `6. **Static graph.** The structural graph reflects analysis time, not each commit's exact state.\n\n`;

  md += `---\n\n## Deduplication\n\n`;
  md += `${deduplication.length} cases removed as duplicates:\n\n`;
  for (const d of deduplication) md += `- ${d.removed} → ${d.reason}\n`;
  md += `\n`;

  md += `---\n\n## Exclusions\n\n| Rule | Count |\n|---|---|\n`;
  for (const [rule, count] of Object.entries(exclusionBuckets).sort()) {
    md += `| ${rule} | ${count} |\n`;
  }
  md += `\n---\n\n## Part A — Structural BFS Oracle Results (${structCases} cases)\n\n`;
  md += `Oracle = 2-hop BFS reachability via DEPENDS_ON, USES, TESTS, EXTENDS.\n`;
  md += `Test-type predictions evaluated against testOracle separately.\n\n`;
  md += _aggregateTable(structAggs, K_VALUES);

  md += `\n---\n\n## Part B — Retrospective Co-Change Oracle Results (${retroCases} cases)\n\n`;
  md += `Oracle = non-Test components co-changed with the input in the same git commit.\n`;
  md += `Input = first mapped non-Test component (alphabetically). Held-out = remaining.\n\n`;
  if (retroCases === 0) {
    md += `⚠️ No eligible retrospective cases. All eligible commits have only 1 non-Test mapped component.\n\n`;
  } else {
    md += _aggregateTable(retroAggs, K_VALUES);
  }

  md += `\n---\n\n## Part C — Ablation Summary\n\n`;
  md += `Score changes when history or artifact context is disabled.\n`;
  md += `Threshold=${SCORE_THRESHOLD}: candidates below threshold are excluded from predictions.\n\n`;
  md += `### Prediction set differences (structural cases)\n\n`;
  md += `| Case | Changed preds (no-history) | Changed preds (no-artifact) | Changed ranks (no-history) | Changed ranks (no-artifact) |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const cr of structResults) {
    const ab = cr.ablation || {};
    md += `| ${cr.caseId} | ${ab.changed_preds_no_history ?? '-'} | ${ab.changed_preds_no_artifact ?? '-'} | ${ab.changed_ranks_no_history ?? '-'} | ${ab.changed_ranks_no_artifact ?? '-'} |\n`;
  }

  md += `\n---\n\n## Interpretation\n\n`;
  md += `> **These results do not constitute proof that the proposed model is more accurate** `;
  md += `than the baseline in a general sense. The sample is too small for statistical claims.\n\n`;
  md += `**What V2 corrects:**\n`;
  md += `1. The baseline is no longer penalised for Test-type predictions that are in the testOracle but not mainOracle.\n`;
  md += `2. Duplicate ExceptionControllerAdvice cases no longer inflate context-aware metrics.\n`;
  md += `3. EXTENDS-reachable nodes are now in both the oracle and the model scope — eliminating the asymmetric FP.\n`;
  md += `4. The score threshold makes ablation observable at the prediction-set level.\n\n`;
  md += `**Remaining caution:**\n`;
  md += `- The retrospective oracle (co-change) is more independent than the BFS oracle but is still an imperfect proxy.\n`;
  md += `- If retrospective recall is low for both models, neither reliably predicts co-change — the additional context signals have not yet been validated.\n`;

  return md;
}

function _aggregateTable(aggs, K_VALUES) {
  const cols = ['Model', 'P', 'R', 'F1', ...K_VALUES.flatMap(k => [`P@${k}`, `R@${k}`]), 'TestP', 'TestR'];
  let md = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n`;
  for (const [id, agg] of Object.entries(aggs)) {
    const row = [
      agg.label || id,
      agg.precision, agg.recall, agg.f1,
      ...K_VALUES.flatMap(k => [agg[`P@${k}`], agg[`R@${k}`]]),
      agg.testPrecision, agg.testRecall,
    ].map(v => typeof v === 'number' ? v.toFixed(4) : v);
    md += `| ${row.join(' | ')} |\n`;
  }
  return md;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    const failures = runUnitTests();
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Phase 5 — Corrected Evaluation Harness (V2)           ║');
  console.log(`║   Score threshold: ${SCORE_THRESHOLD}                                  ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Step 1/5  Running unit tests...');
  const testFailures = runUnitTests();
  if (testFailures.length > 0) { console.error('Unit tests failed. Aborting.'); process.exit(1); }

  console.log('Step 2/5  Loading graph...');
  const { components, relationships } = loadGraph();
  const typeMap = typeMapForExtract(components);
  console.log(`          ${components.length} components, ${relationships.length} relationships.`);

  console.log('Step 3/5  Building evaluation cases...');
  const COMMIT_LIMIT = 100;
  const { structuralCases, retroCases, exclusions, deduplication, totalCommitsInspected, rawCaseCount } =
    buildEvaluationCasesV2(REPO_PATH, components, relationships, COMMIT_LIMIT);

  console.log(`          Commits inspected : ${totalCommitsInspected}`);
  console.log(`          Raw cases         : ${rawCaseCount}`);
  console.log(`          Duplicates removed: ${deduplication.length}`);
  console.log(`          Structural cases  : ${structuralCases.length}`);
  console.log(`          Retro cases       : ${retroCases.length}`);
  console.log(`          Excluded          : ${exclusions.length}`);

  const K_VALUES = [3, 5, 10];
  const VARIANTS = makeVariants(typeMap);

  console.log('\nStep 4/5  Evaluating...');
  const structResults = [];
  for (const evalCase of structuralCases) {
    process.stdout.write(`  [structural] ${evalCase.caseId} ... `);
    structResults.push(evaluateCaseV2(evalCase, components, relationships, K_VALUES, VARIANTS, typeMap, 'structural'));
    console.log('done');
  }

  const retroResults = [];
  for (const evalCase of retroCases) {
    process.stdout.write(`  [retro]      ${evalCase.caseId} ... `);
    retroResults.push(evaluateCaseV2(evalCase, components, relationships, K_VALUES, VARIANTS, typeMap, 'retro'));
    console.log('done');
  }

  console.log('\nStep 5/5  Computing aggregates...');
  function aggregate(caseResults) {
    const aggs = {};
    for (const variant of VARIANTS) {
      const perCase = caseResults.map(cr => cr[variant.id]).filter(Boolean);
      if (perCase.length === 0) continue;
      aggs[variant.id] = { label: variant.label, ...macroAverage(perCase) };
    }
    return aggs;
  }
  const structAggs = aggregate(structResults);
  const retroAggs  = aggregate(retroResults);

  const generatedAt = new Date().toISOString();
  const fullResult = {
    version: 2, generatedAt, repoPath: REPO_PATH,
    totalCommitsInspected, commitLimit: COMMIT_LIMIT, rawCaseCount,
    scoreThreshold: SCORE_THRESHOLD,
    oracleRelationships: ['DEPENDS_ON', 'USES', 'TESTS', 'EXTENDS'],
    deduplication,
    exclusionSummary: Object.fromEntries(
      Object.entries(exclusions.reduce((a, e) => { a[e.rule] = (a[e.rule]||0)+1; return a; }, {})).sort()
    ),
    exclusions,
    structuralEvaluation: { caseCount: structuralCases.length, aggregates: structAggs, caseResults: structResults },
    retrospectiveEvaluation: { caseCount: retroCases.length, aggregates: retroAggs, caseResults: retroResults },
    modelConfig: BASE_CONFIG,
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(fullResult, null, 2));
  console.log(`\n✓ Machine-readable results → ${RESULTS_JSON}`);

  const meta = { totalCommitsInspected, rawCaseCount, structCases: structuralCases.length,
                  retroCases: retroCases.length, exclusions, deduplication, K_VALUES, generatedAt };
  fs.writeFileSync(RESULTS_MD, generateMarkdownV2(structResults, retroResults, structAggs, retroAggs, meta));
  console.log(`✓ Human-readable summary   → ${RESULTS_MD}`);

  // Stdout summary
  const printTable = (label, aggs) => {
    if (!aggs || Object.keys(aggs).length === 0) { console.log(`  (no cases)\n`); return; }
    console.log(`\n─ ${label} ─`);
    console.log(`${'Model'.padEnd(52)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)} ${'P@3'.padStart(7)} ${'R@3'.padStart(7)} ${'P@5'.padStart(7)} ${'R@5'.padStart(7)}`);
    for (const v of VARIANTS) {
      const a = aggs[v.id];
      if (!a) continue;
      const lbl = v.label.padEnd(52);
      console.log(`${lbl} ${String(a.precision).padStart(7)} ${String(a.recall).padStart(7)} ${String(a.f1).padStart(7)} ${String(a['P@3']).padStart(7)} ${String(a['R@3']).padStart(7)} ${String(a['P@5']).padStart(7)} ${String(a['R@5']).padStart(7)}`);
    }
  };
  printTable(`Structural BFS Oracle (${structuralCases.length} cases, threshold=${SCORE_THRESHOLD})`, structAggs);
  printTable(`Retrospective Co-Change Oracle (${retroCases.length} cases)`, retroAggs);
  console.log(`\nℹ  Results are indicative only. See evaluation_summary_v2.md for limitations.\n`);
}

main().catch(err => { console.error('\n✗ Harness failed:', err.message, '\n', err.stack); process.exit(1); });
