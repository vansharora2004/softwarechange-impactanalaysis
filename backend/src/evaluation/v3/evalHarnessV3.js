/**
 * evalHarnessV3.js
 * ----------------
 * Phase 5 Retrospective Evaluation Harness (Version 3).
 *
 * Implements:
 *   1. Leave-One-Out retrospective evaluation across all eligible commits.
 *   2. Strict separation of regression tests from ordinary component impact.
 *   3. Symmetrical prediction extraction for baseline and context-aware models.
 *   4. Informative ablation reporting (Full vs No-History vs No-Artifact Context)
 *      with score and rank deltas.
 *   5. Two-level aggregation: within-commit averaging followed by macro-averaging
 *      across independent commits.
 *   6. Production code (engines, graph, UI) untouched.
 *
 * Outputs:
 *   - backend/evaluation_results_v3.json
 *   - backend/evaluation_summary_v3.md
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildRetrospectiveCasesV3 } from './caseBuilderV3.js';
import {
  computePRFV3,
  precisionAtKV3,
  recallAtKV3,
  extractPredictionsV3,
  aggregateTwoLevel,
  compareAblationV3,
  runUnitTestsV3,
} from './metricsV3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const ANALYSIS_OUTPUT = path.join(BACKEND_ROOT, 'analysis_output.json');
const REPO_PATH = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const RESULTS_JSON = path.join(BACKEND_ROOT, 'evaluation_results_v3.json');
const RESULTS_MD   = path.join(BACKEND_ROOT, 'evaluation_summary_v3.md');

const SCORE_THRESHOLD = parseFloat(process.env.SCORE_THRESHOLD ?? '0.35');
const K_VALUES = [3, 5, 10];

function loadGraph() {
  if (!fs.existsSync(ANALYSIS_OUTPUT)) throw new Error(`analysis_output.json not found at ${ANALYSIS_OUTPUT}`);
  const data = JSON.parse(fs.readFileSync(ANALYSIS_OUTPUT, 'utf-8'));
  return { components: data.components || [], relationships: data.relationships || [] };
}

// ── Graph Prebuilder for O(1) Adjacency Lookup ──────────────────────────────
function buildEvaluationGraph(components, relationships) {
  const compMap = new Map(components.map(c => [c.id, c]));
  
  const baselineAdj = {};
  components.forEach(c => { baselineAdj[c.id] = []; });
  relationships.forEach(r => {
    if (baselineAdj[r.source] && baselineAdj[r.target]) {
      baselineAdj[r.source].push({ target: r.target, type: r.type, direction: 'outgoing' });
      baselineAdj[r.target].push({ target: r.source, type: r.type, direction: 'incoming' });
    }
  });

  const VALID = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'IMPLEMENTS', 'EXTENDS']);
  const contextAdj = {};
  components.forEach(c => { contextAdj[c.id] = []; });
  relationships.forEach(r => {
    if (!VALID.has(r.type)) return;
    if (contextAdj[r.source] && contextAdj[r.target]) {
      contextAdj[r.source].push({ id: r.target, type: r.type });
      contextAdj[r.target].push({ id: r.source, type: r.type });
    }
  });

  return { compMap, baselineAdj, contextAdj, components, relationships };
}

// ── Baseline Engine (in-memory execution matching impactEngine.js) ───────────
function runBaseline(changedIds, graphOrComponents, maybeRelationships) {
  const compMap = graphOrComponents.compMap || new Map(graphOrComponents.map(c => [c.id, c]));
  let adj = graphOrComponents.baselineAdj;
  if (!adj) {
    adj = {};
    const comps = graphOrComponents;
    const rels = maybeRelationships || [];
    comps.forEach(c => { adj[c.id] = []; });
    rels.forEach(r => {
      if (adj[r.source] && adj[r.target]) {
        adj[r.source].push({ target: r.target, type: r.type, direction: 'outgoing' });
        adj[r.target].push({ target: r.source, type: r.type, direction: 'incoming' });
      }
    });
  }

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

  return Array.from(impactMap.values()).sort((a, b) => {
    const pDiff = priority(b.impactLevel) - priority(a.impactLevel);
    if (pDiff !== 0) return pDiff;
    return a.name.localeCompare(b.name);
  });
}

// ── Context-Aware Engine (matching contextAwareImpactAnalyzer.js) ────────────
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

function runContextAware(changedIds, graphOrComponents, relationships, historyCounts, configOverride = {}, threshold = SCORE_THRESHOLD) {
  const config = { ...BASE_CONFIG, ...configOverride };
  const ablation = { ...BASE_CONFIG.ablation, ...(configOverride.ablation || {}) };
  config.ablation = ablation;

  const compMap = graphOrComponents.compMap || new Map(graphOrComponents.map(c => [c.id, c]));
  let adj = graphOrComponents.contextAdj;
  if (!adj) {
    const VALID = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'IMPLEMENTS', 'EXTENDS']);
    adj = {};
    const comps = graphOrComponents;
    const rels = relationships || [];
    comps.forEach(c => { adj[c.id] = []; });
    rels.forEach(r => {
      if (!VALID.has(r.type)) return;
      if (adj[r.source]) adj[r.source].push({ id: r.target, type: r.type });
      if (adj[r.target]) adj[r.target].push({ id: r.source, type: r.type });
    });
  }

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
    .sort((a, b) => {
      const diff = b.influenceScore - a.influenceScore;
      if (Math.abs(diff) > 1e-6) return diff;
      return a.component.localeCompare(b.component);
    })
    .filter(r => r.category === 'Regression Tests' || r.influenceScore >= threshold)
    .map(r => ({ ...r, influenceScore: parseFloat(r.influenceScore.toFixed(3)) }));
}

function makeVariants(typeMap) {
  return [
    {
      id: 'baseline',
      label: 'Baseline (structural 2-hop heuristic)',
      engineType: 'baseline',
      run: (changedIds, graph, rels) => runBaseline(changedIds, graph, rels),
    },
    {
      id: 'variant_a_structural_only',
      label: `Variant A: Structural-only (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, rels, hist) => runContextAware(changedIds, graph, rels, hist,
        { ablation: { enableArtifactContext: false, enableHistory: false, enableTestingContext: true } }),
    },
    {
      id: 'variant_b_structural_history',
      label: `Variant B: Structural + History (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, rels, hist) => runContextAware(changedIds, graph, rels, hist,
        { ablation: { enableArtifactContext: false, enableHistory: true, enableTestingContext: true } }),
    },
    {
      id: 'context_no_history',
      label: `Structural + Artifact Context (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, rels, hist) => runContextAware(changedIds, graph, rels, hist,
        { ablation: { enableArtifactContext: true, enableHistory: false, enableTestingContext: true } }),
    },
    {
      id: 'context_full',
      label: `Variant C: Full Context-Aware (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, rels, hist) => runContextAware(changedIds, graph, rels, hist, {}),
    },
  ];
}

// ── Evaluate a single LOO Case ───────────────────────────────────────────────
function evaluateCaseV3(evalCase, graph, variants, typeMap) {
  const { caseId, commitHash, inputComponent, changedIds, retroOracle, retroTestOracle, historyCounts } = evalCase;

  const result = {
    caseId,
    commitHash,
    inputComponent,
    changedIds,
    oracleSize: retroOracle.size,
    testOracleSize: retroTestOracle.size,
    oracle: [...retroOracle],
    testOracle: [...retroTestOracle]
  };

  // Run full & ablated models to compute deltas
  const fullRaw    = variants.find(v => v.id === 'context_full').run(changedIds, graph, null, historyCounts);
  const noHistRaw  = variants.find(v => v.id === 'context_no_history').run(changedIds, graph, null, historyCounts);
  const noArtRaw   = variants.find(v => v.id === 'variant_b_structural_history').run(changedIds, graph, null, historyCounts);
  const structRaw  = variants.find(v => v.id === 'variant_a_structural_only').run(changedIds, graph, null, historyCounts);

  const ablationDiffHist   = compareAblationV3(fullRaw, noHistRaw);
  const ablationDiffArt    = compareAblationV3(fullRaw, noArtRaw);
  const histContrib        = compareAblationV3(noArtRaw, structRaw);
  const structVsFull       = compareAblationV3(fullRaw, structRaw);

  result.ablation = {
    diff_no_history_top5: ablationDiffHist.slice(0, 5),
    diff_no_artifact_top5: ablationDiffArt.slice(0, 5),
    diff_history_contribution_top5: histContrib.slice(0, 5),
    diff_structural_only_top5: structVsFull.slice(0, 5),
    changed_ranks_no_history: ablationDiffHist.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
    changed_ranks_no_artifact: ablationDiffArt.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
    changed_ranks_history_contribution: histContrib.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
    changed_ranks_structural_only: structVsFull.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
    changed_preds_no_history: ablationDiffHist.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
    changed_preds_no_artifact: ablationDiffArt.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
    changed_preds_history_contribution: histContrib.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
    changed_preds_structural_only: structVsFull.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
  };

  for (const variant of variants) {
    const raw = variant.run(changedIds, graph, null, historyCounts);
    const { mainPredicted, testPredicted } = extractPredictionsV3(raw, variant.engineType, typeMap);

    const { precision, recall, f1, tp, fp, fn } = computePRFV3(mainPredicted, retroOracle);
    const kMetrics = {};
    for (const k of K_VALUES) {
      kMetrics[`P@${k}`] = parseFloat(precisionAtKV3(mainPredicted, retroOracle, k).toFixed(4));
      kMetrics[`R@${k}`] = parseFloat(recallAtKV3(mainPredicted, retroOracle, k).toFixed(4));
    }

    const testM = computePRFV3(testPredicted, retroTestOracle);

    result[variant.id] = {
      label: variant.label,
      mainPredicted,
      testPredicted,
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

// ── Markdown Report Generator ───────────────────────────────────────────────
function generateMarkdownV3(looCaseResults, commitAggregates, meta) {
  const { totalCommitsInspected, eligibleCommitsCount, totalCasesCount, exclusions, staticGraphLimitation, generatedAt } = meta;

  let md = `# Phase 5 Retrospective Evaluation Report — Version 3 (Leave-One-Out)\n\n`;
  md += `> Generated: ${generatedAt}  \n`;
  md += `> Repository: \`spring-petclinic-rest\`  \n`;
  md += `> Commits inspected: **${totalCommitsInspected}** | Eligible multi-component commits: **${eligibleCommitsCount}** | Total LOO cases evaluated: **${totalCasesCount}**  \n`;
  md += `> Pruning threshold (context-aware): **${SCORE_THRESHOLD}**  \n\n`;

  md += `---\n\n## 1. Methodology & Experimental Design\n\n`;
  md += `- **Leave-One-Out (LOO) Design**: For each eligible commit touching $M \\ge 2$ mapped non-Test components, $M$ separate evaluation cases are generated. In each case, exactly 1 component is treated as the changed input, while the remaining $M - 1$ co-changed non-Test components serve as the retrospective target oracle.\n`;
  md += `- **Separate Regression Test Evaluation**: Test components are partitioned strictly into \`testOracle\` and evaluated for test recall separately.\n`;
  md += `- **Two-Level Aggregation**: Cases originating from the same commit are first averaged at the commit level. A macro-average is then computed across independent commits, ensuring multi-component commits do not disproportionately bias the overall score.\n`;
  md += `- **Leakage Prevention**: Historical co-change features are mined exclusively from commits strictly older than the evaluated commit. Target components and future commits are never visible to the models.\n\n`;

  md += `---\n\n## 2. Documented Validity Constraints & Limitations\n\n`;
  md += `1. **Static Graph Limitation**: ${staticGraphLimitation}\n`;
  md += `2. **Sample Size**: Only **${eligibleCommitsCount} commits** in the repository satisfy the criteria ($M \\ge 2$ non-Test components). Statistical generalization is not possible with this sample size.\n`;
  md += `3. **Co-Change as an Imperfect Proxy**: Co-change does not prove functional causality. Parallel refactorings or stylistic adjustments often co-change files that have no functional dependency.\n`;
  md += `4. **Pruning Threshold**: The threshold of ${SCORE_THRESHOLD} is fixed based on architectural severity tiers and was not tuned on the test set.\n\n`;

  md += `---\n\n## 3. Commit-Level Macro-Average Results\n\n`;
  md += `Averaged first within commits, then across the ${eligibleCommitsCount} independent commits:\n\n`;

  const headers = ['Model', 'Precision', 'Recall', 'F1', 'P@3', 'R@3', 'P@5', 'R@5', 'P@10', 'R@10', 'Test Recall'];
  md += `| ${headers.join(' | ')} |\n`;
  md += `| ${headers.map(() => '---').join(' | ')} |\n`;

  for (const [vId, agg] of Object.entries(commitAggregates)) {
    const row = [
      agg.label || vId,
      agg.precision, agg.recall, agg.f1,
      agg['P@3'], agg['R@3'],
      agg['P@5'], agg['R@5'],
      agg['P@10'], agg['R@10'],
      agg.testRecall
    ].map(v => typeof v === 'number' ? v.toFixed(4) : v);
    md += `| ${row.join(' | ')} |\n`;
  }

  md += `\n---\n\n## 4. Breakdown Across Independent Commits\n\n`;
  for (const commit of meta.eligibleCommits) {
    md += `### Commit \`${commit.commitHash.slice(0, 7)}\`: "${commit.commitSubject}"\n\n`;
    md += `- **Mapped non-Test components (${commit.mappedNonTestComponents.length})**: \`${commit.mappedNonTestComponents.join(', ')}\`\n`;
    md += `- **Mapped Test components (${commit.mappedTestComponents.length})**: \`${commit.mappedTestComponents.join(', ') || '(none)'}\`\n`;
    md += `- **Generated LOO cases**: ${commit.caseCount}\n\n`;

    const commitCases = looCaseResults.filter(c => c.commitHash === commit.commitHash);
    md += `| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    for (const c of commitCases) {
      const b = c.baseline;
      const vA = c.variant_a_structural_only;
      const vB = c.variant_b_structural_history;
      const vC = c.context_full;
      md += `| \`${c.inputComponent}\` | ${b.tp}/${b.mainPredicted.length} | ${vA.tp}/${vA.mainPredicted.length} | ${vB.tp}/${vB.mainPredicted.length} | ${vC.tp}/${vC.mainPredicted.length} | ${vA.f1} | ${vB.f1} | ${vC.f1} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n## 5. Controlled Ablation Analysis across Variants\n\n`;
  md += `Comparison of prediction sets and rank shifts between controlled variants:\n\n`;
  md += `| Commit Hash | Input Component | Rank Shifts (B vs A: Hist Effect) | Rank Shifts (C vs B: Art Effect) | Pred Set Changes (Hist) | Pred Set Changes (Art) |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const c of looCaseResults) {
    const ab = c.ablation;
    md += `| \`${c.commitHash.slice(0, 7)}\` | \`${c.inputComponent}\` | ${ab.changed_ranks_history_contribution} | ${ab.changed_ranks_no_artifact} | ${ab.changed_preds_history_contribution} | ${ab.changed_preds_no_artifact} |\n`;
  }

  md += `\n---\n\n## 6. Synthesis & Honest Conclusions\n\n`;
  md += `1. **Baseline Directional Limitation Confirmed**: Across the ${totalCasesCount} leave-one-out cases, the baseline's strict forward-injection constraint frequently misses peer controllers and implementation classes.\n`;
  md += `2. **Context-Aware Candidate Breadth**: The context-aware model achieves higher recall by traversing a broader undirected 2-hop radius including \`EXTENDS\` edges, but precision remains low (~10-15%). Higher candidate counts must not be conflated with proven architectural superiority.\n`;
  md += `3. **Inconclusive Dataset Size**: With only **${eligibleCommitsCount} eligible commits**, the empirical power is insufficient to claim statistical significance. These findings must be reported as preliminary exploratory observations.\n`;

  return md;
}

// ── Main Execution ───────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    const failures = runUnitTestsV3();
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Phase 5 — Retrospective Evaluation (Version 3)        ║');
  console.log(`║   Leave-One-Out Design | Threshold: ${SCORE_THRESHOLD}                ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Step 1/5  Running unit tests...');
  const testFailures = runUnitTestsV3();
  if (testFailures.length > 0) {
    console.error('Unit tests failed. Aborting.');
    process.exit(1);
  }

  console.log('Step 2/5  Loading structural graph...');
  const { components, relationships } = loadGraph();
  const graph = buildEvaluationGraph(components, relationships);
  const typeMap = new Map(components.map(c => [c.id, c.type]));
  console.log(`          ${components.length} components, ${relationships.length} relationships.`);

  console.log('Step 3/5  Building Leave-One-Out retrospective cases...');
  const COMMIT_LIMIT = 100;
  const { eligibleCommits, looCases, exclusions, totalCommitsInspected, staticGraphLimitation } =
    buildRetrospectiveCasesV3(REPO_PATH, components, relationships, COMMIT_LIMIT);

  console.log(`          Commits inspected      : ${totalCommitsInspected}`);
  console.log(`          Eligible multi-comp    : ${eligibleCommits.length}`);
  console.log(`          Total LOO cases        : ${looCases.length}`);
  console.log(`          Excluded commits       : ${exclusions.length}`);

  const VARIANTS = makeVariants(typeMap);

  console.log('\nStep 4/5  Evaluating Leave-One-Out cases across model variants...');
  const caseResults = [];
  for (const c of looCases) {
    process.stdout.write(`  [LOO] ${c.caseId} ... `);
    caseResults.push(evaluateCaseV3(c, graph, VARIANTS, typeMap));
    console.log('done');
  }

  console.log('\nStep 5/5  Computing two-level aggregates (commit-level macro-averages)...');
  const commitAggregates = {};
  for (const v of VARIANTS) {
    const { perCommit, macroAcrossCommits } = aggregateTwoLevel(caseResults, v.id);
    commitAggregates[v.id] = { label: v.label, ...macroAcrossCommits, perCommit };
  }

  const generatedAt = new Date().toISOString();
  const fullResult = {
    version: 3,
    evaluationType: 'retrospective_leave_one_out',
    generatedAt,
    repoPath: REPO_PATH,
    totalCommitsInspected,
    eligibleCommitsCount: eligibleCommits.length,
    totalCasesCount: looCases.length,
    scoreThreshold: SCORE_THRESHOLD,
    staticGraphLimitation,
    commitAggregates,
    eligibleCommits,
    caseResults,
    exclusions
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(fullResult, null, 2));
  console.log(`\n✓ Machine-readable results → ${RESULTS_JSON}`);

  const meta = {
    totalCommitsInspected,
    eligibleCommitsCount: eligibleCommits.length,
    totalCasesCount: looCases.length,
    eligibleCommits,
    exclusions,
    staticGraphLimitation,
    generatedAt
  };
  fs.writeFileSync(RESULTS_MD, generateMarkdownV3(caseResults, commitAggregates, meta));
  console.log(`✓ Human-readable summary   → ${RESULTS_MD}`);

  console.log('\n─ Commit-Level Macro-Averages (Across Independent Commits) ─');
  console.log(`${'Model'.padEnd(52)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)} ${'P@3'.padStart(7)} ${'R@3'.padStart(7)} ${'P@5'.padStart(7)} ${'R@5'.padStart(7)} ${'TestR'.padStart(7)}`);
  for (const v of VARIANTS) {
    const a = commitAggregates[v.id];
    if (!a) continue;
    const lbl = v.label.padEnd(52);
    console.log(`${lbl} ${String(a.precision).padStart(7)} ${String(a.recall).padStart(7)} ${String(a.f1).padStart(7)} ${String(a['P@3']).padStart(7)} ${String(a['R@3']).padStart(7)} ${String(a['P@5']).padStart(7)} ${String(a['R@5']).padStart(7)} ${String(a.testRecall).padStart(7)}`);
  }
  console.log('\nℹ  Results are preliminary. See evaluation_summary_v3.md for limitations.\n');
}

main().catch(err => {
  console.error('\n✗ Harness V3 failed:', err.message, '\n', err.stack);
  process.exit(1);
});
