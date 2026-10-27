# Exact Reproduction Commands: OCCP Final Verification

**Project:** Software Change Impact Analysis Framework  
**Verification Date:** 2026-10-20  
**Verification Artifact Directory:** `software_change/research_artifacts/occp_final_verification_20261020/`

---

## 1. System & Environment Specifications

- **Operating System:** Windows 11 Pro / Home (x64)
- **Node.js Runtime:** v26.4.0 (or v20+ with ES Module support)
- **Git Version:** 2.40+ (available on system PATH)
- **Primary Repository:** `C:\yashika\STUDY\clg_project\software_change`
- **Evaluation Target Repositories:**
  1. `C:\yashika\STUDY\clg_project\spring-petclinic-rest`
  2. `C:\yashika\STUDY\clg_project\shopizer`
  3. `C:\yashika\STUDY\clg_project\commons-lang`

---

## 2. Step-by-Step Reproduction Sequence

All commands should be executed from the PowerShell prompt in the `software_change/backend` directory.

### Step 1: Run Full Unit & Regression Test Suite (66 Passing Tests)
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/test/occpImprovementTests.js
node src/test/occpTests.js
node src/test/apiBaselineContractTests.js
```
*Expected Output:*
- `occpImprovementTests.js`: 45 passed, 0 failed.
- `occpTests.js`: 16 passed, 0 failed.
- `apiBaselineContractTests.js`: 5 passed, 0 failed (verifies live UI endpoint `/api/analyse-impact` remains canonical structural baseline).

### Step 2: Run Dataset Eligibility Audit (254 Commits Audited)
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/evaluation/v5/runEligibilityAudit.js
```
*Expected Output:*
- Inspects 100 commits from PetClinic (8 eligible), 54 from Shopizer (12 eligible), and 100 from Commons Lang (5 eligible).
- Generates `dataset_eligibility_audit.csv` with 254 audited records.

### Step 3: Run Full Retrospective Evaluation Across All Three Repositories
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/evaluation/v5/finalThreeProjectEvaluator.js
```
*Expected Output:*
- Evaluates 25 independent commits, 170 leave-one-out cases across all 3 projects.
- Populates raw results in `research_artifacts/occp_final_evaluation_20261020/experiment_results.json`.

### Step 4: Run Metric Recalculation & Statistical Verification
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/evaluation/v5/runVerification.js
```
*Expected Output:*
- Verifies 0 candidate alignment violations.
- Computes macro averages across commits, paired $t$-tests, Wilcoxon signed-rank tests, and 95% confidence intervals.
- Generates `verified_metrics_by_project.csv`, `verified_per_commit_metrics.csv`, and `verified_results.json`.

### Step 5: Verify Frontend Client Build Integrity
```powershell
cd C:\yashika\STUDY\clg_project\software_change\frontend
npm run build
```
*Expected Output:*
- Vite builds client production assets in `dist/` with 0 errors.
