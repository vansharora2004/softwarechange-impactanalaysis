/**
 * audit_probe.js - Audit probe for evalHarness scientific correctness
 * Run: node src/evaluation/audit_probe.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(BACKEND, 'evaluation_results.json'), 'utf-8'));
const graph = JSON.parse(fs.readFileSync(path.join(BACKEND, 'analysis_output.json'), 'utf-8'));

const components = graph.components;
const relationships = graph.relationships;

// ─── AUDIT 1: Oracle construction — relationship types used ────────────────
console.log('\n══════ AUDIT 1: Oracle Relationship Types ══════');
const STRUCT = new Set(['DEPENDS_ON','USES','TESTS']);
const relTypeCounts = {};
for (const r of relationships) {
  relTypeCounts[r.type] = (relTypeCounts[r.type] || 0) + 1;
}
console.log('All rel types in analysis_output.json:', JSON.stringify(relTypeCounts, null, 2));
console.log('Oracle uses ONLY:', [...STRUCT].join(', '));
console.log('Context-aware engine uses: DEPENDS_ON, USES, TESTS, IMPLEMENTS, EXTENDS');
console.log('MISMATCH: Oracle excludes IMPLEMENTS/EXTENDS — but these are in analysis_output anyway?',
  Object.keys(relTypeCounts).filter(t => ['IMPLEMENTS','EXTENDS'].includes(t)));

// ─── AUDIT 2: Prediction count breakdown ──────────────────────────────────
console.log('\n══════ AUDIT 2: Prediction Count vs Oracle Size ══════');
console.log('caseId                | oracle | testOr | base | ctx  | noHist | noArt | FP_ctx');
console.log('-'.repeat(90));
for (const cr of data.caseResults) {
  const fp_ctx = cr.context_full.fp;
  console.log(
    `${cr.caseId.padEnd(22)}| ${String(cr.oracleSize).padStart(6)} | ${String(cr.testOracleSize).padStart(6)} | ${String(cr.baseline.predicted.length).padStart(4)} | ${String(cr.context_full.predicted.length).padStart(4)} | ${String(cr.context_no_history.predicted.length).padStart(6)} | ${String(cr.context_no_artifact.predicted.length).padStart(5)} | ${String(fp_ctx).padStart(6)}`
  );
}

// ─── AUDIT 3: Ablation scores — do feature switches actually change scores? ─
console.log('\n══════ AUDIT 3: Ablation Score Comparison for case_59_d6c1fb1 (Owner changed) ══════');
// Manually re-run for case_59 with detailed per-component score logging
const case59 = data.caseResults.find(c => c.caseId === 'case_59_d6c1fb1');
console.log('Changed IDs:', case59.changedIds);
console.log('Oracle (main):', case59._oracleMain.slice(0, 10), '...');

// Check predicted IDs match across ablations
const ids_full   = new Set(case59.context_full.predicted);
const ids_nohist = new Set(case59.context_no_history.predicted);
const ids_noart  = new Set(case59.context_no_artifact.predicted);
const ids_baseline = new Set(case59.baseline.predicted);

const diff_full_nohist = [...ids_full].filter(x => !ids_nohist.has(x));
const diff_full_noart  = [...ids_full].filter(x => !ids_noart.has(x));
console.log('Pred in full but NOT in no-history:', diff_full_nohist.length === 0 ? '(none - IDENTICAL)' : diff_full_nohist);
console.log('Pred in full but NOT in no-artifact:', diff_full_noart.length === 0 ? '(none - IDENTICAL)' : diff_full_noart);

// Additional check for case_0 (ClinicServiceImpl)
console.log('\n══════ AUDIT 3b: Ablation for case_0_d413204 (ClinicServiceImpl) ══════');
const case0 = data.caseResults.find(c => c.caseId === 'case_0_d413204');
const c0_ids_full   = new Set(case0.context_full.predicted);
const c0_ids_nohist = new Set(case0.context_no_history.predicted);
const c0_ids_noart  = new Set(case0.context_no_artifact.predicted);
const c0_diff_nohist = [...c0_ids_full].filter(x => !c0_ids_nohist.has(x));
const c0_diff_noart  = [...c0_ids_full].filter(x => !c0_ids_noart.has(x));
console.log('Pred in full but NOT in no-history:', c0_diff_nohist.length === 0 ? '(none - IDENTICAL)' : c0_diff_nohist);
console.log('Pred in full but NOT in no-artifact:', c0_diff_noart.length === 0 ? '(none - IDENTICAL)' : c0_diff_noart);
console.log('History window size (case_0):', case0._historyWindowSize, 'pairs');

// ─── AUDIT 3c: WHY ablations produce identical results ────────────────────
console.log('\n══════ AUDIT 3c: Why Ablations Are Identical — Score Analysis ══════');
// The context-aware engine uses score to RANK, not to FILTER.
// Any candidate with score > 0 appears in predictions.
// Ablation only reduces scores — if reduced scores are still > 0, predictions don't change.
// TESTS rel has weight 0.0, so pathRelWeight=0, baseInfluence=0 for TESTS-only paths.
// But such candidates still have score ≥ 0 (from artifact/history) OR are set to score=1.0
// if category=Regression Tests. Since extractIds filters OUT Regression Tests,
// the question is: does disabling history/artifact change score to 0 for any candidate?

// Find the artifact weights that are > 0
const artWeights = data.caseResults[0]; // just checking config
console.log('Artifact weights:', JSON.stringify(data.modelConfig.artifactContextWeights, null, 2));
console.log('Alpha:', data.modelConfig.alpha, '  Beta:', data.modelConfig.beta);
console.log('Hop weights:', JSON.stringify(data.modelConfig.hopWeights));
console.log('relWeights:', JSON.stringify(data.modelConfig.relWeights));
console.log('\nKey insight: TESTS rel has weight 0.0 in context-aware.');
console.log('So for TESTS-only 1-hop path: baseInfluence = hopWeight(1)*relWeight(TESTS) = 1.0 * 0.0 = 0.0');
console.log('Score = alpha*0 + beta*context. If context=0 (no art, no hist), score=0.');
console.log('BUT category is set to Regression Tests and score is overridden to 1.0.');
console.log('extractIds EXCLUDES Regression Tests. So they never appear in main predictions.');
console.log('Does context-aware engine score DEPENDS_ON 1-hop = alpha*1.0*1.0 = 0.7 > 0 even with no context?');
console.log('YES: 0.7*1.0 + 0.3*0 = 0.70. Component always predicted regardless of ablation.');

// ─── AUDIT 4: Baseline extractIds includes Test type components? ───────────
console.log('\n══════ AUDIT 4: Baseline extractIds — Test type not filtered ══════');
console.log('Baseline extractIds: results.map(r => r.name) — includes ALL types including Test.');
console.log('Baseline extractTestIds: filters where false — always empty.');
console.log('ISSUE: The mainOracle excludes Test type, but baseline predictions include Test type.');
console.log('This means baseline Test predictions are counted as FALSE POSITIVES in main Precision.');
console.log('Example case_21 (ExceptionControllerAdvice):');
const case21 = data.caseResults.find(c => c.caseId === 'case_21_9d3c02b');
console.log('  Baseline predicted:', case21.baseline.predicted);
console.log('  Oracle main (excludes Test):', case21._oracleMain.slice(0, 5), '...');
console.log('  These predicted IDs are Test components → counted as FP in main metrics.');
console.log('  Baseline precision=0 because ALL predictions are Test type, none in mainOracle.');

// ─── AUDIT 5: ExceptionControllerAdvice — what type is it? ────────────────
console.log('\n══════ AUDIT 5: ExceptionControllerAdvice component analysis ══════');
const excAdv = components.find(c => c.id === 'ExceptionControllerAdvice');
console.log('ExceptionControllerAdvice type:', excAdv?.type);
console.log('Relationships involving ExceptionControllerAdvice:');
const excRels = relationships.filter(r => r.source === 'ExceptionControllerAdvice' || r.target === 'ExceptionControllerAdvice');
excRels.forEach(r => console.log(`  ${r.source} --[${r.type}]--> ${r.target}`));
console.log('Oracle for ExceptionControllerAdvice (type=Other):');
console.log('  Oracle BFS traverses DEPENDS_ON/USES/TESTS bidirectionally, putting all non-Test neighbours in mainOracle');
console.log('  Since ExceptionControllerAdvice type=Other, oracle size=26 means BFS finds 26 non-Test neighbours');
console.log('  But baseline filters: type===Other components are skipped for USES rel; they also skip "Other" at 2-hop.');
console.log('  The baseline finds only TESTS edges (incoming from tests), outputs them, but they get counted as FP.');

// ─── AUDIT 6: Oracle vs. Model circularity check ─────────────────────────
console.log('\n══════ AUDIT 6: Circularity Analysis ══════');
console.log('Oracle: BFS via DEPENDS_ON, USES, TESTS (bidirectional)');
console.log('Baseline: Directed 2-hop via DEPENDS_ON, USES, TESTS (with type-filters and direction-based level)');
console.log('Context-Aware: Undirected 2-hop via DEPENDS_ON, USES, TESTS, IMPLEMENTS, EXTENDS (no type-filter)');
console.log('Circularity question: does the oracle match context-aware traversal exactly?');
console.log('Answer: Oracle uses {DEPENDS_ON,USES,TESTS} ONLY. Context-aware adds IMPLEMENTS/EXTENDS.');
console.log('Analysis_output rel types:', Object.keys(relTypeCounts).join(', '));
const hasImplExt = Object.keys(relTypeCounts).some(t => ['IMPLEMENTS','EXTENDS'].includes(t));
console.log('IMPLEMENTS/EXTENDS present in data:', hasImplExt);
if (hasImplExt) {
  const extCount = (relTypeCounts['EXTENDS'] || 0) + (relTypeCounts['IMPLEMENTS'] || 0);
  console.log(`Count: ${extCount}. Context-aware can reach nodes via EXTENDS that oracle MISSES.`);
  console.log('These extra nodes would be FP in context-aware (not in oracle).');
} else {
  console.log('Not present — oracle and context-aware have same structural reach.');
}

// ─── AUDIT 7: Manual trace for 3 representative cases ────────────────────
console.log('\n══════ AUDIT 7: Manual Trace — 3 Cases ══════');

// Case A: case_12_f2670f9 (OwnerMapper — small, clean)
const c12 = data.caseResults.find(c => c.caseId === 'case_12_f2670f9');
console.log('\n--- Case A: case_12_f2670f9 ---');
console.log('Changed: OwnerMapper (type=', components.find(c=>c.id==='OwnerMapper')?.type, ')');
console.log('Oracle main:', c12._oracleMain);
console.log('Oracle test:', c12._oracleTest);
console.log('Baseline predicted:', c12.baseline.predicted);
console.log('Context-full predicted:', c12.context_full.predicted);
console.log('Baseline TP:', c12.baseline.tp, 'FP:', c12.baseline.fp, 'FN:', c12.baseline.fn);
console.log('Context TP:', c12.context_full.tp, 'FP:', c12.context_full.fp, 'FN:', c12.context_full.fn);

const ownerMapperRels = relationships.filter(r => r.source==='OwnerMapper' || r.target==='OwnerMapper');
console.log('Relationships for OwnerMapper:');
ownerMapperRels.forEach(r => console.log(`  ${r.source} --[${r.type}]--> ${r.target}`));

// Case B: case_21 (ExceptionControllerAdvice — baseline 0/0)
console.log('\n--- Case B: case_21_9d3c02b ---');
console.log('Changed: ExceptionControllerAdvice (type=Other)');
console.log('Oracle main size:', case21.oracleSize, '| Oracle main[:5]:', case21._oracleMain.slice(0,5));
console.log('Baseline predicted:', case21.baseline.predicted);
console.log('Baseline P:', case21.baseline.precision, 'R:', case21.baseline.recall);
console.log('Context-full predicted[:5]:', case21.context_full.predicted.slice(0,5));
console.log('Context-full P:', case21.context_full.precision, 'R:', case21.context_full.recall);

// Case C: case_52 (JdbcVisitRepositoryImpl + Test files)
const c52 = data.caseResults.find(c => c.caseId === 'case_52_ff80e67');
console.log('\n--- Case C: case_52_ff80e67 ---');
console.log('Changed:', c52.changedIds);
console.log('Changed types:', c52.changedIds.map(id => components.find(c=>c.id===id)?.type));
console.log('Oracle main:', c52._oracleMain);
console.log('Baseline predicted:', c52.baseline.predicted);
console.log('Context predicted[:8]:', c52.context_full.predicted.slice(0,8));
console.log('Context FP:', c52.context_full.fp, '— these are FP components:',
  c52.context_full.predicted.filter(id => !c52._oracleMain.includes(id) && !c52._oracleTest.includes(id)));

// ─── AUDIT 8: Check whether oracle incorrectly includes changed components ─
console.log('\n══════ AUDIT 8: Oracle Contamination Check ══════');
let oracleContainsChanged = 0;
for (const cr of data.caseResults) {
  for (const changedId of cr.changedIds) {
    if (cr._oracleMain.includes(changedId) || cr._oracleTest.includes(changedId)) {
      console.log(`CONTAMINATION: ${cr.caseId} — oracle contains changed component ${changedId}`);
      oracleContainsChanged++;
    }
  }
}
if (oracleContainsChanged === 0) console.log('Clean: No oracle contains a changed component.');
