# Temporal Point-in-Time Retrospective Evaluation Report (Zero Leakage)

> Generated: 2026-10-14T19:00:21.819Z  
> Methodology: **Parent-Revision Git Worktree Graph Extraction** (Point-in-Time AST Snapshot)  
> Evaluated Commits: **5** | Total LOO Cases: **44**  
> Pruning threshold: **0.35**  

---

## 1. Commit-Level Macro-Averages (Temporal Point-in-Time)

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop heuristic) | 0.1350 | 0.0546 | 0.0645 | 0.1799 | 0.0475 | 0.1623 | 0.0546 | 0.1410 | 0.0546 | 0.4052 |
| Variant A: Structural-only (threshold=0.35) | 0.2322 | 0.3481 | 0.2523 | 0.2596 | 0.1064 | 0.2414 | 0.1602 | 0.2337 | 0.2546 | 0.6599 |
| Variant B: Structural + History (threshold=0.35) | 0.2322 | 0.3481 | 0.2523 | 0.2596 | 0.1064 | 0.2414 | 0.1602 | 0.2337 | 0.2546 | 0.6599 |
| Structural + Artifact Context (threshold=0.35) | 0.2322 | 0.3481 | 0.2523 | 0.2624 | 0.1084 | 0.2514 | 0.1674 | 0.2374 | 0.2614 | 0.6599 |
| Variant C: Full Context-Aware (threshold=0.35) | 0.2322 | 0.3481 | 0.2523 | 0.2624 | 0.1084 | 0.2514 | 0.1674 | 0.2374 | 0.2614 | 0.6599 |

---

## 2. Temporal Commit Breakdown

### Commit `a3884f7`: "feat(pet): add pagination support for listing pets via REST API"
- Parent Revision: `4020fdb` (102 components, 245 relationships)
- Mapped non-Test components (8): `org.springframework.samples.petclinic.mapper.PetMapper, org.springframework.samples.petclinic.repository.PetRepository, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl, org.springframework.samples.petclinic.repository.jpa.JpaPetRepositoryImpl, org.springframework.samples.petclinic.repository.springdatajpa.SpringDataPetRepository, org.springframework.samples.petclinic.rest.controller.OwnerRestController, org.springframework.samples.petclinic.service.ClinicService, org.springframework.samples.petclinic.service.ClinicServiceImpl`
- LOO cases: 8

### Commit `0b02b04`: "feat(owner): add pagination support for listing owners via REST API"
- Parent Revision: `32d530b` (102 components, 245 relationships)
- Mapped non-Test components (7): `org.springframework.samples.petclinic.repository.OwnerRepository, org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.springdatajpa.SpringDataOwnerRepository, org.springframework.samples.petclinic.rest.controller.OwnerRestController, org.springframework.samples.petclinic.service.ClinicService, org.springframework.samples.petclinic.service.ClinicServiceImpl`
- LOO cases: 7

### Commit `abd2bd4`: "Remove autowired usage and depend solely on constructor-based dependency injection"
- Parent Revision: `6236d30` (97 components, 242 relationships)
- Mapped non-Test components (8): `org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl, org.springframework.samples.petclinic.service.ClinicServiceImpl`
- LOO cases: 8

### Commit `a66fd63`: "Migrate project from Spring Boot 3.5.7 to Spring Boot 4.0 #282"
- Parent Revision: `5030c75` (99 components, 244 relationships)
- Mapped non-Test components (12): `org.springframework.samples.petclinic.model.Owner, org.springframework.samples.petclinic.model.Pet, org.springframework.samples.petclinic.model.Vet, org.springframework.samples.petclinic.repository.jdbc.JdbcOwnerRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcPetTypeRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcSpecialtyRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcUserRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVetRepositoryImpl, org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRepositoryImpl, org.springframework.samples.petclinic.repository.jpa.JpaOwnerRepositoryImpl, org.springframework.samples.petclinic.rest.controller.BindingErrorsResponse`
- LOO cases: 12

### Commit `64b36a2`: "Remove unused imports"
- Parent Revision: `abd2bd4` (97 components, 242 relationships)
- Mapped non-Test components (9): `org.springframework.samples.petclinic.PetClinicApplication, org.springframework.samples.petclinic.model.Pet, org.springframework.samples.petclinic.model.Visit, org.springframework.samples.petclinic.repository.jdbc.JdbcPetRowMapper, org.springframework.samples.petclinic.repository.jdbc.JdbcVisitRowMapper, org.springframework.samples.petclinic.repository.jpa.JpaPetTypeRepositoryImpl, org.springframework.samples.petclinic.rest.advice.ExceptionControllerAdvice, org.springframework.samples.petclinic.rest.controller.UserRestController, org.springframework.samples.petclinic.security.BasicAuthenticationConfig`
- LOO cases: 9

