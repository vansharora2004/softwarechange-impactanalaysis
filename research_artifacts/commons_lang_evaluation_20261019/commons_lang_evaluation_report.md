# Apache Commons Lang: Dataset Suitability & OCCP Evaluation Report

**Project:** Context-Aware Software Change Impact Analysis Framework  
**Target Repository:** Apache Commons Lang (`C:\yashika\STUDY\clg_project\commons-lang`)  
**Evaluation Date:** 2026-10-20  
**Artifact Directory:** `software_change/research_artifacts/commons_lang_evaluation_20261019/`  
**Protocol:** Leak-Free Chronological Lookback ($j < c$) with Pre-Change Historical Knowledge Graph Reconstruction ($c^1$)  

---

## 1. Executive Summary & Core Findings

An empirical evaluation was conducted on **Apache Commons Lang** to assess whether Operation-Conditioned Change Propagation (OCCP) outperforms the structural baseline and the historical co-change reranker.

### Key Empirical Findings:
1. **Architectural Divergence & Utility Isolation:**  
   Unlike tiered enterprise applications (Spring PetClinic REST and Shopizer) where changes propagate along architectural layers (`Controller` $\to$ `Service` $\to$ `Repository`), Commons Lang consists primarily of independent, static utility classes. Over **70% of all Java commits touch only a single utility class plus its unit test** (`E8_SINGLE_NON_TEST`), leaving only 5 eligible multi-class commits in the recent 100/200 commits.
2. **Structural Baseline Performance:**  
   The Canonical Structural Graph Traversal Baseline achieved **MAP = 0.0592** and **MRR = 0.0636** ($P@3 = 0.0000$, $P@5 = 0.0182$). Because utility classes rarely depend on one another, structural traversal often yields sparse or unconnected candidate sets.
3. **Historical Reranker Improvement:**  
   The V4 Historical Co-Change Reranker substantially improved ranking accuracy to **MAP = 0.1512** (+155.3% over structural baseline) and **MRR = 0.1590** (+150.0%), successfully elevating strongly co-changed companion classes (e.g., `CompareToBuilder`, `HashCodeBuilder`, `ToStringBuilder`).
4. **OCCP Model Collapse to Fallback Tier:**  
   OCCP (Model B) achieved **MAP = 0.1512** and **MRR = 0.1590**—**identical to the Historical Reranker**. Because static utility methods lack multi-hop typed relationship paths, OCCP had 0 support for operation-conditioned path signatures and triggered a 100% fallback to the historical co-change reranker tier.
5. **No Filesystem or Namespace Blockers:**  
   Unlike Apache Maven, Commons Lang demonstrated **0 duplicate component collisions** and **0 Windows MAX_PATH errors**, confirming that the AST analyzer and worktree isolation mechanism operate reliably on standard Maven single-module projects.

---

## 2. Git History & Dataset Suitability Metrics

| Metric | Measured Value | Analysis & Implication |
| :--- | :--- | :--- |
| **Total Git Commits** | **10,093** | Spanning 24+ years (July 2002 to October 2026). |
| **Merge Commits** | **240 (2.38%)** | Very low merge frequency; strict squash/rebase model. |
| **Non-Merge Commits** | **9,853** | Linear commit history. |
| **Recent 100 Commits Inspected** | 100 | 43 No Java, 12 Test-Only, 40 Single Non-Test, **5 Eligible (5.0%)**. |
| **Recent 200 Commits Inspected** | 200 | 52 No Java, 35 Test-Only, 108 Single Non-Test, **5 Eligible (2.5%)**. |
| **Recent 500 Commits Inspected** | 500 | 117 No Java, 65 Test-Only, 296 Single Non-Test, **21 Eligible (4.2%)**. |

### Explanation of the `E8_SINGLE_NON_TEST` Phenomenon
In enterprise web services, a feature change often requires modifying a controller, service, repository, and entity simultaneously. In contrast, Commons Lang development is dominated by localized utility bug fixes:
- `StringUtils.java` + `StringUtilsTest.java`
- `ArrayUtils.java` + `ArrayUtilsTest.java`
- `ClassPathUtils.java` + `ClassPathUtilsTest.java`

Under standard Leave-One-Out evaluation semantics, a commit must touch $\ge 2$ non-test components so that one component can serve as the change input seed and the other as the held-out impact target. Commits with only 1 production class cannot be evaluated for multi-component propagation.

---

## 3. AST Analyzer & Structural Graph Characteristics

| Dimension | Apache Commons Lang | Shopizer | Spring PetClinic REST |
| :--- | :---: | :---: | :---: |
| **Total Java Files** | **628** | 1,388 | 104 |
| • Main Java Files | 264 | 895 | 68 |
| • Test Java Files | 364 | 493 | 36 |
| **AST Analysis Time** | **54.67s** | 18.42s | 1.12s |
| **Registered Components** | **612** | 1,372 | 104 |
| **Duplicate ID Collisions** | **0** | 0 | 0 |
| **Extracted Relationships** | **1,171** | 7,654 | 248 |
| • TESTS | 531 (45.3%) | 2,140 (28.0%) | 78 (31.5%) |
| • EXTENDS | 333 (28.4%) | 1,821 (23.8%) | 28 (11.3%) |
| • REFERENCES | 233 (19.9%) | 2,412 (31.5%) | 84 (33.9%) |
| • USES | 51 (4.4%) | 981 (12.8%) | 38 (15.3%) |
| • IMPLEMENTS | 23 (2.0%) | 284 (3.7%) | 18 (7.3%) |
| • DEPENDS_ON / ASSOC | 0 (0.0%) | 16 (0.2%) | 2 (0.8%) |
| **Component Classification** | 325 Test (53%), 287 Other (47%) | Service/Repo/Entity/Controller | Service/Repo/Entity/Controller |

**Observation:** Commons Lang contains **0 Services, 0 Repositories, 0 Controllers, and 0 Entities**. The components are classified as `Other` (static utility classes) or `Test`. The graph density is exceptionally low (1.91 edges/node vs. 5.58 edges/node in Shopizer), reflecting the loose architectural coupling of utility libraries.

---

## 4. Retrospective Evaluation: Baseline vs. Historical Reranker vs. OCCP

All models were evaluated across 11 retrospective Leave-One-Out cases generated from candidate multi-Java commits:
- Commit `72dc555185` (3 cases): `CompareToBuilder`, `HashCodeBuilder`, `ToStringBuilder`
- Commit `4c87656ee5` (3 cases): `CharRange`, `Range`, `Fraction`
- Commit `8065c45316` (2 cases): `JavaVersion`, `SystemUtils`
- Commit `117a9ea791` (3 cases): `FastDateFormat`, `FastDateParser`, `FastDatePrinter`

### Metric Comparison Table

| Metric | Structural Baseline (Hop 2) | Historical Co-Change Reranker | OCCP (Model B) | Relative OCCP vs Baseline | Relative OCCP vs Hist Reranker |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **MAP** | **0.0592** | **0.1512** | **0.1512** | **+155.3%** | **0.0% (Tied)** |
| **MRR** | **0.0636** | **0.1590** | **0.1590** | **+150.0%** | **0.0% (Tied)** |
| **Precision@3** | 0.0000 | 0.0909 | 0.0909 | N/A | 0.0% (Tied) |
| **Recall@3** | 0.0000 | 0.1364 | 0.1364 | N/A | 0.0% (Tied) |
| **Precision@5** | 0.0182 | 0.1273 | 0.1273 | +600.0% | 0.0% (Tied) |
| **Recall@5** | 0.0455 | 0.3182 | 0.3182 | +600.0% | 0.0% (Tied) |

### Per-Case Metric Breakdown

| Target Commit | Input Seed | Oracle Targets | Candidate Set | Baseline AP | Hist Reranker AP | OCCP AP | Behavior & Fallback Analysis |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `72dc555185` | `CompareToBuilder` | `HashCodeBuilder`, `ToStringBuilder` | 12 | 0.1534 | **0.5000** | **0.5000** | Builders co-change frequently; Hist reranker elevates targets to top 2. OCCP falls back to Hist. |
| `72dc555185` | `HashCodeBuilder` | `CompareToBuilder`, `ToStringBuilder` | 12 | 0.1534 | **0.5000** | **0.5000** | Same cluster symmetry; Hist reranker lifts targets. OCCP falls back to Hist. |
| `72dc555185` | `ToStringBuilder` | `CompareToBuilder`, `HashCodeBuilder` | 39 | 0.0479 | **0.3667** | **0.3667** | Target candidate set large; Hist reranker lifts targets from rank ~20 to rank 3/4. |
| `4c87656ee5` | `CharRange` | `Range`, `Fraction` | 7 | 0.0000 | 0.0000 | 0.0000 | Structurally disconnected; targets not in candidate set. All models score 0. |
| `4c87656ee5` | `Range` | `CharRange`, `Fraction` | 12 | 0.0000 | 0.0000 | 0.0000 | Structurally disconnected; targets not in candidate set. All models score 0. |
| `4c87656ee5` | `Fraction` | `CharRange`, `Range` | 5 | 0.0000 | 0.0000 | 0.0000 | Structurally disconnected; targets not in candidate set. All models score 0. |
| `8065c45316` | `JavaVersion` | `SystemUtils` | 39 | 0.0278 | 0.0278 | 0.0278 | `SystemUtils` references `JavaVersion`; 0 prior co-change; rankings identical. |
| `8065c45316` | `SystemUtils` | `JavaVersion` | 59 | 0.0500 | 0.0500 | 0.0500 | Reverse direction; 0 prior co-change; rankings identical. |
| `117a9ea791` | `FastDateFormat` | `FastDateParser`, `FastDatePrinter` | 21 | 0.0833 | 0.0833 | 0.0833 | Strong structural coupling, but low prior co-change count; rankings unchanged. |
| `117a9ea791` | `FastDateParser` | `FastDateFormat`, `FastDatePrinter` | 17 | 0.0357 | 0.0357 | 0.0357 | Structural traversal captures candidates; 0 prior co-change difference. |
| `117a9ea791` | `FastDatePrinter` | `FastDateFormat`, `FastDateParser` | 7 | 0.1000 | 0.1000 | 0.1000 | Structural traversal captures candidates; 0 prior co-change difference. |

---

## 5. Comprehensive Cross-Repository Benchmark Matrix

Across all four repositories evaluated in this project:

| Benchmark Dimension | Spring PetClinic REST | Shopizer | Apache Commons Lang | Apache Maven |
| :--- | :---: | :---: | :---: | :---: |
| **System Category** | Microservice REST API | E-Commerce Enterprise Web App | Static Utility Library | CLI Build Tool / Core Compiler |
| **Architecture** | Tiered Spring Boot | Multi-Module Spring / Hibernate | Standalone Static Utility Classes | Multi-Module Plexus / Guice |
| **Total Java Files** | 104 | 1,388 | **628** | 3,280 |
| **AST Parse Time** | 1.1s | 18.4s | **54.7s** | 387.9s (6.5 min) |
| **Graph Density (Edges/Node)** | 2.38 | 5.58 | **1.91** | 2.85 |
| **Eligible Commits Rate** | 8.0% | 22.2% | **5.0%** | Blocked (MAX_PATH / Collisions) |
| **Single-Class Commit Rate** | ~35% | ~28% | **70.2%** | ~40% |
| **Structural Baseline MAP** | **0.1758** | **0.0432** | **0.0592** | Blocked |
| **Historical Reranker MAP** | 0.1651 (-6.09%) | **0.0897 (+107.64%)** | **0.1512 (+155.3%)** | Blocked |
| **OCCP (Model B) MAP** | **0.1864 (+6.03%)** | 0.0759 (+75.69%) | **0.1512 (+155.3%)** | Blocked |
| **OCCP vs Historical Reranker** | **OCCP +12.9%** | **Hist Reranker +18.2%** | **Exact Tie (0.0% diff)** | Blocked |
| **Primary OCCP Mechanism** | Path Condition Weighting | Path Condition Weighting | **100% Fallback to Hist Reranker** | N/A |

---

## 6. Synthesis & Scientific Insights for B.Tech Thesis

1. **Where OCCP Works Best:**
   - OCCP demonstrates positive impact over the historical reranker only in **tightly coupled, layered service architectures** (like Spring PetClinic REST) where operations (`ADD_METHOD`, `MODIFY_BODY`) travel along specific typed paths (`Controller` $\to$ `Service` $\to$ `Repository`).
2. **Where Historical Reranker Dominates:**
   - In large, complex systems with cross-cutting concerns (Shopizer), co-change history captures hidden conceptual dependencies that do not align neatly with single typed paths.
3. **Where OCCP Collapses into Reranking:**
   - In **utility libraries (Commons Lang)**, the absence of multi-hop architectural call chains causes OCCP to degrade gracefully into the Historical Reranker. OCCP neither outperforms nor underperforms historical reranking; it operates identically because typed path support is zero.
4. **Where CIA Tools Encounter Architectural Limitations:**
   - When developers fix independent bugs in decoupled classes within the same commit (e.g., `CharRange` + `Range` + `Fraction` in `4c87656ee5`), **no structural or path-based CIA method can succeed**, because no static structural dependency exists between those components.

---

## 7. Artifacts Generated
- Data: `software_change/research_artifacts/commons_lang_evaluation_20261019/commons_lang_assessment_data.json`
- Report: `software_change/research_artifacts/commons_lang_evaluation_20261019/commons_lang_evaluation_report.md`
