import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { analyzeRepository } from '../analyzers/javaAnalyzer.js';
import { clearGraph, storeGraph, verifyConnection, getAllComponents, getAllRelationships } from '../services/neo4jService.js';
import { analyzeImpact } from '../services/impactEngine.js';

const execAsync = util.promisify(exec);

const router = express.Router();
const defaultRepoPath = 'c:/yashika/STUDY/clg_project/spring-petclinic-rest';

// Helper to get local JSON filepath
const getJsonFilePath = () => path.join(import.meta.dirname || '.', '../../analysis_output.json');

/**
 * Endpoint to analyze a local Spring Boot repository.
 */
router.post('/analyse-repository', async (req, res) => {
  const repoPath = req.body.repoPath || defaultRepoPath;

  if (!fs.existsSync(repoPath)) {
    return res.status(400).json({ success: false, error: `Repository path does not exist: ${repoPath}` });
  }

  try {
    console.log(`🤖 Starting API Repository Analysis for: ${repoPath}`);
    const result = analyzeRepository(repoPath);

    // Save locally to intermediate JSON for fallback and UI retrieval
    fs.writeFileSync(getJsonFilePath(), JSON.stringify(result, null, 2), 'utf-8');

    // Attempt Neo4j integration
    const neo4jConnected = await verifyConnection();
    let neo4jSaved = false;
    let neo4jError = null;

    if (neo4jConnected) {
      try {
        const projectName = path.basename(repoPath);
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
    if (isNeo4jOnline) {
      const components = await getAllComponents(req.query.project);
      if (components && components.length > 0) {
        return res.json({ success: true, components });
      }
    }

    // Fallback to local JSON
    const jsonPath = getJsonFilePath();
    if (!fs.existsSync(jsonPath)) {
      return res.json({ success: true, components: [] });
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    res.json({ success: true, components: data.components || [] });
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
    if (isNeo4jOnline) {
      const relationships = await getAllRelationships(req.query.project);
      if (relationships && relationships.length > 0) {
        return res.json({ success: true, relationships });
      }
    }

    // Fallback to local JSON
    const jsonPath = getJsonFilePath();
    if (!fs.existsSync(jsonPath)) {
      return res.json({ success: true, relationships: [] });
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    res.json({ success: true, relationships: data.relationships || [] });
  } catch (error) {
    console.error('API /relationships Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to analyze change impact.
 */
router.post('/analyse-impact', async (req, res) => {
  const { changedComponents } = req.body;

  if (!changedComponents || !Array.isArray(changedComponents) || changedComponents.length === 0) {
    return res.status(400).json({ success: false, error: 'Please select at least one changed component.' });
  }

  try {
    const isNeo4jConnected = await verifyConnection();
    const report = await analyzeImpact(changedComponents);
    res.json({
      success: true,
      executionMode: isNeo4jConnected ? 'neo4j' : 'in-memory-fallback',
      changedComponents,
      potentiallyImpactedComponents: report
    });
  } catch (error) {
    console.error('API /analyse-impact Error:', error);
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
 */
router.post('/detect-git-changes', async (req, res) => {
  const { repoPath, mode, components: clientComponents } = req.body;
  if (!repoPath || !fs.existsSync(repoPath)) {
    return res.status(400).json({ success: false, error: 'Repository path does not exist.' });
  }

  const gitPath = path.join(repoPath, '.git');
  if (!fs.existsSync(gitPath)) {
    return res.status(400).json({ success: false, error: 'Not a Git repository.' });
  }

  if (mode !== 'local' && mode !== 'commit') {
    return res.status(400).json({ success: false, error: 'Invalid mode. Must be "local" or "commit".' });
  }

  try {
    let componentsToMap = clientComponents;
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

export default router;
