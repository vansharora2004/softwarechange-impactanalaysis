import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { analyzeRepository } from '../analyzers/javaAnalyzer.js';
import { clearGraph, storeGraph, verifyConnection, getAllComponents, getAllRelationships } from '../services/neo4jService.js';
import { analyzeImpact } from '../services/impactEngine.js';
import { validateRepository, getAvailableExampleRepositories, normalizeRepoPath } from '../services/repoValidation.js';

const execAsync = util.promisify(exec);

const router = express.Router();

// Helper to get local JSON filepath
const getJsonFilePath = () => path.join(import.meta.dirname || '.', '../../analysis_output.json');

/**
 * Validate a local repository path before analysis.
 */
router.post('/validate-repository', (req, res) => {
  const repoPath = req.body?.repoPath;
  const result = validateRepository(repoPath);
  if (!result.valid) {
    return res.status(400).json({ success: false, ...result });
  }
  res.json({ success: true, ...result });
});

/**
 * Get system-discovered preset example repositories.
 */
router.get('/example-repositories', (req, res) => {
  const examples = getAvailableExampleRepositories();
  res.json({ success: true, examples });
});

/**
 * Get active/currently analyzed repository info.
 */
router.get('/current-repository', (req, res) => {
  const jsonPath = getJsonFilePath();
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (data.repoPath && data.projectName) {
        return res.json({
          success: true,
          repoPath: data.repoPath,
          projectName: data.projectName,
          analyzedAt: data.analyzedAt || null,
          componentsCount: data.components?.length || 0,
          relationshipsCount: data.relationships?.length || 0
        });
      }
    } catch {}
  }
  res.json({ success: false, repoPath: null, projectName: null });
});

/**
 * Endpoint to analyze a local Java / Spring Boot repository.
 * Requires an explicit, valid repoPath. Never silently substitutes PetClinic.
 */
router.post('/analyse-repository', async (req, res) => {
  const rawRepoPath = req.body?.repoPath;

  if (!rawRepoPath || typeof rawRepoPath !== 'string' || rawRepoPath.trim().length === 0) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_PATH',
      error: 'Please enter a repository path. The path cannot be empty.'
    });
  }

  const validation = validateRepository(rawRepoPath);
  if (!validation.valid) {
    return res.status(400).json({ success: false, ...validation });
  }

  const repoPath = validation.repoPath;
  const projectName = validation.projectName;

  try {
    console.log(`🤖 Starting API Repository Analysis for: ${repoPath} (${projectName})`);
    const result = analyzeRepository(repoPath);

    const outputData = {
      repoPath,
      projectName,
      analyzedAt: new Date().toISOString(),
      components: result.components,
      relationships: result.relationships
    };

    // Save locally to intermediate JSON for fallback and UI retrieval
    fs.writeFileSync(getJsonFilePath(), JSON.stringify(outputData, null, 2), 'utf-8');

    // Attempt Neo4j integration
    const neo4jConnected = await verifyConnection();
    let neo4jSaved = false;
    let neo4jError = null;

    if (neo4jConnected) {
      try {
        await clearGraph(projectName);
        await storeGraph(result, projectName);
        neo4jSaved = true;
      } catch (err) {
        console.error('Failed to save to Neo4j:', err);
        neo4jError = err.message;
      }
    } else {
      console.log('⚠️ Neo4j is offline; skipped Neo4j database sync.');
    }

    res.json({
      success: true,
      repoPath,
      projectName,
      componentsCount: result.components.length,
      relationshipsCount: result.relationships.length,
      neo4jStatus: neo4jConnected ? (neo4jSaved ? 'synchronized' : 'failed') : 'offline',
      neo4jError,
      components: result.components,
      relationships: result.relationships
    });

  } catch (error) {
    console.error('API /analyse-repository Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to get all components (from Neo4j when available, with fallback to JSON).
 */
router.get('/components', async (req, res) => {
  try {
    const isNeo4jOnline = await verifyConnection();
    const requestedProject = req.query.project || (req.query.repoPath ? path.basename(normalizeRepoPath(req.query.repoPath)) : null);

    if (isNeo4jOnline) {
      const components = await getAllComponents(requestedProject);
      if (components && components.length > 0) {
        return res.json({ success: true, components, project: requestedProject });
      }
    }

    // Fallback to local JSON
    const jsonPath = getJsonFilePath();
    if (!fs.existsSync(jsonPath)) {
      return res.json({ success: true, components: [] });
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    // If a specific repoPath is queried, verify whether the local cache matches
    if (req.query.repoPath) {
      const normRequested = normalizeRepoPath(req.query.repoPath);
      if (data.repoPath && normalizeRepoPath(data.repoPath) !== normRequested) {
        const validation = validateRepository(normRequested);
        if (validation.valid) {
          const freshResult = analyzeRepository(validation.repoPath);
          const freshData = {
            repoPath: validation.repoPath,
            projectName: validation.projectName,
            analyzedAt: new Date().toISOString(),
            components: freshResult.components,
            relationships: freshResult.relationships
          };
          fs.writeFileSync(jsonPath, JSON.stringify(freshData, null, 2), 'utf-8');
          return res.json({
            success: true,
            repoPath: validation.repoPath,
            projectName: validation.projectName,
            components: freshResult.components || []
          });
        }
      }
    }

    res.json({
      success: true,
      repoPath: data.repoPath || null,
      projectName: data.projectName || null,
      components: data.components || []
    });
  } catch (error) {
    console.error('API /components Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to get all relationships (from Neo4j including CO_CHANGED_WITH, with fallback to JSON).
 */
router.get('/relationships', async (req, res) => {
  try {
    const isNeo4jOnline = await verifyConnection();
    const requestedProject = req.query.project || (req.query.repoPath ? path.basename(normalizeRepoPath(req.query.repoPath)) : null);

    if (isNeo4jOnline) {
      const relationships = await getAllRelationships(requestedProject);
      if (relationships && relationships.length > 0) {
        return res.json({ success: true, relationships, project: requestedProject });
      }
    }

    // Fallback to local JSON
    const jsonPath = getJsonFilePath();
    if (!fs.existsSync(jsonPath)) {
      return res.json({ success: true, relationships: [] });
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    res.json({
      success: true,
      repoPath: data.repoPath || null,
      projectName: data.projectName || null,
      relationships: data.relationships || []
    });
  } catch (error) {
    console.error('API /relationships Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

import { runLiveEGCPv4, runComparativeImpactAnalysis } from '../services/egcpLiveService.js';
import {
  runThreeWayImpactAnalysis,
  getEvaluationCases,
  runHistoricalEvaluationCase,
  getCoChangeEvidenceForComponent,
  getBenchmarkSummary
} from '../services/threeWayComparisonService.js';
import {
  getRepoEvaluationStatus,
  startRepoEvaluation,
  getRepoEvaluationSummary,
  getRepoEvaluationCases,
  runRepoEvaluationCase
} from '../services/repoEvaluation/repoEvaluationService.js';

/**
 * Change Impact Analysis API with Model Selection.
 * Supported models:
 *   - 'canonical' (default): Deterministic BFS 2-hop structural baseline.
 *   - 'csf': Continuous Score Fusion (OCCP/CSF Frozen Baseline).
 *   - 'egcp_v4': Evolutionary-Graph Change Propagation v4 Combined model.
 *   - 'compare' | 'three_way': Evaluates all 3 models on identical candidate universe and outputs alignment.
 *
 * Supports both /analyse-impact and /analyze-impact spellings.
 */
router.post(['/analyse-impact', '/analyze-impact'], async (req, res) => {
  const { changedComponents, model, repoPath: reqRepoPath, editOperation, commitLimit } = req.body;

  if (!changedComponents || !Array.isArray(changedComponents) || changedComponents.length === 0) {
    return res.status(400).json({ success: false, error: 'Please select at least one changed component.' });
  }

  // Resolve repository context
  let repoPath = reqRepoPath;
  let projectName = null;
  if (repoPath) {
    const val = validateRepository(repoPath);
    if (!val.valid) {
      return res.status(400).json({ success: false, ...val });
    }
    repoPath = val.repoPath;
    projectName = val.projectName;
  } else {
    const jsonPath = getJsonFilePath();
    if (fs.existsSync(jsonPath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        if (cached.repoPath) {
          repoPath = cached.repoPath;
          projectName = cached.projectName || path.basename(cached.repoPath);
        }
      } catch {}
    }
  }

  const selectedModel = model || 'canonical';

  try {
    if (selectedModel === 'three_way' || selectedModel === 'compare') {
      const threeWayResult = await runThreeWayImpactAnalysis(changedComponents, { repoPath, editOperation, commitLimit });
      const comp = threeWayResult.comparisonSummary || {};
      comp.commonCount = comp.sharedAllThreeCount || 0;
      comp.promotedCount = (comp.rankShifts || []).filter(r => (r.egcpVsBaselineShift || 0) > 0).length;
      comp.demotedCount = (comp.rankShifts || []).filter(r => (r.egcpVsBaselineShift || 0) < 0).length;
      comp.unchangedCount = (comp.rankShifts || []).filter(r => (r.egcpVsBaselineShift || 0) === 0).length;
      comp.rankDeltas = (comp.rankShifts || []).map(r => ({
        ...r,
        rankShift: r.egcpVsBaselineShift,
        isCommon: true
      }));

      return res.json({
        ...threeWayResult,
        repoPath,
        projectName,
        model: 'compare',
        comparison: comp,
        potentiallyImpactedComponents: threeWayResult.egcpOutput
      });
    }

    if (selectedModel === 'csf') {
      const threeWayResult = await runThreeWayImpactAnalysis(changedComponents, { repoPath, editOperation, commitLimit });
      return res.json({
        success: true,
        repoPath,
        projectName,
        model: 'csf',
        changedComponents,
        potentiallyImpactedComponents: threeWayResult.csfOutput,
        csfOutput: threeWayResult.csfOutput,
        candidateUniverseSize: threeWayResult.candidateUniverseSize,
        evolutionaryStatus: threeWayResult.evolutionaryStatus
      });
    }

    if (selectedModel === 'egcp_v4') {
      const egcpResult = await runLiveEGCPv4(changedComponents, { repoPath, editOperation, commitLimit });
      return res.json({
        success: true,
        repoPath,
        projectName,
        model: 'egcp_v4',
        changedComponents,
        potentiallyImpactedComponents: egcpResult.potentiallyImpactedComponents,
        egcpOutput: egcpResult.potentiallyImpactedComponents,
        candidateUniverseSize: egcpResult.candidateUniverseSize,
        evolutionaryStatus: egcpResult.evolutionaryStatus
      });
    }

    // Default: Canonical Structural Baseline
    const isNeo4jConnected = await verifyConnection();
    const report = await analyzeImpact(changedComponents, { repoPath, project: projectName });
    res.json({
      success: true,
      repoPath,
      projectName,
      model: 'canonical',
      executionMode: isNeo4jConnected ? 'neo4j' : 'in-memory-fallback',
      changedComponents,
      potentiallyImpactedComponents: report,
      baselineOutput: report
    });
  } catch (error) {
    console.error(`API /analyse-impact [${selectedModel}] Error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Dedicated EGCP v4 Endpoint.
 */
router.post('/analyse-impact-egcp', async (req, res) => {
  const { changedComponents, repoPath, editOperation, commitLimit } = req.body;

  if (!changedComponents || !Array.isArray(changedComponents) || changedComponents.length === 0) {
    return res.status(400).json({ success: false, error: 'Please select at least one changed component.' });
  }

  try {
    const egcpResult = await runLiveEGCPv4(changedComponents, { repoPath, editOperation, commitLimit });
    res.json(egcpResult);
  } catch (error) {
    console.error('API /analyse-impact-egcp Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Dedicated Comparative Analysis Endpoint (Canonical Baseline vs EGCP v4).
 */
router.post('/analyse-impact-compare', async (req, res) => {
  const { changedComponents, repoPath, editOperation, commitLimit } = req.body;

  if (!changedComponents || !Array.isArray(changedComponents) || changedComponents.length === 0) {
    return res.status(400).json({ success: false, error: 'Please select at least one changed component.' });
  }

  try {
    const compareResult = await runComparativeImpactAnalysis(changedComponents, { repoPath, editOperation, commitLimit });
    res.json(compareResult);
  } catch (error) {
    console.error('API /analyse-impact-compare Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

import { analyzeContextAwareImpact, MODEL_CONFIG } from '../services/contextAwareImpactAnalyzer.js';

/**
 * Endpoint to analyze Context-Aware change impact.
 */
router.post('/analyze-context-impact', async (req, res) => {
  const { changedComponents } = req.body;

  if (!changedComponents || !Array.isArray(changedComponents) || changedComponents.length === 0) {
    return res.status(400).json({ success: false, error: 'Please select at least one changed component.' });
  }

  try {
    const isNeo4jConnected = await verifyConnection();
    // Run proposed model
    const proposedReport = await analyzeContextAwareImpact(changedComponents);
    
    // Also run baseline for comparison
    const baselineReport = await analyzeImpact(changedComponents);

    res.json({
      success: true,
      executionMode: isNeo4jConnected ? 'neo4j' : 'in-memory-fallback',
      changedComponents,
      baselineOutput: baselineReport,
      contextAwareOutput: proposedReport,
      currentConfig: MODEL_CONFIG
    });
  } catch (error) {
    console.error('API /analyze-context-impact Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

import { detectGitChanges } from '../services/gitChangeDetector.js';

/**
 * Endpoint to detect git changes (Phase 2 reliable change detection).
 * Supports both POST and GET, and aliases /detect-git-uncommitted.
 */
router.all(['/detect-git-changes', '/detect-git-uncommitted'], async (req, res) => {
  const rawRepoPath = req.body?.repoPath || req.query?.repoPath;
  if (!rawRepoPath || typeof rawRepoPath !== 'string' || rawRepoPath.trim().length === 0) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_PATH',
      error: 'Repository path is required for Git change detection. Please enter or select a valid repository.'
    });
  }

  const validation = validateRepository(rawRepoPath);
  if (!validation.valid) {
    return res.status(400).json({ success: false, ...validation });
  }

  const repoPath = validation.repoPath;
  const isUncommitted = req.path.includes('uncommitted');
  const rawMode = req.body?.mode || req.query?.mode;
  const mode = (rawMode === 'local' || rawMode === 'uncommitted' || isUncommitted) ? 'local' : 'commit';

  try {
    let componentsToMap = req.body?.components || null;
    if (!componentsToMap || componentsToMap.length === 0) {
      // Load fallback components for mapping if available
      const jsonPath = getJsonFilePath();
      if (fs.existsSync(jsonPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          componentsToMap = data.components || [];
        } catch {}
      }
    }

    const report = detectGitChanges(repoPath, { mode }, componentsToMap || []);

    if (report.changedFiles.length === 0) {
      return res.json({
        success: true,
        changedFiles: [],
        changes: [],
        mapped: [],
        unmapped: [],
        deleted: [],
        renamed: [],
        message: 'No changes detected.'
      });
    }

    if (report.detailedChanges && !report.changes) {
      report.changes = report.detailedChanges;
    }

    res.json(report);
  } catch (error) {
    console.error('Git detection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

import { analyzeGitHistory } from '../services/gitHistoryAnalyzer.js';
import { getComponentsByProject, storeHistoricalRelationships } from '../services/neo4jService.js';

router.post('/analyse-history', async (req, res) => {
    const { repoPath, commitLimit = 100, components: clientComponents } = req.body;
  
  if (!fs.existsSync(repoPath)) {
    return res.status(400).json({ success: false, error: 'Repository path does not exist.' });
  }

  const gitPath = path.join(repoPath, '.git');
  if (!fs.existsSync(gitPath)) {
    return res.status(400).json({ success: false, error: 'Not a Git repository.' });
  }

  const projectId = path.basename(repoPath);

  try {
    const isNeo4jOnline = await verifyConnection();

    let componentsToMap = clientComponents;
    if (!componentsToMap || componentsToMap.length === 0) {
      if (isNeo4jOnline) {
        componentsToMap = await getComponentsByProject(projectId);
      } else {
        const { analyzeRepository } = await import('../analyzers/javaAnalyzer.js');
        const repoData = await analyzeRepository(repoPath);
        componentsToMap = repoData.components;
      }
    }
    
    // Run the history analyzer
    const analysisResult = await analyzeGitHistory(repoPath, commitLimit, componentsToMap);
    
    // Store relations idempotently if Neo4j is online
    if (isNeo4jOnline) {
      await storeHistoricalRelationships(projectId, analysisResult.allPairs);
    } else {
      console.warn('Neo4j is offline; returning historical analysis in-memory without storing.');
    }
    
    res.json({
      success: true,
      data: analysisResult
    });
  } catch (error) {
    console.error('History Analysis Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/historical-context/:componentId', async (req, res) => {
  const { componentId } = req.params;
  const { projectId } = req.query; // pass repo name via query

  try {
    const isNeo4jOnline = await verifyConnection();
    if (!isNeo4jOnline) {
      return res.status(503).json({ success: false, error: 'Neo4j Database is OFFLINE.' });
    }
    
    // Fetch specifically the CO_CHANGED_WITH links for this component
    // It could be either source or target since we stored it unidirectionally A->B (alphabetical)
    const driver = (await import('../services/neo4jService.js')).getDriver();
    const session = driver.session();
    
    const result = await session.executeRead(tx =>
      tx.run(
        `
        MATCH (a:Component {id: $componentId, project: $projectId})-[r:CO_CHANGED_WITH]-(b:Component)
        RETURN b.id AS targetId, r.count AS count
        ORDER BY r.count DESC
        LIMIT 20
        `,
        { componentId, projectId }
      )
    );
    await session.close();

    const pairs = result.records.map(record => ({
      target: record.get('targetId'),
      count: record.get('count').toNumber()
    }));

    res.json({ success: true, componentId, data: pairs });
  } catch (error) {
    console.error('Historical Context Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Dedicated 3-Way Comparative Analysis Endpoint.
 * Compares:
 *   1. Canonical Structural Baseline
 *   2. Continuous Score Fusion (OCCP/CSF Frozen Baseline)
 *   3. EGCP v4 Combined
 */
router.post('/analyse-impact-three-way', async (req, res) => {
  const { changedComponents, repoPath, editOperation, commitLimit } = req.body;

  if (!changedComponents || !Array.isArray(changedComponents) || changedComponents.length === 0) {
    return res.status(400).json({ success: false, error: 'Please select at least one changed component.' });
  }

  try {
    const result = await runThreeWayImpactAnalysis(changedComponents, { repoPath, editOperation, commitLimit });
    res.json(result);
  } catch (error) {
    console.error('API /analyse-impact-three-way Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to list historical benchmark evaluation cases.
 * Supports filters: project, split ('train' | 'test'), search.
 */
router.get('/evaluation/cases', async (req, res) => {
  try {
    const filterOptions = {
      projectName: req.query.project || null,
      split: req.query.split || null,
      search: req.query.search || null
    };
    const casesData = getEvaluationCases(filterOptions);
    res.json(casesData);
  } catch (error) {
    console.error('API /evaluation/cases Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to run a historical evaluation case.
 * Returns:
 *   - Ground truth affected files
 *   - Predictions for Baseline, CSF, EGCP v4
 *   - Verified benchmark metrics
 *   - Worked step-by-step mathematical example
 *   - Unified candidate alignment matrix
 */
router.post('/evaluation/run-case', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, error: 'Please specify a caseId.' });
  }

  try {
    const result = await runHistoricalEvaluationCase(caseId);
    res.json(result);
  } catch (error) {
    console.error(`API /evaluation/run-case [${caseId}] Error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to get historical co-change evidence for a given component.
 */
router.get('/cochange-evidence/:componentId', async (req, res) => {
  const { componentId } = req.params;
  const { repoPath } = req.query;

  try {
    const evidence = getCoChangeEvidenceForComponent(componentId, repoPath);
    res.json(evidence);
  } catch (error) {
    console.error(`API /cochange-evidence [${componentId}] Error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to get macro/micro benchmark summary.
 */
router.get('/benchmark/summary', async (req, res) => {
  try {
    const summary = getBenchmarkSummary();
    res.json(summary);
  } catch (error) {
    console.error('API /benchmark/summary Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Historical leave-one-out evaluation of the analysed repository.
 * Results are stored per repository and HEAD commit; start is a no-op when a stored result exists
 * unless { force: true } is sent.
 */
router.get('/repo-evaluation/status', (req, res) => {
  try {
    res.json(getRepoEvaluationStatus());
  } catch (error) {
    console.error('API /repo-evaluation/status Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/repo-evaluation/start', (req, res) => {
  try {
    const result = startRepoEvaluation({ force: req.body?.force === true });
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error('API /repo-evaluation/start Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/repo-evaluation/summary', (req, res) => {
  try {
    res.json(getRepoEvaluationSummary());
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/repo-evaluation/cases', (req, res) => {
  try {
    res.json(getRepoEvaluationCases({ split: req.query.split || null }));
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/repo-evaluation/run-case', async (req, res) => {
  const { caseId } = req.body || {};
  if (!caseId) {
    return res.status(400).json({ success: false, error: 'Please specify a caseId.' });
  }
  try {
    res.json(await runRepoEvaluationCase(caseId));
  } catch (error) {
    console.error(`API /repo-evaluation/run-case [${caseId}] Error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
