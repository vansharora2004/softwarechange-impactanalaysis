/**
 * caseBuilder.js
 * --------------
 * Builds reproducible evaluation cases from the git commit history
 * of the analysed repository (spring-petclinic-rest).
 *
 * GROUND-TRUTH CONSTRUCTION STRATEGY
 * ====================================
 * Ground truth is derived from the STATIC STRUCTURAL GRAPH stored in
 * analysis_output.json.  For each test case (one per eligible commit), the
 * changed components form the "input" and the structural 2-hop neighbourhood
 * of those components (via DEPENDS_ON / USES / TESTS) forms the "oracle".
 *
 * WHY STRUCTURAL, NOT CO-CHANGE?
 * --------------------------------
 * CO_CHANGED_WITH edges are a feature used by the proposed model, not the
 * evaluation label.  Using them as ground truth would make the evaluation
 * circular: the proposed model would trivially outscore the baseline because it
 * directly encodes the signal it is being tested on.  Structural adjacency
 * provides an independent oracle that neither model has direct access to as a
 * learnable feature.
 *
 * IMPORTANT LIMITATION
 * ---------------------
 * Historical co-change is a proxy for impact, not causal proof.  The structural
 * oracle is also imperfect: a component may be structurally adjacent yet
 * unaffected (e.g. backward-compatible change), or affected yet structurally
 * distant.  Metrics produced here reflect model recall of STRUCTURAL PROXIMITY,
 * not verified runtime failures or regression test outcomes.
 *
 * LEAKAGE PREVENTION
 * -------------------
 * For each test case derived from commit C_i (index i in the git log):
 *   - Historical co-change counts passed to the model are computed from
 *     commits at index i+1 … N (i.e., commits OLDER than C_i).
 *   - C_i itself and all newer commits (index 0 … i-1) are excluded.
 *   - This ensures the model never sees co-change evidence from the commit
 *     being evaluated or any later commit.
 *   - The static structural graph is held constant across all cases. This is
 *     a known approximation (the graph reflects the repo at analysis time, not
 *     at the exact commit timestamp) and is disclosed in the report.
 *
 * EXCLUSION RULES  (applied in order; each rule has a unique tag)
 * ================================================================
 * E1. MERGE COMMITS         : excluded at the git-log level via --no-merges.
 * E2. DEPENDENCY-ONLY       : commit's Java files count = 0 AND the change is
 *                             clearly a build-manifest-only bump (pom.xml, etc.).
 * E3. DOCUMENTATION-ONLY    : commit touches only .md / .txt / .yml / .sh /
 *                             .json / .properties / .gitignore — no .java.
 *                             (E2 and E3 share the same code path: "no Java".)
 * E4. GENERATED FILES       : .java files found, but all are under target/ or
 *                             build/, or match other generated-file patterns.
 *                             After filtering, zero eligible Java files remain.
 * E5. ZERO MAPPED COMPONENTS: eligible Java files found, but none matches a
 *                             component in analysis_output.json.  Cannot
 *                             construct a test case.
 * E6. EMPTY ORACLE          : the changed component(s) have no structural
 *                             neighbours in the graph (DEPENDS_ON / USES /
 *                             TESTS within 2 hops). Both engines would produce
 *                             zero candidates; precision/recall are undefined.
 * E7. TEST-ONLY CHANGE      : all changed components are of type 'Test'.
 *                             Impact analysis engines target production-code
 *                             changes; using test-only inputs tests an
 *                             out-of-scope scenario.
 *
 * NOTE ON SMALL SAMPLE SIZE
 * --------------------------
 * The spring-petclinic-rest repository has ~100 non-merge commits, of which
 * the majority are dependency bumps or CI/docs changes.  The eligible case
 * count is typically 6–12. This severely limits statistical power; results
 * should be treated as indicative and not statistically conclusive.
 */

'use strict';

import { execSync } from 'child_process';

// ── Patterns for generated / non-source files ──────────────────────────────
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

// ── Git log parsing ─────────────────────────────────────────────────────────
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

// ── File → component mapping ─────────────────────────────────────────────────
function mapFileToComponent(filePath, componentMap) {
  const norm = filePath.toLowerCase().replace(/\\/g, '/');
  for (const [id, comp] of componentMap) {
    const stored = comp.filePath.toLowerCase().replace(/\\/g, '/');
    if (stored === norm || stored.endsWith('/' + norm) || norm.endsWith('/' + stored)) return id;
  }
  return null;
}

// ── Static oracle (inline, no circular import) ───────────────────────────────
function buildStaticOracle(changedIds, components, relationships) {
  const STRUCT_RELS = new Set(['DEPENDS_ON', 'USES', 'TESTS']);
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
          const t = typeMap.get(nb) || 'Other';
          (t === 'Test' ? testOracle : mainOracle).add(nb);
        }
      }
    }
  }

  return { mainOracle, testOracle };
}

// ── Leak-free history counts ─────────────────────────────────────────────────
function buildLeakFreeHistoryCounts(allCommits, testIndex, componentMap) {
  // Use only commits OLDER than the test commit (higher index in newest-first list)
  const historicalCommits = allCommits.slice(testIndex + 1);
  const counts = new Map(); // "A|B" → count

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

  return counts; // Map<pairKey, count>
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Build all evaluation cases from the git history.
 *
 * @param {string}   repoPath
 * @param {Object[]} components    - from analysis_output.json
 * @param {Object[]} relationships - from analysis_output.json
 * @param {number}   commitLimit
 * @returns {{ cases, exclusions, totalCommitsInspected }}
 */
export function buildEvaluationCases(repoPath, components, relationships, commitLimit = 100) {
  const componentMap = new Map(components.map(c => [c.id, c]));

  const gitCmd = `git log --no-merges -n ${commitLimit} --name-only --pretty=format:"COMMIT|%H|%ct|%s"`;
  let rawLog;
  try {
    rawLog = execSync(gitCmd, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (err) {
    throw new Error(`git log failed: ${err.message}`);
  }

  const allCommits = parseGitLog(rawLog);
  const cases = [];
  const exclusions = [];

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const { hash, subject, files, timestamp } = commit;

    // E2 / E3 / E4 — no eligible Java source files
    const javaFiles = files.filter(f => isJavaFile(f) && !isGeneratedFile(f));
    if (javaFiles.length === 0) {
      const hasAnyJava = files.some(f => isJavaFile(f));
      exclusions.push({
        hash, subject, files,
        rule: hasAnyJava ? 'E4' : 'E2/E3',
        reason: hasAnyJava
          ? 'Java files present but all match generated-file patterns'
          : 'No Java source files (dependency / documentation / CI-only commit)'
      });
      continue;
    }

    // E5 — file-to-component mapping
    const changedIds = [];
    const unmapped = [];
    for (const f of javaFiles) {
      const id = mapFileToComponent(f, componentMap);
      if (id) changedIds.push(id);
      else unmapped.push(f);
    }
    const uniqueChangedIds = [...new Set(changedIds)];

    if (uniqueChangedIds.length === 0) {
      exclusions.push({
        hash, subject, files: javaFiles,
        rule: 'E5',
        reason: `${javaFiles.length} Java file(s) found but none map to known components. Unmapped: ${javaFiles.join('; ')}`
      });
      continue;
    }

    // E7 — test-only change
    const changedTypes = uniqueChangedIds.map(id => componentMap.get(id)?.type);
    if (changedTypes.every(t => t === 'Test')) {
      exclusions.push({
        hash, subject,
        rule: 'E7',
        reason: `All ${uniqueChangedIds.length} changed component(s) are of type Test — out of scope`
      });
      continue;
    }

    // E6 — empty oracle
    const { mainOracle, testOracle } = buildStaticOracle(uniqueChangedIds, components, relationships);
    if (mainOracle.size === 0 && testOracle.size === 0) {
      exclusions.push({
        hash, subject,
        rule: 'E6',
        reason: `Changed components (${uniqueChangedIds.join(', ')}) have no structural neighbours within 2 hops`
      });
      continue;
    }

    // Build leak-free historical co-change counts
    const historyCounts = buildLeakFreeHistoryCounts(allCommits, i, componentMap);

    cases.push({
      caseId: `case_${i}_${hash.slice(0, 7)}`,
      commitHash: hash,
      commitSubject: subject,
      commitTimestamp: timestamp,
      commitIndex: i,
      changedIds: uniqueChangedIds,
      unmappedFiles: unmapped,
      javaFilesInCommit: javaFiles,
      mainOracle,       // Set<string>
      testOracle,       // Set<string>
      historyCounts,    // Map<pairKey, count> — leak-free
    });
  }

  return { cases, exclusions, totalCommitsInspected: allCommits.length };
}
