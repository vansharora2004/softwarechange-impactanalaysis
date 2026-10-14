# Phase 5 Retrospective Evaluation Report — Version 3 (Leave-One-Out)

> Generated: 2026-10-14T18:23:48.668Z  
> Repository: `spring-petclinic-rest`  
> Commits inspected: **100** | Eligible multi-component commits: **7** | Total LOO cases evaluated: **53**  
> Pruning threshold (context-aware): **0.35**  

---

## 1. Methodology & Experimental Design

- **Leave-One-Out (LOO) Design**: For each eligible commit touching $M \ge 2$ mapped non-Test components, $M$ separate evaluation cases are generated. In each case, exactly 1 component is treated as the changed input, while the remaining $M - 1$ co-changed non-Test components serve as the retrospective target oracle.
- **Separate Regression Test Evaluation**: Test components are partitioned strictly into `testOracle` and evaluated for test recall separately.
- **Two-Level Aggregation**: Cases originating from the same commit are first averaged at the commit level. A macro-average is then computed across independent commits, ensuring multi-component commits do not disproportionately bias the overall score.
- **Leakage Prevention**: Historical co-change features are mined exclusively from commits strictly older than the evaluated commit. Target components and future commits are never visible to the models.

---

## 2. Documented Validity Constraints & Limitations

1. **Static Graph Limitation**: The structural repository graph is static (HEAD snapshot from analysis_output.json). Temporal AST evolution across historical commits is not captured; only historical co-change counts are time-sliced.
2. **Sample Size**: Only **7 commits** in the repository satisfy the criteria ($M \ge 2$ non-Test components). Statistical generalization is not possible with this sample size.
3. **Co-Change as an Imperfect Proxy**: Co-change does not prove functional causality. Parallel refactorings or stylistic adjustments often co-change files that have no functional dependency.
4. **Pruning Threshold**: The threshold of 0.35 is fixed based on architectural severity tiers and was not tuned on the test set.

---

## 3. Commit-Level Macro-Average Results

Averaged first within commits, then across the 7 independent commits:

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop heuristic) | 0.0471 | 0.0301 | 0.0298 | 0.0748 | 0.0239 | 0.0673 | 0.0301 | 0.0528 | 0.0301 | 0.6827 |
| Variant A: Structural-only (threshold=0.35) | 0.2238 | 0.3567 | 0.2572 | 0.1647 | 0.0775 | 0.1899 | 0.1407 | 0.2285 | 0.2806 | 0.8875 |
| Variant B: Structural + History (threshold=0.35) | 0.2238 | 0.3567 | 0.2572 | 0.1743 | 0.0832 | 0.1957 | 0.1465 | 0.2285 | 0.2806 | 0.8875 |
| Structural + Artifact Context (threshold=0.35) | 0.2238 | 0.3567 | 0.2572 | 0.1667 | 0.0789 | 0.1970 | 0.1458 | 0.2347 | 0.2913 | 0.8875 |
| Variant C: Full Context-Aware (threshold=0.35) | 0.2238 | 0.3567 | 0.2572 | 0.1695 | 0.0812 | 0.1987 | 0.1482 | 0.2347 | 0.2913 | 0.8875 |

---

## 4. Breakdown Across Independent Commits

### Commit `28a1c2c`: "refactor(rest): organize controllers by version and split v2 APIs"

- **Mapped non-Test components (10)**: `org.springframework.samples.petclinic.rest.controller.v1.OwnerRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.PetRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.PetTypeRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.RootRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.SpecialtyRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.UserRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.VetRestControllerV1, org.springframework.samples.petclinic.rest.controller.v1.VisitRestControllerV1, org.springframework.samples.petclinic.rest.controller.v2.OwnerRestControllerV2, org.springframework.samples.petclinic.rest.controller.v2.PetRestControllerV2`
- **Mapped Test components (8)**: `org.springframework.samples.petclinic.rest.controller.OwnerRestControllerV1Tests, org.springframework.samples.petclinic.rest.controller.PetRestControllerV1Tests, org.springframework.samples.petclinic.rest.controller.PetTypeRestControllerV1Tests, org.springframework.samples.petclinic.rest.controller.SpecialtyRestControllerV1Tests, org.springframework.samples.petclinic.rest.controller.UserRestControllerV1Tests, org.springframework.samples.petclinic.rest.controller.V2RestControllersTests, org.springframework.samples.petclinic.rest.controller.VetRestControllerV1Tests, org.springframework.samples.petclinic.rest.controller.VisitRestControllerV1Tests`
- **Generated LOO cases**: 10

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.rest.controller.v1.OwnerRestControllerV1` | 0/1 | 7/15 | 7/15 | 7/15 | 0.5833 | 0.5833 | 0.5833 |
| `org.springframework.samples.petclinic.rest.controller.v1.PetRestControllerV1` | 0/1 | 7/11 | 7/11 | 7/11 | 0.7 | 0.7 | 0.7 |
| `org.springframework.samples.petclinic.rest.controller.v1.PetTypeRestControllerV1` | 0/1 | 7/11 | 7/11 | 7/11 | 0.7 | 0.7 | 0.7 |
| `org.springframework.samples.petclinic.rest.controller.v1.RootRestControllerV1` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.rest.controller.v1.SpecialtyRestControllerV1` | 0/1 | 7/11 | 7/11 | 7/11 | 0.7 | 0.7 | 0.7 |
| `org.springframework.samples.petclinic.rest.controller.v1.UserRestControllerV1` | 0/1 | 0/4 | 0/4 | 0/4 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.rest.controller.v1.VetRestControllerV1` | 0/1 | 7/13 | 7/13 | 7/13 | 0.6364 | 0.6364 | 0.6364 |
| `org.springframework.samples.petclinic.rest.controller.v1.VisitRestControllerV1` | 0/1 | 7/11 | 7/11 | 7/11 | 0.7 | 0.7 | 0.7 |
| `org.springframework.samples.petclinic.rest.controller.v2.OwnerRestControllerV2` | 0/1 | 7/11 | 7/11 | 7/11 | 0.7 | 0.7 | 0.7 |
| `org.springframework.samples.petclinic.rest.controller.v2.PetRestControllerV2` | 0/1 | 7/11 | 7/11 | 7/11 | 0.7 | 0.7 | 0.7 |

### Commit `a3884f7`: "feat(pet): add pagination support for listing pets via REST API"

- **Mapped non-Test components (7)**: `org.springframework.samples.petclinic.mapper.PetMapper, org.springframework.samples.petclinic.repository.PetRepository, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl, org.springframework.samples.petclinic.repository.jpa.JpaPetRepositoryImpl, org.springframework.samples.petclinic.repository.springdatajpa.SpringDataPetRepository, org.springframework.samples.petclinic.service.ClinicService, org.springframework.samples.petclinic.service.ClinicServiceImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 7

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.mapper.PetMapper` | 0/3 | 0/3 | 0/3 | 0/3 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.repository.PetRepository` | 1/1 | 5/13 | 5/13 | 5/13 | 0.5263 | 0.5263 | 0.5263 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl` | 0/2 | 4/13 | 4/13 | 4/13 | 0.4211 | 0.4211 | 0.4211 |
| `org.springframework.samples.petclinic.repository.jpa.JpaPetRepositoryImpl` | 0/0 | 4/6 | 4/6 | 4/6 | 0.6667 | 0.6667 | 0.6667 |
| `org.springframework.samples.petclinic.repository.springdatajpa.SpringDataPetRepository` | 0/0 | 4/8 | 4/8 | 4/8 | 0.5714 | 0.5714 | 0.5714 |
| `org.springframework.samples.petclinic.service.ClinicService` | 0/8 | 2/21 | 2/21 | 2/21 | 0.1481 | 0.1481 | 0.1481 |
| `org.springframework.samples.petclinic.service.ClinicServiceImpl` | 1/6 | 5/39 | 5/39 | 5/39 | 0.2222 | 0.2222 | 0.2222 |

### Commit `0b02b04`: "feat(owner): add pagination support for listing owners via REST API"

- **Mapped non-Test components (6)**: `org.springframework.samples.petclinic.repository.OwnerRepository, org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.springdatajpa.SpringDataOwnerRepository, org.springframework.samples.petclinic.service.ClinicService, org.springframework.samples.petclinic.service.ClinicServiceImpl`
- **Mapped Test components (1)**: `org.springframework.samples.petclinic.service.clinicService.AbstractClinicServiceTests`
- **Generated LOO cases**: 6

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.repository.OwnerRepository` | 1/2 | 5/12 | 5/12 | 5/12 | 0.5882 | 0.5882 | 0.5882 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl` | 0/1 | 4/10 | 4/10 | 4/10 | 0.5333 | 0.5333 | 0.5333 |
| `org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl` | 0/0 | 4/6 | 4/6 | 4/6 | 0.7273 | 0.7273 | 0.7273 |
| `org.springframework.samples.petclinic.repository.springdatajpa.SpringDataOwnerRepository` | 0/0 | 4/6 | 4/6 | 4/6 | 0.7273 | 0.7273 | 0.7273 |
| `org.springframework.samples.petclinic.service.ClinicService` | 0/8 | 2/21 | 2/21 | 2/21 | 0.1538 | 0.1538 | 0.1538 |
| `org.springframework.samples.petclinic.service.ClinicServiceImpl` | 1/6 | 5/39 | 5/39 | 5/39 | 0.2273 | 0.2273 | 0.2273 |

### Commit `13789d0`: "Add custom validation for pet birth date and unit tests"

- **Mapped non-Test components (2)**: `org.springframework.samples.petclinic.rest.validation.PetAgeValidation, org.springframework.samples.petclinic.rest.validation.PetAgeValidator`
- **Mapped Test components (1)**: `org.springframework.validation.PetAgeValidatorTest`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.rest.validation.PetAgeValidation` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.rest.validation.PetAgeValidator` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |

### Commit `a66fd63`: "Migrate project from Spring Boot 3.5.7 to Spring Boot 4.0 #282"

- **Mapped non-Test components (12)**: `org.springframework.samples.petclinic.model.Owner, org.springframework.samples.petclinic.model.Pet, org.springframework.samples.petclinic.model.Vet, org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl, org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl, org.springframework.samples.petclinic.rest.controller.BindingErrorsResponse`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 12

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.model.Owner` | 4/16 | 5/13 | 5/13 | 5/13 | 0.4167 | 0.4167 | 0.4167 |
| `org.springframework.samples.petclinic.model.Pet` | 3/20 | 3/20 | 3/20 | 3/20 | 0.1935 | 0.1935 | 0.1935 |
| `org.springframework.samples.petclinic.model.Vet` | 1/13 | 2/9 | 2/9 | 2/9 | 0.2 | 0.2 | 0.2 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl` | 0/1 | 4/10 | 4/10 | 4/10 | 0.381 | 0.381 | 0.381 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl` | 0/2 | 4/13 | 4/13 | 4/13 | 0.3333 | 0.3333 | 0.3333 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl` | 0/0 | 1/7 | 1/7 | 1/7 | 0.1111 | 0.1111 | 0.1111 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl` | 0/0 | 0/5 | 0/5 | 0/5 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl` | 0/0 | 0/6 | 0/6 | 0/6 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl` | 0/0 | 1/6 | 1/6 | 1/6 | 0.1176 | 0.1176 | 0.1176 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl` | 0/1 | 1/8 | 1/8 | 1/8 | 0.1053 | 0.1053 | 0.1053 |
| `org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl` | 0/0 | 3/6 | 3/6 | 3/6 | 0.3529 | 0.3529 | 0.3529 |
| `org.springframework.samples.petclinic.rest.controller.BindingErrorsResponse` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |

### Commit `64b36a2`: "Remove unused imports"

- **Mapped non-Test components (8)**: `org.springframework.samples.petclinic.PetClinicApplication, org.springframework.samples.petclinic.model.Pet, org.springframework.samples.petclinic.model.Visit, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRowMapper, org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRowMapper, org.springframework.samples.petclinic.repository.jpa.JpaPetTypeRepositoryImpl, org.springframework.samples.petclinic.rest.advice.ExceptionControllerAdvice, org.springframework.samples.petclinic.security.BasicAuthenticationConfig`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 8

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.PetClinicApplication` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.model.Pet` | 1/20 | 1/20 | 1/20 | 1/20 | 0.0741 | 0.0741 | 0.0741 |
| `org.springframework.samples.petclinic.model.Visit` | 1/20 | 1/19 | 1/19 | 1/19 | 0.0769 | 0.0769 | 0.0769 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRowMapper` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRowMapper` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.repository.jpa.JpaPetTypeRepositoryImpl` | 0/0 | 2/7 | 2/7 | 2/7 | 0.2857 | 0.2857 | 0.2857 |
| `org.springframework.samples.petclinic.rest.advice.ExceptionControllerAdvice` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.security.BasicAuthenticationConfig` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |

### Commit `abd2bd4`: "Remove autowired usage and depend solely on constructor-based dependency injection"

- **Mapped non-Test components (8)**: `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl, org.springframework.samples.petclinic.service.ClinicServiceImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 8

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl` | 0/1 | 2/10 | 2/10 | 2/10 | 0.2353 | 0.2353 | 0.2353 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl` | 0/2 | 2/13 | 2/13 | 2/13 | 0.2 | 0.2 | 0.2 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl` | 0/0 | 1/7 | 1/7 | 1/7 | 0.1429 | 0.1429 | 0.1429 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl` | 0/0 | 1/5 | 1/5 | 1/5 | 0.1667 | 0.1667 | 0.1667 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl` | 0/0 | 0/6 | 0/6 | 0/6 | 0 | 0 | 0 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl` | 0/0 | 1/6 | 1/6 | 1/6 | 0.1538 | 0.1538 | 0.1538 |
| `org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl` | 0/1 | 1/8 | 1/8 | 1/8 | 0.1333 | 0.1333 | 0.1333 |
| `org.springframework.samples.petclinic.service.ClinicServiceImpl` | 0/6 | 6/39 | 6/39 | 6/39 | 0.2609 | 0.2609 | 0.2609 |

---

## 5. Controlled Ablation Analysis across Variants

Comparison of prediction sets and rank shifts between controlled variants:

| Commit Hash | Input Component | Rank Shifts (B vs A: Hist Effect) | Rank Shifts (C vs B: Art Effect) | Pred Set Changes (Hist) | Pred Set Changes (Art) |
|---|---|---|---|---|---|
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.OwnerRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.PetRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.PetTypeRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.RootRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.SpecialtyRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.UserRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.VetRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v1.VisitRestControllerV1` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v2.OwnerRestControllerV2` | 0 | 0 | 0 | 0 |
| `28a1c2c` | `org.springframework.samples.petclinic.rest.controller.v2.PetRestControllerV2` | 0 | 0 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.mapper.PetMapper` | 0 | 0 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.repository.PetRepository` | 0 | 11 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl` | 4 | 3 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.repository.jpa.JpaPetRepositoryImpl` | 0 | 3 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.repository.springdatajpa.SpringDataPetRepository` | 0 | 4 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.service.ClinicService` | 9 | 9 | 0 | 0 |
| `a3884f7` | `org.springframework.samples.petclinic.service.ClinicServiceImpl` | 12 | 26 | 0 | 0 |
| `0b02b04` | `org.springframework.samples.petclinic.repository.OwnerRepository` | 0 | 11 | 0 | 0 |
| `0b02b04` | `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl` | 2 | 3 | 0 | 0 |
| `0b02b04` | `org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl` | 0 | 4 | 0 | 0 |
| `0b02b04` | `org.springframework.samples.petclinic.repository.springdatajpa.SpringDataOwnerRepository` | 0 | 4 | 0 | 0 |
| `0b02b04` | `org.springframework.samples.petclinic.service.ClinicService` | 0 | 0 | 0 | 0 |
| `0b02b04` | `org.springframework.samples.petclinic.service.ClinicServiceImpl` | 0 | 26 | 0 | 0 |
| `13789d0` | `org.springframework.samples.petclinic.rest.validation.PetAgeValidation` | 0 | 0 | 0 | 0 |
| `13789d0` | `org.springframework.samples.petclinic.rest.validation.PetAgeValidator` | 0 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.model.Owner` | 0 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.model.Pet` | 5 | 2 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.model.Vet` | 0 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl` | 3 | 2 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl` | 5 | 2 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl` | 3 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl` | 3 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl` | 0 | 3 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl` | 3 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl` | 3 | 0 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl` | 0 | 4 | 0 | 0 |
| `a66fd63` | `org.springframework.samples.petclinic.rest.controller.BindingErrorsResponse` | 0 | 0 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.PetClinicApplication` | 0 | 0 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.model.Pet` | 0 | 2 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.model.Visit` | 0 | 0 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRowMapper` | 0 | 0 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRowMapper` | 0 | 0 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.repository.jpa.JpaPetTypeRepositoryImpl` | 0 | 3 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.rest.advice.ExceptionControllerAdvice` | 0 | 0 | 0 | 0 |
| `64b36a2` | `org.springframework.samples.petclinic.security.BasicAuthenticationConfig` | 0 | 0 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl` | 0 | 4 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl` | 0 | 6 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl` | 0 | 3 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl` | 0 | 3 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl` | 0 | 3 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl` | 0 | 3 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl` | 0 | 3 | 0 | 0 |
| `abd2bd4` | `org.springframework.samples.petclinic.service.ClinicServiceImpl` | 0 | 26 | 0 | 0 |

---

## 6. Synthesis & Honest Conclusions

1. **Baseline Directional Limitation Confirmed**: Across the 53 leave-one-out cases, the baseline's strict forward-injection constraint frequently misses peer controllers and implementation classes.
2. **Context-Aware Candidate Breadth**: The context-aware model achieves higher recall by traversing a broader undirected 2-hop radius including `EXTENDS` edges, but precision remains low (~10-15%). Higher candidate counts must not be conflated with proven architectural superiority.
3. **Inconclusive Dataset Size**: With only **7 eligible commits**, the empirical power is insufficient to claim statistical significance. These findings must be reported as preliminary exploratory observations.
