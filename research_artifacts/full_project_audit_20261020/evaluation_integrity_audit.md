# Evaluation Integrity & Methodology Audit

**Project:** Context-Aware Software Change Impact Analysis Framework  
**Location:** `C:\yashika\STUDY\clg_project\software_change`  
**Date:** 2026-10-20  
**Audit Directory:** `software_change/research_artifacts/full_project_audit_20261020/`  

---

## 1. Methodological Hygiene & Leakage Audit

The retrospective evaluation protocol implemented across `backend/src/evaluation/` was audited for temporal integrity, data leakage, and metric correctness:

### 1.1 Pre-Change Graph Reconstruction ($c^1$)
- **Requirement:** Structural knowledge graphs must represent the exact codebase state *prior* to the evaluated commit $c$.
- **Verification:** [`historicalGraphService.js`](file:///C:/yashika/STUDY/clg_project/software_change/backend/src/services/historicalGraphService.js) checks out an isolated temporary worktree at the commit's first parent revision ($c^1$). Components, methods, and relationships introduced in commit $c$ are physically absent from the AST graph.
- **Exclusion of Root Commits:** Commits lacking parent revisions trigger exclusion code `E9_ROOT_COMMIT` and are never evaluated against the current HEAD graph.

### 1.2 Chronological Historical Training ($j < c$)
- **Requirement:** Historical co-change counts and typed path propagation statistics must strictly use commits older than target commit $c$.
- **Verification:**
  - In `historicalCaseBuilder.js`: `historicalCommits = allCommits.slice(testIndex + 1)`.
  - In `occpEvalHarness.js`: `trainingEpisodes = historicalEpisodes.filter(ep => ep.commitIndex > commitIndex)`.
  - Verified by unit test in `historicalGraphTests.js`: Commits at index $\le$ target commit index are strictly blocked from contributing co-change counts or path statistics.

### 1.3 Target Label Holdout
- **Requirement:** Ground-truth targets ($C \setminus \{s\}$) must be held out until candidate generation and scoring are completely frozen.
- **Verification:** The scoring algorithms (`rankModelB_OCCP`, `rerankCandidatesWithHistory`, `analyzeImpactInMemory`) receive only the seed ID and pre-change graph. Oracle target sets are only accessed during the downstream metric evaluation step (`precisionAtK`, `computeAP`, `computeRR`).

### 1.4 Candidate Universe Consistency
- **Requirement:** All compared models must rank the identical candidate universe.
- **Verification:** Evaluated models receive the exact output array from `generateStructuralCandidatesInMemory`. Zero candidates are filtered, dropped, or substituted.

---

## 2. Cross-Repository Empirical Evaluation Results

The verified evaluation metrics across all four target repositories are compiled below:

| Dimension / Metric | Spring PetClinic REST | Shopizer | Apache Commons Lang | Apache Maven |
| :--- | :---: | :---: | :---: | :---: |
| **System Category** | Microservice REST API | E-Commerce Enterprise Web App | Static Utility Library | CLI Build Tool / Compiler |
| **Total Source Files** | 104 Java files | 1,388 Java files | 628 Java files | 3,280 Java files |
| **AST Parse Time** | 1.1s | 18.4s | 54.7s | 387.9s (6.5 min) |
| **Inspected Commit Window** | 100 commits | 54 commits | 100 commits | 100 commits |
| **Eligible Commits ($K$)** | **8 commits** | **12 commits** | **4 commits** | **0 commits (Halted)** |
| **Leave-One-Out Cases ($N$)** | **57 cases** | **46 cases** | **11 cases** | **0 cases (Halted)** |
| **Structural Baseline MAP** | **0.1758** | **0.0432** | **0.0592** | N/A (Blocked) |
| **Historical Reranker (V4) MAP** | 0.1651 (-6.09%) | **0.0897 (+107.64%)** | **0.1512 (+155.3%)** | N/A (Blocked) |
| **Model A (Context-Free) MAP** | 0.1685 (-4.15%) | 0.0573 (+32.64%) | 0.0592 (0.0%) | N/A (Blocked) |
| **OCCP (Model B) MAP** | **0.1864 (+6.03%)** | 0.0759 (+75.69%) | **0.1512 (+155.3%)** | N/A (Blocked) |
| **RRF Fusion MAP** | 0.1772 (+0.80%) | 0.0821 (+90.05%) | 0.1480 (+150.0%) | N/A (Blocked) |
| **OCCP vs. Historical Reranker** | **OCCP +12.9%** | **Hist Reranker +18.2%** | **Exact Tie (0.0% diff)** | N/A (Blocked) |

---

## 3. Fallback Tier Accounting

OCCP's actual decision paths vary drastically depending on software architecture:

```
Spring PetClinic REST (Total Decisions: 1,031)
  ├── Tier 1 (Operation-Conditioned): 356 (34.5%)
  ├── Tier 2 (Generic Typed Path):      0  (0.0%)
  ├── Tier 3 (Historical Co-Change):    2  (0.2%)
  └── Tier 4 (Structural Baseline):   673 (65.3%)

Shopizer (Total Decisions: 2,081)
  ├── Tier 1 (Operation-Conditioned):  272 (13.1%)
  ├── Tier 2 (Generic Typed Path):      34  (1.6%)
  ├── Tier 3 (Historical Co-Change): 1,775 (85.3%)
  └── Tier 4 (Structural Baseline):      0  (0.0%)

Apache Commons Lang (Total Decisions: 201)
  ├── Tier 1 (Operation-Conditioned):   0  (0.0%)
  ├── Tier 2 (Generic Typed Path):      0  (0.0%)
  ├── Tier 3 (Historical Co-Change):   81 (40.3%)
  └── Tier 4 (Structural Baseline):   120 (59.7%)
```

### Critical Architectural Conclusions from Fallback Accounting:
1. **Layered Microservices (PetClinic):** High Tier 1 activity (34.5%) because edits follow well-defined `Controller -> Service -> Repository` paths.
2. **Monolithic Systems with Rich History (Shopizer):** Dominant Tier 3 activity (85.3%) because hundreds of historical commits provide dense co-change evidence, eclipsing sparse 2-hop paths.
3. **Decoupled Utility Libraries (Commons Lang):** Zero Tier 1 activity (0.0%) because static utility classes lack call chains, triggering 100% fallback to co-change and baseline structural ranks.

---

## 4. Statistical Rigor & Sample Size Limitations

### 4.1 Unit of Analysis: Commits vs. Cases
In previous informal discussions, sample sizes were sometimes cited as $N = 103$ or $N = 114$.  
**Methodological Correction:**
- The true statistical unit of independent observation is the **commit ($K$)**, not the Leave-One-Out case ($N$).
- Multiple LOO cases generated from the same multi-component commit share the exact same pre-change graph, the same historical training episodes, and identical change dynamics. They are non-independent clustered observations.
- True independent sample sizes:
  - Spring PetClinic: **$K = 8$ independent commits**
  - Shopizer: **$K = 12$ independent commits**
  - Commons Lang: **$K = 4$ independent commits**
  - Total across all repositories: **$K = 24$ independent commits**

### 4.2 Statistical Significance Analysis (Wilcoxon Signed-Rank Test)
- **PetClinic ($K=8$):** OCCP MAP vs. V4 Historical Reranker MAP yields $p = 0.461$. The difference is **statistically insignificant** at $\alpha = 0.05$.
- **Shopizer ($K=12$):** V4 Historical Reranker beats OCCP on 9 out of 12 commits ($p = 0.078$). The advantage of V4 over OCCP approaches marginal significance, driven by dense co-change evidence.
- **Commons Lang ($K=4$):** OCCP and V4 produce identical rankings across all 4 commits ($p = 1.000$).
- **Overall Verdict:** Across all evaluated repositories, **OCCP has not demonstrated statistically significant superiority over the simple Historical Co-Change Reranker (V4)**.
