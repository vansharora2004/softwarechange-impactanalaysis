# Final OCCP Verification & Baseline Freeze Report

**Date:** 2026-10-20  
**Project:** Context-Aware Software Change Impact Analysis Framework  
**Verification Directory:** `software_change/research_artifacts/occp_final_verification_20261020/`  
**Git Base Commit:** `2d233cf` (Branch `main`)  
**Scope:** Spring PetClinic REST ($K=8$), Shopizer ($K=12$), Apache Commons Lang ($K=5$) — Total $K=25$ commits, $N=170$ leave-one-out cases.

---

## 1. Executive Summary

This report delivers the final reproducible verification and official freeze of the research baseline for the B.Tech Software Change Impact Analysis project. Across three diverse software architectures—a modern Spring Boot microservice REST API (Spring PetClinic REST), an enterprise multi-module e-commerce monolith (Shopizer), and a low-level static utility library (Apache Commons Lang)—we verified the implementation, dataset eligibility, chronological leakage prevention, candidate set alignment, and metric calculations of Operation-Conditioned Change Propagation (OCCP) and its variants against canonical baselines.

### Primary Verified Findings:
1. **Discrepancy in Commons Lang Fully Resolved:**  
   The difference between the earlier count of 4 commits ($N=11$ cases) and the subsequent count of 5 commits ($N=67$ cases) was traced to commit `ed311151c9` (a bulk Javadoc and exception spelling fix touching 56 non-test Java files). The earlier ad-hoc script hardcoded 4 localized commits, whereas the automated pipeline uniformly applied canonical criteria (E1–E9) without human filtering. Both the 5-commit uniform baseline and the 4-commit sensitivity baseline confirm identical scientific conclusions.
2. **Strict Chronological Leakage Prevention:**  
   All evaluated cases reconstruct pre-change AST graphs at the parent revision $c^1$, slice historical training data strictly to commits older than the evaluated commit ($j < c$), and hold out ground-truth target labels exclusively for post-ranking scoring. Across all 170 evaluation cases, exactly **0 candidate alignment violations** were detected ($|\mathcal{C}|$ preserved identically across all models).
3. **Statistical Verdict on OCCP:**  
   While **Continuous Multi-Channel Score Fusion** achieves the highest numerical Macro MAP (**0.1318**, +52.4% over Canonical Structural Baseline), paired statistical testing across $K=25$ independent commits reveals that **neither Original OCCP nor Continuous Score Fusion achieves a statistically significant improvement over the V4 Historical Co-Change Reranker** ($p = 0.4957$ and $p = 0.1691$, respectively).
4. **Architectural Bottleneck & Justification for EGCP:**  
   The lack of statistical separation is driven by **syntactic sparsity in exact AST path matching**: 54–56% of changes modify multiple syntactic categories simultaneously (`UNKNOWN_OR_MIXED`), and over 78% of ranking decisions fall back past typed paths. Heuristic tuning of syntactic OCCP has reached its performance ceiling. Transitioning to **Evolutionary-Graph Change Propagation (EGCP)** is fully warranted to learn continuous latent representations of diffuse architectural coupling.
5. **Research Baseline Officially Frozen:**  
   The benchmark datasets, models, metrics, and evaluation protocols are officially frozen. The live UI remains bound to the Canonical Structural Baseline.

---

## 2. Investigation of the Apache Commons Lang Discrepancy

### A. Root Cause Identification
In previous documentation, two different commit and case counts were reported for Apache Commons Lang:
- Earlier report (`commons_lang_evaluation_20261019`): **4 eligible commits, 11 test cases**.
- Master evaluation report (`occp_final_evaluation_20261020`): **5 eligible commits, 67 test cases**.

A systematic code audit of both evaluation harnesses revealed the exact cause:

1. **The Earlier Ad-Hoc Script (`scratch/evaluate_commons_lang_candidates.js`):**  
   The developer manually hardcoded an array of 4 target commit prefixes:
   ```javascript
   const targetHashes = [
     '72dc555185', // Organize imports (3 files)
     '4c87656ee5', // LANG-1837 string cache (3 files)
     '8065c45316', // JavaVersion.JAVA_28 (2 files)
     '117a9ea791'  // FastDate timezone (3 files)
   ];
   ```
   This manual selection produced exactly 4 commits and $3 + 3 + 2 + 3 = 11$ leave-one-out cases. The script intentionally omitted commit `ed311151c9` because it modified 64 files (56 non-test Java files).
2. **The Generic Automated Pipeline (`backend/src/evaluation/v5/finalThreeProjectEvaluator.js`):**  
   The automated pipeline evaluated the recent 100 commits dynamically using `buildHistoricalCasesFast` without hardcoded hashes. Under canonical rules (E1: non-merge, E2: Java present, E7: non-test present, E8: $\ge 2$ non-test components), `ed311151c9` passed all criteria. In Leave-One-Out splitting, each of the 56 mapped classes served as an input seed, yielding 56 cases from that single commit ($3 + 3 + 56 + 2 + 3 = 67$ total cases).
3. **The Template String Discrepancy in `finalThreeProjectEvaluator.js`:**  
   In `finalThreeProjectEvaluator.js` line 849, the markdown generation template contained copy-pasted text from the earlier report stating `$K=4, N=11$`, while its own results table, CSV, and raw JSON reported the true runtime data ($K=5, N=67$).

### B. Sensitivity Analysis: 5 Commits ($N=67$) vs. 4 Commits ($N=11$)

To eliminate any ambiguity regarding whether the bulk Javadoc commit `ed31115` skews the evaluation, we recalculated metrics under both protocols:

| Model | Commons Lang (5 Commits, $N=67$) MAP | Commons Lang (4 Commits, $N=11$) MAP | Relative Impact of Excluding Bulk Commit |
| :--- | :---: | :---: | :---: |
| **Canonical Structural Baseline** | **0.0472** | **0.0575** | +21.8% |
| **Historical Co-Change Reranker (V4)** | **0.1147** | **0.1419** | +23.7% |
| **Context-Independent Typed Path (Model A)** | **0.1581** | **0.1951** | +23.4% |
| **Original OCCP (Model B)** | **0.1581** | **0.1951** | +23.4% |
| **Continuous Score Fusion** | **0.1582** | **0.1951** | +23.3% |
| **Enhanced OCCP** | **0.1578** | **0.1951** | +23.6% |

**Scientific Conclusion:**  
In both protocols, **OCCP and Continuous Score Fusion tie exactly with Model A and fall back past typed paths**. Because utility classes in Commons Lang lack multi-hop architectural dependency paths, typed-path support is 0, causing OCCP to collapse to historical co-change. The presence or absence of `ed31115` changes absolute metric levels slightly due to averaging, but has **zero impact on the comparative ranking or scientific conclusion**.

The defensible, uniform protocol for multi-project benchmarks is to apply the documented canonical eligibility rules (E1–E9) across all repositories without manual commit filtering ($K=5, N=67$).

---

## 3. Chronological Leakage Prevention Audit

Every evaluated commit was audited against 8 formal leakage criteria. Full proofs are detailed in [`leakage_audit.md`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/occp_final_verification_20261020/leakage_audit.md):

1. **Pre-Change AST Graph Reconstruction ($c^1$):** Reconstructed exclusively at parent SHA using temporary Git worktrees. Future code and dependencies introduced in commit $c$ are strictly absent.
2. **Strict Chronological History Lookback ($j < c$):** Historical co-change frequencies and training episodes are sliced strictly to `allCommits.slice(testIndex + 1)`. Commit $c$ and all subsequent commits are completely inaccessible.
3. **Oracle Secrecy:** Ground-truth targets are held out exclusively until all models produce frozen ranking arrays. No model ranking function has access to target labels.
4. **Candidate Universe Preservation:** All 6 compared models evaluate the exact same candidate list $\mathcal{C}$ produced by 2-hop BFS on $G(c^1)$. Exactly **0 candidate alignment violations** occurred across all 170 cases.
5. **Cache Pollution Prevention:** All graph caches are keyed by immutable parent Git SHAs, preventing cross-commit cache pollution.

**Status: VERIFIED LEAK-FREE.**

---

## 4. Master Verified Metrics Table

All metrics below have been recalculated directly from raw case results (`experiment_results.json`) and verified across all 170 cases:

| Project | Model | Eligible Commits | Test Cases | Macro MAP | Macro MRR | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Spring PetClinic REST** | Canonical Structural Baseline | 8 | 57 | **0.1758** | **0.2913** | 0.1654 | 0.1796 | 0.1642 | 0.2231 | 0.1626 | 0.3519 |
| | Historical Co-Change Reranker (V4) | 8 | 57 | **0.1651** | **0.2825** | 0.1500 | 0.1159 | 0.1608 | 0.1668 | 0.1665 | 0.3564 |
| | Context-Independent Path (Model A) | 8 | 57 | **0.1786** | **0.3169** | 0.1719 | 0.1237 | 0.1811 | 0.2321 | 0.1728 | 0.4191 |
| | Original OCCP (Model B) | 8 | 57 | **0.1864** | **0.3343** | 0.1927 | 0.1326 | 0.1904 | 0.2388 | 0.1713 | 0.4169 |
| | Continuous Score Fusion | 8 | 57 | **0.1794** | **0.3143** | 0.1753 | 0.1263 | 0.1800 | 0.2325 | 0.1711 | 0.3614 |
| | Enhanced OCCP | 8 | 57 | **0.1745** | **0.2886** | 0.1701 | 0.1241 | 0.1623 | 0.1668 | 0.1701 | 0.3605 |
| **Shopizer** | Canonical Structural Baseline | 12 | 46 | **0.0432** | **0.1324** | 0.0619 | 0.0309 | 0.0556 | 0.0444 | 0.0387 | 0.0628 |
| | Historical Co-Change Reranker (V4) | 12 | 46 | **0.0897** | **0.1967** | 0.1412 | 0.0708 | 0.1087 | 0.0899 | 0.0606 | 0.0997 |
| | Context-Independent Path (Model A) | 12 | 46 | **0.0689** | **0.1657** | 0.1053 | 0.0507 | 0.0854 | 0.0674 | 0.0590 | 0.0931 |
| | Original OCCP (Model B) | 12 | 46 | **0.0759** | **0.1946** | 0.1181 | 0.0569 | 0.0920 | 0.0733 | 0.0623 | 0.0990 |
| | Continuous Score Fusion | 12 | 46 | **0.0891** | **0.1970** | 0.1412 | 0.0708 | 0.1118 | 0.0910 | 0.0637 | 0.1017 |
| | Enhanced OCCP | 12 | 46 | **0.0901** | **0.1968** | 0.1412 | 0.0708 | 0.1097 | 0.0903 | 0.0637 | 0.1017 |
| **Apache Commons Lang** | Canonical Structural Baseline | 5 | 67 | **0.0472** | **0.0723** | 0.0071 | 0.0004 | 0.0286 | 0.0346 | 0.0433 | 0.1029 |
| | Historical Co-Change Reranker (V4) | 5 | 67 | **0.1147** | **0.1417** | 0.0738 | 0.1004 | 0.1086 | 0.2346 | 0.0700 | 0.2363 |
| | Context-Independent Path (Model A) | 5 | 67 | **0.1581** | **0.2067** | 0.1583 | 0.2014 | 0.1208 | 0.2357 | 0.0725 | 0.2367 |
| | Original OCCP (Model B) | 5 | 67 | **0.1581** | **0.2071** | 0.1583 | 0.2014 | 0.1222 | 0.2359 | 0.0728 | 0.2368 |
| | Continuous Score Fusion | 5 | 67 | **0.1582** | **0.2071** | 0.1583 | 0.2014 | 0.1229 | 0.2359 | 0.0728 | 0.2368 |
| | Enhanced OCCP | 5 | 67 | **0.1578** | **0.1966** | 0.1548 | 0.2012 | 0.1229 | 0.2359 | 0.0732 | 0.2368 |
| **Overall (All 3 Projects)** | **Canonical Structural Baseline** | **25** | **170** | **0.0865** | **0.1712** | **0.0841** | **0.0724** | **0.0849** | **0.0997** | **0.0793** | **0.1634** |
| | **Historical Co-Change (V4)** | **25** | **170** | **0.1188** | **0.2132** | **0.1306** | **0.0912** | **0.1253** | **0.1435** | **0.0963** | **0.2091** |
| | **Model A (Context-Free)** | **25** | **170** | **0.1218** | **0.2223** | **0.1372** | **0.1042** | **0.1231** | **0.1538** | **0.0981** | **0.2261** |
| | **Original OCCP (Model B)** | **25** | **170** | **0.1277** | **0.2418** | **0.1500** | **0.1101** | **0.1295** | **0.1588** | **0.0993** | **0.2283** |
| | **Continuous Score Fusion** | **25** | **170** | **0.1318** | **0.2366** | **0.1556** | **0.1147** | **0.1359** | **0.1652** | **0.0999** | **0.2118** |
| | **Enhanced OCCP** | **25** | **170** | **0.1306** | **0.2262** | **0.1532** | **0.1139** | **0.1292** | **0.1439** | **0.0996** | **0.2116** |

*Aggregation Convention:* Macro-average across independent commits ($K=25$), where each commit's score is the mean metric of its constituent leave-one-out cases.

---

## 5. Statistical Significance & Hypothesis Testing

Paired difference statistical tests were conducted across all $K=25$ independent commits:

### A. Comparisons Against Canonical Structural Baseline
- **Continuous Score Fusion vs. Structural Baseline:**  
  Mean Diff $= +0.0453$, $95\%\text{ CI } [-0.0113, +0.1020]$, $t(24) = 1.6461$, $p = 0.0997$, Wilcoxon $W = 18.0$, $p = 0.0995$.  
  *Outcome:* Positive trend (+52.4% relative gain), but **not statistically significant** at $\alpha = 0.05$.
- **Original OCCP vs. Structural Baseline:**  
  Mean Diff $= +0.0413$, $95\%\text{ CI } [-0.0109, +0.0934]$, $t(24) = 1.6300$, $p = 0.1031$, Wilcoxon $W = 16.0$, $p = 0.0712$.  
  *Outcome:* Not statistically significant at $\alpha = 0.05$.

### B. Comparisons Against Historical Co-Change Reranker (V4)
- **Continuous Score Fusion vs. Historical Reranker:**  
  Mean Diff $= +0.0130$, $95\%\text{ CI } [-0.0065, +0.0325]$, $t(24) = 1.3751$, $p = 0.1691$, Wilcoxon $W = 17.0$, $p = 0.2845$ (7 Wins, 15 Ties, 3 Losses).  
  *Outcome:* **No statistically significant improvement** over pure historical co-change.
- **Original OCCP vs. Historical Reranker:**  
  Mean Diff $= +0.0089$, $95\%\text{ CI } [-0.0181, +0.0359]$, $t(24) = 0.6813$, $p = 0.4957$, Wilcoxon $W = 26.0$, $p = 0.5337$ (7 Wins, 14 Ties, 4 Losses).  
  *Outcome:* **No statistically significant improvement**.

---

## 6. Diagnosis of OCCP Limitations

1. **Diff-Level Category Ambiguity:**  
   56.1% of evaluated components in PetClinic and 54.3% in Shopizer touched multiple syntactic elements simultaneously (e.g., adding an `@Entity` annotation while updating method bodies). This caused original OCCP to classify over half of all query inputs as `UNKNOWN_OR_MIXED`, blocking operation-conditioned path matching.
2. **Syntactic Sparsity of Exact Paths:**  
   Exact typed paths (e.g., `Controller -[USES]-> Service -[DEPENDS_ON]-> Repository`) only exist in layered enterprise architectures. In Shopizer, semantic co-changes link configurations, DTOs, and payment services across non-adjacent modules without direct call edges. In Commons Lang, utility classes have zero multi-hop paths, triggering a 100% fallback to historical co-change.
3. **Rigid Lexicographical Tiers:**  
   Original OCCP placed any single conditioned match ($1/1$) into Tier 1, strictly ahead of strong co-change evidence (20 co-changes) in Tier 3. While Continuous Multi-Channel Fusion solved this priority inversion bug, the underlying typed-path signal remains too sparse to statistically beat historical co-change.

---

## 7. EGCP Handoff: Prerequisites & Protocol for Next Phase

With the OCCP baseline officially verified and frozen, the transition to **Evolutionary-Graph Change Propagation (EGCP)** is scientifically justified:

### A. Frozen Baselines for EGCP Benchmarking
Every future EGCP experiment must be evaluated against these exact frozen metrics:
1. **Canonical Structural Baseline:** Macro MAP = **0.0865**, Macro MRR = **0.1712**
2. **Historical Co-Change Reranker (V4):** Macro MAP = **0.1188**, Macro MRR = **0.2132**
3. **Continuous Score Fusion (Strongest OCCP):** Macro MAP = **0.1318**, Macro MRR = **0.2366**

### B. Frozen Benchmark Test Universe
- **Target Repositories:** Spring PetClinic REST ($K=8$, $N=57$), Shopizer ($K=12$, $N=46$), Apache Commons Lang ($K=5$, $N=67$).
- **Total Commit Universe:** $K=25$ independent commits, $N=170$ leave-one-out cases.
- **Candidate Sets:** EGCP must score and rank the **exact same candidate sets $\mathcal{C}$** produced by 2-hop BFS on the pre-change graphs $G(c^1)$. It must neither expand nor contract $\mathcal{C}$.

### C. The Core Problem EGCP Must Solve
EGCP must replace discrete, exact syntactic path matching with **continuous latent graph embeddings** (e.g., Node2Vec, Graph Neural Networks, or multi-relational graph convolution over combined structural and evolutionary co-change edges). This allows knowledge of diffuse architectural dependencies to propagate even when explicit AST call paths are missing.

### D. Verification Requirements for EGCP
1. **Temporal Graph Construction:** EGCP graph embeddings must be trained strictly on graphs reconstructed at $c^1$ using commits strictly older than $c$.
2. **Zero Production Contamination:** EGCP must reside in its own isolated service directory (`backend/src/services/egcp/`) and must NOT be connected to the live `/api/analyse-impact` route.
3. **Paired Statistical Significance:** Any claim that EGCP outperforms V4 or Continuous Score Fusion must demonstrate a paired two-tailed $p$-value $< 0.05$ across the 25 frozen commits.

---

## 8. Final Baseline Status & Recommendation

- **Baseline Status:** **VERIFIED AND FROZEN.**
- **Production UI:** Retain Canonical Structural Baseline as default.
- **Research Baseline:** Retain Continuous Multi-Channel Score Fusion as the benchmark heuristic upper bound.
- **Next Step:** Safe to proceed to EGCP implementation.
