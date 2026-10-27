/**
 * historicalCaseBuilder.js
 * -------------------------
 * Case builder for Retrospective Leave-One-Out Evaluation using Reconstructed
 * Pre-Change Historical Structural Knowledge Graphs.
 *
 * Temporal Integrity Guarantees:
 *   1. For each evaluated commit C, the structural graph is reconstructed at C's parent revision (C^1).
 *   2. Components, relationships, and code introduced in commit C are absent from the structural graph.
 *   3. Ground-truth oracle targets are held out exclusively until prediction is complete.
 *   4. Historical co-change counts strictly use commits older than C (index > commitIndex).
 *   5. Root commits (no parents) or checkout failures are explicitly logged as exclusions,
 *      NEVER silently falling back to the current HEAD graph.
 */

'use strict';

import {
  parseGitLogCommits,
  buildComponentPathIndex,
  mapGitChanges,
  isJavaSourceFile
} from '../../services/gitChangeDetector.js';
import { getOrBuildHistoricalGraph } from '../../services/historicalGraphService.js';
import { generateLeaveOneOutCases } from '../v3/metricsV3.js';

/**
 * Builds leak-free co-change counts for commits strictly older than testIndex.
 *
 * @param {Array<Object>} allCommits
 * @param {number} testIndex
 * @param {Map<string, Object>} componentMap
 * @returns {Map<string, number>}
 */
function buildLeakFreeHistoryCounts(allCommits, testIndex, componentMap) {
  const historicalCommits = allCommits.slice(testIndex + 1);
  const counts = new Map();

  for (const commit of historicalCommits) {
    if (commit.isMerge) continue;

    // Use raw changes of older commits to identify touched Java files
    const touchedCompIds = new Set();
    for (const item of commit.rawChanges || []) {
      const p = item.oldPath || item.filePath || item.newPath;
      if (!p || !isJavaSourceFile(p)) continue;

      // Extract class name from path as simple identifier or match against componentMap
      for (const [id, comp] of componentMap.entries()) {
        if (comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath))) {
          touchedCompIds.add(id);
        }
      }
    }

    const ids = Array.from(touchedCompIds).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Builds all retrospective LOO cases using reconstructed pre-change graphs.
 *
 * @param {string} repoPath
 * @param {number} commitLimit
 * @param {Object} [options]
 * @returns {Promise<{ eligibleCommits: Object[], looCases: Object[], exclusions: Object[], totalCommitsInspected: number }>}
 */
export async function buildHistoricalCases(repoPath, commitLimit = 100, options = {}) {
  const allCommits = parseGitLogCommits(repoPath, commitLimit, {
    includeMerges: true
  });

  const eligibleCommits = [];
  const looCases = [];
  const exclusions = [];

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const { hash, subject, isMerge, parents, timestamp, rawChanges } = commit;

    // E1: Exclude merge commits
    if (isMerge) {
      exclusions.push({
        commitHash: hash,
        subject,
        rule: 'E1_MERGE_COMMIT',
        reason: 'Merge commit; excluded from single-change causality'
      });
      continue;
    }

    // E9: Exclude root commits (no parent revision)
    if (!parents || parents.length === 0) {
      exclusions.push({
        commitHash: hash,
        subject,
        rule: 'E9_ROOT_COMMIT',
        reason: 'Root commit has no parent revision; cannot reconstruct pre-change structural graph'
      });
      continue;
    }

    // E2/E3/E4: Fast check for relevant Java changes
    const javaChanges = rawChanges.filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) {
      exclusions.push({
        commitHash: hash,
        subject,
        rule: 'E2/E3/E4_NO_JAVA',
        reason: 'No eligible Java source files touched in commit'
      });
      continue;
    }

    // Reconstruct pre-change structural knowledge graph at parent revision
    let historicalGraphResult;
    try {
      historicalGraphResult = getOrBuildHistoricalGraph(repoPath, hash, options);
    } catch (graphErr) {
      exclusions.push({
        commitHash: hash,
        subject,
        rule: 'E_HISTORICAL_GRAPH_FAILED',
        reason: `Failed to reconstruct pre-change graph: ${graphErr.message}`
      });
      continue;
    }

    const { graph, metadata, fromCache, parentSha } = historicalGraphResult;
    const compMap = new Map(graph.components.map(c => [c.id, c]));
    const pathIndex = buildComponentPathIndex(graph.components);

    // Map changes of commit C against the pre-change graph at parent P
    const mappingReport = mapGitChanges(rawChanges, pathIndex, { perspective: 'pre' });
    const mappedCompIds = Array.from(new Set(mappingReport.mapped.map(m => m.mappedComponentId).filter(Boolean)));

    const nonTestIds = [];
    const testIds = [];

    for (const id of mappedCompIds) {
      const comp = compMap.get(id);
      if (comp && comp.type === 'Test') {
        testIds.push(id);
      } else if (comp) {
        nonTestIds.push(id);
      }
    }

    // E7: Test-only commit
    if (nonTestIds.length === 0) {
      exclusions.push({
        commitHash: hash,
        subject,
        rule: 'E7_TEST_ONLY',
        reason: 'Test-only commit or no active non-Test components in pre-change graph'
      });
      continue;
    }

    // E8: Fewer than 2 non-Test components in pre-change graph
    if (nonTestIds.length < 2) {
      exclusions.push({
        commitHash: hash,
        subject,
        rule: 'E8_SINGLE_NON_TEST',
        reason: `Only 1 non-Test component in pre-change graph (${nonTestIds[0]}); cannot split into input + target`
      });
      continue;
    }

    // Compute leak-free historical co-change counts from strictly older commits
    const historyCounts = buildLeakFreeHistoryCounts(allCommits, i, compMap);

    const commitInfo = {
      hash,
      subject,
      timestamp,
      index: i,
      parentSha
    };

    const casesForCommit = generateLeaveOneOutCases(commitInfo, nonTestIds, testIds, historyCounts);

    // Attach historical graph to each case
    for (const c of casesForCommit) {
      c.parentSha = parentSha;
      c.graphData = graph;
      c.compMap = compMap;
      c.graphComponentsCount = graph.components.length;
      c.graphRelationshipsCount = graph.relationships.length;
      c.graphFromCache = fromCache;
    }

    eligibleCommits.push({
      commitHash: hash,
      parentSha,
      commitSubject: subject,
      commitTimestamp: timestamp,
      commitIndex: i,
      mappedNonTestComponents: nonTestIds,
      mappedTestComponents: testIds,
      graphComponentsCount: graph.components.length,
      graphRelationshipsCount: graph.relationships.length,
      graphFromCache: fromCache,
      caseCount: casesForCommit.length,
      historyWindowSize: historyCounts.size
    });

    looCases.push(...casesForCommit);
  }

  return {
    eligibleCommits,
    looCases,
    exclusions,
    totalCommitsInspected: allCommits.length
  };
}
