/**
 * caseBuilderV2.js
 * ----------------
 * Corrected case builder for V2 evaluation harness.
 *
 * Changes from V1:
 *   1. Deduplication: cases with identical changedIds sets are merged;
 *      only the earliest (oldest) commit is kept for evaluation.
 *   2. Retrospective evaluation: commits with ≥2 non-Test mapped components
 *      produce additional retro cases where the first component is the input
 *      and the rest are the observed co-change targets (independent oracle).
 *
 * Exclusion rules are inherited from V1 (E1–E7) with one addition:
 *   E8. INSUFFICIENT FOR SPLIT: commit has ≥1 non-Test mapped component but
 *       only 1 total (cannot split into input + target for retrospective).
 *       Such commits produce a structural BFS case but NO retrospective case.
 *
 * Leakage prevention (unchanged from V1):
 *   - Historical co-change counts for case at index i use only commits at
 *     index > i (older commits in newest-first git log order).
 *   - Retrospective target components are never used as model input.
 *   - Retrospective target components are NOT included in historical counts
 *     for that case (the commit itself is already excluded by slice(i+1)).
 */

'use strict';

import { execSync } from 'child_process';
import { splitRetrospectiveCase } from './metricsV2.js';

const GENERATED_PATH_PATTERNS = [
  /^target\//,
  /^build\//,
  /\.postman_collection\.json$/i,
  /\.postman_environment\.json$/i,
  /\.jmx$/i,
  /openapi\.yml$/i,
];

function isJavaFile(f) { return f.endsWith('.java'); }
function isGeneratedFile(f) { return GENERATED_PATH_PATTERNS.some(p => p.test(f)); }

function parseGitLog(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const commits = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('COMMIT|')) {
      const parts = line.split('|');
      cur = { hash: parts[1], timestamp: parseInt(parts[2], 10), subject: parts.slice(3).join('|'), files: [] };
      commits.push(cur);
    } else if (cur) {
      cur.files.push(line.replace(/\\\\/g, '/'));
    }
  }
  return commits; // newest-first
}

function mapFileToComponent(filePath, componentMap) {
  const norm = filePath.toLowerCase().replace(/\\/g, '/');
  for (const [id, comp] of componentMap) {
    const stored = comp.filePath.toLowerCase().replace(/\\/g, '/');
    if (stored === norm || stored.endsWith('/' + norm) || norm.endsWith('/' + stored)) return id;
  }
  return null;
}

// V2 static oracle (EXTENDS included) — inline to avoid circular import
function buildStaticOracleV2(changedIds, components, relationships) {
  const STRUCT_RELS = new Set(['DEPENDS_ON', 'USES', 'TESTS', 'EXTENDS']);
  const changedSet = new Set(changedIds);
  const typeMap = new Map(components.map(c => [c.id, c.type]));

  const adj = new Map();
  for (const r of relationships) {
    if (!STRUCT_RELS.has(r.type)) continue;
    if (!adj.has(r.source)) adj.set(r.source, []);
    if (!adj.has(r.target)) adj.set(r.target, []);
    adj.get(r.source).push(r.target);
    adj.get(r.target).push(r.source);
  }

  const mainOracle = new Set();
  const testOracle = new Set();
  for (const start of changedIds) {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const d = dist.get(cur);
      if (d >= 2) continue;
      for (const nb of (adj.get(cur) || [])) {
        if (dist.has(nb)) continue;
        dist.set(nb, d + 1);
        queue.push(nb);
        if (!changedSet.has(nb)) {
          (typeMap.get(nb) === 'Test' ? testOracle : mainOracle).add(nb);
        }
      }
    }
  }
  return { mainOracle, testOracle };
}

function buildLeakFreeHistoryCounts(allCommits, testIndex, componentMap) {
  const historicalCommits = allCommits.slice(testIndex + 1);
  const counts = new Map();
  for (const commit of historicalCommits) {
    const javaFiles = commit.files.filter(f => isJavaFile(f) && !isGeneratedFile(f));
    const ids = new Set();
    for (const f of javaFiles) {
      const id = mapFileToComponent(f, componentMap);
      if (id) ids.add(id);
    }
    const arr = Array.from(ids);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        let a = arr[i], b = arr[j];
        if (a > b) { const t = a; a = b; b = t; }
        const key = `${a}|${b}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Build evaluation cases.
 *
 * Returns two lists:
 *   structuralCases  – BFS-oracle cases (same as V1 but deduplicated, EXTENDS included)
 *   retroCases       – retrospective co-change-oracle cases
 *
 * @returns {{ structuralCases, retroCases, exclusions, totalCommitsInspected }}
 */
export function buildEvaluationCasesV2(repoPath, components, relationships, commitLimit = 100) {
  const componentMap = new Map(components.map(c => [c.id, c]));
  const gitCmd = `git log --no-merges -n ${commitLimit} --name-only --pretty=format:"COMMIT|%H|%ct|%s"`;
  let rawLog;
  try {
    rawLog = execSync(gitCmd, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (err) {
    throw new Error(`git log failed: ${err.message}`);
  }

  const allCommits = parseGitLog(rawLog);
  const rawCases = [];        // before deduplication
  const exclusions = [];

  for (let i = 0; i < allCommits.length; i++) {
    const { hash, subject, files, timestamp } = allCommits[i];
    const javaFiles = files.filter(f => isJavaFile(f) && !isGeneratedFile(f));

    if (javaFiles.length === 0) {
      exclusions.push({ hash, subject, rule: 'E2/E3', reason: 'No Java source files' });
      continue;
    }

    const changedIds = [];
    const unmapped = [];
    for (const f of javaFiles) {
      const id = mapFileToComponent(f, componentMap);
      if (id) changedIds.push(id);
      else unmapped.push(f);
    }
    const uniqueChangedIds = [...new Set(changedIds)];

    if (uniqueChangedIds.length === 0) {
      exclusions.push({ hash, subject, rule: 'E5', reason: `No mapped components. Files: ${javaFiles.join('; ')}` });
      continue;
    }

    const changedTypes = uniqueChangedIds.map(id => componentMap.get(id)?.type);
    if (changedTypes.every(t => t === 'Test')) {
      exclusions.push({ hash, subject, rule: 'E7', reason: 'All changed components are Test type' });
      continue;
    }

    const { mainOracle, testOracle } = buildStaticOracleV2(uniqueChangedIds, components, relationships);
    if (mainOracle.size === 0 && testOracle.size === 0) {
      exclusions.push({ hash, subject, rule: 'E6', reason: 'Empty oracle (no structural neighbours)' });
      continue;
    }

    const historyCounts = buildLeakFreeHistoryCounts(allCommits, i, componentMap);
    rawCases.push({
      caseId: `case_${i}_${hash.slice(0, 7)}`,
      commitHash: hash, commitSubject: subject, commitTimestamp: timestamp, commitIndex: i,
      changedIds: uniqueChangedIds,
      unmappedFiles: unmapped,
      javaFilesInCommit: javaFiles,
      mainOracle, testOracle, historyCounts,
    });
  }

  // ── Deduplication by changedIds set ────────────────────────────────────────
  // Among cases with identical changedIds sets, keep only the OLDEST commit
  // (highest index in newest-first list = smallest timestamp = earliest).
  const seenKeys = new Map(); // canonicalKey → case index in rawCases
  const deduplication = [];

  for (let i = 0; i < rawCases.length; i++) {
    const c = rawCases[i];
    const key = [...c.changedIds].sort().join('|');
    if (!seenKeys.has(key)) {
      seenKeys.set(key, i);
    } else {
      const existing = rawCases[seenKeys.get(key)];
      // Keep the one with the higher commitIndex (older commit, lower timestamp)
      if (c.commitIndex > existing.commitIndex) {
        deduplication.push({ removed: existing.caseId, kept: c.caseId, reason: `Duplicate changedIds — keeping oldest commit (${c.commitHash.slice(0,7)})` });
        seenKeys.set(key, i);
      } else {
        deduplication.push({ removed: c.caseId, kept: existing.caseId, reason: `Duplicate changedIds — kept older commit (${existing.commitHash.slice(0,7)})` });
      }
    }
  }

  const keptIndices = new Set(seenKeys.values());
  const structuralCases = rawCases.filter((_, i) => keptIndices.has(i));

  // ── Retrospective cases ────────────────────────────────────────────────────
  // From deduplicated cases that have ≥2 non-Test mapped components.
  const retroCases = [];
  for (const sc of structuralCases) {
    const nonTestIds = sc.changedIds.filter(id => componentMap.get(id)?.type !== 'Test');
    const split = splitRetrospectiveCase(nonTestIds);
    if (!split) {
      // E8: only 1 non-Test component → structural case valid, no retro case
      continue;
    }

    // Leak check: inputIds and targetIds must be disjoint
    const inputSet = new Set(split.inputIds);
    const targetSet = new Set(split.targetIds);
    const overlap = [...inputSet].filter(id => targetSet.has(id));
    if (overlap.length > 0) {
      exclusions.push({ hash: sc.commitHash, subject: sc.commitSubject, rule: 'E8-LEAK',
        reason: `Retrospective split leakage: ${overlap.join(', ')} in both input and target` });
      continue;
    }

    // Retrospective oracle: target components that are NOT of type Test
    const retroOracle = new Set(split.targetIds.filter(id => componentMap.get(id)?.type !== 'Test'));
    const retroTestOracle = new Set(split.targetIds.filter(id => componentMap.get(id)?.type === 'Test'));

    if (retroOracle.size === 0 && retroTestOracle.size === 0) continue;

    retroCases.push({
      caseId: `retro_${sc.commitIndex}_${sc.commitHash.slice(0, 7)}`,
      sourceStructuralCaseId: sc.caseId,
      commitHash: sc.commitHash,
      commitSubject: sc.commitSubject,
      commitTimestamp: sc.commitTimestamp,
      changedIds: split.inputIds,           // model input: only the "input" component
      heldOutIds: split.targetIds,          // held-out from model input
      retroOracle,                          // non-Test held-out components
      retroTestOracle,                      // Test held-out components
      historyCounts: sc.historyCounts,      // same leak-free history
      limitation: 'Co-change is a proxy for impact, not causal proof. ' +
        'Components changed in the same commit may share a commit for non-functional reasons (refactoring, formatting).',
    });
  }

  return {
    structuralCases,
    retroCases,
    exclusions,
    deduplication,
    totalCommitsInspected: allCommits.length,
    rawCaseCount: rawCases.length,
  };
}
