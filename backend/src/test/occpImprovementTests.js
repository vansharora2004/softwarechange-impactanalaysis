/**
 * occpImprovementTests.js
 * -----------------------
 * Unit test suite for OCCP Improvement Experiments:
 *   1. Smoothed probabilities (Laplace / Additive)
 *   2. Minimum-support thresholding
 *   3. Continuous score fusion
 *   4. Combined variant
 *
 * Verifies mathematical properties, fallback logic, deterministic sorting,
 * and strict conservation of the candidate universe.
 */

'use strict';

import {
  computeSmoothedProbability,
  rankModelB_OCCP_Smoothed
} from '../services/occp_experiments/occpSmoothedModel.js';
import { rankModelB_OCCP_Threshold } from '../services/occp_experiments/occpThresholdModel.js';
import {
  rankModelB_OCCP_ContinuousFusion,
  DEFAULT_FUSION_WEIGHTS
} from '../services/occp_experiments/occpFusionModel.js';
import { rankModelB_OCCP_Combined } from '../services/occp_experiments/occpCombinedModel.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertClose(actual, expected, tol = 1e-4, message = '') {
  const diff = Math.abs(actual - expected);
  assert(diff <= tol, `${message} (expected ~${expected}, got ${actual})`);
}

console.log('=== Running OCCP Improvement Unit Tests ===\n');

// ── Test 1: Smoothed Probability Calculations ──────────────────────────────
console.log('Test 1: Smoothed Probability Calculations');
{
  // Lambda = 0 (Empirical MLE)
  assertClose(computeSmoothedProbability(1, 1, 0), 1.0, 1e-6, 'lambda=0 gives 1/1 = 1.0');
  assertClose(computeSmoothedProbability(19, 20, 0), 0.95, 1e-6, 'lambda=0 gives 19/20 = 0.95');

  // Lambda = 0.5
  // 1/1 -> (1 + 0.5) / (1 + 1.0) = 1.5 / 2.0 = 0.75
  assertClose(computeSmoothedProbability(1, 1, 0.5), 0.75, 1e-6, 'lambda=0.5 shrinks 1/1 to 0.75');
  // 19/20 -> (19 + 0.5) / (20 + 1.0) = 19.5 / 21.0 = 0.92857
  assertClose(computeSmoothedProbability(19, 20, 0.5), 19.5 / 21.0, 1e-6, 'lambda=0.5 shrinks 19/20 to ~0.9286');

  // Key inversion fix: 19/20 (0.9286) > 1/1 (0.75) under smoothing!
  assert(
    computeSmoothedProbability(19, 20, 0.5) > computeSmoothedProbability(1, 1, 0.5),
    'Smoothing correctly prioritizes 19/20 over 1/1'
  );

  // Lambda = 1.0 (Laplace Rule of Succession)
  // 1/1 -> 2/3 = 0.6667
  assertClose(computeSmoothedProbability(1, 1, 1.0), 2 / 3, 1e-6, 'lambda=1.0 gives 1/1 -> 2/3');
  // 19/20 -> 20/22 = 0.9091
  assertClose(computeSmoothedProbability(19, 20, 1.0), 20 / 22, 1e-6, 'lambda=1.0 gives 19/20 -> 20/22');

  // Boundary checks
  assert(computeSmoothedProbability(0, 0, 0.5) === 0, 'total=0 returns 0');
  assert(computeSmoothedProbability(0, 5, 0.5) === 0.5 / 6.0, 'positive=0 returns lambda/(total+2lambda)');
}

// ── Test 2: Smoothed OCCP Model Ranking & Candidate Universe Conservation ──
console.log('\nTest 2: Smoothed OCCP Model Ranking');
{
  const structuralCandidates = [
    { id: 'CompA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CompB', minHop: 1, structuralBaselineRank: 2 },
    { id: 'CompC', minHop: 2, structuralBaselineRank: 3 }
  ];

  const candidatePathsMap = new Map([
    ['CompA', [{ signature: 'sig_1' }]],
    ['CompB', [{ signature: 'sig_2' }]],
    ['CompC', [{ signature: 'sig_3' }]]
  ]);

  const sourceOpClass = { primaryCategory: 'SIGNATURE_CHANGE', detectedCategories: ['SIGNATURE_CHANGE'] };

  // CompA has 1 observation: 1 positive / 1 total (empirical MLE = 100%)
  // CompB has 20 observations: 19 positive / 20 total (empirical MLE = 95%)
  // CompC has 0 observations
  const conditionedPathStats = new Map([
    ['SIGNATURE_CHANGE|sig_1', { positive: 1, total: 1 }],
    ['SIGNATURE_CHANGE|sig_2', { positive: 19, total: 20 }]
  ]);
  const genericPathStats = new Map();
  const historyCounts = new Map();

  const rankedSmoothed = rankModelB_OCCP_Smoothed(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    0.5
  );

  assert(rankedSmoothed.length === 3, 'Preserves all 3 candidates');
  assert(rankedSmoothed[0].id === 'CompB', 'CompB (19/20) ranks #1 ahead of CompA (1/1) under lambda=0.5');
  assert(rankedSmoothed[1].id === 'CompA', 'CompA ranks #2');
  assert(rankedSmoothed[2].id === 'CompC', 'CompC ranks #3 (structural baseline fallback)');
  assert(rankedSmoothed[2].occp_fallbackLevel === 'structural_baseline', 'CompC falls back to Tier 4');
}

// ── Test 3: Minimum Support Thresholding & Fallback Verification ───────────
console.log('\nTest 3: Minimum-Support Threshold Model');
{
  const structuralCandidates = [
    { id: 'CompA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CompB', minHop: 1, structuralBaselineRank: 2 },
    { id: 'CompC', minHop: 1, structuralBaselineRank: 3 }
  ];

  const candidatePathsMap = new Map([
    ['CompA', [{ signature: 'sig_rare' }]],
    ['CompB', [{ signature: 'sig_frequent' }]],
    ['CompC', [{ signature: 'sig_none' }]]
  ]);

  const sourceOpClass = { primaryCategory: 'BODY_LOGIC', detectedCategories: ['BODY_LOGIC'] };

  // CompA has total = 1 (fails threshold M = 2)
  // CompB has total = 4 (passes threshold M = 2)
  const conditionedPathStats = new Map([
    ['BODY_LOGIC|sig_rare', { positive: 1, total: 1 }],
    ['BODY_LOGIC|sig_frequent', { positive: 3, total: 4 }]
  ]);
  // CompA has generic path total = 3 (passes generic threshold M = 2)
  const genericPathStats = new Map([
    ['sig_rare', { positive: 2, total: 3 }]
  ]);
  // In historicalGraphService, keys are sorted: 'CompC' < 'Seed'
  const historyCounts = new Map([['CompC|Seed', 5]]);

  const rankedThreshold = rankModelB_OCCP_Threshold(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    2 // M = 2
  );

  assert(rankedThreshold.length === 3, 'Preserves all 3 candidates');
  assert(rankedThreshold[0].id === 'CompB', 'CompB is in Tier 1 (conditioned support >= 2)');
  assert(rankedThreshold[0].occp_rankTier === 1, 'CompB has rankTier = 1');
  assert(rankedThreshold[1].id === 'CompA', 'CompA falls back to Tier 2 (generic support >= 2)');
  assert(rankedThreshold[1].occp_rankTier === 2, 'CompA has rankTier = 2');
  assert(rankedThreshold[2].id === 'CompC', 'CompC falls back to Tier 3 (co-change > 0)');
  assert(rankedThreshold[2].occp_rankTier === 3, 'CompC has rankTier = 3');
}

// ── Test 4: Continuous Score Fusion Model ──────────────────────────────────
console.log('\nTest 4: Continuous Score Fusion Model');
{
  const structuralCandidates = [
    { id: 'CompA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CompB', minHop: 1, structuralBaselineRank: 2 },
    { id: 'CompC', minHop: 1, structuralBaselineRank: 3 }
  ];

  const candidatePathsMap = new Map([
    ['CompA', [{ signature: 'sig_1' }]],
    ['CompB', [{ signature: 'sig_2' }]],
    ['CompC', []]
  ]);

  const sourceOpClass = { primaryCategory: 'BODY_LOGIC', detectedCategories: ['BODY_LOGIC'] };
  const conditionedPathStats = new Map([
    ['BODY_LOGIC|sig_1', { positive: 1, total: 1 }]
  ]);
  const genericPathStats = new Map();
  // In historicalGraphService, keys are sorted: 'CompB' < 'Seed'
  const historyCounts = new Map([
    ['CompB|Seed', 10]
  ]);

  const rankedFusion = rankModelB_OCCP_ContinuousFusion(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    DEFAULT_FUSION_WEIGHTS,
    0.5
  );

  assert(rankedFusion.length === 3, 'Preserves all 3 candidates');
  assert(typeof rankedFusion[0].fusion_score === 'number', 'Assigns numeric fusion_score');
  assert(rankedFusion[0].fusion_score >= rankedFusion[1].fusion_score, 'Ranks by fusion_score descending');
  assert(rankedFusion[1].fusion_score >= rankedFusion[2].fusion_score, 'Ranks correctly across all candidates');

  // Check that all scores are in [0, 1]
  for (const c of rankedFusion) {
    assert(c.fusion_score >= 0 && c.fusion_score <= 1.0, `Score for ${c.id} in [0, 1]: ${c.fusion_score}`);
  }
}

// ── Test 5: Combined Model ────────────────────────────────────────────────
console.log('\nTest 5: Combined Variant (Smoothing + Threshold)');
{
  const structuralCandidates = [
    { id: 'CompA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CompB', minHop: 1, structuralBaselineRank: 2 }
  ];

  const candidatePathsMap = new Map([
    ['CompA', [{ signature: 'sig_1' }]],
    ['CompB', [{ signature: 'sig_2' }]]
  ]);

  const sourceOpClass = { primaryCategory: 'BODY_LOGIC', detectedCategories: ['BODY_LOGIC'] };
  const conditionedPathStats = new Map([
    ['BODY_LOGIC|sig_1', { positive: 5, total: 5 }],
    ['BODY_LOGIC|sig_2', { positive: 1, total: 1 }] // fails M=2
  ]);
  const genericPathStats = new Map();
  const historyCounts = new Map();

  const rankedCombined = rankModelB_OCCP_Combined(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    { lambda: 0.5, minSupport: 2 }
  );

  assert(rankedCombined.length === 2, 'Preserves all candidates');
  assert(rankedCombined[0].id === 'CompA', 'CompA meets M=2 and is Tier 1');
  assert(rankedCombined[0].occp_rankTier === 1, 'CompA in Tier 1');
  assert(rankedCombined[1].id === 'CompB', 'CompB fails M=2 and falls back');
  assert(rankedCombined[1].occp_rankTier === 4, 'CompB in Tier 4');
}

// ── Test 6: Enhanced OCCP Dominant Operation Resolution & Support Weighting ──
console.log('\nTest 6: Enhanced OCCP Operation Dominance & Support Weighting');
{
  const { resolveDominantOperation, computeSupportWeight, rankModelB_OCCP_Enhanced } = await import('../services/occp_experiments/occpEnhancedModel.js');

  // Dominant resolution test
  const mixedOp = {
    primaryCategory: 'UNKNOWN_OR_MIXED',
    detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION', 'TYPE_OR_INHERITANCE'],
    hunkCounts: {
      METHOD_BODY_OR_IMPLEMENTATION: 18,
      TYPE_OR_INHERITANCE: 2
    }
  };
  const resolved = resolveDominantOperation(mixedOp, 0.70);
  assert(resolved.primaryCategory === 'METHOD_BODY_OR_IMPLEMENTATION', 'Resolves dominant operation when >= 70% (18/20 = 90%)');
  assert(resolved.isDominant === true, 'Sets isDominant = true');

  // Balanced mixed op should remain UNKNOWN_OR_MIXED
  const balancedOp = {
    primaryCategory: 'UNKNOWN_OR_MIXED',
    detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION', 'METHOD_SIGNATURE_OR_DECLARATION'],
    hunkCounts: {
      METHOD_BODY_OR_IMPLEMENTATION: 5,
      METHOD_SIGNATURE_OR_DECLARATION: 5
    }
  };
  const unresolved = resolveDominantOperation(balancedOp, 0.70);
  assert(unresolved.primaryCategory === 'UNKNOWN_OR_MIXED', 'Retains UNKNOWN_OR_MIXED when 50/50 balanced');

  // Support weight test: tot / (tot + 2)
  assertClose(computeSupportWeight(0, 2), 0.0, 1e-6, 'total=0 returns weight 0.0');
  assertClose(computeSupportWeight(1, 2), 1 / 3, 1e-6, 'total=1 returns weight 1/3 ~ 0.333');
  assertClose(computeSupportWeight(10, 2), 10 / 12, 1e-6, 'total=10 returns weight 10/12 ~ 0.833');
}

// ── Test 7: Enhanced OCCP Model Ranking ────────────────────────────────────
console.log('\nTest 7: Enhanced OCCP Model Ranking & Universe Preservation');
{
  const { rankModelB_OCCP_Enhanced, ENHANCED_CONFIG } = await import('../services/occp_experiments/occpEnhancedModel.js');

  const structuralCandidates = [
    { id: 'CompA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CompB', minHop: 1, structuralBaselineRank: 2 },
    { id: 'CompC', minHop: 2, structuralBaselineRank: 3 }
  ];

  const candidatePathsMap = new Map([
    ['CompA', [{ signature: 'sig_1' }]],
    ['CompB', [{ signature: 'sig_2' }]],
    ['CompC', []]
  ]);

  const sourceOpClass = {
    primaryCategory: 'UNKNOWN_OR_MIXED',
    detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION', 'TYPE_OR_INHERITANCE'],
    hunkCounts: { METHOD_BODY_OR_IMPLEMENTATION: 19, TYPE_OR_INHERITANCE: 1 }
  };

  const conditionedPathStats = new Map([
    ['METHOD_BODY_OR_IMPLEMENTATION|sig_1', { positive: 1, total: 1 }],
    ['METHOD_BODY_OR_IMPLEMENTATION|sig_2', { positive: 10, total: 10 }]
  ]);
  const genericPathStats = new Map();
  const historyCounts = new Map([['CompC|Seed', 5]]);

  const rankedEnhanced = rankModelB_OCCP_Enhanced(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts,
    ENHANCED_CONFIG
  );

  assert(rankedEnhanced.length === 3, 'Preserves all 3 candidates');
  assert(rankedEnhanced[0].occp_enhanced_rank === 1, 'Rank 1 is assigned');
  assert(rankedEnhanced[1].occp_enhanced_rank === 2, 'Rank 2 is assigned');
  assert(rankedEnhanced[0].id === 'CompC', 'CompC with high historical co-change (5/5) ranks #1 under balanced fusion');
  assert(rankedEnhanced[1].id === 'CompB', 'CompB with 10 observations beats CompA with 1 observation due to support shrinkage');
  assert(rankedEnhanced[2].id === 'CompA', 'CompA with 1 observation ranks #3');
}

console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All OCCP Improvement Unit Tests Passed Successfully!\n');
}
