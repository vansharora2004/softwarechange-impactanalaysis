# Comprehensive Research Validity Audit and Verification Report
## Context-Aware Software Change Impact Analysis Framework Using Multi-Layer Software Knowledge Graphs

> **Date:** October 15, 2026  
> **Repository:** `software_change/backend`  
> **Evaluation Subjects:** Spring PetClinic REST (`master`), Shopizer (`shopizer-2.17.0`)  
> **Status:** All 5 Research-Validity Audit Items Addressed, Verified, and Tested (263/263 unit and E2E assertions passing)

---

## Executive Summary

This audit rigorously evaluates the scientific and empirical validity of the Context-Aware Software Change Impact Analysis Framework. Previous evaluation artifacts reported large F1 improvements (e.g., PetClinic F1 jumping from $0.0298$ to $0.2572$) and attributed the gain to context-awareness and historical mining. 

Our investigation revealed that:
1. **The $0.0298 \rightarrow 0.2572$ delta was not caused by context-awareness**, but by four fundamental differences between the heuristic baseline and the graph traversal engine (missing relationship types, directional restrictions, passive entity suppression, and categorical vs. thresholded scoring).
2. **Structural graph evaluation from HEAD introduced structural temporal leakage** for commits adding or renaming components. We implemented an exact parent-revision worktree snapshot pipeline (`commit^`) with zero temporal leakage.
3. **Controlled ablations across both PetClinic and Shopizer reveal candidate-set invariance**: because structural base influence alone exceeds the pruning threshold ($\theta=0.35$), context and history do not change the unranked candidate set or macro F1. Instead, **their true empirical contribution is rank-ordering within the candidate set**, dramatically improving $P@3$ (+37.3%), $R@3$ (+131.2%), and $P@5$ on repositories with rich commit histories (Shopizer).
4. **End-to-end reliability and traceability** were fully verified with 27 automated assertions covering file mapping, graph resolution, explanation fidelity, and transparent execution mode logging (`neo4j` vs. `in-memory-fallback`).
5. **A paper-ready methodology and honest contribution statement** have been established, clearly delineating what the multi-layer knowledge graph achieves and documenting all threats to validity.

---

## 1. Issue 1: Baseline Fairness & Root-Cause Deconstruction

### 1.1 The Discrepancy
In previous documentation, two baselines were conflated:
- **Baseline 1 (Heuristic Impact Engine):** Reported Macro $F_1 = 0.0298$ (Precision: $0.0526$, Recall: $0.0223$, Test Recall: $0.3377$).
- **Baseline 2 (Controlled Structural-Only Variant A):** Reported Macro $F_1 = 0.2572$ (Precision: $0.2396$, Recall: $0.3444$, Test Recall: $0.6974$).

Presenting the jump from $0.0298$ to $0.2572$ as evidence that "context-awareness and historical co-change improve impact prediction by $763\%$" is **scientifically invalid**. Both Variant A (Structural-only) and Variant C (Full Context-Aware) achieve identical unranked $F_1 = 0.2572$ on PetClinic.

### 1.2 Root-Cause Deconstruction
By inspecting `src/services/impactEngine.js` versus `src/services/contextAwareImpactAnalyzer.js`, we isolated four specific mechanisms explaining the gap between Baseline 1 and Baseline 2:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Why Baseline 1 Failed on Spring Framework                       │
├──────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ Dimension            │ Baseline 1 (Heuristic)        │ Baseline 2 (Variant A Structural│
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 1. Relationship      │ USES, DEPENDS_ON, TESTS only  │ DEPENDS_ON, USES, TESTS,        │
│    Coverage          │ (Drops EXTENDS, IMPLEMENTS)   │ IMPLEMENTS, EXTENDS             │
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 2. Traversal         │ Strict unidirectional path:   │ Undirected 2-hop BFS:           │
│    Directionality    │ In-In or Out-Out only         │ Bridges sibling controllers,    │
│                      │                               │ shared services, & DAOs         │
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 3. Passive Entity    │ Hard filter: drops all        │ Retained; scored via base       │
│    Suppression       │ Entity/Model & Other nodes    │ structural weight               │
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 4. Scoring &         │ Rigid categorical:            │ Continuous path weight scoring: │
│    Pruning           │ High / Medium / Low           │ Pruned at threshold θ = 0.35    │
└──────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

1. **Missing Polymorphic Relationships (`IMPLEMENTS`, `EXTENDS`):** In Spring architectures, controllers inject interfaces (e.g., `ClinicService`), which are implemented by concrete classes (`ClinicServiceImpl`). Baseline 1 explicitly ignores `IMPLEMENTS` and `EXTENDS`. As a result, any change in an interface cannot reach its implementation, and vice-versa, truncating the traversal at hop 1.
2. **Directional Traversal Bottleneck:** Baseline 1 requires both hops to be strictly outgoing ($A \rightarrow B \rightarrow C$) or strictly incoming ($A \leftarrow B \leftarrow C$). It cannot traverse sibling structures ($A \rightarrow B \leftarrow C$), where two controllers depend on the same service or repository. In contrast, Variant A explores bidirectional structural neighborhood.
3. **Passive Type Exclusion:** Baseline 1 unconditionally discards any component classified as `Entity/Model` or `Other` at hop 2 or connected via `USES`. In enterprise Java applications, database entities and DTOs frequently co-change with services and repositories. Excluding them artificially suppresses recall.
4. **Scoring Semantics:** Baseline 1 groups components into coarse categories (High, Medium, Low) without path attenuation or rank-weighting. Variant A assigns continuous path scores based on edge weights and hop attenuation.

### 1.3 Resolution & Experimental Standard
To preserve research integrity:
- **Baseline 1** is reported as the *Heuristic Baseline* (showing the limitations of naive directional dependency analysis).
- **Baseline 2 (Variant A)** is reported as the *Controlled Structural Baseline*, sharing identical candidate generation, relationship types, path attenuation, and pruning threshold ($\theta=0.35$) with the context-aware variants.
- The incremental value of context and history is evaluated strictly against **Baseline 2**.

---

## 2. Issue 2: Temporal Leakage Audit & Point-in-Time Evaluation

### 2.1 Trace of Temporal Data Flow
We traced how graph components, relationships, and Git co-change data were constructed across all evaluation commits:

1. **Historical Co-Change Mining (`gitHistoryAnalyzer.js` / `caseBuilderV3.js`):**
   - For commit index $i$, historical co-change pairs are extracted from `allCommits.slice(i + 1)`.
   - Because commits are sorted chronologically descending (index 0 is newest, index $N$ is oldest), `slice(i + 1)` inspects **strictly older commits**.
   - **Conclusion:** Historical co-change mining is **temporally leak-free**.

2. **Structural Graph Topology (`analysis_output.json`):**
   - In standard evaluation, the static AST graph was parsed once from repository `HEAD`.
   - Older commits (e.g., commit `abd2bd4`, 30 commits behind HEAD) were evaluated using a graph containing classes, interfaces, and methods that did not yet exist when `abd2bd4` was committed.
   - For commit `28a1c2c`, changes mapped to components in HEAD that were not present in its parent revision.
   - **Conclusion:** HEAD-based graph evaluation exhibits **structural temporal leakage**.

### 2.2 Point-in-Time Parent Revision Evaluation Pipeline
To quantify the impact of structural leakage, we built `src/evaluation/v3/temporalEvalHarnessV3.js`. For every evaluated commit:
1. It creates a temporary detached worktree at the commit's parent revision: `git worktree add <tempDir> <commit>^ --detach`.
2. It executes `analyzeRepository()` directly on the parent revision source tree.
3. It maps changed files to components that actually existed at `commit^`.
4. It mines leak-free history from commits strictly older than the target commit.
5. It executes all 5 evaluation variants on the point-in-time parent graph.
6. It safely unregisters and removes the worktree.

### 2.3 Empirical Comparison: HEAD-Based vs. Temporal Point-in-Time (PetClinic)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│             Temporal Point-in-Time vs. HEAD-Based Evaluation (PetClinic)               │
├──────────────────────────────┬────────────────────────────┬────────────────────────────┤
│ Metric                       │ HEAD-Based Graph (Leakage) │ Parent Worktree (No Leak)  │
├──────────────────────────────┼────────────────────────────┼────────────────────────────┤
│ Evaluated Commits            │ 6 commits (46 LOO cases)   │ 5 commits (44 LOO cases)*  │
│ Baseline 1 Precision         │ 0.0526                     │ 0.1350                     │
│ Baseline 1 Recall            │ 0.0223                     │ 0.0546                     │
│ Baseline 1 F1                │ 0.0298                     │ 0.0645                     │
│ Baseline 1 Test Recall       │ 0.3377                     │ 0.4052                     │
├──────────────────────────────┼────────────────────────────┼────────────────────────────┤
│ Variant A (Structural) F1    │ 0.2572                     │ 0.2523 (-0.0049)           │
│ Variant B (History) F1       │ 0.2572                     │ 0.2523 (-0.0049)           │
│ Variant C (Full Context) F1  │ 0.2572                     │ 0.2523 (-0.0049)           │
│ Variant C Precision          │ 0.2396                     │ 0.2322                     │
│ Variant C Recall             │ 0.3444                     │ 0.3481                     │
│ Variant C P@3                │ 0.2500                     │ 0.2624                     │
│ Variant C P@5                │ 0.2442                     │ 0.2514                     │
│ Variant C Test Recall        │ 0.6974                     │ 0.6599                     │
└──────────────────────────────┴────────────────────────────┴────────────────────────────┘
```
*\*Commit `28a1c2c` was skipped in the point-in-time evaluation because its changed non-test files did not yet exist in its parent `a3884f7`.*

### 2.4 Findings on Temporal Leakage
- **F1 Robustness:** The difference between HEAD-based Variant A F1 ($0.2572$) and Point-in-Time Variant A F1 ($0.2523$) is only $-0.0049$ ($-1.9\%$). The core structural findings remain solid.
- **Commit Eligibility:** In HEAD-based evaluation, commits that introduce brand new components appear to map cleanly, but at `commit^` those components do not yet exist. Point-in-time extraction correctly identifies these as zero-parent mappings and excludes them, ensuring rigorous validity.
- **Recommendation:** Paper claims should cite the **Point-in-Time (zero-leakage)** numbers as primary, noting HEAD-based metrics as a fast static approximation.

---

## 3. Issue 3: Controlled Ablations Across Repositories

### 3.1 Experimental Setup
We evaluated 5 models across identical leave-one-out cases on both repositories:
- **Model 1: Baseline 1** (Original Heuristic 2-hop baseline).
- **Model 2: Variant A** (Controlled Structural-only: $\alpha=0.7, \beta=0.3$, weights enabled, no history, no artifact context).
- **Model 3: Variant B** (Structural + History: $\alpha=0.7, \beta=0.3$, historical co-change enabled, no artifact context).
- **Model 4: Structural + Artifact Context** ($\alpha=0.7, \beta=0.3$, architectural role flow enabled, no history).
- **Model 5: Variant C** (Full Context-Aware: $\alpha=0.7, \beta=0.3$, all evidence layers active).

Pruning threshold for all scored models: $\theta = 0.35$.

### 3.2 Full Empirical Results Table

#### Spring PetClinic (Small/Medium Monolith, 105 Components, 259 Relationships)
- Total Commits: 6 | Total LOO Cases: 46

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline 1 (Heuristic)** | 0.0526 | 0.0223 | **0.0298** | 0.0761 | 0.0177 | 0.0652 | 0.0223 | 0.0560 | 0.0223 | 0.3377 |
| **Variant A (Structural-Only)** | 0.2396 | 0.3444 | **0.2572** | 0.2500 | 0.1017 | 0.2370 | 0.1558 | 0.2396 | 0.2571 | 0.6974 |
| **Variant B (Structural + History)** | 0.2396 | 0.3444 | **0.2572** | 0.2500 | 0.1017 | 0.2370 | 0.1558 | 0.2396 | 0.2571 | 0.6974 |
| **Structural + Artifact Context** | 0.2396 | 0.3444 | **0.2572** | 0.2500 | 0.1017 | 0.2442 | 0.1607 | 0.2435 | 0.2636 | 0.6974 |
| **Variant C (Full Context-Aware)** | 0.2396 | 0.3444 | **0.2572** | 0.2500 | 0.1017 | 0.2442 | 0.1607 | 0.2435 | 0.2636 | 0.6974 |

#### Shopizer (Large Multi-Module Enterprise, 1,368 Components, 3,925 Relationships)
- **Dataset 1: All 13 Eligible Commits (141 LOO cases)** (including refactoring mega-commit `052d2ed` modifying 107 components)

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline 1 (Heuristic)** | 0.0289 | 0.0152 | **0.0197** | 0.0381 | 0.0094 | 0.0345 | 0.0125 | 0.0298 | 0.0152 | 0.0894 |
| **Variant A (Structural-Only)** | 0.0465 | 0.3540 | **0.0826** | 0.0520 | 0.0356 | 0.0454 | 0.0525 | 0.0427 | 0.0984 | 0.3168 |
| **Variant B (Structural + History)** | 0.0465 | 0.3540 | **0.0826** | 0.0714 | 0.0823 | 0.0520 | 0.0982 | 0.0435 | 0.1345 | 0.3168 |
| **Structural + Artifact Context** | 0.0465 | 0.3540 | **0.0826** | 0.0520 | 0.0356 | 0.0454 | 0.0525 | 0.0427 | 0.0984 | 0.3168 |
| **Variant C (Full Context-Aware)** | 0.0465 | 0.3540 | **0.0826** | 0.0714 | 0.0823 | 0.0520 | 0.0982 | 0.0435 | 0.1345 | 0.3168 |

- **Dataset 2: Sensitivity Analysis — 12 Normal Commits (36 LOO cases)** (excluding mega-commit `052d2ed`)

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline 1 (Heuristic)** | 0.0308 | 0.0163 | **0.0210** | 0.0413 | 0.0102 | 0.0374 | 0.0135 | 0.0318 | 0.0163 | 0.0969 |
| **Variant A (Structural-Only)** | 0.1037 | 0.4497 | **0.1772** | 0.0694 | 0.0469 | 0.0611 | 0.0688 | 0.0569 | 0.1264 | 0.3432 |
| **Variant B (Structural + History)** | 0.1037 | 0.4497 | **0.1772** | 0.0903 | 0.1118 | 0.0708 | 0.1319 | 0.0583 | 0.1740 | 0.3432 |
| **Structural + Artifact Context** | 0.1037 | 0.4497 | **0.1772** | 0.0694 | 0.0469 | 0.0611 | 0.0688 | 0.0569 | 0.1264 | 0.3432 |
| **Variant C (Full Context-Aware)** | 0.1037 | 0.4497 | **0.1772** | 0.0903 | 0.1118 | 0.0708 | 0.1319 | 0.0583 | 0.1740 | 0.3432 |

### 3.3 Core Scientific Insights: Candidate-Set Invariance vs. Rank-Ordering Effects

The controlled ablation reveals two crucial scientific findings:

#### 1. Candidate-Set Invariance (Unranked F1 is Constant)
Across all variants (A, B, D, C), unranked Precision, Recall, and F1 are **numerically identical** ($0.2572$ on PetClinic HEAD, $0.2523$ on PetClinic Temporal, $0.0826$ on Shopizer All, $0.1772$ on Shopizer Normal).
- **Mathematical Cause:** For any 2-hop structural neighbor, the base structural score is:
  $$\text{baseInfluence} \ge 0.5 \times 1.0 = 0.50 \implies S_{\text{structural}} = \alpha \times \text{baseInfluence} = 0.70 \times 0.50 = 0.35$$
- Because the pruning threshold is $\theta = 0.35$, **every reached 1-hop and 2-hop structural neighbor passes the threshold on structural grounds alone**.
- Adding historical co-change or artifact weights increases scores for already-admitted components, but never admits a component that was not already admitted by structural traversal.
- **Therefore, context and history DO NOT expand the candidate set beyond 2-hop graph reachability.**

#### 2. Re-Ranking Within Candidate Set (Top-k Metrics Surge)
While the candidate set remains constant, **the relative order of components changes significantly**:
- On Shopizer (where Git history contains rich co-change data across multiple developers), adding historical co-change (Variant B) dramatically boosts top-k precision and recall:
  - **P@3:** increases from $0.0520 \rightarrow 0.0714$ (**+37.3% relative improvement**) on 13 commits, and $0.0694 \rightarrow 0.0903$ (**+30.1%**) on 12 normal commits.
  - **R@3:** increases from $0.0356 \rightarrow 0.0823$ (**+131.2% relative improvement**) on 13 commits, and $0.0469 \rightarrow 0.1118$ (**+138.4%**) on 12 normal commits.
  - **R@5:** increases from $0.0525 \rightarrow 0.0982$ (**+87.0% relative improvement**) on 13 commits, and $0.0688 \rightarrow 0.1319$ (**+91.7%**) on 12 normal commits.
- On PetClinic (small repo, 100 commits), artifact context slightly boosts $P@5$ and $R@5$ ($0.2370 \rightarrow 0.2442$).
- **Scientific Conclusion:** The true empirical value of the multi-layer knowledge graph is **prioritization and rank-ordering**. Developers reviewing change impact do not inspect 70 components; they inspect the top 3 to 5 recommendations. In that critical inspection window, historical co-change more than doubles recall.

---

## 4. Issue 4: End-to-End Reliability, Traceability & Execution Modes

### 4.1 Automated Verification Suite
To guarantee that the implementation is robust, reproducible, and verifiable, we constructed four automated test suites executing **263 assertions**:

1. `npm run test:analyzer` (24 assertions): Fully qualified IDs, inheritance detection, dependency injection, wildcard imports, relative file paths.
2. `npm run test:git` (20 assertions): Phase 2 Git change detection, added/modified/deleted/renamed files, merge exclusion, name-status mapping.
3. `npm run test:engine` (192 assertions): 1-hop and 2-hop traversal, evidence source attribution, score bounds, deterministic tie-breaking across 6 repeated runs, self-exclusion, regression test separation.
4. `npm run test:e2e` (27 assertions): Full end-to-end pipeline from changed file to API payload, 100% graph ID resolution, explanation fidelity, and execution mode reporting.

All 263 assertions pass cleanly with zero failures (`npm test`).

### 4.2 Graph Resolution & Traceability
- **100% ID Resolution:** In the end-to-end tests, 100% of component IDs returned by both `analyzeImpact` (16 components) and `analyzeContextAwareImpact` (69 components) resolve to valid, active entries in `analysis_output.json`.
- **Reasoning Fidelity:**
  - Explanations strictly follow the graph edges traversed (e.g., `A ➔ [DEPENDS_ON] ➔ B ➔ [USES] ➔ C`).
  - Evidence sources (`historical_co_change`, `artifact_context`, `structural`, `regression_test`) are strictly conditioned on actual non-zero evidence counters.
- **Input Component Self-Exclusion:** The seed component is mathematically and programmatically excluded from recommendations.

### 4.3 Explicit Execution Mode Differentiation
In earlier versions, when the Neo4j daemon was offline, the backend silently fell back to in-memory evaluation without informing the caller or UI.
We updated `src/services/impactEngine.js`, `src/services/contextAwareImpactAnalyzer.js`, and `src/routes/api.js` to:
1. Log distinct symbols and messages in terminal stdout:
   - Live Neo4j: `🔗 [ContextAwareEngine] Running via live Neo4j Knowledge Graph...`
   - In-memory fallback: `⚡ [ContextAwareEngine] Neo4j is offline; running via in-memory fallback graph.`
2. Return explicit `executionMode` in API responses:
   ```json
   {
     "success": true,
     "executionMode": "in-memory-fallback",
     "changedComponents": ["org.springframework.samples.petclinic.service.ClinicService"],
     "potentiallyImpactedComponents": [ ... ]
   }
   ```
This eliminates ambiguity in production demonstrations, paper evaluations, and automated tests.

---

## 5. Issue 5: Research Contribution Statement & Threats to Validity

### 5.1 Honest Research Contribution Statement
For inclusion in the research paper / thesis:

> **Primary Contribution:**
> We propose a multi-layer software change impact analysis framework that integrates static abstract syntax tree (AST) dependencies, historical co-change frequencies mined from version control, and architectural artifact role semantics into a unified knowledge graph.
>
> **Empirical Findings:**
> 1. **Structural Foundation:** Controlled experiments on two open-source Spring Boot repositories demonstrate that comprehensive polymorphic and structural relationship coverage (`IMPLEMENTS`, `EXTENDS`, `DEPENDS_ON`, `USES`) is the dominant factor determining unranked candidate recall, improving $F_1$ from $0.0298$ to $0.2572$ on Spring PetClinic and from $0.0210$ to $0.1772$ on Shopizer compared to a naive directional baseline.
> 2. **Ranking & Prioritization:** Historical co-change mining does not expand the candidate boundary beyond 2-hop structural reachability, but provides substantial rank-ordering value in repositories with collaborative development histories. On Shopizer, incorporating historical co-change increases $P@3$ by $+30.1\%$ ($0.0694 \rightarrow 0.0903$) and $R@3$ by $+138.4\%$ ($0.0469 \rightarrow 0.1118$) over the controlled structural baseline.
> 3. **Temporal Validity:** Point-in-time evaluation across detached parent-revision worktrees confirms that structural temporal leakage in HEAD-based evaluation introduces only minor metric inflation ($-1.9\%$ F1 shift on PetClinic), while completely eliminating false candidate mappings for newly created components.

### 5.2 Explicit Threats to Validity & Limitations

#### Construct Validity
- **Oracle Construction:** Ground truth is derived retrospectively from Git commits using leave-one-component-out (LOO) splits. While standard in change impact analysis literature, commits may contain opportunistic refactoring, documentation fixes, or multi-task changes that do not represent strict functional impact.
- **Pruning Threshold Sensitivity:** The fixed pruning threshold $\theta = 0.35$ was calibrated based on base path weights ($0.7 \times 0.5 = 0.35$). Because structural base influence alone meets this threshold for 2-hop neighbors, candidate-set expansion could not be observed. A variable or higher threshold (e.g., $\theta = 0.50$) would make candidate admission dependent on historical or artifact reinforcement.

#### Internal Validity
- **Co-Change Sparsity in Small Repositories:** In PetClinic (a small reference application with only 100 commits and few active contributors), historical co-change counts are sparse ($0$ to $2$ co-changes for most pairs). Consequently, historical mining had negligible impact on PetClinic ranking ($P@3 = 0.2500$ across all variants). Its value emerged decisively only on Shopizer (a production enterprise system with extensive history).
- **Mega-Commit Sensitivity:** Large sweeping refactorings (such as Shopizer commit `052d2ed` modifying 107 components across multiple modules) skew aggregate macro-precision downwards ($0.0465$ vs. $0.1037$). Multi-component change impact analyzers require commit size caps or sensitivity reporting to prevent individual refactoring commits from dominating metrics.

#### External Validity
- **Language and Framework Generalizability:** The current static analyzer is tailored to Java / Spring Boot conventions (annotations `@Service`, `@RestController`, `@Repository`, Spring Data JPA interfaces, constructor injection). Applying the framework to dynamically typed languages (Python, JavaScript) or frameworks without declarative DI requires language-specific AST extractors.

---

## 6. Summary of Artifact Deliverables

| File | Description | Status |
| :--- | :--- | :---: |
| [`src/evaluation/v3/temporalEvalHarnessV3.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/evaluation/v3/temporalEvalHarnessV3.js) | Parent-revision worktree temporal evaluation harness | ✓ Complete |
| [`temporal_evaluation_results_v3.json`](file:///c:/yashika/STUDY/clg_project/software_change/backend/temporal_evaluation_results_v3.json) | Zero-leakage temporal point-in-time results | ✓ Generated |
| [`temporal_evaluation_summary_v3.md`](file:///c:/yashika/STUDY/clg_project/software_change/backend/temporal_evaluation_summary_v3.md) | Human-readable temporal summary report | ✓ Generated |
| [`src/test/endToEndReliabilityTests.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/test/endToEndReliabilityTests.js) | End-to-end pipeline, ID resolution, explanation tests | ✓ 27/27 Passing |
| [`src/routes/api.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/routes/api.js) | API endpoints returning transparent `executionMode` | ✓ Updated |
| [`src/services/impactEngine.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/impactEngine.js) | Baseline engine with explicit mode logging | ✓ Updated |
| [`src/services/contextAwareImpactAnalyzer.js`](file:///c:/yashika/STUDY/clg_project/software_change/backend/src/services/contextAwareImpactAnalyzer.js) | Context engine with explicit mode logging | ✓ Updated |
| [`package.json`](file:///c:/yashika/STUDY/clg_project/software_change/backend/package.json) | Added `eval:temporal`, `test:e2e`, updated `test` | ✓ Updated |
| Full Test Suite (`npm test`) | 263 assertions across analyzer, git, engine, e2e suites | ✓ 263/263 Passing |
