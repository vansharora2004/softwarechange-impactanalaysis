# Phase 2 Report: Reliable Git Change Detection and Component Mapping

> Completed: 2026-10-14  
> Repository: `c:\yashika\STUDY\clg_project\software_change`  
> Objective: Implement reliable Git change detection and mapping to fully qualified component IDs, ensuring explicit handling of renames, deletions, unmapped files, and merge commits without leaking or perturbing evaluation results.

---

## 1. Executive Summary & Deliverables

1. **New Dedicated Service: `gitChangeDetector.js`**
   - **Path Normalization:** Forward-slash normalization, trim, strip quotes, remove redundant `./` segments.
   - **Component Path Indexing:** O(1) exact mapping, multi-class file awareness with primary class resolution, and explicit ambiguity detection (no blind guessing).
   - **Status Parsing:** Explicit parsing of Added (`A`), Modified (`M`), Deleted (`D`), Renamed (`R`), Copied (`C`), and Untracked (`??`) changes.
   - **Safe Process Invocation:** Uses `execFileSync('git', [...])` with argument vectors, preventing shell-escaping hazards and pipeline delimiter bugs on Windows.
   - **Full Traceability:** Deletions are marked as deletion events (`mappedComponentId: null`, with optional `historicalComponentId`), renames track both old/new paths and identity consistency, and unmapped Java files are isolated with explicit reasons.

2. **Updated Callers:**
   - `gitHistoryAnalyzer.js`: Refactored to use `gitChangeDetector.js`. Tracks merge commits, no-Java commits, deleted files, renamed files, and unmapped files.
   - `caseBuilderV3.js`: Integrated with `gitChangeDetector.js`. Explicitly skips merge commits (`E1_MERGE_COMMIT`) and excludes deletions from active component lists.
   - `api.js`: `/detect-git-changes` route upgraded to use `detectGitChanges`. Preserves `changedFiles: string[]` for backward compatibility with React UI while returning structured change descriptors.

3. **Automated Test Suites:**
   - `backend/src/test/gitChangeDetectorTests.js` (**9 scenarios, 41 assertions, 0 failures**).
   - `backend/src/test/analyzerTests.js` (**17 test suites, 30 assertions, 0 failures**).
   - Total automated checks: **71 assertions passing across both suites**.

---

## 2. Key Design Decisions

### A. Component Identity & Disambiguation
- **FQN Matching:** Components are resolved to their fully-qualified name (e.g., `org.springframework.samples.petclinic.service.ClinicServiceImpl`) rather than simple names.
- **Multi-Class Files:** If a file contains multiple classes (e.g. `Order.java` containing `class Order` and `class OrderItem`), the resolver selects the primary class matching the filename (`Order`), tags the match with `matchType: 'PRIMARY_CLASS_IN_MULTI_CLASS_FILE'`, and lists all candidate IDs. If no primary match exists, it returns `status: 'AMBIGUOUS'` with candidate IDs rather than guessing.
- **Duplicate Simple Names:** Two classes named `User` in `com.pkgA` and `com.pkgB` map strictly to their respective FQNs based on directory path; no cross-package collision is possible.

### B. Deletions and Renames
- **Deleted Files:** Never mapped to active components (`mappedComponentId: null`). Deletion events are tracked in `deleted` and `detailedChanges` with their historical file path and historical component ID (if known).
- **Renamed Files:** Git log `--name-status -M` output `R100\toldPath\tnewPath` is parsed into `oldPath` and `newPath`. The new path is resolved against the active graph (`mappedComponentId`), while the old path is resolved against historical paths. A flag `isSameComponentId` records whether the renaming preserved the component's identifier.

### C. Merge Commits & Ineligible Commits
- Git log format `%P` inspects parent hashes. Any commit with `parents.length > 1` is classified as `isMerge: true`.
- Co-change mining and leave-one-out case generation explicitly exclude merge commits because a merge brings together branch histories rather than representing an atomic co-change.
- Commits with no relevant Java changes (`pom.xml`, documentation, build scripts) are marked with `hasJavaChanges: false` and excluded.

---

## 3. Temporal Leakage Analysis

### Findings
1. **Historical Co-Change Features (Leak-Free):**
   - In `caseBuilderV3.js` and `gitHistoryAnalyzer.js`, co-change counts for an evaluation case at commit index `i` are computed **strictly from historical commits `j > i`** (commits older in time). Future commits are never included in co-change counts.
2. **Structural Graph Limitation (Documented):**
   - The structural graph (`components` and `relationships` from `analysis_output.json`) is an AST snapshot of repository **HEAD**.
   - If a class or relationship was introduced in a later commit between commit `i` and HEAD, it is present in the graph. Conversely, a class deleted before HEAD is absent from the graph and cannot be mapped.
   - Reconstructing full AST snapshots per historical commit would require checking out every commit in the repository working tree, which is outside the scope of static AST extraction.
   - **Mitigation:** The evaluation harness explicitly documents this limitation in its machine-readable metadata (`staticGraphLimitation`) and summary markdown reports. Target components are never provided as model inputs (ensured by the leave-one-out partitioning).

---

## 4. End-to-End Validation (Spring PetClinic)

### Git History Mapping (100 Commits Inspected)
| Metric | Value | Notes |
|---|---|---|
| **Commits Analysed** | 100 | Inspected from PetClinic history |
| **Merge Commits** | 0 | PetClinic uses linear rebased history |
| **Commits with No Java Changes** | 71 | Docs, pom.xml, frontend/docker only |
| **Relevant Commits ($M \ge 2$)** | 8 | Multi-component commits with $\ge 2$ mapped components |
| **Mapped File Events** | 81 | Successfully resolved to graph components |
| **Unmapped Java Files** | 31 | Historical Java files deleted before HEAD |
| **Deleted File Events** | 2 | Explicitly flagged as deletion events |
| **Renamed File Events** | 19 | Successfully tracked old $\to$ new paths |
| **Invalid Component IDs** | **0** | All mapped IDs strictly exist in the graph |

### V3 Leave-One-Out Evaluation Comparison
| Model Variant | Precision | Recall | F1 Score | P@3 | R@3 | Test Recall |
|---|---|---|---|---|---|---|
| **Baseline (structural 2-hop)** | 0.0471 | 0.0301 | 0.0298 | 0.0748 | 0.0239 | 0.6827 |
| **Context-Aware (full, $\theta=0.35$)** | 0.2238 | 0.3567 | 0.2572 | 0.1695 | 0.0812 | 0.8875 |
| **Context-Aware (no history)** | 0.2238 | 0.3567 | 0.2572 | 0.1667 | 0.0789 | 0.8875 |
| **Context-Aware (no artifact ctx)** | 0.2238 | 0.3567 | 0.2572 | 0.1743 | 0.0832 | 0.8875 |

- **Eligible Commits:** Exactly 7 commits.
- **LOO Cases:** Exactly 53 cases.
- **Metric Stability:** Metrics remain consistent with Phase 1 baseline, confirming zero disruption to the evaluation harness while providing verifiable mapping guarantees.

### Shopizer Graph Integrity
- `shopizer_analysis_output.json`: 1,204 components, 5,206 relationships preserved.
- `shopizer_evaluation_results_v3.json`: 13 commits, 1,146 cases preserved.
- `analysis_output.json`: PetClinic graph (105 components, 259 relationships) preserved.

---

## 5. Automated Test Results

### Suite 1: `npm run test:git` (Phase 2 Test Suite)
```
=== Phase 2: Git Change Detection & Component Mapping Test Suite ===

Test 1: Added and modified files map correctly                        ✓ (5 assertions)
Test 2: Deleted files reported as deletion events                     ✓ (5 assertions)
Test 3: Renames preserve old/new paths and map to new component       ✓ (5 assertions)
Test 4: Unmapped and ambiguous files explicitly reported              ✓ (4 assertions)
Test 5: Windows and Unix path normalization                          ✓ (4 assertions)
Test 6: Primary class resolution in multi-class Java file             ✓ (3 assertions)
Test 7: Duplicate simple class names in different packages map to FQN ✓ (3 assertions)
Test 8: Merge commits and commits with no relevant Java changes       ✓ (4 assertions)
Test 9: No invalid or phantom component IDs in LOO cases             ✓ (8 assertions)

=== Phase 2 Results: 41 passed, 0 failed ===
```

### Suite 2: `npm run test:analyzer` (Phase 1 Test Suite)
```
=== javaAnalyzer Regression Tests ===
17 tests covering FQN identity, relationships, and git filters:
=== Results: 30 passed, 0 failed ===
```

### Combined: `npm test`
Runs both suites sequentially with 71 passing assertions.

---

## 6. Exact Reproduction Commands

```bash
cd c:\yashika\STUDY\clg_project\software_change\backend

# 1. Run Phase 2 Git Change Detection & Mapping tests
npm run test:git

# 2. Run Phase 1 Analyzer tests
npm run test:analyzer

# 3. Run combined test suite
npm test

# 4. Run PetClinic V3 evaluation harness
npm run eval:v3

# 5. Verify Shopizer artifacts remain intact
node -e "const fs = require('fs'); console.log('Shopizer:', JSON.parse(fs.readFileSync('shopizer_analysis_output.json')).components.length);"
```
