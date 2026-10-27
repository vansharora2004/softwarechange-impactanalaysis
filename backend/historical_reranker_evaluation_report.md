# Historical Evaluation Report: Pre-Change Structural Graph Reconstruction + Historical Reranking

**Project:** Context-Aware Software Change Impact Analysis Framework Using Multi-Layer Software Knowledge Graphs  
**Date:** 2026-10-15T05:37:20.601Z  
**Evaluation Protocol:** Retrospective Leave-One-Out (LOO) with Pre-Change Structural Graphs at Parent Revisions  

---

## 1. Temporal Integrity & Methodology

This evaluation resolves the static HEAD graph limitation. For every evaluated commit $C$:
1. **Pre-Change Knowledge Graph ($G_P$):** The structural graph is reconstructed from the repository state at parent revision $P = C^1$.
2. **Leak-Free Co-Change History:** Derived exclusively from commits strictly older than $C$ ($i + 1 dots N$).
3. **Identical Candidate Sets:** Structural baseline and proposed reranker receive identical candidates; candidates with zero co-change are retained.
4. **No Arbitrary Thresholds:** Candidate generation is bounded strictly by graph topology.

---

## 2. Spring PetClinic Results (57 LOO Cases across 8 Commits)

| Configuration | Depth | |C| | Precision | Recall | F1 | P@3 | P@5 | P@10 | MAP | MRR | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Structural Baseline (Hop 1)** | 1-hop | 2.373 | 0.2357 | 0.1383 | 0.1543 | 0.2649 | 0.2437 | 0.2377 | 0.126 | 0.316 | 0.2478 |
| **Structural Baseline (Hop 2)** | 2-hop | 15.1612 | 0.1868 | 0.5655 | 0.2339 | 0.2103 | 0.186 | 0.1689 | 0.2437 | 0.4137 | 0.3824 |
| **Structural Baseline (Hop 3)** | 3-hop | 40.1875 | 0.093 | 0.7026 | 0.1524 | 0.2103 | 0.186 | 0.1523 | 0.2712 | 0.4184 | 0.5655 |
| **Proposed Reranker (Hop 1)** | 1-hop | 2.373 | 0.2357 | 0.1383 | 0.1543 | 0.2666 | 0.2469 | 0.2377 | 0.1263 | 0.3143 | 0.2478 |
| **Proposed Reranker (Hop 2)** | 2-hop | 15.1612 | 0.1868 | 0.5655 | 0.2339 | 0.1822 | 0.196 | 0.1728 | 0.2255 | 0.3893 | 0.3824 |
| **Proposed Reranker (Hop 3)** | 3-hop | 40.1875 | 0.093 | 0.7026 | 0.1524 | 0.1926 | 0.1843 | 0.1553 | 0.2431 | 0.3917 | 0.5655 |

---

## 3. Shopizer Results (46 LOO Cases across 12 Commits)

| Configuration | Depth | |C| | Precision | Recall | F1 | P@3 | P@5 | P@10 | MAP | MRR | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Structural Baseline (Hop 1)** | 1-hop | 3.4965 | 0.0625 | 0.0486 | 0.0474 | 0.0801 | 0.0734 | 0.0635 | 0.0345 | 0.1434 | 0.0052 |
| **Structural Baseline (Hop 2)** | 2-hop | 40.0729 | 0.0218 | 0.1295 | 0.0334 | 0.0729 | 0.0622 | 0.0387 | 0.0478 | 0.1489 | 0.0052 |
| **Structural Baseline (Hop 3)** | 3-hop | 340.0052 | 0.0064 | 0.6896 | 0.0123 | 0.0729 | 0.0622 | 0.0387 | 0.0559 | 0.1521 | 0.3594 |
| **Proposed Reranker (Hop 1)** | 1-hop | 3.4965 | 0.0625 | 0.0486 | 0.0474 | 0.0929 | 0.0734 | 0.0635 | 0.042 | 0.1667 | 0.0052 |
| **Proposed Reranker (Hop 2)** | 2-hop | 40.0729 | 0.0218 | 0.1295 | 0.0334 | 0.1458 | 0.1115 | 0.0606 | 0.0918 | 0.2037 | 0.0052 |
| **Proposed Reranker (Hop 3)** | 3-hop | 340.0052 | 0.0064 | 0.6896 | 0.0123 | 0.2054 | 0.1788 | 0.099 | 0.2422 | 0.3225 | 0.3594 |
