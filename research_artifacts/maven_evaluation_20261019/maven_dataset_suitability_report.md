# Apache Maven Dataset Suitability & Evaluation Feasibility Report

**Project:** Context-Aware Software Change Impact Analysis Framework Using Multi-Layer Software Knowledge Graphs  
**Date:** 2026-10-19  
**Target Repository:** Apache Maven (`C:\yashika\STUDY\clg_project\maven`)  
**Evaluation Status:** **EVALUATION HALTED (Protocol Blockers Documented)**  
**Artifact Directory:** `software_change/research_artifacts/maven_evaluation_20261019/`  

---

## 1. Executive Summary & Audit Verdict

In accordance with Phase 2 and Phase 3 instructions:
> *"Inspect Maven's source structure and determine whether the existing Java analyzer can represent its important dependencies adequately. Do not count all Git commits as valid test cases. If the eligible dataset is too small, or the graph and ground-truth generation are incompatible with Maven, stop before model evaluation and explain why."*  
> *"If the current harness cannot evaluate Maven correctly without changing core code or evaluation semantics, stop and document the blocker. Do not silently adapt the protocol."*

A rigorous Phase 2 suitability audit was performed on Apache Maven. While Maven possesses an enormous Git commit history (16,582 commits across 18.5 years), **four severe technical and semantic blockers make the current evaluation harness and AST analyzer incompatible with Apache Maven**:

1. **Windows Filesystem `MAX_PATH` Checkout Failure:**  
   When the retrospective evaluation harness creates parent revision worktrees via `git worktree add`, checkout crashes with `fatal: cannot create directory at 'its/core-it-suite/...': Filename too long`. The harness catches this error and assigns exclusion code `E_HISTORICAL_GRAPH_FAILED`. Consequently, **100% of target commits fail historical graph reconstruction** under the existing configuration.
2. **Duplicate Component ID Collision & Overwriting:**  
   `javaAnalyzer.js` establishes component uniqueness by Fully Qualified Name (`id = packageName.ClassName`). In Apache Maven, multiple sub-modules (`compat`, `impl`, and especially `its/core-it-suite/src/test/resources/`) declare mock/stub classes with identical packages and names. As a result, **179 components are silently overwritten in the component map**, causing production components to be replaced with mock test classes and corrupting ground-truth mapping.
3. **Architectural Framework Mismatch (Plexus/Guice vs. Spring):**  
   The current AST analyzer was built for Spring Framework annotations (`@RestController`, `@Service`, `@Repository`, `@Autowired`). Maven relies on Plexus (`@Component`, `@Requirement`) and JSR-330 / Sisu (`@Named`, `@Inject`). Consequently, **39.0% of components are classified as `Other`**, and cross-module dependency injection channels cannot be represented.
4. **Computational Tractability:**  
   Analyzing Maven’s 3,280 Java files took **387.89 seconds (6.46 minutes)** for a single graph. Reconstructing pre-change parent worktrees for 26 commits would require $\approx 2.8$ hours of continuous CPU execution.

**Verdict:** **NO-GO.** The evaluation was halted before model scoring to preserve scientific integrity. Adapting the protocol or altering the analyzer would violate the strict constraint prohibiting core algorithm and configuration modifications.

---

## 2. Git History & Dataset Suitability Metrics

A complete Git history inspection of `C:\yashika\STUDY\clg_project\maven` was conducted:

| Metric | Measured Value | Analysis & Implication |
| :--- | :--- | :--- |
| **Total Git Commits** | **16,582** | Substantial historical depth spanning 18.5+ years (March 2008 to October 2026). |
| **Date Range** | **2008-03-11 to 2026-10-19** | Long-lived mature open-source repository. |
| **Total Merge Commits** | **59 (0.36%)** | Maven uses strict rebase/squash workflows. In the recent 100/200 commits, 0 merge commits occurred. |
| **Total Non-Merge Commits** | **16,523** | Extremely high volume of linear commits. |
| **Prior History Depth** | **16,482 commits** | More than 16,000 historical commits precede commit index 100, providing abundant lookback. |

### Commits Inspected Under Standard Eligibility Protocol (First 100 Commits)
Applying the identical exclusion rules established for PetClinic and Shopizer:

| Classification | Count | Percentage | Description / Impact |
| :--- | :---: | :---: | :--- |
| **Total Inspected** | **100** | 100.0% | Recent commits from HEAD. |
| • `E1_MERGE_COMMIT` | 0 | 0.0% | No merge commits present. |
| • `E2/E3/E4_NO_JAVA` | 45 | 45.0% | Commits touching only `pom.xml`, Jenkinsfiles, docs, site, shell scripts. |
| • `E7_TEST_ONLY` | 10 | 10.0% | Commits modifying test files only; no production components changed. |
| • `E8_SINGLE_NON_TEST` | 19 | 19.0% | Commits with only 1 non-test Java component; cannot split into input + target. |
| • `E9_ROOT_COMMIT` | 0 | 0.0% | No root commits in recent window. |
| **Potentially Eligible Commits** | **26** | **26.0%** | Non-merge commits modifying $\ge 2$ non-test Java files. |

### File Change Distribution in Multi-Java Commits
Across the 26 candidate commits:
- **Minimum non-test Java files changed:** 2
- **Maximum non-test Java files changed:** 45 (refactorings)
- **Median non-test Java files changed:** 4
- **Mean non-test Java files changed:** 5.44
- **Bulk Refactors / Formatting Commits:** Only 1 commit in the recent 200 modified >25 files or was labeled format/clean.
- **Dependency Update Commits:** 5 commits updated dependency declarations.

---

## 3. Maven Source Structure & AST Analyzer Assessment

The current AST analyzer (`backend/src/analyzers/javaAnalyzer.js`) was executed against Maven's current working tree:

### Module Breakdown (3,280 Java Files Total):
- `impl/` (Maven Core Implementation): **1,034 Java files**
- `its/` (Integration Tests & Mock Plugins): **1,242 Java files**
- `compat/` (Maven 2.x Compatibility Layer): **697 Java files**
- `api/` (Maven Core API Specifications): **299 Java files**
- `src/` (Top-level scripts & wrappers): **7 Java files**
- `apache-maven/` (Packaging / Distribution): **1 Java file**

### Execution Profile & Graph Characteristics:
- **Execution Runtime:** **387.89 seconds (6.46 minutes)**
- **Unique Components Registered:** **3,101** (out of 3,280 files; 179 overwritten)
- **Extracted Relationships:** **8,844**

### Component Type Distribution:
| Component Type | Count | Percentage | Assessment |
| :--- | :---: | :---: | :--- |
| **Test** | 1,488 | 48.0% | Tests in `src/test/java` and mock plugins in `its/`. |
| **Other** | 1,210 | 39.0% | Production classes unclassified due to lack of Spring annotations. |
| **Entity/Model** | 187 | 6.0% | Model objects identified via folder/path heuristics. |
| **Repository** | 171 | 5.5% | Artifact / remote repository interfaces (class name match). |
| **Service** | 45 | 1.5% | Classes ending in "Service". |

### Relationship Type Distribution:
- `TESTS`: 3,547 (40.1%)
- `REFERENCES`: 2,969 (33.6%)
- `USES`: 960 (10.9%)
- `IMPLEMENTS`: 563 (6.4%)
- `EXTENDS`: 530 (6.0%)
- `ASSOCIATED_WITH`: 235 (2.7%)
- `DEPENDS_ON`: 40 (0.5%)

---

## 4. Detailed Technical Blockers Preventing Evaluation

### Blocker 1: Windows Filesystem `MAX_PATH` Violation
- **Failure Point:** `historicalGraphService.js` line 125 (`git worktree add`).
- **Mechanism:** Maven's integration test suite contains path structures such as:  
  `its/core-it-suite/src/test/resources/mng-6759-transitive-dependency-repositories/mng6759-plugin-resolves-project-dependencies/src/main/java/org/apache/maven/its/mng6759/plugin/...`
- Combined with the base path `c:\yashika\STUDY\clg_project\software_change\backend\.cache\historical_worktrees\maven_<sha>\`, paths exceed the Windows 260-character `MAX_PATH` limit.
- **Result:** Native Git aborts with `fatal: cannot create directory at '...': Filename too long`.
- Under the evaluation harness, this error triggers exclusion rule `E_HISTORICAL_GRAPH_FAILED`. In a test execution, 100% of candidate commits failed checkout.
- Overcoming this would require altering Git global/local configuration (`git config core.longpaths true`), violating the constraint prohibiting environment/configuration changes.

### Blocker 2: Duplicate FQN Namespace Overwriting
- **Failure Point:** `javaAnalyzer.js` line 451 (`componentsMap.set(comp.id, comp)`).
- **Mechanism:** In multi-module repositories, test resources and submodules reuse identical package declarations. For example:
  - `compat/maven-compat/src/test/java/org/apache/maven/project/EmptyLifecycleBindingsInjector.java`
  - `impl/maven-core/src/test/java/org/apache/maven/project/EmptyLifecycleBindingsInjector.java`
  - `its/core-it-suite/src/test/resources/mng-4091/.../CoreItMojo.java`
  - `its/core-it-support/core-it-plugins/maven-it-plugin-extension1/.../CoreItMojo.java`
- Because `comp.id = packageName.ClassName`, the second file overwrites the first in `componentsMap`.
- **Result:** Exactly **179 components were overwritten and discarded**. Ground truth mapping in `historicalCaseBuilder.js` relies on matching relative file paths to `comp.filePath`. When a production class is overwritten by a mock plugin in `its/`, change detection fails or binds to an irrelevant test mock.

### Blocker 3: Framework Semantic Incompatibility
- `javaAnalyzer.js` infers architectural coupling via Spring annotations (`@Autowired`, `@Service`, etc.).
- Maven components are defined via Plexus XML descriptors and Sisu annotations (`@Named`, `@Singleton`).
- As a result, 39.0% of components are classified as generic `Other`, and crucial multi-hop component-to-component dependencies are absent from the structural baseline graph.

---

## 5. Comparison Across All Evaluated Repositories

| Evaluation Dimension | Spring PetClinic REST | Shopizer | Apache Maven |
| :--- | :---: | :---: | :---: |
| **Architectural Style** | Spring Boot REST Service | Spring / Hibernate Multi-Module | Plexus / Guice CLI Build Tool |
| **Java Files Count** | 104 | 1,388 | **3,280** |
| **AST Analysis Time** | $\approx 1$ second | $\approx 15-20$ seconds | **387.89 seconds (6.5 min)** |
| **Inspected Commits** | 100 | 54 | 100 |
| **Eligible Commits ($K$)** | 8 | 12 | **0 (Halted on Blockers)** |
| **LOO Evaluation Cases** | 57 | 46 | **0 (Halted on Blockers)** |
| **Worktree Checkout** | Clean | Clean | **FAILED (`Filename too long`)** |
| **FQN Collisions** | 0 | 0 | **179 Overwritten Components** |
| **Structural Baseline MAP** | **0.1758** | **0.0432** | N/A (Blocked) |
| **Hist Reranker (V4) MAP** | 0.1651 (-6.09%) | **0.0897 (+107.64%)** | N/A (Blocked) |
| **OCCP (Model B) MAP** | 0.1864 (+6.03%) | 0.0759 (+75.69%) | N/A (Blocked) |
| **OCCP vs V4 Hist Reranker** | OCCP beats V4 by +12.9% | **V4 beats OCCP by +18.2%** | N/A (Blocked) |

---

## 6. Final Recommendations

1. **Do NOT Force Maven Evaluation:**
   - Attempting to force evaluation on Maven without solving the FQN namespace collisions and `MAX_PATH` errors would produce corrupted ground truth and invalid rankings.
2. **Scientific Conclusion on Dataset Diversity:**
   - The framework is currently optimized for single- and multi-module Spring enterprise applications (where FQNs are strictly unique and Spring annotations govern component wiring).
   - Expanding to multi-module CLI/compiler systems like Apache Maven requires:
     1. Updating component identity to include module path prefix (e.g. `impl:org.apache.maven.Project`).
     2. Excluding embedded test resources (`its/core-it-suite/src/test/resources/`) from production AST graphs.
     3. Supporting Plexus/Guice component descriptor extraction.
     4. Enabling Windows Git longpath support in the deployment environment.
3. **Current Active Recommendation:**
   - Continue using the **Canonical Structural Graph Traversal Baseline (Hop 2)** as the default engine.
   - Retain the PetClinic ($K=8$) and Shopizer ($K=12$) benchmarks as the verified, reproducible empirical foundation.
