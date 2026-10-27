# Operation-Conditioned Change Propagation (OCCP) — Empirical Evaluation Report

**Protocol:** Retrospective Leave-One-Out Evaluation with Pre-Change Historical Knowledge Graph Reconstruction  
**Chronological Constraint:** Strictly Leak-Free Lookback ($j < c$)  
**Operating Traversal Horizon:** 2 Hops  
**Evaluation Date:** 2026-10-15  

---

## 1. Executive Summary & Core Experimental Findings

This report evaluates the **Operation-Conditioned Change Propagation (OCCP)** hypothesis across **Spring PetClinic REST** and **Shopizer**.
The central research hypothesis investigates:
*Does conditioning historical typed multi-hop relationship paths on the source-code edit operation improve change impact prediction compared with an otherwise equivalent context-independent path baseline and structural baselines?*

### Critical Empirical Conclusions:
1. **Model A vs Model B (Conditioned vs Context-Independent Paths):**
   - In **Spring PetClinic REST**:
     - Model A (Context-Free Path): MAP = **0.1786**, MRR = **0.3169**, P@3 = **0.1719**.
     - Model B (OCCP Conditioned): MAP = **0.1864**, MRR = **0.3343**, P@3 = **0.1927**.
     - **Observed Effect:** Conditioning on operation yields +4.40% in MAP and +12.12% in P@3.
   - In **Shopizer**:
     - Model A (Context-Free Path): MAP = **0.0689**, MRR = **0.1657**, P@3 = **0.1053**.
     - Model B (OCCP Conditioned): MAP = **0.0759**, MRR = **0.1946**, P@3 = **0.1181**.
     - **Observed Effect:** Conditioning yields +10.20% in MAP and +12.09% in P@3.

2. **Severe Historical Support Sparsity Limits Statistical Power:**
   - As documented in the Phase 1 Feasibility Report, PetClinic only has 26 historical Java graph episodes and Shopizer has 24.
   - Because historical co-change opportunities are partitioned across 6 operation categories and dozens of typed paths, statistical support per $(o, p)$ tuple is very low.
   - Consequently, the hypothesis is **statistically inconclusive** on these limited historical repositories. While the empirical ranking difference between Model A and Model B is isolated, neither demonstrates universal superiority over simple pairwise historical co-change reranking.

3. **Comparison with Existing Historical Co-Change Reranker (V4):**
   - The unconditioned pairwise co-change reranker (Config 2) achieves:
     - PetClinic: MAP = 0.1651, P@3 = 0.1500.
     - Shopizer: MAP = 0.0897, P@3 = 0.1412.
   - Direct co-change frequency at the component level retains higher sample density than path-conditioned channels when repository history contains fewer than 50 multi-component commits.

4. **Reciprocal Rank Fusion (RRF):**
   - Standard RRF ($k=60$) fusing structural baseline and historical co-change provides a solid baseline configuration without requiring manual threshold tuning.
   - Composite fusion adding OCCP produces incremental ranking shifts, but does not overcome the underlying data sparsity.

---

## 2. Full Comparative Results (2-Hop Operating Horizon)

### Spring PetClinic REST (Macro-Average Across Commits)
| Model Configuration | |C| | Precision | Recall | F1 | P@3 | P@5 | P@10 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Structural Baseline** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1654 | 0.1642 | 0.1626 | 0.1758 | 0.2913 |
| **2. Hist Co-Change Reranker (V4)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1500 | 0.1608 | 0.1665 | 0.1651 | 0.2825 |
| **3. Context-Free Path (Model A)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1719 | 0.1811 | 0.1728 | 0.1786 | 0.3169 |
| **4. OCCP (Model B)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1927 | 0.1904 | 0.1713 | 0.1864 | 0.3343 |
| **5. RRF Fusion (Struct + Hist, k=60)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1629 | 0.1674 | 0.1668 | 0.1752 | 0.2817 |
| **6. RRF Composite (+ OCCP, k=60)** | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1796 | 0.1732 | 0.1713 | 0.1818 | 0.3127 |

### Shopizer (Macro-Average Across Commits)
| Model Configuration | |C| | Precision | Recall | F1 | P@3 | P@5 | P@10 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Structural Baseline** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.0619 | 0.0556 | 0.0387 | 0.0432 | 0.1324 |
| **2. Hist Co-Change Reranker (V4)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1412 | 0.1087 | 0.0606 | 0.0897 | 0.1967 |
| **3. Context-Free Path (Model A)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1053 | 0.0854 | 0.0590 | 0.0689 | 0.1657 |
| **4. OCCP (Model B)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1181 | 0.0920 | 0.0623 | 0.0759 | 0.1946 |
| **5. RRF Fusion (Struct + Hist, k=60)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.0810 | 0.0698 | 0.0497 | 0.0560 | 0.1633 |
| **6. RRF Composite (+ OCCP, k=60)** | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1019 | 0.0813 | 0.0535 | 0.0659 | 0.1687 |

---

## 3. Hop-Depth Sensitivity Analysis

### Spring PetClinic REST (Macro-Average Across Commits)
| Hop Horizon | Model | Candidate Count | Precision | Recall | F1 | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hop 1** | Structural Baseline | 3.6860 | 0.1771 | 0.1383 | 0.1273 | 0.1746 | 0.1701 | 0.0781 | 0.2091 |
| | Historical Reranker | 3.6860 | 0.1771 | 0.1383 | 0.1273 | 0.1850 | 0.1774 | 0.0799 | 0.2120 |
| | Model A (Context-Free) | 3.6860 | 0.1771 | 0.1383 | 0.1273 | 0.2059 | 0.1847 | 0.0898 | 0.2745 |
| | Model B (OCCP) | 3.6860 | 0.1771 | 0.1383 | 0.1273 | 0.2059 | 0.1847 | 0.0898 | 0.2745 |
| **Hop 2** | Structural Baseline | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1654 | 0.1642 | 0.1758 | 0.2913 |
| | Historical Reranker | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1500 | 0.1608 | 0.1651 | 0.2825 |
| | Model A (Context-Free) | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1719 | 0.1811 | 0.1786 | 0.3169 |
| | Model B (OCCP) | 19.1007 | 0.1662 | 0.5655 | 0.2090 | 0.1927 | 0.1904 | 0.1864 | 0.3343 |
| **Hop 3** | Structural Baseline | 47.8904 | 0.0797 | 0.7026 | 0.1336 | 0.1654 | 0.1642 | 0.2014 | 0.2960 |
| | Historical Reranker | 47.8904 | 0.0797 | 0.7026 | 0.1336 | 0.1605 | 0.1646 | 0.1836 | 0.2885 |
| | Model A (Context-Free) | 47.8904 | 0.0797 | 0.7026 | 0.1336 | 0.1424 | 0.1625 | 0.1650 | 0.2783 |
| | Model B (OCCP) | 47.8904 | 0.0797 | 0.7026 | 0.1336 | 0.1684 | 0.1843 | 0.1822 | 0.2953 |

### Shopizer (Macro-Average Across Commits)
| Hop Horizon | Model | Candidate Count | Precision | Recall | F1 | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hop 1** | Structural Baseline | 3.7170 | 0.0618 | 0.0486 | 0.0467 | 0.0692 | 0.0668 | 0.0300 | 0.1269 |
| | Historical Reranker | 3.7170 | 0.0618 | 0.0486 | 0.0467 | 0.0883 | 0.0706 | 0.0399 | 0.1597 |
| | Model A (Context-Free) | 3.7170 | 0.0618 | 0.0486 | 0.0467 | 0.0802 | 0.0706 | 0.0373 | 0.1556 |
| | Model B (OCCP) | 3.7170 | 0.0618 | 0.0486 | 0.0467 | 0.0819 | 0.0706 | 0.0376 | 0.1597 |
| **Hop 2** | Structural Baseline | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.0619 | 0.0556 | 0.0432 | 0.1324 |
| | Historical Reranker | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1412 | 0.1087 | 0.0897 | 0.1967 |
| | Model A (Context-Free) | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1053 | 0.0854 | 0.0689 | 0.1657 |
| | Model B (OCCP) | 41.4010 | 0.0216 | 0.1295 | 0.0330 | 0.1181 | 0.0920 | 0.0759 | 0.1946 |
| **Hop 3** | Structural Baseline | 357.6528 | 0.0060 | 0.6896 | 0.0117 | 0.0619 | 0.0556 | 0.0512 | 0.1356 |
| | Historical Reranker | 357.6528 | 0.0060 | 0.6896 | 0.0117 | 0.1956 | 0.1740 | 0.2300 | 0.3007 |
| | Model A (Context-Free) | 357.6528 | 0.0060 | 0.6896 | 0.0117 | 0.0961 | 0.0753 | 0.0797 | 0.1571 |
| | Model B (OCCP) | 357.6528 | 0.0060 | 0.6896 | 0.0117 | 0.1013 | 0.0823 | 0.0835 | 0.1672 |

---

## 4. Stratified Analysis by Operation Category

### Spring PetClinic REST:

#### Category: `METHOD_BODY_OR_IMPLEMENTATION` (25 cases)
| Configuration | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- |
| Structural Baseline | 0.1467 | 0.1680 | 0.1090 | 0.2121 |
| Historical Reranker | 0.2000 | 0.1760 | 0.1170 | 0.2674 |
| Model A (Context-Free) | 0.2267 | 0.2080 | 0.1396 | 0.3713 |
| Model B (OCCP) | 0.2267 | 0.2080 | 0.1396 | 0.3713 |
| RRF Fusion | 0.1600 | 0.1600 | 0.1105 | 0.2304 |


#### Category: `UNKNOWN_OR_MIXED` (32 cases)
| Configuration | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- |
| Structural Baseline | 0.1562 | 0.1750 | 0.1746 | 0.3285 |
| Historical Reranker | 0.1354 | 0.1813 | 0.1659 | 0.3039 |
| Model A (Context-Free) | 0.1667 | 0.1875 | 0.1714 | 0.3053 |
| Model B (OCCP) | 0.2083 | 0.2063 | 0.1879 | 0.3454 |
| RRF Fusion | 0.1458 | 0.1813 | 0.1732 | 0.3026 |


### Shopizer:

#### Category: `METHOD_SIGNATURE_OR_DECLARATION` (11 cases)
| Configuration | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- |
| Structural Baseline | 0.0909 | 0.1091 | 0.0745 | 0.1481 |
| Historical Reranker | 0.3030 | 0.2364 | 0.1847 | 0.4129 |
| Model A (Context-Free) | 0.2424 | 0.2000 | 0.1465 | 0.2880 |
| Model B (OCCP) | 0.3030 | 0.2364 | 0.1778 | 0.5000 |
| RRF Fusion | 0.1515 | 0.1455 | 0.0996 | 0.2477 |


#### Category: `METHOD_BODY_OR_IMPLEMENTATION` (10 cases)
| Configuration | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- |
| Structural Baseline | 0.2000 | 0.1800 | 0.1175 | 0.4550 |
| Historical Reranker | 0.3667 | 0.3200 | 0.2463 | 0.5050 |
| Model A (Context-Free) | 0.2667 | 0.2200 | 0.1589 | 0.4568 |
| Model B (OCCP) | 0.3000 | 0.2400 | 0.1766 | 0.4568 |
| RRF Fusion | 0.2333 | 0.2200 | 0.1530 | 0.5050 |


#### Category: `UNKNOWN_OR_MIXED` (25 cases)
| Configuration | P@3 | P@5 | MAP | MRR |
| :--- | :--- | :--- | :--- | :--- |
| Structural Baseline | 0.1333 | 0.1200 | 0.0705 | 0.2969 |
| Historical Reranker | 0.2933 | 0.2160 | 0.1272 | 0.4271 |
| Model A (Context-Free) | 0.2400 | 0.2000 | 0.1198 | 0.3934 |
| Model B (OCCP) | 0.2533 | 0.2000 | 0.1222 | 0.4254 |
| RRF Fusion | 0.1733 | 0.1440 | 0.0885 | 0.3644 |


---

## 5. Methodological Validity & Threat Analysis

1. **Construct Validity:**
   - Commit co-change is a proxy for change impact, reflecting which files were checked in together rather than pure runtime causality.
2. **Internal Validity (Temporal Integrity):**
   - Strictly guaranteed: for each target commit $c$, historical models and co-change tables are trained strictly on commits older than $c$ ($j < c$).
   - Pre-change graphs are reconstructed from the parent revision ($c^1$).
   - Target commit changes and ground truth are held out until ranking is frozen.
3. **Statistical Power Threat:**
   - PetClinic has only 8 multi-component commits (57 LOO cases), and Shopizer has 12 (46 LOO cases).
   - In both repositories, fewer than 30 historical commits contain Java changes.
   - Conditioning paths on operations severely splits the data into sparse buckets. Consequently, no claim of generalizable superiority or confirmed novelty is justified.
