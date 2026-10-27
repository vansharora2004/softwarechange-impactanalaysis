# Research Baseline Freeze Manifest

**Freeze Date:** 2026-10-20  
**Repository:** `C:\yashika\STUDY\clg_project\software_change`  
**Git Base Commit:** `2d233cf` (`chore: preserve pre-change implementation and research evaluation artifacts`)  
**Git Branch:** `main`

---

## 1. Frozen Baseline Models & Code Implementations

The following model implementations are officially frozen as the benchmark reference suite for all subsequent research (including EGCP comparisons):

| Model Name | Source Code Location | Role / Status |
| :--- | :--- | :--- |
| **Canonical Structural Baseline** | [`backend/src/services/impactEngine.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/impactEngine.js) & [`structuralHistoryReranker.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/structuralHistoryReranker.js) | **Production UI Default**. BFS 2-hop structural traversal with edge-weight decay and degree centrality tie-breaking. |
| **Historical Co-Change Reranker (V4)** | [`backend/src/services/structuralHistoryReranker.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/structuralHistoryReranker.js#L80-L160) | **Historical Co-Change Baseline**. Re-ranks candidates by normalized co-change frequency: $S(u) = \frac{\text{coChange}(s, u)}{\max_{v} \text{coChange}(s, v)}$. |
| **Context-Independent Typed Path (Model A)** | [`backend/src/services/occp/occpModel.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/occp/occpModel.js#L80-L140) | **Context-Free Typed Path Baseline**. Generic MLE path probability $P(\text{impact} \mid \text{path})$. |
| **Original OCCP (Model B)** | [`backend/src/services/occp/occpModel.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/occp/occpModel.js#L141-L220) | **Original OCCP Baseline**. Lexicographic 4-tier unregularized MLE model. |
| **Continuous Score Fusion** | [`backend/src/services/occp_experiments/occpFusionModel.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/occp_experiments/occpFusionModel.js) | **Strongest Empirical Heuristic OCCP Variant**. Formula: $S(u) = 0.35 S_{\text{cond}}(u) + 0.15 S_{\text{gen}}(u) + 0.35 S_{\text{hist}}(u) + 0.15 S_{\text{struct}}(u)$ with Laplace smoothing ($\lambda = 0.5$). |
| **Enhanced OCCP** | [`backend/src/services/occp_experiments/occpEnhancedModel.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/occp_experiments/occpEnhancedModel.js) | **Selected OCCP Variant**. Adds dominant operation resolution ($\ge 70\%$) and support shrinkage weighting $\frac{\text{tot}}{\text{tot} + 2}$. |

---

## 2. Frozen Datasets & Evaluation Universe

| Project Name | Repository Path | Frozen Commit Count ($K$) | Frozen LOO Cases ($N$) | Evaluation Protocol |
| :--- | :--- | :---: | :---: | :--- |
| **Spring PetClinic REST** | `c:/yashika/STUDY/clg_project/spring-petclinic-rest` | **8** | **57** | Strict Leave-One-Out ($j < c$, $G(c^1)$) |
| **Shopizer** | `c:/yashika/STUDY/clg_project/shopizer` | **12** | **46** | Strict Leave-One-Out ($j < c$, $G(c^1)$) |
| **Apache Commons Lang** | `c:/yashika/STUDY/clg_project/commons-lang` | **5** | **67** | Strict Leave-One-Out ($j < c$, $G(c^1)$) |
| **Overall Pooled Benchmark** | All 3 Repositories | **25** | **170** | Macro-average across independent commits ($K=25$) |

*Sensitivity Dataset (Commons Lang 4-commit subset excluding bulk Javadoc commit `ed31115`):*  
- $K=4$ commits, $N=11$ cases (Overall pooled: $K=24$, $N=114$).

---

## 3. Frozen Benchmark Metric Baselines (Overall $K=25$, $N=170$)

All future model evaluations (including EGCP) must be compared against these verified baseline figures:

| Model | Macro MAP | Macro MRR | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Canonical Structural Baseline** | **0.0865** | **0.1712** | 0.0841 | 0.0724 | 0.0849 | 0.0997 | 0.0793 | 0.1634 |
| **Historical Co-Change Reranker (V4)** | **0.1188** | **0.2132** | 0.1306 | 0.0912 | 0.1253 | 0.1435 | 0.0963 | 0.2091 |
| **Context-Independent Typed Path (Model A)** | **0.1218** | **0.2223** | 0.1372 | 0.1042 | 0.1231 | 0.1538 | 0.0981 | 0.2261 |
| **Original OCCP (Model B)** | **0.1277** | **0.2418** | 0.1500 | 0.1101 | 0.1295 | 0.1588 | 0.0993 | 0.2283 |
| **Continuous Score Fusion** | **0.1318** | **0.2366** | **0.1556** | **0.1147** | **0.1359** | **0.1652** | **0.0999** | **0.2118** |
| **Enhanced OCCP** | **0.1306** | **0.2262** | 0.1532 | 0.1139 | 0.1292 | 0.1439 | 0.0996 | 0.2116 |

---

## 4. Frozen Artifact Files & Locations

All verified records, logs, and artifacts are preserved in:
`C:\yashika\STUDY\clg_project\software_change\research_artifacts\occp_final_verification_20261020\`

1. `final_verification_report.md`
2. `verified_metrics_by_project.csv`
3. `verified_per_commit_metrics.csv`
4. `verified_results.json`
5. `dataset_eligibility_audit.csv`
6. `leakage_audit.md`
7. `reproduction_commands.md`
8. `freeze_manifest.md`

---

## 5. Frozen Production Constraints

1. The live user interface ([`frontend/src/App.jsx`](file:///c:/yashika/STUDY/clg_project/software_change/frontend/src/App.jsx)) and backend API route ([`backend/src/routes/api.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/routes/api.js)) MUST continue to invoke the **Canonical Structural Baseline** (`impactEngine.js`).
2. Experimental models (OCCP, V4, Continuous Fusion, EGCP) are strictly evaluation modules and must never be bound to the primary production route without explicit architectural review.
