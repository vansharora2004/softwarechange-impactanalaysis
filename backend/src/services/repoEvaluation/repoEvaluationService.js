/**
 * repoEvaluationService.js
 * ------------------------
 * Historical (leave-one-out) evaluation of the currently analysed repository.
 *
 *   - Runs the EGCP v4 evaluation core in a worker thread and reports progress.
 *   - Stores one result file per repository + HEAD commit in .cache/repo_evaluations,
 *     so an unchanged repository loads instantly and a new commit triggers a re-run.
 *   - Re-runs a single case for the 3-model dashboard with the same leak-free inputs
 *     as the evaluation: pre-change graph at c^1, co-change from commits older than c,
 *     and path statistics trained on older commits only.
 *
 * Never writes to research_artifacts/.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

import { parseGitLogCommits } from '../gitChangeDetector.js';
import { getOrBuildHistoricalGraph } from '../historicalGraphService.js';
import { classifyOperation } from '../occp/operationClassifier.js';
import { trainPathModels } from '../occp/occpModel.js';
import {
  buildLeakFreeHistoryCounts,
  indexHistoricalEpisodesSafe,
  computeCaseMetrics
} from '../../evaluation/v5/egcpV4EvalCore.js';
import {
  runThreeWayImpactAnalysis,
  buildEvaluationCaseView,
  buildCoChangeEvidence
} from '../threeWayComparisonService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const ACTIVE_GRAPH_PATH = path.join(BACKEND_ROOT, 'analysis_output.json');
const RESULTS_DIR = path.join(BACKEND_ROOT, '.cache', 'repo_evaluations');
const WORKER_PATH = path.join(__dirname, 'repoEvaluationWorker.js');
const COMMIT_LIMIT = 100;

// Current or last worker job: { key, repoPath, projectName, headSha, status, phase, done, total, error, startedAt }
let job = null;
// Start request for another repository received while a job was running
let pendingStart = null;
// Loaded result, keyed by repoPath|headSha
let loaded = { key: null, result: null };
// Per-repository context for re-running single cases: { key, allCommits, episodes }
let caseContext = { key: null, allCommits: null, episodes: null };

const jobKey = (repoPath, headSha) => `${path.resolve(repoPath)}|${headSha}`;

function getActiveRepository() {
  if (!fs.existsSync(ACTIVE_GRAPH_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(ACTIVE_GRAPH_PATH, 'utf8'));
    if (!data.repoPath || !fs.existsSync(data.repoPath)) return null;
    return { repoPath: data.repoPath, projectName: data.projectName || path.basename(data.repoPath) };
  } catch {
    return null;
  }
}

function readHeadSha(repoPath) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
}

function resultFileFor(projectName, headSha) {
  const safeName = projectName.replace(/[^A-Za-z0-9._-]+/g, '_');
  return path.join(RESULTS_DIR, `${safeName}_${headSha.slice(0, 12)}.json`);
}

/** Active repository, its HEAD and result file, or an error description. */
function resolveTarget() {
  const repo = getActiveRepository();
  if (!repo) {
    return { error: 'No analysed repository is active. Analyse a repository on the Run Analysis tab first.' };
  }
  let headSha;
  try {
    headSha = readHeadSha(repo.repoPath);
  } catch (err) {
    return { error: `Could not read the current commit of ${repo.repoPath}: ${err.message}` };
  }
  return { ...repo, headSha, key: jobKey(repo.repoPath, headSha), file: resultFileFor(repo.projectName, headSha) };
}

function loadResult(target) {
  if (loaded.key === target.key) return loaded.result;
  if (!fs.existsSync(target.file)) return null;
  const result = JSON.parse(fs.readFileSync(target.file, 'utf8'));
  loaded = { key: target.key, result };
  return result;
}

function launchWorker(target) {
  job = {
    key: target.key,
    repoPath: target.repoPath,
    projectName: target.projectName,
    headSha: target.headSha,
    status: 'running',
    phase: 'starting',
    done: 0,
    total: 0,
    error: null,
    startedAt: new Date().toISOString()
  };
  const current = job;

  const worker = new Worker(WORKER_PATH, {
    workerData: {
      repoPath: target.repoPath,
      projectName: target.projectName,
      headSha: target.headSha,
      commitLimit: COMMIT_LIMIT,
      outFile: target.file
    }
  });

  const finish = (status, error = null) => {
    if (current.status !== 'running') return;
    current.status = status;
    current.error = error;
    current.finishedAt = new Date().toISOString();
    if (pendingStart) {
      const next = pendingStart;
      pendingStart = null;
      if (next.key !== current.key) launchWorker(next);
    }
  };

  worker.on('message', msg => {
    if (msg.type === 'progress') {
      current.phase = msg.phase;
      current.done = msg.done;
      current.total = msg.total;
    } else if (msg.type === 'done') {
      finish('done');
    } else if (msg.type === 'error') {
      finish('error', msg.message);
    }
  });
  worker.on('error', err => finish('error', err.message));
  worker.on('exit', code => {
    if (code !== 0) finish('error', `Evaluation worker exited with code ${code}.`);
  });
}

function describe(target, result) {
  const running = job && job.key === target.key && job.status === 'running';
  const failed = job && job.key === target.key && job.status === 'error';
  const queued = pendingStart && pendingStart.key === target.key;
  return {
    success: true,
    repoPath: target.repoPath,
    projectName: target.projectName,
    headSha: target.headSha,
    status: result ? 'done' : (running ? 'running' : (queued ? 'queued' : (failed ? 'error' : 'none'))),
    phase: running ? job.phase : null,
    progress: running ? { done: job.done, total: job.total } : null,
    error: failed && !result ? job.error : null,
    busyWith: job && job.status === 'running' && job.key !== target.key ? job.projectName : null,
    evaluatedAt: result?.evaluatedAt || null,
    config: result?.config || null,
    warnings: result?.warnings || []
  };
}

/** Evaluation status for the analysed repository at its current HEAD. */
export function getRepoEvaluationStatus() {
  const target = resolveTarget();
  if (target.error) return { success: true, status: 'no_repo', error: target.error };
  return describe(target, loadResult(target));
}

/**
 * Starts the evaluation for the analysed repository unless a result for its current HEAD exists.
 * @param {{ force?: boolean }} [options] - force re-runs even when a stored result exists
 */
export function startRepoEvaluation(options = {}) {
  const target = resolveTarget();
  if (target.error) return { success: false, status: 'no_repo', error: target.error };

  if (!options.force && loadResult(target)) return describe(target, loaded.result);
  if (job && job.status === 'running') {
    if (job.key !== target.key) pendingStart = target;
    return describe(target, null);
  }

  if (options.force && loaded.key === target.key) loaded = { key: null, result: null };
  launchWorker(target);
  return describe(target, null);
}

function requireResult() {
  const target = resolveTarget();
  if (target.error) throw new Error(target.error);
  const result = loadResult(target);
  if (!result) throw new Error('This repository has not been evaluated yet. Start the evaluation first.');
  return { target, result };
}

/** Full evaluation result (metrics, significance tests, split) for the analysed repository. */
export function getRepoEvaluationSummary() {
  const { result } = requireResult();
  const { cases, ...summary } = result;
  return { success: true, casesCount: cases.length, ...summary };
}

/** Leave-one-out cases of the analysed repository, in the same shape as the fixed benchmark cases. */
export function getRepoEvaluationCases(filterOptions = {}) {
  const { result } = requireResult();
  let cases = result.cases;
  if (filterOptions.split) cases = cases.filter(c => c.split === filterOptions.split);
  return {
    success: true,
    repoPath: result.repoPath,
    projectName: result.projectName,
    headSha: result.headSha,
    config: result.config,
    warnings: result.warnings,
    totalCases: cases.length,
    overallSummary: result.overallSummary,
    commits: result.commits,
    cases
  };
}

function getCaseContext(target) {
  if (caseContext.key !== target.key) {
    const allCommits = parseGitLogCommits(target.repoPath, COMMIT_LIMIT, { includeMerges: true });
    caseContext = { key: target.key, allCommits, episodes: indexHistoricalEpisodesSafe(target.repoPath, allCommits, 2) };
  }
  return caseContext;
}

/**
 * Re-runs one leave-one-out case of the analysed repository with the 3 dashboard models.
 * The per-case metrics are computed from exactly the rankings returned.
 */
export async function runRepoEvaluationCase(caseId) {
  const { target, result } = requireResult();
  const targetCase = result.cases.find(c => c.caseId === caseId);
  if (!targetCase) throw new Error(`Evaluation case not found: ${caseId}`);

  const { allCommits, episodes } = getCaseContext(target);
  const commitIndex = allCommits.findIndex(c => c.hash === targetCase.commitHash);
  if (commitIndex < 0) throw new Error(`Commit ${targetCase.commitShortSha} is no longer in the last ${COMMIT_LIMIT} commits.`);
  const commit = allCommits[commitIndex];

  const { graph, parentSha } = getOrBuildHistoricalGraph(target.repoPath, commit.hash);
  const compMap = new Map(graph.components.map(c => [c.id, c]));
  const historyCounts = buildLeakFreeHistoryCounts(allCommits, commitIndex, compMap);
  const { genericPathStats, conditionedPathStats } = trainPathModels(episodes.filter(ep => ep.commitIndex > commitIndex));

  const inputComp = compMap.get(targetCase.inputComponent);
  const rawChange = (commit.rawChanges || []).find(r => {
    const p = r.filePath || r.newPath || r.oldPath;
    return inputComp?.filePath && (inputComp.filePath.endsWith(p) || p.endsWith(inputComp.filePath));
  });
  const opClass = classifyOperation(target.repoPath, parentSha, commit.hash, inputComp ? inputComp.filePath : '', rawChange);

  const compareResult = await runThreeWayImpactAnalysis([targetCase.inputComponent], {
    customGraph: graph,
    editOperation: opClass.primaryCategory,
    opClass,
    historyCounts,
    conditionedPathStats,
    genericPathStats,
    repoPath: target.repoPath
  });

  const oracle = new Set(targetCase.targetOracles);
  const idsOf = list => (list || []).map(c => c.id);
  const shownMetrics = {
    canonical_baseline: computeCaseMetrics(idsOf(compareResult.baselineOutput), oracle),
    csf_frozen: computeCaseMetrics(idsOf(compareResult.csfOutput), oracle),
    egcp_v4_combined: computeCaseMetrics(idsOf(compareResult.egcpOutput), oracle)
  };

  const olderCommits = allCommits.length - commitIndex - 1;
  return {
    ...buildEvaluationCaseView(targetCase, compareResult, shownMetrics),
    metricsSource: 'Computed from the rankings shown, using only data from before this commit.',
    evaluationMetrics: targetCase.metrics,
    coChangeEvidence: {
      ...buildCoChangeEvidence(targetCase.inputComponent, historyCounts, graph.components, {
        available: true,
        commitsCount: olderCommits,
        message: `Leak-free: only the ${olderCommits} commits older than ${targetCase.commitShortSha}.`
      }),
      totalCommitsAnalyzed: olderCommits
    }
  };
}
