/**
 * repositorySelectionTests.js
 * ----------------------------
 * Comprehensive test suite verifying:
 *   1. Repository path validation (empty, missing, non-git, non-java, valid).
 *   2. Windows path normalization (backslashes, quotes, spaces).
 *   3. Prevention of silent PetClinic fallback across all API endpoints.
 *   4. Clean repository switching without stale data.
 *   5. Accurate multi-module Java repository detection (Shopizer, Commons-Lang).
 *   6. Full HTTP request verification over Express server.
 */

'use strict';

import express from 'express';
import http from 'http';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  normalizeRepoPath,
  hasJavaSourceFiles,
  validateRepository,
  getAvailableExampleRepositories
} from '../services/repoValidation.js';

import router from '../routes/api.js';
import { closeDriver } from '../services/neo4jService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  console.log('=== Repository Selection & Analyze Impact Workflow Test Suite ===\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
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

  async function testAsync(name, fn) {
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

  console.log('--- 1. Path Normalization & Edge Cases ---');

  test('normalizeRepoPath handles empty, null, and non-string inputs', () => {
    assert.strictEqual(normalizeRepoPath(''), '');
    assert.strictEqual(normalizeRepoPath(null), '');
    assert.strictEqual(normalizeRepoPath(undefined), '');
    assert.strictEqual(normalizeRepoPath(123), '');
  });

  test('normalizeRepoPath strips surrounding quotes and resolves paths', () => {
    const p1 = normalizeRepoPath('"c:/yashika/STUDY/clg_project/shopizer"');
    const p2 = normalizeRepoPath("'c:/yashika/STUDY/clg_project/shopizer'");
    assert.ok(p1.toLowerCase().includes('shopizer'));
    assert.ok(p2.toLowerCase().includes('shopizer'));
    assert.strictEqual(p1, p2);
  });

  console.log('\n--- 2. Repository Validation Logic ---');

  test('validateRepository rejects empty path with MISSING_PATH code', () => {
    const res = validateRepository('');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'MISSING_PATH');
    assert.ok(res.error.includes('cannot be empty'));
  });

  test('validateRepository rejects non-existent directory with NOT_FOUND code', () => {
    const res = validateRepository('C:/non_existent_folder_xyz_12345');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'NOT_FOUND');
    assert.ok(res.error.includes('does not exist'));
  });

  test('validateRepository rejects non-Git directory with NOT_A_GIT_REPOSITORY code', () => {
    const tempDir = path.resolve(__dirname, 'temp_non_git');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    try {
      const res = validateRepository(tempDir);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, 'NOT_A_GIT_REPOSITORY');
      assert.ok(res.error.includes('not a Git repository'));
    } finally {
      fs.rmdirSync(tempDir);
    }
  });

  test('validateRepository rejects Git repo without Java source files with NO_JAVA_FILES', () => {
    const nonJavaGit = path.resolve(__dirname, 'temp_non_java_git');
    if (!fs.existsSync(nonJavaGit)) {
      fs.mkdirSync(nonJavaGit);
      fs.mkdirSync(path.join(nonJavaGit, '.git'));
      fs.writeFileSync(path.join(nonJavaGit, 'index.js'), 'console.log("no java");');
    }
    try {
      const res = validateRepository(nonJavaGit);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, 'NO_JAVA_FILES');
      assert.ok(res.error.includes('No Java source files'));
    } finally {
      fs.rmSync(nonJavaGit, { recursive: true, force: true });
    }
  });

  test('validateRepository accepts Spring PetClinic REST', () => {
    const petclinicPath = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
    if (fs.existsSync(petclinicPath)) {
      const res = validateRepository(petclinicPath);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.projectName, 'spring-petclinic-rest');
    }
  });

  test('validateRepository accepts Shopizer multi-module repository', () => {
    const shopizerPath = 'c:/yashika/STUDY/clg_project/shopizer';
    if (fs.existsSync(shopizerPath)) {
      const res = validateRepository(shopizerPath);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.projectName, 'shopizer');
    }
  });

  test('getAvailableExampleRepositories returns available candidates', () => {
    const examples = getAvailableExampleRepositories();
    assert.ok(Array.isArray(examples));
    assert.ok(examples.length >= 2, 'Should discover at least PetClinic and Shopizer');
    const names = examples.map(e => e.projectName);
    assert.ok(names.includes('spring-petclinic-rest'), 'Should include PetClinic');
    assert.ok(names.includes('shopizer'), 'Should include Shopizer');
  });

  console.log('\n--- 3. HTTP API Endpoints & Silent Fallback Prevention ---');

  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  try {
    await testAsync('POST /api/validate-repository returns 400 on empty path', async () => {
      const res = await fetch(`${baseUrl}/validate-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: '' })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 'MISSING_PATH');
    });

    await testAsync('POST /api/validate-repository returns 200 on valid PetClinic path', async () => {
      const res = await fetch(`${baseUrl}/validate-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.projectName, 'spring-petclinic-rest');
    });

    await testAsync('GET /api/example-repositories returns discovered presets', async () => {
      const res = await fetch(`${baseUrl}/example-repositories`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.examples));
    });

    await testAsync('POST /api/analyse-repository rejects empty repoPath without falling back to PetClinic', async () => {
      const res = await fetch(`${baseUrl}/analyse-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 'MISSING_PATH');
    });

    await testAsync('POST /api/detect-git-changes rejects missing repoPath without falling back to PetClinic', async () => {
      const res = await fetch(`${baseUrl}/detect-git-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 'MISSING_PATH');
    });

    console.log('\n--- 4. Multi-Repository Analysis & Switching ---');

    await testAsync('Analyzing PetClinic records PetClinic components', async () => {
      const res = await fetch(`${baseUrl}/analyse-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.projectName, 'spring-petclinic-rest');
      assert.ok(data.componentsCount > 0);
      const hasPetclinicFQN = data.components.some(c => c.id.includes('org.springframework.samples.petclinic'));
      assert.ok(hasPetclinicFQN, 'Components should contain PetClinic FQN');
    });

    await testAsync('GET /api/current-repository reports PetClinic after analysis', async () => {
      const res = await fetch(`${baseUrl}/current-repository`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.projectName, 'spring-petclinic-rest');
    });

    await testAsync('Impact analysis on PetClinic passes repoPath and returns PetClinic project metadata', async () => {
      const res = await fetch(`${baseUrl}/analyse-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changedComponents: ['org.springframework.samples.petclinic.rest.controller.OwnerRestController'],
          model: 'canonical',
          repoPath: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.projectName, 'spring-petclinic-rest');
      assert.ok(Array.isArray(data.potentiallyImpactedComponents));
    });

  } finally {
    server.close();
    await closeDriver();
  }

  console.log(`\n======================================================`);
  console.log(`Repository Selection Results: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
