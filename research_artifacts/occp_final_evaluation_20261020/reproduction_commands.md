# OCCP Evaluation Reproduction Commands

## Environment Requirements
- **OS:** Windows 10/11
- **Node.js:** v20+ / v26+ (ES Modules enabled)
- **Git:** Available on PATH

## Verification & Execution Commands

### 1. Run Comprehensive Unit Tests (45 assertions)
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/test/occpImprovementTests.js
```

### 2. Execute Full Master Evaluation Across All Three Repositories
```powershell
cd C:\yashika\STUDY\clg_project\software_change\backend
node src/evaluation/v5/finalThreeProjectEvaluator.js
```

### 3. Verify Output Directory
All reports, raw JSON outputs, and CSVs are written to:
`software_change/research_artifacts/occp_final_evaluation_20261020/`
