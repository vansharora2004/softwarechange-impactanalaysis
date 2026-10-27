/**
 * egcpLiveServiceTests.js
 * -----------------------
 * Automated tests for live EGCP v4 service integration and model comparison.
 */

'use strict';

import assert from 'assert';
import { runLiveEGCPv4, runComparativeImpactAnalysis, extractLiveEvolutionaryHistory } from '../services/egcpLiveService.js';

console.log('\n=== EGCP v4 Live Service Integration Test Suite ===\n');

async function runTests() {
  let passed = 0;

  // Test 1: Reject empty seed inputs
  try {
    await runLiveEGCPv4([]);
    assert.fail('Should have thrown on empty seed input');
  } catch (err) {
    assert.strictEqual(err.message, 'Please provide at least one changed seed component.');
    console.log('  ✓ Test 1: Empty seed inputs rejected with 400 error message');
    passed++;
  }

  // Test 2: Live extraction of evolutionary history from PetClinic
  const testRepo = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';
  const sampleComp = [
    { id: 'org.springframework.samples.petclinic.service.ClinicServiceImpl', filePath: 'src/main/java/org/springframework/samples/petclinic/service/ClinicServiceImpl.java' },
    { id: 'org.springframework.samples.petclinic.service.ClinicService', filePath: 'src/main/java/org/springframework/samples/petclinic/service/ClinicService.java' }
  ];
  const evoRes = extractLiveEvolutionaryHistory(testRepo, sampleComp, 50);
  assert.strictEqual(evoRes.status.available, true);
  assert(evoRes.status.commitsCount > 0, 'Commits should be parsed from git');
  console.log(`  ✓ Test 2: Live git history extracted (${evoRes.status.commitsCount} commits, ${evoRes.status.coChangePairsCount} pairs)`);
  passed++;

  // Test 3: Missing git directory handled gracefully without crashing
  const missingEvo = extractLiveEvolutionaryHistory('C:/non_existent_repo_dir', sampleComp, 10);
  assert.strictEqual(missingEvo.status.available, false);
  assert(missingEvo.status.reason.includes('not found'), 'Missing directory explains unavailability');
  console.log('  ✓ Test 3: Missing repository gracefully reports unavailable status without crashing');
  passed++;

  // Test 4: Live EGCP v4 scoring and deterministic ranking on ClinicServiceImpl
  const seed = ['org.springframework.samples.petclinic.service.ClinicServiceImpl'];
  const egcpRes = await runLiveEGCPv4(seed, { repoPath: testRepo });
  assert.strictEqual(egcpRes.success, true);
  assert.strictEqual(egcpRes.modelUsed, 'egcp_v4_combined');
  assert(egcpRes.potentiallyImpactedComponents.length > 0, 'Should return ranked candidates');

  // Verify rank ordering and fields
  const first = egcpRes.potentiallyImpactedComponents[0];
  assert.strictEqual(first.egcp_v4_rank, 1);
  assert(typeof first.egcp_v4_score === 'number');
  assert(first.reason.includes('EGCP v4 Rank #1'));
  console.log(`  ✓ Test 4: Live EGCP v4 produces ${egcpRes.potentiallyImpactedComponents.length} ranked candidates (Top: ${first.name}, score: ${first.egcp_v4_score})`);
  passed++;

  // Test 5: Comparative Impact Analysis executes both baseline and EGCP v4 on identical seeds
  const compRes = await runComparativeImpactAnalysis(seed, { repoPath: testRepo });
  assert.strictEqual(compRes.success, true);
  assert.strictEqual(compRes.model, 'compare');
  assert(Array.isArray(compRes.baselineOutput), 'Baseline output array present');
  assert(Array.isArray(compRes.egcpOutput), 'EGCP output array present');
  assert(compRes.comparison.totalCandidates > 0, 'Candidates compared');
  assert(Array.isArray(compRes.comparison.rankDeltas), 'Rank deltas computed');
  console.log(`  ✓ Test 5: Comparative mode runs both models (Common: ${compRes.comparison.commonCount}, Promoted: ${compRes.comparison.promotedCount}, Demoted: ${compRes.comparison.demotedCount})`);
  passed++;

  console.log(`\n===========================================================`);
  console.log(`Live Service Tests: ${passed} passed, 0 failed`);
  console.log(`===========================================================\n`);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
