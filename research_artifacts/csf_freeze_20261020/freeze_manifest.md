# Official Freeze Manifest: Continuous Score Fusion (CSF) Baseline

**Freeze Date:** 2026-10-20  
**Project Location:** `C:\yashika\STUDY\clg_project\software_change`  
**Git Base Commit:** `2d233cf` (`chore: preserve pre-change implementation and research evaluation artifacts`)  
**Git Branch:** `main`  
**Target Freeze Directory:** `software_change/research_artifacts/csf_freeze_20261020/`

---

## 1. Frozen Baseline Identification

- **Model Name:** Continuous Score Fusion (CSF)
- **Model Type:** Multi-Channel Continuous Hybrid (OCCP Conditioned Paths + Generic Paths + Historical Co-Change + Structural Baseline Reciprocal Rank)
- **Implementation File:** [`backend/src/services/occp_experiments/occpFusionModel.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/occp_experiments/occpFusionModel.js)
- **Primary Function:** `rankModelB_OCCP_ContinuousFusion`
- **File SHA-256:** `29646EB9A03CB25193BD3B30F371C6AA8603A6C14EC81DD5BDB1C778A53679FC`

---

## 2. Frozen Configuration & Scoring Formula

```json
{
  "lambda": 0.5,
  "weights": {
    "w_cond": 0.35,
    "w_gen": 0.15,
    "w_hist": 0.35,
    "w_struct": 0.15
  }
}
```

**Scoring Formula:**
$$S(u) = 0.35 \cdot S_{\text{cond}}(u) + 0.15 \cdot S_{\text{gen}}(u) + 0.35 \cdot S_{\text{hist}}(u) + 0.15 \cdot S_{\text{struct}}(u)$$

Where:
- $S_{\text{cond}}(u) = \frac{\text{pos} + 0.5}{\text{tot} + 1.0}$ if $\text{pos} > 0$ else $0$ (Laplace-smoothed operation-conditioned path probability)
- $S_{\text{gen}}(u) = \frac{\text{pos} + 0.5}{\text{tot} + 1.0}$ if $\text{pos} > 0$ else $0$ (Laplace-smoothed generic path probability)
- $S_{\text{hist}}(u) = \frac{\text{coChange}(s, u)}{\max_{v \in \mathcal{C}} \text{coChange}(s, v)}$ if $\max > 0$ else $0$ (normalized co-change frequency)
- $S_{\text{struct}}(u) = \frac{1.0}{\text{structuralBaselineRank}(u)}$ (structural baseline reciprocal rank)

**Tie-Breaking Hierarchy:**
1. Highest composite score $S(u)$
2. Higher historical co-change score $S_{\text{hist}}(u)$
3. Shorter minimum graph hop distance $\text{minHop}(s, u)$
4. Better canonical structural baseline rank
5. Deterministic alphabetical component ID (`id.localeCompare`)

---

## 3. Reference Benchmark Metrics ($K=25$ Commits, $N=170$ Cases)

The reference performance against which all future research models (including EGCP) must be compared:

| Metric | Overall Pooled ($K=25, N=170$) | PetClinic REST ($K=8, N=57$) | Shopizer ($K=12, N=46$) | Commons Lang ($K=5, N=67$) |
| :--- | :---: | :---: | :---: | :---: |
| **Macro MAP** | **0.1318** | 0.1794 | 0.0891 | 0.1582 |
| **Macro MRR** | **0.2366** | 0.3143 | 0.1970 | 0.2071 |
| **Precision@3** | **0.1556** | 0.1753 | 0.1412 | 0.1583 |
| **Recall@3** | **0.1147** | 0.1263 | 0.0708 | 0.2014 |
| **F1-Score@3** | **0.1151** | 0.1468 | 0.0943 | 0.1772 |
| **Precision@5** | **0.1359** | 0.1800 | 0.1118 | 0.1229 |
| **Recall@5** | **0.1652** | 0.2325 | 0.0910 | 0.2359 |
| **F1-Score@5** | **0.1274** | 0.1674 | 0.0962 | 0.1381 |
| **Precision@10** | **0.0999** | 0.1711 | 0.0637 | 0.0728 |
| **Recall@10** | **0.2118** | 0.3614 | 0.1017 | 0.2368 |
| **F1-Score@10** | **0.1151** | 0.2322 | 0.0783 | 0.1114 |

---

## 4. Known Caveats & Statistical Reality

1. **Statistical Significance vs. Historical Baseline:**  
   Across $K=25$ independent commits, Continuous Score Fusion shows a mean MAP improvement of $+0.0130$ over the V4 Historical Co-Change Reranker, but the paired difference is **not statistically significant** ($t = 1.38, p = 0.1691$, Wilcoxon $p = 0.2845$).
2. **Path Sparsity:**  
   OCCP's typed-path signal exhibits severe sparsity on decoupled architectures (Shopizer) and utility libraries (Commons Lang). In over 78% of candidate decisions, CSF relies primarily on its historical co-change ($S_{\text{hist}}$) and structural ($S_{\text{struct}}$) channels.
3. **Production Isolation:**  
   CSF is strictly a research baseline. Production UI and API endpoints remain exclusively bound to the Canonical Structural Baseline (`impactEngine.js`).
