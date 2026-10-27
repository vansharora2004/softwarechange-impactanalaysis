# Final Reproducible Evaluation Report: Structural Baseline vs. Historical Reranker vs. OCCP

**Project:** Context-Aware Software Change Impact Analysis Framework Using Multi-Layer Software Knowledge Graphs  
**Date:** 2026-10-19  
**Evaluation Protocol:** Strictly Chronological Leave-One-Out (LOO) with Pre-Change Historical AST Knowledge Graph Reconstruction ($j < c$)  
**Operating Hop Horizon:** 2 Hops  
**Output Directory:** `research_artifacts/final_reproducible_eval_20261019/`  

---

## 1. Executive Summary & Core Research Answers

This report documents the reproduced, fair, and leak-free empirical comparison among:
1. **Canonical Structural Graph Traversal Baseline** (pure topological reachability up to 2 hops).
2. **V4 Historical Co-Change Reranker** (unweighted pairwise co-change frequency).
3. **OCCP (Operation-Conditioned Change Propagation)** (Model B) and **Context-Free Typed-Path Baseline** (Model A) as secondary experimental methods.

All evaluations were executed on the exact local Git repositories (**Spring PetClinic REST** and **Shopizer**) without modifying application code, scoring formulas, or candidate sets.

### Answers to the 4 Core Research Questions:

1. **Does historical reranking improve results consistently across both repositories?**
   - **NO.** Historical reranking does **NOT** improve results consistently.
   - In **Shopizer** (a large, multi-module e-commerce system with 46 cases across 12 commits), historical reranking delivers large improvements: **MAP increases by +107.64%** (0.0432 $\rightarrow$ 0.0897) and **P@3 increases by +128.11%** (0.0619 $\rightarrow$ 0.1412).
   - In **Spring PetClinic REST** (a compact single-module REST service with 57 cases across 8 commits), historical reranking causes a **slight regression**: **MAP decreases by -6.09%** (0.1758 $\rightarrow$ 0.1651) and **P@3 decreases by -9.31%** (0.1654 $\rightarrow$ 0.1500).
   - This cross-repository disparity occurs because PetClinic has a very sparse commit history (only 26 historical Java commits), meaning co-change counts are predominantly 0 or 1, introducing tie-breaking noise into cleanly ordered structural paths.

2. **Is the empirical evidence strong enough to claim a statistically significant improvement for historical reranking?**
   - **NO.** When evaluated under paired per-commit statistical tests across commits, the evidence is **not statistically significant**:
     - In **Spring PetClinic REST**: Paired $t = -0.9400$ ($p = 0.3785$), Wilcoxon signed-rank $W = 9$ ($p = 0.8438$). All 95% confidence intervals span zero (MAP diff 95% CI: `[-0.0378, +0.0163]`).
     - In **Shopizer**: Paired $t = 1.2781$ ($p = 0.2275$), Wilcoxon signed-rank $W = 0$ ($p = 0.2500$). 9 of 12 commits (75.0%) had zero co-change evidence, collapsing the effective non-zero sample size to $N = 3$. Under $N = 3$, the minimum possible two-sided Wilcoxon $p$-value is 0.25.
   - Therefore, while the magnitude of improvement in Shopizer is large (+107% MAP), the small number of multi-component commits ($K = 8$ and $K = 12$) precludes claiming formal statistical significance ($p \le 0.05$).

3. **What can be concluded about OCCP from the empirical results?**
   - **OCCP is statistically inconclusive, does not outperform simpler historical reranking in large codebases, and should not be adopted.**
   - In **Shopizer**, OCCP (Model B) achieves a MAP of **0.0759**, which is **worse** than the simpler V4 Historical Co-Change Reranker (**0.0897**, a difference of -0.0138, $p = 0.3675$).
   - In **Spring PetClinic REST**, OCCP achieves MAP **0.1864** vs Context-Free Model A **0.1786**, but the difference is statistically insignificant ($t = 1.1343, p = 0.2305$, Wilcoxon $p = 0.2500$), with 62.5% of commits showing zero difference.
   - OCCP suffers from severe data fragmentation: conditioning path signatures on 6 edit operations splits limited historical data into empty buckets, resulting in an **85.30% fallback rate to pairwise co-change in Shopizer** and **55.34% of cases classified as `UNKNOWN_OR_MIXED`**.

4. **Given these findings, what should remain the default or recommended engine in the application, and why?**
   - The **Canonical Structural Graph Traversal Baseline** must remain the default engine for production and UI workflows.
   - **Rationale:**
     1. **Universal Reliability:** The structural baseline operates deterministically without requiring historical commit logs, repository cloning, or history mining. It performs consistently across both small and large systems.
     2. **No Data Sparsity Penalty:** When commit history is sparse (as in PetClinic), historical methods regress or introduce noise.
     3. **Explainability:** Topological BFS paths (1-hop, 2-hop) provide clear, inspectable causal explanations directly traceable to AST declarations (e.g. `IMPLEMENTS`, `USES`, `EXTENDS`).
     4. **Optional Enhancement:** Historical co-change reranking (V4) should only be surfaced as an optional opt-in feature for mature repositories with hundreds of commits.

---

## 2. Dataset Exclusions and Eligible Commits Breakdown

Commits were inspected chronologically from Git log history up to 100 commits per repository.

| Repository | Commits Inspected | Total Excluded | Exclusion Reasons Breakdown | Eligible Multi-Component Commits | LOO Evaluation Cases |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Spring PetClinic REST** | 100 | **92** | • `E1_MERGE_COMMIT`: 30<br>• `E2/E3/E4_NO_JAVA`: 43<br>• `E7_TEST_ONLY`: 6<br>• `E8_SINGLE_NON_TEST`: 13 | **8** | **57** |
| **Shopizer** | 54 | **42** | • `E1_MERGE_COMMIT`: 13<br>• `E2/E3/E4_NO_JAVA`: 16<br>• `E8_SINGLE_NON_TEST`: 12<br>• `E9_ROOT_COMMIT`: 1 (`052d2ed`) | **12** | **46** |
| **Total** | **154** | **134** | — | **20** | **103** |

### Verified Temporal & Evaluation Integrity:
- **Pre-Change Snapshot:** Every evaluated commit $C$ was evaluated against an AST graph reconstructed at parent revision $P = C^1$.
- **Zero Future Leakage:** Historical co-change counts and training episodes used only commits strictly older than $C$ ($j < c$).
- **Identical Candidate Universes:** All compared models ranked the exact same candidate sets with zero dropped candidates ($|C| = 19.1007$ in PetClinic, $|C| = 41.4010$ in Shopizer).
- **Target Exclusion:** The input seed was strictly excluded from candidates and target oracles in 100% of cases.

---

## 3. Primary Comparative Evaluation Results (2-Hop Operating Horizon)

### 3.1 Spring PetClinic REST ($K = 8$ Commits, 57 LOO Cases)

#### Commit-Level Macro-Average (Primary Standard)
| Model Configuration | |C| | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | MAP | MRR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Structural Baseline** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1654 | 0.1796 | 0.1642 | 0.2231 | 0.1626 | 0.3519 | **0.1758** | **0.2913** |
| **2. Hist Co-Change Reranker (V4)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1500 | 0.1159 | 0.1608 | 0.1668 | 0.1665 | 0.3564 | 0.1651 | 0.2825 |
| **3. Context-Free Path (Model A)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1719 | 0.1237 | 0.1811 | 0.2321 | 0.1728 | 0.4191 | 0.1786 | 0.3169 |
| **4. OCCP (Model B)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1927 | 0.1326 | 0.1904 | 0.2388 | 0.1713 | 0.4169 | 0.1864 | 0.3343 |
| **5. RRF Fusion (Struct + Hist)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1629 | 0.1776 | 0.1674 | 0.2270 | 0.1668 | 0.3576 | 0.1752 | 0.2817 |
| **6. RRF Composite (+ OCCP)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1796 | 0.1832 | 0.1732 | 0.2291 | 0.1713 | 0.3619 | 0.1818 | 0.3127 |

#### Delta vs. Structural Baseline (Spring PetClinic REST Macro)
| Comparison | P@3 Delta | R@3 Delta | P@5 Delta | R@5 Delta | P@10 Delta | R@10 Delta | MAP Delta | MRR Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Hist Reranker (V4) vs Baseline** | -0.0154 (-9.31%) | -0.0637 (-35.47%) | -0.0034 (-2.07%) | -0.0563 (-25.23%) | +0.0039 (+2.40%) | +0.0045 (+1.28%) | -0.0107 (-6.09%) | -0.0088 (-3.02%) |
| **OCCP (Model B) vs Baseline** | +0.0273 (+16.50%) | -0.0470 (-26.17%) | +0.0262 (+15.95%) | +0.0157 (+7.04%) | +0.0087 (+5.35%) | +0.0650 (+18.47%) | +0.0106 (+6.03%) | +0.0430 (+14.76%) |
| **OCCP vs Model A (Context-Free)** | +0.0208 (+12.10%) | +0.0089 (+7.19%) | +0.0093 (+5.14%) | +0.0067 (+2.89%) | -0.0015 (-0.87%) | -0.0022 (-0.52%) | +0.0078 (+4.37%) | +0.0174 (+5.49%) |

---

### 3.2 Shopizer ($K = 12$ Commits, 46 LOO Cases)

#### Commit-Level Macro-Average (Primary Standard)
| Model Configuration | |C| | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | MAP | MRR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Structural Baseline** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.0619 | 0.0309 | 0.0556 | 0.0444 | 0.0387 | 0.0628 | 0.0432 | 0.1324 |
| **2. Hist Co-Change Reranker (V4)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | **0.1412** | **0.0708** | **0.1087** | **0.0899** | 0.0606 | **0.0997** | **0.0897** | **0.1967** |
| **3. Context-Free Path (Model A)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1053 | 0.0507 | 0.0854 | 0.0674 | 0.0590 | 0.0931 | 0.0689 | 0.1657 |
| **4. OCCP (Model B)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1181 | 0.0569 | 0.0920 | 0.0733 | **0.0623** | 0.0990 | 0.0759 | 0.1946 |
| **5. RRF Fusion (Struct + Hist)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.0810 | 0.0403 | 0.0698 | 0.0566 | 0.0497 | 0.0813 | 0.0560 | 0.1633 |
| **6. RRF Composite (+ OCCP)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1019 | 0.0500 | 0.0813 | 0.0660 | 0.0535 | 0.0875 | 0.0659 | 0.1687 |

#### Delta vs. Structural Baseline (Shopizer Macro)
| Comparison | P@3 Delta | R@3 Delta | P@5 Delta | R@5 Delta | P@10 Delta | R@10 Delta | MAP Delta | MRR Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Hist Reranker (V4) vs Baseline** | **+0.0793 (+128.11%)** | **+0.0399 (+129.13%)** | **+0.0531 (+95.50%)** | **+0.0455 (+102.48%)** | +0.0219 (+56.59%) | **+0.0369 (+58.76%)** | **+0.0465 (+107.64%)** | **+0.0643 (+48.56%)** |
| **OCCP (Model B) vs Baseline** | +0.0562 (+90.79%) | +0.0260 (+84.14%) | +0.0364 (+65.47%) | +0.0289 (+65.09%) | +0.0236 (+60.98%) | +0.0362 (+57.64%) | +0.0327 (+75.69%) | +0.0622 (+46.98%) |
| **OCCP vs Hist Reranker (V4)** | **-0.0231 (-16.36%)** | **-0.0139 (-19.63%)** | **-0.0167 (-15.36%)** | **-0.0166 (-18.47%)** | +0.0017 (+2.81%) | -0.0007 (-0.70%) | **-0.0138 (-15.38%)** | -0.0021 (-1.07%) |

---

## 4. Paired Per-Commit Statistical Hypothesis Tests

Because each commit represents an independent change episode, paired difference tests evaluate whether differences are consistent across commits or driven by outlier refactorings.

### 4.1 Historical Reranker (V4) vs. Structural Baseline
| Repository & Metric | Mean $Delta$ | Std Dev | SE | 95% Confidence Interval | Paired $t$ | $p$-value ($t$) | Wilcoxon $W$ | $p$-value ($W$) | Zero Diffs ($d=0$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **PetClinic MAP** | -0.0108 | 0.0324 | 0.0114 | [-0.0378, +0.0163] | -0.9400 | 0.3785 | 9 | 0.8438 | 2 / 8 (25.0%) |
| **PetClinic P@3** | -0.0154 | 0.0880 | 0.0311 | [-0.0890, +0.0582] | -0.4941 | 0.6364 | 6 | 0.7500 | 3 / 8 (37.5%) |
| **PetClinic MRR** | -0.0088 | 0.0592 | 0.0209 | [-0.0583, +0.0407] | -0.4208 | 0.6865 | 11 | 1.0000 | 2 / 8 (25.0%) |
| **Shopizer MAP** | +0.0464 | 0.1258 | 0.0363 | [-0.0335, +0.1264] | 1.2781 | 0.2275 | 0 | 0.2500 | **9 / 12 (75.0%)** |
| **Shopizer P@3** | +0.0793 | 0.1816 | 0.0524 | [-0.0361, +0.1946] | 1.5121 | 0.1587 | 0 | 0.2500 | **9 / 12 (75.0%)** |
| **Shopizer MRR** | +0.0643 | 0.1706 | 0.0492 | [-0.0441, +0.1726] | 1.3060 | 0.2182 | 0 | 0.2500 | **9 / 12 (75.0%)** |

### 4.2 OCCP (Model B) vs. Context-Free Path (Model A)
| Repository & Metric | Mean $Delta$ | Std Dev | SE | 95% Confidence Interval | Paired $t$ | $p$-value ($t$) | Wilcoxon $W$ | $p$-value ($W$) | Zero Diffs ($d=0$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **PetClinic MAP** | +0.0079 | 0.0196 | 0.0069 | [-0.0085, +0.0242] | 1.1343 | 0.2305 | 0 | 0.2500 | **5 / 8 (62.5%)** |
| **PetClinic P@3** | +0.0208 | 0.0589 | 0.0208 | [-0.0284, +0.0701] | 1.0000 | 0.2861 | 0 | 0.5000 | **7 / 8 (87.5%)** |
| **Shopizer MAP** | +0.0070 | 0.0152 | 0.0044 | [-0.0027, +0.0167] | 1.6000 | 0.1380 | 0 | 0.2500 | **10 / 12 (83.3%)** |
| **Shopizer P@3** | +0.0127 | 0.0332 | 0.0096 | [-0.0084, +0.0338] | 1.3300 | 0.1730 | 0 | 0.5000 | **11 / 12 (91.7%)** |

---

## 5. Case-Level Pooled Micro-Averages Comparison

To ensure that results are not an artifact of macro-averaging across unequal commit case sizes, case-level pooled micro-averages were evaluated across all individual cases:

| Repository | Model Configuration | Micro Precision | Micro Recall | Micro F1 | Micro P@3 | Micro P@5 | Micro P@10 | Micro MAP | Micro MRR |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **PetClinic** | Structural Baseline | 0.1741 | 0.5517 | 0.2185 | 0.1520 | 0.1509 | 0.1526 | 0.1458 | 0.2775 |
| (57 Cases) | Hist Co-Change (V4) | 0.1741 | 0.5517 | 0.2185 | 0.1637 | 0.1579 | 0.1579 | 0.1444 | 0.2879 |
| | Model A (Context-Free) | 0.1741 | 0.5517 | 0.2185 | 0.1930 | 0.1789 | 0.1632 | 0.1575 | 0.3342 |
| | OCCP (Model B) | 0.1741 | 0.5517 | 0.2185 | **0.2164** | **0.1930** | **0.1649** | **0.1667** | **0.3568** |
| **Shopizer** | Structural Baseline | 0.0375 | 0.2483 | 0.0573 | 0.1377 | 0.1087 | 0.0761 | 0.0817 | 0.2957 |
| (46 Cases) | Hist Co-Change (V4) | 0.0375 | 0.2483 | 0.0573 | **0.3116** | **0.2261** | **0.1283** | **0.1668** | 0.4406 |
| | Model A (Context-Free) | 0.0375 | 0.2483 | 0.0573 | 0.2464 | 0.1870 | 0.1261 | 0.1347 | 0.3820 |
| | OCCP (Model B) | 0.0375 | 0.2483 | 0.0573 | 0.2754 | 0.2087 | 0.1261 | 0.1473 | **0.4501** |

**Observation on Invariance:** Under both commit macro and case micro aggregation, the model hierarchy is identical:
- PetClinic: OCCP > Model A > Structural Baseline $\approx$ V4 Historical Reranker
- Shopizer: **V4 Historical Reranker > OCCP > Model A > Structural Baseline**

---

## 6. Hop-Depth Sensitivity Analysis

| Hop Depth | Configuration | PetClinic |C| | PetClinic P@3 | PetClinic MAP | Shopizer |C| | Shopizer P@3 | Shopizer MAP |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Hop 1** | Structural Baseline | 2.3730 | 0.2649 | 0.1260 | 3.5222 | 0.1065 | 0.0630 |
| | Hist Reranker (V4) | 2.3730 | 0.2666 | 0.1263 | 3.5222 | **0.1991** | **0.1068** |
| | OCCP (Model B) | 2.3730 | **0.2974** | **0.1373** | 3.5222 | 0.1806 | 0.1009 |
| **Hop 2** | Structural Baseline | 19.1007 | 0.1654 | 0.1758 | 41.4010 | 0.0619 | 0.0432 |
| | Hist Reranker (V4) | 19.1007 | 0.1500 | 0.1651 | 41.4010 | **0.1412** | **0.0897** |
| | OCCP (Model B) | 19.1007 | **0.1927** | **0.1864** | 41.4010 | 0.1181 | 0.0759 |
| **Hop 3** | Structural Baseline | 47.9226 | 0.1371 | 0.1824 | 148.6083 | 0.0380 | 0.0345 |
| | Hist Reranker (V4) | 47.9226 | 0.1219 | 0.1678 | 148.6083 | **0.1306** | **0.0814** |
| | OCCP (Model B) | 47.9226 | **0.1594** | **0.1951** | 148.6083 | 0.1069 | 0.0717 |

**Hop-Depth Findings:**
- 2-hop traversal balances coverage and precision: 1-hop misses multi-hop structural callers, while 3-hop causes severe candidate inflation ($|C| = 148.6$ in Shopizer, reducing precision below 4%).
- Across all 3 hops in Shopizer, the **V4 Historical Co-Change Reranker consistently outperforms OCCP** in both P@3 and MAP.

---

## 7. Threats to Validity and Empirical Limitations

1. **Statistical Power Threat (Small Sample Size):**
   - The number of eligible multi-component commits is small ($K = 8$ in PetClinic, $K = 12$ in Shopizer).
   - In Shopizer, 75% of commits had zero co-change history, leaving only 3 commits with non-zero paired differences. Non-parametric rank tests (Wilcoxon) cannot achieve $p \le 0.05$ with $N = 3$.
2. **Data Sparsity in Operation Conditioning:**
   - Real-world commits are mixed: **55.34% of evaluated cases** are classified as `UNKNOWN_OR_MIXED`.
   - OCCP falls back to pairwise co-change in **85.30% of candidate decisions in Shopizer**, demonstrating that fine-grained operation conditioning is severely starved of training support in medium-sized open-source repositories.
3. **External Validity:**
   - Findings reflect Java enterprise web applications (Spring Boot / Maven multi-module). Repositories with thousands of commits or different architectural paradigms may yield different co-change density.

---

## 8. Final Recommendation and Architectural Verdict

1. **Production Engine Status:**
   - Retain the **Canonical Structural Graph Traversal Baseline (Hop 2)** as the default, active change impact analysis engine in the web UI and backend REST API (`/api/analyze/git`, `/api/analyze/manual`).
   - It is 100% deterministic, zero-configuration, robust against commit sparsity, and requires no Git checkout overhead.
2. **Historical Co-Change Reranker (V4):**
   - Retain as an **optional, user-selectable experimental toggle** in the UI for repositories with extensive commit history (>100 Java commits), where it demonstrates positive impact (+107% MAP in Shopizer).
3. **OCCP (Operation-Conditioned Change Propagation):**
   - Maintain strictly as an **archived research experiment** in `backend/src/services/occp/` and `research_artifacts/`.
   - Do **NOT** merge OCCP into production code or pursue further feature engineering (e.g. EGCP), as empirical evidence confirms it fails to outperform simple historical reranking while adding substantial algorithmic complexity.
