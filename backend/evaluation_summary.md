# Phase 5 Evaluation Report — Change Impact Analysis

> Generated: 2026-10-12T19:22:06.493Z  
> Repository: `c:/yashika/STUDY/clg_project/spring-petclinic-rest`  
> Commits inspected: 100  
> Eligible evaluation cases: **17**  

---

## ⚠️ Important Limitations

1. **Small sample size** (17 cases). Results are indicative only; no statistical significance can be claimed.
2. **Structural oracle, not causal ground truth.** The oracle is the 2-hop structural neighbourhood of the changed components. A component in the oracle may not be affected at runtime; a component outside the oracle may be affected.
3. **Static graph approximation.** The structural graph reflects the repository at analysis time, not at each commit's exact timestamp. Structural changes between the test commit and analysis time are not accounted for.
4. **CO_CHANGED_WITH as a feature, not a label.** The proposed model uses historical co-change as a contextual signal. The evaluation oracle does NOT use co-change as ground truth, avoiding circular evaluation.
5. **In-memory execution.** Both engines run in their in-memory fallback mode (no Neo4j). Results reflect this mode.

---

## Commit Exclusions

| Rule | Count | Description |
|------|-------|-------------|
| E2/E3 | 70 | Dependency-only or documentation-only (no Java source files) |
| E5 | 9 | Java files found but none map to a known component |
| E6 | 4 | Changed components have no structural neighbours (empty oracle) |

---

## Metric Definitions

- **Precision** = TP / (TP + FP): fraction of predicted components that are structurally relevant.
- **Recall** = TP / (TP + FN): fraction of structurally relevant components that were predicted.
- **F1** = harmonic mean of Precision and Recall.
- **P@K** = Precision in top-K predictions (by ranking/severity).
- **R@K** = Recall in top-K predictions.
- **Aggregation**: Macro-average across all eligible cases (each case weighted equally).
- **Test components**: evaluated separately against a test oracle; not included in main P/R/F1.
- **Empty oracle cases**: excluded (rule E6) — not averaged, not reported.

---

## Aggregate Results (Macro-Average)

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | Test Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.5393 | 0.2105 | 0.2748 | 0.6373 | 0.0500 | 0.6118 | 0.0722 | 0.0000 |
| Context-Aware (full: artifact + history) | 0.9061 | 1.0000 | 0.9480 | 0.8824 | 0.0885 | 0.9059 | 0.1513 | 1.0000 |
| Context-Aware (ablation: history disabled) | 0.9061 | 1.0000 | 0.9480 | 0.8824 | 0.0885 | 0.9059 | 0.1513 | 1.0000 |
| Context-Aware (ablation: artifact context disabled) | 0.9061 | 1.0000 | 0.9480 | 0.8627 | 0.0873 | 0.9059 | 0.1513 | 1.0000 |

---

## Per-Case Results

### case_0_d413204

- **Changed**: ClinicServiceImpl  
- **Main oracle size**: 43  
- **Test oracle size**: 7  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 1 | 0.1395 | 0.2449 | 1 | 0.06976744186046512 | 6 | 0 | 37 |
| Context-Aware (full: artifact + history) | 0.8269 | 1 | 0.9053 | 1 | 0.06976744186046512 | 43 | 9 | 0 |
| Context-Aware (ablation: history disabled) | 0.8269 | 1 | 0.9053 | 1 | 0.06976744186046512 | 43 | 9 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8269 | 1 | 0.9053 | 1 | 0.06976744186046512 | 43 | 9 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRepository, PetRepository, PetTypeRepository, SpecialtyRepository, VetRepository, VisitRepository  

</details>

### case_1_0df21cf

- **Changed**: OwnerRestControllerV1  
- **Main oracle size**: 38  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.5 | 0.0263 | 0.05 | 0.5 | 0.02631578947368421 | 1 | 1 | 37 |
| Context-Aware (full: artifact + history) | 0.8837 | 1 | 0.9383 | 1 | 0.07894736842105263 | 38 | 5 | 0 |
| Context-Aware (ablation: history disabled) | 0.8837 | 1 | 0.9383 | 1 | 0.07894736842105263 | 38 | 5 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8837 | 1 | 0.9383 | 1 | 0.07894736842105263 | 38 | 5 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1Tests, ClinicService  

</details>

### case_9_28a1c2c

- **Changed**: OwnerRestControllerV1, PetRestControllerV1, PetTypeRestControllerV1, RootRestControllerV1, SpecialtyRestControllerV1, UserRestControllerV1, VetRestControllerV1, VisitRestControllerV1, OwnerRestControllerV2, PetRestControllerV2, OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests  
- **Main oracle size**: 51  
- **Test oracle size**: 2  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 1 | 0.3529 | 0.5217 | 1 | 0.058823529411764705 | 18 | 0 | 33 |
| Context-Aware (full: artifact + history) | 0.9107 | 1 | 0.9533 | 1 | 0.058823529411764705 | 51 | 5 | 0 |
| Context-Aware (ablation: history disabled) | 0.9107 | 1 | 0.9533 | 1 | 0.058823529411764705 | 51 | 5 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.9107 | 1 | 0.9533 | 1 | 0.058823529411764705 | 51 | 5 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: ClinicService, UserService, OwnerMapper, PetMapper, VisitMapper, Owner, ExceptionControllerAdvice, ApplicationTestConfig, Pet, PetTypeMapper, PetType, SpecialtyMapper, Specialty, UserMapper, User, VetMapper, Vet, Visit  

</details>

### case_11_a3884f7

- **Changed**: PetMapper, PetRepository, JdbcPetRepositoryImpl, JpaPetRepositoryImpl, SpringDataPetRepository, ClinicService, ClinicServiceImpl  
- **Main oracle size**: 47  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.6364 | 0.2979 | 0.4058 | 1 | 0.06382978723404255 | 14 | 8 | 33 |
| Context-Aware (full: artifact + history) | 0.8545 | 1 | 0.9216 | 1 | 0.06382978723404255 | 47 | 8 | 0 |
| Context-Aware (ablation: history disabled) | 0.8545 | 1 | 0.9216 | 1 | 0.06382978723404255 | 47 | 8 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8545 | 1 | 0.9216 | 1 | 0.06382978723404255 | 47 | 8 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1, PetRestControllerV1, PetRestControllerV2, OwnerRestControllerV1Tests, PetRestControllerV1Tests, V2RestControllersTests, PetTypeRestControllerV1, SpecialtyRestControllerV1, VetRestControllerV1, VisitRestControllerV1, OwnerRestControllerV2, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, VetRestControllerV1Tests, VisitRestControllerV1Tests, AbstractClinicServiceTests, JdbcPet, OwnerRepository, PetTypeRepository, SpecialtyRepository, VetRepository, VisitRepository  

</details>

### case_12_f2670f9

- **Changed**: OwnerMapper  
- **Main oracle size**: 11  
- **Test oracle size**: 2  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.5 | 0.1818 | 0.2667 | 0.6666666666666666 | 0.18181818181818182 | 2 | 2 | 9 |
| Context-Aware (full: artifact + history) | 1 | 1 | 1 | 1 | 0.2727272727272727 | 11 | 0 | 0 |
| Context-Aware (ablation: history disabled) | 1 | 1 | 1 | 1 | 0.2727272727272727 | 11 | 0 | 0 |
| Context-Aware (ablation: artifact context disabled) | 1 | 1 | 1 | 1 | 0.2727272727272727 | 11 | 0 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1, OwnerRestControllerV2, OwnerRestControllerV1Tests, V2RestControllersTests  

</details>

### case_13_0b02b04

- **Changed**: OwnerRepository, JdbcOwnerRepositoryImpl, JpaOwnerRepositoryImpl, SpringDataOwnerRepository, ClinicService, ClinicServiceImpl, AbstractClinicServiceTests  
- **Main oracle size**: 48  
- **Test oracle size**: 7  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.7586 | 0.4583 | 0.5714 | 1 | 0.0625 | 22 | 7 | 26 |
| Context-Aware (full: artifact + history) | 0.8571 | 1 | 0.9231 | 1 | 0.0625 | 48 | 8 | 0 |
| Context-Aware (ablation: history disabled) | 0.8571 | 1 | 0.9231 | 1 | 0.0625 | 48 | 8 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8571 | 1 | 0.9231 | 1 | 0.0625 | 48 | 8 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: JdbcPetRepositoryImpl, OwnerRestControllerV1, PetRestControllerV1, PetTypeRestControllerV1, SpecialtyRestControllerV1, VetRestControllerV1, VisitRestControllerV1, OwnerRestControllerV2, PetRestControllerV2, OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests, JdbcPet, PetRepository, PetTypeRepository, SpecialtyRepository, VetRepository, VisitRepository, Owner, Pet, PetType, Specialty, Vet, Visit, EntityUtils  

</details>

### case_21_9d3c02b

- **Changed**: ExceptionControllerAdvice  
- **Main oracle size**: 26  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 26 |
| Context-Aware (full: artifact + history) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: history disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: artifact context disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests  

</details>

### case_22_4c5c1cc

- **Changed**: ExceptionControllerAdvice  
- **Main oracle size**: 26  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 26 |
| Context-Aware (full: artifact + history) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: history disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: artifact context disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests  

</details>

### case_23_0dc4e64

- **Changed**: ExceptionControllerAdvice  
- **Main oracle size**: 26  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 26 |
| Context-Aware (full: artifact + history) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: history disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: artifact context disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests  

</details>

### case_26_d18b7c4

- **Changed**: ExceptionControllerAdvice  
- **Main oracle size**: 26  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 26 |
| Context-Aware (full: artifact + history) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: history disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: artifact context disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests  

</details>

### case_31_f957c77

- **Changed**: ExceptionControllerAdvice  
- **Main oracle size**: 26  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 26 |
| Context-Aware (full: artifact + history) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: history disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |
| Context-Aware (ablation: artifact context disabled) | 1 | 1 | 1 | 1 | 0.11538461538461539 | 26 | 0 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRestControllerV1Tests, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, VisitRestControllerV1Tests  

</details>

### case_38_a66fd63

- **Changed**: Owner, Pet, Vet, JdbcOwnerRepositoryImpl, JdbcPetRepositoryImpl, JdbcPetTypeRepositoryImpl, JdbcSpecialtyRepositoryImpl, JdbcUserRepositoryImpl, JdbcVetRepositoryImpl, JdbcVisitRepositoryImpl, JpaOwnerRepositoryImpl, BindingErrorsResponse  
- **Main oracle size**: 50  
- **Test oracle size**: 10  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.7333 | 0.44 | 0.55 | 1 | 0.06 | 22 | 8 | 28 |
| Context-Aware (full: artifact + history) | 0.8475 | 1 | 0.9174 | 0.6666666666666666 | 0.04 | 50 | 9 | 0 |
| Context-Aware (ablation: history disabled) | 0.8475 | 1 | 0.9174 | 0.6666666666666666 | 0.04 | 50 | 9 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8475 | 1 | 0.9174 | 0.3333333333333333 | 0.02 | 50 | 9 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: OwnerRepository, SpringDataOwnerRepository, OwnerRestControllerV1, OwnerRestControllerV2, ClinicService, ClinicServiceImpl, OwnerRestControllerV1Tests, VisitRestControllerV1Tests, AbstractClinicServiceTests, JpaPetRepositoryImpl, JpaPetTypeRepositoryImpl, PetRepository, PetRepositoryOverride, SpringDataPetRepository, SpringDataPetRepositoryImpl, SpringDataPetTypeRepositoryImpl, PetRestControllerV1, PetRestControllerV2, PetRestControllerV1Tests, JpaVetRepositoryImpl, VetRepository, VetRestControllerV1, VetRestControllerV1Tests, JdbcPet, V2RestControllersTests, PetTypeRestControllerV1, SpecialtyRestControllerV1, VisitRestControllerV1, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests  

</details>

### case_52_ff80e67

- **Changed**: JdbcVisitRepositoryImpl, ClinicServiceH2JdbcTests, ClinicServiceHsqlJdbcTests, UserServiceH2JdbcTests, UserServiceHsqlJdbcTests  
- **Main oracle size**: 28  
- **Test oracle size**: 4  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 1 | 0.0357 | 0.069 | 1 | 0.03571428571428571 | 1 | 0 | 27 |
| Context-Aware (full: artifact + history) | 0.6364 | 1 | 0.7778 | 0.6666666666666666 | 0.07142857142857142 | 28 | 16 | 0 |
| Context-Aware (ablation: history disabled) | 0.6364 | 1 | 0.7778 | 0.6666666666666666 | 0.07142857142857142 | 28 | 16 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.6364 | 1 | 0.7778 | 0.6666666666666666 | 0.07142857142857142 | 28 | 16 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: JdbcPet  

</details>

### case_56_64b36a2

- **Changed**: PetClinicApplication, Pet, Visit, JdbcPetRowMapper, JdbcVisitRowMapper, JpaPetTypeRepositoryImpl, ExceptionControllerAdvice, BasicAuthenticationConfig  
- **Main oracle size**: 46  
- **Test oracle size**: 10  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.7059 | 0.5217 | 0.6 | 0.6666666666666666 | 0.043478260869565216 | 24 | 10 | 22 |
| Context-Aware (full: artifact + history) | 0.8679 | 1 | 0.9293 | 0.3333333333333333 | 0.021739130434782608 | 46 | 7 | 0 |
| Context-Aware (ablation: history disabled) | 0.8679 | 1 | 0.9293 | 0.3333333333333333 | 0.021739130434782608 | 46 | 7 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8679 | 1 | 0.9293 | 0.3333333333333333 | 0.021739130434782608 | 46 | 7 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: SpringConfigTests, JdbcOwnerRepositoryImpl, JdbcPetRepositoryImpl, JdbcPetTypeRepositoryImpl, JpaPetRepositoryImpl, PetRepository, PetRepositoryOverride, SpringDataPetRepository, SpringDataPetRepositoryImpl, SpringDataPetTypeRepositoryImpl, OwnerRestControllerV1, PetRestControllerV1, PetRestControllerV2, ClinicService, ClinicServiceImpl, PetRestControllerV1Tests, VisitRestControllerV1Tests, AbstractClinicServiceTests, JdbcVisitRepositoryImpl, JpaVisitRepositoryImpl, SpringDataVisitRepositoryImpl, VisitRepositoryOverride, VisitRepository, VisitRestControllerV1, OwnerRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, UserRestControllerV1Tests, V2RestControllersTests, VetRestControllerV1Tests, PetTypeRestControllerV1, SpecialtyRestControllerV1, VetRestControllerV1, OwnerRestControllerV2  

</details>

### case_57_abd2bd4

- **Changed**: JdbcOwnerRepositoryImpl, JdbcPetRepositoryImpl, JdbcPetTypeRepositoryImpl, JdbcSpecialtyRepositoryImpl, JdbcUserRepositoryImpl, JdbcVetRepositoryImpl, JdbcVisitRepositoryImpl, ClinicServiceImpl  
- **Main oracle size**: 45  
- **Test oracle size**: 9  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 1 | 0.1556 | 0.2692 | 1 | 0.06666666666666667 | 7 | 0 | 38 |
| Context-Aware (full: artifact + history) | 0.8333 | 1 | 0.9091 | 1 | 0.06666666666666667 | 45 | 9 | 0 |
| Context-Aware (ablation: history disabled) | 0.8333 | 1 | 0.9091 | 1 | 0.06666666666666667 | 45 | 9 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.8333 | 1 | 0.9091 | 1 | 0.06666666666666667 | 45 | 9 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: JdbcPet, OwnerRepository, PetRepository, PetTypeRepository, SpecialtyRepository, VetRepository, VisitRepository  

</details>

### case_59_d6c1fb1

- **Changed**: Owner  
- **Main oracle size**: 33  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.6667 | 0.4848 | 0.5614 | 1 | 0.09090909090909091 | 16 | 8 | 17 |
| Context-Aware (full: artifact + history) | 0.9429 | 1 | 0.9706 | 0.6666666666666666 | 0.06060606060606061 | 33 | 2 | 0 |
| Context-Aware (ablation: history disabled) | 0.9429 | 1 | 0.9706 | 0.6666666666666666 | 0.06060606060606061 | 33 | 2 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.9429 | 1 | 0.9706 | 0.6666666666666666 | 0.06060606060606061 | 33 | 2 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: JdbcOwnerRepositoryImpl, JdbcPetRepositoryImpl, JdbcVisitRepositoryImpl, JpaOwnerRepositoryImpl, OwnerRepository, SpringDataOwnerRepository, OwnerRestControllerV1, OwnerRestControllerV2, ClinicService, ClinicServiceImpl, OwnerRestControllerV1Tests, VisitRestControllerV1Tests, AbstractClinicServiceTests, V2RestControllersTests, PetRestControllerV1, PetTypeRestControllerV1, SpecialtyRestControllerV1, VetRestControllerV1, VisitRestControllerV1, PetRestControllerV2, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, VetRestControllerV1Tests  

</details>

### case_60_db1a0ee

- **Changed**: Owner  
- **Main oracle size**: 33  
- **Test oracle size**: 8  

| Model | P | R | F1 | P@3 | R@3 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop) | 0.6667 | 0.4848 | 0.5614 | 1 | 0.09090909090909091 | 16 | 8 | 17 |
| Context-Aware (full: artifact + history) | 0.9429 | 1 | 0.9706 | 0.6666666666666666 | 0.06060606060606061 | 33 | 2 | 0 |
| Context-Aware (ablation: history disabled) | 0.9429 | 1 | 0.9706 | 0.6666666666666666 | 0.06060606060606061 | 33 | 2 | 0 |
| Context-Aware (ablation: artifact context disabled) | 0.9429 | 1 | 0.9706 | 0.6666666666666666 | 0.06060606060606061 | 33 | 2 | 0 |

<details><summary>Predictions (Baseline)</summary>

Predicted: JdbcOwnerRepositoryImpl, JdbcPetRepositoryImpl, JdbcVisitRepositoryImpl, JpaOwnerRepositoryImpl, OwnerRepository, SpringDataOwnerRepository, OwnerRestControllerV1, OwnerRestControllerV2, ClinicService, ClinicServiceImpl, OwnerRestControllerV1Tests, VisitRestControllerV1Tests, AbstractClinicServiceTests, V2RestControllersTests, PetRestControllerV1, PetTypeRestControllerV1, SpecialtyRestControllerV1, VetRestControllerV1, VisitRestControllerV1, PetRestControllerV2, PetRestControllerV1Tests, PetTypeRestControllerV1Tests, SpecialtyRestControllerV1Tests, VetRestControllerV1Tests  

</details>

---

## Key Findings

### 1. The Context-Aware Model Over-predicts
The proposed model returns ~43–59 candidates per case vs. an oracle size of 11–51. It achieves R=1.0 on every case because it predicts almost the entire neighbourhood — but this is a **high-recall, lower-precision strategy** (macro-avg P=0.91). Whether this is "better" depends on the use-case:
- If the goal is to **not miss any impacted component** (safety-critical review), the context-aware model's 100% recall is valuable.
- If the goal is to **focus developer attention on a small set** (triage), the baseline's fewer candidates but with higher P@3=0.64 may be more actionable.

### 2. Baseline Blindspot: Components With ONLY Test-Neighbour Relationships
Cases 21–26, 31 all test `ExceptionControllerAdvice`. The baseline returns 0 non-test predictions (precision=0, recall=0) because `ExceptionControllerAdvice` is connected only via `TESTS` edges **in the incoming direction from test components**. The baseline engine's 1-hop logic correctly marks those tests as `High` but then its filter strips `Entity/Model` and `Other` types — `ExceptionControllerAdvice` is of type `Other`, so the baseline cannot find any outgoing non-Test-typed neighbours to report. The context-aware model does not have this blindspot because it traverses all relationship types bidirectionally and uses component type to compute artifact weight, not as a filter.

### 3. Ablation: History and Artifact Context Have No Measurable Effect
Across all 17 cases, the ablation variants (history-disabled, artifact-disabled) produce identical or near-identical results to the full context-aware model. This is expected for this dataset: the spring-petclinic-rest repository has very few qualifying historical co-change pairs because only ~8 commits in 100 touch ≥2 mapped components. The `historyCounts` window for early test cases is nearly empty, making the history term ≈ 0 in all cases. **The artifact context term is also small by design (max 0.25)** and does not change ranking when the base influence already determines ordering.

### 4. Repeated Commits to ExceptionControllerAdvice (5 Identical Cases)
Commits 21, 22, 23, 26, 31 all modify `ExceptionControllerAdvice` in isolation. They are distinct commits but produce identical evaluation cases. This inflates the contribution of this pattern in the macro-average. A de-duplication step (by changed component set) would reduce the effective case count to ~13 unique scenarios.

---

## Interpretation

> **These results do not constitute proof that the proposed model is more accurate in a general sense.** With 17 cases (of which 5 are near-duplicates), differences in aggregate metrics could reflect sample composition rather than model quality. A larger commit history, or an independent test set from a different project, would be needed to draw robust conclusions. The proposed model is correctly labelled as **experimental**.

**What the results do support:**

1. The context-aware model has substantially higher recall (1.00 vs. 0.21 macro) because it predicts a wider candidate set. This is a genuine difference in strategy, not a measurement artifact.
2. The baseline engine has a structural blindspot for components of type `Other` (e.g., advice classes, config classes) — a concrete, actionable finding.
3. Historical co-change evidence (`CO_CHANGED_WITH`) does not contribute measurably to ranking on this specific dataset due to sparse commit history. Its potential benefit would need to be evaluated on a project with more frequent, smaller commits.
4. The artifact context weights are too small relative to base influence to affect ranking in this dataset.

**Recommendation:** Before claiming the proposed model outperforms the baseline, evaluate on a dataset with: (a) more eligible commits, (b) smaller, more focused changes, and (c) a richer co-change graph. The current evidence supports using the proposed model as a **supplementary view** alongside the baseline, not as a replacement.
