# Reproducing the Frozen Continuous Score Fusion (CSF) Baseline

**Frozen Baseline:** Continuous Score Fusion (CSF)  
**Implementation Entry Point:** `rankModelB_OCCP_ContinuousFusion` in `backend/src/services/occp_experiments/occpFusionModel.js`  
**Base Commit:** `2d233cf` (Branch: `main`)

---

## Exact Reproduction Commands

All commands are executed from the PowerShell prompt in the `software_change/backend` directory.

### 1. Run Unit Tests (66 passing assertions)
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/test/occpImprovementTests.js
node src/test/occpTests.js
node src/test/apiBaselineContractTests.js
```

### 2. Execute Full 3-Project Retrospective Benchmark ($K=25, N=170$)
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/evaluation/v5/finalThreeProjectEvaluator.js
```

### 3. Recalculate and Verify All Metrics
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/evaluation/v5/runVerification.js
node src/evaluation/v5/calcAccuracyPrecisionRecallF1.js
```

### 4. Expected Output Metrics for Frozen CSF
- Overall Macro MAP: **0.1318**
- Overall Macro MRR: **0.2366**
- Precision@3: **0.1556**, Recall@3: **0.1147**, F1@3: **0.1151**
- Precision@5: **0.1359**, Recall@5: **0.1652**, F1@5: **0.1274**
- Precision@10: **0.0999**, Recall@10: **0.2118**, F1@10: **0.1151**
