/**
 * threeWayComparisonTests.js
 * --------------------------
 * Unit test suite verifying the 3-Way Comparative Impact Analysis service:
 *   - Universe preservation (|C_model| = |C_canonical|)
 *   - Model A (Baseline), Model B (CSF), Model C (EGCP v4) execution
 *   - Rank shifts and pairwise overlap alignment
 *   - Historical evaluation cases retrieval and execution
 *   - Co-change evidence extraction
 */

import assert from 'assert';
import {
  runThreeWayImpactAnalysis,
  getEvaluationCases,
  runHistoricalEvaluationCase,
  getCoChangeEvidenceForComponent,
  getBenchmarkSummary,
  loadActiveGraph
} from '../services/threeWayComparisonService.js';

console.log('=== Three-Way Model Comparison Test Suite ===\n');

async function runTests() {
  const activeGraph = loadActiveGraph();
  assert(activeGraph.components.length > 0, 'Active graph must contain components');

  // Test 1: Candidate Universe Equivalence
  console.log('Test 1: Candidate Universe Equivalence');
  const seedId = 'org.springframework.samples.petclinic.rest.controller.v1.OwnerRestControllerV1';
  const res = await runThreeWayImpactAnalysis([seedId], {
    repoPath: 'c:/yashika/STUDY/clg_project/spring-petclinic-rest'
  });

  assert.strictEqual(res.success, true, 'Analysis must succeed');
  assert(res.candidateUniverseSize > 0, 'Candidate universe must be non-empty');
  assert.strictEqual(res.baselineOutput.length, res.candidateUniverseSize, 'Baseline candidate count must equal universe size');
  assert.strictEqual(res.csfOutput.length, res.candidateUniverseSize, 'CSF candidate count must equal universe size');
  assert.strictEqual(res.egcpOutput.length, res.candidateUniverseSize, 'EGCP v4 candidate count must equal universe size');
  assert.strictEqual(res.alignedCandidates.length, res.candidateUniverseSize, 'Aligned candidate matrix must contain all candidates');
  console.log(`  ✓ Candidate universe strictly preserved across all 3 models (${res.candidateUniverseSize} candidates)\n`);

  // Test 2: Multi-Model Scoring and Rank Differentiation
  console.log('Test 2: Multi-Model Scoring and Rank Differentiation');
  const b1 = res.baselineOutput[0];
  const csf1 = res.csfOutput[0];
  const egcp1 = res.egcpOutput[0];

  assert(b1.rank === 1, 'Baseline must have rank 1');
  assert(csf1.rank === 1 && typeof csf1.score === 'number', 'CSF must have rank 1 with numeric fusion score');
  assert(egcp1.rank === 1 && typeof egcp1.score === 'number', 'EGCP v4 must have rank 1 with numeric fused score');
  assert(typeof egcp1.structuralScore === 'number', 'EGCP v4 must expose structural channel score');
  assert(typeof egcp1.evolutionaryScore === 'number', 'EGCP v4 must expose evolutionary channel score');
  console.log(`  ✓ Baseline Top 1: ${b1.name} (Rank 1)`);
  console.log(`  ✓ CSF Top 1:      ${csf1.name} (Score ${csf1.score})`);
  console.log(`  ✓ EGCP v4 Top 1:  ${egcp1.name} (Score ${egcp1.score})\n`);

  // Test 3: Aligned Matrix and Overlap Summary
  console.log('Test 3: Aligned Matrix and Overlap Summary');
  const comp = res.comparisonSummary;
  assert(typeof comp.sharedAllThreeCount === 'number', 'Summary must include sharedAllThreeCount');
  assert(typeof comp.pairwiseOverlap.baseline_csf_top5 === 'number', 'Summary must include baseline_csf_top5');
  assert(typeof comp.pairwiseOverlap.baseline_egcp_top5 === 'number', 'Summary must include baseline_egcp_top5');
  assert(typeof comp.pairwiseOverlap.csf_egcp_top5 === 'number', 'Summary must include csf_egcp_top5');
  assert(Array.isArray(comp.rankShifts), 'Summary must include rank shifts array');

  // Verify rank shift math
  const firstShift = comp.rankShifts[0];
  assert.strictEqual(firstShift.egcpVsBaselineShift, (firstShift.baselineRank - firstShift.egcpRank), 'Rank shift must equal (baselineRank - egcpRank)');
  console.log(`  ✓ Overlaps: Base∩CSF Top 5 = ${comp.pairwiseOverlap.baseline_csf_top5}, Base∩EGCP Top 5 = ${comp.pairwiseOverlap.baseline_egcp_top5}, CSF∩EGCP Top 5 = ${comp.pairwiseOverlap.csf_egcp_top5}`);
  console.log('  ✓ Verified exact rank shift arithmetic\n');

  // Test 4: Historical Evaluation Cases Retrieval
  console.log('Test 4: Historical Evaluation Cases Retrieval');
  const allCasesRes = getEvaluationCases();
  assert.strictEqual(allCasesRes.success, true, 'Cases fetch must succeed');
  assert.strictEqual(allCasesRes.cases.length, 170, 'Must contain exactly 170 frozen evaluation cases');
  assert.strictEqual(allCasesRes.commits.length, 25, 'Must contain exactly 25 evaluated commits');

  const petCases = getEvaluationCases({ projectName: 'Spring PetClinic REST' });
  assert.strictEqual(petCases.cases.length, 57, 'PetClinic must have 57 cases');

  const shopizerCases = getEvaluationCases({ projectName: 'Shopizer' });
  assert.strictEqual(shopizerCases.cases.length, 46, 'Shopizer must have 46 cases');

  const commonsCases = getEvaluationCases({ projectName: 'Apache Commons Lang' });
  assert.strictEqual(commonsCases.cases.length, 67, 'Commons Lang must have 67 cases');
  console.log('  ✓ Verified exact 170-case distribution (57 PetClinic + 46 Shopizer + 67 Commons Lang)\n');

  // Test 5: Historical Case Execution with Ground-Truth Hits
  console.log('Test 5: Historical Case Execution with Ground-Truth Hits');
  const sampleCase = petCases.cases[0];
  const caseRun = await runHistoricalEvaluationCase(sampleCase.caseId);

  assert.strictEqual(caseRun.success, true, 'Historical case run must succeed');
  assert.strictEqual(caseRun.caseInfo.caseId, sampleCase.caseId);
  assert(Array.isArray(caseRun.groundTruth), 'Must expose ground truth array');
  assert.strictEqual(caseRun.groundTruth.length, sampleCase.targetOraclesCount, 'Ground truth count must match targetOraclesCount');

  // Check worked mathematical calculation
  const we = caseRun.workedExample;
  assert(we && Array.isArray(we.steps), 'Must provide step-by-step worked precision accumulation');
  assert(we.steps.length > 0, 'Worked example steps must be non-empty');
  assert(typeof we.summary.averagePrecision === 'number', 'Summary must include numeric AP');
  assert(typeof we.summary.reciprocalRank === 'number', 'Summary must include numeric RR');
  console.log(`  ✓ Case: ${sampleCase.caseId}`);
  console.log(`  ✓ Ground Truth Targets: ${caseRun.groundTruth.length}`);
  console.log(`  ✓ Worked Example AP: ${we.summary.averagePrecision.toFixed(4)}, Reciprocal Rank: ${we.summary.reciprocalRank.toFixed(4)}\n`);

  // Test 6: Historical Co-Change Evidence
  console.log('Test 6: Historical Co-Change Evidence');
  const evoRes = getCoChangeEvidenceForComponent('OwnerRestControllerV1', 'c:/yashika/STUDY/clg_project/spring-petclinic-rest');
  assert.strictEqual(evoRes.success, true, 'Co-change evidence fetch must succeed');
  assert(Array.isArray(evoRes.coChangedComponents), 'Must return coChangedComponents array');
  assert(evoRes.coChangedComponents.length > 0, 'OwnerRestControllerV1 must have co-changed components');
  const topCoChange = evoRes.coChangedComponents[0];
  assert(typeof topCoChange.count === 'number', 'Co-change must have count');
  assert(typeof topCoChange.normalizedFrequency === 'number', 'Co-change must have normalized frequency');
  console.log(`  ✓ Extracted ${evoRes.coChangedComponents.length} historical co-change associations`);
  console.log(`  ✓ Top co-changed file: ${topCoChange.name} (${topCoChange.count} commits, freq: ${topCoChange.normalizedFrequency})\n`);

  // Test 7: Benchmark Summary Retrieval
  console.log('Test 7: Benchmark Summary Retrieval');
  const benchSum = getBenchmarkSummary();
  assert.strictEqual(benchSum.success, true, 'Benchmark summary fetch must succeed');
  assert.strictEqual(benchSum.commitsCount, 25, 'Benchmark summary commits count must be 25');
  assert.strictEqual(benchSum.casesCount, 170, 'Benchmark summary cases count must be 170');
  assert(benchSum.overallSummary.egcp_v4_combined.map > benchSum.overallSummary.csf_frozen.map, 'EGCP v4 MAP must exceed CSF MAP');
  console.log(`  ✓ Overall EGCP v4 MAP: ${benchSum.overallSummary.egcp_v4_combined.map.toFixed(4)} vs CSF: ${benchSum.overallSummary.csf_frozen.map.toFixed(4)}\n`);

  console.log('====================================================');
  console.log('ALL THREE-WAY COMPARISON UNIT TESTS PASSED! (7 / 7)');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
