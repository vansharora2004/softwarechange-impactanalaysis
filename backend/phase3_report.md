# Phase 3 Report: Impact Engine Correctness and Explainability

> Completed: 2026-10-14  
> Repository: `c:\yashika\STUDY\clg_project\software_change`  
> Objective: Validate baseline and context-aware impact engines, ensure deterministic ranking and traceable explanations, investigate ablation behavior, and verify consistency across test fixtures and production models.

---

## 1. Executive Summary & Deliverables

1. **Baseline Engine Validation (`impactEngine.js`):**
   - **Scope & Direction:** Verified that structural baseline traverses only intended relationship types (`USES`, `DEPENDS_ON`, `TESTS`) within 1 and 2 hops.
   - **Self-Exclusion:** Changed component IDs are never recommended (`a.id IN $changedIds` excluded).
   - **Deduplication:** Multiple paths to the same candidate resolve to the highest impact priority.
   - **Safety & Boundary Handling:** Disconnected components, empty graphs, `null`/`undefined`, and unknown IDs return empty sets safely without throwing unhandled exceptions.
   - **Deterministic Tie-Breaking:** Added secondary tie-breaker `a.name.localeCompare(b.name)` ensuring deterministic output when impact priorities tie.

2. **Context-Aware Engine Validation (`contextAwareImpactAnalyzer.js`):**
   - **2-Hop Traversal in Fallback:** Extended in-memory fallback to support full 1-hop and 2-hop traversals over all valid semantic edges (`DEPENDS_ON`, `USES`, `TESTS`, `IMPLEMENTS`, `EXTENDS`), matching the Neo4j Cypher query and evaluation harness.
   - **Evidence Traceability:** Every recommendation now provides:
     - `id` (FQN) and `displayName` (simple class name).
     - `influenceScore` and deterministic `rank`.
     - `evidenceSources`: explicit list of active evidence sources (`['structural']`, `['structural', 'historical_co_change']`, `['structural', 'artifact_context']`, `['regression_test']`).
     - `evidenceStatus`: transparent reporting of context availability (`{ history: 'available'|'unavailable', artifact: 'available'|'unavailable' }`). Missing context is never fabricated.
     - `primaryReasoningPath` and `allSupportingPaths` linking changed component to target.
   - **Deterministic Ranking:** Added secondary tie-breaker `a.component.localeCompare(b.component)` when influence scores are identical.

3. **Automated Test Suite (`backend/src/test/engineTests.js`):**
   - **12 focused test suites, 192 assertions, 0 failures**.
   - Verified 10 required scenarios: direct dependency, 2-hop dependency, historical co-change boost, artifact context boost, multi-source evidence, disconnected components, empty/invalid input, duplicate edges, missing context, and repeated-run ranking stability.
   - Total automated checks across project: **263 assertions passing** (`npm test`).

---

## 2. Explanation-Path Correctness & Evidence Verification

| Feature | Baseline Engine | Context-Aware Engine |
|---|---|---|
| **Hop 1 Direct Explanation** | `<id> ➔ [DEPENDS_ON] ➔ <source>` | `1-hop path via [DEPENDS_ON] from <source>` |
| **Hop 2 Indirect Explanation** | `<id> ➔ [USES] ➔ <mid> ➔ [DEPENDS_ON] ➔ <source>` | `2-hop path via [DEPENDS_ON, DEPENDS_ON] from <source>` |
| **Regression Test Path** | `<test> ➔ [TESTS] ➔ <source>` (High) | `1-hop path via [TESTS] from <source>` (Score: 1.0, Cat: Regression Tests) |
| **Historical Evidence** | N/A (structural only) | `histCount` recorded, marks `historical_co_change` source only when $count > 0$ |
| **Artifact Context Evidence** | N/A (structural only) | Flow key recorded (e.g. `Repository->Service`), marks `artifact_context` only when weight $> 0$ |
| **Unavailable Evidence** | N/A | Explicitly flagged as `'unavailable'`, not fabricated or assumed |

---

## 3. Context Loading and Ablation Findings

### Investigation: Why Unranked P/R/F1 are Identical while P@K and R@K Differ
In the PetClinic V3 evaluation, macro-averaged unranked metrics are identical across ablations:
- **Full Model:** $P = 0.2238, R = 0.3567, F1 = 0.2572$
- **No-History:** $P = 0.2238, R = 0.3567, F1 = 0.2572$
- **No-Artifact Context:** $P = 0.2238, R = 0.3567, F1 = 0.2572$

However, ranked metrics differ noticeably:
- **P@3:** Full = $0.1695$ vs No-History = $0.1667$ vs No-Artifact = $0.1743$
- **R@3:** Full = $0.0812$ vs No-History = $0.0789$ vs No-Artifact = $0.0832$
- **P@5:** Full = $0.1873$ vs No-History = $0.1856$ vs No-Artifact = $0.1878$
- **R@5:** Full = $0.1418$ vs No-History = $0.1395$ vs No-Artifact = $0.1427$

### Root Cause Analysis (Verified Empirically):
1. **Mathematical Threshold Floor:**
   - The score threshold is $\theta = 0.35$.
   - Any 1-hop structural candidate with `DEPENDS_ON` ($w_{rel}=1.0$) receives base influence $1.0 \times 1.0 = 1.0$.
   - The structural score component alone is $\alpha \times \text{baseInfluence} = 0.7 \times 1.0 = 0.70$.
   - Even if both history and artifact weights are zero, $0.70 \gg 0.35$.
   - Similarly, 1-hop `USES` gives $0.7 \times 0.7 = 0.49 \gg 0.35$.
   - Even 2-hop `DEPENDS_ON` gives $0.7 \times (0.5 \times 1.0) = 0.35$, meeting the threshold on structural grounds alone.
2. **Set vs. Ranking Divergence:**
   - Because structural evidence alone places nearly all graph neighbors above $0.35$, **the unranked candidate set above $\theta$ remains identical** whether history and artifact context are enabled or disabled.
   - However, historical co-change and architectural role flows add $\beta \times \text{contextInfluence}$ ($0.30 \times \text{weight}$), increasing scores for specific components (e.g. from $0.70$ to $0.76$ or $0.85$).
   - This score boost **re-orders candidates within the top ranks**, directly altering P@3, R@3, P@5, and R@5.
3. **Conclusion:** Context features are functioning as intended as **ranking discriminators**, but the coarse threshold-based filtering at $\theta=0.35$ masks their contribution when evaluating unordered sets.

---

## 4. End-to-End Validation: PetClinic V3 Comparison

| Model Variant | Precision | Recall | F1 Score | P@3 | R@3 | P@5 | R@5 | Test Recall |
|---|---|---|---|---|---|---|---|---|
| **Baseline (structural 2-hop)** | 0.0471 | 0.0301 | 0.0298 | 0.0748 | 0.0239 | 0.0673 | 0.0301 | 0.6827 |
| **Context-Aware (full, $\theta=0.35$)** | 0.2238 | 0.3567 | 0.2572 | 0.1695 | 0.0812 | 0.1873 | 0.1418 | 0.8875 |
| **Context-Aware (no history)** | 0.2238 | 0.3567 | 0.2572 | 0.1667 | 0.0789 | 0.1856 | 0.1395 | 0.8875 |
| **Context-Aware (no artifact ctx)** | 0.2238 | 0.3567 | 0.2572 | 0.1743 | 0.0832 | 0.1878 | 0.1427 | 0.8875 |

- **Eligible Commits:** Exactly 7 commits.
- **LOO Cases:** Exactly 53 cases.
- **Metric Stability:** Zero deviation from Phase 1 and Phase 2 baselines, confirming complete backward compatibility.

### Graph Artifact Isolation:
- `analysis_output.json`: PetClinic (105 components, 259 relationships) intact.
- `shopizer_analysis_output.json`: Shopizer (1,204 components, 5,206 relationships) intact.
- `shopizer_evaluation_results_v3.json`: Shopizer evaluation (13 commits, 1,146 cases) intact.

---

## 5. Neo4j & Integration Status

- **Live Neo4j Check:** Database connection check returned `offline` on this execution environment.
- **Validation Approach:** Verified against deterministic synthetic fixtures using the in-memory fallback engine.
- **API Parity:** Both `/analyse-impact` and `/analyze-context-impact` utilize the verified engines, return identical ranking and explanations, and handle offline Neo4j transparently via in-memory execution.

---

## 6. Unresolved Issues & Demo Considerations

1. **Threshold Sensitivity:** The static threshold $\theta=0.35$ acts as a pass-through for 1-hop structural neighbors. For the demo, surfacing top-K ranked recommendations (K=3 or K=5) highlights the impact of context-aware ranking much more clearly than unranked sets.
2. **Neo4j Availability:** When deploying the demo, ensure the Neo4j bolt driver port (7687) is running if graph database visualization is desired; otherwise, in-memory fallback handles all analysis transparently.

---

## 7. Exact Reproduction Commands

```bash
cd c:\yashika\STUDY\clg_project\software_change\backend

# 1. Run Phase 3 Engine Correctness & Explainability tests
npm run test:engine

# 2. Run all project tests (Analyzer + Git + Engine)
npm test

# 3. Run PetClinic V3 evaluation harness
npm run eval:v3

# 4. Verify Shopizer graph preservation
node -e "const fs = require('fs'); console.log('Shopizer components:', JSON.parse(fs.readFileSync('shopizer_analysis_output.json')).components.length);"
```
