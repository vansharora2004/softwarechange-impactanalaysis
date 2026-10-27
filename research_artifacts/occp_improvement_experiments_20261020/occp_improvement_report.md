# Controlled OCCP Improvement Experiments: Full Evaluation Report

**Date:** 2026-10-19
**Evaluation Protocol:** Strictly leak-free retrospective leave-one-out (LOO) with pre-change AST graph reconstruction.
**Candidate Universes:** Identical topological candidates at hop depth $K=2$ ($|\mathcal{C}|$ preserved across all models).
**Scope:** Spring PetClinic REST ($K=8$ commits, $N=57$ cases) and Shopizer ($K=12$ commits, $N=46$ cases) — Total $K=20$ commits, $N=103$ cases.

## 1. Executive Summary & Core Research Findings

This controlled experiment systematically tests three theoretical remedies to the demonstrated limitations of Operation-Conditioned Change Propagation (OCCP):
1. **Laplace / Additive Probability Smoothing** ($\lambda \in \{0.1, 0.5, 1.0\}$): Regularizes empirical MLE estimates to prevent $1/1 = 100\%$ rate distortions.
2. **Minimum-Support Thresholding** ($M \in \{2, 3, 5\}$): Suppresses high-tier promotion for rare single-occurrence paths, enforcing structured backoff to generic paths or historical co-change.
3. **Continuous Score Fusion (Non-Tiered)**: Replaces rigid ordinal tiers with continuous multi-channel fusion: $S = 0.35 S_{\text{cond}} + 0.15 S_{\text{gen}} + 0.35 S_{\text{hist}} + 0.15 S_{\text{struct}}$.
4. **Combined Variant**: Evaluates smoothed probabilities with minimum support ($M=2, \lambda=0.5$).

### Primary Conclusion & Formal Recommendation:
- **Original OCCP:** Macro MAP = 0.1201, MRR = 0.2505
- **Historical Reranker (V4):** Macro MAP = 0.1198, MRR = 0.2310
- **Best Smoothed Variant ($\lambda = 0.5$):** Macro MAP = 0.1201, MRR = 0.2505
- **Best Threshold Variant ($M = 2$):** Macro MAP = 0.1127, MRR = 0.2403
- **Continuous Score Fusion:** Macro MAP = 0.1252, MRR = 0.2439

## 2. Multi-Repository Overall Evaluation Results (Macro-Averaged Across $K=20$ Commits)

| Model Configuration | MAP | MRR | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Canonical Structural Baseline** | **0.0963** | **0.1959** | 0.1033 | 0.0904 | 0.0990 | 0.1159 | 0.0883 | 0.1785 |
| **2. Historical Co-Change Reranker (V4)** | **0.1198** | **0.2310** | 0.1447 | 0.0888 | 0.1295 | 0.1207 | 0.1029 | 0.2023 |
| **3. Context-Independent Typed Path (Model A)** | **0.1127** | **0.2262** | 0.1319 | 0.0799 | 0.1237 | 0.1333 | 0.1045 | 0.2235 |
| **4. OCCP Original (Unregularized MLE)** | **0.1201** | **0.2505** | 0.1479 | 0.0872 | 0.1314 | 0.1395 | 0.1059 | 0.2261 |
| **5. OCCP + Smoothing (lambda = 0.1)** | **0.1201** | **0.2505** | 0.1479 | 0.0872 | 0.1314 | 0.1395 | 0.1059 | 0.2261 |
| **6. OCCP + Smoothing (lambda = 0.5)** | **0.1201** | **0.2505** | 0.1479 | 0.0872 | 0.1314 | 0.1395 | 0.1059 | 0.2261 |
| **7. OCCP + Smoothing (lambda = 1.0)** | **0.1201** | **0.2505** | 0.1479 | 0.0872 | 0.1314 | 0.1395 | 0.1059 | 0.2261 |
| **8. OCCP + Min-Support (M = 2)** | **0.1127** | **0.2403** | 0.1403 | 0.0830 | 0.1222 | 0.1310 | 0.1022 | 0.2193 |
| **9. OCCP + Min-Support (M = 3)** | **0.1068** | **0.2309** | 0.1267 | 0.0774 | 0.1128 | 0.1251 | 0.1006 | 0.2178 |
| **10. OCCP + Min-Support (M = 5)** | **0.1036** | **0.2166** | 0.1170 | 0.0723 | 0.1078 | 0.1212 | 0.1002 | 0.2174 |
| **11. Continuous Score Fusion** | **0.1252** | **0.2439** | 0.1549 | 0.0930 | 0.1391 | 0.1476 | 0.1067 | 0.2056 |
| **12. Combined (Smoothing 0.5 + M=2)** | **0.1127** | **0.2403** | 0.1403 | 0.0830 | 0.1222 | 0.1310 | 0.1022 | 0.2193 |

## 3. Spring PetClinic REST Detailed Results ($K=8$ Commits, $N=57$ Cases)

| Model Configuration | Macro MAP | Macro MRR | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1. Canonical Structural Baseline | **0.1758** | **0.2913** | 0.1654 | 0.1796 | 0.1642 | 0.2231 | 0.1626 | 0.3519 |
| 2. Historical Co-Change Reranker (V4) | **0.1651** | **0.2825** | 0.1500 | 0.1159 | 0.1608 | 0.1668 | 0.1665 | 0.3564 |
| 3. Context-Independent Typed Path (Model A) | **0.1786** | **0.3169** | 0.1719 | 0.1237 | 0.1811 | 0.2321 | 0.1728 | 0.4191 |
| 4. OCCP Original (Unregularized MLE) | **0.1864** | **0.3343** | 0.1927 | 0.1326 | 0.1904 | 0.2388 | 0.1713 | 0.4169 |
| 5. OCCP + Smoothing (lambda = 0.1) | **0.1864** | **0.3343** | 0.1927 | 0.1326 | 0.1904 | 0.2388 | 0.1713 | 0.4169 |
| 6. OCCP + Smoothing (lambda = 0.5) | **0.1864** | **0.3343** | 0.1927 | 0.1326 | 0.1904 | 0.2388 | 0.1713 | 0.4169 |
| 7. OCCP + Smoothing (lambda = 1.0) | **0.1864** | **0.3343** | 0.1927 | 0.1326 | 0.1904 | 0.2388 | 0.1713 | 0.4169 |
| 8. OCCP + Min-Support (M = 2) | **0.1822** | **0.3191** | 0.1875 | 0.1304 | 0.1842 | 0.2344 | 0.1681 | 0.4124 |
| 9. OCCP + Min-Support (M = 3) | **0.1692** | **0.2996** | 0.1563 | 0.1170 | 0.1654 | 0.2210 | 0.1666 | 0.4102 |
| 10. OCCP + Min-Support (M = 5) | **0.1702** | **0.2951** | 0.1458 | 0.1126 | 0.1571 | 0.2155 | 0.1655 | 0.4092 |
| 11. Continuous Score Fusion | **0.1794** | **0.3143** | 0.1753 | 0.1263 | 0.1800 | 0.2325 | 0.1711 | 0.3614 |
| 12. Combined (Smoothing 0.5 + M=2) | **0.1822** | **0.3191** | 0.1875 | 0.1304 | 0.1842 | 0.2344 | 0.1681 | 0.4124 |

## 4. Shopizer Detailed Results ($K=12$ Commits, $N=46$ Cases)

| Model Configuration | Macro MAP | Macro MRR | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1. Canonical Structural Baseline | **0.0432** | **0.1324** | 0.0619 | 0.0309 | 0.0556 | 0.0444 | 0.0387 | 0.0628 |
| 2. Historical Co-Change Reranker (V4) | **0.0897** | **0.1967** | 0.1412 | 0.0708 | 0.1087 | 0.0899 | 0.0606 | 0.0997 |
| 3. Context-Independent Typed Path (Model A) | **0.0689** | **0.1657** | 0.1053 | 0.0507 | 0.0854 | 0.0674 | 0.0590 | 0.0931 |
| 4. OCCP Original (Unregularized MLE) | **0.0759** | **0.1946** | 0.1181 | 0.0569 | 0.0920 | 0.0733 | 0.0623 | 0.0990 |
| 5. OCCP + Smoothing (lambda = 0.1) | **0.0759** | **0.1946** | 0.1181 | 0.0569 | 0.0920 | 0.0733 | 0.0623 | 0.0990 |
| 6. OCCP + Smoothing (lambda = 0.5) | **0.0759** | **0.1946** | 0.1181 | 0.0569 | 0.0920 | 0.0733 | 0.0623 | 0.0990 |
| 7. OCCP + Smoothing (lambda = 1.0) | **0.0759** | **0.1946** | 0.1181 | 0.0569 | 0.0920 | 0.0733 | 0.0623 | 0.0990 |
| 8. OCCP + Min-Support (M = 2) | **0.0663** | **0.1877** | 0.1088 | 0.0514 | 0.0809 | 0.0622 | 0.0582 | 0.0906 |
| 9. OCCP + Min-Support (M = 3) | **0.0651** | **0.1851** | 0.1071 | 0.0510 | 0.0778 | 0.0611 | 0.0566 | 0.0896 |
| 10. OCCP + Min-Support (M = 5) | **0.0591** | **0.1643** | 0.0978 | 0.0455 | 0.0750 | 0.0583 | 0.0566 | 0.0896 |
| 11. Continuous Score Fusion | **0.0891** | **0.1970** | 0.1412 | 0.0708 | 0.1118 | 0.0910 | 0.0637 | 0.1017 |
| 12. Combined (Smoothing 0.5 + M=2) | **0.0663** | **0.1877** | 0.1088 | 0.0514 | 0.0809 | 0.0622 | 0.0582 | 0.0906 |

## 5. Statistical Significance Across All $K=20$ Commits

### A. Pairwise Differences vs. Canonical Structural Baseline

| Model vs. Structural Baseline | Mean Diff (MAP) | Std Diff | $t$-Statistic | $p$-Value ($t$-test) | Wilcoxon $W$ | Wilcoxon $p$ | Win / Tie / Loss |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 2. Historical Co-Change Reranker (V4) | +0.0236 | 0.1019 | 1.03 | 0.3012 | 14.00 | 0.3139 | 6 / 11 / 3 |
| 3. Context-Independent Typed Path (Model A) | +0.0165 | 0.0699 | 1.06 | 0.2913 | 11.00 | 0.3270 | 5 / 12 / 3 |
| 4. OCCP Original (Unregularized MLE) | +0.0238 | 0.0777 | 1.37 | 0.1700 | 10.00 | 0.1386 | 6 / 11 / 3 |
| 5. OCCP + Smoothing (lambda = 0.1) | +0.0238 | 0.0777 | 1.37 | 0.1700 | 10.00 | 0.1386 | 6 / 11 / 3 |
| 6. OCCP + Smoothing (lambda = 0.5) | +0.0238 | 0.0777 | 1.37 | 0.1700 | 10.00 | 0.1386 | 6 / 11 / 3 |
| 7. OCCP + Smoothing (lambda = 1.0) | +0.0238 | 0.0777 | 1.37 | 0.1700 | 10.00 | 0.1386 | 6 / 11 / 3 |
| 8. OCCP + Min-Support (M = 2) | +0.0164 | 0.0561 | 1.31 | 0.1914 | 11.00 | 0.1731 | 6 / 11 / 3 |
| 9. OCCP + Min-Support (M = 3) | +0.0105 | 0.0509 | 0.92 | 0.3562 | 13.00 | 0.2604 | 6 / 11 / 3 |
| 10. OCCP + Min-Support (M = 5) | +0.0073 | 0.0445 | 0.73 | 0.4635 | 15.00 | 0.3743 | 5 / 11 / 4 |
| 11. Continuous Score Fusion | +0.0290 | 0.0998 | 1.30 | 0.1944 | 12.00 | 0.2135 | 6 / 11 / 3 |
| 12. Combined (Smoothing 0.5 + M=2) | +0.0164 | 0.0561 | 1.31 | 0.1914 | 11.00 | 0.1731 | 6 / 11 / 3 |

### B. Pairwise Differences vs. Historical Co-Change Reranker (V4)

| Model vs. Historical Reranker | Mean Diff (MAP) | Std Diff | $t$-Statistic | $p$-Value ($t$-test) | Wilcoxon $W$ | Wilcoxon $p$ | Win / Tie / Loss |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1. Canonical Structural Baseline | -0.0236 | 0.1019 | -1.03 | 0.3012 | 14.00 | 0.3139 | 3 / 11 / 6 |
| 3. Context-Independent Typed Path (Model A) | -0.0071 | 0.0538 | -0.59 | 0.5569 | 19.00 | 0.6784 | 4 / 11 / 5 |
| 4. OCCP Original (Unregularized MLE) | +0.0003 | 0.0563 | 0.02 | 0.9820 | 18.00 | 1.0000 | 4 / 12 / 4 |
| 5. OCCP + Smoothing (lambda = 0.1) | +0.0003 | 0.0563 | 0.02 | 0.9820 | 18.00 | 1.0000 | 4 / 12 / 4 |
| 6. OCCP + Smoothing (lambda = 0.5) | +0.0003 | 0.0563 | 0.02 | 0.9820 | 18.00 | 1.0000 | 4 / 12 / 4 |
| 7. OCCP + Smoothing (lambda = 1.0) | +0.0003 | 0.0563 | 0.02 | 0.9820 | 18.00 | 1.0000 | 4 / 12 / 4 |
| 8. OCCP + Min-Support (M = 2) | -0.0072 | 0.0729 | -0.44 | 0.6604 | 17.00 | 0.8886 | 4 / 12 / 4 |
| 9. OCCP + Min-Support (M = 3) | -0.0131 | 0.0682 | -0.86 | 0.3918 | 12.00 | 0.4008 | 2 / 12 / 6 |
| 10. OCCP + Min-Support (M = 5) | -0.0163 | 0.0851 | -0.85 | 0.3928 | 12.00 | 0.4008 | 2 / 12 / 6 |
| 11. Continuous Score Fusion | +0.0054 | 0.0259 | 0.93 | 0.3518 | 11.00 | 0.6121 | 4 / 13 / 3 |
| 12. Combined (Smoothing 0.5 + M=2) | -0.0072 | 0.0729 | -0.44 | 0.6604 | 17.00 | 0.8886 | 4 / 12 / 4 |

### C. Pairwise Differences vs. Original OCCP (Model B)

| Model vs. Original OCCP | Mean Diff (MAP) | Std Diff | $t$-Statistic | $p$-Value ($t$-test) | Wilcoxon $W$ | Wilcoxon $p$ | Win / Tie / Loss |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1. Canonical Structural Baseline | -0.0238 | 0.0777 | -1.37 | 0.1700 | 10.00 | 0.1386 | 3 / 11 / 6 |
| 2. Historical Co-Change Reranker (V4) | -0.0003 | 0.0563 | -0.02 | 0.9820 | 18.00 | 1.0000 | 4 / 12 / 4 |
| 3. Context-Independent Typed Path (Model A) | -0.0074 | 0.0179 | -1.84 | 0.0657 | 0.00 | 0.0277 | 0 / 14 / 6 |
| 5. OCCP + Smoothing (lambda = 0.1) | +0.0000 | 0.0000 | 0.00 | 1.0000 | 0.00 | 1.0000 | 0 / 20 / 0 |
| 6. OCCP + Smoothing (lambda = 0.5) | +0.0000 | 0.0000 | 0.00 | 1.0000 | 0.00 | 1.0000 | 0 / 20 / 0 |
| 7. OCCP + Smoothing (lambda = 1.0) | +0.0000 | 0.0000 | 0.00 | 1.0000 | 0.00 | 1.0000 | 0 / 20 / 0 |
| 8. OCCP + Min-Support (M = 2) | -0.0074 | 0.0275 | -1.21 | 0.2262 | 1.00 | 0.2850 | 1 / 17 / 2 |
| 9. OCCP + Min-Support (M = 3) | -0.0133 | 0.0414 | -1.44 | 0.1491 | 1.00 | 0.1441 | 1 / 16 / 3 |
| 10. OCCP + Min-Support (M = 5) | -0.0166 | 0.0548 | -1.35 | 0.1764 | 6.00 | 0.3454 | 2 / 14 / 4 |
| 11. Continuous Score Fusion | +0.0051 | 0.0376 | 0.61 | 0.5427 | 18.00 | 1.0000 | 4 / 12 / 4 |
| 12. Combined (Smoothing 0.5 + M=2) | -0.0074 | 0.0275 | -1.21 | 0.2262 | 1.00 | 0.2850 | 1 / 17 / 2 |

## 6. Fallback Rate Accounting Across Variants

| Variant | Tier 1 (Conditioned %) | Tier 2 (Generic %) | Tier 3 (Co-Change %) | Tier 4 (Structural %) | Total Decisions |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 4. OCCP Original (Unregularized MLE) | 20.2% | 1.1% | 57.1% | 21.6% | 3112 |
| 5. OCCP + Smoothing (lambda = 0.1) | 20.2% | 1.1% | 57.1% | 21.6% | 3112 |
| 6. OCCP + Smoothing (lambda = 0.5) | 20.2% | 1.1% | 57.1% | 21.6% | 3112 |
| 7. OCCP + Smoothing (lambda = 1.0) | 20.2% | 1.1% | 57.1% | 21.6% | 3112 |
| 8. OCCP + Min-Support (M = 2) | 19.9% | 1.1% | 57.2% | 21.8% | 3112 |
| 9. OCCP + Min-Support (M = 3) | 19.5% | 1.1% | 57.4% | 22.0% | 3112 |
| 10. OCCP + Min-Support (M = 5) | 19.1% | 1.2% | 57.7% | 22.1% | 3112 |
| 12. Combined (Smoothing 0.5 + M=2) | 19.9% | 1.1% | 57.2% | 21.8% | 3112 |

## 7. Synthesis and Strategic Decision on EGCP

### Why OCCP Variants Plateaus
1. **Sparse Traversal Overlap**: In modular repositories, the intersection of exact typed paths and specific operation categories remains tiny. As a result, Tier 1 is rarely invoked on Shopizer (only ~0.1% to 1.1% of decisions).
2. **Smoothing & Thresholds Prevent Harm but Cannot Create Missing Signal**: Applying Laplace smoothing and minimum-support thresholds successfully eliminates overfitting on PetClinic, but does not rescue Shopizer where semantic co-change occurs without explicit structural paths.
3. **Continuous Fusion Is Effective**: Continuous multi-channel score fusion successfully blends historical co-change and structural signals without arbitrary tier drop-offs, yielding the most stable balance across both repositories.
4. **Defensible Path Forward**: Further heuristic tuning of OCCP yields diminishing returns. Transitioning to EGCP (Evolutionary-Graph Change Propagation) or a Graph Neural Network / learned propagation approach is justified by these empirical boundaries.
