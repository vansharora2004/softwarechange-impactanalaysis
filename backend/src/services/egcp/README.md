# Evolutionary-Graph Change Propagation (EGCP) Service

## Overview
EGCP models how changes propagate across evolving software systems by constructing a unified, multi-relational heterogeneous graph combining:
1. **Compile-time AST structural dependencies** (`EXTENDS`, `IMPLEMENTS`, `USES`, `DEPENDS_ON`, `REFERENCES`, `TESTS`) reconstructed from the pre-change snapshot $c^1$.
2. **Historical evolutionary co-change couplings** mined strictly from commits older than the evaluated commit ($j < c$).

Change impact is scored through a Personalized Random Walk with Restart (Power Iteration), propagating energy from the seed component through both structural and evolutionary pathways.

## Module Layout
- `egcpConfig.js`: Default hyperparameter configuration ($\alpha = 0.5$, $d = 0.85$, $T_{\max} = 30$, $\epsilon = 10^{-6}$).
- `egcpGraphBuilder.js`: Builds heterogeneous adjacency lists and normalizes evolutionary edge weights using Salton's cosine coefficient.
- `egcpPropagation.js`: Closed-loop power iteration engine for personalized diffusion.
- `egcpScorer.js`: Maps stationary distribution to the 2-hop candidate universe with deterministic tie-breaking.
- `egcpModel.js`: Main entry point and ablation variants (`rankModel_EGCP`, `rankModel_EGCP_StructOnly`, `rankModel_EGCP_EvoOnly`, `rankModel_EGCP_Dual`).
- `egcp_design.md`: Full theoretical and mathematical specification.

## Usage Example
```javascript
import { rankModel_EGCP } from './egcpModel.js';

// Given pre-change graph at c^1, structural candidates |C|, and leak-free history:
const ranked = rankModel_EGCP(structuralCandidates, seedId, graph, historyCounts);
```
