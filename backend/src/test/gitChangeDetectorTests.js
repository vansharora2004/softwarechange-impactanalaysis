/**
 * gitChangeDetectorTests.js
 * -------------------------
 * Phase 2 Automated Regression Test Suite.
 *
 * Verifies:
 *   1. Added and modified files mapping correctly.
 *   2. Deleted files reported as deletion events without being treated as current components.
 *   3. Renames preserving both paths and mapping correctly.
 *   4. Unmapped and ambiguous Java files being explicitly reported.
 *   5. Windows and Unix path normalization.
 *   6. Multiple classes in one Java file.
 *   7. Duplicate simple class names in different packages.
 *   8. Merge commits and commits with no relevant Java changes.
 *   9. No invalid component IDs introduced into evaluation cases.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  normalizePath,
  buildComponentPathIndex,
  parseNameStatusLine,
  parsePorcelainStatusLine,
  mapGitChanges,
  detectGitChanges,
  parseGitLogCommits
} from '../services/gitChangeDetector.js';
import { analyzeGitHistory } from '../services/gitHistoryAnalyzer.js';
import { buildRetrospectiveCasesV3 } from '../evaluation/v3/caseBuilderV3.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

function createTempGitRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-test-'));
  execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Phase2Tester'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'phase2@test.org'], { cwd: tmp, stdio: 'ignore' });
  return tmp;
}

console.log('\n=== Phase 2: Git Change Detection & Component Mapping Test Suite ===\n');

// ── Test 1: Added and modified files mapping correctly ────────────────────────
{
  console.log('Test 1: Added and modified files map correctly');
  const tmp = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'src/main/java/com/example'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/UserService.java'), 'package com.example; public class UserService {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial UserService'], { cwd: tmp, stdio: 'ignore' });

    // Modify UserService.java and add OrderService.java
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/UserService.java'), 'package com.example; public class UserService { int v = 2; }');
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/OrderService.java'), 'package com.example; public class OrderService {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'modify User and add Order'], { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.example.UserService', name: 'UserService', type: 'Service', filePath: 'src/main/java/com/example/UserService.java' },
      { id: 'com.example.OrderService', name: 'OrderService', type: 'Service', filePath: 'src/main/java/com/example/OrderService.java' }
    ];

    const report = detectGitChanges(tmp, { mode: 'commit', revision: 'HEAD' }, components);
    assertEqual(report.summary.mappedCount, 2, 'Exactly 2 files mapped in commit');
    const mod = report.mapped.find(m => m.mappedComponentId === 'com.example.UserService');
    const add = report.mapped.find(m => m.mappedComponentId === 'com.example.OrderService');

    assert(!!mod, 'UserService mapped');
    assertEqual(mod && mod.changeType, 'MODIFIED', 'UserService is MODIFIED');
    assert(!!add, 'OrderService mapped');
    assertEqual(add && add.changeType, 'ADDED', 'OrderService is ADDED');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Test 2: Deleted files reported as deletion events (not active components) ──
{
  console.log('\nTest 2: Deleted files reported as deletion events without active component mapping');
  const tmp = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'src/main/java/com/example'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/OldFile.java'), 'package com.example; public class OldFile {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add OldFile'], { cwd: tmp, stdio: 'ignore' });

    execFileSync('git', ['rm', 'src/main/java/com/example/OldFile.java'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'delete OldFile'], { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.example.OtherFile', name: 'OtherFile', type: 'Service', filePath: 'src/main/java/com/example/OtherFile.java' }
    ];

    const report = detectGitChanges(tmp, { mode: 'commit', revision: 'HEAD' }, components);
    assertEqual(report.summary.deletedCount, 1, 'Exactly 1 deleted file reported');
    assertEqual(report.summary.mappedCount, 0, 'Deleted file NOT counted as mapped component');
    const del = report.deleted[0];
    assert(del && del.changeType === 'DELETED', 'changeType is DELETED');
    assertEqual(del && del.mappedComponentId, null, 'mappedComponentId is strictly null');
    assert(del && del.reason.includes('deleted'), 'Reason explicitly mentions deletion');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Test 3: Renames preserving both paths and mapping correctly ────────────────
{
  console.log('\nTest 3: Renames preserve old/new paths and map to new component');
  const tmp = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'src/main/java/com/example'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/OldDao.java'), 'package com.example; public class OldDao {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial OldDao'], { cwd: tmp, stdio: 'ignore' });

    execFileSync('git', ['mv', 'src/main/java/com/example/OldDao.java', 'src/main/java/com/example/NewRepository.java'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'rename OldDao to NewRepository'], { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.example.NewRepository', name: 'NewRepository', type: 'Repository', filePath: 'src/main/java/com/example/NewRepository.java' }
    ];

    const report = detectGitChanges(tmp, { mode: 'commit', revision: 'HEAD' }, components);
    assertEqual(report.summary.renamedCount, 1, 'Exactly 1 renamed file recorded');
    const ren = report.renamed[0];
    assert(!!ren, 'Rename record exists');
    assertEqual(ren && ren.oldPath, 'src/main/java/com/example/OldDao.java', 'oldPath is preserved');
    assertEqual(ren && ren.newPath, 'src/main/java/com/example/NewRepository.java', 'newPath is preserved');
    assertEqual(ren && ren.mappedComponentId, 'com.example.NewRepository', 'mappedComponentId points to new component');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Test 4: Unmapped and ambiguous Java files explicitly reported ──────────────
{
  console.log('\nTest 4: Unmapped and ambiguous files explicitly reported');
  const components = [
    { id: 'com.example.Existing', name: 'Existing', type: 'Service', filePath: 'src/com/example/Existing.java' }
  ];
  const pathIndex = buildComponentPathIndex(components);

  // Unmapped test
  const unmappedRes = pathIndex.resolveFile('src/com/example/Ghost.java');
  assertEqual(unmappedRes.status, 'UNMAPPED', 'Ghost.java resolves to UNMAPPED');
  assert(unmappedRes.reason.includes('No component found'), 'Reason explains missing component');

  // Ambiguous test: two components with same file path
  const ambComponents = [
    { id: 'com.example.Foo', name: 'Foo', type: 'Service', filePath: 'src/Multi.java' },
    { id: 'com.example.Bar', name: 'Bar', type: 'Service', filePath: 'src/Multi.java' }
  ];
  const ambIndex = buildComponentPathIndex(ambComponents);
  const ambRes = ambIndex.resolveFile('src/Multi.java');
  assertEqual(ambRes.status, 'AMBIGUOUS', 'Multi.java with no primary name match resolves to AMBIGUOUS');
  assert(Array.isArray(ambRes.candidates) && ambRes.candidates.length === 2, 'Lists all candidate IDs');
}

// ── Test 5: Windows and Unix path normalization ───────────────────────────────
{
  console.log('\nTest 5: Windows and Unix path normalization');
  const winPath = 'src\\main\\java\\org\\samples\\Pet.java';
  const unixPath = 'src/main/java/org/samples/Pet.java';
  const messyPath = './src//main///java/org/samples/Pet.java';
  const quotedPath = '"src/main/java/org/samples/Pet.java"';

  const nWin = normalizePath(winPath);
  const nUnix = normalizePath(unixPath);
  const nMessy = normalizePath(messyPath);
  const nQuoted = normalizePath(quotedPath);

  assertEqual(nWin, 'src/main/java/org/samples/Pet.java', 'Windows backslashes normalized to forward slashes');
  assertEqual(nUnix, 'src/main/java/org/samples/Pet.java', 'Unix path clean');
  assertEqual(nMessy, 'src/main/java/org/samples/Pet.java', 'Redundant ./ and multiple slashes cleaned');
  assertEqual(nQuoted, 'src/main/java/org/samples/Pet.java', 'Surrounding quotes stripped');
}

// ── Test 6: Multiple classes in one Java file ─────────────────────────────────
{
  console.log('\nTest 6: Primary class resolution in multi-class Java file');
  const components = [
    { id: 'com.example.Order', name: 'Order', type: 'Entity/Model', filePath: 'src/com/example/Order.java' },
    { id: 'com.example.OrderItem', name: 'OrderItem', type: 'Entity/Model', filePath: 'src/com/example/Order.java' }
  ];
  const index = buildComponentPathIndex(components);
  const res = index.resolveFile('src/com/example/Order.java');

  assertEqual(res.status, 'MAPPED', 'File resolved to MAPPED');
  assertEqual(res.componentId, 'com.example.Order', 'Primary class matching filename selected as componentId');
  assertEqual(res.matchType, 'PRIMARY_CLASS_IN_MULTI_CLASS_FILE', 'matchType notes multi-class file');
}

// ── Test 7: Duplicate simple class names in different packages ────────────────
{
  console.log('\nTest 7: Duplicate simple class names in different packages map strictly to correct FQN');
  const components = [
    { id: 'com.pkgA.User', name: 'User', type: 'Entity/Model', filePath: 'src/main/java/com/pkgA/User.java' },
    { id: 'com.pkgB.User', name: 'User', type: 'Entity/Model', filePath: 'src/main/java/com/pkgB/User.java' }
  ];
  const index = buildComponentPathIndex(components);

  const resA = index.resolveFile('src/main/java/com/pkgA/User.java');
  const resB = index.resolveFile('src/main/java/com/pkgB/User.java');

  assertEqual(resA.componentId, 'com.pkgA.User', 'pkgA User maps to com.pkgA.User');
  assertEqual(resB.componentId, 'com.pkgB.User', 'pkgB User maps to com.pkgB.User');
  assert(resA.componentId !== resB.componentId, 'Identities are completely distinct');
}

// ── Test 8: Merge commits and commits with no relevant Java changes ───────────
{
  console.log('\nTest 8: Merge commits and commits with no relevant Java changes');
  const tmp = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'src/main/java/com/example'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/Base.java'), 'class Base {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'root commit'], { cwd: tmp, stdio: 'ignore' });

    // Branch 1
    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: tmp, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/Feature.java'), 'class Feature {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feature commit'], { cwd: tmp, stdio: 'ignore' });

    // Branch main
    execFileSync('git', ['checkout', 'master'], { cwd: tmp, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Docs only');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'docs only commit'], { cwd: tmp, stdio: 'ignore' });

    // Merge feature into master
    execFileSync('git', ['merge', 'feature', '--no-ff', '-m', 'Merge feature branch'], { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.example.Base', name: 'Base', type: 'Other', filePath: 'src/main/java/com/example/Base.java' },
      { id: 'com.example.Feature', name: 'Feature', type: 'Other', filePath: 'src/main/java/com/example/Feature.java' }
    ];

    const commits = parseGitLogCommits(tmp, 10, { components, includeMerges: true });
    const mergeCommit = commits.find(c => c.isMerge);
    assert(!!mergeCommit, 'Merge commit detected with isMerge: true');
    assert(mergeCommit && mergeCommit.parents.length >= 2, 'Merge commit has >= 2 parents');

    const docsCommit = commits.find(c => c.subject.includes('docs only'));
    assert(!!docsCommit, 'Docs commit found');
    assertEqual(docsCommit && docsCommit.hasJavaChanges, false, 'hasJavaChanges is false for docs commit');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Test 9: No invalid component IDs introduced into evaluation cases ─────────
{
  console.log('\nTest 9: No invalid or phantom component IDs introduced into LOO evaluation cases');
  const tmp = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'src/main/java/com/example'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/A.java'), 'package com.example; public class A {}');
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/B.java'), 'package com.example; public class B {}');
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/example/TestA.java'), 'package com.example; public class TestA {}');
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'multi-component commit'], { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.example.A', name: 'A', type: 'Service', filePath: 'src/main/java/com/example/A.java' },
      { id: 'com.example.B', name: 'B', type: 'Repository', filePath: 'src/main/java/com/example/B.java' },
      { id: 'com.example.TestA', name: 'TestA', type: 'Test', filePath: 'src/main/java/com/example/TestA.java' }
    ];
    const relationships = [];

    const { eligibleCommits, looCases } = buildRetrospectiveCasesV3(tmp, components, relationships, 5);
    assertEqual(eligibleCommits.length, 1, 'Exactly 1 eligible commit');
    assertEqual(looCases.length, 2, 'Exactly 2 LOO cases generated for 2 non-test components');

    const validIdSet = new Set(components.map(c => c.id));
    for (const c of looCases) {
      assert(validIdSet.has(c.inputComponent), `Input component ${c.inputComponent} is valid`);
      for (const t of c.retroOracle) {
        assert(validIdSet.has(t), `Oracle target ${t} is valid`);
      }
      for (const testT of c.retroTestOracle) {
        assert(validIdSet.has(testT), `Test target ${testT} is valid`);
      }
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n=== Phase 2 Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.error('\nFailed tests:');
  failures.forEach(f => console.error(' ✗', f));
  process.exit(1);
} else {
  console.log('All Phase 2 tests passed successfully.\n');
  process.exit(0);
}
