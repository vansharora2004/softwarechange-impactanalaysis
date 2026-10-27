# Comprehensive Research Evaluation Report: Evolutionary-Graph Change Propagation (EGCP) vs. Frozen Baselines

**Evaluation Date:** 2026-10-20  
**Project:** Software Change Impact Analysis Benchmark  
**Working Directory:** `C:\yashika\STUDY\clg_project\software_change`  
**Git Base Commit:** `2d233cf` (`main` branch)  
**Evaluation Harness:** [`backend/src/evaluation/v5/egcpEvaluator.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/evaluation/v5/egcpEvaluator.js)  
**Deliverable Directory:** `research_artifacts/egcp_evaluation_20261020/`

---

## 1. Executive Summary & Core Research Findings

This investigation evaluated the newly developed **Evolutionary-Graph Change Propagation (EGCP)** model against the officially frozen **Continuous Score Fusion (CSF)** baseline and three reference models (**Canonical Structural Baseline**, **Historical Co-Change Reranker V4**, and **Original OCCP Model B**) across the frozen benchmark of **25 commits and 170 leave-one-out test cases** spanning three diverse Java repositories:
1. **Spring PetClinic REST** (Spring Boot web service, $K=8, N=57$)
2. **Shopizer** (Large-scale monolithic e-commerce framework, $K=12, N=46$)
3. **Apache Commons Lang** (Foundational utility library, $K=5, N=67$)

### Key Empirical Findings:

1. **Continuous Score Fusion (CSF) Remains the Highest-Performing Overall Model:**
   - **CSF Macro MAP: 0.1318**, MRR: 0.2366, P@5: 0.1359, R@5: 0.1652, F1@5: 0.1274.
   - CSF outperforms Canonical Structural Baseline by **+52.4% relative gain** in MAP ($p = 0.052$) and outperforms Historical Co-Change Reranker (V4) by **+10.9% relative gain**.

2. **EGCP-Evo ($\alpha = 0.0$) Demonstrates Strong Evolutionary Diffusion:**
   - **EGCP-Evo Macro MAP: 0.1233**, MRR: 0.2382, P@5: 0.1356, R@5: 0.1478, F1@5: 0.1238.
   - EGCP-Evo beats the Canonical Structural Baseline (+42.5% relative gain) and the Historical Co-Change Reranker V4 (+3.8% relative gain).
   - **Shopizer Breakthrough:** On Shopizer, EGCP-Evo achieves **MAP = 0.1021**, setting the new best result across all evaluated models (beating CSF's 0.0891, V4's 0.0897, and Canonical Baseline's 0.0432).

3. **Ablation Analysis: The Structural Diffusion Dilution Phenomenon:**
   - When pure structural diffusion is applied (**EGCP-Struct**, $\alpha = 1.0$), overall MAP drops to **0.0855** (comparable to the Canonical Baseline's 0.0865).
   - When dual-channel diffusion is applied (**EGCP-Dual**, $\alpha = 0.5$), overall MAP is **0.0861**.
   - *Theoretical Explanation:* In dense object-oriented codebases, structural AST edges (`DEPENDS_ON`, `USES`, `EXTENDS`, `REFERENCES`) create dense networks where high-degree intermediary classes (entities, configuration beans, utility singletons) act as "energy sinks" that dilute random-walk probability away from true co-change targets. In contrast, **CSF prevents this dilution** by evaluating structural rank and historical co-change as separate additive score channels ($S_{\text{cond}} + S_{\text{gen}} + S_{\text{hist}} + S_{\text{struct}}$) rather than a unified Markov transition matrix.

4. **Code and Environment Integrity Fully Preserved:**
   - Zero modifications were made to any protected OCCP implementation or to live UI/API production files (`impactEngine.js`, `/api/analyse-impact`, `App.jsx`). All pre-implementation SHA-256 hashes match identically post-evaluation.

---

## 2. Evaluation Universe & Rigorous Experimental Controls

To guarantee complete fairness and eliminate data leakage, the exact same evaluation protocol was enforced across all models:

| Control Dimension | Specification & Verification |
| :--- | :--- |
| **Commit Universe ($K$)** | Exactly identical 25 eligible commits across the 3 repositories ($K_{\text{PetClinic}}=8, K_{\text{Shopizer}}=12, K_{\text{Lang}}=5$). |
| **Test Case Universe ($N$)** | Exactly identical 170 leave-one-out evaluation cases ($N_{\text{PetClinic}}=57, N_{\text{Shopizer}}=46, N_{\text{Lang}}=67$). |
| **Temporal AST Graph** | Synthesized strictly from the pre-change commit state $c^1$ (parent SHA) via git worktrees. No future syntax leaked. |
| **Historical Data Partitioning** | Co-change frequencies and path training data restricted strictly to older commits ($j < c$). Zero target commit co-change leakage. |
| **Candidate Universe ($|\mathcal{C}|$)** | Identical 2-hop structural candidate set for all models. **0 candidates dropped or added**. |
| **Oracle Sequestration** | Evaluation ground-truth components (`retroOracle`) held out strictly for metric scoring. |
| **Tie-Breaking Determinism** | 100% deterministic tie-breaking hierarchy terminating in alphabetical component ID comparison. |

---

## 3. Master Evaluation Results ($K=25$ Commits, $N=170$ Cases)

The table below presents the macro-averaged performance across all 25 commits and 170 test cases for all evaluated models:

| Model | Macro MAP | Macro MRR | P@3 | R@3 | F1@3 | Hit@3 | P@5 | R@5 | F1@5 | Hit@5 | P@10 | R@10 | F1@10 | Hit@10 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Canonical Structural Baseline** | 0.0865 | 0.1712 | 0.0841 | 0.0724 | 0.0634 | 0.2111 | 0.0849 | 0.0997 | 0.0768 | 0.2833 | 0.0793 | 0.1634 | 0.0894 | 0.3620 |
| **Historical Co-Change Reranker (V4)** | 0.1188 | 0.2132 | 0.1306 | 0.0912 | 0.0940 | 0.2504 | 0.1253 | 0.1435 | 0.1181 | 0.3252 | 0.0963 | 0.2091 | 0.1122 | 0.4001 |
| **Original OCCP (Model B)** | 0.1277 | **0.2418** | 0.1500 | 0.1101 | 0.1097 | 0.2656 | 0.1295 | 0.1588 | 0.1211 | 0.3444 | 0.0993 | **0.2283** | 0.1158 | **0.4101** |
| **Continuous Score Fusion (CSF Frozen Baseline)** | **0.1318** | 0.2366 | **0.1558** | **0.1147** | **0.1151** | 0.2580 | **0.1359** | **0.1652** | **0.1274** | 0.3444 | **0.0999** | 0.2118 | 0.1151 | 0.4047 |
| **EGCP-Evo ($\alpha = 0.0$, Pure Evolutionary)** | 0.1233 | 0.2382 | 0.1449 | 0.0946 | 0.0993 | **0.2641** | 0.1356 | 0.1478 | 0.1238 | 0.3289 | 0.0987 | 0.1932 | 0.1124 | 0.3819 |
| **EGCP-Dual ($\alpha = 0.5$, Balanced Dual-Channel)** | 0.0861 | 0.1409 | 0.0700 | 0.0878 | 0.0613 | 0.1982 | 0.0846 | 0.1401 | 0.0861 | 0.2988 | 0.0910 | 0.2273 | 0.1074 | 0.4465 |
| **EGCP-Struct ($\alpha = 1.0$, Pure Structural)** | 0.0855 | 0.1349 | 0.0616 | 0.0672 | 0.0504 | 0.1673 | 0.0827 | 0.1393 | 0.0849 | 0.2956 | 0.0925 | 0.2301 | 0.1094 | 0.4421 |

---

## 4. Project-Level Breakdown

The cross-repository breakdown illustrates how architectural paradigms interact with propagation mechanisms:

### A. Spring PetClinic REST ($K=8$ commits, $N=57$ test cases)
*Architecture: Spring Data JPA web service with standard Controller-Service-Repository tiers.*

| Model | MAP | MRR | P@5 | R@5 | F1@5 | Hit@5 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Canonical Structural Baseline | 0.1758 | 0.2913 | 0.1642 | 0.2231 | 0.1557 | 0.5169 |
| Historical Co-Change Reranker (V4) | 0.1651 | 0.2825 | 0.1608 | 0.1668 | 0.1422 | 0.4735 |
| Original OCCP (Model B) | **0.1864** | **0.3343** | **0.1904** | **0.2388** | **0.1752** | 0.5146 |
| Continuous Score Fusion (CSF) | 0.1794 | 0.3143 | 0.1800 | 0.2325 | 0.1674 | 0.5146 |
| EGCP-Evo ($\alpha = 0.0$) | 0.1604 | 0.3042 | 0.1564 | 0.1626 | 0.1378 | 0.4539 |
| EGCP-Dual ($\alpha = 0.5$) | 0.1365 | 0.2570 | 0.1496 | 0.1553 | 0.1304 | 0.4816 |
| EGCP-Struct ($\alpha = 1.0$) | 0.1316 | 0.2350 | 0.1435 | 0.1529 | 0.1268 | 0.4717 |

*Analysis:* In PetClinic, typed syntactic paths (Model B / CSF) perform best because the application adheres strictly to standard Spring stereotypes (`Controller -> Service -> Repository`), making operation-conditioned path transitions highly informative.

---

### B. Shopizer ($K=12$ commits, $N=46$ test cases)
*Architecture: Large-scale monolithic enterprise e-commerce system with dense entity graphs and cross-module services.*

| Model | MAP | MRR | P@5 | R@5 | F1@5 | Hit@5 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Canonical Structural Baseline | 0.0432 | 0.1324 | 0.0556 | 0.0444 | 0.0472 | 0.1910 |
| Historical Co-Change Reranker (V4) | 0.0897 | 0.1967 | 0.1087 | 0.0899 | 0.0946 | 0.2240 |
| Original OCCP (Model B) | 0.0759 | 0.1946 | 0.0920 | 0.0733 | 0.0780 | 0.2292 |
| Continuous Score Fusion (CSF) | 0.0891 | 0.1970 | 0.1118 | 0.0910 | 0.0962 | 0.2292 |
| **EGCP-Evo ($\alpha = 0.0$)** | **0.1021** | **0.2344** | **0.1330** | **0.1017** | **0.1095** | **0.2448** |
| EGCP-Dual ($\alpha = 0.5$) | 0.0202 | 0.0359 | 0.0087 | 0.0066 | 0.0071 | 0.0434 |
| EGCP-Struct ($\alpha = 1.0$) | 0.0215 | 0.0371 | 0.0087 | 0.0066 | 0.0071 | 0.0434 |

*Analysis:* **EGCP-Evo sets the new state of the art on Shopizer (+14.6% over CSF, +136.3% over Canonical Baseline).** Because Shopizer has extensive commit history across business modules, personalized random walks over the Salton-normalized evolutionary graph effectively discover latent multi-hop co-change clusters. Conversely, structural random walks collapse (MAP 0.0215) because ubiquitous entity classes (`Order`, `Customer`, `Product`) create massive fan-out hubs that diffuse energy non-selectively.

---

### C. Apache Commons Lang ($K=5$ commits, $N=67$ test cases)
*Architecture: Core utility library with compact static utility classes and minimal historical co-change.*

| Model | MAP | MRR | P@5 | R@5 | F1@5 | Hit@5 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Canonical Structural Baseline | 0.0472 | 0.0723 | 0.0286 | 0.0346 | 0.0214 | 0.1310 |
| Historical Co-Change Reranker (V4) | 0.1147 | 0.1417 | 0.1086 | 0.2346 | 0.1357 | 0.3310 |
| Original OCCP (Model B) | **0.1581** | **0.2071** | 0.1222 | 0.2359 | 0.1380 | 0.3488 |
| Continuous Score Fusion (CSF) | 0.1579 | **0.2071** | 0.1229 | 0.2359 | 0.1381 | 0.3488 |
| EGCP-Evo ($\alpha = 0.0$) | 0.1147 | 0.1417 | 0.1086 | 0.2346 | 0.1357 | 0.3310 |
| **EGCP-Struct ($\alpha = 1.0$)** | 0.1651 | 0.2095 | **0.1629** | **0.4359** | **0.2048** | **0.6190** |
| **EGCP-Dual ($\alpha = 0.5$)** | 0.1635 | 0.2072 | **0.1629** | **0.4359** | **0.2048** | **0.6190** |

*Analysis:* In Commons Lang, **EGCP-Struct and EGCP-Dual outperform all other models**, reaching an exceptional **Recall@5 of 0.4359 and Hit@5 of 0.6190 (F1@5 = 0.2048 vs. CSF's 0.1381)**. In utility libraries where class dependencies are tightly coupled (`StringUtils -> CharSequenceUtils`) and past commit history is sparse, personalized structural random walks explore deeper dependency chains much more effectively than static BFS hops or sparse co-change logs.

---

## 5. Ablation Analysis: Channel Dissection

| Configuration | $\alpha$ Parameter | Operational Channel | Macro MAP | Macro MRR | P@5 | R@5 | F1@5 | Hit@5 |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **EGCP-Evo** | $\alpha = 0.0$ | Pure Evolutionary Co-Change Diffusion | **0.1233** | **0.2382** | **0.1356** | 0.1478 | **0.1238** | **0.3289** |
| **EGCP-Dual** | $\alpha = 0.5$ | Balanced Dual-Channel Diffusion | 0.0861 | 0.1409 | 0.0846 | 0.1401 | 0.0861 | 0.2988 |
| **EGCP-Struct** | $\alpha = 1.0$ | Pure Structural AST Diffusion | 0.0855 | 0.1349 | 0.0827 | 0.1393 | 0.0849 | 0.2956 |

### Theoretical Implication of Ablation Results:
1. **Coupling vs. Orthogonal Scoring:** Directly blending structural and evolutionary transitions inside a single transition matrix $P = \alpha P_{\text{struct}} + (1-\alpha) P_{\text{evo}}$ causes the dense structural channel to "short-circuit" the sparse evolutionary channel.
2. **Why CSF Outperforms EGCP Overall:** CSF keeps the channels structurally orthogonal:
   $$S(u) = 0.35 \cdot S_{\text{cond}}(u) + 0.15 \cdot S_{\text{gen}}(u) + 0.35 \cdot S_{\text{hist}}(u) + 0.15 \cdot S_{\text{struct}}(u)$$
   By normalizing each score independently before linear combination, CSF preserves the strong signal of evolutionary co-change even in repositories with thousands of structural edges.

---

## 6. Statistical Significance Analysis

Paired two-tailed Student's t-tests and Wilcoxon signed-rank tests were computed across all $K=25$ independent commit evaluations comparing the frozen baseline against candidate models:

| Comparison | Mean Difference ($\Delta \text{MAP}$) | $t$-statistic | $p$-value ($t$-test) | Wilcoxon $W$ | Wilcoxon $p$-value | Win / Tie / Loss | Statistical Significance ($\alpha = 0.05$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **CSF vs. Canonical Baseline** | **+0.0453** | **+2.046** | **0.0520** | **45.0** | **0.0384** | **14 / 4 / 7** | **Significant (Wilcoxon $p < 0.05$)** |
| **CSF vs. Historical V4** | **+0.0130** | **+1.564** | 0.1308 | 58.0 | 0.1042 | **11 / 6 / 8** | Not statistically significant |
| **CSF vs. Original OCCP** | **+0.0041** | **+0.824** | 0.4178 | 72.0 | 0.3891 | **8 / 11 / 6** | Not statistically significant |
| **CSF vs. EGCP-Evo** | **+0.0085** | **+0.812** | 0.4168 | 68.0 | 0.3245 | **13 / 5 / 7** | Not statistically significant |
| **CSF vs. EGCP-Dual** | **+0.0457** | **+1.457** | 0.1450 | 52.0 | 0.0894 | **10 / 6 / 9** | Not statistically significant |
| **EGCP-Evo vs. Canonical Baseline** | **+0.0368** | **+1.572** | 0.1160 | 54.0 | 0.0982 | **14 / 4 / 7** | Not statistically significant |

*Observation:* While CSF demonstrates the highest overall MAP and Wilcoxon significance over the Canonical Structural Baseline ($p = 0.0384$), the differences between CSF, Original OCCP, and EGCP-Evo are not statistically significant at $p < 0.05$ across the 25-commit universe, representing comparable top-tier performance with different trade-offs across repository architectures.

---

## 7. Computational Complexity & Execution Performance

| Model | Average Latency per Test Case | Memory Footprint | Convergence Iterations | Graph Overhead |
| :--- | :---: | :---: | :---: | :---: |
| **Canonical Structural Baseline** | $< 1.0\text{ ms}$ | Minimal ($< 10\text{ MB}$) | N/A (BFS Hop Traversal) | Low (AST in-memory) |
| **Historical Reranker (V4)** | $< 1.5\text{ ms}$ | Minimal ($< 15\text{ MB}$) | N/A (Map lookup) | Low (History counts) |
| **Continuous Score Fusion (CSF)** | $2.8\text{ ms}$ | Moderate ($< 35\text{ MB}$) | N/A (Closed-form formulas) | Moderate (Path extraction) |
| **EGCP (All Variants)** | $738.9\text{ ms}$ | Moderate ($~120\text{ MB}$) | $42 - 50$ iterations ($L_1 < 10^{-4}$) | High (Full adjacency build) |

EGCP requires power iteration over the full repository graph ($N_{\text{nodes}} \approx 1,000 - 5,000$). While it converges stably within 50 iterations, its runtime is ~250x higher than CSF's closed-form evaluation.

---

## 8. Final Synthesis & Model Freezing Recommendation

### Definitive Recommendation:
**Officially Freeze Continuous Score Fusion (CSF) as the Master Research Baseline.**

### Evidence-Based Rationale:
1. **Best Global Metric Performance:** CSF achieves the highest Macro MAP (0.1318), highest Precision@5 (0.1359), highest Recall@5 (0.1652), and highest F1@5 (0.1274) across the entire benchmark.
2. **Robust Multi-Channel Decoupling:** By treating conditioned paths, generic paths, historical co-change, and structural topology as distinct additive channels, CSF avoids the graph dilution failure mode observed in EGCP-Dual on enterprise codebases (Shopizer).
3. **Low Latency & High Reproducibility:** CSF evaluates in $< 3\text{ ms}$ per case with closed-form deterministic arithmetic, making it ideal for both production baseline deployment and reproducible research benchmarks.
4. **Role of EGCP:** EGCP should remain preserved as an **independent specialized research model** in `backend/src/services/egcp/`. Its remarkable results on Shopizer (EGCP-Evo MAP 0.1021) and Commons Lang (EGCP-Struct F1@5 0.2048, Hit@5 0.6190) prove that graph diffusion is highly effective when tuned to repository architectural typology, providing an excellent foundation for future domain-adaptive routing.
