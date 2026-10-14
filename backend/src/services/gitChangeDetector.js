/**
 * gitChangeDetector.js
 * --------------------
 * Reliable Git Change Detection and Component Mapping Service (Phase 2).
 *
 * Responsibilities:
 *   1. Path Normalization: Consistent forward-slash, clean relative paths for Windows/Unix.
 *   2. Component Path Indexing: Fast O(1) exact mapping, multi-class file awareness, and ambiguity detection.
 *   3. Git Change Status Parsing: Explicit handling of Added (A), Modified (M), Deleted (D), Renamed (R), and Copied (C).
 *   4. Safe Execution: Uses execFileSync with arguments array to avoid shell-escaping hazards on Windows.
 *   5. Traceability: Unmapped and deleted files are explicitly reported with reasons; never silently discarded or treated as active components.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const GENERATED_PATH_PATTERNS = [
  /^target\//i,
  /^build\//i,
  /\.postman_collection\.json$/i,
  /\.postman_environment\.json$/i,
  /\.jmx$/i,
  /openapi\.ya?ml$/i,
  /\.class$/i,
  /\.jar$/i,
];

// ── 1. Path Normalization ─────────────────────────────────────────────────────

/**
 * Normalizes a file path:
 * - Trims whitespace and quotes
 * - Replaces backslashes with forward slashes
 * - Strips leading/trailing slashes and redundant ./ segments
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  let clean = p.trim().replace(/^["']|["']$/g, '');
  clean = clean.replace(/\\/g, '/');
  clean = clean.replace(/^\.\//, '');
  clean = clean.replace(/\/+/g, '/');
  clean = clean.replace(/^\//, '');
  clean = clean.replace(/\/$/, '');
  return clean;
}

/**
 * Returns true if the file path indicates a Java source file.
 */
export function isJavaSourceFile(filePath) {
  const norm = normalizePath(filePath).toLowerCase();
  return (
    norm.endsWith('.java') &&
    !norm.endsWith('package-info.java') &&
    !norm.endsWith('module-info.java') &&
    !GENERATED_PATH_PATTERNS.some(pat => pat.test(norm))
  );
}

// ── 2. Component Path Indexing ────────────────────────────────────────────────

/**
 * Builds an index of components by normalized file path.
 *
 * Handles:
 * - Exact path mapping
 * - Detection of multiple classes mapped to the same file
 * - Lookup by component ID
 *
 * @param {Array<Object>} components Array of { id, name, type, filePath }
 */
export function buildComponentPathIndex(components = []) {
  const exactPathMap = new Map(); // normalizedLowerPath -> Array<Component>
  const byId = new Map();         // componentId -> Component

  for (const comp of components) {
    if (!comp || !comp.id) continue;
    byId.set(comp.id, comp);

    const normPath = normalizePath(comp.filePath).toLowerCase();
    if (!normPath) continue;

    const list = exactPathMap.get(normPath) || [];
    list.push(comp);
    exactPathMap.set(normPath, list);
  }

  /**
   * Resolves a file path to its corresponding component(s).
   *
   * @param {string} rawFilePath
   * @returns {{ status: 'MAPPED'|'AMBIGUOUS'|'UNMAPPED', componentId?: string, component?: Object, candidates?: string[], reason?: string, matchType?: string }}
   */
  function resolveFile(rawFilePath) {
    const query = normalizePath(rawFilePath).toLowerCase();
    if (!query) {
      return { status: 'UNMAPPED', reason: 'Empty file path' };
    }

    // 1. Exact path match
    if (exactPathMap.has(query)) {
      const candidates = exactPathMap.get(query);
      if (candidates.length === 1) {
        return {
          status: 'MAPPED',
          componentId: candidates[0].id,
          component: candidates[0],
          matchType: 'EXACT'
        };
      }

      // Multiple components in same file: check if one matches the base filename
      const baseName = path.basename(query, '.java');
      const primary = candidates.filter(c => c.name.toLowerCase() === baseName.toLowerCase());
      if (primary.length === 1) {
        return {
          status: 'MAPPED',
          componentId: primary[0].id,
          component: primary[0],
          matchType: 'PRIMARY_CLASS_IN_MULTI_CLASS_FILE',
          allInFile: candidates.map(c => c.id)
        };
      }

      // Truly ambiguous multiple classes with no distinct primary match
      return {
        status: 'AMBIGUOUS',
        reason: `Multiple components mapped to exact file path: ${query}`,
        candidates: candidates.map(c => c.id)
      };
    }

    // 2. Suffix match (safety net for cases where repo prefix differs)
    const suffixMatches = [];
    for (const [storedPath, comps] of exactPathMap.entries()) {
      if (storedPath.endsWith('/' + query) || query.endsWith('/' + storedPath)) {
        suffixMatches.push(...comps);
      }
    }

    if (suffixMatches.length === 1) {
      return {
        status: 'MAPPED',
        componentId: suffixMatches[0].id,
        component: suffixMatches[0],
        matchType: 'SUFFIX'
      };
    }

    if (suffixMatches.length > 1) {
      // Check if all suffix matches point to the same component ID (deduplicate)
      const uniqueIds = Array.from(new Set(suffixMatches.map(c => c.id)));
      if (uniqueIds.length === 1) {
        return {
          status: 'MAPPED',
          componentId: suffixMatches[0].id,
          component: suffixMatches[0],
          matchType: 'SUFFIX_UNIQUE'
        };
      }
      return {
        status: 'AMBIGUOUS',
        reason: `File path suffix "${query}" matches multiple components in different packages`,
        candidates: uniqueIds
      };
    }

    return {
      status: 'UNMAPPED',
      reason: `No component found in graph matching file path: "${rawFilePath}"`
    };
  }

  return {
    exactPathMap,
    byId,
    allComponents: components,
    resolveFile
  };
}

// ── 3. Git Change Status Parsing ─────────────────────────────────────────────

/**
 * Parses a single line from `git diff --name-status` or `git log --name-status`.
 *
 * Format examples:
 *   M\tsrc/Foo.java
 *   A\tsrc/Bar.java
 *   D\tsrc/Old.java
 *   R100\tsrc/Old.java\tsrc/New.java
 *   C100\tsrc/Old.java\tsrc/Copy.java
 *
 * @param {string} line
 * @returns {Object|null}
 */
export function parseNameStatusLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const cols = trimmed.split('\t');
  if (cols.length < 2) return null;

  const code = cols[0].trim();
  const statusChar = code[0].toUpperCase();

  if (statusChar === 'R') {
    // Renamed: cols[1] = oldPath, cols[2] = newPath
    return {
      statusCode: code,
      changeType: 'RENAMED',
      oldPath: normalizePath(cols[1]),
      newPath: normalizePath(cols[2] || cols[1]),
      filePath: normalizePath(cols[2] || cols[1])
    };
  }

  if (statusChar === 'C') {
    // Copied: cols[1] = source, cols[2] = destination
    return {
      statusCode: code,
      changeType: 'COPIED',
      oldPath: normalizePath(cols[1]),
      newPath: normalizePath(cols[2] || cols[1]),
      filePath: normalizePath(cols[2] || cols[1])
    };
  }

  if (statusChar === 'D') {
    return {
      statusCode: 'D',
      changeType: 'DELETED',
      oldPath: normalizePath(cols[1]),
      newPath: null,
      filePath: normalizePath(cols[1])
    };
  }

  if (statusChar === 'A') {
    return {
      statusCode: 'A',
      changeType: 'ADDED',
      oldPath: null,
      newPath: normalizePath(cols[1]),
      filePath: normalizePath(cols[1])
    };
  }

  if (statusChar === 'M') {
    return {
      statusCode: 'M',
      changeType: 'MODIFIED',
      oldPath: normalizePath(cols[1]),
      newPath: normalizePath(cols[1]),
      filePath: normalizePath(cols[1])
    };
  }

  // Any other status (e.g. Type changed 'T', Unmerged 'U')
  return {
    statusCode: code,
    changeType: 'OTHER',
    oldPath: normalizePath(cols[1]),
    newPath: normalizePath(cols[1]),
    filePath: normalizePath(cols[1])
  };
}

/**
 * Parses lines from `git status --porcelain=v1 -uall`.
 *
 * Format examples:
 *   M src/Foo.java
 *  M src/Bar.java
 *  A src/Added.java
 *  D src/Deleted.java
 *  R old.java -> new.java
 *  ?? untracked.java
 *
 * @param {string} line
 * @returns {Object|null}
 */
export function parsePorcelainStatusLine(line) {
  if (!line || typeof line !== 'string' || line.length < 4) return null;

  const x = line[0];
  const y = line[1];
  const rest = line.substring(3).trim();

  // Untracked
  if (x === '?' && y === '?') {
    return {
      statusCode: '??',
      changeType: 'UNTRACKED',
      oldPath: null,
      newPath: normalizePath(rest),
      filePath: normalizePath(rest)
    };
  }

  // Renamed
  if (x === 'R' || y === 'R') {
    const parts = rest.split(' -> ');
    const oldP = normalizePath(parts[0]);
    const newP = normalizePath(parts[1] || parts[0]);
    return {
      statusCode: 'R',
      changeType: 'RENAMED',
      oldPath: oldP,
      newPath: newP,
      filePath: newP
    };
  }

  // Deleted
  if (x === 'D' || y === 'D') {
    return {
      statusCode: 'D',
      changeType: 'DELETED',
      oldPath: normalizePath(rest),
      newPath: null,
      filePath: normalizePath(rest)
    };
  }

  // Added
  if (x === 'A' || y === 'A') {
    return {
      statusCode: 'A',
      changeType: 'ADDED',
      oldPath: null,
      newPath: normalizePath(rest),
      filePath: normalizePath(rest)
    };
  }

  // Modified (default for M or other working-tree changes)
  return {
    statusCode: `${x}${y}`.trim() || 'M',
    changeType: 'MODIFIED',
    oldPath: normalizePath(rest),
    newPath: normalizePath(rest),
    filePath: normalizePath(rest)
  };
}

// ── 4. Change Mapping Logic ──────────────────────────────────────────────────

/**
 * Maps an array of parsed change descriptors to components using the path index.
 *
 * Strictly handles:
 * - Added / Modified files: mapped to active component.
 * - Deleted files: explicitly recorded as deletion events; NOT assigned as active components.
 * - Renamed files: tracks old and new paths, checks whether IDs are identical, maps new path.
 * - Unmapped Java files: explicitly isolated with clear reasons.
 * - Non-Java files: classified as IGNORED_NON_JAVA.
 *
 * @param {Array<Object>} rawChanges
 * @param {Object} pathIndex
 * @returns {Object} Structured report
 */
export function mapGitChanges(rawChanges = [], pathIndex) {
  const mapped = [];
  const unmapped = [];
  const deleted = [];
  const renamed = [];
  const nonJava = [];
  const detailedChanges = [];

  for (const item of rawChanges) {
    if (!item) continue;
    const { changeType, filePath, oldPath, newPath, statusCode } = item;
    const isJava = isJavaSourceFile(filePath || newPath || oldPath);

    // 1. Deleted file handling
    if (changeType === 'DELETED') {
      const historicalRes = isJava && pathIndex ? pathIndex.resolveFile(oldPath) : null;
      const delRecord = {
        changeType: 'DELETED',
        statusCode: statusCode || 'D',
        filePath: oldPath,
        oldPath,
        newPath: null,
        isJava,
        mappedComponentId: null, // NEVER treat deleted file as an active current component
        historicalComponentId: historicalRes && historicalRes.status === 'MAPPED' ? historicalRes.componentId : null,
        reason: 'File deleted in commit / working tree'
      };
      deleted.push(delRecord);
      detailedChanges.push(delRecord);
      continue;
    }

    // 2. Renamed file handling
    if (changeType === 'RENAMED') {
      let oldCompId = null;
      let newCompId = null;
      let isSameComponentId = null;
      let mapResult = null;

      if (isJava && pathIndex) {
        const oldRes = pathIndex.resolveFile(oldPath);
        const newRes = pathIndex.resolveFile(newPath);
        oldCompId = oldRes.status === 'MAPPED' ? oldRes.componentId : null;
        newCompId = newRes.status === 'MAPPED' ? newRes.componentId : null;
        if (oldCompId && newCompId) {
          isSameComponentId = (oldCompId === newCompId);
        }
        mapResult = newRes;
      }

      const renRecord = {
        changeType: 'RENAMED',
        statusCode: statusCode || 'R',
        filePath: newPath,
        oldPath,
        newPath,
        isJava,
        oldComponentId: oldCompId,
        newComponentId: newCompId,
        isSameComponentId,
        mappedComponentId: newCompId, // Active component corresponds to new path
        status: newCompId ? 'MAPPED' : 'UNMAPPED',
        reason: newCompId ? 'Renamed file mapped to new component path' : 'Renamed file new path not found in graph'
      };

      renamed.push(renRecord);
      detailedChanges.push(renRecord);

      if (newCompId) {
        mapped.push(renRecord);
      } else if (isJava) {
        unmapped.push(renRecord);
      }
      continue;
    }

    // 3. Non-Java files
    if (!isJava) {
      const nonJavaRecord = {
        changeType,
        statusCode,
        filePath,
        oldPath,
        newPath,
        isJava: false,
        mappedComponentId: null,
        status: 'IGNORED_NON_JAVA',
        reason: 'Non-Java or generated file'
      };
      nonJava.push(nonJavaRecord);
      detailedChanges.push(nonJavaRecord);
      continue;
    }

    // 4. Java files (Added, Modified, Untracked, etc.)
    if (!pathIndex) {
      const noIndexRecord = {
        changeType,
        statusCode,
        filePath,
        isJava: true,
        mappedComponentId: null,
        status: 'UNMAPPED',
        reason: 'No component index provided'
      };
      unmapped.push(noIndexRecord);
      detailedChanges.push(noIndexRecord);
      continue;
    }

    const res = pathIndex.resolveFile(filePath);
    if (res.status === 'MAPPED') {
      const mappedRecord = {
        changeType,
        statusCode,
        filePath,
        oldPath,
        newPath,
        isJava: true,
        mappedComponentId: res.componentId,
        componentType: res.component ? res.component.type : 'Other',
        componentName: res.component ? res.component.name : path.basename(filePath, '.java'),
        matchType: res.matchType,
        status: 'MAPPED',
        reason: 'Successfully mapped to graph component'
      };
      mapped.push(mappedRecord);
      detailedChanges.push(mappedRecord);
    } else if (res.status === 'AMBIGUOUS') {
      const ambRecord = {
        changeType,
        statusCode,
        filePath,
        oldPath,
        newPath,
        isJava: true,
        mappedComponentId: null,
        candidates: res.candidates,
        status: 'AMBIGUOUS',
        reason: res.reason
      };
      unmapped.push(ambRecord);
      detailedChanges.push(ambRecord);
    } else {
      const unmappedRecord = {
        changeType,
        statusCode,
        filePath,
        oldPath,
        newPath,
        isJava: true,
        mappedComponentId: null,
        status: 'UNMAPPED',
        reason: res.reason || 'Java file not mapped to any extracted component'
      };
      unmapped.push(unmappedRecord);
      detailedChanges.push(unmappedRecord);
    }
  }

  return {
    detailedChanges,
    mapped,
    unmapped,
    deleted,
    renamed,
    nonJava,
    mappedComponentIds: Array.from(new Set(mapped.map(m => m.mappedComponentId).filter(Boolean))),
    summary: {
      totalFiles: detailedChanges.length,
      mappedCount: mapped.length,
      unmappedCount: unmapped.length,
      deletedCount: deleted.length,
      renamedCount: renamed.length,
      nonJavaCount: nonJava.length
    }
  };
}

// ── 5. Working Tree & Revision Change Detection ──────────────────────────────

/**
 * Detects git changes for a repository.
 *
 * Supports modes:
 * - 'local': Uncommitted working tree + staged changes
 * - 'commit': Changes in HEAD or a specified revision
 * - 'range': Changes between two revisions
 *
 * @param {string} repoPath
 * @param {Object} options { mode: 'local'|'commit'|'range', revision?: string, base?: string, target?: string }
 * @param {Array<Object>} components Optional component list for automatic mapping
 * @returns {Object}
 */
export function detectGitChanges(repoPath, options = {}, components = []) {
  const mode = options.mode || 'local';
  const pathIndex = components && components.length > 0 ? buildComponentPathIndex(components) : null;
  const rawChanges = [];

  try {
    if (mode === 'local') {
      // 1. Porcelain status gives staged, unstaged, untracked, and deleted files
      const statusRaw = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8'
      });

      const lines = statusRaw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        const item = parsePorcelainStatusLine(l);
        if (item) rawChanges.push(item);
      }
    } else if (mode === 'commit') {
      const rev = options.revision || 'HEAD';
      // Use diff-tree to get exact changes introduced by commit
      // For root commit, --root is used
      let diffRaw;
      try {
        diffRaw = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', rev], {
          cwd: repoPath,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf-8'
        });
      } catch {
        // Fallback for commits without parent
        diffRaw = execFileSync('git', ['show', '--name-status', '--oneline', rev], {
          cwd: repoPath,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf-8'
        });
      }

      const lines = diffRaw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        const item = parseNameStatusLine(l);
        if (item) rawChanges.push(item);
      }
    } else if (mode === 'range') {
      const base = options.base || 'HEAD~1';
      const target = options.target || 'HEAD';
      const diffRaw = execFileSync('git', ['diff', '--name-status', '-M', base, target], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8'
      });
      const lines = diffRaw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        const item = parseNameStatusLine(l);
        if (item) rawChanges.push(item);
      }
    }
  } catch (err) {
    throw new Error(`Git change detection failed in mode "${mode}": ${err.message}`);
  }

  const mappingReport = mapGitChanges(rawChanges, pathIndex);

  // Keep changedFiles array of strings for 100% compatibility with frontend App.jsx
  const changedFiles = rawChanges.map(c => c.filePath).filter(Boolean);

  return {
    success: true,
    repoPath,
    mode,
    changedFiles,
    ...mappingReport
  };
}

// ── 6. Git Log Parser with Merge Commit & Status Awareness ──────────────────

/**
 * Extracts and parses historical commits from git log.
 *
 * Explicitly records:
 * - Merge commits (isMerge: true if parents > 1)
 * - Commits with no relevant Java changes
 * - Individual file change statuses (A, M, D, R, C)
 *
 * @param {string} repoPath
 * @param {number} commitLimit
 * @param {Object} options { components?: Array<Object>, includeMerges?: boolean }
 * @returns {Array<Object>}
 */
export function parseGitLogCommits(repoPath, commitLimit = 100, options = {}) {
  const args = [
    'log',
    `-n`, String(commitLimit),
    '--name-status',
    '-M', // detect renames
    '--pretty=format:COMMIT%x1f%H%x1f%ct%x1f%P%x1f%s'
  ];

  if (!options.includeMerges) {
    args.splice(3, 0, '--no-merges');
  }

  let rawLog;
  try {
    rawLog = execFileSync('git', args, {
      cwd: repoPath,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf-8'
    });
  } catch (err) {
    throw new Error(`Failed to extract git log: ${err.message}`);
  }

  const pathIndex = options.components ? buildComponentPathIndex(options.components) : null;
  const lines = rawLog.split('\n');
  const commits = [];
  let curCommit = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('COMMIT\x1f')) {
      const parts = line.split('\x1f');
      const hash = parts[1] || '';
      const timestamp = parseInt(parts[2], 10) || 0;
      const parentsStr = parts[3] || '';
      const subject = parts[4] || '';
      const parents = parentsStr.trim().split(/\s+/).filter(Boolean);
      const isMerge = parents.length > 1;

      curCommit = {
        hash,
        timestamp,
        parents,
        isMerge,
        subject,
        rawChanges: [],
        index: commits.length
      };
      commits.push(curCommit);
    } else if (curCommit) {
      const item = parseNameStatusLine(line);
      if (item) {
        curCommit.rawChanges.push(item);
      }
    }
  }

  // If pathIndex provided, map each commit's changes
  if (pathIndex) {
    for (const c of commits) {
      const report = mapGitChanges(c.rawChanges, pathIndex);
      c.mappingReport = report;
      c.mappedComponentIds = report.mappedComponentIds;
      c.unmappedFiles = report.unmapped;
      c.deletedFiles = report.deleted;
      c.renamedFiles = report.renamed;
      c.hasJavaChanges = (report.mapped.length > 0 || report.unmapped.length > 0);
    }
  }

  return commits;
}
