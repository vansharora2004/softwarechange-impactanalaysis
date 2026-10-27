/**
 * diagnoseDiscrepancies.js
 * ------------------------
 * Performs fine-grained case-level diagnostic extraction comparing EGCP v2 against Frozen CSF.
 * For each project, identifies cases where EGCP v2 ranked targets lower than CSF,
 * and extracts:
 *   - Case ID
 *   - Seed/input component
 *   - Target oracle components
 *   - Ranks of targets in CSF vs EGCP v2
 *   - Top false positives ranked above targets in EGCP v2
 *   - False positive graph connectivity (in-degree, hop distance, relationship types)
 *   - Detailed score components (S_evo, S_struct, direct co-change)
 * Outputs:
 *   - research_artifacts/egcp_v2_iteration_20261020/egcp_v2_csf_discrepancy_analysis.json
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  parseGitLogCommits,
  buildComponentPathIndex,
  mapGitChanges,
  isJavaSourceFile
} from '../../services/gitChangeDetector.js';
import { getOrBuildHistoricalGraph } from '../../services/historicalGraphService.js';
import {
  generateStructuralCandidatesInMemory,
  rerankCandidatesWithHistory
} from '../../services/structuralHistoryReranker.js';
import { classifyOperation } from '../../services/occp/operationClassifier.js';
import { extractCandidatePathsFromSeed } from '../../services/occp/pathSignature.js';
import { generateLeaveOneOutCases } from '../v3/metricsV3.js';
import { trainPathModels } from '../../services/occp/occpModel.js';
import { rankModelB_OCCP_ContinuousFusion, DEFAULT_FUSION_WEIGHTS } from '../../services/occp_experiments/occpFusionModel.js';
import { rankModel_EGCP_v2, buildCommitGraphCacheV2 } from '../../services/egcp/v2/egcpV2Model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = path.resolve(BACKEND_ROOT, '..', 'research_artifacts', 'egcp_v2_iteration_20261020');

const PROJECTS = [
  {
    name: 'Spring PetClinic REST',
    path: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest',
    commitLimit: 100
  },
  {
    name: 'Shopizer',
    path: 'c:/yashika/STUDY/clg_project/shopizer',
    commitLimit: 100
  },
  {
    name: 'Apache Commons Lang',
    path: 'c:/yashika/STUDY/clg_project/commons-lang',
    commitLimit: 100
  }
];

function buildLeakFreeHistoryCounts(allCommits, currentCommitIndex, compMap) {
  const historyCounts = new Map();
  const olderCommits = allCommits.slice(currentCommitIndex + 1);

  for (const c of olderCommits) {
    const raw = c.rawChanges || [];
    const mappedIds = new Set();

    for (const r of raw) {
      const p = r.filePath || r.newPath || r.oldPath;
      if (!p || !isJavaSourceFile(p)) continue;
      for (const [id, comp] of compMap.entries()) {
        if (comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath))) {
          mappedIds.add(id);
        }
      }
    }

    const ids = Array.from(mappedIds).sort();
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const k = `${ids[a]}|${ids[b]}`;
        historyCounts.set(k, (historyCounts.get(k) || 0) + 1);
      }
    }
  }

  return historyCounts;
}

function indexHistoricalEpisodesSafe(repoPath, allCommits, maxHops = 2) {
  const episodes = [];
  for (let idx = 0; idx < allCommits.length; idx++) {
    const commit = allCommits[idx];
    if (commit.isMerge || !commit.parents || commit.parents.length === 0) continue;
    const javaChanges = (commit.rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) continue;

    try {
      const graphRes = getOrBuildHistoricalGraph(repoPath, commit.hash);
      const graph = graphRes.graph;
      const compMap = new Map(graph.components.map(c => [c.id, c]));
      const pathIndex = buildComponentPathIndex(graph.components);
      const mapping = mapGitChanges(commit.rawChanges, pathIndex, { perspective: 'pre' });
      const changedCompIds = new Set(mapping.mapped.map(m => m.mappedComponentId).filter(Boolean));
      if (changedCompIds.size === 0) continue;

      const componentEpisodes = [];
      for (const compId of changedCompIds) {
        const comp = compMap.get(compId);
        if (!comp || comp.type === 'Test') continue;

        const rawChange = commit.rawChanges.find(r => {
          const p = r.filePath || r.newPath || r.oldPath;
          return comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath));
        });

        const opClass = classifyOperation(repoPath, graphRes.parentSha, commit.hash, comp.filePath, rawChange);
        const candidatePathsMap = extractCandidatePathsFromSeed(compId, graph, maxHops);

        componentEpisodes.push({
          sourceId: compId,
          sourceType: comp.type,
          opClass,
          candidatePathsMap
        });
      }

      episodes.push({
        commitHash: commit.hash,
        commitIndex: idx,
        parentSha: graphRes.parentSha,
        changedCompIds,
        componentEpisodes
      });
    } catch (e) {}
  }
  return episodes;
}

async function buildHistoricalCasesFast(repoPath, commitLimit = 100) {
  const allCommits = parseGitLogCommits(repoPath, commitLimit, { includeMerges: true });
  const eligibleCommits = [];
  const looCases = [];
  const isTestPath = p => /[\/\\]test[\/\\]/i.test(p) || /Test(s|Case)?\.java$/i.test(p);

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const { hash, subject, isMerge, parents, timestamp, rawChanges } = commit;

    if (isMerge || !parents || parents.length === 0) continue;
    const javaChanges = (rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) continue;

    const nonTestJava = javaChanges.filter(r => !isTestPath(r.filePath || r.newPath || r.oldPath));
    if (nonTestJava.length < 2) continue;

    let historicalGraphResult;
    try {
      historicalGraphResult = getOrBuildHistoricalGraph(repoPath, hash);
    } catch (e) {
      continue;
    }

    const { graph, parentSha } = historicalGraphResult;
    const compMap = new Map(graph.components.map(c => [c.id, c]));
    const pathIndex = buildComponentPathIndex(graph.components);

    const mappingReport = mapGitChanges(rawChanges, pathIndex, { perspective: 'pre' });
    const mappedCompIds = Array.from(new Set(mappingReport.mapped.map(m => m.mappedComponentId).filter(Boolean)));

    const nonTestIds = [];
    const testIds = [];
    for (const id of mappedCompIds) {
      const comp = compMap.get(id);
      if (comp && comp.type === 'Test') testIds.push(id);
      else if (comp) nonTestIds.push(id);
    }

    if (nonTestIds.length < 2) continue;

    const historyCounts = buildLeakFreeHistoryCounts(allCommits, i, compMap);
    const commitInfo = { hash, subject, timestamp, index: i, parentSha };
    const casesForCommit = generateLeaveOneOutCases(commitInfo, nonTestIds, testIds, historyCounts);

    for (const c of casesForCommit) {
      c.parentSha = parentSha;
      c.graphData = graph;
      c.compMap = compMap;
    }

    eligibleCommits.push({
      commitHash: hash,
      parentSha,
      commitSubject: subject,
      caseCount: casesForCommit.length
    });

    looCases.push(...casesForCommit);
  }

  return { eligibleCommits, looCases };
}

function computeAP(rankedList, oracle) {
  if (!oracle || oracle.size === 0) return 0.0;
  const preds = rankedList || [];
  if (preds.length === 0) return 0.0;

  let hits = 0;
  let sumPrecision = 0;
  for (let i = 0; i < preds.length; i++) {
    if (oracle.has(preds[i])) {
      hits++;
      sumPrecision += hits / (i + 1);
    }
  }
  return hits === 0 ? 0.0 : sumPrecision / oracle.size;
}

async function runDiscrepancyDiagnosis() {
  const discrepancyReport = [];

  for (const project of PROJECTS) {
    console.log(`Diagnosing Discrepancies in: ${project.name}`);
    const { eligibleCommits, looCases } = await buildHistoricalCasesFast(project.path, project.commitLimit);
    const allCommits = parseGitLogCommits(project.path, project.commitLimit, { includeMerges: true });
    const historicalEpisodes = indexHistoricalEpisodesSafe(project.path, allCommits, 2);

    const commitCaseMap = new Map();
    for (const tc of looCases) {
      if (!commitCaseMap.has(tc.commitHash)) commitCaseMap.set(tc.commitHash, []);
      commitCaseMap.get(tc.commitHash).push(tc);
    }

    for (const [commitHash, casesInCommit] of commitCaseMap.entries()) {
      const firstCase = casesInCommit[0];
      const { graphData, historyCounts, commitIndex } = firstCase;
      const graphCacheV2 = buildCommitGraphCacheV2(graphData, historyCounts);

      const olderEpisodes = historicalEpisodes.filter(ep => ep.commitIndex > commitIndex);
      const { genericPathStats, conditionedPathStats } = trainPathModels(olderEpisodes);

      for (const testCase of casesInCommit) {
        const { caseId, inputComponent, retroOracle, compMap } = testCase;
        const structuralCandidates = generateStructuralCandidatesInMemory([inputComponent], graphData, 2);

        // CSF
        const candidatePathsMap = extractCandidatePathsFromSeed(inputComponent, graphData, 2);
        const rawChange = (allCommits[commitIndex].rawChanges || []).find(r => {
          const p = r.filePath || r.newPath || r.oldPath;
          const comp = compMap.get(inputComponent);
          return comp && comp.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath));
        });
        const opClass = classifyOperation(project.path, testCase.parentSha, commitHash, compMap.get(inputComponent)?.filePath, rawChange);
        const rankedCSF = rankModelB_OCCP_ContinuousFusion(structuralCandidates, inputComponent, opClass, candidatePathsMap, conditionedPathStats, genericPathStats, historyCounts, DEFAULT_FUSION_WEIGHTS, 0.5);

        // EGCP v2
        const rankedEGCPv2 = rankModel_EGCP_v2(structuralCandidates, inputComponent, graphCacheV2, historyCounts, {
          channelMixingBeta: 0.60,
          degreeDiscountExponent: 0.75
        });

        const csfIds = rankedCSF.map(c => c.id);
        const egcpIds = rankedEGCPv2.map(c => c.id);

        const csfMap = computeAP(csfIds, retroOracle);
        const egcpMap = computeAP(egcpIds, retroOracle);

        // Record cases where CSF is distinctly better (delta > 0.05)
        if (csfMap - egcpMap > 0.05) {
          const targetRanks = [];
          for (const targetId of retroOracle) {
            const csfRank = csfIds.indexOf(targetId) + 1;
            const egcpRank = egcpIds.indexOf(targetId) + 1;
            targetRanks.push({
              targetId,
              csfRank: csfRank > 0 ? csfRank : 'Not Ranked',
              egcpRank: egcpRank > 0 ? egcpRank : 'Not Ranked'
            });
          }

          // Top false positives in EGCP v2 (non-oracle candidates ranked in top 5)
          const egcpTop5 = egcpIds.slice(0, 5);
          const topFalsePositives = [];
          for (const id of egcpTop5) {
            if (!retroOracle.has(id)) {
              const cObj = rankedEGCPv2.find(c => c.id === id);
              const nodeIdx = graphCacheV2.nodeIndex.get(id);
              const inDeg = nodeIdx !== undefined ? graphCacheV2.totalInDegree[nodeIdx] : 0;
              const directCoChange = cObj?.egcp_v2_evoCoChange || 0;
              topFalsePositives.push({
                id,
                egcpRank: egcpIds.indexOf(id) + 1,
                minHop: cObj?.minHop,
                structuralRank: cObj?.structuralBaselineRank,
                inDegree: inDeg,
                egcpScore: cObj?.egcp_v2_score?.toFixed(4),
                structScore: cObj?.egcp_v2_structScore?.toFixed(4),
                evoScore: cObj?.egcp_v2_evoScore?.toFixed(4),
                directCoChange
              });
            }
          }

          discrepancyReport.push({
            project: project.name,
            commitHash: commitHash.slice(0, 7),
            caseId,
            inputComponent,
            oracleSize: retroOracle.size,
            csfMap: Number(csfMap.toFixed(4)),
            egcpMap: Number(egcpMap.toFixed(4)),
            deltaMap: Number((csfMap - egcpMap).toFixed(4)),
            targetRanks,
            topFalsePositives: topFalsePositives.slice(0, 3)
          });
        }
      }
    }
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'egcp_v2_csf_discrepancy_analysis.json'),
    JSON.stringify(discrepancyReport, null, 2),
    'utf8'
  );

  console.log(`\nDiscrepancy Analysis Complete. Found ${discrepancyReport.length} cases where CSF strongly outperforms EGCP v2.`);
  console.log(`Saved report to: ${path.join(OUTPUT_DIR, 'egcp_v2_csf_discrepancy_analysis.json')}`);
}

runDiscrepancyDiagnosis().catch(err => {
  console.error('Error during discrepancy diagnosis:', err);
  process.exit(1);
});
