/**
 * historicalGraphService.js
 * -------------------------
 * Service for reconstructing and caching historical structural software knowledge graphs
 * at the parent revision of evaluated commits.
 *
 * Temporal Integrity Invariants:
 *   1. For an evaluated commit C, the structural graph is built exclusively from the state
 *      at its parent revision C^1 (pre-change state).
 *   2. Components, relationships, or source code introduced in commit C or later
 *      are strictly excluded from the pre-change graph.
 *   3. If a commit is a root commit (no parent) or checkout fails, the service throws
 *      an explicit error. It NEVER silently falls back to the current HEAD graph.
 *   4. Worktrees are created in detached mode and safely removed in a finally block,
 *      ensuring the primary working directory is never altered.
 *   5. Snapshots are cached by (repoId, parentSha, analyzerVersion) to avoid redundant checkouts.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { analyzeRepository } from '../analyzers/javaAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ANALYZER_CONFIG_VERSION = 'v1_ast_extends_implements';
export const DEFAULT_CACHE_DIR = path.resolve(__dirname, '..', '..', '.cache', 'historical_graphs');

/**
 * Identifies the parent revision(s) of a given commit SHA.
 *
 * @param {string} repoPath
 * @param {string} commitSha
 * @returns {{ commitSha: string, parents: string[], parentSha: string|null, isMerge: boolean, isRoot: boolean }}
 */
export function getParentRevision(repoPath, commitSha) {
  let parentsRaw;
  try {
    parentsRaw = execFileSync('git', ['log', '-1', '--pretty=format:%P', commitSha], {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim();
  } catch (err) {
    throw new Error(`[HistoricalGraphService] Failed to retrieve parent commit for ${commitSha}: ${err.message}`);
  }

  const parents = parentsRaw.split(/\s+/).filter(Boolean);
  const isRoot = parents.length === 0;
  const isMerge = parents.length > 1;
  const parentSha = parents.length > 0 ? parents[0] : null;

  return {
    commitSha,
    parents,
    parentSha,
    isMerge,
    isRoot
  };
}

/**
 * Reconstructs or retrieves from cache the structural knowledge graph at the parent of commitSha.
 *
 * @param {string} repoPath
 * @param {string} commitSha
 * @param {Object} options
 * @param {string} [options.cacheDir]
 * @param {string} [options.analyzerVersion]
 * @param {boolean} [options.forceRebuild]
 * @returns {{ graph: { components: Object[], relationships: Object[] }, metadata: Object, fromCache: boolean, parentSha: string }}
 */
export function getOrBuildHistoricalGraph(repoPath, commitSha, options = {}) {
  const cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
  const analyzerVersion = options.analyzerVersion || ANALYZER_CONFIG_VERSION;
  const forceRebuild = Boolean(options.forceRebuild);

  const parentInfo = getParentRevision(repoPath, commitSha);
  if (parentInfo.isRoot || !parentInfo.parentSha) {
    throw new Error(`[HistoricalGraphService] Target commit ${commitSha} is a root commit with no parent revision; cannot reconstruct pre-change graph.`);
  }

  const parentSha = parentInfo.parentSha;
  const repoName = path.basename(repoPath);
  const cacheFile = path.join(cacheDir, `${repoName}_${parentSha}_${analyzerVersion}.json`);

  // 1. Check cache
  if (!forceRebuild && fs.existsSync(cacheFile)) {
    try {
      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const data = JSON.parse(raw);
      if (
        data &&
        data.metadata &&
        data.metadata.analyzerVersion === analyzerVersion &&
        data.metadata.parentSha === parentSha &&
        data.graph &&
        Array.isArray(data.graph.components) &&
        Array.isArray(data.graph.relationships)
      ) {
        return {
          graph: data.graph,
          metadata: data.metadata,
          fromCache: true,
          parentSha
        };
      }
    } catch {
      // Invalidate broken cache file
      try { fs.unlinkSync(cacheFile); } catch {}
    }
  }

  // 2. Checkout isolated worktree at parent revision
  const tempDir = path.join(
    os.tmpdir(),
    `wt_hist_${repoName}_${parentSha.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  );

  try {
    execFileSync('git', ['worktree', 'add', '--detach', tempDir, parentSha], {
      cwd: repoPath,
      encoding: 'utf-8'
    });
  } catch (err) {
    throw new Error(`[HistoricalGraphService] Failed to checkout worktree at parent revision ${parentSha} for commit ${commitSha}: ${err.message}`);
  }

  try {
    // 3. Analyze repository using existing AST analyzer
    const graph = analyzeRepository(tempDir);
    if (!graph || !Array.isArray(graph.components) || !Array.isArray(graph.relationships)) {
      throw new Error(`[HistoricalGraphService] Analyzer produced invalid graph structure for parent ${parentSha}`);
    }

    const metadata = {
      repoPath,
      repoId: repoName,
      commitSha,
      parentSha,
      isMergeParent: parentInfo.isMerge,
      analyzerVersion,
      componentsCount: graph.components.length,
      relationshipsCount: graph.relationships.length,
      createdAt: new Date().toISOString()
    };

    // 4. Cache graph
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ metadata, graph }), 'utf-8');
    } catch (writeErr) {
      process.stderr.write(`[HistoricalGraphService] Warning: Failed to write cache: ${writeErr.message}\n`);
    }

    return {
      graph,
      metadata,
      fromCache: false,
      parentSha
    };
  } catch (err) {
    throw new Error(`[HistoricalGraphService] Failed to analyze parent revision ${parentSha} for commit ${commitSha}: ${err.message}`);
  } finally {
    // 5. Clean up isolated worktree
    try {
      execFileSync('git', ['worktree', 'remove', '--force', tempDir], {
        cwd: repoPath,
        encoding: 'utf-8'
      });
    } catch (cleanupErr) {
      process.stderr.write(`[HistoricalGraphService] Warning: Failed to clean up worktree ${tempDir}: ${cleanupErr.message}\n`);
    }
  }
}

/**
 * Clears historical graph cache files.
 *
 * @param {string} [cacheDir]
 */
export function clearHistoricalGraphCache(cacheDir = DEFAULT_CACHE_DIR) {
  if (fs.existsSync(cacheDir)) {
    const files = fs.readdirSync(cacheDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try { fs.unlinkSync(path.join(cacheDir, file)); } catch {}
      }
    }
  }
}
