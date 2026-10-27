# EGCP Readiness & Feasibility Assessment

**Project:** Context-Aware Software Change Impact Analysis Framework  
**Location:** `C:\yashika\STUDY\clg_project\software_change`  
**Date:** 2026-10-20  
**Audit Directory:** `software_change/research_artifacts/full_project_audit_20261020/`  

---

## 1. Verified Limitations of OCCP

Before considering an extension such as **Edit-Graph Conditioned Propagation (EGCP)**, we systematically categorize the verified, reproducible limitations of OCCP discovered during our empirical audits:

### Limitation 1: Coarse Diff-Level Operation Classification
- OCCP relies on unified regex scanning of `git diff -U0` hunks.
- When a developer edits a method declaration and adjusts internal logic within the same file, the classifier labels the edit `UNKNOWN_OR_MIXED`.
- In Spring PetClinic REST, **56.1% of evaluation cases (32/57) were classified as `UNKNOWN_OR_MIXED`**, neutralizing the intended specificity of operation conditioning.

### Limitation 2: Extreme Data Sparsity from Operation Splitting
- Conditioning a path $p$ on an operation $o$ splits training observations across $(o, p)$ pairs.
- In medium-sized repositories, many $(o, p)$ combinations appear only 1 or 2 times across the entire historical lookback window.
- The raw empirical ratio $Pos(o, p) / Total(o, p)$ yields brittle probabilities ($1/1 = 1.00$, $0/1 = 0.00$) due to the complete lack of Laplace or Dirichlet smoothing.

### Limitation 3: Tier-First Precedence Pathology
- OCCP sorts candidates by hard ordinal tiers: `Tier 1 (Conditioned) > Tier 2 (Generic) > Tier 3 (Co-Change) > Tier 4 (Structural)`.
- A candidate with a single noisy observation in Tier 1 ($1/1 = 1.0$) automatically ranks ahead of a candidate in Tier 3 with 20 confirmed historical co-changes.
- On repositories with rich version histories (Shopizer), this causes OCCP to demote verified co-change targets, resulting in **V4 Historical Reranker beating OCCP by +18.2%**.

### Limitation 4: Complete Absence of Multi-Hop Paths in Utility Libraries
- In decoupled utility libraries (Apache Commons Lang), static utility classes have no layered service wiring.
- OCCP finds zero supported typed paths and collapses 100% into the Historical Co-Change Reranker tier.

---

## 2. What Would EGCP Do Differently?

### Concept of EGCP (Edit-Graph Conditioned Propagation):
Rather than assigning a single, coarse file-level label $o \in \{\text{METHOD\_SIGNATURE}, \text{METHOD\_BODY}, \dots\}$:
1. **Fine-Grained AST Differencing:** EGCP extracts an edit script or edit graph $\Delta G_{ast}$ (via GumTree or ChangeDistiller) containing atomic tree operations: `InsertNode(MethodInvocation)`, `UpdateNode(SimpleType)`, `DeleteNode(FieldDeclaration)`.
2. **Contextual Edit Subgraphs:** Conditions change propagation on subgraphs of AST edits that specifically touch interface boundaries or outward call sites.
3. **Selective Propagation Channels:** Differentiates edits that alter outward-facing data contracts from internal refactorings that preserve semantic invariants.

---

## 3. Falsifiable Hypothesis & Minimum Fair Experiment

If EGCP were to be pursued in future research, it must be formulated as a strictly falsifiable scientific hypothesis:

### Hypothesis $H_{EGCP}$:
> *Conditioning multi-hop change propagation on fine-grained AST edit subgraphs ($\Delta G_{ast}$) yields higher MAP and Precision@K than both coarse file-level operation conditioning (OCCP) and context-free historical co-change reranking (V4), by filtering out internal method body refactorings that do not escape component boundaries.*

### Required Experimental Design:
1. **Baselines:**
   - Canonical Structural Baseline (Hop 2)
   - V4 Historical Co-Change Reranker
   - Model A (Context-Free Typed Paths)
   - Model B (OCCP Coarse Operations)
   - EGCP (Fine-Grained AST Edit Graph)
2. **Controlled Ablations:**
   - EGCP with AST Differencing only.
   - EGCP with Bayesian Laplace Smoothing ($m$-estimate).
   - EGCP with Continuous Reciprocal Rank Fusion (eliminating hard ordinal tiers).
3. **Benchmark Repositories:**
   - Must evaluate across multi-module Spring systems (Shopizer, PetClinic) and compiler/CLI tools (where AST diffs are critical).
4. **Success Threshold:**
   - EGCP must achieve statistically significant improvement ($p < 0.05$ via two-tailed Wilcoxon signed-rank test across independent commits) over the simple V4 Historical Reranker on at least two independent repositories.

---

## 4. Formal Recommendation: DEFER (NO-GO for Current Phase)

### Audit Verdict: **DEFER IMPLEMENTATION**

### Detailed Scientific Justification:
1. **The Root Cause of OCCP Underperformance is Statistical, Not Representational:**  
   OCCP did not underperform on Shopizer because its operation labels were slightly coarse; it underperformed because its **ranking architecture (hard ordinal tiers) and lack of Bayesian smoothing** caused it to prioritize 1-observation path noise over strong historical co-change evidence.
2. **Implementing EGCP Would Multiply Data Sparsity:**  
   Fine-grained AST edit graphs have far higher dimensionality than 6 coarse operation categories. Splitting the existing 24 independent commits across thousands of AST edit graph patterns would create catastrophic data sparsity, worsening the $1/1 = 100\%$ noise problem unless advanced representation learning (e.g. Graph Neural Networks or Tree-LSTM embeddings) is introduced.
3. **Immediate Low-Hanging Fruit within OCCP:**  
   Before implementing a complex AST-diffing engine, the following three statistical fixes should be evaluated on OCCP:
   - **Bayesian Smoothing:** Replace raw empirical confidence with Laplace smoothing: $\frac{Pos + 1}{Total + 2}$ or Dirichlet prior.
   - **Support Thresholding:** Require minimum observation support ($Total(o, p) \ge 3$) before promoting a candidate to Tier 1.
   - **Continuous Score Fusion:** Replace hard ordinal tiers with continuous score interpolation or calibrated logistic regression.

**Conclusion:** Implementing EGCP now is **unjustified**. The priority for the B.Tech project must be documenting the honest, leak-free empirical comparison between the Structural Baseline, V4 Historical Reranker, and OCCP.
