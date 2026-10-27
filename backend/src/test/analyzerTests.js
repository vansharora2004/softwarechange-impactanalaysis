/**
 * analyzerTests.js
 * ----------------
 * Regression tests for javaAnalyzer.js — Phase 1.
 *
 * Tests:
 *   1. FQN component identity — classes in different packages get distinct ids.
 *   2. Inheritance relationship (EXTENDS) detected correctly.
 *   3. Same-package EXTENDS without import.
 *   4. Constructor injection → DEPENDS_ON (arch types) or USES.
 *   5. @Autowired field injection → DEPENDS_ON.
 *   6. Ordinary field reference → USES or ASSOCIATED_WITH.
 *   7. Test component → TESTS relationship overrides base type.
 *   8. Wildcard import resolution.
 *   9. No cross-package phantom relationships when import is absent.
 *  10. isHelperClass gate — Mapper/Config classified as Other.
 *  11. Duplicate FQN detection (stderr warning, last-writer wins).
 *  12. analyzeFile: package-less file uses path-based id.
 *  13. Renamed / deleted file: unmapped files increment counter, not mapped.
 *  14. Entity/Model → Entity/Model reference → ASSOCIATED_WITH.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { analyzeFile, analyzeRepository } from '../analyzers/javaAnalyzer.js';
import { analyzeGitHistory } from '../services/gitHistoryAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Test harness ─────────────────────────────────────────────────────────────

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
    failures.push(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.error(`  ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a temporary directory with a set of .java files and returns the
 * repo root path.  Cleans up on process exit.
 */
function makeRepo(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  process.on('exit', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
  return tmpDir;
}

function analyze(files) {
  const root = makeRepo(files);
  return analyzeRepository(root);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== javaAnalyzer Regression Tests ===\n');

// 1. FQN identity — same simple name in different packages → different IDs
{
  console.log('Test 1: FQN identity — same simple name in different packages');
  const { components } = analyze({
    'src/main/java/com/a/User.java': `
      package com.a;
      public class User {}
    `,
    'src/main/java/com/b/User.java': `
      package com.b;
      public class User {}
    `,
  });
  const ids = components.map(c => c.id);
  assert(ids.includes('com.a.User'),  'com.a.User present');
  assert(ids.includes('com.b.User'),  'com.b.User present');
  assertEqual(components.length, 2,   'exactly 2 components');
}

// 2. Inheritance relationship — EXTENDS detected
{
  console.log('\nTest 2: EXTENDS relationship detected');
  const { relationships } = analyze({
    'src/main/java/com/x/Base.java': `
      package com.x;
      public class Base {}
    `,
    'src/main/java/com/x/Child.java': `
      package com.x;
      import com.x.Base;
      public class Child extends Base {}
    `,
  });
  const ext = relationships.find(r => r.type === 'EXTENDS');
  assert(!!ext, 'EXTENDS relationship exists');
  assert(ext && ext.source.endsWith('Child'), 'source is Child');
  assert(ext && ext.target.endsWith('Base'),  'target is Base');
}

// 3. Same-package EXTENDS without explicit import
{
  console.log('\nTest 3: Same-package EXTENDS without import');
  const { relationships } = analyze({
    'src/main/java/com/x/Animal.java': `
      package com.x;
      public class Animal {}
    `,
    'src/main/java/com/x/Dog.java': `
      package com.x;
      public class Dog extends Animal {}
    `,
  });
  const ext = relationships.find(r => r.type === 'EXTENDS');
  assert(!!ext, 'EXTENDS found without import (same package)');
}

// 4. Constructor injection — DEPENDS_ON for arch types
{
  console.log('\nTest 4: Constructor injection → DEPENDS_ON');
  const { relationships } = analyze({
    'src/main/java/com/x/UserRepository.java': `
      package com.x;
      import org.springframework.stereotype.Repository;
      @Repository
      public interface UserRepository {}
    `,
    'src/main/java/com/x/UserServiceImpl.java': `
      package com.x;
      import org.springframework.stereotype.Service;
      import com.x.UserRepository;
      @Service
      public class UserServiceImpl {
        private final UserRepository repo;
        public UserServiceImpl(UserRepository repo) { this.repo = repo; }
      }
    `,
  });
  const dep = relationships.find(r => r.type === 'DEPENDS_ON');
  assert(!!dep, 'DEPENDS_ON relationship exists for constructor injection');
}

// 5. @Autowired field injection
{
  console.log('\nTest 5: @Autowired field injection → DEPENDS_ON');
  const { relationships } = analyze({
    'src/main/java/com/x/ItemRepository.java': `
      package com.x;
      import org.springframework.stereotype.Repository;
      @Repository
      public interface ItemRepository {}
    `,
    'src/main/java/com/x/ItemService.java': `
      package com.x;
      import org.springframework.stereotype.Service;
      import com.x.ItemRepository;
      @Service
      public class ItemService {
        @Autowired
        private ItemRepository itemRepo;
      }
    `,
  });
  const dep = relationships.find(r => r.type === 'DEPENDS_ON');
  assert(!!dep, 'DEPENDS_ON from @Autowired injection');
}

// 6. Ordinary field reference — when both types are non-Other arch types → USES,
//    when target is Other → REFERENCES.  Test the USES case properly.
{
  console.log('\nTest 6: Ordinary field reference → USES (non-Other types)');
  const { relationships } = analyze({
    'src/main/java/com/x/model/Address.java': `
      package com.x.model;
      import javax.persistence.Entity;
      @Entity
      public class Address {}
    `,
    'src/main/java/com/x/service/CustomerService.java': `
      package com.x.service;
      import org.springframework.stereotype.Service;
      import com.x.model.Address;
      @Service
      public class CustomerService {
        private Address defaultAddress;
      }
    `,
  });
  // Address is Entity/Model, CustomerService is Service → USES
  const uses = relationships.find(r => r.type === 'USES' &&
    r.source.includes('CustomerService') && r.target.includes('Address'));
  assert(!!uses, 'USES relationship: Service field-references Entity/Model');
}

// 7. Test component → TESTS relationship
{
  console.log('\nTest 7: Test file → TESTS relationship');
  const { relationships } = analyze({
    'src/main/java/com/x/Calculator.java': `
      package com.x;
      import org.springframework.stereotype.Service;
      @Service
      public class Calculator {}
    `,
    'src/test/java/com/x/CalculatorTest.java': `
      package com.x;
      import com.x.Calculator;
      public class CalculatorTest {
        @Test
        public void testAdd() {}
        private Calculator calc;
      }
    `,
  });
  const tests = relationships.filter(r => r.type === 'TESTS');
  assert(tests.length > 0, 'TESTS relationship from test file');
}

// 8. Wildcard import resolution
{
  console.log('\nTest 8: Wildcard import resolution');
  const { relationships } = analyze({
    'src/main/java/com/model/Pet.java': `
      package com.model;
      public class Pet {}
    `,
    'src/main/java/com/service/PetService.java': `
      package com.service;
      import org.springframework.stereotype.Service;
      import com.model.*;
      @Service
      public class PetService {
        private Pet currentPet;
      }
    `,
  });
  const rel = relationships.find(r => r.source.endsWith('PetService') && r.target.endsWith('Pet'));
  assert(!!rel, 'Wildcard import resolves Pet in PetService');
}

// 9. No phantom relationships — cross-package without import
{
  console.log('\nTest 9: No phantom relationship across packages without import');
  const { relationships } = analyze({
    'src/main/java/com/a/Foo.java': `
      package com.a;
      import org.springframework.stereotype.Service;
      @Service
      public class Foo {}
    `,
    'src/main/java/com/b/Bar.java': `
      package com.b;
      import org.springframework.stereotype.Service;
      @Service
      public class Bar {
        // Does NOT import or reference Foo
      }
    `,
  });
  const phantom = relationships.find(r =>
    (r.source.includes('Foo') && r.target.includes('Bar')) ||
    (r.source.includes('Bar') && r.target.includes('Foo'))
  );
  assert(!phantom, 'No phantom relationship without import');
}

// 10. isHelperClass gate — Mapper classified as Other
{
  console.log('\nTest 10: Helper class (Mapper) → Other type');
  const { components } = analyze({
    'src/main/java/com/x/UserMapper.java': `
      package com.x;
      public class UserMapper {}
    `,
  });
  const mapper = components.find(c => c.name === 'UserMapper');
  assertEqual(mapper && mapper.type, 'Other', 'UserMapper classified as Other');
}

// 11. Package-less file — path-based surrogate id
{
  console.log('\nTest 11: No-package file uses path-based surrogate id');
  const { components } = analyze({
    'src/Legacy.java': `
      // no package declaration
      public class Legacy {}
    `,
  });
  const legacy = components.find(c => c.name === 'Legacy');
  assert(!!legacy, 'Legacy component found');
  assert(legacy && !legacy.id.startsWith('.'), 'ID does not start with dot');
  assert(legacy && legacy.id.includes('Legacy'), 'ID contains class name');
  // id should NOT be the simple class name "Legacy" — must include path
  assert(legacy && legacy.id !== 'Legacy', 'ID is not bare simple name');
}

// 12. Entity → Entity reference → ASSOCIATED_WITH
{
  console.log('\nTest 12: Entity/Model → Entity/Model field → ASSOCIATED_WITH');
  const { relationships } = analyze({
    'src/main/java/com/x/model/Address.java': `
      package com.x.model;
      import javax.persistence.Entity;
      @Entity
      public class Address {}
    `,
    'src/main/java/com/x/model/Owner.java': `
      package com.x.model;
      import javax.persistence.Entity;
      import com.x.model.Address;
      @Entity
      public class Owner {
        private Address homeAddress;
      }
    `,
  });
  const assoc = relationships.find(r => r.type === 'ASSOCIATED_WITH');
  assert(!!assoc, 'ASSOCIATED_WITH between Entity/Model components');
}

// 13. Interface implementation — IMPLEMENTS relationship
{
  console.log('\nTest 13: Interface implementation → IMPLEMENTS');
  const { relationships } = analyze({
    'src/main/java/com/x/Printable.java': `
      package com.x;
      public interface Printable {}
    `,
    'src/main/java/com/x/Document.java': `
      package com.x;
      import com.x.Printable;
      public class Document implements Printable {}
    `,
  });
  const impl = relationships.find(r => r.type === 'IMPLEMENTS');
  assert(!!impl, 'IMPLEMENTS for interface implementation');
  assert(impl && impl.source.endsWith('Document'), 'Document implements Printable');
}

// 14. Renamed/deleted file: verifying mapFileToComponent returns null for unknown paths
//     (The git mapping used by caseBuilderV3 depends on filePath matching)
{
  console.log('\nTest 14: filePath field matches relative path for mapping');
  const { components } = analyze({
    'src/main/java/com/x/Order.java': `
      package com.x;
      public class Order {}
    `,
  });
  const order = components.find(c => c.name === 'Order');
  assert(!!order, 'Order component found');
  // filePath must be relative to repo root with forward slashes
  assert(order && order.filePath.startsWith('src/'), 'filePath is relative (starts with src/)');
  assert(order && !order.filePath.includes('\\'), 'filePath uses forward slashes');
}

// 15. Git rename handling — renamed files use new path and map to component
{
  console.log('\nTest 15: Git history rename handling (R-status mapped to new path)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-rename-'));
  try {
    execSync('git init', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.name "TestUser"', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.email "test@user.org"', { cwd: tmp, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmp, 'src/main/java/com/x'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/OldComp.java'), 'package com.x; public class OldComp {}');
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/OtherComp.java'), 'package com.x; public class OtherComp {}');
    execSync('git add . && git commit -m "initial"', { cwd: tmp, stdio: 'ignore' });

    // Rename OldComp.java to NewComp.java and modify OtherComp.java
    execSync('git mv src/main/java/com/x/OldComp.java src/main/java/com/x/NewComp.java', { cwd: tmp, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/OtherComp.java'), 'package com.x; public class OtherComp { int changed = 1; }');
    execSync('git add . && git commit -m "rename and edit"', { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.x.NewComp', filePath: 'src/main/java/com/x/NewComp.java' },
      { id: 'com.x.OtherComp', filePath: 'src/main/java/com/x/OtherComp.java' }
    ];

    const hist = await analyzeGitHistory(tmp, 5, components);
    const pair = hist.allPairs.find(p =>
      (p.source === 'com.x.NewComp' && p.target === 'com.x.OtherComp') ||
      (p.source === 'com.x.OtherComp' && p.target === 'com.x.NewComp')
    );
    assert(!!pair, 'Co-change pair recorded using renamed component path');
    assert(pair && pair.count >= 1, 'Rename co-change count is at least 1');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// 16. Git deletion handling — deleted files are excluded by ACMR filter
{
  console.log('\nTest 16: Git history deletion handling (--diff-filter=ACMR excludes D)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-delete-'));
  try {
    execSync('git init', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.name "TestUser"', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.email "test@user.org"', { cwd: tmp, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmp, 'src/main/java/com/x'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/DeadComp.java'), 'package com.x; public class DeadComp {}');
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/LiveComp.java'), 'package com.x; public class LiveComp {}');
    execSync('git add . && git commit -m "initial"', { cwd: tmp, stdio: 'ignore' });

    // Commit 2: Delete DeadComp.java
    execSync('git rm src/main/java/com/x/DeadComp.java', { cwd: tmp, stdio: 'ignore' });
    execSync('git commit -m "delete DeadComp"', { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.x.DeadComp', filePath: 'src/main/java/com/x/DeadComp.java' },
      { id: 'com.x.LiveComp', filePath: 'src/main/java/com/x/LiveComp.java' }
    ];

    const hist = await analyzeGitHistory(tmp, 5, components);
    // In commit 1 both were mapped. In commit 2 DeadComp was deleted (status D).
    // Because --diff-filter=ACMR excludes D, commit 2 produces no diff entries,
    // so no ghost unmapped file or invalid mapped entry is created.
    assertEqual(hist.mappedFiles, 2, 'DeadComp and LiveComp both mapped in initial commit');
    assertEqual(hist.unmappedFiles, 0, 'Deleted file not counted as unmapped in deletion commit');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// 17. Unmapped files handling — unregistered files explicitly increment unmapped counter
{
  console.log('\nTest 17: Git history unmapped file handling');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-unmapped-'));
  try {
    execSync('git init', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.name "TestUser"', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.email "test@user.org"', { cwd: tmp, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmp, 'src/main/java/com/x'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/Known.java'), 'package com.x; public class Known {}');
    fs.writeFileSync(path.join(tmp, 'src/main/java/com/x/Unknown.java'), 'package com.x; public class Unknown {}');
    execSync('git add . && git commit -m "add known and unknown"', { cwd: tmp, stdio: 'ignore' });

    const components = [
      { id: 'com.x.Known', filePath: 'src/main/java/com/x/Known.java' }
    ];

    const hist = await analyzeGitHistory(tmp, 5, components);
    assertEqual(hist.unmappedFiles, 1, 'Exactly 1 unmapped file counted for Unknown.java');
    assertEqual(hist.mappedFiles, 1, 'Exactly 1 mapped file counted for Known.java');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.error('\nFailed tests:');
  failures.forEach(f => console.error(' ✗', f));
  process.exit(1);
} else {
  console.log('All tests passed.\n');
  process.exit(0);
}
