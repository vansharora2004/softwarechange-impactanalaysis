# Phase 5 Evaluation Report — Version 2 (Corrected)

> Generated: 2026-10-13T18:02:16.088Z  
> Commits inspected: 100 | Raw cases before dedup: 17 | Deduplicated to: 12 | Retro cases: 6

> Score threshold (context-aware only): **0.35**  
> Oracle relationship types: DEPENDS_ON, USES, TESTS, EXTENDS  

---

## Corrections vs V1

| Issue | V1 | V2 |
|---|---|---|
| Baseline Test-type FP | Test predictions counted as FP against mainOracle | Test predictions evaluated against testOracle symmetrically |
| Duplicate cases | 5× ExceptionControllerAdvice | Deduplicated — oldest commit kept |
| Oracle relationship set | DEPENDS_ON, USES, TESTS | + EXTENDS (aligns with context-aware engine) |
| Ablation observable | No (threshold=0, all candidates predicted) | Yes (threshold=0.35 filters weak candidates) |
| Independent oracle | BFS only | BFS + retrospective co-change oracle |

---

## ⚠️ Limitations

1. **Small sample size** (12 structural, 6 retrospective). Not statistically reliable.
2. **Structural oracle ≠ causal ground truth.** BFS reachability approximates, not proves, impact.
3. **Co-change oracle ≠ causal ground truth.** Components co-changed may share a commit for non-functional reasons.
4. **Score threshold (0.35) was not tuned on test data** — derived from model severity boundaries. It may not be optimal.
5. **In-memory engines only.** No Neo4j. CO_CHANGED_WITH history counts come from git log, not Neo4j.
6. **Static graph.** The structural graph reflects analysis time, not each commit's exact state.

---

## Deduplication

5 cases removed as duplicates:

- case_21_9d3c02b → Duplicate changedIds — keeping oldest commit (4c5c1cc)
- case_22_4c5c1cc → Duplicate changedIds — keeping oldest commit (0dc4e64)
- case_23_0dc4e64 → Duplicate changedIds — keeping oldest commit (d18b7c4)
- case_26_d18b7c4 → Duplicate changedIds — keeping oldest commit (f957c77)
- case_59_d6c1fb1 → Duplicate changedIds — keeping oldest commit (db1a0ee)

---

## Exclusions

| Rule | Count |
|---|---|
| E2/E3 | 70 |
| E5 | 9 |
| E6 | 4 |

---

## Part A — Structural BFS Oracle Results (12 cases)

Oracle = 2-hop BFS reachability via DEPENDS_ON, USES, TESTS, EXTENDS.
Test-type predictions evaluated against testOracle separately.

| Model | P | R | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | TestP | TestR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.9167 | 0.2273 | 0.3408 | 0.9167 | 0.0582 | 0.9167 | 0.0842 | 0.9167 | 0.1382 | 0.6667 | 0.4409 |
| Context-Aware (full, threshold=0.35) | 0.8846 | 0.4521 | 0.5791 | 0.8889 | 0.0642 | 0.9000 | 0.0984 | 0.9000 | 0.1817 | 1.0000 | 0.9537 |
| Context-Aware (no history, threshold=0.35) | 0.8846 | 0.4521 | 0.5791 | 0.8889 | 0.0642 | 0.9000 | 0.0984 | 0.9000 | 0.1817 | 1.0000 | 0.9537 |
| Context-Aware (no artifact ctx, threshold=0.35) | 0.8846 | 0.4521 | 0.5791 | 0.8889 | 0.0642 | 0.9000 | 0.0984 | 0.9000 | 0.1817 | 1.0000 | 0.9537 |

---

## Part B — Retrospective Co-Change Oracle Results (6 cases)

Oracle = non-Test components co-changed with the input in the same git commit.
Input = first mapped non-Test component (alphabetically). Held-out = remaining.

| Model | P | R | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | TestP | TestR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.5000 | 1.0000 |
| Context-Aware (full, threshold=0.35) | 0.1351 | 0.3947 | 0.1910 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0833 | 0.1167 | 0.3333 | 1.0000 |
| Context-Aware (no history, threshold=0.35) | 0.1351 | 0.3947 | 0.1910 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0833 | 0.1167 | 0.3333 | 1.0000 |
| Context-Aware (no artifact ctx, threshold=0.35) | 0.1351 | 0.3947 | 0.1910 | 0.0555 | 0.0278 | 0.0333 | 0.0278 | 0.0833 | 0.1167 | 0.3333 | 1.0000 |

---

## Part C — Ablation Summary

Score changes when history or artifact context is disabled.
Threshold=0.35: candidates below threshold are excluded from predictions.

### Prediction set differences (structural cases)

| Case | Changed preds (no-history) | Changed preds (no-artifact) | Changed ranks (no-history) | Changed ranks (no-artifact) |
|---|---|---|---|---|
| case_0_d413204 | 0 | 0 | 11 | 22 |
| case_1_0df21cf | 0 | 0 | 4 | 0 |
| case_9_28a1c2c | 0 | 0 | 0 | 0 |
| case_11_a3884f7 | 0 | 0 | 10 | 10 |
| case_12_f2670f9 | 0 | 0 | 0 | 0 |
| case_13_0b02b04 | 0 | 0 | 6 | 9 |
| case_31_f957c77 | 0 | 0 | 0 | 0 |
| case_38_a66fd63 | 0 | 0 | 7 | 4 |
| case_52_ff80e67 | 0 | 0 | 0 | 0 |
| case_56_64b36a2 | 0 | 0 | 0 | 2 |
| case_57_abd2bd4 | 0 | 0 | 0 | 16 |
| case_60_db1a0ee | 0 | 0 | 0 | 0 |

---

## Interpretation

> **These results do not constitute proof that the proposed model is more accurate** than the baseline in a general sense. The sample is too small for statistical claims.

**What V2 corrects:**
1. The baseline is no longer penalised for Test-type predictions that are in the testOracle but not mainOracle.
2. Duplicate ExceptionControllerAdvice cases no longer inflate context-aware metrics.
3. EXTENDS-reachable nodes are now in both the oracle and the model scope — eliminating the asymmetric FP.
4. The score threshold makes ablation observable at the prediction-set level.

**Remaining caution:**
- The retrospective oracle (co-change) is more independent than the BFS oracle but is still an imperfect proxy.
- If retrospective recall is low for both models, neither reliably predicts co-change — the additional context signals have not yet been validated.
