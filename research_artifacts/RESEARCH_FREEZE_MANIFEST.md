# Official Research Freeze Manifest: Evolutionary-Graph Change Propagation (EGCP)

**Date of Freeze:** October 21, 2026  
**Git HEAD Commit Hash:** `2d233cf6bc84c242d7d47b92cf6439e9523d5f3a`  
**Status:** **FROZEN — ALGORITHM WORK CONCLUDED**  
**Governance Directive:** No further modifications, parameter tuning, scoring alterations, or model retraining are permitted without explicit user approval. Future development transitions exclusively to frontend UI enhancements.

---

## 1. Frozen Research Models Catalog

The following research and baseline models are officially frozen and immutable:

| Model ID | Model Family | Implementation Entry Point | Description |
| :--- | :--- | :--- | :--- |
| `canonical_baseline` | Structural Baseline | `backend/src/services/impactEngine.js` | Deterministic BFS/DFS 2-hop syntactic dependency traversal with severity ordering. **Sole production model.** |
| `historical_reranker` | V4 Historical Reranker | `backend/src/services/structuralHistoryReranker.js` | Direct co-change frequency reranker applied on top of canonical structural candidate universe. |
| `occp_original` | OCCP Series | `backend/src/services/occp/occpModel.js` | Original Operation-Conditioned Change Propagation. |
| `csf_frozen` | Score Fusion Baseline | `backend/src/services/occp_experiments/occpFusionModel.js` | Continuous Score Fusion combining structural baseline, conditioned OCCP paths, and co-change weights. |
| `egcp_v1` | EGCP Series | `backend/src/services/egcp/egcpModel.js` | Dual-channel personalized PageRank ($\alpha$-blended AST and co-change adjacency). |
| `egcp_v2` | EGCP Series | `backend/src/services/egcp/v2/egcpV2Model.js` | Decoupled dual-channel Random Walk with Restart, in-degree discounting ($\gamma = 0.75$), and commit caching. |
| `egcp_v3` | EGCP Series | `backend/src/services/egcp/v3/egcpV3Model.js` | Adaptive Bayesian channel balancing ($\beta_{\text{adaptive}}$), operation-aware edge weights, and entity dampening. |
| `egcp_v4_base` | EGCP Series | `backend/src/services/egcp/v4/egcpV4Model.js` | Parity baseline matching EGCP v2/v3 base parameters ($\beta = 0.60, \gamma = 0.75$). |
| `egcp_v4_entropy_beta` | EGCP Series | `backend/src/services/egcp/v4/egcpV4Model.js` | Ablation A: Graph-entropy dynamic prior scaling ($\tau = \tau_{\text{base}} + \tau_{\text{scale}} \cdot H_{\text{norm}}$). |
| `egcp_v4_hub_excl` | EGCP Series | `backend/src/services/egcp/v4/egcpV4Model.js` | Ablation B: Progressive hub exclusion via sigmoidal transition attenuation on high in-degree sinks. |
| `egcp_v4_gated_op` | EGCP Series | `backend/src/services/egcp/v4/egcpV4Model.js` | Ablation C: Evidence-gated operation-aware edge weighting (active only on sparse co-change logic seeds). |
| `egcp_v4_entropy_hub` | EGCP Series | `backend/src/services/egcp/v4/egcpV4Model.js` | Combination of Ablations A and B. |
| **`egcp_v4_combined`** | **EGCP Series** | `backend/src/services/egcp/v4/egcpV4Model.js` | **Final Research Candidate:** Entropy-adaptive beta + hub exclusion + gated op-weights + entity dampening. |

---

## 2. Benchmark Deliverables & Evidence Archive

All evaluation data, test query predictions, and reports are permanently archived under `research_artifacts/`:

1. **EGCP v4 Benchmark Evaluation Report:**  
   [`research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_evaluation_report.md`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_evaluation_report.md)
2. **EGCP v4 Final Independent Validation Audit:**  
   [`research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_final_validation_audit_report.md`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_final_validation_audit_report.md)
3. **Commit-Level Macro Averaged Metrics CSV:**  
   [`research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_metrics_by_project.csv`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_metrics_by_project.csv)
4. **Case-Level Micro Averaged Metrics CSV:**  
   [`research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_metrics_micro.csv`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_metrics_micro.csv)
5. **Ablation Comparison CSV:**  
   [`research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_ablation_comparison.csv`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_ablation_comparison.csv)
6. **Full Raw Case Predictions & Oracles JSON:**  
   [`research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_results.json`](file:///c:/yashika/STUDY/clg_project/software_change/research_artifacts/egcp_v4_evaluation_20261021/egcp_v4_results.json)

---

## 3. Audited Performance & Governance Baseline

- **Overall Macro MAP ($K = 25$ commits):**
  - Canonical Baseline: `0.0865`
  - Frozen CSF Baseline: `0.1278`
  - EGCP v2 Main: `0.1312`
  - EGCP v3 Combined: `0.1539`
  - **EGCP v4 Combined:** **`0.1642`** (+28.5% over CSF, +25.2% over v2)
- **Held-Out Test Generalization ($K = 10$ commits):**
  - Canonical Baseline: `0.0279`
  - Frozen CSF Baseline: `0.0315`
  - EGCP v2 Main: `0.0920`
  - EGCP v3 Combined: `0.0791`
  - **EGCP v4 Combined:** **`0.0992`** (+215% over CSF)
- **Cluster-Aware Statistical Audit:**
  - vs. EGCP v2 Main: $t = 2.017, \mathbf{p = 0.0433}$ (**statistically significant**).
  - vs. Frozen CSF Baseline: $t = 1.615, \mathbf{p = 0.1062}$, 95% Cluster Bootstrap CI: $[-\mathbf{0.0011}, +\mathbf{0.0850}]$ (**strong positive trend, not formally significant at $\alpha = 0.05$** due to $K = 25$ sample size).

---

## 4. Production Isolation & Governance Rules

1. **Production Invariant:**
   - The production endpoint (`POST /api/analyse-impact`) and `backend/src/services/impactEngine.js` must **not** be modified to use EGCP v4 or any experimental model.
   - Production must strictly maintain the deterministic Canonical Structural Baseline API contract.
2. **Frontend UI Invariant:**
   - All subsequent work must focus on UI presentation, user experience, visualizations, and comparative exploration.
   - The UI must continue to communicate with the existing backend contract unless a backend change is explicitly requested and approved by the user.
3. **No Algorithm Changes:**
   - Any modification to model logic, scoring formulas, propagation engines, transition matrices, hyperparameters, or evaluation datasets requires explicit prior authorization.
