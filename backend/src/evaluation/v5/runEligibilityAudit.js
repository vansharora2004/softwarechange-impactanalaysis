import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  parseGitLogCommits,
  buildComponentPathIndex,
  mapGitChanges,
  isJavaSourceFile
} from '../../services/gitChangeDetector.js';
import {
  getOrBuildHistoricalGraph,
  getParentRevision
} from '../../services/historicalGraphService.js';

const projects = [
  { name: 'Spring PetClinic REST', path: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest' },
  { name: 'Shopizer', path: 'c:/yashika/STUDY/clg_project/shopizer' },
  { name: 'Apache Commons Lang', path: 'c:/yashika/STUDY/clg_project/commons-lang' }
];

const isTestPath = p => /[\/\\]test[\/\\]/i.test(p) || /Test(s|Case)?\.java$/i.test(p);

const auditRecords = [];

for (const p of projects) {
  console.log(`\n======================================================`);
  console.log(`Auditing Eligibility: ${p.name}`);
  console.log(`======================================================`);
  const allCommits = parseGitLogCommits(p.path, 100, { includeMerges: true });
  console.log(`Total inspected commits: ${allCommits.length}`);

  let merges = 0;
  let noJava = 0;
  let testOnly = 0;
  let singleNonTest = 0;
  let eligibleCount = 0;
  let graphFailed = 0;

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const { hash, subject, isMerge, parents, timestamp, rawChanges } = commit;

    if (isMerge) {
      merges++;
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'EXCLUDED',
        rule: 'E1_MERGE_COMMIT',
        reason: 'Merge commit',
        nonTestJavaCount: 0,
        caseCount: 0,
        subject
      });
      continue;
    }

    if (!parents || parents.length === 0) {
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'EXCLUDED',
        rule: 'E9_ROOT_COMMIT',
        reason: 'Root commit',
        nonTestJavaCount: 0,
        caseCount: 0,
        subject
      });
      continue;
    }

    const javaChanges = (rawChanges || []).filter(r => isJavaSourceFile(r.filePath || r.newPath || r.oldPath));
    if (javaChanges.length === 0) {
      noJava++;
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'EXCLUDED',
        rule: 'E2_E3_E4_NO_JAVA',
        reason: 'No Java files modified',
        nonTestJavaCount: 0,
        caseCount: 0,
        subject
      });
      continue;
    }

    const nonTestJava = javaChanges.filter(r => !isTestPath(r.filePath || r.newPath || r.oldPath));
    if (nonTestJava.length === 0) {
      testOnly++;
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'EXCLUDED',
        rule: 'E7_TEST_ONLY',
        reason: 'Test-only changes',
        nonTestJavaCount: 0,
        caseCount: 0,
        subject
      });
      continue;
    }

    if (nonTestJava.length === 1) {
      singleNonTest++;
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'EXCLUDED',
        rule: 'E8_SINGLE_NON_TEST',
        reason: 'Only 1 non-test Java file modified',
        nonTestJavaCount: 1,
        caseCount: 0,
        subject
      });
      continue;
    }

    // Now check historical graph mapping
    try {
      const graphRes = getOrBuildHistoricalGraph(p.path, hash);
      const graph = graphRes.graph;
      const compMap = new Map(graph.components.map(c => [c.id, c]));
      const pathIndex = buildComponentPathIndex(graph.components);
      const mappingReport = mapGitChanges(rawChanges, pathIndex, { perspective: 'pre' });
      const mappedCompIds = Array.from(new Set(mappingReport.mapped.map(m => m.mappedComponentId).filter(Boolean)));

      const mappedNonTests = [];
      for (const id of mappedCompIds) {
        const comp = compMap.get(id);
        if (comp && comp.type !== 'Test') {
          mappedNonTests.push(id);
        }
      }

      if (mappedNonTests.length < 2) {
        singleNonTest++;
        auditRecords.push({
          project: p.name,
          commitHash: hash.substring(0, 10),
          status: 'EXCLUDED',
          rule: 'E8_SINGLE_NON_TEST_MAPPED',
          reason: `Mapped < 2 non-test components in pre-change graph (${mappedNonTests.length})`,
          nonTestJavaCount: nonTestJava.length,
          caseCount: 0,
          subject
        });
        continue;
      }

      eligibleCount++;
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'ELIGIBLE',
        rule: 'INCLUDED',
        reason: 'Passed all eligibility criteria',
        nonTestJavaCount: mappedNonTests.length,
        caseCount: mappedNonTests.length,
        subject
      });

      console.log(`  [ELIGIBLE] ${hash.substring(0, 10)} (${mappedNonTests.length} components, ${mappedNonTests.length} cases): "${subject.substring(0, 60)}"`);

    } catch (e) {
      graphFailed++;
      auditRecords.push({
        project: p.name,
        commitHash: hash.substring(0, 10),
        status: 'EXCLUDED',
        rule: 'E_GRAPH_FAILED',
        reason: e.message,
        nonTestJavaCount: nonTestJava.length,
        caseCount: 0,
        subject
      });
    }
  }

  console.log(`Summary for ${p.name}:`);
  console.log(`  Merges: ${merges}`);
  console.log(`  No Java: ${noJava}`);
  console.log(`  Test Only: ${testOnly}`);
  console.log(`  Single Non-Test: ${singleNonTest}`);
  console.log(`  Graph Failed: ${graphFailed}`);
  console.log(`  Eligible Commits: ${eligibleCount}`);
}

// Write dataset_eligibility_audit.csv
const csvRows = ['Project,CommitHash,Status,Rule,NonTestJavaCount,CaseCount,Reason,Subject'];
for (const r of auditRecords) {
  const cleanSubject = `"${(r.subject || '').replace(/"/g, '""')}"`;
  const cleanReason = `"${(r.reason || '').replace(/"/g, '""')}"`;
  csvRows.push(`${r.project},${r.commitHash},${r.status},${r.rule},${r.nonTestJavaCount},${r.caseCount},${cleanReason},${cleanSubject}`);
}

const outDir = 'c:/yashika/STUDY/clg_project/software_change/research_artifacts/occp_final_verification_20261020';
fs.writeFileSync(path.join(outDir, 'dataset_eligibility_audit.csv'), csvRows.join('\n'), 'utf8');
console.log(`\nWritten dataset_eligibility_audit.csv with ${auditRecords.length} records.`);
