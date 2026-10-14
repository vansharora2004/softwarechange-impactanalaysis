/**
 * gitHistoryAnalyzer.js
 * --------------------
 * Phase 2 implementation using gitChangeDetector.
 *
 * Responsibilities:
 *   1. Extracts commits from git log using parseGitLogCommits.
 *   2. Accurately maps files to fully-qualified component IDs.
 *   3. Explicitly isolates deleted files, renamed files, and unmapped files.
 *   4. Skips merge commits and commits with no relevant Java changes.
 *   5. Computes co-change frequencies strictly between active mapped non-Test components.
 */

'use strict';

import { parseGitLogCommits, buildComponentPathIndex } from './gitChangeDetector.js';

/**
 * Mines co-change relationships from Git history.
 *
 * @param {string}   repoPath        Path to the git repository
 * @param {number}   commitLimit     Maximum number of commits to inspect
 * @param {Object[]} neo4jComponents Array of { id, filePath, name, type }
 * @returns {Promise<Object>} Analysis statistics and co-change pairs
 */
export async function analyzeGitHistory(repoPath, commitLimit = 100, neo4jComponents = []) {
  const commits = parseGitLogCommits(repoPath, commitLimit, {
    components: neo4jComponents,
    includeMerges: false // Co-change mining excludes merge commits
  });

  const pathIndex = buildComponentPathIndex(neo4jComponents);
  const coChangeMap = new Map();

  let mappedFilesCount = 0;
  let unmappedFilesCount = 0;
  let deletedFilesCount = 0;
  let renamedFilesCount = 0;
  let relevantCommitsCount = 0;
  let mergeCommitsCount = 0;
  let commitsWithNoJavaChanges = 0;
  const unmappedDetails = [];

  for (const commit of commits) {
    if (commit.isMerge) {
      mergeCommitsCount++;
      continue;
    }

    const report = commit.mappingReport;
    if (!report) continue;

    mappedFilesCount += report.summary.mappedCount;
    unmappedFilesCount += report.summary.unmappedCount;
    deletedFilesCount += report.summary.deletedCount;
    renamedFilesCount += report.summary.renamedCount;

    if (report.unmapped.length > 0) {
      for (const u of report.unmapped) {
        unmappedDetails.push({
          commitHash: commit.hash,
          filePath: u.filePath,
          reason: u.reason
        });
      }
    }

    if (!commit.hasJavaChanges) {
      commitsWithNoJavaChanges++;
      continue;
    }

    // Get unique active mapped components touched in this commit
    const componentIds = Array.from(new Set(
      report.mapped
        .map(m => m.mappedComponentId)
        .filter(Boolean)
    ));

    // A commit is relevant for co-change only if it changes at least 2 distinct components
    if (componentIds.length > 1) {
      relevantCommitsCount++;
      for (let i = 0; i < componentIds.length; i++) {
        for (let j = i + 1; j < componentIds.length; j++) {
          let a = componentIds[i];
          let b = componentIds[j];
          if (a > b) { const temp = a; a = b; b = temp; }
          const pairKey = `${a}|${b}`;
          coChangeMap.set(pairKey, (coChangeMap.get(pairKey) || 0) + 1);
        }
      }
    }
  }

  const coChangePairs = [];
  const uniqueComponents = new Set();

  for (const [key, count] of coChangeMap.entries()) {
    const [source, target] = key.split('|');
    coChangePairs.push({ source, target, count });
    uniqueComponents.add(source);
    uniqueComponents.add(target);
  }

  coChangePairs.sort((a, b) => b.count - a.count);

  return {
    commitsAnalysed: commits.length,
    relevantCommits: relevantCommitsCount,
    mappedFiles: mappedFilesCount,
    unmappedFiles: unmappedFilesCount,
    deletedFiles: deletedFilesCount,
    renamedFiles: renamedFilesCount,
    mergeCommits: mergeCommitsCount,
    commitsWithNoJavaChanges,
    uniqueComponents: uniqueComponents.size,
    totalRelationships: coChangePairs.length,
    topPairs: coChangePairs.slice(0, 20),
    allPairs: coChangePairs,
    unmappedDetails: unmappedDetails.slice(0, 50)
  };
}
