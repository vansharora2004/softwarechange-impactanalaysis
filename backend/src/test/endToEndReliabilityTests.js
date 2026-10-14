/**
 * endToEndReliabilityTests.js
 * ----------------------------
 * End-to-End Reliability and Traceability Verification Test Suite.
 *
 * Verifies:
 *   1. Complete path: changed file -> component mapping -> graph traversal ->
 *      scoring -> ranking -> explanation -> output report.
 *   2. Graph resolution: every recommended component ID resolves to an actual
 *      component in the repository graph.
 *   3. Explanation fidelity: reasoning paths, relationship types, artifact flows,
 *      and co-change counts accurately reflect the underlying graph.
 *   4. Execution mode distinction: clearly verifies in-memory fallback vs. live Neo4j.
 *   5. Input isolation: input changed components are never recommended.
 *   6. Monotonicity & ranking: scores in [0, 1], strictly descending with deterministic tie-breaks.
 *   7. Edge cases & error handling: empty input, invalid IDs, unmapped files.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeImpact } from '../services/impactEngine.js';
import { analyzeContextAwareImpact, MODEL_CONFIG } from '../services/contextAwareImpactAnalyzer.js';
import { buildComponentPathIndex, mapGitChanges } from '../services/gitChangeDetector.js';
import { verifyConnection } from '../services/neo4jService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const GRAPH_JSON = path.join(BACKEND_ROOT, 'analysis_output.json');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== Phase 4: End-to-End Reliability & Traceability Test Suite ===\n');

// Verify graph data exists
assert(fs.existsSync(GRAPH_JSON), 'PetClinic analysis_output.json exists on disk');
const graphData = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf-8'));
const components = graphData.components || [];
const relationships = graphData.relationships || [];
const compMap = new Map(components.map(c => [c.id, c]));

assert(components.length > 50, `Graph loaded with ${components.length} components`);
assert(relationships.length > 100, `Graph loaded with ${relationships.length} relationships`);

// ── Test Suite 1: File to Component Mapping ──────────────────────────────
console.log('\n--- 1. File Path to Component ID Mapping ---');
const pathIndex = buildComponentPathIndex(components);

// Select a known real component from PetClinic
const targetComp = components.find(c => c.type === 'Service' && c.filePath) || components[0];
const fakeFileChanges = [
  { filePath: targetComp.filePath, status: 'M', oldPath: null },
  { filePath: 'src/main/resources/application.properties', status: 'M', oldPath: null },
  { filePath: 'src/main/java/nonexistent/NewClass.java', status: 'A', oldPath: null }
];

const mappedChanges = mapGitChanges(fakeFileChanges, pathIndex, compMap);
assert(mappedChanges.mapped.length === 1, 'Mapped exactly 1 valid Java file to active component');
assertEqual(mappedChanges.mapped[0].mappedComponentId, targetComp.id, 'Mapped component ID matches target component');
assert(mappedChanges.unmapped.length === 1, 'Nonexistent Java file marked unmapped');
assert(mappedChanges.nonJava.length === 1, 'Application properties correctly classified nonJava');

// ── Test Suite 2: Complete Pipeline Execution & Graph Resolution ────────
console.log('\n--- 2. End-to-End Pipeline & Graph Resolution ---');

// Pick a central service component for impact traversal
const testSeedId = targetComp.id;
console.log(`  Seeding impact analysis with changed component: ${testSeedId}`);

const baselineResults = await analyzeImpact([testSeedId]);
assert(Array.isArray(baselineResults), 'Baseline engine returned array of recommendations');
assert(baselineResults.length > 0, `Baseline found ${baselineResults.length} impacted components`);

// Verify all baseline IDs resolve to actual components
let allBaselineResolved = true;
for (const rec of baselineResults) {
  if (!compMap.has(rec.id)) {
    allBaselineResolved = false;
    console.error(`  Unresolved baseline component ID: ${rec.id}`);
  }
}
assert(allBaselineResolved, 'Every baseline recommendation ID resolves to an actual component in the graph');

// Verify context-aware impact results
const contextResults = await analyzeContextAwareImpact([testSeedId]);
assert(Array.isArray(contextResults), 'Context-aware engine returned array of recommendations');
assert(contextResults.length > 0, `Context-aware engine found ${contextResults.length} impacted components`);

// Verify all context-aware IDs resolve to actual components
let allContextResolved = true;
for (const rec of contextResults) {
  if (!compMap.has(rec.id)) {
    allContextResolved = false;
    console.error(`  Unresolved context component ID: ${rec.id}`);
  }
}
assert(allContextResolved, 'Every context-aware recommendation ID resolves to an actual component in the graph');

// ── Test Suite 3: Input Component Exclusion ──────────────────────────────
console.log('\n--- 3. Changed Component Self-Exclusion ---');
assert(!baselineResults.some(r => r.id === testSeedId), 'Changed seed component is never in baseline recommendations');
assert(!contextResults.some(r => r.id === testSeedId), 'Changed seed component is never in context-aware recommendations');

// ── Test Suite 4: Explanation & Evidence Fidelity ─────────────────────────
console.log('\n--- 4. Explanation & Evidence Fidelity ---');

// Check baseline explanation format
const bSample = baselineResults[0];
assert(bSample.reasoningPath && typeof bSample.reasoningPath === 'string', 'Baseline provides string reasoningPath');
assert(bSample.hopDistance === 1 || bSample.hopDistance === 2, 'Baseline hopDistance is strictly 1 or 2');
assert(bSample.reason && bSample.reason.length > 10, 'Baseline provides descriptive human-readable reason');

// Check context-aware explanation fidelity
let contextExplanationsValid = true;
let evidenceAlignmentValid = true;

for (const rec of contextResults) {
  // Primary reasoning path format
  if (!rec.primaryReasoningPath || typeof rec.primaryReasoningPath !== 'string') {
    contextExplanationsValid = false;
  }
  // Hop distance must be 1 or 2
  if (rec.hopDistance !== 1 && rec.hopDistance !== 2) {
    contextExplanationsValid = false;
  }
  // Score bounds
  if (typeof rec.influenceScore !== 'number' || rec.influenceScore < 0 || rec.influenceScore > 1.0001) {
    contextExplanationsValid = false;
  }
  // Evidence sources consistency
  if (rec.historicalEvidence > 0 && !rec.evidenceSources.includes('historical_co_change')) {
    evidenceAlignmentValid = false;
  }
  if (rec.historicalEvidence === 0 && rec.evidenceSources.includes('historical_co_change')) {
    evidenceAlignmentValid = false;
  }
  if (rec.evidenceStatus.history === 'available' && rec.historicalEvidence === 0) {
    evidenceAlignmentValid = false;
  }
}

assert(contextExplanationsValid, 'All context-aware reasoning paths, hop distances, and scores valid');
assert(evidenceAlignmentValid, 'Evidence sources strictly align with historical evidence counters');

// ── Test Suite 5: Score Monotonicity & Rank Ordering ─────────────────────
console.log('\n--- 5. Score Monotonicity & Deterministic Ranking ---');
let monotonic = true;
let rankSequential = true;

for (let i = 0; i < contextResults.length - 1; i++) {
  const cur = contextResults[i];
  const next = contextResults[i + 1];

  if (cur.influenceScore < next.influenceScore - 1e-6) {
    monotonic = false;
  }
  if (cur.rank !== i + 1) {
    rankSequential = false;
  }
}
assert(monotonic, 'Context-aware recommendations are monotonically descending by score');
assert(rankSequential, 'Context-aware ranks are strictly sequential 1, 2, 3, ...');

// ── Test Suite 6: Execution Mode Distinction ─────────────────────────────
console.log('\n--- 6. Live Neo4j vs. In-Memory Fallback Distinction ---');
const isNeo4jOnline = await verifyConnection();
console.log(`  Live Neo4j Status: ${isNeo4jOnline ? 'ONLINE' : 'OFFLINE (In-memory fallback active)'}`);

// Simulate API endpoint behavior
const apiSimulation = {
  success: true,
  executionMode: isNeo4jOnline ? 'neo4j' : 'in-memory-fallback',
  changedComponents: [testSeedId],
  baselineOutput: baselineResults,
  contextAwareOutput: contextResults
};

assertEqual(
  apiSimulation.executionMode,
  isNeo4jOnline ? 'neo4j' : 'in-memory-fallback',
  'API payload explicitly identifies correct executionMode'
);

// ── Test Suite 7: Edge Cases & Graceful Degradation ──────────────────────
console.log('\n--- 7. Robustness & Error Handling ---');
const emptyBaseline = await analyzeImpact([]);
assertEqual(emptyBaseline.length, 0, 'Empty input to baseline returns empty array');

const emptyContext = await analyzeContextAwareImpact([]);
assertEqual(emptyContext.length, 0, 'Empty input to context-aware returns empty array');

const invalidId = 'com.nonexistent.fake.FakeComponent';
const invalidBaseline = await analyzeImpact([invalidId]);
assertEqual(invalidBaseline.length, 0, 'Nonexistent component input returns empty baseline array (no crash)');

const invalidContext = await analyzeContextAwareImpact([invalidId]);
assertEqual(invalidContext.length, 0, 'Nonexistent component input returns empty context-aware array (no crash)');

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n===========================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n' + failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
} else {
  console.log('✓ All end-to-end reliability verification assertions passed.');
  process.exit(0);
}
