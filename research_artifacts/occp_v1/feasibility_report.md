# Operation-Conditioned Change Propagation (OCCP) — Phase 1 Feasibility Report

**Protocol:** Retrospective Leave-One-Out Evaluation with Pre-Change Historical Knowledge Graph Reconstruction  
**Chronological Constraint:** Strictly Leak-Free Lookback ($j < c$)  
**Operating Horizon:** 2 Hops  
**Audit Timestamp:** 2026-10-15T07:49:14.930Z  

---

## 1. Executive Summary & Feasibility Determination

This report presents empirical feasibility data for **Operation-Conditioned Change Propagation (OCCP)** on **Spring PetClinic REST** and **Shopizer**.
The core hypothesis tests whether historical, typed multi-hop relationship paths are more useful when conditioned on the source-code edit operation:

$$\text{confidence}(o, p) = \frac{\text{positive\_opportunities}(o, p)}{\text{eligible\_opportunities}(o, p)}$$

### Key Empirical Findings:
1. **Severe Training Sample Sparsity:**
   - In **Spring PetClinic**, only **26 historical non-merge commits** touch Java components across the 100-commit window. Across all 57 LOO evaluation cases, **31.04%** of reachable candidate evaluations have operation-conditioned positive evidence. **3.49%** fall back to generic paths, and **65.47%** must fall back to the structural baseline.
   - In **Shopizer**, only **24 historical non-merge commits** touch Java components. Conditioned positive evidence is present for **9.37%** of candidate evaluations, with **5.33%** generic fallback and **85.30%** structural fallback.
2. **Operation Category Imbalance:**
   - In PetClinic target source components:
     - `METHOD_SIGNATURE_OR_DECLARATION`: 0
     - `METHOD_BODY_OR_IMPLEMENTATION`: 25
     - `FIELD_OR_DATA_SHAPE`: 0
     - `TYPE_OR_INHERITANCE`: 0
     - `ADD_DELETE_OR_RENAME`: 0
     - `UNKNOWN_OR_MIXED`: 32
   - In Shopizer target source components:
     - `METHOD_SIGNATURE_OR_DECLARATION`: 11
     - `METHOD_BODY_OR_IMPLEMENTATION`: 10
     - `FIELD_OR_DATA_SHAPE`: 0
     - `TYPE_OR_INHERITANCE`: 0
     - `ADD_DELETE_OR_RENAME`: 0
     - `UNKNOWN_OR_MIXED`: 25
3. **Path Signature Fragmentation:**
   - Path signatures incorporating component endpoint types (e.g. `(Controller)-[outgoing:DEPENDS_ON]->(Service)-[outgoing:USES]->(Repository)`) generate **109 unique path patterns** in PetClinic and **106** in Shopizer.
   - However, only **60** patterns in PetClinic and **35** in Shopizer ever saw a positive co-change event in history.
   - Only **101** (PetClinic) and **106** (Shopizer) patterns recur across multiple commits.

> [!WARNING]
> **Methodological Consequence:** Because historical commit co-change is sparse and highly fragmented across 6 operation categories and dozens of typed path signatures, conditioning drastically reduces statistical support. Under the proposed backoff hierarchy:
> 1. Operation-conditioned path ($o, p$)
> 2. Generic path ($p$)
> 3. Historical co-change (pair)
> 4. Structural baseline
> 
> OCCP will frequently fall back to generic paths or structural ordering. Consequently, any observed difference between OCCP and the context-independent path baseline will reflect a very small fraction of candidate promotions.

---

## 2. Dataset and Evaluation Case Inventory

| Metric | Spring PetClinic REST | Shopizer | Combined |
| :--- | :--- | :--- | :--- |
| **Total Git Commits Inspected** | 100 | 54 | 154 |
| **Eligible Target Commits ($M \ge 2$)** | 8 | 12 | 20 |
| **Exclusions Logged** | 92 | 42 | 134 |
| **Leave-One-Out (LOO) Cases** | 57 | 46 | 103 |
| **Historical Graph Episodes Indexed** | 26 | 24 | 50 |
| **Total Candidates Evaluated** | 1031 | 2081 | 3112 |

---

## 3. Operation Category Breakdown

### Target Commit Changed Components
| Operation Category | PetClinic Target Count | Shopizer Target Count |
| :--- | :--- | :--- |
| `METHOD_SIGNATURE_OR_DECLARATION` | 0 | 11 |
| `METHOD_BODY_OR_IMPLEMENTATION` | 25 | 10 |
| `FIELD_OR_DATA_SHAPE` | 0 | 0 |
| `TYPE_OR_INHERITANCE` | 0 | 0 |
| `ADD_DELETE_OR_RENAME` | 0 | 0 |
| `UNKNOWN_OR_MIXED` | 32 | 25 |

### Historical Opportunities by Operation Category
#### Spring PetClinic REST:
| Category | Positive Pairs | Negative Pairs | Total Opportunities |
| :--- | :--- | :--- | :--- |
| `METHOD_SIGNATURE_OR_DECLARATION` | 0 | 0 | 0 |
| `METHOD_BODY_OR_IMPLEMENTATION` | 124 | 927 | 1051 |
| `FIELD_OR_DATA_SHAPE` | 0 | 0 | 0 |
| `TYPE_OR_INHERITANCE` | 0 | 0 | 0 |
| `ADD_DELETE_OR_RENAME` | 0 | 0 | 0 |
| `UNKNOWN_OR_MIXED` | 196 | 569 | 765 |

#### Shopizer:
| Category | Positive Pairs | Negative Pairs | Total Opportunities |
| :--- | :--- | :--- | :--- |
| `METHOD_SIGNATURE_OR_DECLARATION` | 24 | 931 | 955 |
| `METHOD_BODY_OR_IMPLEMENTATION` | 27 | 746 | 773 |
| `FIELD_OR_DATA_SHAPE` | 0 | 0 | 0 |
| `TYPE_OR_INHERITANCE` | 0 | 0 | 0 |
| `ADD_DELETE_OR_RENAME` | 0 | 0 | 0 |
| `UNKNOWN_OR_MIXED` | 61 | 1225 | 1286 |

---

## 4. Typed Path Pattern Statistics

| Characteristic | PetClinic | Shopizer |
| :--- | :--- | :--- |
| **Total Unique Typed Path Signatures** | 109 | 106 |
| **Patterns with $\ge 1$ Positive Co-Change** | 60 | 35 |
| **Patterns Appearing in Multiple Commits** | 101 | 106 |
| **Single-Occurrence Patterns (Support = 1)** | 7 | 0 |
| **Moderate Support Patterns ($2 \le \text{Support} \le 5$)** | 26 | 35 |
| **High Support Patterns (Support $\ge 6$)** | 76 | 71 |

---

## 5. Simulated Fallback Distribution

Under strictly chronological training ($j < c$), candidate destinations are evaluated against the backoff hierarchy:

| Fallback Level | PetClinic Candidates | PetClinic % | Shopizer Candidates | Shopizer % |
| :--- | :--- | :--- | :--- | :--- |
| **1. Operation-Conditioned $(o, p)$** | 320 | **31.04%** | 195 | **9.37%** |
| **2. Generic Path Fallback $(p)$** | 36 | **3.49%** | 111 | **5.33%** |
| **3. Structural Baseline Fallback** | 675 | **65.47%** | 1775 | **85.30%** |
| **Total Candidates Evaluated** | 1031 | 100.0% | 2081 | 100.0% |

---

## 6. Runtime, Caching, and Known Limitations

1. **Graph Reconstruction & Cache:**
   - Historical graph reconstruction uses git worktrees and caches AST graphs by repo ID, parent commit SHA, and analyzer version.
   - Execution time for full feasibility indexing: **59.46s** (PetClinic), **60.13s** (Shopizer).
2. **Rename and Reorganization Handling:**
   - Commit `28a1c2c` in PetClinic reorganized controllers into `v1` and `v2` packages. Git change detector with `-M` resolves renames under the `pre` perspective, maintaining valid component mapping.
3. **Lexical Hunk Classifier Limitations:**
   - The operation classifier uses unified git diff hunk parsing with regex classification. It is robust to whitespace and comments, but cannot perform full compiler AST differencing. Commits with multifaceted edits are explicitly classified as `UNKNOWN_OR_MIXED`.
