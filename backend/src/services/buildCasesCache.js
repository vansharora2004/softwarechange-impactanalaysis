import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsPath = path.resolve(__dirname, '../../../research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_results.json');
const outputPath = path.resolve(__dirname, 'evaluationCasesCache.json');

if (!fs.existsSync(resultsPath)) {
  console.error('Results file not found at:', resultsPath);
  process.exit(1);
}

const rawResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

const repos = {
  'Spring PetClinic REST': 'c:/yashika/STUDY/clg_project/spring-petclinic-rest',
  'Shopizer': 'c:/yashika/STUDY/clg_project/shopizer',
  'Apache Commons Lang': 'c:/yashika/STUDY/clg_project/commons-lang'
};

const commitMap = {};

for (const p of rawResults.projectResults) {
  const repoPath = repos[p.projectName];
  for (const c of p.caseResults) {
    if (!commitMap[c.commitHash]) {
      try {
        const out = execSync(`git log -1 --format="%h|%an|%ad|%s" ${c.commitHash}`, {
          cwd: repoPath,
          encoding: 'utf8'
        }).trim();
        const parts = out.split('|');
        commitMap[c.commitHash] = {
          shortSha: parts[0] || c.commitHash.slice(0, 7),
          author: parts[1] || 'Unknown',
          date: parts[2] || 'Unknown',
          subject: parts.slice(3).join('|') || 'No commit message'
        };
      } catch (err) {
        commitMap[c.commitHash] = {
          shortSha: c.commitHash.slice(0, 7),
          author: 'Unknown',
          date: 'Unknown',
          subject: `Commit ${c.commitHash.slice(0, 7)}`
        };
      }
    }
  }
}

// Now flatten cases
const allCases = [];
for (const p of rawResults.projectResults) {
  for (const c of p.caseResults) {
    const meta = commitMap[c.commitHash] || {
      shortSha: c.commitHash.slice(0, 7),
      author: 'Unknown',
      date: 'Unknown',
      subject: `Commit ${c.commitHash.slice(0, 7)}`
    };

    const shortCompName = c.inputComponent.split('.').pop();

    allCases.push({
      caseId: c.caseId,
      projectName: p.projectName,
      commitHash: c.commitHash,
      commitShortSha: meta.shortSha,
      commitSubject: meta.subject,
      commitAuthor: meta.author,
      commitDate: meta.date,
      commitIndex: c.commitIndex,
      isTrainCommit: c.isTrainCommit,
      split: c.isTrainCommit ? 'train' : 'test',
      inputComponent: c.inputComponent,
      inputComponentName: shortCompName,
      primaryOp: c.primaryOp || 'STRUCTURAL_METHOD_CHANGE',
      targetOraclesCount: (c.targetOracles || []).length,
      targetOracles: c.targetOracles || [],
      candidateUniverseSize: c.candidateUniverseSize || 0,
      metrics: {
        canonical_baseline: c.metrics?.canonical_baseline || {},
        csf_frozen: c.metrics?.csf_frozen || {},
        egcp_v4_combined: c.metrics?.egcp_v4_combined || {}
      }
    });
  }
}

const payload = {
  evaluatedAt: rawResults.evaluatedAt,
  overallSummary: {
    totalCommits: 25,
    totalCases: allCases.length,
    canonical_baseline: rawResults.overallMacroCommits?.canonical_baseline || {},
    csf_frozen: rawResults.overallMacroCommits?.csf_frozen || {},
    egcp_v4_combined: rawResults.overallMacroCommits?.egcp_v4_combined || {},
    test_canonical_baseline: rawResults.testMacroCommits?.canonical_baseline || {},
    test_csf_frozen: rawResults.testMacroCommits?.csf_frozen || {},
    test_egcp_v4_combined: rawResults.testMacroCommits?.egcp_v4_combined || {}
  },
  commits: Object.entries(commitMap).map(([hash, meta]) => ({
    commitHash: hash,
    ...meta
  })),
  cases: allCases
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`Saved ${allCases.length} cases and ${Object.keys(commitMap).length} commits to ${outputPath}`);
