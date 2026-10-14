/**
 * temporalEvalHarnessV3.js
 * ------------------------
 * Temporal Point-in-Time Evaluation Harness (Version 3).
 *
 * Eliminates temporal leakage by:
 *   1. For each evaluated commit, checking out its parent revision (commit^)
 *      into a detached worktree.
 *   2. Running the static analyzer on the parent revision to build the exact
 *      point-in-time structural graph that existed before the change was introduced.
 *   3. Mining historical co-change counts exclusively from commits strictly
 *      older than the evaluated commit.
 *   4. Mapping changed files against the parent revision's components.
 *   5. Evaluating all controlled variants (Structural-only, Structural + History,
 *      Full Context-Aware, Baseline) on the point-in-time graph.
 *
 * Outputs:
 *   - backend/temporal_evaluation_results_v3.json
 *   - backend/temporal_evaluation_summary_v3.md
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { analyzeRepository } from '../../analyzers/javaAnalyzer.js';
import {
  parseGitLogCommits,
  buildComponentPathIndex,
  mapGitChanges
} from '../../services/gitChangeDetector.js';
import {
  computePRFV3,
  precisionAtKV3,
  recallAtKV3,
  extractPredictionsV3,
  aggregateTwoLevel,
  compareAblationV3,
  generateLeaveOneOutCases
} from './metricsV3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const REPO_PATH = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const RESULTS_JSON = path.join(BACKEND_ROOT, 'temporal_evaluation_results_v3.json');
const RESULTS_MD   = path.join(BACKEND_ROOT, 'temporal_evaluation_summary_v3.md');

const SCORE_THRESHOLD = parseFloat(process.env.SCORE_THRESHOLD ?? '0.35');
const K_VALUES = [3, 5, 10];

// ── Graph Prebuilder ────────────────────────────────────────────────────────
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

// ── Baseline Engine (matches impactEngine.js) ─────────────────────────────────
function runBaseline(changedIds, graph) {
  const compMap = graph.compMap;
  const adj = graph.baselineAdj;
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

// ── Context-Aware Engine ──────────────────────────────────────────────────────
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

function runContextAware(changedIds, graph, historyCounts, configOverride = {}, threshold = SCORE_THRESHOLD) {
  const config = { ...BASE_CONFIG, ...configOverride };
  const ablation = { ...BASE_CONFIG.ablation, ...(configOverride.ablation || {}) };
  config.ablation = ablation;

  const compMap = graph.compMap;
  const adj = graph.contextAdj;
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
      run: (changedIds, graph) => runBaseline(changedIds, graph),
    },
    {
      id: 'variant_a_structural_only',
      label: `Variant A: Structural-only (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, hist) => runContextAware(changedIds, graph, hist,
        { ablation: { enableArtifactContext: false, enableHistory: false, enableTestingContext: true } }),
    },
    {
      id: 'variant_b_structural_history',
      label: `Variant B: Structural + History (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, hist) => runContextAware(changedIds, graph, hist,
        { ablation: { enableArtifactContext: false, enableHistory: true, enableTestingContext: true } }),
    },
    {
      id: 'context_no_history',
      label: `Structural + Artifact Context (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, hist) => runContextAware(changedIds, graph, hist,
        { ablation: { enableArtifactContext: true, enableHistory: false, enableTestingContext: true } }),
    },
    {
      id: 'context_full',
      label: `Variant C: Full Context-Aware (threshold=${SCORE_THRESHOLD})`,
      engineType: 'context',
      run: (changedIds, graph, hist) => runContextAware(changedIds, graph, hist, {}),
    },
  ];
}

// ── Build Point-in-Time Parent Graph via Git Worktree ─────────────────────────
function extractPointInTimeGraph(repoPath, commitHash) {
  const fullHash = execFileSync('git', ['rev-parse', commitHash], { cwd: repoPath, encoding: 'utf-8' }).trim();
  const parentHash = execFileSync('git', ['rev-parse', `${fullHash}^`], { cwd: repoPath, encoding: 'utf-8' }).trim();
  
  const tempDir = path.join(repoPath, `.temp_worktree_${commitHash.slice(0, 7)}`);
  try {
    execFileSync('git', ['worktree', 'add', tempDir, parentHash, '--detach'], { cwd: repoPath, stdio: ['ignore', 'ignore', 'ignore'] });
    const graphData = analyzeRepository(tempDir);
    return {
      parentHash,
      components: graphData.components,
      relationships: graphData.relationships
    };
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', tempDir, '--force'], { cwd: repoPath, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (_) {}
  }
}

// ── Build Leak-Free History Counts ───────────────────────────────────────────
function buildLeakFreeHistory(allCommits, testIndex, parentComponentMap) {
  const olderCommits = allCommits.slice(testIndex + 1);
  const counts = new Map();

  for (const c of olderCommits) {
    if (c.isMerge) continue;
    if (!c.mappingReport) continue;

    const ids = Array.from(new Set(
      c.mappingReport.mapped
        .map(m => m.mappedComponentId)
        .filter(id => parentComponentMap.has(id))
    ));

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        let a = ids[i], b = ids[j];
        if (a > b) { const t = a; a = b; b = t; }
        const key = `${a}|${b}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
}

// ── Main Temporal Evaluation ─────────────────────────────────────────────────
async function runTemporalEvaluation() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   Temporal Point-in-Time Evaluation (Zero Leakage)            ║');
  console.log('║   Parent Revision Worktree Graph Extraction                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('Step 1/4  Inspecting git commits in PetClinic repository...');
  // Inspect commits
  const allCommits = parseGitLogCommits(REPO_PATH, 100, { includeMerges: true });
  console.log(`          Total commits in git log: ${allCommits.length}`);

  // Eligible target commits from PetClinic V3
  const targetCommitHashes = ['a3884f7', '0b02b04', 'abd2bd4', '28a1c2c', 'a66fd63', '64b36a2'];
  console.log(`          Target evaluation commits: ${targetCommitHashes.join(', ')}`);

  console.log('\nStep 2/4  Extracting point-in-time parent graphs & building LOO cases...');
  const evaluatedCommits = [];
  const allLooCases = [];
  const caseResults = [];

  for (const shortHash of targetCommitHashes) {
    const commitIndex = allCommits.findIndex(c => c.hash.startsWith(shortHash));
    if (commitIndex === -1) {
      console.warn(`  Commit ${shortHash} not found in git log. Skipping.`);
      continue;
    }
    const commit = allCommits[commitIndex];
    if (commit.isMerge) {
      console.log(`  Commit ${shortHash} is a merge commit. Skipping per policy.`);
      continue;
    }

    process.stdout.write(`  Extracting parent graph for commit ${shortHash} ... `);
    const parentGraphData = extractPointInTimeGraph(REPO_PATH, commit.hash);
    const { components, relationships, parentHash } = parentGraphData;
    const parentCompMap = new Map(components.map(c => [c.id, c]));
    const typeMap = new Map(components.map(c => [c.id, c.type]));
    const graph = buildEvaluationGraph(components, relationships);
    console.log(`done (parent ${parentHash.slice(0, 7)}, ${components.length} comps, ${relationships.length} rels)`);

    // Map changed files of target commit against parent components
    const parentCompIndex = buildComponentPathIndex(components);
    const mappingReport = mapGitChanges(commit.rawChanges, parentCompIndex);

    const mappedNonTest = Array.from(new Set(
      mappingReport.mapped
        .map(m => m.mappedComponentId)
        .filter(id => parentCompMap.has(id) && parentCompMap.get(id).type !== 'Test')
    ));
    const mappedTest = Array.from(new Set(
      mappingReport.mapped
        .map(m => m.mappedComponentId)
        .filter(id => parentCompMap.has(id) && parentCompMap.get(id).type === 'Test')
    ));

    if (mappedNonTest.length < 2) {
      console.log(`  [Skip] ${shortHash} has only ${mappedNonTest.length} mapped non-Test components in parent graph.`);
      continue;
    }

    // Mine leak-free historical co-change from strictly older commits
    const historyCounts = buildLeakFreeHistory(allCommits, commitIndex, parentCompMap);

    // Generate LOO cases
    const commitInfo = { hash: commit.hash, subject: commit.subject, timestamp: commit.timestamp, index: commitIndex };
    const looCases = generateLeaveOneOutCases(commitInfo, mappedNonTest, mappedTest, historyCounts);
    allLooCases.push(...looCases);

    evaluatedCommits.push({
      commitHash: commit.hash,
      parentHash,
      commitSubject: commit.subject,
      caseCount: looCases.length,
      mappedNonTestComponents: mappedNonTest,
      mappedTestComponents: mappedTest,
      parentComponentCount: components.length,
      parentRelationshipCount: relationships.length
    });

    const VARIANTS = makeVariants(typeMap);

    // Evaluate each LOO case on the point-in-time parent graph
    for (const c of looCases) {
      const fullRaw    = variantsFind(VARIANTS, 'context_full').run(c.changedIds, graph, c.historyCounts);
      const noHistRaw  = variantsFind(VARIANTS, 'context_no_history').run(c.changedIds, graph, c.historyCounts);
      const noArtRaw   = variantsFind(VARIANTS, 'variant_b_structural_history').run(c.changedIds, graph, c.historyCounts);
      const structRaw  = variantsFind(VARIANTS, 'variant_a_structural_only').run(c.changedIds, graph, c.historyCounts);

      const ablationDiffHist = compareAblationV3(fullRaw, noHistRaw);
      const ablationDiffArt  = compareAblationV3(fullRaw, noArtRaw);
      const histContrib      = compareAblationV3(noArtRaw, structRaw);
      const structVsFull     = compareAblationV3(fullRaw, structRaw);

      const cr = {
        caseId: c.caseId,
        commitHash: c.commitHash,
        inputComponent: c.inputComponent,
        changedIds: c.changedIds,
        oracleSize: c.retroOracle.size,
        testOracleSize: c.retroTestOracle.size,
        ablation: {
          diff_no_history_top5: ablationDiffHist.slice(0, 5),
          diff_no_artifact_top5: ablationDiffArt.slice(0, 5),
          diff_history_contribution_top5: histContrib.slice(0, 5),
          diff_structural_only_top5: structVsFull.slice(0, 5),
          changed_ranks_history_contribution: histContrib.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
          changed_ranks_no_artifact: ablationDiffArt.filter(d => d.rankChange !== 0 && d.rankChange !== null).length,
          changed_preds_history_contribution: histContrib.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
          changed_preds_no_artifact: ablationDiffArt.filter(d => d.fullRank === Infinity || d.ablatedRank === Infinity).length,
        }
      };

      for (const variant of VARIANTS) {
        const raw = variant.run(c.changedIds, graph, c.historyCounts);
        const { mainPredicted, testPredicted } = extractPredictionsV3(raw, variant.engineType, typeMap);
        const { precision, recall, f1, tp, fp, fn } = computePRFV3(mainPredicted, c.retroOracle);
        const kMetrics = {};
        for (const k of K_VALUES) {
          kMetrics[`P@${k}`] = parseFloat(precisionAtKV3(mainPredicted, c.retroOracle, k).toFixed(4));
          kMetrics[`R@${k}`] = parseFloat(recallAtKV3(mainPredicted, c.retroOracle, k).toFixed(4));
        }
        const testM = computePRFV3(testPredicted, c.retroTestOracle);

        cr[variant.id] = {
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

      caseResults.push(cr);
    }
  }

  function variantsFind(variants, id) {
    return variants.find(v => v.id === id);
  }

  console.log(`\nStep 3/4  Computing two-level aggregates across ${evaluatedCommits.length} commits (${caseResults.length} LOO cases)...`);
  const VARIANTS = makeVariants(new Map());
  const commitAggregates = {};
  for (const v of VARIANTS) {
    const { perCommit, macroAcrossCommits } = aggregateTwoLevel(caseResults, v.id);
    commitAggregates[v.id] = { label: v.label, ...macroAcrossCommits, perCommit };
  }

  console.log('\nStep 4/4  Saving temporal evaluation results...');
  const generatedAt = new Date().toISOString();
  const fullResult = {
    version: 3,
    evaluationType: 'temporal_point_in_time_leave_one_out',
    generatedAt,
    repoPath: REPO_PATH,
    evaluatedCommitsCount: evaluatedCommits.length,
    totalCasesCount: caseResults.length,
    scoreThreshold: SCORE_THRESHOLD,
    commitAggregates,
    evaluatedCommits,
    caseResults
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(fullResult, null, 2));
  console.log(`✓ Machine-readable temporal results → ${RESULTS_JSON}`);

  // Generate markdown summary
  let md = `# Temporal Point-in-Time Retrospective Evaluation Report (Zero Leakage)\n\n`;
  md += `> Generated: ${generatedAt}  \n`;
  md += `> Methodology: **Parent-Revision Git Worktree Graph Extraction** (Point-in-Time AST Snapshot)  \n`;
  md += `> Evaluated Commits: **${evaluatedCommits.length}** | Total LOO Cases: **${caseResults.length}**  \n`;
  md += `> Pruning threshold: **${SCORE_THRESHOLD}**  \n\n`;

  md += `---\n\n## 1. Commit-Level Macro-Averages (Temporal Point-in-Time)\n\n`;
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

  md += `\n---\n\n## 2. Temporal Commit Breakdown\n\n`;
  for (const c of evaluatedCommits) {
    md += `### Commit \`${c.commitHash.slice(0, 7)}\`: "${c.commitSubject}"\n`;
    md += `- Parent Revision: \`${c.parentHash.slice(0, 7)}\` (${c.parentComponentCount} components, ${c.parentRelationshipCount} relationships)\n`;
    md += `- Mapped non-Test components (${c.mappedNonTestComponents.length}): \`${c.mappedNonTestComponents.join(', ')}\`\n`;
    md += `- LOO cases: ${c.caseCount}\n\n`;
  }

  fs.writeFileSync(RESULTS_MD, md);
  console.log(`✓ Human-readable temporal summary   → ${RESULTS_MD}`);

  console.log('\n─ Temporal Point-in-Time Macro-Averages ─');
  console.log(`${'Model'.padEnd(52)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)} ${'P@3'.padStart(7)} ${'R@3'.padStart(7)} ${'P@5'.padStart(7)} ${'R@5'.padStart(7)} ${'TestR'.padStart(7)}`);
  for (const v of VARIANTS) {
    const a = commitAggregates[v.id];
    if (!a) continue;
    console.log(`${(v.label).padEnd(52)} ${String(a.precision ?? 0).padStart(7)} ${String(a.recall ?? 0).padStart(7)} ${String(a.f1 ?? 0).padStart(7)} ${String(a['P@3'] ?? 0).padStart(7)} ${String(a['R@3'] ?? 0).padStart(7)} ${String(a['P@5'] ?? 0).padStart(7)} ${String(a['R@5'] ?? 0).padStart(7)} ${String(a.testRecall ?? 0).padStart(7)}`);
  }
}

runTemporalEvaluation().catch(err => {
  console.error('Temporal evaluation failed:', err);
  process.exit(1);
});
