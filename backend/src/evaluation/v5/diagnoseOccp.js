/**
 * diagnoseOccp.js
 * ---------------
 * Detailed diagnostic script to extract empirical evidence on OCCP weaknesses
 * across Spring PetClinic REST, Shopizer, and Commons Lang:
 *   1. Operation classification distribution (primary & detected).
 *   2. Path coverage & observation frequency (1 observation vs >= 2 vs >= 5).
 *   3. Candidate universe size and fallback tier usage.
 *   4. Impact of UNKNOWN_OR_MIXED on path lookup.
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
import { buildHistoricalCases } from '../v4/historicalCaseBuilder.js';
import { classifyOperation, OPERATION_TAXONOMY } from '../../services/occp/operationClassifier.js';
import { extractCandidatePathsFromSeed } from '../../services/occp/pathSignature.js';
import { trainPathModels } from '../../services/occp/occpModel.js';

const REPOS = [
  { name: 'Spring PetClinic REST', path: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest' },
  { name: 'Shopizer', path: 'c:/yashika/STUDY/clg_project/shopizer' },
  { name: 'Apache Commons Lang', path: 'c:/yashika/STUDY/clg_project/commons-lang' }
];

async function diagnoseRepo(repo) {
  console.log(`\n======================================================`);
  console.log(`Diagnosing ${repo.name}`);
  console.log(`======================================================`);

  const caseBuild = await buildHistoricalCases(repo.path, 100);
  const { eligibleCommits, looCases } = caseBuild;
  const allCommits = parseGitLogCommits(repo.path, 100, { includeMerges: true });

  // 1. Operation classification stats
  const opCounts = {};
  for (const cat of OPERATION_TAXONOMY) opCounts[cat] = 0;
  let totalCases = looCases.length;
  let multiCategoryCount = 0;

  for (const c of looCases) {
    const comp = c.compMap.get(c.inputComponent);
    const commitObj = allCommits.find(cm => cm.hash === c.commitHash);
    const rawChange = commitObj?.rawChanges?.find(r => {
      const p = r.filePath || r.newPath || r.oldPath;
      return comp?.filePath && (comp.filePath.endsWith(p) || p.endsWith(comp.filePath));
    });

    const opClass = classifyOperation(repo.path, c.parentSha, c.commitHash, comp ? comp.filePath : '', rawChange);
    opCounts[opClass.primaryCategory] = (opCounts[opClass.primaryCategory] || 0) + 1;
    if (opClass.detectedCategories && opClass.detectedCategories.length > 1) {
      multiCategoryCount++;
    }
  }

  // 2. Index historical episodes
  const episodes = [];
  for (let idx = 0; idx < allCommits.length; idx++) {
    const commit = allCommits[idx];
    if (commit.isMerge || !commit.parents || commit.parents.length === 0) continue;
    const javaChanges = (commit.rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) continue;

    try {
      const graphRes = getOrBuildHistoricalGraph(repo.path, commit.hash);
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

        const opClass = classifyOperation(repo.path, graphRes.parentSha, commit.hash, comp.filePath, rawChange);
        const candidatePathsMap = extractCandidatePathsFromSeed(compId, graph, 2);

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

  // Train on full history to see global statistics
  const { genericPathStats, conditionedPathStats } = trainPathModels(episodes);

  // Distribution of total observations per conditioned path
  let condObs1 = 0, condObs2 = 0, condObs3to5 = 0, condObsGt5 = 0;
  let condPos0 = 0, condPosGt0 = 0;
  for (const [k, v] of conditionedPathStats.entries()) {
    if (v.total === 1) condObs1++;
    else if (v.total === 2) condObs2++;
    else if (v.total <= 5) condObs3to5++;
    else condObsGt5++;

    if (v.positive === 0) condPos0++;
    else condPosGt0++;
  }

  // Distribution of generic paths
  let genObs1 = 0, genObs2 = 0, genObs3to5 = 0, genObsGt5 = 0;
  for (const [k, v] of genericPathStats.entries()) {
    if (v.total === 1) genObs1++;
    else if (v.total === 2) genObs2++;
    else if (v.total <= 5) genObs3to5++;
    else genObsGt5++;
  }

  console.log(`Eligible Commits: ${eligibleCommits.length}, LOO Cases: ${totalCases}`);
  console.log(`Historical Episodes: ${episodes.length}`);
  console.log(`Operation Classification Breakdown:`, opCounts);
  console.log(`Multi-Category Cases: ${multiCategoryCount} / ${totalCases} (${((multiCategoryCount/totalCases)*100).toFixed(1)}%)`);
  console.log(`Conditioned Paths: ${conditionedPathStats.size} total`);
  console.log(`  Total=1: ${condObs1}, Total=2: ${condObs2}, Total 3-5: ${condObs3to5}, Total > 5: ${condObsGt5}`);
  console.log(`  Positive > 0: ${condPosGt0}, Positive = 0: ${condPos0}`);
  console.log(`Generic Paths: ${genericPathStats.size} total`);
  console.log(`  Total=1: ${genObs1}, Total=2: ${genObs2}, Total 3-5: ${genObs3to5}, Total > 5: ${genObsGt5}`);

  return {
    repoName: repo.name,
    eligibleCommits: eligibleCommits.length,
    looCases: totalCases,
    episodes: episodes.length,
    opCounts,
    multiCategoryCount,
    conditionedPathsTotal: conditionedPathStats.size,
    condObsDistribution: { total1: condObs1, total2: condObs2, total3to5: condObs3to5, totalGt5: condObsGt5 },
    condPositiveDistribution: { posGt0: condPosGt0, pos0: condPos0 },
    genericPathsTotal: genericPathStats.size,
    genObsDistribution: { total1: genObs1, total2: genObs2, total3to5: genObs3to5, totalGt5: genObsGt5 }
  };
}

async function main() {
  const results = [];
  for (const r of REPOS) {
    results.push(await diagnoseRepo(r));
  }

  const outPath = path.resolve('..', 'research_artifacts', 'occp_diagnosis_data.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nWrote diagnosis data to: ${outPath}`);
}

main().catch(err => console.error(err));
