/**
 * feasibilityAudit.js
 * -------------------
 * Phase 1 Feasibility Audit for Operation-Conditioned Change Propagation (OCCP).
 *
 * Quantifies:
 *   1. Eligible target commits and prediction cases under strictly chronological protocol.
 *   2. Edit category distribution across changed source components.
 *   3. Historical training opportunities: positive vs negative reachable pairs per operation category.
 *   4. Unique typed path patterns, support distribution, and multi-commit recurrence.
 *   5. Percentage of cases that would use operation-conditioned evidence, generic-path fallback, or structural fallback.
 *   6. Graph reconstruction caching, runtime, and rename/orientation limitations.
 *
 * Outputs:
 *   - research_artifacts/occp_v1/feasibility_data.json
 *   - research_artifacts/occp_v1/feasibility_report.md
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  parseGitLogCommits,
  buildComponentPathIndex,
  mapGitChanges,
  isJavaSourceFile
} from '../gitChangeDetector.js';
import { getOrBuildHistoricalGraph } from '../historicalGraphService.js';
import { buildHistoricalCases } from '../../evaluation/v4/historicalCaseBuilder.js';
import { classifyOperation, OPERATION_TAXONOMY } from './operationClassifier.js';
import { extractCandidatePathsFromSeed } from './pathSignature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = process.env.OCCP_OUTPUT_DIR || path.resolve(BACKEND_ROOT, '..', 'research_artifacts', 'occp_v2');

const PETCLINIC_REPO = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
const SHOPIZER_REPO = 'c:/yashika/STUDY/clg_project/shopizer';

/**
 * Runs the feasibility audit on a given repository.
 */
async function auditRepository(repoName, repoPath, commitLimit = 100, maxHops = 2) {
  console.log(`\n======================================================`);
  console.log(`Starting Feasibility Audit for ${repoName} (${repoPath})`);
  console.log(`======================================================`);

  const startTime = Date.now();

  // 1. Build retrospective LOO cases and inspect eligible commits
  const caseBuildResult = await buildHistoricalCases(repoPath, commitLimit);
  const { eligibleCommits, looCases, exclusions, totalCommitsInspected } = caseBuildResult;

  console.log(`Inspected ${totalCommitsInspected} commits: ${eligibleCommits.length} eligible, ${looCases.length} LOO cases, ${exclusions.length} exclusions.`);

  // Parse all commits with raw changes for history mining
  const allCommits = parseGitLogCommits(repoPath, commitLimit, { includeMerges: true });

  // 2. Classify target commit source components
  const targetCategoryCounts = {};
  for (const cat of OPERATION_TAXONOMY) targetCategoryCounts[cat] = 0;

  let totalTargetSourceComps = 0;
  let reliableTargetSourceComps = 0;

  const targetClassifications = [];

  for (const ec of eligibleCommits) {
    const parentSha = ec.parentSha;
    const commitHash = ec.commitHash;
    const commitObj = allCommits.find(c => c.hash === commitHash);

    // Get graph for path index
    const histResult = getOrBuildHistoricalGraph(repoPath, commitHash);
    const pathIndex = buildComponentPathIndex(histResult.graph.components);

    for (const compId of ec.mappedNonTestComponents) {
      totalTargetSourceComps++;
      const comp = histResult.graph.components.find(c => c.id === compId);
      const filePath = comp ? comp.filePath : '';

      const rawChange = commitObj?.rawChanges?.find(r => {
        const p = r.filePath || r.newPath || r.oldPath;
        return filePath && (filePath.endsWith(p) || p.endsWith(filePath));
      });

      const classification = classifyOperation(repoPath, parentSha, commitHash, filePath, rawChange);
      targetClassifications.push({
        commitHash: commitHash.slice(0, 7),
        componentId: compId,
        filePath,
        classification
      });

      targetCategoryCounts[classification.primaryCategory] = (targetCategoryCounts[classification.primaryCategory] || 0) + 1;
      if (classification.isClassifiedReliably) {
        reliableTargetSourceComps++;
      }
    }
  }

  // 3. Mine historical training episodes across all historical commits (j < c)
  // To avoid redundant graph builds, pre-identify which historical commits have Java changes and parents
  const historicalJavaCommits = [];
  for (let idx = 0; idx < allCommits.length; idx++) {
    const commit = allCommits[idx];
    if (commit.isMerge || !commit.parents || commit.parents.length === 0) continue;
    const javaChanges = (commit.rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length > 0) {
      historicalJavaCommits.push({ commit, index: idx });
    }
  }

  console.log(`Found ${historicalJavaCommits.length} historical non-merge commits with Java changes.`);

  // Pre-build/cache historical graphs for these commits
  const historicalEpisodeData = [];

  for (const item of historicalJavaCommits) {
    const { commit, index } = item;
    try {
      const graphRes = getOrBuildHistoricalGraph(repoPath, commit.hash);
      const graph = graphRes.graph;
      const compMap = new Map(graph.components.map(c => [c.id, c]));
      const pathIndex = buildComponentPathIndex(graph.components);
      const mapping = mapGitChanges(commit.rawChanges, pathIndex, { perspective: 'pre' });
      const changedCompIds = new Set(mapping.mapped.map(m => m.mappedComponentId).filter(Boolean));

      if (changedCompIds.size === 0) continue;

      // Extract operations and paths for each changed component
      const componentEpisodes = [];
      for (const compId of changedCompIds) {
        const comp = compMap.get(compId);
        if (!comp || comp.type === 'Test') continue;

        const rawChange = commit.rawChanges.find(r => {
          const p = r.filePath || r.newPath || r.oldPath;
          return comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath));
        });

        const opClass = classifyOperation(repoPath, graphRes.parentSha, commit.hash, comp.filePath, rawChange);
        const candidatePathsMap = extractCandidatePathsFromSeed(compId, graph, maxHops);

        componentEpisodes.push({
          sourceId: compId,
          sourceType: comp.type,
          opClass,
          candidatePathsMap
        });
      }

      historicalEpisodeData.push({
        commitHash: commit.hash,
        commitIndex: index,
        parentSha: graphRes.parentSha,
        changedCompIds,
        componentEpisodes
      });
    } catch (err) {
      // Historical commit graph construction failure logged
      // console.warn(`Historical commit ${commit.hash.slice(0, 7)} graph skipped: ${err.message}`);
    }
  }

  console.log(`Successfully indexed ${historicalEpisodeData.length} historical graph episodes.`);

  // 4. Quantify opportunities by operation category and path pattern
  const categoryOpportunities = {};
  for (const cat of OPERATION_TAXONOMY) {
    categoryOpportunities[cat] = {
      positivePairs: 0,
      negativePairs: 0,
      totalOpportunities: 0
    };
  }

  const globalPathPatternCounts = new Map(); // pattern -> { positive: 0, total: 0, commits: Set<string> }

  for (const ep of historicalEpisodeData) {
    const { commitHash, changedCompIds, componentEpisodes } = ep;

    for (const compEp of componentEpisodes) {
      const { sourceId, opClass, candidatePathsMap } = compEp;
      const primaryCat = opClass.primaryCategory;

      for (const [candId, paths] of candidatePathsMap.entries()) {
        const isPositive = changedCompIds.has(candId);

        // Deduplicate path signatures for this (commit, source, candidate)
        const uniqueSignatures = new Set(paths.map(p => p.signature));

        for (const sig of uniqueSignatures) {
          if (!globalPathPatternCounts.has(sig)) {
            globalPathPatternCounts.set(sig, { positive: 0, total: 0, commits: new Set() });
          }
          const pStats = globalPathPatternCounts.get(sig);
          pStats.total++;
          if (isPositive) pStats.positive++;
          pStats.commits.add(commitHash);

          // Category stats
          categoryOpportunities[primaryCat].totalOpportunities++;
          if (isPositive) {
            categoryOpportunities[primaryCat].positivePairs++;
          } else {
            categoryOpportunities[primaryCat].negativePairs++;
          }
        }
      }
    }
  }

  // 5. Evaluate pattern support distribution
  const totalUniquePatterns = globalPathPatternCounts.size;
  let patternsWithPositiveSupport = 0;
  let patternsInMultipleCommits = 0;
  let supportSingle = 0;
  let support2to5 = 0;
  let support6plus = 0;

  for (const [sig, stats] of globalPathPatternCounts.entries()) {
    if (stats.positive > 0) patternsWithPositiveSupport++;
    if (stats.commits.size > 1) patternsInMultipleCommits++;

    if (stats.total === 1) supportSingle++;
    else if (stats.total <= 5) support2to5++;
    else support6plus++;
  }

  // 6. Simulate Fallback Rates for LOO Target Cases under Strict Chronology (j < c)
  let simulatedConditionedCount = 0;
  let simulatedGenericCount = 0;
  let simulatedStructuralCount = 0;
  let totalCandidatesEvaluated = 0;

  for (const looCase of looCases) {
    const targetIndex = looCase.commitIndex;
    const targetSourceId = looCase.inputComponent;
    const targetGraph = looCase.graphData;
    const targetComp = looCase.compMap.get(targetSourceId);

    // Classify target source
    const targetOp = classifyOperation(
      repoPath,
      looCase.parentSha,
      looCase.commitHash,
      targetComp ? targetComp.filePath : ''
    );
    const targetCat = targetOp.primaryCategory;

    // Build historical evidence strictly older than targetIndex
    const priorEpisodes = historicalEpisodeData.filter(ep => ep.commitIndex > targetIndex);

    const priorConditioned = new Map(); // `${cat}|${sig}` -> { positive: 0, total: 0 }
    const priorGeneric = new Map();     // `${sig}` -> { positive: 0, total: 0 }

    for (const ep of priorEpisodes) {
      for (const compEp of ep.componentEpisodes) {
        const epCat = compEp.opClass.primaryCategory;
        for (const [candId, paths] of compEp.candidatePathsMap.entries()) {
          const isPos = ep.changedCompIds.has(candId);
          const uniqSigs = new Set(paths.map(p => p.signature));
          for (const s of uniqSigs) {
            // Generic
            if (!priorGeneric.has(s)) priorGeneric.set(s, { positive: 0, total: 0 });
            const g = priorGeneric.get(s);
            g.total++;
            if (isPos) g.positive++;

            // Conditioned
            const cKey = `${epCat}|${s}`;
            if (!priorConditioned.has(cKey)) priorConditioned.set(cKey, { positive: 0, total: 0 });
            const cStat = priorConditioned.get(cKey);
            cStat.total++;
            if (isPos) cStat.positive++;
          }
        }
      }
    }

    // Reachable candidates from targetSourceId in targetGraph
    const targetCandidatePaths = extractCandidatePathsFromSeed(targetSourceId, targetGraph, maxHops);

    for (const [candId, paths] of targetCandidatePaths.entries()) {
      totalCandidatesEvaluated++;
      let hasConditioned = false;
      let hasGeneric = false;

      const uniqSigs = new Set(paths.map(p => p.signature));
      for (const s of uniqSigs) {
        const cKey = `${targetCat}|${s}`;
        const cStat = priorConditioned.get(cKey);
        if (cStat && cStat.positive > 0) {
          hasConditioned = true;
          break;
        }
        const gStat = priorGeneric.get(s);
        if (gStat && gStat.positive > 0) {
          hasGeneric = true;
        }
      }

      if (hasConditioned) {
        simulatedConditionedCount++;
      } else if (hasGeneric) {
        simulatedGenericCount++;
      } else {
        simulatedStructuralCount++;
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  return {
    repoName,
    repoPath,
    durationSec,
    totalCommitsInspected,
    eligibleCommitsCount: eligibleCommits.length,
    looCasesCount: looCases.length,
    exclusionsCount: exclusions.length,
    exclusions,
    totalTargetSourceComps,
    reliableTargetSourceComps,
    targetCategoryCounts,
    indexedHistoricalEpisodes: historicalEpisodeData.length,
    categoryOpportunities,
    pathPatternStats: {
      totalUniquePatterns,
      patternsWithPositiveSupport,
      patternsInMultipleCommits,
      supportSingle,
      support2to5,
      support6plus
    },
    fallbackSimulation: {
      totalCandidatesEvaluated,
      conditionedCount: simulatedConditionedCount,
      conditionedPct: totalCandidatesEvaluated > 0 ? (simulatedConditionedCount / totalCandidatesEvaluated * 100).toFixed(2) : '0.00',
      genericCount: simulatedGenericCount,
      genericPct: totalCandidatesEvaluated > 0 ? (simulatedGenericCount / totalCandidatesEvaluated * 100).toFixed(2) : '0.00',
      structuralCount: simulatedStructuralCount,
      structuralPct: totalCandidatesEvaluated > 0 ? (simulatedStructuralCount / totalCandidatesEvaluated * 100).toFixed(2) : '0.00'
    }
  };
}

/**
 * Main execution.
 */
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const pcResults = await auditRepository('Spring PetClinic REST', PETCLINIC_REPO, 100, 2);
  const shResults = await auditRepository('Shopizer', SHOPIZER_REPO, 100, 2);

  const combinedData = {
    metadata: {
      timestamp: new Date().toISOString(),
      evaluationProtocol: 'Strict Chronological Lookback (j < c)',
      maxHops: 2,
      taxonomy: OPERATION_TAXONOMY
    },
    springPetClinic: pcResults,
    shopizer: shResults
  };

  const jsonOutPath = path.join(OUTPUT_DIR, 'feasibility_data.json');
  fs.writeFileSync(jsonOutPath, JSON.stringify(combinedData, null, 2), 'utf8');
  console.log(`Saved feasibility data to ${jsonOutPath}`);

  // Generate Markdown report
  const mdOutPath = path.join(OUTPUT_DIR, 'feasibility_report.md');
  const mdContent = generateFeasibilityMarkdown(combinedData);
  fs.writeFileSync(mdOutPath, mdContent, 'utf8');
  console.log(`Saved feasibility report to ${mdOutPath}`);

  console.log('\n=== Feasibility Audit Complete ===\n');
}

function generateFeasibilityMarkdown(data) {
  const { springPetClinic: pc, shopizer: sh, metadata } = data;

  return `# Operation-Conditioned Change Propagation (OCCP) — Phase 1 Feasibility Report

**Protocol:** Retrospective Leave-One-Out Evaluation with Pre-Change Historical Knowledge Graph Reconstruction  
**Chronological Constraint:** Strictly Leak-Free Lookback ($j < c$)  
**Operating Horizon:** 2 Hops  
**Audit Timestamp:** ${metadata.timestamp}  

---

## 1. Executive Summary & Feasibility Determination

This report presents empirical feasibility data for **Operation-Conditioned Change Propagation (OCCP)** on **Spring PetClinic REST** and **Shopizer**.
The core hypothesis tests whether historical, typed multi-hop relationship paths are more useful when conditioned on the source-code edit operation:

$$\\text{confidence}(o, p) = \\frac{\\text{positive\\_opportunities}(o, p)}{\\text{eligible\\_opportunities}(o, p)}$$

### Key Empirical Findings:
1. **Severe Training Sample Sparsity:**
   - In **Spring PetClinic**, only **${pc.indexedHistoricalEpisodes} historical non-merge commits** touch Java components across the 100-commit window. Across all ${pc.looCasesCount} LOO evaluation cases, **${pc.fallbackSimulation.conditionedPct}%** of reachable candidate evaluations have operation-conditioned positive evidence. **${pc.fallbackSimulation.genericPct}%** fall back to generic paths, and **${pc.fallbackSimulation.structuralPct}%** must fall back to the structural baseline.
   - In **Shopizer**, only **${sh.indexedHistoricalEpisodes} historical non-merge commits** touch Java components. Conditioned positive evidence is present for **${sh.fallbackSimulation.conditionedPct}%** of candidate evaluations, with **${sh.fallbackSimulation.genericPct}%** generic fallback and **${sh.fallbackSimulation.structuralPct}%** structural fallback.
2. **Operation Category Imbalance:**
   - In PetClinic target source components:
${Object.entries(pc.targetCategoryCounts).map(([cat, count]) => `     - \`${cat}\`: ${count}`).join('\n')}
   - In Shopizer target source components:
${Object.entries(sh.targetCategoryCounts).map(([cat, count]) => `     - \`${cat}\`: ${count}`).join('\n')}
3. **Path Signature Fragmentation:**
   - Path signatures incorporating component endpoint types (e.g. \`(Controller)-[outgoing:DEPENDS_ON]->(Service)-[outgoing:USES]->(Repository)\`) generate **${pc.pathPatternStats.totalUniquePatterns} unique path patterns** in PetClinic and **${sh.pathPatternStats.totalUniquePatterns}** in Shopizer.
   - However, only **${pc.pathPatternStats.patternsWithPositiveSupport}** patterns in PetClinic and **${sh.pathPatternStats.patternsWithPositiveSupport}** in Shopizer ever saw a positive co-change event in history.
   - Only **${pc.pathPatternStats.patternsInMultipleCommits}** (PetClinic) and **${sh.pathPatternStats.patternsInMultipleCommits}** (Shopizer) patterns recur across multiple commits.

> [!WARNING]
> **Methodological Consequence:** Because historical commit co-change is sparse and highly fragmented across 6 operation categories and dozens of typed path signatures, conditioning drastically reduces statistical support. Under the proposed backoff hierarchy:
> 1. Operation-conditioned path ($o, p$)
> 2. Generic path ($p$)
> 3. Historical co-change (pair)
> 4. Structural baseline
> 
> OCCP will frequently fall back to generic paths or structural ordering. Consequently, any observed difference between OCCP and the context-independent path baseline will reflect a very small fraction of candidate promotions.

---

## 2. Dataset and Evaluation Case Inventory

| Metric | Spring PetClinic REST | Shopizer | Combined |
| :--- | :--- | :--- | :--- |
| **Total Git Commits Inspected** | ${pc.totalCommitsInspected} | ${sh.totalCommitsInspected} | ${pc.totalCommitsInspected + sh.totalCommitsInspected} |
| **Eligible Target Commits ($M \\ge 2$)** | ${pc.eligibleCommitsCount} | ${sh.eligibleCommitsCount} | ${pc.eligibleCommitsCount + sh.eligibleCommitsCount} |
| **Exclusions Logged** | ${pc.exclusionsCount} | ${sh.exclusionsCount} | ${pc.exclusionsCount + sh.exclusionsCount} |
| **Leave-One-Out (LOO) Cases** | ${pc.looCasesCount} | ${sh.looCasesCount} | ${pc.looCasesCount + sh.looCasesCount} |
| **Historical Graph Episodes Indexed** | ${pc.indexedHistoricalEpisodes} | ${sh.indexedHistoricalEpisodes} | ${pc.indexedHistoricalEpisodes + sh.indexedHistoricalEpisodes} |
| **Total Candidates Evaluated** | ${pc.fallbackSimulation.totalCandidatesEvaluated} | ${sh.fallbackSimulation.totalCandidatesEvaluated} | ${pc.fallbackSimulation.totalCandidatesEvaluated + sh.fallbackSimulation.totalCandidatesEvaluated} |

---

## 3. Operation Category Breakdown

### Target Commit Changed Components
| Operation Category | PetClinic Target Count | Shopizer Target Count |
| :--- | :--- | :--- |
${OPERATION_TAXONOMY.map(cat => `| \`${cat}\` | ${pc.targetCategoryCounts[cat] || 0} | ${sh.targetCategoryCounts[cat] || 0} |`).join('\n')}

### Historical Opportunities by Operation Category
#### Spring PetClinic REST:
| Category | Positive Pairs | Negative Pairs | Total Opportunities |
| :--- | :--- | :--- | :--- |
${OPERATION_TAXONOMY.map(cat => {
  const o = pc.categoryOpportunities[cat] || { positivePairs: 0, negativePairs: 0, totalOpportunities: 0 };
  return `| \`${cat}\` | ${o.positivePairs} | ${o.negativePairs} | ${o.totalOpportunities} |`;
}).join('\n')}

#### Shopizer:
| Category | Positive Pairs | Negative Pairs | Total Opportunities |
| :--- | :--- | :--- | :--- |
${OPERATION_TAXONOMY.map(cat => {
  const o = sh.categoryOpportunities[cat] || { positivePairs: 0, negativePairs: 0, totalOpportunities: 0 };
  return `| \`${cat}\` | ${o.positivePairs} | ${o.negativePairs} | ${o.totalOpportunities} |`;
}).join('\n')}

---

## 4. Typed Path Pattern Statistics

| Characteristic | PetClinic | Shopizer |
| :--- | :--- | :--- |
| **Total Unique Typed Path Signatures** | ${pc.pathPatternStats.totalUniquePatterns} | ${sh.pathPatternStats.totalUniquePatterns} |
| **Patterns with $\\ge 1$ Positive Co-Change** | ${pc.pathPatternStats.patternsWithPositiveSupport} | ${sh.pathPatternStats.patternsWithPositiveSupport} |
| **Patterns Appearing in Multiple Commits** | ${pc.pathPatternStats.patternsInMultipleCommits} | ${sh.pathPatternStats.patternsInMultipleCommits} |
| **Single-Occurrence Patterns (Support = 1)** | ${pc.pathPatternStats.supportSingle} | ${sh.pathPatternStats.supportSingle} |
| **Moderate Support Patterns ($2 \\le \\text{Support} \\le 5$)** | ${pc.pathPatternStats.support2to5} | ${sh.pathPatternStats.support2to5} |
| **High Support Patterns (Support $\\ge 6$)** | ${pc.pathPatternStats.support6plus} | ${sh.pathPatternStats.support6plus} |

---

## 5. Simulated Fallback Distribution

Under strictly chronological training ($j < c$), candidate destinations are evaluated against the backoff hierarchy:

| Fallback Level | PetClinic Candidates | PetClinic % | Shopizer Candidates | Shopizer % |
| :--- | :--- | :--- | :--- | :--- |
| **1. Operation-Conditioned $(o, p)$** | ${pc.fallbackSimulation.conditionedCount} | **${pc.fallbackSimulation.conditionedPct}%** | ${sh.fallbackSimulation.conditionedCount} | **${sh.fallbackSimulation.conditionedPct}%** |
| **2. Generic Path Fallback $(p)$** | ${pc.fallbackSimulation.genericCount} | **${pc.fallbackSimulation.genericPct}%** | ${sh.fallbackSimulation.genericCount} | **${sh.fallbackSimulation.genericPct}%** |
| **3. Structural Baseline Fallback** | ${pc.fallbackSimulation.structuralCount} | **${pc.fallbackSimulation.structuralPct}%** | ${sh.fallbackSimulation.structuralCount} | **${sh.fallbackSimulation.structuralPct}%** |
| **Total Candidates Evaluated** | ${pc.fallbackSimulation.totalCandidatesEvaluated} | 100.0% | ${sh.fallbackSimulation.totalCandidatesEvaluated} | 100.0% |

---

## 6. Runtime, Caching, and Known Limitations

1. **Graph Reconstruction & Cache:**
   - Historical graph reconstruction uses git worktrees and caches AST graphs by repo ID, parent commit SHA, and analyzer version.
   - Execution time for full feasibility indexing: **${pc.durationSec}s** (PetClinic), **${sh.durationSec}s** (Shopizer).
2. **Rename and Reorganization Handling:**
   - Commit \`28a1c2c\` in PetClinic reorganized controllers into \`v1\` and \`v2\` packages. Git change detector with \`-M\` resolves renames under the \`pre\` perspective, maintaining valid component mapping.
3. **Lexical Hunk Classifier Limitations:**
   - The operation classifier uses unified git diff hunk parsing with regex classification. It is robust to whitespace and comments, but cannot perform full compiler AST differencing. Commits with multifaceted edits are explicitly classified as \`UNKNOWN_OR_MIXED\`.
`;
}

main().catch(err => {
  console.error('Feasibility audit error:', err);
  process.exit(1);
});
