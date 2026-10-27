/**
 * historicalGraphTests.js
 * -----------------------
 * Verification test suite for historical knowledge graph reconstruction and temporal leakage prevention.
 *
 * Verifies:
 *   1. A component introduced after the target commit must not appear in the target's historical graph.
 *   2. A relationship introduced after the target commit must not appear in that graph.
 *   3. The evaluated commit must not contribute to its own co-change evidence.
 *   4. Future commits must not contribute to historical ranking evidence.
 *   5. The baseline and reranker use the same historical graph and candidate set.
 *   6. A failed historical checkout cannot silently trigger a current-HEAD fallback.
 *   7. Repeated cases using the same parent revision can reuse a valid cached graph.
 *   8. A change to the analyzer configuration invalidates an incompatible cached graph.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  getParentRevision,
  getOrBuildHistoricalGraph,
  clearHistoricalGraphCache,
  ANALYZER_CONFIG_VERSION
} from '../services/historicalGraphService.js';
import {
  generateStructuralCandidatesInMemory,
  rerankCandidatesWithHistory
} from '../services/structuralHistoryReranker.js';
import { buildHistoricalCases } from '../evaluation/v4/historicalCaseBuilder.js';

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Synthetic Repository Fixture Helper ─────────────────────────────────────

function createSyntheticGitRepo() {
  const repoDir = path.join(os.tmpdir(), `test_repo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(repoDir, { recursive: true });

  const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8', stdio: 'pipe' });

  git(['init']);
  git(['config', 'user.name', 'Test Author']);
  git(['config', 'user.email', 'test@example.com']);

  // Commit 1: Initial state with ServiceA and RepositoryA
  const srcDir = path.join(repoDir, 'src', 'main', 'java', 'com', 'example');
  fs.mkdirSync(srcDir, { recursive: true });

  fs.writeFileSync(path.join(srcDir, 'RepositoryA.java'), `
    package com.example;
    public interface RepositoryA {}
  `);
  fs.writeFileSync(path.join(srcDir, 'ServiceA.java'), `
    package com.example;
    import com.example.RepositoryA;
    public class ServiceA {
      private RepositoryA repoA;
    }
  `);

  git(['add', '.']);
  git(['commit', '-m', 'Commit 1: Add ServiceA and RepositoryA']);
  const commit1Sha = git(['rev-parse', 'HEAD']).trim();

  // Commit 2: Modifies ServiceA and RepositoryA (target commit for evaluation)
  fs.writeFileSync(path.join(srcDir, 'RepositoryA.java'), `
    package com.example;
    public interface RepositoryA { void find(); }
  `);
  fs.writeFileSync(path.join(srcDir, 'ServiceA.java'), `
    package com.example;
    import com.example.RepositoryA;
    public class ServiceA {
      private RepositoryA repoA;
      public void execute() { repoA.find(); }
    }
  `);
  git(['add', '.']);
  git(['commit', '-m', 'Commit 2: Modify ServiceA and RepositoryA']);
  const commit2Sha = git(['rev-parse', 'HEAD']).trim();

  // Commit 3: Future commit introducing ServiceB and relationship ServiceB -> ServiceA
  fs.writeFileSync(path.join(srcDir, 'ServiceB.java'), `
    package com.example;
    import com.example.ServiceA;
    public class ServiceB {
      private ServiceA serviceA;
    }
  `);
  git(['add', '.']);
  git(['commit', '-m', 'Commit 3: Add ServiceB depending on ServiceA']);
  const commit3Sha = git(['rev-parse', 'HEAD']).trim();

  // Commit 4: Future commit introducing ServiceC
  fs.writeFileSync(path.join(srcDir, 'ServiceC.java'), `
    package com.example;
    public class ServiceC {}
  `);
  git(['add', '.']);
  git(['commit', '-m', 'Commit 4: Add ServiceC']);
  const commit4Sha = git(['rev-parse', 'HEAD']).trim();

  return {
    repoDir,
    commit1Sha,
    commit2Sha,
    commit3Sha,
    commit4Sha,
    cleanup: () => {
      try {
        fs.rmSync(repoDir, { recursive: true, force: true });
      } catch {}
    }
  };
}

console.log('Running Historical Knowledge Graph & Leakage Prevention Test Suite...\n');

// ── Test Execution ──────────────────────────────────────────────────────────

async function runTests() {
  const syn = createSyntheticGitRepo();
  const testCacheDir = path.join(os.tmpdir(), `test_cache_${Date.now()}`);

  try {
    // Situation 1: Component introduced after target commit must not appear in target's graph
    it('1. Component introduced after target commit (ServiceB in Commit 3) must NOT appear in Commit 2 pre-change graph', () => {
      const { graph } = getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, { cacheDir: testCacheDir });
      const compIds = graph.components.map(c => c.id);

      assert(compIds.includes('com.example.ServiceA'), 'ServiceA must be present');
      assert(compIds.includes('com.example.RepositoryA'), 'RepositoryA must be present');
      assert(!compIds.includes('com.example.ServiceB'), 'ServiceB was added in Commit 3; must NOT appear in Commit 2 pre-change graph');
      assert(!compIds.includes('com.example.ServiceC'), 'ServiceC was added in Commit 4; must NOT appear in Commit 2 pre-change graph');
    });

    // Situation 2: Relationship introduced after target commit must not appear in that graph
    it('2. Relationship introduced after target commit (ServiceB -> ServiceA) must NOT appear in Commit 2 pre-change graph', () => {
      const { graph } = getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, { cacheDir: testCacheDir });
      const hasServiceBRel = graph.relationships.some(
        r => r.source === 'com.example.ServiceB' || r.target === 'com.example.ServiceB'
      );
      assert.strictEqual(hasServiceBRel, false, 'No relationships involving ServiceB should exist in Commit 2 pre-change graph');
    });

    // Situation 3: Evaluated commit must not contribute to its own co-change evidence
    await itAsync('3. Evaluated commit must NOT contribute to its own historical co-change evidence', async () => {
      const { eligibleCommits, looCases } = await buildHistoricalCases(syn.repoDir, 10, { cacheDir: testCacheDir });
      const commit2Cases = looCases.filter(c => c.commitHash === syn.commit2Sha);

      assert(commit2Cases.length > 0, 'Commit 2 must have LOO cases');
      for (const c of commit2Cases) {
        const key = 'com.example.RepositoryA|com.example.ServiceA';
        const count = c.historyCounts.get(key) || 0;
        assert.strictEqual(count, 1, `History count must be 1 (from commit 1 only), found: ${count}`);
      }
    });

    // Situation 4: Future commits must not contribute to historical ranking evidence
    await itAsync('4. Future commits (Commit 3 and 4) must NOT contribute to historical ranking evidence for Commit 2', async () => {
      const { looCases } = await buildHistoricalCases(syn.repoDir, 10, { cacheDir: testCacheDir });
      const commit2Case = looCases.find(c => c.commitHash === syn.commit2Sha);

      assert(commit2Case, 'Commit 2 case exists');
      for (const [key] of commit2Case.historyCounts.entries()) {
        assert(!key.includes('ServiceB'), `Future component ServiceB leaked into historyCounts: ${key}`);
        assert(!key.includes('ServiceC'), `Future component ServiceC leaked into historyCounts: ${key}`);
      }
    });

    // Situation 5: The baseline and reranker use the same historical graph and candidate set
    it('5. Baseline and proposed reranker use the exact same historical graph and candidate set', () => {
      const { graph } = getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, { cacheDir: testCacheDir });
      const changedIds = ['com.example.ServiceA'];

      const baselineCands = generateStructuralCandidatesInMemory(changedIds, graph, 2);
      const historyCounts = new Map([['com.example.RepositoryA|com.example.ServiceA', 3]]);
      const rerankedCands = rerankCandidatesWithHistory(baselineCands, changedIds, historyCounts);

      assert.strictEqual(baselineCands.length, rerankedCands.length, 'Candidate counts must match exactly');
      const baseIds = baselineCands.map(c => c.id).sort();
      const rerankIds = rerankedCands.map(c => c.id).sort();
      assert.deepStrictEqual(baseIds, rerankIds, 'Candidate IDs must be identical sets');
    });

    // Situation 6: Failed historical checkout cannot silently trigger a current-HEAD fallback
    it('6. Failed historical checkout throws an error and NEVER silently falls back to current HEAD', () => {
      assert.throws(
        () => {
          getOrBuildHistoricalGraph(syn.repoDir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', { cacheDir: testCacheDir });
        },
        (err) => {
          return err.message.includes('HistoricalGraphService') && !err.message.includes('HEAD');
        },
        'Non-existent commit must throw explicit error'
      );
    });

    // Situation 7: Repeated cases using the same parent revision can reuse a valid cached graph
    it('7. Repeated cases using the same parent revision reuse the cached graph', () => {
      const call1 = getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, { cacheDir: testCacheDir });
      const call2 = getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, { cacheDir: testCacheDir });

      assert.strictEqual(call2.fromCache, true, 'Second call must return fromCache = true');
      assert.strictEqual(call1.graph.components.length, call2.graph.components.length, 'Cached components count must match');
      assert.strictEqual(call1.parentSha, call2.parentSha, 'Parent SHA must match');
    });

    // Situation 8: A change to analyzer configuration invalidates an incompatible cached graph
    it('8. Changing analyzer configuration version invalidates incompatible cached graph', () => {
      getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, {
        cacheDir: testCacheDir,
        analyzerVersion: 'v1_initial'
      });

      const v2Call = getOrBuildHistoricalGraph(syn.repoDir, syn.commit2Sha, {
        cacheDir: testCacheDir,
        analyzerVersion: 'v2_updated'
      });

      assert.strictEqual(v2Call.fromCache, false, 'Changed version must invalidate cache and rebuild');
      assert.strictEqual(v2Call.metadata.analyzerVersion, 'v2_updated', 'Metadata must reflect new version');
    });

    // Real Repository Verification (Spring PetClinic)
    it('9. Real Repository Verification: PetClinic parent a3884f74 has 104 components (excludes later additions)', () => {
      const petRepo = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
      const petCommit = '28a1c2cec5c0de5ed17d4e7cd5989f447c13920a';
      const { graph, parentSha } = getOrBuildHistoricalGraph(petRepo, petCommit, { cacheDir: testCacheDir });

      assert.strictEqual(parentSha, 'a3884f741dd751b32d649a96974fc78339b8d027');
      assert.strictEqual(graph.components.length, 104, `PetClinic at parent a3884f74 must have 104 components, got ${graph.components.length}`);
      assert.strictEqual(graph.relationships.length, 257, `PetClinic at parent a3884f74 must have 257 relationships, got ${graph.relationships.length}`);
    });

  } finally {
    syn.cleanup();
    clearHistoricalGraphCache(testCacheDir);
    try { fs.rmSync(testCacheDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\nHistorical Graph Test Suite Complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
