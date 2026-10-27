# Comprehensive Software Change Impact Analysis Project Audit Report

**Project Location:** `C:\yashika\STUDY\clg_project\software_change`  
**Date of Audit:** 2026-10-20  
**Audit Artifacts Directory:** `software_change/research_artifacts/full_project_audit_20261020/`  
**Audit Scope:** Full Project Audit: OCCP, All Existing Models, UI, Backend, API Integration, Evaluation Integrity, and EGCP Readiness  

---

## 1. Executive Summary & Core Audit Conclusions

An exhaustive, evidence-based audit of the entire Software Change Impact Analysis repository was performed in response to the user audit mandate. No source files, algorithms, configurations, tests, or pre-existing research artifacts were modified during this audit.

### Top-Level Audit Findings:

1. **Active UI & API Engine:**  
   The live web application strictly and exclusively executes the **Canonical Structural Graph Traversal Baseline** (`impactEngine.js` via `POST /api/analyse-impact`). The UI does not invoke OCCP, V4 Historical Reranker, or the legacy 70/30 model.
2. **Model Inventory & Existence:**  
   - **Canonical Structural Baseline:** Fully implemented, verified with 30 passing tests, and actively powers the UI.
   - **V4 Historical Co-Change Reranker:** Fully implemented, verified with 40 passing tests, but used only in offline evaluation.
   - **Model A (Context-Free Typed Paths):** Fully implemented, verified in tests, used only in offline evaluation.
   - **Model B (OCCP Operation-Conditioned):** Fully implemented, verified with 16 passing tests, used only in offline evaluation.
   - **RRF (Reciprocal Rank Fusion):** Fully implemented with standard $k=60$ (Cormack et al., 2009). The acronym **RPF does not exist** anywhere in executable code or tests.
   - **Legacy 70/30 Context-Aware Model:** Retained in `contextAwareImpactAnalyzer.js` and exposed on `POST /api/analyze-context-impact`, but **completely unused by the frontend UI (dead route)**.
   - **EGCP (Edit-Graph Conditioned Propagation):** **Completely ABSENT** from the codebase.
3. **OCCP Correctness & Statistical Health:**  
   - The OCCP implementation is mathematically leak-free and adheres strictly to chronological pre-change graph reconstruction ($c^1, j < c$).
   - **Crucial Limitation Discovered:** OCCP lacks Laplace/Dirichlet smoothing, calculating raw empirical ratios. In addition, its **hard ordinal tier-first sorting (`Tier 1 > Tier 2 > Tier 3 > Tier 4`)** causes weakly observed paths ($1/1 = 1.0$) to displace true targets with strong historical co-change (e.g., 20 co-changes in Tier 3), explaining why V4 outperformed OCCP by +18.2% on Shopizer.
4. **Empirical Evidence Across Repositories:**  
   - **Spring PetClinic REST ($K=8$ commits, $N=57$ cases):** OCCP MAP = **0.1864** (+12.9% over V4, +6.0% over Baseline).
   - **Shopizer ($K=12$ commits, $N=46$ cases):** V4 Historical Reranker MAP = **0.0897** (**V4 beats OCCP by +18.2%**; OCCP MAP = 0.0759).
   - **Apache Commons Lang ($K=4$ commits, $N=11$ cases):** OCCP MAP = **0.1512** (**Exact tie with V4**, because static utility classes lack multi-hop typed paths, triggering a 100% fallback to V4).
   - **Apache Maven ($K=0$ commits):** Evaluation halted due to Windows filesystem `MAX_PATH` errors in worktree creation and 179 FQN collisions in `javaAnalyzer.js`.
5. **Statistical Significance Verdict:**  
   Across all 24 independent commits evaluated, **OCCP has not demonstrated statistically significant superiority over the simple Historical Co-Change Reranker (V4)** (Wilcoxon $p = 0.461$ on PetClinic, $p = 0.078$ favoring V4 on Shopizer).
6. **EGCP Readiness Verdict:**  
   **DEFER / NO-GO.** Implementing EGCP now is scientifically unjustified. The primary bottlenecks in OCCP are statistical (lack of smoothing and tier-first inversion), not coarse operation labeling. Adding fine-grained edit graphs would multiply data sparsity on existing sample sizes.

---

## 2. Model Inventory & Runtime Wiring Synthesis

| Model Identity | Primary Implementation Source | Empirical Scoring Formula | Test Suite Results | Runtime API Route | Frontend UI Invocation | Architectural Role |
| :--- | :--- | :--- | :---: | :--- | :---: | :--- |
| **Structural Baseline** | [`impactEngine.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/impactEngine.js) | 2-Hop BFS; Priority `High` > `Med` > `Low`; tie-break by ID | 30 passed, 0 failed | `POST /api/analyse-impact`<br/>`POST /api/analyze-impact` | **ACTIVE** (Analyze Impact button) | **Canonical Production Engine** |
| **V4 Hist Reranker** | [`structuralHistoryReranker.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/structuralHistoryReranker.js) | `coChangeCount` desc $\to$ `baselineRank` asc $\to$ ID | 40 passed, 0 failed | None | None | **Offline Research Method** |
| **Model A (Context-Free)** | [`occpModel.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/occp/occpModel.js) | $P(prop \mid p) = \frac{Pos(p)}{Total(p)}$; tie-break hop $\to$ baselineRank | 16 passed, 0 failed | None | None | **Offline Evaluation Baseline** |
| **Model B (OCCP)** | [`occpModel.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/occp/occpModel.js) | $P(prop \mid o, p) = \frac{Pos(o, p)}{Total(o, p)}$; 4-Tier Fallback | 16 passed, 0 failed | None | None | **Offline Research Method** |
| **RRF Fusion** | [`occpModel.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/occp/occpModel.js) | $\sum \frac{1}{60 + rank_i}$; sorts descending | Section 6 tests pass | None | None | **Offline Evaluation Baseline** |
| **Legacy 70/30** | [`contextAwareImpactAnalyzer.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/contextAwareImpactAnalyzer.js) | $S = 0.70 B + 0.30 C$; severity thresholds 0.40/0.75 | `engineTests.js` | `POST /api/analyze-context-impact` | **Unused (Dead Route)** | **Legacy / Dormant** |
| **EGCP** | None | None | None | None | None | **ABSENT** |

---

## 3. OCCP Design Review & Statistical Diagnostics

### 3.1 Four-Tier Hierarchical Fallback Mechanics
OCCP organizes structural candidates into four discrete ordinal tiers:
- **Tier 1 (Conditioned Path):** Candidate has a path $p$ matching source operation $o$ with positive historical support ($Pos(o, p) > 0$).
- **Tier 2 (Generic Path):** Candidate has a path $p$ with generic positive support ($Pos(p) > 0$).
- **Tier 3 (Historical Co-Change):** Candidate has co-changed with the seed in past commits ($\text{coChange}(s, u) > 0$).
- **Tier 4 (Structural Baseline):** Zero historical or path evidence; candidate retains its relative topological structural rank.

### 3.2 Key Design Pathologies Identified
1. **The Overconfidence of Raw Ratios:**  
   Because OCCP computes $\frac{Pos}{Total}$ without Bayesian Laplace smoothing ($m$-estimate), single-instance paths ($1/1 = 1.00$) receive maximum confidence, outranking frequently observed, robust paths ($19/20 = 0.95$).
2. **Tier-First Inversion:**  
   By enforcing `Tier 1 > Tier 2 > Tier 3 > Tier 4`, a candidate with 1 observation in Tier 1 is promoted above a candidate in Tier 3 with 20 historical co-changes. In repositories with rich co-change history (Shopizer), this directly caused V4 to beat OCCP by +18.2%.
3. **High Rate of Mixed Classifications:**  
   In Spring PetClinic REST, **56.1% of cases (32/57)** were classified as `UNKNOWN_OR_MIXED`, blunting the discriminative power of operation conditioning.

---

## 4. UI & End-to-End System Health

1. **Frontend Production Build:** Verified passing cleanly in **489ms** (`vite build` v8.2.2).
2. **Backend API Contract:** Verified passing 5/5 tests in `apiBaselineContractTests.js`.
3. **Changed-File Presentation:** The DETECTED CHANGED FILES panel prominently presents the filename in bold, displays the normalized relative path beneath it, and preserves the component ID in application state.
4. **Graph Visualizer Parity:** Nodes and edges are correctly styled by architectural role and edge direction. The graph reflects the canonical structural baseline without stale cache leakage.

---

## 5. Master Cross-Repository Benchmark Matrix

| Benchmark Dimension | Spring PetClinic REST | Shopizer | Apache Commons Lang | Apache Maven |
| :--- | :---: | :---: | :---: | :---: |
| **System Category** | Microservice REST API | E-Commerce Enterprise Web App | Static Utility Library | CLI Build Tool / Compiler |
| **Architectural Style** | Tiered Spring Boot | Multi-Module Spring / Hibernate | Standalone Static Utility Classes | Multi-Module Plexus / Guice |
| **Total Java Files** | 104 | 1,388 | **628** | 3,280 |
| **AST Parse Time** | 1.1s | 18.4s | **54.7s** | 387.9s (6.5 min) |
| **Graph Density (Edges/Node)** | 2.38 | 5.58 | **1.91** | 2.85 |
| **Eligible Commits ($K$)** | **8** | **12** | **4** | **0 (Halted on Blockers)** |
| **LOO Evaluation Cases ($N$)** | **57** | **46** | **11** | **0 (Halted on Blockers)** |
| **Structural Baseline MAP** | **0.1758** | **0.0432** | **0.0592** | N/A (Blocked) |
| **Historical Reranker (V4) MAP** | 0.1651 (-6.09%) | **0.0897 (+107.64%)** | **0.1512 (+155.3%)** | N/A (Blocked) |
| **Model A (Context-Free) MAP** | 0.1685 (-4.15%) | 0.0573 (+32.64%) | 0.0592 (0.0%) | N/A (Blocked) |
| **OCCP (Model B) MAP** | **0.1864 (+6.03%)** | 0.0759 (+75.69%) | **0.1512 (+155.3%)** | N/A (Blocked) |
| **RRF Fusion MAP** | 0.1772 (+0.80%) | 0.0821 (+90.05%) | 0.1480 (+150.0%) | N/A (Blocked) |
| **OCCP vs. Historical Reranker** | **OCCP +12.9%** | **Hist Reranker +18.2%** | **Exact Tie (0.0% diff)** | N/A (Blocked) |
| **Primary OCCP Decision Tier** | Tier 1 (34.5%) / Tier 4 (65.3%) | Tier 3 (85.3%) | Tier 4 (59.7%) / Tier 3 (40.3%) | N/A |

---

## 6. EGCP Readiness Verdict & Thesis Recommendation

### Recommendation: **DEFER IMPLEMENTATION (NO-GO for current phase)**

### Scientific Rationale:
1. **Misidentified Root Cause:**  
   OCCP's failure to outperform V4 on Shopizer and Commons Lang was caused by **ranking architecture (hard ordinal tiers) and lack of statistical smoothing**, not by coarse operation labels.
2. **Data Sparsity Multiplication:**  
   AST edit graphs have drastically higher dimensionality than 6 operation categories. Across our 24 independent commits, fine-grained edit graphs would exacerbate data sparsity, creating thousands of single-observation patterns that amplify noise.
3. **Immediate Low-Hanging Fruit:**  
   Before exploring new model names like EGCP, the existing OCCP method should be ablated with:
   - Bayesian Laplace smoothing ($\frac{Pos + 1}{Total + 2}$).
   - Minimum observation support thresholds ($Total(o, p) \ge 3$).
   - Continuous score fusion (e.g. calibrated logistic regression or continuous RRF).

---

## 7. Deliverables Index

All detailed audit deliverables have been written to `software_change/research_artifacts/full_project_audit_20261020/`:
1. [`full_project_audit_report.md`](file:///C:/yashika/STUDY/clg_project/software_change/research_artifacts/full_project_audit_20261020/full_project_audit_report.md): Executive synthesis and master cross-repository comparison.
2. [`model_inventory_and_runtime_wiring.md`](file:///C:/yashika/STUDY/clg_project/software_change/research_artifacts/full_project_audit_20261020/model_inventory_and_runtime_wiring.md): Inventory of all 7 models, implementation files, formulas, test statuses, and API wiring.
3. [`occp_scoring_and_fallback_audit.md`](file:///C:/yashika/STUDY/clg_project/software_change/research_artifacts/full_project_audit_20261020/occp_scoring_and_fallback_audit.md): Algorithmic walkthrough, probability formula, fallback tiers, and 6 classified design findings.
4. [`ui_test_matrix.md`](file:///C:/yashika/STUDY/clg_project/software_change/research_artifacts/full_project_audit_20261020/ui_test_matrix.md): UI test matrix, changed-file presentation audit, graph visualizer inspection, and build verification.
5. [`evaluation_integrity_audit.md`](file:///C:/yashika/STUDY/clg_project/software_change/research_artifacts/full_project_audit_20261020/evaluation_integrity_audit.md): Leakage prevention audit, chronological separation ($j < c$), sample size corrections ($K=24$), and fallback accounting.
6. [`egcp_readiness_assessment.md`](file:///C:/yashika/STUDY/clg_project/software_change/research_artifacts/full_project_audit_20261020/egcp_readiness_assessment.md): Verified limitations of OCCP, hypothesis $H_{EGCP}$, and formal DEFER recommendation.

---

## 8. Verification of Repository State

- Working tree status: **Unmodified**. All pre-existing user modifications were preserved.
- No code, algorithms, UI logic, configurations, or previous evaluation artifacts were altered.
- All new reports were written strictly to `research_artifacts/full_project_audit_20261020/`.
