# Reproducibility Guide: Operation-Conditioned Change Propagation (OCCP)

## 1. Repository Information & Target Commits

### Spring PetClinic REST
- **Path:** `c:/yashika/STUDY/clg_project/spring-petclinic-rest`
- **Eligible Commits (8):**
  - `28a1c2c` (Parent: `a3884f7`, Date: 2026-06-12): 9 cases, subject: "refactor(rest): organize controllers by version and split v2 APIs"
  - `a3884f7` (Parent: `4020fdb`, Date: 2026-05-31): 8 cases, subject: "feat(pet): add pagination support for listing pets via REST API"
  - `f2670f9` (Parent: `0b02b04`, Date: 2026-05-23): 2 cases, subject: "refactor(owner): delegate OwnerPageDto conversion to OwnerMapper"
  - `0b02b04` (Parent: `32d530b`, Date: 2026-05-22): 7 cases, subject: "feat(owner): add pagination support for listing owners via REST API"
  - `f957c77` (Parent: `0329768`, Date: 2026-03-06): 2 cases, subject: "Fix #287 hide technical persistence details in pet creation errors"
  - `a66fd63` (Parent: `5030c75`, Date: 2026-02-01): 12 cases, subject: "Migrate project from Spring Boot 3.5.7 to Spring Boot 4.0 #282"
  - `64b36a2` (Parent: `abd2bd4`, Date: 2025-08-12): 9 cases, subject: "Remove unused imports"
  - `abd2bd4` (Parent: `6236d30`, Date: 2025-08-11): 8 cases, subject: "Remove autowired usage and depend solely on constructor-based dependency injection"

### Shopizer
- **Path:** `c:/yashika/STUDY/clg_project/shopizer`
- **Eligible Commits (12):**
  - `a59820c` (Parent: `c36d9ae`, Date: 2024-05-09): 16 cases, subject: "3.2.7 stuff"
  - `60f0fac` (Parent: `672d88f`, Date: 2023-02-26): 2 cases, subject: "end points refactoring"
  - `a158815` (Parent: `30f0004`, Date: 2023-02-26): 2 cases, subject: "end points refactoring"
  - `81b0ade` (Parent: `a2316b7`, Date: 2023-02-21): 6 cases, subject: "category by friendly url"
  - `3f237ee` (Parent: `9f6fc62`, Date: 2023-02-21): 6 cases, subject: "category by friendly url"
  - `a2316b7` (Parent: `dd7ea9e`, Date: 2023-02-04): 2 cases, subject: "Category by friendly url decomplexified"
  - `9f6fc62` (Parent: `1876a7e`, Date: 2023-02-04): 2 cases, subject: "Category by friendly url decomplexified"
  - `2a0c246` (Parent: `f304ca5`, Date: 2023-01-19): 2 cases, subject: "ReadableCategory refactor"
  - `380429c` (Parent: `852b82b`, Date: 2023-01-19): 2 cases, subject: "ReadableCategory refactor"
  - `6b822cb` (Parent: `d008e14`, Date: 2023-01-18): 2 cases, subject: "ProductGroup fix"
  - `b66de14` (Parent: `38ff7d4`, Date: 2023-01-06): 2 cases, subject: "ResourceLoader"
  - `22e94f3` (Parent: `052d2ed`, Date: 2023-01-02): 2 cases, subject: "Category fix"

---

## 2. Execution Commands

To execute the entire OCCP test suite and evaluation pipeline:

```bash
# 1. Run all unit and temporal correctness tests
npm test

# 2. Run dedicated OCCP tests
npm run test:occp

# 3. Run Phase 1 Feasibility Audit
npm run audit:feasibility

# 4. Run Full OCCP Retrospective Evaluation
npm run eval:occp
```

---

## 3. Preserved Artifacts Inventory

The following previous evaluation reports and results are preserved untouched:
- `backend/historical_reranker_evaluation_results.json`
- `backend/historical_hop_sensitivity_results.json`
- `backend/historical_reranker_evaluation_report.md`
- `research_artifacts/historical_reranker_evaluation_results.json`
- `research_artifacts/historical_hop_sensitivity_results.json`
- `research_artifacts/historical_reranker_evaluation_report.md`
- `research_artifacts/historical_audit_and_verification_report.md`
- `research_artifacts/methodology_and_evaluation_report.md`
- `research_artifacts/reproducibility_instructions.md`

All new OCCP data is written strictly to `research_artifacts/occp_v1/`.
