# User Interface & End-to-End System Test Matrix

**Project:** Context-Aware Software Change Impact Analysis Framework  
**Location:** `C:\yashika\STUDY\clg_project\software_change`  
**Date:** 2026-10-20  
**Audit Directory:** `software_change/research_artifacts/full_project_audit_20261020/`  

---

## 1. System Architecture & Startup Verification

### 1.1 Startup Commands & Dependencies
- **Backend Startup:**
  - Command: `npm start` (defined in `backend/package.json`, invokes `node src/app.js`).
  - Entry point: `backend/src/app.js` listens on port 5000 (`http://localhost:5000`).
  - CORS Middleware: Configured via `cors()` to accept requests from frontend dev server.
- **Frontend Startup:**
  - Dev Server: `npm run dev` (invokes `vite` on port 5173).
  - Production Build: `npm run build` (invokes `vite build`).
  - **Fresh Build Verification:** Tested synchronously; completed in **489ms** with 0 errors (`dist/index.html`, `dist/assets/index-BhjnOiKe.js` 239.09 kB).
- **Environment & Database Fallback:**
  - Neo4j database status: Gracefully detects offline state via `verifyConnection()`. When offline, all services automatically switch to `executionMode: 'in-memory-fallback'` without throwing uncaught exceptions.

---

## 2. Comprehensive UI Test Matrix

| Test ID | Feature / Component | Inspection Method | Expected Behavior | Observed Result & Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **UI-01** | Frontend Build Pipeline | Executable CLI Build | `npm run build` succeeds without JSX or syntax errors | Built cleanly in 489ms with 0 errors. Transformed 16 modules. | **PASS** |
| **UI-02** | Backend API Contract | Test Runner Execution | Endpoints conform to schema and respond deterministically | `apiBaselineContractTests.js` passed 5/5 tests with 0 failures. | **PASS** |
| **UI-03** | Changed-File Presentation | Static Code Inspection (`App.jsx:180-205, 1228-1240`) | Filename displayed prominently, path beneath it, component ID secondary | Lines 1228–1235 render `fileInfo.fileName` in prominent bold font, `fileInfo.relativePath` in muted text below, and component ID as metadata. | **PASS** |
| **UI-04** | Windows/Unix Path Handling | Static Code Inspection (`App.jsx:180-203`) | Path separators `/` and `\` handled uniformly | `norm = String(p).replace(/\\/g, '/')`, `parts = norm.split('/')` extracts filename across both OS conventions. | **PASS** |
| **UI-05** | Fallback Filename Derivation | Static Code Inspection (`App.jsx:197-200`) | Derives `.java` name from component class ID if path missing | `baseName = componentId.split('.').pop(); fileName = \`${baseName}.java\`` correctly handles bare FQNs. | **PASS** |
| **UI-06** | Impact Analysis Model Invocation | Route & Handler Inspection (`App.jsx:160`, `api.js:127`) | UI invokes Canonical Structural Baseline | Button triggers `POST /api/analyse-impact`, which executes `analyzeImpact` in `impactEngine.js`. | **PASS** |
| **UI-07** | Absence of OCCP / V4 in Live UI | Static Code Inspection (`App.jsx`, `api.js`) | Verify whether experimental models are exposed to UI | Neither OCCP, Model A, nor V4 are exposed in the UI. No model dropdown or toggle exists in `App.jsx`. | **PASS** |
| **UI-08** | Legacy 70/30 Model Dormancy | Static Code Inspection (`App.jsx`) | UI must NOT call legacy 70/30 endpoint | Inspected `App.jsx`: `/api/analyze-context-impact` is never called. Legacy model is dormant dead code. | **PASS** |
| **UI-09** | Graph Visualizer Node Roles | Static Code Inspection (`App.jsx:700-850`) | Graph distinguishes seed, impacted, and intermediate nodes | Nodes styled conditionally: Seed (`#ef4444` red), Impacted (`#3b82f6` blue / severity badge), Intermediate (`#64748b` gray). | **PASS** |
| **UI-10** | Graph Edge Directionality | Static Code Inspection (`App.jsx:820-845`) | Visualizer displays edge arrows and relationship labels | Renders directional arrows with relationship type labels (`DEPENDS_ON`, `USES`, `TESTS`). | **PASS** |
| **UI-11** | Empty State & Error Handling | Code & Contract Inspection | Displays readable error alerts on empty or invalid inputs | Empty changedIds returns HTTP 400 (`Please select at least one changed component`); UI displays clean error alert. | **PASS** |
| **UI-12** | Live Browser Interactive Session | Browser DOM Inspection | Visual layout, click interactivity, CSS overflow | Headless environment: live browser session not spawned in this non-interactive turn. | **NOT VERIFIED** |

---

## 3. UI Architectural Findings & Analysis

1. **Strict Baseline Adherence:**
   The UI is entirely aligned with the **Canonical Structural Baseline**. There is zero deception: the UI does not claim to run OCCP or V4 while executing something else. The Analyze Impact button invokes `/api/analyse-impact`, which is backed strictly by `impactEngine.js`.
2. **Changed-File Presentation Integrity:**
   The UI derives filenames from relative paths using platform-independent normalization. Component IDs are preserved in state for API payloads, while filenames are prioritized visually in the DETECTED CHANGED FILES panel.
3. **Graph State Hygiene:**
   When the user scans a new repository, `setComponents`, `setRelationships`, `setImpactedComponents`, and `setGitDetectedChanges` are systematically reset, preventing stale graph pollution across repository switches.
