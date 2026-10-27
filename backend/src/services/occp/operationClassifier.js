/**
 * operationClassifier.js
 * ----------------------
 * Classifies the source-code edit operation for a changed Java component
 * between a commit and its parent revision.
 *
 * Taxonomy (Phase 1 / Brief):
 *   1. METHOD_SIGNATURE_OR_DECLARATION: Changes in method headers, parameters, visibility, new/deleted method declarations.
 *   2. METHOD_BODY_OR_IMPLEMENTATION: Changes confined to method implementation statements (control flow, expressions, invocations).
 *   3. FIELD_OR_DATA_SHAPE: Changes in field declarations, data model shapes, JPA/validation annotations.
 *   4. TYPE_OR_INHERITANCE: Changes in class/interface/enum headers, extends, implements, class-level annotations.
 *   5. ADD_DELETE_OR_RENAME: File added, deleted, or renamed.
 *   6. UNKNOWN_OR_MIXED: Multiple operation categories present in the diff, or unparseable/ambiguous changes.
 *
 * Known Limitations:
 *   - Uses lexical/regex diff-hunk analysis with git diff -U0.
 *   - Does not perform full compiler-level AST differencing (e.g. GumTree/ChangeDistiller).
 *   - When multiple distinct operation categories are touched in the same component,
 *     detectedCategories lists all touched operations, while primaryCategory is UNKNOWN_OR_MIXED.
 */

'use strict';

import { execFileSync } from 'child_process';
import { normalizePath, isJavaSourceFile } from '../gitChangeDetector.js';

export const OPERATION_TAXONOMY = [
  'METHOD_SIGNATURE_OR_DECLARATION',
  'METHOD_BODY_OR_IMPLEMENTATION',
  'FIELD_OR_DATA_SHAPE',
  'TYPE_OR_INHERITANCE',
  'ADD_DELETE_OR_RENAME',
  'UNKNOWN_OR_MIXED'
];

/**
 * Classifies the edit operation for a given file change between parent and commit.
 *
 * @param {string} repoPath - Absolute path to git repository
 * @param {string} parentHash - Parent commit SHA
 * @param {string} commitHash - Evaluated commit SHA
 * @param {string} filePath - Normalized file path
 * @param {Object} [rawChange] - Git name-status change object { status, oldPath, newPath, filePath }
 * @returns {{ primaryCategory: string, detectedCategories: string[], hunkCounts: Object, isClassifiedReliably: boolean, method: string }}
 */
export function classifyOperation(repoPath, parentHash, commitHash, filePath, rawChange = null) {
  const normPath = normalizePath(filePath || (rawChange && (rawChange.newPath || rawChange.filePath || rawChange.oldPath)));

  // If not a Java source file, classify as UNKNOWN_OR_MIXED
  if (!isJavaSourceFile(normPath)) {
    return {
      primaryCategory: 'UNKNOWN_OR_MIXED',
      detectedCategories: ['UNKNOWN_OR_MIXED'],
      hunkCounts: {},
      isClassifiedReliably: false,
      method: 'non_java'
    };
  }

  // 1. Check Git Status: Add, Delete, Rename
  if (rawChange && rawChange.status) {
    const status = String(rawChange.status).toUpperCase();
    if (status === 'A' || status === 'D' || status.startsWith('R') || status.startsWith('C')) {
      return {
        primaryCategory: 'ADD_DELETE_OR_RENAME',
        detectedCategories: ['ADD_DELETE_OR_RENAME'],
        hunkCounts: { ADD_DELETE_OR_RENAME: 1 },
        isClassifiedReliably: true,
        method: `git_status_${status}`
      };
    }
  }

  // 2. Extract unified diff for modified file
  let diffRaw = '';
  const diffPath = (rawChange && rawChange.oldPath) ? rawChange.oldPath : normPath;
  try {
    diffRaw = execFileSync('git', ['diff', '-U0', parentHash, commitHash, '--', diffPath], {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8'
    });
  } catch (err) {
    // If diff failed with oldPath, try with normPath
    try {
      diffRaw = execFileSync('git', ['diff', '-U0', parentHash, commitHash, '--', normPath], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8'
      });
    } catch (e2) {
      return {
        primaryCategory: 'UNKNOWN_OR_MIXED',
        detectedCategories: ['UNKNOWN_OR_MIXED'],
        hunkCounts: {},
        isClassifiedReliably: false,
        method: 'diff_failed'
      };
    }
  }

  if (!diffRaw || !diffRaw.trim()) {
    // Check if new file was added without rawChange status
    return {
      primaryCategory: 'UNKNOWN_OR_MIXED',
      detectedCategories: ['UNKNOWN_OR_MIXED'],
      hunkCounts: {},
      isClassifiedReliably: false,
      method: 'empty_diff'
    };
  }

  // 3. Scan modified lines (+ and -)
  const lines = diffRaw.split('\n');
  const counts = {
    METHOD_SIGNATURE_OR_DECLARATION: 0,
    METHOD_BODY_OR_IMPLEMENTATION: 0,
    FIELD_OR_DATA_SHAPE: 0,
    TYPE_OR_INHERITANCE: 0
  };

  const TYPE_REGEX = /^\s*(public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+)*(class|interface|enum|record|@interface)\s+\w+|^\s*(extends|implements)\s+\w+|^\s*package\s+[a-z0-9_.]+\s*;|^\s*@(SpringBootApplication|Configuration|RestController|Controller|Service|Repository|Component|Entity|Table|Embeddable|MappedSuperclass|Document)\b/;
  const METHOD_SIG_REGEX = /^\s*(public|protected|private|abstract|default|static|final|synchronized|native)\s+.*?\w+\s*\([^)]*\)\s*(\{|throws|;)|^\s*(public|protected|private)\s+[A-Z]\w*\s*\([^)]*\)\s*(\{|throws)|^\s*[\w<>\[\],\s]+\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*;|^\s*@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|Override|Bean)\b/;
  const FIELD_REGEX = /^\s*(public|protected|private|static|final|volatile|transient)\s+[\w<>\[\]]+\s+[a-zA-Z0-9_]+(\s*=.*)?\s*;|^\s*@(Id|GeneratedValue|Column|JoinColumn|OneToMany|ManyToOne|ManyToMany|OneToOne|Transient|JsonProperty|NotNull|NotEmpty|NotBlank|Size|Autowired|Value|Inject)\b/;
  const BODY_REGEX = /^\s*(return|if|else|for|while|do|switch|case|break|continue|throw|try|catch|finally|this\.|super\.|log\.|System\.)\b|^\s*[a-zA-Z0-9_]+\s*(=|\+=|-=|\*=|\/=|%=)\s*|^\s*[a-zA-Z0-9_.]+\s*\(.*?\)\s*;/;

  let totalChangedLines = 0;

  for (const line of lines) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    const content = line.substring(1).trim();
    if (!content) continue; // blank line
    if (content.startsWith('//') || content.startsWith('/*') || content.startsWith('*') || content.startsWith('*/')) {
      continue; // comments
    }
    if (content === '{' || content === '}' || content === '};') {
      continue; // isolated braces
    }

    totalChangedLines++;

    if (TYPE_REGEX.test(content)) {
      counts.TYPE_OR_INHERITANCE++;
    } else if (METHOD_SIG_REGEX.test(content)) {
      counts.METHOD_SIGNATURE_OR_DECLARATION++;
    } else if (FIELD_REGEX.test(content)) {
      counts.FIELD_OR_DATA_SHAPE++;
    } else if (BODY_REGEX.test(content)) {
      counts.METHOD_BODY_OR_IMPLEMENTATION++;
    } else {
      // General fallback statement inside Java method
      counts.METHOD_BODY_OR_IMPLEMENTATION++;
    }
  }

  const detectedCategories = [];
  if (counts.TYPE_OR_INHERITANCE > 0) detectedCategories.push('TYPE_OR_INHERITANCE');
  if (counts.METHOD_SIGNATURE_OR_DECLARATION > 0) detectedCategories.push('METHOD_SIGNATURE_OR_DECLARATION');
  if (counts.FIELD_OR_DATA_SHAPE > 0) detectedCategories.push('FIELD_OR_DATA_SHAPE');
  if (counts.METHOD_BODY_OR_IMPLEMENTATION > 0) detectedCategories.push('METHOD_BODY_OR_IMPLEMENTATION');

  let primaryCategory;
  if (detectedCategories.length === 1) {
    primaryCategory = detectedCategories[0];
  } else if (detectedCategories.length > 1) {
    // If there are multiple, identify if one strongly dominates or label UNKNOWN_OR_MIXED
    primaryCategory = 'UNKNOWN_OR_MIXED';
  } else {
    primaryCategory = 'UNKNOWN_OR_MIXED';
    detectedCategories.push('UNKNOWN_OR_MIXED');
  }

  return {
    primaryCategory,
    detectedCategories,
    hunkCounts: counts,
    totalChangedLines,
    isClassifiedReliably: primaryCategory !== 'UNKNOWN_OR_MIXED',
    method: 'git_diff_hunk'
  };
}
