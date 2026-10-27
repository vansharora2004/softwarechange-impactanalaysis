/**
 * repoEvaluationWorker.js
 * -----------------------
 * Worker thread that runs the EGCP v4 leave-one-out evaluation on one repository and
 * writes the result file. Runs off the main thread because case construction and model
 * ranking are synchronous and can take minutes on large repositories.
 *
 * workerData: { repoPath, projectName, headSha, commitLimit, outFile }
 * Posts: { type: 'progress', phase, done, total } | { type: 'done' } | { type: 'error', message }
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { parentPort, workerData } from 'worker_threads';

import { parseGitLogCommits } from '../gitChangeDetector.js';
import {
  EVAL_MODELS,
  buildHistoricalCasesFast,
  indexHistoricalEpisodesSafe,
  pairedStats,
  computeMacroMetrics,
  computeMicroMetrics,
  evaluateProjectCases
} from '../../evaluation/v5/egcpV4EvalCore.js';

// Newest 30% of eligible commits are held out for testing, the older 70% are train.
const TEST_FRACTION = 0.3;
// Below this many eligible commits, metrics and significance tests are indicative only.
const MIN_RELIABLE_COMMITS = 5;

const progress = (phase, done = 0, total = 0) => parentPort.postMessage({ type: 'progress', phase, done, total });

function readCommitMeta(repoPath, commitLimit) {
  const out = execFileSync('git', ['log', `-n${commitLimit}`, '--format=%H%x1f%an%x1f%ad'], {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  const meta = new Map();
  for (const line of out.split('\n')) {
    const [hash, author, date] = line.split('\x1f');
    if (hash) meta.set(hash.trim(), { author: author || '', date: date || '' });
  }
  return meta;
}

const nullableMetrics = (cases, fn) => (cases.length > 0 ? fn(cases) : null);

async function run() {
  const { repoPath, projectName, headSha, commitLimit, outFile } = workerData;

  progress('scanning');
  const { eligibleCommits, looCases } = await buildHistoricalCasesFast(
    repoPath, commitLimit, (i, total) => progress('scanning', i, total)
  );

  const allCommits = parseGitLogCommits(repoPath, commitLimit, { includeMerges: true });

  progress('indexing');
  const historicalEpisodes = indexHistoricalEpisodesSafe(repoPath, allCommits, 2);

  const total = eligibleCommits.length;
  const testCommitCount = total >= 2 ? Math.max(1, Math.round(total * TEST_FRACTION)) : 0;
  // eligibleCommits are newest first, so the first testCommitCount entries are the newest
  const isTrainCommit = cIdx => cIdx >= testCommitCount;

  progress('evaluating', 0, total);
  const { caseResults } = evaluateProjectCases(repoPath, eligibleCommits, allCommits, historicalEpisodes, {
    isTrainCommit,
    onCommitDone: (done, n) => progress('evaluating', done, n)
  });

  const meta = readCommitMeta(repoPath, commitLimit);
  const commitByHash = new Map(eligibleCommits.map(ec => [ec.commitHash, ec]));

  const commits = eligibleCommits.map((ec, cIdx) => ({
    commitHash: ec.commitHash,
    shortSha: ec.commitHash.slice(0, 7),
    author: meta.get(ec.commitHash)?.author || '',
    date: meta.get(ec.commitHash)?.date || '',
    subject: ec.commitSubject || '',
    caseCount: ec.caseCount,
    split: isTrainCommit(cIdx) ? 'train' : 'test'
  }));

  const cases = caseResults.map(cr => {
    const ec = commitByHash.get(cr.commitHash);
    const comp = ec?.compMap.get(cr.inputComponent);
    return {
      caseId: cr.caseId,
      projectName,
      commitHash: cr.commitHash,
      commitShortSha: cr.commitHash.slice(0, 7),
      commitSubject: ec?.commitSubject || '',
      commitAuthor: meta.get(cr.commitHash)?.author || '',
      commitDate: meta.get(cr.commitHash)?.date || '',
      commitIndex: cr.commitIndex,
      isTrainCommit: cr.isTrainCommit,
      split: cr.isTrainCommit ? 'train' : 'test',
      inputComponent: cr.inputComponent,
      inputComponentName: comp?.name || cr.inputComponent.split('.').pop(),
      primaryOp: cr.primaryOp,
      targetOraclesCount: cr.targetOracles.length,
      targetOracles: cr.targetOracles,
      candidateUniverseSize: cr.candidateUniverseSize,
      metrics: cr.metrics
    };
  });

  const trainCases = caseResults.filter(c => c.isTrainCommit);
  const testCases = caseResults.filter(c => !c.isTrainCommit);
  const mapOf = key => caseResults.map(c => c.metrics[key].map);

  const warnings = [];
  if (total === 0) {
    warnings.push('No usable commits found. A commit is used only when it changes at least 2 non-test Java files that map to analysed components.');
  } else if (total < MIN_RELIABLE_COMMITS) {
    warnings.push(`Only ${total} usable commit${total === 1 ? '' : 's'} found. Metrics are indicative only and significance tests are not reliable.`);
  }

  const overallMacro = nullableMetrics(caseResults, computeMacroMetrics);
  const overallMicro = nullableMetrics(caseResults, computeMicroMetrics);

  const result = {
    version: 1,
    repoPath,
    projectName,
    headSha,
    evaluatedAt: new Date().toISOString(),
    commitLimit,
    config: {
      scannedCommits: allCommits.length,
      eligibleCommits: total,
      totalCases: looCases.length,
      trainCommits: total - testCommitCount,
      testCommits: testCommitCount,
      splitRule: 'Chronological: the newest 30% of eligible commits are held out for testing, the older 70% are train.',
      reliable: total >= MIN_RELIABLE_COMMITS
    },
    warnings,
    models: EVAL_MODELS,
    overallSummary: overallMacro ? { totalCommits: total, totalCases: caseResults.length, ...overallMacro } : null,
    overallMacroCommits: overallMacro,
    overallMicroCases: overallMicro,
    trainMacroCommits: nullableMetrics(trainCases, computeMacroMetrics),
    testMacroCommits: nullableMetrics(testCases, computeMacroMetrics),
    statisticalTests: caseResults.length > 0 ? {
      level: 'case',
      egcp_v4_vs_baseline: pairedStats(mapOf('egcp_v4_combined'), mapOf('canonical_baseline')),
      egcp_v4_vs_csf: pairedStats(mapOf('egcp_v4_combined'), mapOf('csf_frozen')),
      csf_vs_baseline: pairedStats(mapOf('csf_frozen'), mapOf('canonical_baseline'))
    } : null,
    commits,
    cases
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmpFile = `${outFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(result, null, 2));
  fs.renameSync(tmpFile, outFile);
  parentPort.postMessage({ type: 'done' });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', message: err?.message || String(err) });
});
