// Benchmark data compiled from official research artifacts:
// - research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_ablation_comparison.csv
// - research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_metrics_by_project.csv
// - research_artifacts/RESEARCH_FREEZE_MANIFEST.md

export const BENCHMARK_MODELS = [
  {
    id: 'canonical_baseline',
    name: 'Canonical Structural Baseline',
    shortName: 'Baseline',
    category: 'Baseline',
    badge: 'Live Backend Engine',
    mapMacro: 0.0865,
    mrrMacro: 0.1712,
    p5Macro: 0.0849,
    r5Macro: 0.0997,
    testMap: 0.0279,
    testMrr: 0.0577,
    petclinicMap: 0.1758,
    shopizerMap: 0.0432,
    commonsMap: 0.0472,
    description: 'Pure 2-hop structural reachability over static call, dependency, and inheritance graphs.'
  },
  {
    id: 'csf_frozen',
    name: 'Continuous Score Fusion (CSF)',
    shortName: 'CSF Frozen',
    category: 'Previous Frozen Baseline',
    badge: 'Baseline Freeze',
    mapMacro: 0.1278,
    mrrMacro: 0.2340,
    p5Macro: 0.1305,
    r5Macro: 0.1446,
    testMap: 0.0315,
    testMrr: 0.0841,
    petclinicMap: 0.1671,
    shopizerMap: 0.0891,
    commonsMap: 0.1579,
    description: 'Frozen baseline combining continuous structural distances, layer penalties, and historical co-change.'
  },
  {
    id: 'egcp_v1_evo',
    name: 'EGCP v1 (Evo-Only)',
    shortName: 'EGCP v1',
    category: 'Research Model',
    badge: 'Initial Graph',
    mapMacro: 0.1233,
    mrrMacro: 0.2382,
    p5Macro: 0.1356,
    r5Macro: 0.1478,
    testMap: 0.0303,
    testMrr: 0.0741,
    petclinicMap: 0.1603,
    shopizerMap: 0.1021,
    commonsMap: 0.1147,
    description: 'Evolutionary Graph Change Propagation v1 with pure co-change graph random walks (alpha=0.0).'
  },
  {
    id: 'egcp_v2_main',
    name: 'EGCP v2 (Dual-Channel Propagation)',
    shortName: 'EGCP v2',
    category: 'Research Model',
    badge: 'Dual Propagation',
    mapMacro: 0.1312,
    mrrMacro: 0.2105,
    p5Macro: 0.1139,
    r5Macro: 0.1775,
    testMap: 0.0920,
    testMrr: 0.1456,
    petclinicMap: 0.1435,
    shopizerMap: 0.0425,
    commonsMap: 0.3245,
    description: 'Introduced dual-channel structural & evolutionary propagation with beta=0.60, gamma=0.75.'
  },
  {
    id: 'egcp_v3_combined',
    name: 'EGCP v3 Combined',
    shortName: 'EGCP v3',
    category: 'Research Model',
    badge: 'Adaptive Beta',
    mapMacro: 0.1539,
    mrrMacro: 0.2586,
    p5Macro: 0.1414,
    r5Macro: 0.1832,
    testMap: 0.0791,
    testMrr: 0.1290,
    petclinicMap: 0.1577,
    shopizerMap: 0.0916,
    commonsMap: 0.2972,
    description: 'Adaptive graph-channel weighting + entity damping + operation-type awareness.'
  },
  {
    id: 'egcp_v4_combined',
    name: 'EGCP v4 Combined (Entropy-Beta + Hub Exclusion + Gated-Op)',
    shortName: 'EGCP v4 (Best)',
    category: 'Top Research Candidate',
    badge: 'Best Research Candidate',
    isWinner: true,
    mapMacro: 0.1642,
    mrrMacro: 0.2657,
    p5Macro: 0.1522,
    r5Macro: 0.2256,
    testMap: 0.0992,
    testMrr: 0.1393,
    petclinicMap: 0.1625,
    shopizerMap: 0.0916,
    commonsMap: 0.3412,
    description: 'Highest performing model across the benchmark: Entropy-adaptive beta, progressive hub suppression, evidence-gated operations, and multi-step dampening.'
  }
];

export const PROJECT_BREAKDOWN = [
  {
    project: 'Spring PetClinic REST',
    commits: 8,
    cases: 57,
    baselineMap: 0.1758,
    csfMap: 0.1671,
    v1Map: 0.1603,
    v2Map: 0.1435,
    v3Map: 0.1577,
    v4Map: 0.1625,
    v4DeltaVsCsf: '-2.8%',
    note: 'Highly dense structural web controllers; structural baseline holds strong ground.'
  },
  {
    project: 'Shopizer (E-Commerce)',
    commits: 12,
    cases: 46,
    baselineMap: 0.0432,
    csfMap: 0.0891,
    v1Map: 0.1021,
    v2Map: 0.0425,
    v3Map: 0.0916,
    v4Map: 0.0916,
    v4DeltaVsCsf: '+2.8%',
    note: 'Large multi-module enterprise graph. Hub suppression prevents common utility leakage.'
  },
  {
    project: 'Apache Commons Lang',
    commits: 5,
    cases: 67,
    baselineMap: 0.0472,
    csfMap: 0.1579,
    v1Map: 0.1147,
    v2Map: 0.3245,
    v3Map: 0.2972,
    v4Map: 0.3412,
    v4DeltaVsCsf: '+116.1%',
    note: 'Algorithmic utility library with dense co-change patterns where evolutionary graph propagation excels.'
  },
  {
    project: 'Macro Overall (All 3 Repos)',
    commits: 25,
    cases: 170,
    baselineMap: 0.0865,
    csfMap: 0.1278,
    v1Map: 0.1233,
    v2Map: 0.1312,
    v3Map: 0.1539,
    v4Map: 0.1642,
    v4DeltaVsCsf: '+28.5%',
    isOverall: true,
    note: 'Macro-average across 25 chronological commits (170 evaluation change cases).'
  }
];

export const V4_ABLATIONS = [
  { ablation: 'v4 Base (Parity)', map: 0.1306, mrr: 0.2090, p5: 0.1129, r5: 0.1768, testMap: 0.0920 },
  { ablation: 'A: Entropy-Adaptive Beta Only', map: 0.1504, mrr: 0.2429, p5: 0.1317, r5: 0.1930, testMap: 0.0900 },
  { ablation: 'B: Progressive Hub Exclusion Only', map: 0.1338, mrr: 0.2117, p5: 0.1126, r5: 0.1767, testMap: 0.1003 },
  { ablation: 'C: Evidence-Gated Op-Aware Only', map: 0.1307, mrr: 0.2090, p5: 0.1129, r5: 0.1768, testMap: 0.0920 },
  { ablation: 'A+B: Entropy Beta + Hub Exclusion', map: 0.1539, mrr: 0.2461, p5: 0.1327, r5: 0.1936, testMap: 0.0983 },
  { ablation: 'Combined: Beta + Hub + Op + Damp', map: 0.1642, mrr: 0.2657, p5: 0.1522, r5: 0.2256, testMap: 0.0992, isWinner: true }
];
