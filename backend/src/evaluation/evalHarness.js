/**
 * evalHarness.js
 * --------------
 * Phase 5 Offline Evaluation Harness
 *
 * Runs the baseline and proposed impact engines on identical evaluation cases
 * derived from the git history of spring-petclinic-rest.
 *
 * Architecture:
 *   - Pure in-memory evaluation (reads analysis_output.json + git log).
 *   - Does NOT contact Neo4j so results are fully reproducible offline.
 *   - Calls the exact engine logic from impactEngine.js (in-memory path) and
 *     contextAwareImpactAnalyzer.js (in-memory path + configurable ablation).
 *   - Four model variants are evaluated per case (see VARIANTS below).
 *
 * Usage:
 *   node src/evaluation/evalHarness.js              # run evaluation
 *   node src/evaluation/evalHarness.js --test       # run unit tests only
 *
 * Output:
 *   backend/evaluation_results.json    machine-readable per-case + aggregate
 *   backend/evaluation_summary.md      human-readable report
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildEvaluationCases } from './caseBuilder.js';
import {
  buildOracle,
  computePRF,
  precisionAtK,
  recallAtK,
  macroAverage,
  runUnitTests,
} from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const ANALYSIS_OUTPUT = path.join(BACKEND_ROOT, 'analysis_output.json');
const REPO_PATH = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const RESULTS_JSON = path.join(BACKEND_ROOT, 'evaluation_results.json');
const RESULTS_MD   = path.join(BACKEND_ROOT, 'evaluation_summary.md');

// ── Load static graph ────────────────────────────────────────────────────────
function loadGraph() {
  if (!fs.existsSync(ANALYSIS_OUTPUT)) {
    throw new Error(`analysis_output.json not found at ${ANALYSIS_OUTPUT}`);
  }
  const data = JSON.parse(fs.readFileSync(ANALYSIS_OUTPUT, 'utf-8'));
  return { components: data.components || [], relationships: data.relationships || [] };
}

// ── In-memory baseline engine (mirrors impactEngine.analyzeImpactInMemory) ──
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

  function getImpactPriority(level) {
    return level === 'High' ? 3 : level === 'Medium' ? 2 : 1;
  }

  function trySet(id, level) {
    const existing = impactMap.get(id);
    if (!existing || getImpactPriority(level) > getImpactPriority(existing.impactLevel)) {
      impactMap.set(id, { name: id, impactLevel: level });
    }
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

  // 2-hop
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

  return Array.from(impactMap.values())
    .sort((a, b) => getImpactPriority(b.impactLevel) - getImpactPriority(a.impactLevel));
}

// ── In-memory context-aware engine (mirrors contextAwareImpactAnalyzer) ──────
const BASE_MODEL_CONFIG = {
  alpha: 0.7,
  beta: 0.3,
  hopWeights: { 1: 1.0, 2: 0.5 },
  relWeights: { DEPENDS_ON: 1.0, IMPLEMENTS: 1.0, EXTENDS: 1.0, USES: 0.7, TESTS: 0.0 },
  historySaturationThreshold: 20,
  artifactContextWeights: {
    'Repository->Service': 0.2,
    'Service->Controller': 0.15,
    'Entity/Model->Controller': 0.25,
    'Entity/Model->Service': 0.25,
    'Entity/Model->Repository': 0.25,
    'Controller->Service': 0.0,
  },
  ablation: { enableArtifactContext: true, enableHistory: true, enableTestingContext: true }
};

function runContextAware(changedIds, components, relationships, historyCounts, configOverride = {}) {
  const config = { ...BASE_MODEL_CONFIG, ...configOverride };
  const ablation = { ...BASE_MODEL_CONFIG.ablation, ...(configOverride.ablation || {}) };
  config.ablation = ablation;

  const compMap = new Map(components.map(c => [c.id, c]));
  const VALID = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'IMPLEMENTS', 'EXTENDS']);

  const adj = {}; // changedId -> list of { impactedId, type, hopCount }
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
    for (const t of relTypes) {
      pathRelWeight *= (config.relWeights[t] ?? 0.5);
    }

    const wh = config.hopWeights[hopCount] ?? 0;
    let baseInfluence = Math.max(0, Math.min(wh * pathRelWeight, 1.0));

    let artifactWeight = 0;
    if (ablation.enableArtifactContext) {
      const flowKey = `${changedType}->${impactedType}`;
      artifactWeight = Math.max(0, Math.min(config.artifactContextWeights[flowKey] || 0, 1.0));
    }

    // Leak-free history lookup
    let historyWeight = 0;
    if (ablation.enableHistory && historyCounts) {
      let a = changedId, b = impactedId;
      if (a > b) { const t = a; a = b; b = t; }
      const count = historyCounts.get(`${a}|${b}`) || 0;
      if (count > 0) {
        historyWeight = Math.max(0, Math.min(count / config.historySaturationThreshold, 1.0));
      }
    }

    let contextInfluence = Math.max(0, Math.min(artifactWeight + historyWeight, 1.0));
    let influenceScore = Math.max(0, Math.min(
      config.alpha * baseInfluence + config.beta * contextInfluence, 1.0
    ));

    let category = 'Impacted Component';
    if (ablation.enableTestingContext && hasTests && impactedType === 'Test') {
      category = 'Regression Tests';
      influenceScore = 1.0;
    }

    let severity = 'Low';
    if (influenceScore >= 0.75) severity = 'High';
    else if (influenceScore >= 0.40) severity = 'Medium';

    const pathData = { score: influenceScore, relTypes, hopCount, changedId,
                       baseInfluence, contextInfluence, artifactWeight, historyWeight };

    if (!impactMap.has(impactedId)) {
      impactMap.set(impactedId, { component: impactedId, impactedType, influenceScore, severity, category, paths: [pathData] });
    } else {
      const ex = impactMap.get(impactedId);
      ex.paths.push(pathData);
      if (influenceScore > ex.influenceScore) {
        ex.influenceScore = influenceScore;
        ex.severity = severity;
        ex.category = category;
      }
    }
  }

  // 1-hop
  for (const changedId of changedIds) {
    for (const { id, type } of (adj[changedId] || [])) {
      if (changedIds.includes(id)) continue;
      processPath(changedId, id, [type], 1);
    }
  }

  // 2-hop
  for (const changedId of changedIds) {
    for (const { id: midId, type: t1 } of (adj[changedId] || [])) {
      for (const { id: leafId, type: t2 } of (adj[midId] || [])) {
        if (changedIds.includes(leafId) || leafId === midId) continue;
        processPath(changedId, leafId, [t1, t2], 2);
      }
    }
  }

  return Array.from(impactMap.values())
    .sort((a, b) => b.influenceScore - a.influenceScore)
    .map(r => ({ ...r, influenceScore: parseFloat(r.influenceScore.toFixed(3)) }));
}

// ── Model variants ───────────────────────────────────────────────────────────
const VARIANTS = [
  {
    id: 'baseline',
    label: 'Baseline (structural 2-hop)',
    run: (changedIds, components, relationships, _historyCounts) =>
      runBaseline(changedIds, components, relationships),
    extractIds: results => results.map(r => r.name),
    extractTestIds: results => results.filter(r => {/* baseline doesn't separate tests */ false}).map(r => r.name),
  },
  {
    id: 'context_full',
    label: 'Context-Aware (full: artifact + history)',
    run: (changedIds, components, relationships, historyCounts) =>
      runContextAware(changedIds, components, relationships, historyCounts, {}),
    extractIds: results => results.filter(r => r.category !== 'Regression Tests').map(r => r.component),
    extractTestIds: results => results.filter(r => r.category === 'Regression Tests').map(r => r.component),
  },
  {
    id: 'context_no_history',
    label: 'Context-Aware (ablation: history disabled)',
    run: (changedIds, components, relationships, historyCounts) =>
      runContextAware(changedIds, components, relationships, historyCounts,
        { ablation: { enableArtifactContext: true, enableHistory: false, enableTestingContext: true } }),
    extractIds: results => results.filter(r => r.category !== 'Regression Tests').map(r => r.component),
    extractTestIds: results => results.filter(r => r.category === 'Regression Tests').map(r => r.component),
  },
  {
    id: 'context_no_artifact',
    label: 'Context-Aware (ablation: artifact context disabled)',
    run: (changedIds, components, relationships, historyCounts) =>
      runContextAware(changedIds, components, relationships, historyCounts,
        { ablation: { enableArtifactContext: false, enableHistory: true, enableTestingContext: true } }),
    extractIds: results => results.filter(r => r.category !== 'Regression Tests').map(r => r.component),
    extractTestIds: results => results.filter(r => r.category === 'Regression Tests').map(r => r.component),
  },
];

// ── Per-case evaluation ───────────────────────────────────────────────────────
function evaluateCase(evalCase, components, relationships, K_VALUES) {
  const { caseId, changedIds, mainOracle, testOracle, historyCounts } = evalCase;
  const caseResult = { caseId, changedIds, oracleSize: mainOracle.size, testOracleSize: testOracle.size };

  for (const variant of VARIANTS) {
    const rawResults = variant.run(changedIds, components, relationships, historyCounts);
    const predictedIds = variant.extractIds(rawResults);
    const predictedTestIds = variant.extractTestIds ? variant.extractTestIds(rawResults) : [];

    // Main metrics (non-test components)
    const { precision, recall, f1, tp, fp, fn } = computePRF(predictedIds, mainOracle);
    const kMetrics = {};
    for (const k of K_VALUES) {
      kMetrics[`P@${k}`] = precisionAtK(predictedIds, mainOracle, k);
      kMetrics[`R@${k}`] = recallAtK(predictedIds, mainOracle, k);
    }

    // Test oracle metrics (separate)
    const testMetrics = computePRF(predictedTestIds, testOracle);

    caseResult[variant.id] = {
      label: variant.label,
      predicted: predictedIds,
      predictedTests: predictedTestIds,
      precision: parseFloat(precision.toFixed(4)),
      recall: parseFloat(recall.toFixed(4)),
      f1: parseFloat(f1.toFixed(4)),
      tp, fp, fn,
      ...kMetrics,
      testPrecision: parseFloat(testMetrics.precision.toFixed(4)),
      testRecall: parseFloat(testMetrics.recall.toFixed(4)),
      testF1: parseFloat(testMetrics.f1.toFixed(4)),
    };
  }

  return caseResult;
}

// ── Markdown report ───────────────────────────────────────────────────────────
function formatMd(value) {
  if (typeof value === 'number') return value.toFixed(4);
  return String(value);
}

function generateMarkdownReport(allCaseResults, aggregates, meta) {
  const {
    totalCommitsInspected, eligibleCases, exclusions,
    repoPath, commitLimit, generatedAt,
  } = meta;

  const exclusionBuckets = {};
  for (const e of exclusions) {
    exclusionBuckets[e.rule] = (exclusionBuckets[e.rule] || 0) + 1;
  }

  let md = `# Phase 5 Evaluation Report — Change Impact Analysis\n\n`;
  md += `> Generated: ${generatedAt}  \n`;
  md += `> Repository: \`${repoPath}\`  \n`;
  md += `> Commits inspected: ${totalCommitsInspected}  \n`;
  md += `> Eligible evaluation cases: **${eligibleCases}**  \n\n`;

  md += `---\n\n## ⚠️ Important Limitations\n\n`;
  md += `1. **Small sample size** (${eligibleCases} cases). Results are indicative only; no statistical significance can be claimed.\n`;
  md += `2. **Structural oracle, not causal ground truth.** The oracle is the 2-hop structural neighbourhood of the changed components. A component in the oracle may not be affected at runtime; a component outside the oracle may be affected.\n`;
  md += `3. **Static graph approximation.** The structural graph reflects the repository at analysis time, not at each commit's exact timestamp. Structural changes between the test commit and analysis time are not accounted for.\n`;
  md += `4. **CO_CHANGED_WITH as a feature, not a label.** The proposed model uses historical co-change as a contextual signal. The evaluation oracle does NOT use co-change as ground truth, avoiding circular evaluation.\n`;
  md += `5. **In-memory execution.** Both engines run in their in-memory fallback mode (no Neo4j). Results reflect this mode.\n\n`;

  md += `---\n\n## Commit Exclusions\n\n`;
  md += `| Rule | Count | Description |\n|------|-------|-------------|\n`;
  const ruleDescriptions = {
    'E1': 'Merge commits (excluded at git-log level)',
    'E2/E3': 'Dependency-only or documentation-only (no Java source files)',
    'E4': 'Java files exist but all match generated-file patterns',
    'E5': 'Java files found but none map to a known component',
    'E6': 'Changed components have no structural neighbours (empty oracle)',
    'E7': 'All changed components are Test type (out of scope)',
  };
  for (const [rule, count] of Object.entries(exclusionBuckets).sort()) {
    md += `| ${rule} | ${count} | ${ruleDescriptions[rule] || rule} |\n`;
  }
  md += `\n`;

  md += `---\n\n## Metric Definitions\n\n`;
  md += `- **Precision** = TP / (TP + FP): fraction of predicted components that are structurally relevant.\n`;
  md += `- **Recall** = TP / (TP + FN): fraction of structurally relevant components that were predicted.\n`;
  md += `- **F1** = harmonic mean of Precision and Recall.\n`;
  md += `- **P@K** = Precision in top-K predictions (by ranking/severity).\n`;
  md += `- **R@K** = Recall in top-K predictions.\n`;
  md += `- **Aggregation**: Macro-average across all eligible cases (each case weighted equally).\n`;
  md += `- **Test components**: evaluated separately against a test oracle; not included in main P/R/F1.\n`;
  md += `- **Empty oracle cases**: excluded (rule E6) — not averaged, not reported.\n\n`;

  md += `---\n\n## Aggregate Results (Macro-Average)\n\n`;
  const K_VALUES = [3, 5];
  const headers = ['Model', 'Precision', 'Recall', 'F1', 'P@3', 'R@3', 'P@5', 'R@5', 'Test Recall'];
  md += `| ${headers.join(' | ')} |\n`;
  md += `| ${headers.map(() => '---').join(' | ')} |\n`;

  for (const variant of VARIANTS) {
    const agg = aggregates[variant.id];
    if (!agg) continue;
    md += `| ${variant.label} | ${formatMd(agg.precision)} | ${formatMd(agg.recall)} | ${formatMd(agg.f1)} | ${formatMd(agg['P@3'])} | ${formatMd(agg['R@3'])} | ${formatMd(agg['P@5'])} | ${formatMd(agg['R@5'])} | ${formatMd(agg.testRecall)} |\n`;
  }
  md += `\n`;

  md += `---\n\n## Per-Case Results\n\n`;
  for (const cr of allCaseResults) {
    md += `### ${cr.caseId}\n\n`;
    md += `- **Changed**: ${cr.changedIds.join(', ')}  \n`;
    md += `- **Main oracle size**: ${cr.oracleSize}  \n`;
    md += `- **Test oracle size**: ${cr.testOracleSize}  \n\n`;
    md += `| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |\n`;
    md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
    for (const variant of VARIANTS) {
      const m = cr[variant.id];
      if (!m) continue;
      md += `| ${variant.label} | ${m.precision} | ${m.recall} | ${m.f1} | ${m['P@3'] ?? '-'} | ${m['R@3'] ?? '-'} | ${m.tp} | ${m.fp} | ${m.fn} |\n`;
    }
    md += `\n`;
    // Predicted vs oracle diff
    const baselinePreds = cr.baseline?.predicted || [];
    const oracle = cr.baseline ? [] : []; // show oracle from case
    md += `<details><summary>Predictions (Baseline)</summary>\n\n`;
    md += `Predicted: ${baselinePreds.join(', ') || '(none)'}  \n\n`;
    md += `</details>\n\n`;
  }

  md += `---\n\n## Interpretation\n\n`;
  md += `> **These results do not constitute proof that the proposed model is more accurate.** `;
  md += `With ${eligibleCases} evaluation cases, differences in metrics could be due to sample variance. `;
  md += `A larger commit history, or an independent test set from a different project, would be needed to draw robust conclusions. `;
  md += `The proposed model is correctly labelled as **experimental**.\n\n`;

  md += `The ablation variants (history-disabled, artifact-disabled) show the individual contribution of each contextual signal `;
  md += `relative to the full model. If the full model does not outperform the baseline on recall while maintaining comparable precision, `;
  md += `the additional complexity is not yet justified.\n`;

  return md;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    const failures = runUnitTests();
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║     Phase 5 — Offline Evaluation Harness                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // 1. Unit tests first
  console.log('Step 1/5  Running metric unit tests...');
  const testFailures = runUnitTests();
  if (testFailures.length > 0) {
    console.error('Unit tests failed. Aborting evaluation.');
    process.exit(1);
  }

  // 2. Load graph
  console.log('Step 2/5  Loading static graph from analysis_output.json...');
  const { components, relationships } = loadGraph();
  console.log(`          Loaded ${components.length} components, ${relationships.length} relationships.`);

  // 3. Build evaluation cases
  console.log(`Step 3/5  Building evaluation cases from ${REPO_PATH}...`);
  const COMMIT_LIMIT = 100;
  const { cases, exclusions, totalCommitsInspected } = buildEvaluationCases(
    REPO_PATH, components, relationships, COMMIT_LIMIT
  );

  console.log(`          Commits inspected : ${totalCommitsInspected}`);
  console.log(`          Excluded          : ${exclusions.length}`);
  console.log(`          Eligible cases    : ${cases.length}`);

  if (cases.length === 0) {
    console.warn('\n⚠️  No eligible evaluation cases were found.');
    console.warn('   This is expected if the repository history consists mainly of');
    console.warn('   dependency bumps, CI changes, or documentation-only commits.');
    console.warn('   See evaluation_results.json for exclusion details.\n');

    // Still write an honest output
    const result = {
      generatedAt: new Date().toISOString(),
      repoPath: REPO_PATH,
      totalCommitsInspected,
      eligibleCases: 0,
      exclusions,
      message: 'No eligible cases found. See exclusions for breakdown.',
      caseResults: [],
      aggregates: {},
    };
    fs.writeFileSync(RESULTS_JSON, JSON.stringify(result, null, 2));
    console.log(`Results written to ${RESULTS_JSON}`);
    process.exit(0);
  }

  // 4. Run evaluation
  const K_VALUES = [3, 5];
  console.log(`Step 4/5  Evaluating ${cases.length} cases across ${VARIANTS.length} model variants...`);
  const allCaseResults = [];

  for (const evalCase of cases) {
    process.stdout.write(`          → ${evalCase.caseId} ... `);
    const caseResult = evaluateCase(evalCase, components, relationships, K_VALUES);
    // Attach oracle sets as arrays for JSON serialisation
    caseResult._oracleMain = Array.from(evalCase.mainOracle);
    caseResult._oracleTest = Array.from(evalCase.testOracle);
    caseResult._commitSubject = evalCase.commitSubject;
    caseResult._commitHash = evalCase.commitHash;
    caseResult._javaFilesInCommit = evalCase.javaFilesInCommit;
    caseResult._unmappedFiles = evalCase.unmappedFiles;
    caseResult._historyWindowSize = evalCase.historyCounts.size;
    allCaseResults.push(caseResult);
    console.log('done');
  }

  // 5. Aggregate
  console.log('Step 5/5  Computing macro-averages...');
  const aggregates = {};
  for (const variant of VARIANTS) {
    const perCaseMetrics = allCaseResults.map(cr => cr[variant.id]).filter(Boolean);
    aggregates[variant.id] = {
      label: variant.label,
      ...macroAverage(perCaseMetrics),
    };
  }

  // 6. Write outputs
  const generatedAt = new Date().toISOString();
  const fullResult = {
    generatedAt,
    repoPath: REPO_PATH,
    totalCommitsInspected,
    commitLimit: COMMIT_LIMIT,
    eligibleCases: cases.length,
    modelConfig: BASE_MODEL_CONFIG,
    exclusionSummary: Object.fromEntries(
      Object.entries(exclusions.reduce((acc, e) => {
        acc[e.rule] = (acc[e.rule] || 0) + 1; return acc;
      }, {})).sort()
    ),
    exclusions,
    aggregates,
    caseResults: allCaseResults,
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(fullResult, null, 2));
  console.log(`\n✓ Machine-readable results → ${RESULTS_JSON}`);

  const md = generateMarkdownReport(allCaseResults, aggregates, {
    totalCommitsInspected,
    eligibleCases: cases.length,
    exclusions,
    repoPath: REPO_PATH,
    commitLimit: COMMIT_LIMIT,
    generatedAt,
  });
  fs.writeFileSync(RESULTS_MD, md);
  console.log(`✓ Human-readable summary   → ${RESULTS_MD}`);

  // Print summary table to stdout
  console.log('\n── Aggregate Results (Macro-Average) ──────────────────────────');
  console.log(`${'Model'.padEnd(50)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)} ${'P@3'.padStart(7)} ${'R@3'.padStart(7)}`);
  console.log('─'.repeat(85));
  for (const variant of VARIANTS) {
    const agg = aggregates[variant.id];
    if (!agg) continue;
    const label = variant.label.padEnd(50);
    console.log(`${label} ${String(agg.precision).padStart(7)} ${String(agg.recall).padStart(7)} ${String(agg.f1).padStart(7)} ${String(agg['P@3']).padStart(7)} ${String(agg['R@3']).padStart(7)}`);
  }
  console.log('─'.repeat(85));
  console.log(`\nℹ  ${cases.length} case(s) evaluated. Results are indicative; see report for limitations.\n`);
}

main().catch(err => {
  console.error('\n✗ Evaluation harness failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
