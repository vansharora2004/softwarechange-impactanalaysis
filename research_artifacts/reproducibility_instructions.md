# Reproducibility Instructions

**Project:** Context-Aware Software Change Impact Analysis Framework Using Multi-Layer Software Knowledge Graphs  
**Artifact Directory:** `research_artifacts/`  
**Date:** October 15, 2026  

---

## 1. Environment & Prerequisites

- **Operating System:** Windows 10/11, Linux, or macOS
- **Node.js:** v18.0.0 or higher (v20+ or v26+ recommended; uses ES modules)
- **Git:** 2.30+ installed and on system PATH
- **Neo4j (Optional for live DB testing):** Neo4j Community / Desktop 5.x listening on `bolt://localhost:7687` (Username: `neo4j`, Password configured via `NEO4J_PASSWORD` environment variable).
  *Note: Evaluation harnesses and unit/traversal tests execute completely standalone without requiring a running Neo4j instance.*

---

## 2. Setup & Installation

Navigate to the backend directory and install dependencies:

```bash
cd backend
npm install
```

---

## 3. Running the Test Suites

To execute all 7 test suites (364 passing assertions covering AST analysis, Git change detection, fallback impact engine, live Neo4j end-to-end reliability, structural-historical reranking, graph traversal consistency, and parent-revision graph reconstruction without temporal leakage):

```bash
cd backend
npm test
```

### Individual Test Suites

You can also run individual test suites directly with Node:

```bash
# Parent-revision historical graph reconstruction & leakage prevention (9 assertions)
npm run test:historical
# or: node src/test/historicalGraphTests.js

# Traversal consistency & relationship direction invariants (25 assertions)
node src/test/traversalConsistencyTests.js

# Structural baseline + historical co-change reranker unit tests (40 assertions)
node src/test/rerankerTests.js

# Java AST parser and relationship extraction (30 assertions)
node src/test/analyzerTests.js

# Git commit diff parser and change detector (41 assertions)
node src/test/gitChangeDetectorTests.js

# In-memory baseline and context-aware impact engine (192 assertions)
node src/test/engineTests.js

# Live Neo4j end-to-end query verification (27 assertions - requires running Neo4j)
node src/test/endToEndReliabilityTests.js
```

---

## 4. Reproducing the Empirical Evaluation

### 4.1 Pre-Change Historical Evaluation (Recommended — Leak-Free)
This evaluation reconstructs the structural knowledge graph at the exact parent revision $C^1$ for each evaluated commit $C$ using isolated Git worktrees, ensuring zero future-commit leakage in both graph structure and co-change history:

```bash
cd backend
npm run eval:historical
```

#### Output Files Generated:
- `backend/historical_reranker_evaluation_results.json`: Full metric breakdown across all commits and cases for both repositories using parent graphs.
- `backend/historical_hop_sensitivity_results.json`: Summary table comparing 1-hop, 2-hop, and 3-hop traversal on historical graphs.
- `backend/historical_reranker_evaluation_report.md`: Markdown summary of the historical evaluation findings.
- Copied automatically to `research_artifacts/historical_*`.

### 4.2 Legacy HEAD-Based Evaluation (Reference)
To reproduce the legacy evaluation conducted against the static current HEAD graph:

```bash
cd backend
npm run eval:reranker
```

---

## 5. Running the Application & Live API Verification

### 5.1 Start Backend Server
```bash
cd backend
npm start
```
The server will start on port `5000` (or `PORT` specified in environment).

### 5.2 Start Frontend Client
In a separate terminal:
```bash
cd frontend
npm start
```
The interactive visualization interface will open at `http://localhost:3000`.

### 5.3 Live API Impact Analysis Query
To query the change impact engine directly via HTTP:

```bash
# In PowerShell:
Invoke-RestMethod -Uri "http://localhost:5000/api/impact/analyze" `
  -Method Post `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body (ConvertTo-Json @{
    changedComponents = @("org.springframework.samples.petclinic.service.ClinicServiceImpl")
    depth = 2
  })

# In Bash / curl:
curl -X POST http://localhost:5000/api/impact/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "changedComponents": ["org.springframework.samples.petclinic.service.ClinicServiceImpl"],
    "depth": 2
  }'
```

---

## 6. Structure of Research Artifacts

```
research_artifacts/
├── historical_hop_sensitivity_results.json    # Hop sensitivity (1, 2, 3 hops) on parent-revision graphs
├── historical_reranker_evaluation_report.md   # Markdown summary of parent-revision evaluation
├── historical_reranker_evaluation_results.json# Full LOO evaluation results with pre-change graphs
├── hop_sensitivity_results.json               # Legacy HEAD-based hop sensitivity data
├── methodology_and_evaluation_report.md       # Comprehensive academic evaluation report
├── reproducibility_instructions.md            # Step-by-step reproduction guide (this document)
└── reranker_evaluation_results.json           # Legacy HEAD-based LOO evaluation metrics
```
