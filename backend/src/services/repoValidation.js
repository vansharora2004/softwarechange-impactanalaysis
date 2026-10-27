/**
 * repoValidation.js
 * -----------------
 * Validates local Git repositories safely and reliably for the
 * Context-Aware Software Change Impact Analysis Framework.
 *
 * Enforces:
 *   1. Non-empty, properly normalized paths (supporting Windows & POSIX).
 *   2. Path existence and directory verification.
 *   3. Git repository verification (presence of .git folder or worktree git-dir).
 *   4. Java source code detection (*.java files).
 *   5. Zero shell injection: uses fs methods and safe execFileSync with argument arrays.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * Normalizes a user-provided filesystem path.
 */
export function normalizeRepoPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  // Trim whitespace and remove surrounding quotes
  let cleaned = rawPath.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return path.resolve(cleaned);
}

/**
 * Checks if a directory contains at least one Java source file.
 */
export function hasJavaSourceFiles(dir, maxDepth = 15, currentDepth = 0) {
  if (currentDepth > maxDepth) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  const skipDirs = new Set(['.git', 'node_modules', 'target', '.mvn', 'bin', 'build', '.gradle', '.idea', '.vscode', 'dist', 'out']);

  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (skipDirs.has(name) || name.startsWith('.')) {
        continue;
      }
      if (hasJavaSourceFiles(path.join(dir, name), maxDepth, currentDepth + 1)) {
        return true;
      }
    } else if (entry.isFile() && name.endsWith('.java') && !name.startsWith('package-info') && !name.startsWith('module-info')) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that a path is an existing, valid local Git repository with Java files.
 *
 * @param {string} rawPath - User-provided repository directory path
 * @returns {Object} { valid: boolean, repoPath?: string, projectName?: string, error?: string, code?: string }
 */
export function validateRepository(rawPath) {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return {
      valid: false,
      code: 'MISSING_PATH',
      error: 'Please enter a repository path. The path cannot be empty.'
    };
  }

  const resolvedPath = normalizeRepoPath(rawPath);

  // 1. Existence check
  if (!fs.existsSync(resolvedPath)) {
    return {
      valid: false,
      code: 'NOT_FOUND',
      error: `Repository path does not exist: "${resolvedPath}". Please check the folder location and spelling.`
    };
  }

  // 2. Directory check
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err) {
    return {
      valid: false,
      code: 'ACCESS_ERROR',
      error: `Cannot access path "${resolvedPath}": ${err.message}`
    };
  }

  if (!stat.isDirectory()) {
    return {
      valid: false,
      code: 'NOT_A_DIRECTORY',
      error: `The specified path is a file, not a directory: "${resolvedPath}". Please select the root folder of your project.`
    };
  }

  // 3. Git repository check (must be the root of a Git repository)
  const gitDir = path.join(resolvedPath, '.git');
  let isGit = fs.existsSync(gitDir);

  if (!isGit) {
    try {
      const topLevel = execFileSync('git', ['-C', resolvedPath, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (topLevel && path.resolve(topLevel).toLowerCase() === resolvedPath.toLowerCase()) {
        isGit = true;
      }
    } catch {
      isGit = false;
    }
  }

  if (!isGit) {
    return {
      valid: false,
      code: 'NOT_A_GIT_REPOSITORY',
      error: `The directory "${resolvedPath}" is not a Git repository. No ".git" directory was found. Please ensure this project is initialized with Git.`
    };
  }

  // 4. Java source code check
  const hasJava = hasJavaSourceFiles(resolvedPath);
  if (!hasJava) {
    return {
      valid: false,
      code: 'NO_JAVA_FILES',
      error: `No Java source files (*.java) were found in "${resolvedPath}". This framework analyzes Java / Spring Boot codebases.`
    };
  }

  return {
    valid: true,
    repoPath: resolvedPath,
    projectName: path.basename(resolvedPath)
  };
}

/**
 * Returns available preset example repositories that exist on this system.
 */
export function getAvailableExampleRepositories() {
  const candidates = [
    'c:/yashika/STUDY/clg_project/spring-petclinic-rest',
    'c:/yashika/STUDY/clg_project/shopizer',
    'c:/yashika/STUDY/clg_project/commons-lang',
    'c:/yashika/STUDY/clg_project/thingsboard',
    'c:/yashika/STUDY/clg_project/maven'
  ];

  const available = [];
  for (const p of candidates) {
    const res = validateRepository(p);
    if (res.valid) {
      available.push({
        repoPath: res.repoPath,
        projectName: res.projectName,
        label: res.projectName === 'spring-petclinic-rest'
          ? 'Spring PetClinic REST (Example)'
          : (res.projectName === 'shopizer'
            ? 'Shopizer (E-Commerce Multi-Module)'
            : (res.projectName === 'commons-lang'
              ? 'Apache Commons Lang (Utility)'
              : res.projectName))
      });
    }
  }

  return available;
}
