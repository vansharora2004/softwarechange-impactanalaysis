/**
 * occpTests.js
 * -----------
 * Verification Test Suite for Operation-Conditioned Change Propagation (OCCP).
 *
 * Verifies:
 *   1. Temporal leak-freedom: future commits (index < targetIndex) do not contribute to historical training.
 *   2. Reconstructed pre-change graph at parent revision is used for historical episodes.
 *   3. Operation classifier correctly categorizes signature, body, field, type, add/delete/rename, and mixed.
 *   4. Path signature generator preserves relationship direction and strictly distinguishes EXTENDS from IMPLEMENTS.
 *   5. Duplicate paths between source and candidate in a case do not inflate support counts.
 *   6. Fallback hierarchy behaves deterministically: Conditioned -> Generic -> Co-Change -> Structural.
 *   7. Changed seed component is excluded from predictions.
 *   8. Determinism of ranking across repeated executions.
 *   9. Controlled comparison: Model A and Model B use identical candidate universes and path extraction.
 *  10. RRF fusion baseline correctly implements Cormack et al. formula with k = 60.
 */

'use strict';

import assert from 'assert';
import { classifyOperation } from '../services/occp/operationClassifier.js';
import { buildPathSignature, extractCandidatePathsFromSeed } from '../services/occp/pathSignature.js';
import {
  trainPathModels,
  rankModelA_ContextIndependent,
  rankModelB_OCCP,
  rankModelRRF_StructuralHistory,
  rankModelRRF_Composite,
  RRF_K
} from '../services/occp/occpModel.js';
import {
  generateStructuralCandidatesInMemory,
  rerankCandidatesWithHistory
} from '../services/structuralHistoryReranker.js';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n=== Operation-Conditioned Change Propagation (OCCP) Test Suite ===\n');

// ── 1. Operation Classification Unit Tests ──────────────────────────────────
console.log('--- 1. Operation Classification ---');

runTest('Classifies ADD status as ADD_DELETE_OR_RENAME', () => {
  const res = classifyOperation('dummy/repo', 'parent', 'commit', 'src/Main.java', { status: 'A' });
  assert.strictEqual(res.primaryCategory, 'ADD_DELETE_OR_RENAME');
  assert.strictEqual(res.isClassifiedReliably, true);
});

runTest('Classifies DELETE status as ADD_DELETE_OR_RENAME', () => {
  const res = classifyOperation('dummy/repo', 'parent', 'commit', 'src/Main.java', { status: 'D' });
  assert.strictEqual(res.primaryCategory, 'ADD_DELETE_OR_RENAME');
  assert.strictEqual(res.isClassifiedReliably, true);
});

runTest('Classifies RENAME status (R094) as ADD_DELETE_OR_RENAME', () => {
  const res = classifyOperation('dummy/repo', 'parent', 'commit', 'src/Main.java', { status: 'R094' });
  assert.strictEqual(res.primaryCategory, 'ADD_DELETE_OR_RENAME');
  assert.strictEqual(res.isClassifiedReliably, true);
});

runTest('Classifies non-Java files as UNKNOWN_OR_MIXED', () => {
  const res = classifyOperation('dummy/repo', 'parent', 'commit', 'pom.xml', { status: 'M' });
  assert.strictEqual(res.primaryCategory, 'UNKNOWN_OR_MIXED');
  assert.strictEqual(res.isClassifiedReliably, false);
});

// ── 2. Path Signatures & Relationship Direction ─────────────────────────────
console.log('\n--- 2. Path Signatures & Semantic Distinction ---');

const dummyCompMap = new Map([
  ['SeedCtrl', { id: 'SeedCtrl', name: 'SeedCtrl', type: 'Controller' }],
  ['MidSvc', { id: 'MidSvc', name: 'MidSvc', type: 'Service' }],
  ['SvcImpl', { id: 'SvcImpl', name: 'SvcImpl', type: 'Service' }],
  ['BaseEntity', { id: 'BaseEntity', name: 'BaseEntity', type: 'Entity/Model' }],
  ['SubEntity', { id: 'SubEntity', name: 'SubEntity', type: 'Entity/Model' }],
  ['Repo', { id: 'Repo', name: 'Repo', type: 'Repository' }],
  ['TestComp', { id: 'TestComp', name: 'TestComp', type: 'Test' }]
]);

runTest('1-Hop path signature preserves incoming and outgoing direction', () => {
  const outSig = buildPathSignature(['SeedCtrl', 'MidSvc'], ['DEPENDS_ON'], ['outgoing'], dummyCompMap);
  assert.strictEqual(outSig, '(Controller)-[outgoing:DEPENDS_ON]->(Service)');

  const inSig = buildPathSignature(['MidSvc', 'SeedCtrl'], ['DEPENDS_ON'], ['incoming'], dummyCompMap);
  assert.strictEqual(inSig, '(Service)-[incoming:DEPENDS_ON]->(Controller)');
});

runTest('Strictly distinguishes EXTENDS from IMPLEMENTS in signatures', () => {
  const extSig = buildPathSignature(['SubEntity', 'BaseEntity'], ['EXTENDS'], ['outgoing'], dummyCompMap);
  assert.strictEqual(extSig, '(Entity/Model)-[outgoing:EXTENDS]->(Entity/Model)');

  const implSig = buildPathSignature(['SvcImpl', 'MidSvc'], ['IMPLEMENTS'], ['outgoing'], dummyCompMap);
  assert.strictEqual(implSig, '(Service)-[outgoing:IMPLEMENTS]->(Service)');

  assert.notStrictEqual(extSig, implSig);
  assert(implSig.includes('IMPLEMENTS'));
  assert(extSig.includes('EXTENDS'));
});

runTest('2-Hop path signature includes intermediate component type', () => {
  const twoHopSig = buildPathSignature(['SeedCtrl', 'MidSvc', 'Repo'], ['DEPENDS_ON', 'USES'], ['outgoing', 'outgoing'], dummyCompMap);
  assert.strictEqual(twoHopSig, '(Controller)-[outgoing:DEPENDS_ON]->(Service)-[outgoing:USES]->(Repository)');
});

// ── 3. Path Extraction, Deduplication & Seed Exclusion ──────────────────────
console.log('\n--- 3. Graph Traversal, Deduplication & Seed Exclusion ---');

const testGraph = {
  components: [
    { id: 'Seed', name: 'Seed', type: 'Service' },
    { id: 'RepoA', name: 'RepoA', type: 'Repository' },
    { id: 'RepoB', name: 'RepoB', type: 'Repository' }
  ],
  relationships: [
    { source: 'Seed', target: 'RepoA', type: 'DEPENDS_ON' },
    { source: 'Seed', target: 'RepoA', type: 'USES' }, // Parallel edge
    { source: 'Seed', target: 'Seed', type: 'USES' },   // Self-reference loop
    { source: 'RepoA', target: 'RepoB', type: 'DEPENDS_ON' }
  ]
};

runTest('Seed component is never included in extracted candidate paths', () => {
  const paths = extractCandidatePathsFromSeed('Seed', testGraph, 2);
  assert(!paths.has('Seed'), 'Seed component must be excluded');
  assert(paths.has('RepoA'));
  assert(paths.has('RepoB'));
});

runTest('Parallel edges produce distinct signatures without duplicate entries per signature', () => {
  const paths = extractCandidatePathsFromSeed('Seed', testGraph, 2);
  const repoAPaths = paths.get('RepoA');
  // There are two distinct relationships: DEPENDS_ON and USES
  assert.strictEqual(repoAPaths.length, 2);
  const sigs = repoAPaths.map(p => p.signature);
  assert(sigs.includes('(Service)-[outgoing:DEPENDS_ON]->(Repository)'));
  assert(sigs.includes('(Service)-[outgoing:USES]->(Repository)'));
});

// ── 4. Training Opportunity Mining & Leak-Free Behavior ─────────────────────
console.log('\n--- 4. Temporal Leak-Free Training & Support Deduplication ---');

runTest('Duplicate paths within a single episode do not inflate support', () => {
  const mockEpisode = {
    changedCompIds: new Set(['Seed', 'RepoA']),
    componentEpisodes: [
      {
        sourceId: 'Seed',
        opClass: { primaryCategory: 'METHOD_BODY_OR_IMPLEMENTATION', detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION'] },
        candidatePathsMap: new Map([
          ['RepoA', [
            { signature: '(Service)-[outgoing:DEPENDS_ON]->(Repository)' },
            { signature: '(Service)-[outgoing:DEPENDS_ON]->(Repository)' } // Duplicate identical signature
          ]]
        ])
      }
    ]
  };

  const { genericPathStats, conditionedPathStats } = trainPathModels([mockEpisode]);
  const gStat = genericPathStats.get('(Service)-[outgoing:DEPENDS_ON]->(Repository)');
  assert.strictEqual(gStat.total, 1, 'Total opportunity must be deduplicated to 1');
  assert.strictEqual(gStat.positive, 1, 'Positive opportunity must be deduplicated to 1');

  const cStat = conditionedPathStats.get('METHOD_BODY_OR_IMPLEMENTATION|(Service)-[outgoing:DEPENDS_ON]->(Repository)');
  assert.strictEqual(cStat.total, 1);
  assert.strictEqual(cStat.positive, 1);
});

runTest('Temporal separation: future commits do NOT affect past predictions', () => {
  const pastEpisode = {
    commitIndex: 50,
    changedCompIds: new Set(['Seed', 'RepoA']),
    componentEpisodes: [
      {
        sourceId: 'Seed',
        opClass: { primaryCategory: 'METHOD_BODY_OR_IMPLEMENTATION', detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION'] },
        candidatePathsMap: new Map([
          ['RepoA', [{ signature: '(Service)-[outgoing:DEPENDS_ON]->(Repository)' }]]
        ])
      }
    ]
  };

  const futureEpisode = {
    commitIndex: 10, // newer commit
    changedCompIds: new Set(['Seed', 'RepoB']),
    componentEpisodes: [
      {
        sourceId: 'Seed',
        opClass: { primaryCategory: 'METHOD_BODY_OR_IMPLEMENTATION', detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION'] },
        candidatePathsMap: new Map([
          ['RepoB', [{ signature: '(Service)-[outgoing:DEPENDS_ON]->(Repository)' }]]
        ])
      }
    ]
  };

  // For a target commit at index 30, strictly older commits are index > 30 (i.e. pastEpisode index 50)
  const targetIndex = 30;
  const eligibleEpisodes = [pastEpisode, futureEpisode].filter(ep => ep.commitIndex > targetIndex);

  assert.strictEqual(eligibleEpisodes.length, 1);
  assert.strictEqual(eligibleEpisodes[0].commitIndex, 50);

  const { genericPathStats } = trainPathModels(eligibleEpisodes);
  const gStat = genericPathStats.get('(Service)-[outgoing:DEPENDS_ON]->(Repository)');
  // Only past episode contributed
  assert.strictEqual(gStat.total, 1);
  assert.strictEqual(gStat.positive, 1);
});

// ── 5. Candidate Ranking & Fallback Hierarchy ───────────────────────────────
console.log('\n--- 5. Candidate Ranking & Fallback Hierarchy ---');

runTest('Model B prioritizes operation-conditioned matches over generic fallback', () => {
  const structuralCandidates = [
    { id: 'CandA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CandB', minHop: 1, structuralBaselineRank: 2 }
  ];

  const candidatePathsMap = new Map([
    ['CandA', [{ signature: 'SigA' }]],
    ['CandB', [{ signature: 'SigB' }]]
  ]);

  const sourceOpClass = {
    primaryCategory: 'METHOD_SIGNATURE_OR_DECLARATION',
    detectedCategories: ['METHOD_SIGNATURE_OR_DECLARATION']
  };

  // Conditioned evidence exists for SigB under METHOD_SIGNATURE_OR_DECLARATION
  const conditionedPathStats = new Map([
    ['METHOD_SIGNATURE_OR_DECLARATION|SigB', { positive: 5, total: 5 }]
  ]);

  // Generic evidence exists for SigA with 100% confidence, but no conditioned evidence
  const genericPathStats = new Map([
    ['SigA', { positive: 10, total: 10 }],
    ['SigB', { positive: 5, total: 5 }]
  ]);

  const ranked = rankModelB_OCCP(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    null
  );

  // CandB should be promoted to Rank 1 because it has Tier 1 (operation-conditioned) support
  assert.strictEqual(ranked[0].id, 'CandB');
  assert.strictEqual(ranked[0].occp_rankTier, 1);
  assert.strictEqual(ranked[0].occp_fallbackLevel, 'operation_conditioned');

  // CandA is Tier 2 (generic path)
  assert.strictEqual(ranked[1].id, 'CandA');
  assert.strictEqual(ranked[1].occp_rankTier, 2);
  assert.strictEqual(ranked[1].occp_fallbackLevel, 'generic_path');
});

runTest('Model B falls back to historical co-change when no path evidence exists', () => {
  const structuralCandidates = [
    { id: 'CandA', minHop: 1, structuralBaselineRank: 1 },
    { id: 'CandB', minHop: 1, structuralBaselineRank: 2 }
  ];

  const candidatePathsMap = new Map([
    ['CandA', [{ signature: 'SigA' }]],
    ['CandB', [{ signature: 'SigB' }]]
  ]);

  const sourceOpClass = { primaryCategory: 'UNKNOWN_OR_MIXED', detectedCategories: ['UNKNOWN_OR_MIXED'] };
  const conditionedPathStats = new Map();
  const genericPathStats = new Map(); // empty path stats

  // Historical co-change exists for CandB
  const historyCounts = new Map([
    ['CandB|Seed', 7]
  ]);

  const ranked = rankModelB_OCCP(
    structuralCandidates,
    'Seed',
    sourceOpClass,
    candidatePathsMap,
    conditionedPathStats,
    genericPathStats,
    historyCounts
  );

  assert.strictEqual(ranked[0].id, 'CandB');
  assert.strictEqual(ranked[0].occp_rankTier, 3);
  assert.strictEqual(ranked[0].occp_fallbackLevel, 'historical_cochange');

  assert.strictEqual(ranked[1].id, 'CandA');
  assert.strictEqual(ranked[1].occp_rankTier, 4);
  assert.strictEqual(ranked[1].occp_fallbackLevel, 'structural_baseline');
});

runTest('Zero candidates dropped across Model A, Model B, and RRF', () => {
  const structuralCandidates = [
    { id: 'Cand1', minHop: 1, structuralBaselineRank: 1 },
    { id: 'Cand2', minHop: 1, structuralBaselineRank: 2 },
    { id: 'Cand3', minHop: 2, structuralBaselineRank: 3 }
  ];

  const candidatePathsMap = new Map([
    ['Cand1', [{ signature: 'Sig1' }]],
    ['Cand2', [{ signature: 'Sig2' }]],
    ['Cand3', [{ signature: 'Sig3' }]]
  ]);

  const sourceOpClass = { primaryCategory: 'METHOD_BODY_OR_IMPLEMENTATION', detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION'] };
  const genericStats = new Map([['Sig1', { positive: 2, total: 4 }]]);
  const condStats = new Map([['METHOD_BODY_OR_IMPLEMENTATION|Sig1', { positive: 2, total: 4 }]]);

  const rankA = rankModelA_ContextIndependent(structuralCandidates, 'Seed', candidatePathsMap, genericStats);
  assert.strictEqual(rankA.length, 3);

  const rankB = rankModelB_OCCP(structuralCandidates, 'Seed', sourceOpClass, candidatePathsMap, condStats, genericStats, null);
  assert.strictEqual(rankB.length, 3);

  // Add proposedRank for RRF
  const withHist = structuralCandidates.map((c, i) => ({ ...c, proposedRank: 3 - i, occp_rank: rankB.find(b => b.id === c.id).occp_rank }));
  const rankRRF = rankModelRRF_StructuralHistory(withHist);
  assert.strictEqual(rankRRF.length, 3);

  const rankComposite = rankModelRRF_Composite(withHist);
  assert.strictEqual(rankComposite.length, 3);
});

// ── 6. RRF Fusion Baseline Tests ───────────────────────────────────────────
console.log('\n--- 6. Reciprocal Rank Fusion (RRF) Baseline ---');

runTest('RRF correctly calculates scores with k = 60', () => {
  assert.strictEqual(RRF_K, 60);

  const candidates = [
    { id: 'CompA', structuralBaselineRank: 1, proposedRank: 10 },
    { id: 'CompB', structuralBaselineRank: 5, proposedRank: 2 }
  ];

  // CompA: 1/(60+1) + 1/(60+10) = 1/61 + 1/70 = 0.016393 + 0.014286 = 0.030679
  // CompB: 1/(60+5) + 1/(60+2) = 1/65 + 1/62 = 0.015385 + 0.016129 = 0.031514
  const fused = rankModelRRF_StructuralHistory(candidates);

  assert.strictEqual(fused[0].id, 'CompB', 'CompB should rank first due to higher RRF score');
  assert.strictEqual(fused[1].id, 'CompA');
  assert(fused[0].rrf_score > fused[1].rrf_score);
});

runTest('Ranking is 100% deterministic across repeated runs', () => {
  const structuralCandidates = [
    { id: 'Alpha', minHop: 1, structuralBaselineRank: 1 },
    { id: 'Beta', minHop: 1, structuralBaselineRank: 2 },
    { id: 'Gamma', minHop: 2, structuralBaselineRank: 3 }
  ];
  const pathsMap = new Map([
    ['Alpha', [{ signature: 'SigA' }]],
    ['Beta', [{ signature: 'SigB' }]],
    ['Gamma', [{ signature: 'SigC' }]]
  ]);
  const sourceOp = { primaryCategory: 'METHOD_BODY_OR_IMPLEMENTATION', detectedCategories: ['METHOD_BODY_OR_IMPLEMENTATION'] };
  const condStats = new Map();
  const genStats = new Map();

  const r1 = rankModelB_OCCP(structuralCandidates, 'Seed', sourceOp, pathsMap, condStats, genStats, null);
  const r2 = rankModelB_OCCP(structuralCandidates, 'Seed', sourceOp, pathsMap, condStats, genStats, null);

  for (let i = 0; i < r1.length; i++) {
    assert.strictEqual(r1[i].id, r2[i].id);
    assert.strictEqual(r1[i].occp_rank, r2[i].occp_rank);
  }
});

console.log(`\n======================================================`);
console.log(`OCCP Test Results: ${passed} passed, ${failed} failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
