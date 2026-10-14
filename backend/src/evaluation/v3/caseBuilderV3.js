/**
 * caseBuilderV3.js
 * ----------------
 * Case builder for V3 Retrospective Leave-One-Out Evaluation (Phase 2).
 *
 * Rules:
 *   1. Identifies eligible commits from the repository history with:
 *      - Non-merge commits only.
 *      - At least 2 active mapped non-Test Java components.
 *      - Excludes dependency-only (pom.xml), docs-only, build/generated files,
 *        test-only commits, and commits with zero or unmapped components.
 *   2. Generates leave-one-out cases for each eligible commit:
 *      - For M non-Test components, creates M evaluation cases.
 *      - Input = 1 non-Test component.
 *      - Held-out targets = remaining M-1 non-Test components.
 *      - Test components = held-out regression test oracle targets.
 *   3. Leakage Prevention:
 *      - History counts: Only commits strictly older than the evaluated commit
 *        (index > commitIndex in newest-first git log) are used to compute
 *        co-change counts.
 *      - Target components are never used as model input.
 *      - Static Graph Limitation: Reconstructing historical graph snapshots
 *        at each commit is not supported by the current AST extractor.
 *        The structural graph from analysis_output.json represents HEAD.
 *        This known limitation is explicitly documented in the evaluation metadata.
 */

'use strict';

import { parseGitLogCommits, buildComponentPathIndex } from '../../services/gitChangeDetector.js';
import { generateLeaveOneOutCases } from './metricsV3.js';

/**
 * Builds co-change counts for commits strictly older than testIndex.
 *
 * @param {Array<Object>} allCommits
 * @param {number} testIndex
 * @param {Object} componentMap
 * @returns {Map<string, number>}
 */
function buildLeakFreeHistoryCounts(allCommits, testIndex, componentMap) {
  // Only commits strictly older than testIndex (higher index in newest-first array)
  const historicalCommits = allCommits.slice(testIndex + 1);
  const counts = new Map();

  for (const commit of historicalCommits) {
    if (commit.isMerge) continue; // Skip merge commits in history

    // Extract unique active mapped component IDs touched in this historical commit
    const report = commit.mappingReport;
    if (!report) continue;

    const ids = Array.from(new Set(
      report.mapped
        .map(m => m.mappedComponentId)
        .filter(id => componentMap.has(id))
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

/**
 * Main function: Build all V3 Leave-One-Out retrospective evaluation cases.
 *
 * @param {string} repoPath
 * @param {Object[]} components
 * @param {Object[]} relationships
 * @param {number} commitLimit
 * @returns {{ eligibleCommits: Object[], looCases: Object[], exclusions: Object[], totalCommitsInspected: number, staticGraphLimitation: string }}
 */
export function buildRetrospectiveCasesV3(repoPath, components, relationships, commitLimit = 100) {
  const componentMap = new Map(components.map(c => [c.id, c]));

  // Parse git log with full name-status awareness and merge commit detection
  const allCommits = parseGitLogCommits(repoPath, commitLimit, {
    components,
    includeMerges: true // We inspect all commits and explicitly report/exclude merges
  });

  const eligibleCommits = [];
  const looCases = [];
  const exclusions = [];

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const { hash, subject, isMerge, timestamp, mappingReport } = commit;

    // E1: Exclude merge commits
    if (isMerge) {
      exclusions.push({ hash, subject, rule: 'E1_MERGE_COMMIT', reason: 'Merge commit; excluded from single-change causality' });
      continue;
    }

    if (!mappingReport) {
      exclusions.push({ hash, subject, rule: 'E2/E3/E4', reason: 'No mapping report available' });
      continue;
    }

    const { mapped, unmapped, deleted, renamed, nonJava } = mappingReport;

    // Check if there are any Java files at all in this commit
    const javaChangesCount = mapped.length + unmapped.length;
    if (javaChangesCount === 0 && deleted.length === 0) {
      exclusions.push({ hash, subject, rule: 'E2/E3/E4', reason: 'No eligible Java source files (dependency/docs/build only)' });
      continue;
    }

    // Check if any Java files were successfully mapped to active components
    if (mapped.length === 0) {
      if (deleted.length > 0) {
        exclusions.push({ hash, subject, rule: 'E2_DELETION_ONLY', reason: `Only deletions in commit (${deleted.map(d => d.filePath).join(', ')})` });
      } else {
        exclusions.push({
          hash,
          subject,
          rule: 'E5_UNMAPPED',
          reason: `Java files present but none mapped to components (${unmapped.map(u => u.filePath).join(', ')})`
        });
      }
      continue;
    }

    // Separate Test from non-Test components among active mapped components
    const mappedCompIds = Array.from(new Set(mapped.map(m => m.mappedComponentId).filter(Boolean)));
    const nonTestIds = [];
    const testIds = [];

    for (const id of mappedCompIds) {
      const comp = componentMap.get(id);
      if (comp && comp.type === 'Test') {
        testIds.push(id);
      } else if (comp) {
        nonTestIds.push(id);
      }
    }

    // E7: Test-only commit
    if (nonTestIds.length === 0) {
      exclusions.push({ hash, subject, rule: 'E7_TEST_ONLY', reason: 'Test-only commit; out of scope for component impact' });
      continue;
    }

    // E8: Fewer than 2 non-Test components (cannot perform leave-one-out split)
    if (nonTestIds.length < 2) {
      exclusions.push({
        hash,
        subject,
        rule: 'E8_SINGLE_NON_TEST',
        reason: `Only 1 non-Test component (${nonTestIds[0]}); cannot split into input + target`
      });
      continue;
    }

    // Leak-free history for this commit (strictly older commits)
    const historyCounts = buildLeakFreeHistoryCounts(allCommits, i, componentMap);

    const commitInfo = { hash, subject, timestamp, index: i };
    const casesForCommit = generateLeaveOneOutCases(commitInfo, nonTestIds, testIds, historyCounts);

    eligibleCommits.push({
      commitHash: hash,
      commitSubject: subject,
      commitTimestamp: timestamp,
      commitIndex: i,
      mappedNonTestComponents: nonTestIds,
      mappedTestComponents: testIds,
      deletedComponentsCount: deleted.length,
      renamedComponentsCount: renamed.length,
      unmappedFilesCount: unmapped.length,
      caseCount: casesForCommit.length,
      historyWindowSize: historyCounts.size
    });

    looCases.push(...casesForCommit);
  }

  return {
    eligibleCommits,
    looCases,
    exclusions,
    totalCommitsInspected: allCommits.length,
    staticGraphLimitation: 'The structural repository graph is static (HEAD snapshot from analysis_output.json). ' +
      'Temporal AST evolution across historical commits is not captured; only historical co-change counts are time-sliced.'
  };
}
