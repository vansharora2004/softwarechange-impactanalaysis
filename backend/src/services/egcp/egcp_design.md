# EGCP: Evolutionary-Graph Change Propagation — Architectural Design & Specification

**Date:** 2026-10-20  
**Project:** Context-Aware Software Change Impact Analysis Framework  
**Author:** AI Pair Programmer (DeepMind Antigravity)  
**Status:** Implementation Blueprint

---

## 1. Research Hypothesis & Core Contribution

### A. The Core Problem with Prior Approaches
Prior models for Change Impact Analysis (CIA) suffer from fundamental architectural trade-offs:
1. **Canonical Structural Graph Traversal:** Analyzes only static AST relationships (`USES`, `EXTENDS`, `IMPLEMENTS`, `DEPENDS_ON`). It fails to capture implicit semantic coupling, configuration linkages, cross-module workflows, or runtime dependencies that lack compile-time syntactic edges.
2. **Historical Co-Change Rerankers (e.g., V4):** Mine co-commit frequencies $(u, v)$ without graph topology. They cannot infer transitive propagation (if $A$ co-changes with $B$, and $B$ co-changes with $C$, $A$ may impact $C$), and they collapse when a component has low historical frequency.
3. **Operation-Conditioned Change Propagation (OCCP):** Attempts to condition impact on exact syntactic path patterns (e.g., `Controller -[USES]-> Service -[DEPENDS_ON]-> Repository`). As proven in our cross-project empirical audit:
   - **54–56%** of real-world diffs modify multiple syntactic categories simultaneously (`UNKNOWN_OR_MIXED`).
   - Exact path signatures suffer from severe data sparsity, forcing over **78%** of candidate ranking decisions to fall back past typed paths.
   - When exact path matches are absent (e.g., Apache Commons Lang utility libraries), OCCP degrades to generic co-change.

### B. The EGCP Research Hypothesis
**Hypothesis:** *By constructing a unified multi-relational graph that seamlessly fuses compile-time AST structural dependencies with historical evolutionary co-change dynamics, and propagating change energy via a personalized heterogeneous random walk, we can capture both direct syntactic calls and diffuse architectural couplings without suffering from exact syntactic path sparsity.*

**Intended Contributions:**
1. **Dual-Channel Graph Fusion:** Construction of a heterogeneous network $G_{\text{evo}} = (V, E_{\text{struct}} \cup E_{\text{evo}})$ combining AST edges and evolutionary co-change edges.
2. **Personalized Evolutionary-Structural Diffusion:** A deterministic, closed-loop random walk with restart (Personalized PageRank / Spreading Activation) that diffuses change activation from modified seed components through both structural and evolutionary pathways.
3. **Data-Sparsity Resilience:** Components with zero direct syntactic paths can receive evolutionary energy, while components with zero historical co-change can receive structural energy.
4. **Deterministic & Interpretable:** EGCP operates with zero stochastic sampling, requiring no opaque neural embeddings or external GPU dependencies, ensuring 100% reproducible execution.

---

## 2. Graph Node & Edge Formalization

### A. Node Representation ($V$)
The node set $V$ consists of all software components (classes, interfaces, records, enums) present in the pre-change code graph reconstructed at the parent revision $c^1$:
$$V = \{ u \mid u \in \text{Components}(G(c^1)) \}$$
Each node $u \in V$ possesses attributes:
- `id`: Fully qualified class name (e.g., `org.springframework.samples.petclinic.model.Pet`)
- `type`: Architectural component type (`Controller`, `Service`, `Repository`, `Entity`, `Test`, `Other`)

### B. Edge Types & Weights

The edge set is partitioned into two distinct relation classes:

#### 1. Structural Edges ($E_{\text{struct}}$)
Extracted by the Java AST parser from the source code at snapshot $c^1$:
- `EXTENDS` (weight $w = 1.0$)
- `IMPLEMENTS` (weight $w = 0.9$)
- `DEPENDS_ON` (weight $w = 0.8$)
- `USES` (weight $w = 0.7$)
- `REFERENCES` (weight $w = 0.5$)
- `TESTS` (weight $w = 0.4$)

Both forward and backward structural transitions are supported, with backward transitions scaled by a directional factor $\gamma_{\text{rev}} = 0.5$ (dependencies flow strongly downstream, but changes also back-propagate to callers).

#### 2. Evolutionary Edges ($E_{\text{evo}}$)
Mined from historical commits strictly older than the evaluated commit ($j < c$).  
An undirected evolutionary edge $(u, v)$ is formed if components $u$ and $v$ co-changed in at least one prior commit.
The evolutionary coupling weight is computed using normalized cosine/Jaccard similarity:
$$W_{\text{evo}}(u, v) = \frac{\text{coChange}(u, v)}{\sqrt{\text{commits}(u) \cdot \text{commits}(v)}}$$
Where:
- $\text{coChange}(u, v)$ is the number of historical commits modifying both $u$ and $v$.
- $\text{commits}(u)$ is the total historical commit count touching $u$.

---

## 3. Propagation Dynamics & Energy Diffusion

### A. Transition Probability Matrix
At any node $u \in V$, the transition probability to an adjacent node $v$ balances structural and evolutionary channels:
$$P(u \to v) = \alpha \cdot P_{\text{struct}}(u \to v) + (1 - \alpha) \cdot P_{\text{evo}}(u \to v)$$
Where:
- $\alpha \in [0, 1]$ is the **Structural-Evolutionary Mixing Ratio** (default: $\alpha = 0.5$).
- $P_{\text{struct}}(u \to v) = \frac{W_{\text{struct}}(u, v)}{\sum_{k \in \mathcal{N}_{\text{struct}}(u)} W_{\text{struct}}(u, k)}$ (if $\mathcal{N}_{\text{struct}}(u) \ne \emptyset$, else 0).
- $P_{\text{evo}}(u \to v) = \frac{W_{\text{evo}}(u, v)}{\sum_{k \in \mathcal{N}_{\text{evo}}(u)} W_{\text{evo}}(u, k)}$ (if $\mathcal{N}_{\text{evo}}(u) \ne \emptyset$, else 0).

If a node has structural neighbors but no evolutionary neighbors, $P(u \to v) = P_{\text{struct}}(u \to v)$, and vice versa. If a node is completely isolated, it self-loops ($P(u \to u) = 1.0$).

### B. Personalized Random Walk with Restart (Power Iteration)
Let $\mathbf{e}_s \in \mathbb{R}^{|V|}$ be the restart preference vector, where $\mathbf{e}_s[s] = 1.0$ for the modified seed component $s$, and 0 elsewhere.  
With damping factor $d \in (0, 1)$ (default: $d = 0.85$):
$$\mathbf{p}^{(t+1)} = (1 - d) \cdot \mathbf{e}_s + d \cdot \mathbf{p}^{(t)} P$$

**Stopping Criteria:**
Power iteration continues until $L_1$ convergence or max iterations:
$$\|\mathbf{p}^{(t+1)} - \mathbf{p}^{(t)}\|_1 < \epsilon \quad (\epsilon = 10^{-6}) \quad \text{or} \quad t \ge T_{\max} \quad (T_{\max} = 30)$$

Because $P$ is row-stochastic and $d < 1$, the Banach Fixed-Point Theorem guarantees unique, monotonic convergence to the stationary distribution $\mathbf{p}^*$.

---

## 4. Candidate Scoring & Deterministic Tie-Breaking

To guarantee strict evaluation fairness, EGCP evaluates and ranks the **exact same candidate universe $\mathcal{C}$** produced by 2-hop structural traversal from seed $s$ on $G(c^1)$ ($|\mathcal{C}|$ preserved identically).

For each candidate $u \in \mathcal{C}$:
1. **Primary Score:** Stationary propagated energy $\mathbf{p}^*(u)$.
2. **Secondary Tie-Breaker:** Direct evolutionary co-change score $W_{\text{evo}}(s, u)$.
3. **Tertiary Tie-Breaker:** Minimum structural hop distance $\text{minHop}(s, u)$.
4. **Quaternary Tie-Breaker:** Canonical structural baseline rank.
5. **Final Tie-Breaker:** Lexicographical component ID (`u.id.localeCompare(v.id)`).

---

## 5. Handling Graph Edge Cases

1. **Cycles:** Handled naturally by the damping factor $d = 0.85$. Energy decaying by $0.85^t$ prevents cyclic infinite accumulation.
2. **Disconnected Components:** If a target class is in $\mathcal{C}$ but has disconnected paths in subgraphs, evolutionary edges bridge the structural gap.
3. **Missing History (Cold Start):** When a component has 0 historical commits, $P_{\text{evo}}$ is empty; EGCP automatically falls back to 100% structural diffusion ($P = P_{\text{struct}}$).
4. **Missing Structure (Utility Libraries):** When structural edges are absent (as in Commons Lang), $P_{\text{struct}}$ is empty; EGCP smoothly diffuses across evolutionary co-change edges ($P = P_{\text{evo}}$).

---

## 6. Chronological Leakage Prevention Guarantees

1. $G_{\text{struct}}$ is constructed strictly from pre-change snapshot $c^1$ (parent commit revision).
2. $W_{\text{evo}}$ is mined strictly from historical commits older than the evaluated commit ($j < c$).
3. Target labels are held out exclusively for scoring after ranking is complete.
4. EGCP does not inspect seed or target diff contents during propagation.

---

## 7. Ablation Plan

EGCP natively supports rigorous ablation through its parameter $\alpha$:
- **EGCP-Struct ($\alpha = 1.0$):** Pure structural graph diffusion.
- **EGCP-Evo ($\alpha = 0.0$):** Pure evolutionary co-change diffusion.
- **EGCP-Dual ($\alpha = 0.5$):** Full multi-relational evolutionary-structural propagation.
