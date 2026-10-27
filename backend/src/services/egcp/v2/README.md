# Evolutionary-Graph Change Propagation v2 (EGCP v2)

## 1. Overview & Architectural Improvements

EGCP v2 addresses the core ranking bottlenecks discovered in EGCP v1:
- **In-Degree Hub Discounting:** In large enterprise codebases, omnipresent entities (`MerchantStore`, `Language`, `Customer`) act as probability sinks under standard random walks. EGCP v2 normalizes stationary probabilities by in-degree:
  $$S_{\text{norm}}(u) = \frac{p^*(u)}{(d_{\text{in}}(u) + 1)^\gamma}$$
- **Decoupled Dual-Channel Random Walk:** Instead of forcing structural AST edges and sparse evolutionary co-changes into a single combined transition matrix where structural edges dilute co-change, EGCP v2 propagates structural and evolutionary energy in independent Markov processes, then combines their normalized lifts:
  $$S_{\text{v2}}(u) = \beta \cdot S_{\text{evo-norm}}(u) + (1 - \beta) \cdot S_{\text{struct-norm}}(u)$$
- **Proper Dangling Node Teleportation:** Nodes with zero outgoing edges teleport their remaining mass back into the personalization restart vector $\mathbf{e}_s$.
- **Per-Commit Graph Caching:** Precomputes the commit graph topology and transition structures once per commit, providing a $5\times - 8\times$ reduction in inference latency.

---

## 2. Directory Structure

```
backend/src/services/egcp/v2/
├── egcpV2Config.js       # Default hyperparameters (dampingFactor=0.85, gamma=0.75, beta=0.60)
├── egcpV2GraphBuilder.js # Decoupled multi-relational graph builder & in-degree indexer
├── egcpV2Propagation.js  # Power iteration engine with dangling teleportation and degree discounting
├── egcpV2Scorer.js       # Candidate universe ranker with deterministic tie-breaking
├── egcpV2Model.js        # Main entry points: rankModel_EGCP_v2 and ablations
└── README.md             # This documentation
```

---

## 3. Hyperparameters & Defaults

| Parameter | Default | Range | Description |
| :--- | :---: | :---: | :--- |
| `dampingFactor` | `0.85` | `[0.70, 0.95]` | Probability of continuing random walk vs. teleporting back to seed. |
| `degreeDiscountExponent` ($\gamma$) | `0.75` | `[0.0, 1.0]` | Sublinear exponent penalizing high in-degree hub nodes. |
| `channelMixingBeta` ($\beta$) | `0.60` | `[0.0, 1.0]` | Weight allocated to evolutionary lift vs. structural lift. |
| `reverseEdgeWeightFactor` | `0.35` | `[0.0, 0.5]` | Backward transition scale for caller propagation. |
| `maxIterations` | `50` | `[20, 100]` | Maximum power iteration steps. |
| `convergenceTolerance` | `1e-4` | `[1e-6, 1e-3]` | $L_1$ norm stopping threshold. |
