# Software Change Impact Intelligence Framework 🚀

A web-based framework built as a research prototype to scan a local Java Spring Boot repository, extract components and relationships, represent them in a Software Knowledge Graph, and calculate change impact propagation.

---

## 🏗️ Project Architecture

* `software_change/backend/` — Node.js & Express APIs for parsing Java, connecting to Neo4j, and calculating change impact paths.
* `software_change/frontend/` — React & Vite dashboard displaying visual graphs and change impact reports.
* `spring-petclinic-rest/` — The reference open-source repository used for test analysis (Read-Only).

---

## ⚡ Setup & Run Instructions

### Prerequisites
* **Node.js** (v18.0.0 or higher recommended, verified on v26.4.0)
* **Neo4j Community Edition or Desktop** (Optional, falls back to a high-performance In-Memory graph engine if Neo4j is offline)

---

### Step 1: Run the Backend API

1. Open your terminal in the backend directory:
   ```bash
   cd software_change/backend
   ```
2. Install dependencies (if not already done):
   ```bash
   npm install
   ```
3. Set up the `.env` configuration file in `software_change/backend/.env`:
   ```env
   PORT=5000
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=password
   DEFAULT_REPO_PATH=c:/yashika/STUDY/clg_project/spring-petclinic-rest
   ```
4. Run the static analyzer to generate the intermediate JSON output:
   ```bash
   npm run analyze
   ```
5. Start the backend API server:
   ```bash
   npm start
   ```

*The server will start at `http://localhost:5000` and automatically verify local Neo4j status. If Neo4j is offline, it prints a message and activates the local In-Memory graph engine fallback.*

---

### Step 2: Run the Frontend App

1. Open your terminal in the frontend directory:
   ```bash
   cd software_change/frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite React development server:
   ```bash
   npm run dev
   ```
4. Open the displayed URL in your browser (typically `http://localhost:5173`).

---

## 🔍 How to Perform Impact Analysis

1. Ensure the backend API and frontend dev servers are running.
2. In the dashboard, set the **Repository Path** (defaults to `c:/yashika/STUDY/clg_project/spring-petclinic-rest`) and click **Analyze Repository 🤖**.
3. View the metric cards and the **Interactive Knowledge Graph** showing all extracted classes.
4. **Select changed components**:
   * Click on nodes directly in the graph (selected nodes glow red 🔴).
   * Or search and select from the list in the sidebar.
5. The **Potential Impact Report** is computed in real-time, displaying:
   * **High Impact 🔴** (Direct incoming dependencies and test suites)
   * **Medium Impact 🟡** (Direct outgoing dependencies)
   * **Low Impact 🔵** (Indirect 2-hop dependencies)
6. Read the exact reasoning explanation and trace the highlighted paths on the interactive graph!
