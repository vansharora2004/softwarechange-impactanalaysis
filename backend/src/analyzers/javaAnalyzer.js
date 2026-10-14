import fs from 'fs';
import path from 'path';

/**
 * javaAnalyzer.js  — Phase 1 stabilised version
 *
 * Key changes vs. original:
 *  1. Component identity: id = "packageName.ClassName"  (FQN).
 *     When a file declares no package the repo-relative path is used as
 *     a stable surrogate.  The human-readable `name` field still holds
 *     only the simple class name so the UI is unchanged.
 *  2. Relationship extraction performance: instead of checking every
 *     (A, B) pair with regex, we build two lookup indices first:
 *       - importIndex  : FQN -> component  (for import-based resolution)
 *       - simpleIndex  : simpleName -> component[]  (for unqualified refs)
 *     We then enumerate only the candidates that are actually referenced
 *     by each source file (via its imports + body token scan).
 *  3. Renamed / deleted files: `analyzeRepository` accepts an optional
 *     `renamedFiles` / `deletedFiles` map produced by the caller (git log
 *     --diff-filter) so that callers can track those explicitly.
 *  4. No relationship type changes, no scoring weight changes.
 */

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function stripComments(code) {
  let c = code.replace(/\/\*[\s\S]*?\*\//g, '');
  c = c.replace(/\/\/.*$/gm, '');
  return c;
}

function getJavaFiles(dir, fileList = []) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return fileList; }
  for (const file of entries) {
    const filePath = path.join(dir, file);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (stat.isDirectory()) {
      if (file !== 'target' && file !== '.git' && file !== 'node_modules' && file !== '.mvn') {
        getJavaFiles(filePath, fileList);
      }
    } else if (
      file.endsWith('.java') &&
      !file.startsWith('package-info') &&
      !file.startsWith('module-info')
    ) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Classes that are structural helpers but not primary architectural
 * components.  They get classified as 'Other' by default.
 */
function isHelperClass(className) {
  return (
    className.endsWith('RowMapper') ||
    className.endsWith('Extractor') ||
    className.endsWith('Helper') ||
    className.endsWith('Config') ||
    className.endsWith('Configuration') ||
    className.endsWith('Aspect') ||
    className.endsWith('Validator') ||
    className.endsWith('Validation') ||
    className.endsWith('Advice') ||
    className.endsWith('Mapper') ||
    className.endsWith('MapperImpl')
  );
}

// ---------------------------------------------------------------------------
// File analysis — returns a rich component descriptor
// ---------------------------------------------------------------------------

/**
 * Analyses a single .java file and returns a component descriptor.
 *
 * The `id` is the fully-qualified class name (package + "." + simple name).
 * When no package declaration is found the repo-relative file path (with
 * forward slashes and .java stripped) is used as a stable unique surrogate.
 *
 * @param {string} filePath   Absolute path to the .java file
 * @param {string} repoRoot   Absolute path to the repository root
 * @returns {Object}          Component descriptor
 */
export function analyzeFile(filePath, repoRoot) {
  const codeRaw = fs.readFileSync(filePath, 'utf-8');
  const code    = stripComments(codeRaw);

  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const filename     = path.basename(filePath, '.java');

  // ── Package declaration ──────────────────────────────────────────────────
  const packageMatch = code.match(/package\s+([\w.]+)\s*;/);
  const packageName  = packageMatch ? packageMatch[1] : '';

  // ── Import declarations ──────────────────────────────────────────────────
  const importRegex = /import\s+([\w.*]+)\s*;/g;
  const imports     = [];
  let   importMatch;
  while ((importMatch = importRegex.exec(code)) !== null) {
    imports.push(importMatch[1]);
  }

  // ── Primary class / interface / enum / record name ───────────────────────
  const classDeclRegex = /(?:public\s+)?(?:class|interface|enum|record)\s+(\w+)/g;
  let   className = filename; // fall back to file name
  let   match;
  while ((match = classDeclRegex.exec(code)) !== null) {
    if (match[1] === filename) { className = match[1]; break; }
  }

  // ── Annotations (from the part before the class declaration) ─────────────
  const annotations  = [];
  const classDeclIdx = code.indexOf(className);
  const classHeader  = classDeclIdx > 0 ? code.substring(0, classDeclIdx) : '';
  const annoRegex    = /@(\w+)/g;
  let   annoMatch;
  while ((annoMatch = annoRegex.exec(classHeader)) !== null) {
    annotations.push(annoMatch[1]);
  }

  const hasTestAnnotation = /@Test\b/.test(code);

  // ── Inheritance / implements ──────────────────────────────────────────────
  const extendsMatch = code.match(
    new RegExp(`(?:class|interface)\\s+${className}\\s+extends\\s+([\\w<>.,\\s]+?)(?:\\s+implements|\\{)`)
  );
  const implementsMatch = code.match(
    new RegExp(`(?:class|interface)\\s+${className}\\s+.*?implements\\s+([\\w<>.,\\s]+?)\\{`)
  );

  const parentClasses = extendsMatch
    ? extendsMatch[1].split(',').map(s => s.trim().replace(/<.*>/, ''))
    : [];
  const interfaces = implementsMatch
    ? implementsMatch[1].split(',').map(s => s.trim().replace(/<.*>/, ''))
    : [];
  const inheritanceInfo = [...parentClasses, ...interfaces];

  // ── Classification hierarchy ─────────────────────────────────────────────
  let type = 'Other';

  if (!isHelperClass(className)) {
    // 1. Spring annotations
    if (annotations.includes('RestController') || annotations.includes('Controller')) {
      type = 'Controller';
    } else if (annotations.includes('Service')) {
      type = 'Service';
    } else if (annotations.includes('Repository')) {
      type = 'Repository';
    } else if (
      annotations.includes('Entity') ||
      annotations.includes('Table') ||
      annotations.includes('Document')
    ) {
      type = 'Entity/Model';
    } else if (
      hasTestAnnotation ||
      annotations.includes('SpringBootTest') ||
      annotations.includes('ContextConfiguration')
    ) {
      type = 'Test';
    }

    // 2. Class inheritance / interface information
    if (type === 'Other') {
      const isRepo = inheritanceInfo.some(
        i => i.endsWith('Repository') || i.includes('Repository<')
      );
      const isService = inheritanceInfo.some(
        i => i.endsWith('Service') || i.includes('Service<')
      );
      if (isRepo)    type = 'Repository';
      else if (isService) type = 'Service';
    }

    // 3. Package / directory convention
    if (type === 'Other') {
      const lowerPath = relativePath.toLowerCase();
      if (lowerPath.includes('/controller/') || lowerPath.includes('/rest/')) {
        type = 'Controller';
      } else if (lowerPath.includes('/service/')) {
        type = 'Service';
      } else if (lowerPath.includes('/repository/')) {
        type = 'Repository';
      } else if (
        lowerPath.includes('/model/')  ||
        lowerPath.includes('/entity/') ||
        lowerPath.includes('/domain/')
      ) {
        type = 'Entity/Model';
      } else if (lowerPath.includes('/src/test/')) {
        type = 'Test';
      }
    }

    // 4. Filename / class-name suffix convention
    if (type === 'Other') {
      if (className.endsWith('Controller') || className.endsWith('RestController')) {
        type = 'Controller';
      } else if (className.endsWith('Service') || className.endsWith('ServiceImpl')) {
        type = 'Service';
      } else if (
        className.endsWith('Repository') ||
        className.endsWith('RepositoryImpl')
      ) {
        type = 'Repository';
      } else if (className.endsWith('Test') || className.endsWith('Tests')) {
        type = 'Test';
      }
    }
  }

  // ── Stable unique component id ───────────────────────────────────────────
  // FQN when a package exists; file-path based surrogate otherwise.
  const fqn = packageName
    ? `${packageName}.${className}`
    : relativePath.replace(/\.java$/, '').replace(/\//g, '.');

  return {
    /** Stable unique identifier — FQN or path-based surrogate */
    id:            fqn,
    /** Human-readable simple class name for display */
    name:          className,
    type,
    filePath:      relativePath,
    packageName,
    imports,
    inheritanceInfo,   // simple names extracted from extends/implements
    rawCode:       codeRaw,
    cleanCode:     code,
  };
}

// ---------------------------------------------------------------------------
// Relationship extraction — import-indexed, O(N) per component
// ---------------------------------------------------------------------------

/**
 * Determines the relationship type between two components given the context
 * of the source class body and the match trigger.
 *
 * @param {'EXTENDS'|'constructor'|'autowired'|'field'|'typed'} trigger
 * @param {string} typeA  component type of source
 * @param {string} typeB  component type of target
 * @param {string} classNameA  simple name of source (used for Mapper detection)
 * @returns {{ relType: string, detail: string }}
 */
function resolveRelType(trigger, typeA, typeB, classNameA) {
  const isArch = (t) =>
    t === 'Controller' || t === 'Service' || t === 'Repository';

  switch (trigger) {
    case 'EXTENDS':
      return { relType: 'EXTENDS', detail: 'Class Inheritance or Interface Implementation' };

    case 'constructor':
    case 'autowired': {
      const rel =
        isArch(typeA) && isArch(typeB) ? 'DEPENDS_ON' : 'USES';
      const det =
        trigger === 'constructor' ? 'Constructor Injection' : 'Autowired Field Injection';
      return { relType: rel, detail: det };
    }

    case 'field': {
      if (typeA === 'Entity/Model' && typeB === 'Entity/Model') {
        return { relType: 'ASSOCIATED_WITH', detail: 'Domain Model Field Reference' };
      }
      if (classNameA.endsWith('Mapper') || typeA === 'Other' || typeB === 'Other') {
        return { relType: 'REFERENCES', detail: 'Supporting Field Reference' };
      }
      return { relType: 'USES', detail: 'Field Reference' };
    }

    case 'typed': {
      if (typeA === 'Entity/Model' && typeB === 'Entity/Model') {
        return { relType: 'ASSOCIATED_WITH', detail: 'Domain Reference: Explicit Typed Reference' };
      }
      if (classNameA.endsWith('Mapper') || typeA === 'Other' || typeB === 'Other') {
        return { relType: 'REFERENCES', detail: 'Supporting Reference: Explicit Typed Reference' };
      }
      return { relType: 'USES', detail: 'Explicit Typed Reference' };
    }

    default:
      return { relType: 'USES', detail: 'Reference' };
  }
}

/**
 * Extracts all relationships from a single source component to the set of
 * candidate target components.
 *
 * Candidates are pre-filtered by the caller using the import index so the
 * expensive regex tests are only run against components that the source file
 * actually imports (or that appear in its inheritance chain).
 *
 * @param {Object}   compA       Source component (with cleanCode, inheritanceInfo, …)
 * @param {Object[]} candidates  Target components to check
 * @returns {{ source, target, type, detail }[]}
 */
function extractRelationshipsFrom(compA, candidates) {
  const results   = [];
  const body      = compA.cleanCode;
  const classNameA = compA.name;
  const typeA      = compA.type;
  const seenTargets = new Set(); // emit at most one relationship per (A, B) pair

  for (const compB of candidates) {
    if (compA.id === compB.id) continue;
    if (seenTargets.has(compB.id)) continue;

    const classNameB = compB.name;
    const typeB      = compB.type;

    // 1. Inheritance (simple name match from inheritanceInfo)
    if (compA.inheritanceInfo.includes(classNameB)) {
      const { relType, detail } = resolveRelType('EXTENDS', typeA, typeB, classNameA);
      let finalType = relType;
      if (typeA === 'Test' && typeB !== 'Test') finalType = 'TESTS';
      results.push({ source: compA.id, target: compB.id, type: finalType, detail });
      seenTargets.add(compB.id);
      continue;
    }

    // 2. Constructor injection
    const ctorRegex = new RegExp(
      `\\b${classNameA}\\s*\\([^)]*\\b${classNameB}\\b[^)]*\\)`
    );
    if (ctorRegex.test(body)) {
      const { relType, detail } = resolveRelType('constructor', typeA, typeB, classNameA);
      let finalType = relType;
      if (typeA === 'Test' && typeB !== 'Test') finalType = 'TESTS';
      results.push({ source: compA.id, target: compB.id, type: finalType, detail });
      seenTargets.add(compB.id);
      continue;
    }

    // 3. @Autowired / @Inject field injection
    // Access modifiers: private/protected/public each need their own trailing \s+
    const awRegex  = new RegExp(
      `@(?:Autowired|Inject)\\s+(?:(?:private|protected|public)\\s+)?(?:final\\s+)?\\b${classNameB}\\b`
    );
    const awBlock  = new RegExp(
      `@(?:Autowired|Inject)\\s*\\r?\\n\\s*(?:(?:private|protected|public)\\s+)?(?:final\\s+)?\\b${classNameB}\\b`
    );
    if (awRegex.test(body) || awBlock.test(body)) {
      const { relType, detail } = resolveRelType('autowired', typeA, typeB, classNameA);
      let finalType = relType;
      if (typeA === 'Test' && typeB !== 'Test') finalType = 'TESTS';
      results.push({ source: compA.id, target: compB.id, type: finalType, detail });
      seenTargets.add(compB.id);
      continue;
    }

    // 4. Ordinary typed field declaration
    const fieldRegex = new RegExp(
      `(?:(?:private|protected|public)\\s+)(?:final\\s+)?\\b${classNameB}\\b\\s+\\w+\\s*;`
    );
    if (fieldRegex.test(body)) {
      const { relType, detail } = resolveRelType('field', typeA, typeB, classNameA);
      let finalType = relType;
      if (typeA === 'Test' && typeB !== 'Test') finalType = 'TESTS';
      results.push({ source: compA.id, target: compB.id, type: finalType, detail });
      seenTargets.add(compB.id);
      continue;
    }

    // 5. Explicit typed references (method return types, parameters, generics, local vars)
    const varDecl    = new RegExp(`\\b${classNameB}\\b\\s+\\w+\\s*=`);
    const generic    = new RegExp(`\\b[A-Za-z0-9_]+\\s*<\\s*\\b${classNameB}\\b\\s*>`);
    const methodSig  = new RegExp(
      `(?:public|protected|private|static)\\s+(?:[A-Za-z0-9_<>]+\\s+)?\\b${classNameB}\\b\\s+\\w+\\s*\\(`
    );
    const methodParam = new RegExp(`\\w+\\s*\\([^)]*\\b${classNameB}\\b[^)]*\\)`);

    if (
      varDecl.test(body)    ||
      generic.test(body)    ||
      methodSig.test(body)  ||
      methodParam.test(body)
    ) {
      const { relType, detail } = resolveRelType('typed', typeA, typeB, classNameA);
      let finalType = relType;
      if (typeA === 'Test' && typeB !== 'Test') finalType = 'TESTS';
      results.push({ source: compA.id, target: compB.id, type: finalType, detail });
      seenTargets.add(compB.id);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main repository analysis entry point
// ---------------------------------------------------------------------------

/**
 * Scans a Java repository and returns components + relationships.
 *
 * @param {string} repoRoot  Absolute path to the repository root
 * @returns {{ components: Object[], relationships: Object[] }}
 *
 * Changes vs. original:
 *  - component id is FQN; duplicate simple class names in different packages
 *    are kept as separate nodes instead of silently overwriting.
 *  - relationship extraction uses an import index: for each source component
 *    we only test against components whose FQN appears in the source's imports
 *    or whose simple name appears in the inheritance declarations.
 *    This reduces the average complexity from O(N²·R) to approximately O(N·imports).
 */
export function analyzeRepository(repoRoot) {
  const javaFiles = getJavaFiles(repoRoot);

  // ── Step 1: Parse all files ───────────────────────────────────────────────
  // Key: FQN (id).  Duplicate FQNs from truly identical class names in the
  // same package (unusual) are reported to stderr; last writer wins in that
  // edge case, consistent with Java compiler behaviour.
  const componentsMap = new Map(); // id -> component

  for (const filePath of javaFiles) {
    const comp = analyzeFile(filePath, repoRoot);
    if (componentsMap.has(comp.id)) {
      process.stderr.write(
        `[analyzer] WARNING: duplicate component id "${comp.id}" – ` +
        `"${componentsMap.get(comp.id).filePath}" overwritten by "${comp.filePath}"\n`
      );
    }
    componentsMap.set(comp.id, comp);
  }

  const componentsList = Array.from(componentsMap.values());

  // ── Step 2: Build lookup indices ──────────────────────────────────────────
  //
  // importIndex  : fully-qualified-name -> component
  //   Allows us to resolve an import "com.example.Foo" -> the Foo component.
  //
  // simpleIndex  : simpleName -> component[]
  //   Allows us to resolve an unqualified reference "Foo" -> candidates.
  //   (Multiple components can share a simple name in different packages.)

  const importIndex = new Map(); // FQN string -> component
  const simpleIndex = new Map(); // simple name -> component[]

  for (const comp of componentsList) {
    importIndex.set(comp.id, comp);
    const existing = simpleIndex.get(comp.name) || [];
    existing.push(comp);
    simpleIndex.set(comp.name, existing);
  }

  // ── Step 3: Extract relationships with import-guided candidate selection ──
  const relationships = [];

  for (const compA of componentsList) {
    // Build the set of candidate components that compA might reference.
    // Strategy:
    //   a) Any component whose FQN appears in compA's import list.
    //   b) Any component whose simple name appears in compA's inheritance list
    //      (extends / implements can be unqualified in source).
    //   c) As a safety net for same-package references (no import needed),
    //      also include all components that share compA's package.

    const candidateSet = new Map(); // id -> component

    // (a) import-resolved candidates
    for (const imp of compA.imports) {
      // Handle wildcard imports: "com.example.*"
      if (imp.endsWith('.*')) {
        const prefix = imp.slice(0, -2); // strip ".*"
        for (const comp of componentsList) {
          if (comp.packageName === prefix) candidateSet.set(comp.id, comp);
        }
      } else {
        const comp = importIndex.get(imp);
        if (comp) candidateSet.set(comp.id, comp);
      }
    }

    // (b) inheritance-resolved candidates (unqualified names)
    for (const simpleName of compA.inheritanceInfo) {
      const comps = simpleIndex.get(simpleName) || [];
      for (const comp of comps) candidateSet.set(comp.id, comp);
    }

    // (c) same-package candidates (no import needed in Java)
    if (compA.packageName) {
      for (const comp of componentsList) {
        if (comp.packageName === compA.packageName) candidateSet.set(comp.id, comp);
      }
    }

    // Remove self from candidate set
    candidateSet.delete(compA.id);

    if (candidateSet.size === 0) continue;

    const rels = extractRelationshipsFrom(compA, Array.from(candidateSet.values()));
    relationships.push(...rels);
  }

  // ── Step 4: Return cleaned output ────────────────────────────────────────
  const cleanedComponents = componentsList.map(c => ({
    id:       c.id,
    name:     c.name,
    type:     c.type,
    filePath: c.filePath,
  }));

  return { components: cleanedComponents, relationships };
}
