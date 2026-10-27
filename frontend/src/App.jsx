import React, { useState, useEffect, useRef } from 'react';
import BenchmarkDashboard from './BenchmarkDashboard';
import ThreeWayComparisonDashboard from './ThreeWayComparisonDashboard';

const API_BASE = 'http://localhost:5000/api';

export default function App() {
  // Navigation tabs: 'analysis' | 'research'
  const [activeTab, setActiveTab] = useState('analysis');

  // Workflow state
  const [repoPath, setRepoPath] = useState('');
  const [repoAnalyzed, setRepoAnalyzed] = useState(false);
  const [analyzedProjectName, setAnalyzedProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [analyzingImpact, setAnalyzingImpact] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const [exampleRepos, setExampleRepos] = useState([]);

  // Core data states
  const [components, setComponents] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [selectedChanged, setSelectedChanged] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [baselineReport, setBaselineReport] = useState([]);
  const [egcpReport, setEgcpReport] = useState([]);
  const [comparisonData, setComparisonData] = useState(null);
  const [evolutionaryStatus, setEvolutionaryStatus] = useState(null);
  const [selectedModel, setSelectedModel] = useState('canonical'); // 'canonical' | 'egcp_v4' | 'compare'
  const [activeHighlightModel, setActiveHighlightModel] = useState('egcp_v4'); // 'canonical' | 'egcp_v4' for canvas highlight in compare mode
  const [expandedPaths, setExpandedPaths] = useState({});
  const [gitDetectedChanges, setGitDetectedChanges] = useState(null);
  const [isDetectingGit, setIsDetectingGit] = useState(false);

  const activeReport = React.useMemo(() => {
    if (selectedModel === 'egcp_v4') {
      return egcpReport.length > 0 ? egcpReport : baselineReport;
    }
    if (selectedModel === 'compare') {
      return activeHighlightModel === 'egcp_v4'
        ? (egcpReport.length > 0 ? egcpReport : baselineReport)
        : (baselineReport.length > 0 ? baselineReport : egcpReport);
    }
    return baselineReport;
  }, [selectedModel, activeHighlightModel, egcpReport, baselineReport]);

  const togglePathExpand = (id) => {
    setExpandedPaths(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Graph filters
  const [filterTypes, setFilterTypes] = useState(['Controller', 'Service', 'Repository', 'Test', 'Entity/Model']);
  const [filterRels, setFilterRels] = useState(['DEPENDS_ON', 'USES', 'TESTS']);
  const [focusSelectedNeighbor, setFocusSelectedNeighbor] = useState(false);
  const [propagationOnly, setPropagationOnly] = useState(false);
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);
  const [layoutResetTrigger, setLayoutResetTrigger] = useState(0);

  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [commitLimit, setCommitLimit] = useState(100);
  const [componentHistory, setComponentHistory] = useState(null);

  // Fetch component specific historical context
  useEffect(() => {
    const focusNode = selectedGraphNode || (selectedChanged.length === 1 ? selectedChanged[0] : null);
    if (!focusNode || !historyData || !historyData.allPairs) {
      setComponentHistory(null);
      return;
    }
    
    const pairs = historyData.allPairs
      .filter(p => p.source === focusNode || p.target === focusNode)
      .map(p => ({
        target: p.source === focusNode ? p.target : p.source,
        count: p.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
      
    setComponentHistory({ componentId: focusNode, data: pairs });
  }, [selectedGraphNode, selectedChanged, historyData]);

  const handleAnalyzeHistory = async () => {
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const res = await fetch(`${API_BASE}/analyse-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, commitLimit: parseInt(commitLimit, 10), components })
      });
      const data = await res.json();
      if (data.success) {
        setHistoryData(data.data);
        
        const historyRels = data.data.allPairs.map(p => ({
          source: p.source,
          target: p.target,
          type: 'CO_CHANGED_WITH',
          detail: `Count: ${p.count}`
        }));
        
        setRelationships(prev => {
          const structural = prev.filter(r => r.type !== 'CO_CHANGED_WITH');
          return [...structural, ...historyRels];
        });
      } else {
        alert(`Historical analysis failed: ${data.error}`);
      }
    } catch (err) {
      alert(`API Connection Error: ${err.message}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Canvas Force Simulation Refs
  const canvasRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const ticksRef = useRef(0);
  const simulationRef = useRef({
    nodes: [],
    links: [],
    dragNode: null,
    transform: { x: 0, y: 0, scale: 0.8 },
    isPanning: false,
    panStart: { x: 0, y: 0 },
    hoveredNode: null
  });

  // Fetch available example repositories on initial mount (do not auto-analyze PetClinic)
  useEffect(() => {
    let isMounted = true;
    const fetchExamples = async () => {
      try {
        const res = await fetch(`${API_BASE}/example-repositories`);
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.examples)) {
          setExampleRepos(data.examples);
        }
      } catch (err) {
        console.warn('Could not fetch example repositories:', err.message);
      }
    };
    fetchExamples();
    return () => { isMounted = false; };
  }, []);

  // 1. Scan Repository API
  const handleAnalyzeRepo = async (targetPath) => {
    const pathToAnalyze = (typeof targetPath === 'string' && targetPath.trim().length > 0) ? targetPath.trim() : repoPath.trim();
    if (!pathToAnalyze) {
      setValidationError('Please enter or select a repository path. The path cannot be empty.');
      return;
    }

    setValidationError(null);
    setLoading(true);
    setLoadingMessage('Validating repository path and verifying Git configuration...');
    
    // Clear old state completely to prevent stale data
    setBaselineReport([]);
    setEgcpReport([]);
    setComparisonData(null);
    setEvolutionaryStatus(null);
    setSelectedChanged([]);
    setSelectedGraphNode(null);
    setGitDetectedChanges(null);
    setHistoryData(null);

    try {
      setLoadingMessage(`Scanning Java AST structure and dependency graph in "${pathToAnalyze.split(/[\\/]/).pop()}"...`);
      const res = await fetch(`${API_BASE}/analyse-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: pathToAnalyze })
      });
      const data = await res.json();
      if (data.success) {
        setRepoPath(data.repoPath || pathToAnalyze);
        setAnalyzedProjectName(data.projectName || pathToAnalyze.split(/[\\/]/).pop());
        setComponents(data.components || []);
        setRelationships(data.relationships || []);
        setRepoAnalyzed(true);
      } else {
        setValidationError(data.error || 'Failed to analyze repository structure.');
      }
    } catch (err) {
      setValidationError(`Connection Error: Unable to reach backend server at ${API_BASE}. (${err.message})`);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // Reset landing state
  const handleResetRepo = () => {
    setRepoAnalyzed(false);
    setComponents([]);
    setRelationships([]);
    setSelectedChanged([]);
    setBaselineReport([]);
    setEgcpReport([]);
    setComparisonData(null);
    setEvolutionaryStatus(null);
    setSelectedGraphNode(null);
    setGitDetectedChanges(null);
    setHistoryData(null);
    setValidationError(null);
  };

  // Unified Change Impact Analysis Helper with Model Selection
  const runImpactAnalysis = async (seedIds, modelOverride) => {
    if (!seedIds || seedIds.length === 0) {
      setBaselineReport([]);
      setEgcpReport([]);
      setComparisonData(null);
      setEvolutionaryStatus(null);
      return;
    }
    
    const activeModel = (typeof modelOverride === 'string' && modelOverride) ? modelOverride : selectedModel;
    setAnalyzingImpact(true);
    try {
      const res = await fetch(`${API_BASE}/analyse-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changedComponents: seedIds,
          model: activeModel,
          repoPath
        })
      });
      const data = await res.json();
      if (data.success) {
        if (activeModel === 'canonical') {
          const report = data.potentiallyImpactedComponents || data.baselineOutput || [];
          setBaselineReport(report);
          setEgcpReport([]);
          setComparisonData(null);
          setEvolutionaryStatus(null);
        } else if (activeModel === 'egcp_v4') {
          const report = data.potentiallyImpactedComponents || [];
          setEgcpReport(report);
          setBaselineReport([]);
          setComparisonData(null);
          setEvolutionaryStatus(data.evolutionaryStatus || null);
        } else if (activeModel === 'compare') {
          setBaselineReport(data.baselineOutput || []);
          setEgcpReport(data.egcpOutput || []);
          setComparisonData(data.comparison || data || null);
          setEvolutionaryStatus(data.evolutionaryStatus || null);
        }

        if (simulationRef.current) {
          simulationRef.current.alpha = Math.max(simulationRef.current.alpha || 0, 0.6);
        }
      } else {
        alert(`Impact analysis failed: ${data.error}`);
      }
    } catch (err) {
      alert(`API Connection Error: ${err.message}`);
    } finally {
      setAnalyzingImpact(false);
    }
  };

  // 2. Analyze Change Impact API
  const handleAnalyzeImpact = async (modelOverride) => {
    if (selectedChanged.length === 0) return;
    const targetModel = (typeof modelOverride === 'string' && modelOverride) ? modelOverride : selectedModel;
    await runImpactAnalysis(selectedChanged, targetModel);
  };

  // Safely extract filename
  const getFileInfo = (filePath, componentId) => {
    let rawPath = filePath || '';
    const matchedComp = componentId ? components.find(c => c.id === componentId) : null;
    if (!rawPath && matchedComp?.filePath) {
      rawPath = matchedComp.filePath;
    }

    const normPath = rawPath.replace(/\\/g, '/').replace(/^\.?\//, '');
    let fileName = '';
    if (normPath) {
      const parts = normPath.split('/');
      fileName = parts[parts.length - 1] || '';
    }

    if (!fileName && componentId) {
      const baseName = matchedComp?.name || (componentId.includes('.') ? componentId.split('.').pop() : componentId);
      fileName = `${baseName}.java`;
    }

    return {
      fileName: fileName || 'UnknownFile.java',
      relativePath: normPath || (matchedComp?.filePath ? matchedComp.filePath.replace(/\\/g, '/').replace(/^\.?\//, '') : 'Path unavailable'),
      componentId,
      componentType: matchedComp?.type || 'Component'
    };
  };

  const handleDetectGit = async (mode) => {
    setIsDetectingGit(true);
    setGitDetectedChanges(null);
    try {
      const res = await fetch(`${API_BASE}/detect-git-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, mode, components })
      });
      const data = await res.json();
      if (data.success) {
        if (!data.changedFiles || data.changedFiles.length === 0) {
          const emptyMsg = mode === 'commit' 
            ? 'No changed files detected in latest commit.' 
            : 'No uncommitted changes detected.';
          alert(emptyMsg);
          setGitDetectedChanges([]);
        } else {
          const rawItems = (data.detailedChanges && data.detailedChanges.length > 0)
            ? data.detailedChanges
            : (data.mapped && data.mapped.length > 0)
              ? data.mapped
              : (data.changes && data.changes.length > 0)
                ? data.changes
                : (data.changedFiles || []).map(f => ({ filePath: f }));

          const detected = rawItems.map(item => {
            const rawPath = (item.filePath || item.newPath || item.oldPath || '').replace(/\\/g, '/');
            const cleanNormPath = rawPath.replace(/^\.?\//, '').toLowerCase();

            const matchedComp = (item.mappedComponentId ? components.find(c => c.id === item.mappedComponentId) : null) ||
              components.find(c => {
                const compNorm = (c.filePath || '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
                return compNorm && (compNorm === cleanNormPath || compNorm.endsWith(cleanNormPath) || cleanNormPath.endsWith(compNorm));
              });

            const compId = matchedComp ? matchedComp.id : (item.mappedComponentId || null);

            return {
              filePath: rawPath,
              componentId: compId,
              matched: !!compId,
              type: matchedComp?.type || item.componentType || 'Component'
            };
          });

          setGitDetectedChanges(detected);

          const matchedSeeds = Array.from(new Set(
            (data.mappedComponentIds && data.mappedComponentIds.length > 0)
              ? data.mappedComponentIds
              : detected.filter(d => d.matched && d.componentId).map(d => d.componentId)
          ));

          if (mode === 'commit') {
            if (matchedSeeds.length === 0) {
              alert(`Git detected ${detected.length} changed file(s) in latest commit, but none could be mapped to active components in this project.`);
            } else {
              setSelectedChanged(matchedSeeds);
              await runImpactAnalysis(matchedSeeds, selectedModel);
              if (simulationRef.current) {
                simulationRef.current.alpha = Math.max(simulationRef.current.alpha || 0, 0.85);
              }
              setTimeout(() => autoFit(), 250);
            }
          }
        }
      } else {
        alert(`Git Detection Failed: ${data.error}`);
      }
    } catch (err) {
      alert(`API Connection Error: ${err.message}`);
    } finally {
      setIsDetectingGit(false);
    }
  };

  const toggleComponentSelected = (id) => {
    setSelectedChanged(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const clearSelection = () => {
    setSelectedChanged([]);
    setBaselineReport([]);
    setEgcpReport([]);
    setComparisonData(null);
    setEvolutionaryStatus(null);
    setSelectedGraphNode(null);
  };

  const isTypeVisible = (nodeType) => {
    if (!nodeType) return true;
    if (nodeType === 'Entity/Model' || nodeType === 'Entity' || nodeType === 'Model') {
      return filterTypes.includes('Entity/Model') || filterTypes.includes('Entity') || filterTypes.includes('Model');
    }
    if (['Controller', 'Service', 'Repository', 'Test'].includes(nodeType)) {
      return filterTypes.includes(nodeType);
    }
    return true;
  };

  const toggleTypeFilter = (type) => {
    setFilterTypes(prev =>
      prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
    );
    if (simulationRef.current) {
      simulationRef.current.alpha = Math.max(simulationRef.current.alpha || 0, 0.4);
    }
  };

  const toggleRelFilter = (type) => {
    setFilterRels(prev =>
      prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
    );
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'Controller': return '#6366f1';
      case 'Service': return '#06b6d4';
      case 'Repository': return '#f59e0b';
      case 'Entity/Model': return '#10b981';
      case 'Test': return '#a855f7';
      default: return '#9ca3af';
    }
  };

  const handleModelChange = (model) => {
    setSelectedModel(model);
    if (selectedChanged.length > 0) {
      runImpactAnalysis(selectedChanged, model);
    }
  };

  const getTypeLetter = (type) => {
    switch (type) {
      case 'Controller': return 'C';
      case 'Service': return 'S';
      case 'Repository': return 'R';
      case 'Entity/Model': return 'E';
      case 'Test': return 'T';
      default: return 'O';
    }
  };

  const impactedMap = React.useMemo(() => {
    const map = new Map();
    for (const item of activeReport) {
      if (item.id) {
        map.set(item.id, item);
        const simple = item.id.includes('.') ? item.id.split('.').pop() : item.id;
        map.set(simple, item);
      }
      if (item.name) {
        map.set(item.name, item);
      }
    }
    return map;
  }, [activeReport]);

  // Map to resolve any token (simple name or FQN) to canonical component
  const resolveComp = React.useCallback((token) => {
    if (!token) return null;
    const clean = token.trim();
    return components.find(c => c.id === clean || c.name === clean || (c.id && c.id.endsWith(`.${clean}`))) || null;
  }, [components]);

  const propagationInfo = React.useMemo(() => {
    const edgeKeys = new Set();
    const directedEdgeKeys = new Set();
    const pathNodeIds = new Set();
    const candidatePathMap = new Map();
    const propagationEdgeMap = new Map();

    for (const item of activeReport) {
      if (!item.reasoningPath) continue;
      const tokens = item.reasoningPath.split(/\s*➔\s*|\s*->\s*|\s*→\s*/);
      const itemEdges = new Set();

      for (let i = 0; i < tokens.length - 2; i += 2) {
        const uRaw = tokens[i].trim();
        const relToken = tokens[i + 1].trim();
        const rel = relToken.replace(/[\[\]]/g, '').trim();
        const vRaw = tokens[i + 2].trim();

        if (uRaw && vRaw) {
          const compU = resolveComp(uRaw);
          const compV = resolveComp(vRaw);

          const uId = compU ? compU.id : uRaw;
          const vId = compV ? compV.id : vRaw;
          const uName = compU ? compU.name : uRaw;
          const vName = compV ? compV.name : vRaw;

          pathNodeIds.add(uId);
          pathNodeIds.add(vId);
          if (uName) pathNodeIds.add(uName);
          if (vName) pathNodeIds.add(vName);

          const addKey = (k1, k2) => {
            edgeKeys.add(`${k1}|${k2}`);
            edgeKeys.add(`${k2}|${k1}`);
            itemEdges.add(`${k1}|${k2}`);
            itemEdges.add(`${k2}|${k1}`);
            propagationEdgeMap.set(`${k1}|${k2}`, { from: uId, to: vId, rel, impactLevel: item.impactLevel, candidateId: item.id || item.name });
            propagationEdgeMap.set(`${k2}|${k1}`, { from: uId, to: vId, rel, impactLevel: item.impactLevel, candidateId: item.id || item.name });
          };

          addKey(uId, vId);
          if (uName && vName) addKey(uName, vName);
          if (uId && vName) addKey(uId, vName);
          if (uName && vId) addKey(uName, vId);

          directedEdgeKeys.add(`${uId}->${vId}:${rel}`);
        }
      }

      if (item.id) candidatePathMap.set(item.id, itemEdges);
      if (item.name) candidatePathMap.set(item.name, itemEdges);
    }

    return { edgeKeys, directedEdgeKeys, pathNodeIds, candidatePathMap, propagationEdgeMap };
  }, [activeReport, resolveComp]);

  const graphDiagnostics = React.useMemo(() => {
    if (!repoAnalyzed) return null;
    const missingSources = selectedChanged.filter(id => !components.some(c => c.id === id));
    const hiddenSources = selectedChanged.filter(id => {
      const comp = components.find(c => c.id === id);
      return comp && !filterTypes.includes(comp.type);
    }).map(id => components.find(c => c.id === id));

    const missingCandidates = activeReport.filter(item => 
      !components.some(c => c.id === item.id || c.name === item.name)
    );
    const hiddenCandidates = activeReport.filter(item => {
      const comp = components.find(c => c.id === item.id || c.name === item.name);
      return comp && !filterTypes.includes(comp.type);
    }).map(item => components.find(c => c.id === item.id || c.name === item.name));

    return {
      missingSources,
      hiddenSources,
      missingCandidates,
      hiddenCandidates,
      hasMismatch: missingSources.length > 0 || hiddenSources.length > 0 || missingCandidates.length > 0 || hiddenCandidates.length > 0
    };
  }, [repoAnalyzed, selectedChanged, activeReport, components, filterTypes]);

  const compLookup = React.useMemo(() => {
    const validIds = new Set();
    components.forEach(c => {
      const isChanged = selectedChanged.includes(c.id) || selectedChanged.includes(c.name);
      const isImpacted = impactedMap.has(c.id) || impactedMap.has(c.name);
      const isConduit = propagationInfo.pathNodeIds.has(c.id) || propagationInfo.pathNodeIds.has(c.name);
      const isProp = isChanged || isImpacted || isConduit;
      if (isProp || filterTypes.includes(c.type)) {
        validIds.add(c.id);
        if (c.name) validIds.add(c.name);
      }
    });
    return validIds;
  }, [components, filterTypes, selectedChanged, impactedMap, propagationInfo]);

  const activeRels = React.useMemo(() => {
    return relationships.filter(r => {
      const isPropagationEdge = propagationInfo.edgeKeys.has(`${r.source}|${r.target}`) ||
        propagationInfo.edgeKeys.has(`${r.target}|${r.source}`);
      const isTypeAllowed = filterRels.includes(r.type);
      if (!isTypeAllowed && !isPropagationEdge) return false;

      return compLookup.has(r.source) && compLookup.has(r.target);
    });
  }, [relationships, filterRels, compLookup, propagationInfo]);

  const focusedNeighborhood = React.useMemo(() => {
    if (!focusSelectedNeighbor && !propagationOnly) return null;
    
    let seeds = [];
    if (selectedGraphNode) {
      seeds = [selectedGraphNode];
    } else if (selectedChanged.length > 0) {
      seeds = [...selectedChanged];
    } else {
      return null;
    }

    const set = new Set(seeds);

    if (propagationOnly && activeReport.length > 0) {
      selectedChanged.forEach(id => set.add(id));
      propagationInfo.pathNodeIds.forEach(id => set.add(id));
      activeReport.forEach(item => {
        if (item.id) set.add(item.id);
        if (item.name) set.add(item.name);
      });
      return set;
    }

    activeRels.forEach(r => {
      if (seeds.includes(r.source) || seeds.includes(r.target)) {
        set.add(r.source);
        set.add(r.target);
      }
    });

    if (!selectedGraphNode && activeReport.length > 0) {
      propagationInfo.pathNodeIds.forEach(id => set.add(id));
      activeReport.forEach(item => {
        if (item.id) set.add(item.id);
        if (item.name) set.add(item.name);
      });
    } else if (selectedGraphNode && activeReport.length > 0) {
      const candidateItem = activeReport.find(b => b.id === selectedGraphNode || b.name === selectedGraphNode);
      if (candidateItem?.reasoningPath) {
        const tokens = candidateItem.reasoningPath.split(/\s*➔\s*|\s*->\s*|\s*→\s*/);
        for (let i = 0; i < tokens.length; i += 2) {
          const uRaw = tokens[i].trim();
          if (uRaw) {
            const comp = resolveComp(uRaw);
            if (comp) { set.add(comp.id); set.add(comp.name); }
            set.add(uRaw);
          }
        }
      }
    }
    return set;
  }, [focusSelectedNeighbor, propagationOnly, selectedGraphNode, selectedChanged, activeRels, activeReport, propagationInfo, resolveComp]);

  // Dynamic canvas resize observer
  useEffect(() => {
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (rect.width > 0 && rect.height > 0) {
        const targetW = Math.floor(rect.width * dpr);
        const targetH = Math.floor(rect.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [repoAnalyzed]);

  useEffect(() => {
    if (!repoAnalyzed || components.length === 0) return;

    const activeComponents = components;

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas ? canvas.width / dpr : 800;
    const height = canvas ? canvas.height / dpr : 520;

    const oldNodeMap = new Map(simulationRef.current.nodes.map(n => [n.id, n]));

    const nodes = activeComponents.map((n, i) => {
      const oldNode = oldNodeMap.get(n.id);
      if (oldNode && Number.isFinite(oldNode.x) && Number.isFinite(oldNode.y)) {
        return { ...oldNode, name: n.name, type: n.type, filePath: n.filePath };
      }

      const isChanged = selectedChanged.includes(n.id) || selectedChanged.includes(n.name);
      const isImpacted = impactedMap.has(n.id) || impactedMap.has(n.name);
      const isConduit = propagationInfo.pathNodeIds.has(n.id) || propagationInfo.pathNodeIds.has(n.name);

      let x, y;
      if (isChanged) {
        x = width / 2 + (Math.random() - 0.5) * 60;
        y = height / 2 + (Math.random() - 0.5) * 60;
      } else if (isImpacted || isConduit) {
        const angle = (i / Math.max(activeComponents.length, 1)) * Math.PI * 2;
        const radius = 180 + (i % 4) * 50;
        x = width / 2 + Math.cos(angle) * radius;
        y = height / 2 + Math.sin(angle) * radius;
      } else {
        const angle = (i / Math.max(activeComponents.length, 1)) * Math.PI * 2;
        const radius = 320 + (i % 5) * 55;
        x = width / 2 + Math.cos(angle) * radius;
        y = height / 2 + Math.sin(angle) * radius;
      }

      return {
        ...n,
        x,
        y,
        vx: 0,
        vy: 0,
        r: isChanged ? 18 : (isImpacted ? 16 : 14)
      };
    });

    const nodeMap = new Map();
    nodes.forEach(n => {
      nodeMap.set(n.id, n);
      if (n.name) nodeMap.set(n.name, n);
    });

    const links = [];
    const linkSet = new Set();

    activeRels.forEach(l => {
      const sourceNode = nodeMap.get(l.source);
      const targetNode = nodeMap.get(l.target);
      if (sourceNode && targetNode && sourceNode !== targetNode) {
        const key = `${sourceNode.id}|${targetNode.id}`;
        if (!linkSet.has(key)) {
          linkSet.add(key);
          links.push({
            ...l,
            sourceNode,
            targetNode
          });
        }
      }
    });

    propagationInfo.propagationEdgeMap.forEach((edgeData) => {
      const sourceNode = nodeMap.get(edgeData.from);
      const targetNode = nodeMap.get(edgeData.to);
      if (sourceNode && targetNode && sourceNode !== targetNode) {
        const key1 = `${sourceNode.id}|${targetNode.id}`;
        const key2 = `${targetNode.id}|${sourceNode.id}`;
        if (!linkSet.has(key1) && !linkSet.has(key2)) {
          linkSet.add(key1);
          links.push({
            source: edgeData.from,
            target: edgeData.to,
            type: edgeData.rel || 'DEPENDS_ON',
            detail: 'Propagation Path',
            sourceNode,
            targetNode,
            isSyntheticProp: true
          });
        }
      }
    });

    simulationRef.current.nodes = nodes;
    simulationRef.current.links = links;
    simulationRef.current.alpha = 1.0;

  }, [repoAnalyzed, components, relationships, filterTypes, filterRels, selectedChanged, activeReport, impactedMap, propagationInfo, propagationOnly, layoutResetTrigger]);

  useEffect(() => {
    if (!repoAnalyzed) return;

    let animationId;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const updatePhysics = () => {
      const sim = simulationRef.current;
      const nodes = sim.nodes;
      const links = sim.links;

      if (!nodes || nodes.length === 0) return;
      if (sim.alpha < 0.005 && !sim.dragNode && !sim.isPanning) {
        return;
      }

      const alpha = sim.alpha;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const center = { x: width / 2, y: height / 2 };

      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy) || 1;
          
          const maxDist = 340;
          if (dist < maxDist) {
            const force = ((maxDist - dist) / maxDist) * 2.5 * alpha;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            n1.vx -= fx;
            n1.vy -= fy;
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }

      for (const link of links) {
        const n1 = link.sourceNode;
        const n2 = link.targetNode;
        if (!n1 || !n2) continue;
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.hypot(dx, dy) || 1;
        
        const targetDist = 185;
        const force = (dist - targetDist) * 0.024 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        
        n1.vx += fx;
        n1.vy += fy;
        n2.vx -= fx;
        n2.vy -= fy;
      }

      for (const n of nodes) {
        n.vx += (center.x - n.x) * 0.0018 * alpha;
        n.vy += (center.y - n.y) * 0.0018 * alpha;
      }

      for (const n of nodes) {
        if (n === sim.dragNode) continue;
        n.vx *= 0.80;
        n.vy *= 0.80;
        n.x += n.vx;
        n.y += n.vy;
      }

      sim.alpha *= 0.988;
    };

    const render = () => {
      updatePhysics();
      
      const sim = simulationRef.current;
      const { x, y, scale } = sim.transform;
      const dpr = window.devicePixelRatio || 1;
      const viewW = canvas.width / dpr;
      const viewH = canvas.height / dpr;

      sim.animOffset = (sim.animOffset || 0) + 0.35;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);

      ctx.translate(x, y);
      ctx.scale(scale, scale);

      const typeVisibleNodes = sim.nodes.filter(n => {
        if (!isTypeVisible(n.type)) return false;
        if (propagationOnly && activeReport.length > 0) {
          const isChanged = selectedChanged.includes(n.id) || selectedChanged.includes(n.name);
          const isImpacted = impactedMap.has(n.id) || impactedMap.has(n.name);
          const isConduit = propagationInfo.pathNodeIds.has(n.id) || propagationInfo.pathNodeIds.has(n.name);
          return isChanged || isImpacted || isConduit;
        }
        return true;
      });

      const visibleNodes = focusedNeighborhood
        ? typeVisibleNodes.filter(n => focusedNeighborhood.has(n.id) || focusedNeighborhood.has(n.name))
        : typeVisibleNodes;

      const visibleNodeIdSet = new Set();
      visibleNodes.forEach(n => {
        visibleNodeIdSet.add(n.id);
        if (n.name) visibleNodeIdSet.add(n.name);
      });

      const visibleLinks = sim.links.filter(l => 
        l.sourceNode && l.targetNode &&
        (visibleNodeIdSet.has(l.sourceNode.id) || visibleNodeIdSet.has(l.sourceNode.name)) &&
        (visibleNodeIdSet.has(l.targetNode.id) || visibleNodeIdSet.has(l.targetNode.name)) &&
        (!focusedNeighborhood || (
          (focusedNeighborhood.has(l.sourceNode.id) || focusedNeighborhood.has(l.sourceNode.name)) && 
          (focusedNeighborhood.has(l.targetNode.id) || focusedNeighborhood.has(l.targetNode.name))
        ))
      );

      visibleLinks.forEach(link => {
        const from = link.sourceNode;
        const to = link.targetNode;
        if (!from || !to) return;

        const linkKey1 = `${from.id}|${to.id}`;
        const linkKey2 = `${to.id}|${from.id}`;
        const linkKey3 = `${from.name}|${to.name}`;
        const linkKey4 = `${to.name}|${from.name}`;
        
        const fromChanged = selectedChanged.includes(from.id) || selectedChanged.includes(from.name) || 
          (from.id && selectedChanged.some(s => s === from.id || s === from.name || from.id.endsWith(`.${s}`) || s.endsWith(`.${from.name}`)));
        const toChanged = selectedChanged.includes(to.id) || selectedChanged.includes(to.name) || 
          (to.id && selectedChanged.some(s => s === to.id || s === to.name || to.id.endsWith(`.${s}`) || s.endsWith(`.${to.name}`)));

        const fromImpact = impactedMap.get(from.id) || impactedMap.get(from.name);
        const toImpact = impactedMap.get(to.id) || impactedMap.get(to.name);

        const isDirectImpact = (fromChanged && toImpact) || (toChanged && fromImpact);
        const isIndirectImpact = !!(fromImpact && toImpact);

        const isReasoningPathLink = propagationInfo.edgeKeys.has(linkKey1) || 
          propagationInfo.edgeKeys.has(linkKey2) || 
          propagationInfo.edgeKeys.has(linkKey3) || 
          propagationInfo.edgeKeys.has(linkKey4) ||
          link.isSyntheticProp;

        const isPropagationLink = isDirectImpact || isIndirectImpact || isReasoningPathLink;

        const propEdge = propagationInfo.propagationEdgeMap.get(linkKey1) || 
          propagationInfo.propagationEdgeMap.get(linkKey2) || 
          propagationInfo.propagationEdgeMap.get(linkKey3) || 
          propagationInfo.propagationEdgeMap.get(linkKey4);

        const relevantImpact = toImpact || fromImpact;
        const impactLevel = (toImpact?.impactLevel === 'High' || fromImpact?.impactLevel === 'High')
          ? 'High'
          : ((toImpact?.impactLevel === 'Medium' || fromImpact?.impactLevel === 'Medium')
             ? 'Medium'
             : (propEdge?.impactLevel || relevantImpact?.impactLevel || 'Low'));

        const isFocusedPath = selectedGraphNode && (
          (propagationInfo.candidatePathMap.get(selectedGraphNode)?.has(linkKey1)) ||
          (propagationInfo.candidatePathMap.get(selectedGraphNode)?.has(linkKey2)) ||
          (propagationInfo.candidatePathMap.get(selectedGraphNode)?.has(linkKey3)) ||
          (propagationInfo.candidatePathMap.get(selectedGraphNode)?.has(linkKey4)) ||
          (from.id === selectedGraphNode || to.id === selectedGraphNode || from.name === selectedGraphNode || to.name === selectedGraphNode)
        );

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);

        if (isFocusedPath) {
          ctx.setLineDash([8, 4]);
          ctx.lineDashOffset = -sim.animOffset * 2;
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3.6;
        } else if (isPropagationLink) {
          ctx.setLineDash(isDirectImpact ? [] : [6, 4]);
          if (!isDirectImpact) ctx.lineDashOffset = -sim.animOffset;
          
          if (impactLevel === 'High') {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = isDirectImpact ? 3.4 : 2.6;
          } else if (impactLevel === 'Medium') {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = isDirectImpact ? 2.8 : 2.2;
          } else {
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = isDirectImpact ? 2.2 : 1.8;
          }
        } else if (link.type === 'CO_CHANGED_WITH') {
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = 0;
          ctx.strokeStyle = 'rgba(217, 70, 239, 0.75)';
          ctx.lineWidth = 1.6;
        } else {
          ctx.setLineDash([]);
          const isFaded = activeReport.length > 0;
          ctx.strokeStyle = isFaded ? 'rgba(148, 163, 184, 0.08)' : 'rgba(148, 163, 184, 0.35)';
          ctx.lineWidth = isFaded ? 0.6 : 1.2;
        }
        
        ctx.stroke();
        ctx.setLineDash([]);

        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.beginPath();
        if (isFocusedPath) {
          ctx.moveTo(-9, -6);
          ctx.lineTo(4, 0);
          ctx.lineTo(-9, 6);
          ctx.fillStyle = '#38bdf8';
        } else if (isPropagationLink) {
          const arrowSize = impactLevel === 'High' ? 8 : (impactLevel === 'Medium' ? 7 : 6);
          ctx.moveTo(-arrowSize, -arrowSize * 0.65);
          ctx.lineTo(3, 0);
          ctx.lineTo(-arrowSize, arrowSize * 0.65);
          ctx.fillStyle = impactLevel === 'High' ? '#ef4444' : (impactLevel === 'Medium' ? '#f59e0b' : '#0284c7');
        } else {
          ctx.moveTo(-6, -3.5);
          ctx.lineTo(2, 0);
          ctx.lineTo(-6, 3.5);
          ctx.fillStyle = activeReport.length > 0 ? 'rgba(148, 163, 184, 0.10)' : 'rgba(148, 163, 184, 0.45)';
        }
        ctx.fill();
        ctx.restore();

        const isEndpointSelected = selectedGraphNode && (
          from.id === selectedGraphNode || to.id === selectedGraphNode || 
          from.name === selectedGraphNode || to.name === selectedGraphNode
        );

        if (isFocusedPath || isPropagationLink) {
          ctx.save();
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          const text = link.type || propEdge?.rel || (isDirectImpact ? 'IMPACTS' : 'DEPENDS_ON');
          const tw = ctx.measureText(text).width;
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(mx - tw / 2 - 4, my - 7, tw + 8, 14);
          ctx.strokeStyle = isFocusedPath ? '#38bdf8' : (impactLevel === 'High' ? '#ef4444' : (impactLevel === 'Medium' ? '#f59e0b' : '#0284c7'));
          ctx.lineWidth = 1;
          ctx.strokeRect(mx - tw / 2 - 4, my - 7, tw + 8, 14);
          ctx.fillStyle = isFocusedPath ? '#38bdf8' : (impactLevel === 'High' ? '#fca5a5' : (impactLevel === 'Medium' ? '#fde68a' : '#bae6fd'));
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, mx, my);
          ctx.restore();
        }
      });

      visibleNodes.forEach(node => {
        const isChanged = selectedChanged.includes(node.id) || selectedChanged.includes(node.name) || 
          (node.id && selectedChanged.some(s => s === node.id || s === node.name || node.id.endsWith(`.${s}`) || s.endsWith(`.${node.name}`)));
        const isFocused = selectedGraphNode === node.id || selectedGraphNode === node.name;
        const impacted = impactedMap.get(node.id) || impactedMap.get(node.name);
        const isPropagationNode = propagationInfo.pathNodeIds.has(node.id) || propagationInfo.pathNodeIds.has(node.name);
        const isConduit = !isChanged && !impacted && isPropagationNode;
        const isFaded = activeReport.length > 0 && !isChanged && !impacted && !isConduit;

        const baseRadius = node.r || 14;
        const nodeRadius = isChanged ? baseRadius + 4 : (impacted ? baseRadius + 2 : baseRadius);

        ctx.save();
        if (isFaded) {
          ctx.globalAlpha = 0.18;
        }

        if (isFocused) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 20;
        } else if (isChanged) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius + 7, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
          ctx.lineWidth = 2.8;
          ctx.stroke();
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 20;
        } else if (impacted) {
          const glowColor = impacted.impactLevel === 'High' ? '#ef4444' : (impacted.impactLevel === 'Medium' ? '#f59e0b' : '#0284c7');
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 2.2;
          ctx.stroke();
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 16;
        } else if (isConduit) {
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius + 5, 0, Math.PI * 2);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 12;
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
        const baseColor = getTypeColor(node.type);
        ctx.fillStyle = isChanged ? '#ef4444' : baseColor;
        ctx.fill();

        ctx.shadowBlur = 0;
        const borderGlow = impacted ? (impacted.impactLevel === 'High' ? '#ef4444' : (impacted.impactLevel === 'Medium' ? '#f59e0b' : '#38bdf8')) : 'rgba(255, 255, 255, 0.4)';
        ctx.strokeStyle = isFocused ? '#38bdf8' : (isChanged ? '#ffffff' : (impacted ? borderGlow : 'rgba(255, 255, 255, 0.4)'));
        ctx.lineWidth = isFocused ? 3 : (isChanged ? 3 : (impacted ? 2.5 : 1.5));
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isChanged ? '!' : getTypeLetter(node.type), node.x, node.y);

        ctx.font = isFocused || isChanged || impacted ? '600 11px Outfit, sans-serif' : '500 10.5px Outfit, sans-serif';
        ctx.fillStyle = isFaded ? '#64748b' : '#ffffff';
        ctx.fillText(node.name, node.x, node.y - nodeRadius - 8);

        if (isChanged) {
          ctx.fillStyle = '#fecdd3';
          ctx.font = 'bold 8.5px Outfit, sans-serif';
          ctx.fillText('CHANGED SEED', node.x, node.y + nodeRadius + 13);
        } else if (impacted) {
          const impactColor = impacted.impactLevel === 'High' ? '#fca5a5' : (impacted.impactLevel === 'Medium' ? '#fde68a' : '#7dd3fc');
          ctx.fillStyle = impactColor;
          ctx.font = 'bold 8.5px Outfit, sans-serif';
          ctx.fillText(`${impacted.impactLevel.toUpperCase()} IMPACT (${impacted.hopDistance || 1}H)`, node.x, node.y + nodeRadius + 13);
        } else if (isConduit) {
          ctx.fillStyle = '#fde68a';
          ctx.font = 'bold 8.5px Outfit, sans-serif';
          ctx.fillText('PATH CONDUIT', node.x, node.y + nodeRadius + 13);
        } else if (!isFaded) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = '8px Outfit, sans-serif';
          ctx.fillText(node.type.toUpperCase(), node.x, node.y + nodeRadius + 12);
        }

        ctx.restore();
      });

      ctx.restore();
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [repoAnalyzed, selectedChanged, activeReport, selectedGraphNode, focusedNeighborhood, propagationInfo, impactedMap, filterTypes, filterRels, propagationOnly]);

  const autoFit = () => {
    const sim = simulationRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !sim.nodes || sim.nodes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;

    const typeVisibleNodes = sim.nodes.filter(n => isTypeVisible(n.type));
    if (typeVisibleNodes.length === 0) return;

    const targetNodes = (activeReport.length > 0)
      ? typeVisibleNodes.filter(n => 
          selectedChanged.includes(n.id) || 
          selectedChanged.includes(n.name) ||
          impactedMap.has(n.id) || 
          impactedMap.has(n.name) ||
          propagationInfo.pathNodeIds.has(n.id) ||
          propagationInfo.pathNodeIds.has(n.name)
        )
      : typeVisibleNodes;

    const fitList = targetNodes.length > 0 ? targetNodes : typeVisibleNodes;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    fitList.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });

    const boxW = Math.max(maxX - minX, 160);
    const boxH = Math.max(maxY - minY, 160);
    const pad = 60;

    const scale = Math.min((viewW - pad * 2) / boxW, (viewH - pad * 2) / boxH);
    const clampedScale = Math.max(0.28, Math.min(scale, 1.05));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    sim.transform = {
      x: viewW / 2 - centerX * clampedScale,
      y: viewH / 2 - centerY * clampedScale,
      scale: clampedScale
    };
  };

  useEffect(() => {
    if (activeReport.length > 0) {
      const timer = setTimeout(() => {
        autoFit();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [activeReport]);

  const focusOnNode = (nodeId) => {
    setSelectedGraphNode(prev => prev === nodeId ? null : nodeId);
    const sim = simulationRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !sim.nodes) return;
    const node = sim.nodes.find(n => n.id === nodeId || n.name === nodeId);
    if (!node) return;
    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;
    const targetScale = Math.max(sim.transform.scale, 0.95);
    sim.transform.scale = targetScale;
    sim.transform.x = viewW / 2 - node.x * targetScale;
    sim.transform.y = viewH / 2 - node.y * targetScale;
  };

  const getMousePos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handleMouseDown = (e) => {
    const sim = simulationRef.current;
    const pos = getMousePos(e);
    
    const worldX = (pos.x - sim.transform.x) / sim.transform.scale;
    const worldY = (pos.y - sim.transform.y) / sim.transform.scale;

    const typeVisibleNodes = sim.nodes.filter(n => isTypeVisible(n.type));
    const visibleNodes = focusedNeighborhood 
      ? typeVisibleNodes.filter(n => focusedNeighborhood.has(n.id) || focusedNeighborhood.has(n.name)) 
      : typeVisibleNodes;
    const clickedNode = visibleNodes.find(n => Math.hypot(n.x - worldX, n.y - worldY) < (n.r || 14) + 10);

    sim.clickStart = { x: pos.x, y: pos.y };

    if (clickedNode) {
      sim.dragNode = clickedNode;
      sim.dragNode.vx = 0;
      sim.dragNode.vy = 0;
    } else {
      sim.isPanning = true;
      sim.panStart = { x: pos.x - sim.transform.x, y: pos.y - sim.transform.y };
    }
  };

  const handleMouseMove = (e) => {
    const sim = simulationRef.current;
    const pos = getMousePos(e);
    
    const worldX = (pos.x - sim.transform.x) / sim.transform.scale;
    const worldY = (pos.y - sim.transform.y) / sim.transform.scale;

    if (sim.dragNode) {
      sim.dragNode.x = worldX;
      sim.dragNode.y = worldY;
      sim.dragNode.vx = 0;
      sim.dragNode.vy = 0;
      sim.alpha = Math.max(sim.alpha, 0.15);
    } else if (sim.isPanning) {
      sim.transform.x = pos.x - sim.panStart.x;
      sim.transform.y = pos.y - sim.panStart.y;
    } else {
      const typeVisibleNodes = sim.nodes.filter(n => isTypeVisible(n.type));
      const visibleNodes = focusedNeighborhood 
        ? typeVisibleNodes.filter(n => focusedNeighborhood.has(n.id) || focusedNeighborhood.has(n.name)) 
        : typeVisibleNodes;
      const hover = visibleNodes.find(n => Math.hypot(n.x - worldX, n.y - worldY) < (n.r || 14) + 8);
      sim.hoveredNode = hover || null;
    }
  };

  const handleMouseUp = (e) => {
    const sim = simulationRef.current;
    const pos = getMousePos(e);

    if (sim.clickStart) {
      const dx = pos.x - sim.clickStart.x;
      const dy = pos.y - sim.clickStart.y;
      if (Math.hypot(dx, dy) < 6) {
        if (sim.dragNode) {
          focusOnNode(sim.dragNode.id);
        } else if (sim.isPanning) {
          setSelectedGraphNode(null);
        }
      }
    }
    
    sim.dragNode = null;
    sim.isPanning = false;
    sim.clickStart = null;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const sim = simulationRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getMousePos(e);
    
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.min(Math.max(sim.transform.scale * zoomFactor, 0.25), 3.5);
    
    sim.transform.x = pos.x - (pos.x - sim.transform.x) * (newScale / sim.transform.scale);
    sim.transform.y = pos.y - (pos.y - sim.transform.y) * (newScale / sim.transform.scale);
    sim.transform.scale = newScale;
  };

  const handleZoom = (direction) => {
    const sim = simulationRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const centerX = canvas.width / dpr / 2;
    const centerY = canvas.height / dpr / 2;

    const factor = direction === 'in' ? 1.2 : 0.83;
    const newScale = Math.min(Math.max(sim.transform.scale * factor, 0.25), 3.5);

    sim.transform.x = centerX - (centerX - sim.transform.x) * (newScale / sim.transform.scale);
    sim.transform.y = centerY - (centerY - sim.transform.y) * (newScale / sim.transform.scale);
    sim.transform.scale = newScale;
  };

  const handleResetLayout = () => {
    simulationRef.current.nodes = [];
    simulationRef.current.transform = { x: 0, y: 0, scale: 0.8 };
    simulationRef.current.alpha = 1.0;
    setLayoutResetTrigger(prev => prev + 1);
  };

  const filteredComponents = components.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const typeCounts = components.reduce((acc, c) => {
    acc[c.type] = (acc[c.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* 1. TOP NAVBAR (Matching Reference Theme) */}
      <nav style={{
        background: '#ffffff',
        borderBottom: '1px solid var(--border-light)',
        padding: '0.85rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: 'var(--shadow-sm)'
      }}>
        {/* Brand */}
        <div className="navbar-brand-section">
          <div className="brand-icon-circle">
            CIA
          </div>
          <div>
            <span style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>
              Software Change Impact Analysis
            </span>
            <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '0.4rem', fontWeight: '500' }}>
              Research Framework
            </span>
          </div>
        </div>

        {/* Center Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', background: '#f1f5f9', padding: '4px', borderRadius: '9999px' }}>
          <button
            className={`nav-tab-pill ${activeTab === 'analysis' ? 'active' : 'inactive'}`}
            onClick={() => setActiveTab('analysis')}
          >
            <span>Run Analysis</span>
          </button>
          <button
            className={`nav-tab-pill ${activeTab === 'comparison' ? 'active' : 'inactive'}`}
            onClick={() => setActiveTab('comparison')}
          >
            <span>3-Model Comparison</span>
            <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.62rem', padding: '0.05rem 0.35rem' }}>
              Side-by-Side
            </span>
          </button>
          <button
            className={`nav-tab-pill ${activeTab === 'research' ? 'active' : 'inactive'}`}
            onClick={() => setActiveTab('research')}
          >
            <span>Research & Model Comparison</span>
            <span className="badge-clean badge-clean-success" style={{ fontSize: '0.62rem', padding: '0.05rem 0.35rem' }}>
              v4 Winner
            </span>
          </button>
        </div>

        {/* Right CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="badge-clean badge-clean-primary" style={{ display: 'inline-flex' }}>
            Engine: {selectedModel === 'canonical' ? 'Canonical Baseline' : (selectedModel === 'egcp_v4' ? 'EGCP v4 Combined' : 'Comparative Mode')}
          </span>
          <button 
            className="btn-cobalt"
            onClick={() => {
              if (activeTab !== 'analysis') setActiveTab('analysis');
              if (repoAnalyzed && selectedChanged.length > 0) handleAnalyzeImpact();
            }}
          >
            <span>{repoAnalyzed ? 'Analyze Impact' : 'Get Started'}</span>
            <span style={{ fontSize: '1.05rem' }}>&rarr;</span>
          </button>
        </div>
      </nav>

      {/* 2. HERO COBALT BLUE BANNER (Matches Theme In Reference Screenshot) */}
      <section className="hero-cobalt-banner">
        <div className="hero-dot-pattern"></div>
        <div style={{ maxWidth: '1440px', margin: '0 auto', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1rem' }}>
          
          <div className="badge-clean" style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.3)', backdropFilter: 'blur(8px)', padding: '0.35rem 0.85rem' }}>
            Next-Gen Software Change Propagation Research
          </div>

          <h1 style={{ fontSize: 'clamp(2.1rem, 4vw, 3.4rem)', fontWeight: '800', lineHeight: 1.15, letterSpacing: '-0.03em', maxWidth: '850px' }}>
            The Future of Change Propagation is Here
          </h1>

          <p style={{ fontSize: '1.05rem', color: '#e0e7ff', maxWidth: '680px', lineHeight: 1.5, fontWeight: '400' }}>
            Unify code dependencies, trace propagation paths across structural knowledge graphs, and evaluate state-of-the-art evolutionary models.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button 
              className={`nav-tab-pill ${activeTab === 'analysis' ? 'active' : 'inactive'}`} 
              style={{ background: activeTab === 'analysis' ? '#ffffff' : 'rgba(255,255,255,0.15)', color: activeTab === 'analysis' ? '#0f48f2' : '#ffffff', borderColor: 'transparent', padding: '0.65rem 1.4rem', fontWeight: '600' }}
              onClick={() => setActiveTab('analysis')}
            >
              Launch Change Analysis
            </button>
            <button 
              className={`nav-tab-pill ${activeTab === 'comparison' ? 'active' : 'inactive'}`} 
              style={{ background: activeTab === 'comparison' ? '#ffffff' : 'rgba(255,255,255,0.15)', color: activeTab === 'comparison' ? '#0f48f2' : '#ffffff', borderColor: 'transparent', padding: '0.65rem 1.4rem', fontWeight: '600' }}
              onClick={() => setActiveTab('comparison')}
            >
              3-Model Comparison Dashboard
            </button>
            <button 
              className={`nav-tab-pill ${activeTab === 'research' ? 'active' : 'inactive'}`}
              style={{ background: activeTab === 'research' ? '#ffffff' : 'rgba(255,255,255,0.15)', color: activeTab === 'research' ? '#0f48f2' : '#ffffff', borderColor: 'transparent', padding: '0.65rem 1.4rem', fontWeight: '600' }}
              onClick={() => setActiveTab('research')}
            >
              Explore Model Benchmarks (EGCP v4)
            </button>
          </div>

        </div>
      </section>

      {/* 3. MAIN DASHBOARD FRAME (Browser Mockup Frame from Screenshot) */}
      <main style={{ maxWidth: '1440px', width: '100%', margin: '-3.8rem auto 3rem auto', padding: '0 1.5rem', position: 'relative', zIndex: 10 }}>
        
        <div className="dashboard-frame-card">
          
          {/* Top Browser Bar */}
          <div className="browser-header-mockup">
            <div className="browser-dots">
              <span className="browser-dot red"></span>
              <span className="browser-dot yellow"></span>
              <span className="browser-dot green"></span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#0f172a', padding: '0.25rem 1rem', borderRadius: '6px', border: '1px solid #334155', color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              <span>localhost:5000/api</span>
              <span style={{ color: '#38bdf8' }}>({activeTab === 'analysis' ? 'analysis-engine' : 'frozen-benchmark'})</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>
                AI Engine: Canonical Baseline
              </span>
            </div>
          </div>

          {/* Frame Inner Content */}
          <div style={{ padding: '2rem' }}>
            
            {/* TAB 1: RUN ANALYSIS */}
            {activeTab === 'analysis' && (
              <div>
                {!repoAnalyzed ? (
                  /* Landing / Scan Repository View */
                  <div style={{ maxWidth: '720px', margin: '2rem auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                    <div>
                      <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.5rem' }}>
                        Select & Connect Repository
                      </h2>
                      <p style={{ color: '#64748b', fontSize: '0.92rem' }}>
                        Enter the local directory path to your Java / Spring Boot Git codebase, or choose one of the verified local example projects below.
                      </p>
                    </div>

                    {/* Validation Error Banner */}
                    {validationError && (
                      <div style={{
                        background: '#fef2f2',
                        border: '1px solid #f87171',
                        borderRadius: '10px',
                        padding: '1rem 1.25rem',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.35rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#991b1b', fontWeight: '700', fontSize: '0.9rem' }}>
                          <span>⚠️</span>
                          <span>Repository Validation Error</span>
                        </div>
                        <p style={{ color: '#b91c1c', fontSize: '0.85rem', margin: 0, lineHeight: 1.45 }}>
                          {validationError}
                        </p>
                      </div>
                    )}

                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.15rem', textAlign: 'left' }}>
                      <label style={{ fontSize: '0.82rem', fontWeight: '700', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.04em' }}>
                        Repository Workspace Directory
                      </label>
                      <input 
                        type="text" 
                        value={repoPath}
                        onChange={(e) => {
                          setRepoPath(e.target.value);
                          if (validationError) setValidationError(null);
                        }}
                        style={{
                          width: '100%',
                          padding: '0.8rem 1rem',
                          borderRadius: '8px',
                          border: validationError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                          fontSize: '0.92rem',
                          fontFamily: 'var(--font-mono)',
                          color: '#0f172a',
                          background: '#ffffff'
                        }}
                        placeholder="e.g. C:\yashika\STUDY\clg_project\shopizer"
                      />

                      {/* Preset Example Chips */}
                      {exampleRepos.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                          <span style={{ fontSize: '0.74rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Quick-Select Verified Local Examples:
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {exampleRepos.map((ex, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  setRepoPath(ex.repoPath);
                                  setValidationError(null);
                                }}
                                style={{
                                  background: repoPath === ex.repoPath ? '#dbeafe' : '#ffffff',
                                  border: repoPath === ex.repoPath ? '1px solid #3b82f6' : '1px solid #cbd5e1',
                                  color: repoPath === ex.repoPath ? '#1d4ed8' : '#334155',
                                  borderRadius: '20px',
                                  padding: '0.35rem 0.85rem',
                                  fontSize: '0.78rem',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {ex.label || ex.projectName}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <button 
                        className="btn-cobalt" 
                        style={{ width: '100%', justifyContent: 'center', padding: '0.85rem' }}
                        onClick={() => handleAnalyzeRepo()}
                        disabled={loading || !repoPath.trim()}
                      >
                        {loading ? (loadingMessage || 'Scanning Repository Graph...') : 'Analyze Repository Structure'}
                      </button>
                    </div>

                    {loading && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                        <div className="spinner-clean"></div>
                        <span style={{ fontSize: '0.88rem', color: '#64748b' }}>
                          {loadingMessage || 'Parsing AST nodes, constructor bindings, and relationships...'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Live Analysis Workspace */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                    
                    {/* Top Action Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1.25rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
                            Active Codebase
                          </span>
                          <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.7rem' }}>
                            Connected
                          </span>
                        </div>
                        <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                          {analyzedProjectName || repoPath.split(/[\\/]/).pop()}
                        </h2>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#0f48f2' }}>
                          {repoPath}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <button className="btn-secondary-clean" onClick={handleResetRepo} title="Switch to another repository or enter a new path">
                          Switch Project
                        </button>
                        <button 
                          className="btn-cobalt"
                          onClick={() => handleAnalyzeImpact()}
                          disabled={analyzingImpact || selectedChanged.length === 0}
                        >
                          {analyzingImpact ? 'Computing Paths...' : `Analyze Impact (${selectedChanged.length} selected)`}
                        </button>
                      </div>
                    </div>

                    {/* KPI Metric Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
                      <div className="kpi-card-modern">
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Controllers</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '1.6rem', fontWeight: '800', color: '#6366f1', fontFamily: 'var(--font-mono)' }}>{typeCounts['Controller'] || 0}</span>
                          <span className="badge-clean badge-clean-primary">REST</span>
                        </div>
                      </div>
                      <div className="kpi-card-modern">
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Services</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '1.6rem', fontWeight: '800', color: '#06b6d4', fontFamily: 'var(--font-mono)' }}>{typeCounts['Service'] || 0}</span>
                          <span className="badge-clean badge-clean-primary">Domain</span>
                        </div>
                      </div>
                      <div className="kpi-card-modern">
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Repositories</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '1.6rem', fontWeight: '800', color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{typeCounts['Repository'] || 0}</span>
                          <span className="badge-clean badge-clean-warning">Data</span>
                        </div>
                      </div>
                      <div className="kpi-card-modern">
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Entities</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '1.6rem', fontWeight: '800', color: '#10b981', fontFamily: 'var(--font-mono)' }}>{typeCounts['Entity/Model'] || 0}</span>
                          <span className="badge-clean badge-clean-success">Models</span>
                        </div>
                      </div>
                      <div className="kpi-card-modern">
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Relationships</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>{relationships.length}</span>
                          <span className="badge-clean badge-clean-primary">Edges</span>
                        </div>
                      </div>
                    </div>

                    {/* Two-Column Layout: Visualizer on Left, Selector & Impact Results on Right */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1.5rem', alignItems: 'start' }}>
                      
                      {/* Left: Canvas Graph Visualizer */}
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', boxShadow: 'var(--shadow-sm)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
                              Architecture Dependency Graph
                            </h3>
                            <p style={{ fontSize: '0.78rem', color: '#64748b' }}>
                              Drag nodes to reposition. Click nodes to focus connected paths.
                            </p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            {activeReport.length > 0 && (
                              <button
                                className={propagationOnly ? "btn-cobalt" : "btn-secondary-clean"}
                                style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                                onClick={() => setPropagationOnly(prev => !prev)}
                              >
                                {propagationOnly ? "Show All Components" : "Isolate Propagation"}
                              </button>
                            )}
                            <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#0f48f2', cursor: 'pointer', fontWeight: '500' }}>
                              <input 
                                type="checkbox" 
                                checked={focusSelectedNeighbor} 
                                onChange={(e) => setFocusSelectedNeighbor(e.target.checked)}
                              />
                              Focus Neighborhood
                            </label>
                          </div>
                        </div>

                        {/* Node Type & Relation Filters */}
                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.65rem 0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.78rem' }}>
                          <span style={{ fontWeight: '700', color: '#475569', textTransform: 'uppercase' }}>Types:</span>
                          {['Controller', 'Service', 'Repository', 'Test', 'Entity/Model'].map(t => (
                            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                              <input 
                                type="checkbox" 
                                checked={filterTypes.includes(t)}
                                onChange={() => toggleTypeFilter(t)}
                              />
                              {t}
                            </label>
                          ))}
                        </div>

                        {/* Interactive Canvas Container */}
                        <div ref={canvasContainerRef} className="visualizer-canvas-clean">
                          <div className="canvas-controls-clean">
                            <button className="canvas-control-btn-clean" onClick={() => handleZoom('in')} title="Zoom In">+</button>
                            <button className="canvas-control-btn-clean" onClick={() => handleZoom('out')} title="Zoom Out">-</button>
                            <button className="canvas-control-btn-clean" onClick={autoFit} title="Fit Graph in View">Fit</button>
                            <button className="canvas-control-btn-clean" onClick={handleResetLayout} title="Reset Layout">Reset</button>
                          </div>
                          <canvas 
                            ref={canvasRef} 
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onWheel={handleWheel}
                            style={{ width: '100%', height: '100%', cursor: 'grab' }}
                          />
                        </div>

                        {/* Visual Legend */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.85rem', background: '#0f172a', borderRadius: '8px', fontSize: '0.74rem', color: '#94a3b8' }}>
                          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 6px #ef4444' }}></span>
                              <span style={{ color: '#fecdd3', fontWeight: '600' }}>Changed Seed</span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', border: '2px dashed #fbbf24', display: 'inline-block' }}></span>
                              <span style={{ color: '#fde68a', fontWeight: '600' }}>Path Conduit</span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f43f5e', display: 'inline-block' }}></span>
                              <span style={{ color: '#fca5a5' }}>High</span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}></span>
                              <span style={{ color: '#fef08a' }}>Medium</span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#0284c7', display: 'inline-block' }}></span>
                              <span style={{ color: '#7dd3fc' }}>Low</span>
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ color: '#64748b' }}>Scroll to zoom · Drag to pan</span>
                          </div>
                        </div>

                        {selectedGraphNode && (
                          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                            <span>Focused: <strong style={{ color: '#0f48f2' }}>{selectedGraphNode}</strong></span>
                            <button 
                              className="btn-secondary-clean" 
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => toggleComponentSelected(selectedGraphNode)}
                            >
                              {selectedChanged.includes(selectedGraphNode) ? 'Remove Selection' : 'Mark as Changed'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Right: Component Selection & Potential Impact Output */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        
                        {/* Git Auto-Detection */}
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: 'var(--shadow-sm)' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.65rem' }}>
                            Git Change Detection
                          </h4>
                          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <button className="btn-secondary-clean" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleDetectGit('local')} disabled={isDetectingGit}>
                              {isDetectingGit ? 'Scanning...' : 'Detect Uncommitted'}
                            </button>
                            <button className="btn-secondary-clean" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleDetectGit('commit')} disabled={isDetectingGit}>
                              {isDetectingGit ? 'Scanning...' : 'Latest Commit'}
                            </button>
                          </div>

                          {gitDetectedChanges && gitDetectedChanges.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '160px', overflowY: 'auto' }}>
                              {gitDetectedChanges.map((change, idx) => {
                                const isChecked = change.matched && selectedChanged.includes(change.componentId);
                                const fileInfo = getFileInfo(change.filePath, change.componentId);
                                return (
                                  <div 
                                    key={idx}
                                    onClick={() => change.matched && toggleComponentSelected(change.componentId)}
                                    style={{
                                      padding: '0.45rem 0.65rem',
                                      borderRadius: '6px',
                                      border: isChecked ? '1px solid #0f48f2' : '1px solid #e2e8f0',
                                      background: isChecked ? '#eff6ff' : '#f8fafc',
                                      cursor: change.matched ? 'pointer' : 'default',
                                      fontSize: '0.78rem',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center'
                                    }}
                                  >
                                    <div>
                                      <strong style={{ color: '#0f172a' }}>{fileInfo.fileName}</strong>
                                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{fileInfo.relativePath}</div>
                                    </div>
                                    {change.matched && (
                                      <input type="checkbox" checked={isChecked} readOnly style={{ accentColor: '#0f48f2' }} />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Model Selection Panel */}
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1rem 1.25rem', boxShadow: 'var(--shadow-sm)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <h4 style={{ fontSize: '0.92rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                              Analysis Model Engine
                            </h4>
                            <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem' }}>
                              {selectedModel === 'canonical' ? 'Graph Reachability' : (selectedModel === 'egcp_v4' ? 'Entropy Diffusion' : 'Comparative Delta')}
                            </span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.45rem' }}>
                            <button
                              className={selectedModel === 'canonical' ? "btn-cobalt" : "btn-secondary-clean"}
                              style={{ fontSize: '0.74rem', padding: '0.45rem 0.4rem', justifyContent: 'center' }}
                              onClick={() => handleModelChange('canonical')}
                            >
                              Canonical Baseline
                            </button>
                            <button
                              className={selectedModel === 'egcp_v4' ? "btn-cobalt" : "btn-secondary-clean"}
                              style={{ fontSize: '0.74rem', padding: '0.45rem 0.4rem', justifyContent: 'center' }}
                              onClick={() => handleModelChange('egcp_v4')}
                            >
                              EGCP v4 (Combined)
                            </button>
                            <button
                              className={selectedModel === 'compare' ? "btn-cobalt" : "btn-secondary-clean"}
                              style={{ fontSize: '0.74rem', padding: '0.45rem 0.4rem', justifyContent: 'center' }}
                              onClick={() => handleModelChange('compare')}
                            >
                              Compare Models
                            </button>
                          </div>
                        </div>

                        {/* Changed Selection List */}
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: 'var(--shadow-sm)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div>
                              <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                                Changed Seeds ({selectedChanged.length})
                              </h4>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {selectedChanged.length > 0 && (
                                <button className="btn-secondary-clean" style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }} onClick={clearSelection}>
                                  Clear All
                                </button>
                              )}
                              <button 
                                className="btn-cobalt"
                                style={{ padding: '0.35rem 0.8rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                                onClick={() => handleAnalyzeImpact()}
                                disabled={analyzingImpact || selectedChanged.length === 0}
                              >
                                <span>{analyzingImpact ? 'Analyzing...' : `Analyze Impact (${selectedChanged.length})`}</span>
                                <span style={{ fontSize: '0.85rem' }}>&rarr;</span>
                              </button>
                            </div>
                          </div>

                          {selectedChanged.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                              {selectedChanged.map(id => (
                                <span key={id} className="badge-clean badge-clean-danger" style={{ cursor: 'pointer' }} onClick={() => toggleComponentSelected(id)}>
                                  {id} [x]
                                </span>
                              ))}
                            </div>
                          )}

                          <input 
                            type="text" 
                            placeholder="Filter components to select..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '0.45rem 0.75rem',
                              borderRadius: '8px',
                              border: '1px solid #cbd5e1',
                              fontSize: '0.82rem',
                              marginBottom: '0.5rem'
                            }}
                          />

                          <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                            {filteredComponents.slice(0, 40).map(c => {
                              const isChecked = selectedChanged.includes(c.id);
                              return (
                                <div 
                                  key={c.id}
                                  onClick={() => toggleComponentSelected(c.id)}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.4rem 0.65rem',
                                    borderBottom: '1px solid #f1f5f9',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    background: isChecked ? '#eff6ff' : '#ffffff'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <input type="checkbox" checked={isChecked} readOnly style={{ accentColor: '#0f48f2' }} />
                                    <span style={{ fontWeight: isChecked ? '600' : 'normal', color: '#0f172a' }}>{c.name}</span>
                                  </div>
                                  <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.65rem' }}>{c.type}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Impact Propagation Output */}
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: 'var(--shadow-sm)' }}>
                          
                          {/* Target Repository Confirmation Pill */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '8px',
                            padding: '0.4rem 0.75rem',
                            marginBottom: '0.85rem',
                            fontSize: '0.74rem'
                          }}>
                            <span style={{ color: '#1e3a8a' }}>
                              Analyzed Codebase: <strong style={{ color: '#0f172a' }}>{analyzedProjectName || repoPath.split(/[\\/]/).pop()}</strong>
                            </span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: '#0f48f2', fontSize: '0.7rem' }}>
                              {repoPath}
                            </span>
                          </div>

                          {/* 1. CANONICAL BASELINE VIEW */}
                          {selectedModel === 'canonical' && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                                <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                                  Affected Components ({baselineReport.length})
                                </h4>
                                <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem' }}>
                                  Canonical Baseline
                                </span>
                              </div>
                              <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem' }}>
                                Computed by Canonical Structural Baseline via deterministic 2-hop graph reachability.
                              </p>

                              {baselineReport.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                                  Select one or more changed components and click "Analyze Impact".
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '340px', overflowY: 'auto' }}>
                                  {baselineReport.map((item, index) => {
                                    const isFocused = selectedGraphNode === item.id || selectedGraphNode === item.name;
                                    return (
                                      <div 
                                        key={index}
                                        onClick={() => focusOnNode(item.id || item.name)}
                                        style={{
                                          background: isFocused ? '#eff6ff' : '#f8fafc',
                                          border: isFocused ? '1px solid #0f48f2' : '1px solid #e2e8f0',
                                          borderLeft: item.impactLevel === 'High' ? '4px solid #ef4444' : (item.impactLevel === 'Medium' ? '4px solid #f59e0b' : '4px solid #0284c7'),
                                          borderRadius: '8px',
                                          padding: '0.65rem 0.85rem',
                                          cursor: 'pointer',
                                          fontSize: '0.82rem'
                                        }}
                                      >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                          <strong style={{ color: '#0f172a' }}>#{index + 1} {item.name}</strong>
                                          <span className={item.impactLevel === 'High' ? 'badge-clean badge-clean-danger' : (item.impactLevel === 'Medium' ? 'badge-clean badge-clean-warning' : 'badge-clean badge-clean-primary')}>
                                            {item.impactLevel} Impact ({item.hopDistance || 1}H)
                                          </span>
                                        </div>
                                        <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                                          {item.reason}
                                        </div>
                                        {item.reasoningPath && (
                                          <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#0f48f2', background: '#ffffff', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                                            {item.reasoningPath}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}

                          {/* 2. EGCP v4 VIEW */}
                          {selectedModel === 'egcp_v4' && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                                <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                                  Affected Components ({egcpReport.length})
                                </h4>
                                <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem' }}>
                                  EGCP v4 Combined
                                </span>
                              </div>
                              <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem' }}>
                                Ranked by Entropy-Adaptive Evolutionary Diffusion (Ablations A+B+C+Stereotype Dampening).
                              </p>

                              {evolutionaryStatus && (
                                <div style={{
                                  padding: '0.5rem 0.75rem',
                                  borderRadius: '8px',
                                  marginBottom: '0.75rem',
                                  fontSize: '0.74rem',
                                  background: evolutionaryStatus.available ? '#f0fdf4' : '#fffbeb',
                                  border: evolutionaryStatus.available ? '1px solid #bbf7d0' : '1px solid #fde68a',
                                  color: evolutionaryStatus.available ? '#166534' : '#b45309',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '0.35rem'
                                }}>
                                  <span>
                                    <strong>{evolutionaryStatus.available ? 'Live Git Co-Change Active' : 'Git Co-Change History Unavailable'}</strong>: {evolutionaryStatus.message}
                                  </span>
                                  <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.65rem' }}>
                                    Window: {evolutionaryStatus.commitCount || 0} commits
                                  </span>
                                </div>
                              )}

                              {egcpReport.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                                  Select one or more changed components and click "Analyze Impact".
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '340px', overflowY: 'auto' }}>
                                  {egcpReport.map((item, index) => {
                                    const isFocused = selectedGraphNode === item.id || selectedGraphNode === item.name;
                                    const scoreVal = typeof item.score === 'number' ? item.score : (item.egcp_v4_score != null ? Number(item.egcp_v4_score) : 0);
                                    return (
                                      <div 
                                        key={index}
                                        onClick={() => focusOnNode(item.id || item.name)}
                                        style={{
                                          background: isFocused ? '#eff6ff' : '#f8fafc',
                                          border: isFocused ? '1px solid #0f48f2' : '1px solid #e2e8f0',
                                          borderLeft: item.impactLevel === 'High' ? '4px solid #ef4444' : (item.impactLevel === 'Medium' ? '4px solid #f59e0b' : '4px solid #0284c7'),
                                          borderRadius: '8px',
                                          padding: '0.65rem 0.85rem',
                                          cursor: 'pointer',
                                          fontSize: '0.82rem'
                                        }}
                                      >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                          <strong style={{ color: '#0f172a' }}>#{index + 1} {item.name}</strong>
                                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                            <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                                              Score: {scoreVal.toFixed(4)}
                                            </span>
                                            <span className={item.impactLevel === 'High' ? 'badge-clean badge-clean-danger' : (item.impactLevel === 'Medium' ? 'badge-clean badge-clean-warning' : 'badge-clean badge-clean-primary')}>
                                              {item.impactLevel} ({item.hopDistance || 1}H)
                                            </span>
                                          </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.65rem', fontSize: '0.68rem', color: '#64748b', marginBottom: '0.3rem', fontFamily: 'var(--font-mono)' }}>
                                          <span>Struct Lift: {Number(item.structuralLift || 0).toFixed(3)}</span>
                                          <span>·</span>
                                          <span>Evo Lift: {Number(item.evolutionaryLift || 0).toFixed(3)}</span>
                                          <span>·</span>
                                          <span>Co-Changes: {item.coChangeCount || 0}</span>
                                        </div>
                                        <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                                          {item.reason}
                                        </div>
                                        {item.reasoningPath && (
                                          <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#0f48f2', background: '#ffffff', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                                            {item.reasoningPath}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}

                          {/* 3. COMPARATIVE VIEW */}
                          {selectedModel === 'compare' && (() => {
                            const comp = comparisonData?.comparison || comparisonData;
                            const rankDeltas = comp?.rankDeltas || [];
                            return (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                                  <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                                    Model Comparison ({rankDeltas.length})
                                  </h4>
                                  <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem' }}>
                                    Baseline vs EGCP v4
                                  </span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.65rem' }}>
                                  Side-by-side rank shifts and evolutionary evidence deltas.
                                </p>

                                {/* Canvas Highlight Switcher */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '0.65rem', fontSize: '0.75rem' }}>
                                  <span style={{ fontWeight: '600', color: '#475569' }}>Highlight on Graph:</span>
                                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                                    <button
                                      className={activeHighlightModel === 'canonical' ? "btn-cobalt" : "btn-secondary-clean"}
                                      style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
                                      onClick={() => setActiveHighlightModel('canonical')}
                                    >
                                      Baseline
                                    </button>
                                    <button
                                      className={activeHighlightModel === 'egcp_v4' ? "btn-cobalt" : "btn-secondary-clean"}
                                      style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
                                      onClick={() => setActiveHighlightModel('egcp_v4')}
                                    >
                                      EGCP v4
                                    </button>
                                  </div>
                                </div>

                                {/* Comparison KPI Summary */}
                                {comp && rankDeltas.length > 0 && (
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem', marginBottom: '0.75rem' }}>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.35rem', textAlign: 'center' }}>
                                      <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Common</div>
                                      <div style={{ fontSize: '0.88rem', fontWeight: '800', color: '#0f172a' }}>{comp.commonCount ?? 0}</div>
                                    </div>
                                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.35rem', textAlign: 'center' }}>
                                      <div style={{ fontSize: '0.65rem', color: '#166534' }}>Promoted</div>
                                      <div style={{ fontSize: '0.88rem', fontWeight: '800', color: '#166534' }}>+{comp.promotedCount ?? 0} ↑</div>
                                    </div>
                                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '0.35rem', textAlign: 'center' }}>
                                      <div style={{ fontSize: '0.65rem', color: '#b45309' }}>Demoted</div>
                                      <div style={{ fontSize: '0.88rem', fontWeight: '800', color: '#b45309' }}>-{comp.demotedCount ?? 0} ↓</div>
                                    </div>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.35rem', textAlign: 'center' }}>
                                      <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Unchanged</div>
                                      <div style={{ fontSize: '0.88rem', fontWeight: '800', color: '#64748b' }}>{comp.unchangedCount ?? 0} =</div>
                                    </div>
                                  </div>
                                )}

                                {(!comp || rankDeltas.length === 0) ? (
                                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                                    Select one or more changed components and click "Analyze Impact".
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '340px', overflowY: 'auto' }}>
                                    {rankDeltas.map((item, index) => {
                                      const isFocused = selectedGraphNode === item.id || selectedGraphNode === item.name;
                                      const shift = item.rankShift || 0;
                                      const egcpItem = egcpReport.find(c => c.id === item.id) || {};
                                      const baseItem = baselineReport.find(c => c.id === item.id) || {};
                                      
                                      const deltaBadge = shift > 0 ? (
                                        <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', fontWeight: '700' }}>
                                          +{shift} ↑ Promoted
                                        </span>
                                      ) : shift < 0 ? (
                                        <span className="badge-clean badge-clean-warning" style={{ fontSize: '0.68rem', fontWeight: '700' }}>
                                          {shift} ↓ Demoted
                                        </span>
                                      ) : (
                                        <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem' }}>
                                          = Unchanged
                                        </span>
                                      );

                                      return (
                                        <div 
                                          key={index}
                                          onClick={() => focusOnNode(item.id || item.name)}
                                          style={{
                                            background: isFocused ? '#eff6ff' : '#f8fafc',
                                            border: isFocused ? '1px solid #0f48f2' : '1px solid #e2e8f0',
                                            borderLeft: shift > 0 ? '4px solid #10b981' : (shift < 0 ? '4px solid #f59e0b' : '4px solid #94a3b8'),
                                            borderRadius: '8px',
                                            padding: '0.65rem 0.85rem',
                                            cursor: 'pointer',
                                            fontSize: '0.82rem'
                                          }}
                                        >
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                            <strong style={{ color: '#0f172a' }}>{item.name}</strong>
                                            {deltaBadge}
                                          </div>

                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', color: '#475569', marginBottom: '0.35rem', background: '#ffffff', padding: '0.35rem 0.55rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                            <div>
                                              <span style={{ color: '#64748b' }}>Baseline:</span> <strong>#{item.baselineRank ?? 'N/A'}</strong>
                                            </div>
                                            <div style={{ color: '#94a3b8' }}>➔</div>
                                            <div>
                                              <span style={{ color: '#0f48f2' }}>EGCP v4:</span> <strong>#{item.egcpRank ?? 'N/A'}</strong> {egcpItem.egcp_v4_score != null && <span style={{ color: '#64748b', fontSize: '0.7rem' }}>({Number(egcpItem.egcp_v4_score).toFixed(4)})</span>}
                                            </div>
                                          </div>

                                          <div style={{ display: 'flex', gap: '0.65rem', fontSize: '0.68rem', color: '#64748b', marginBottom: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                                            <span>Co-Changes: {egcpItem.coChangeCount || 0}</span>
                                            <span>·</span>
                                            <span>Evo Lift: {Number(egcpItem.evolutionaryLift || 0).toFixed(3)}</span>
                                            <span>·</span>
                                            <span>Hop: {egcpItem.hopDistance || baseItem.hopDistance || 1}H</span>
                                          </div>

                                          <div style={{ color: '#475569', fontSize: '0.76rem' }}>
                                            {egcpItem.reason || baseItem.reason || 'Component identified as potentially impacted.'}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            );
                          })()}

                        </div>

                      </div>

                    </div>

                  </div>
                )}
              </div>
            )}

            {/* TAB 2: THREE-MODEL COMPARISON DASHBOARD */}
            {activeTab === 'comparison' && (
              <ThreeWayComparisonDashboard activeRepoPath={repoPath} />
            )}

            {/* TAB 3: RESEARCH & MODEL COMPARISON */}
            {activeTab === 'research' && (
              <BenchmarkDashboard />
            )}

          </div>

        </div>

      </main>

      {/* Footer */}
      <footer style={{ background: '#ffffff', borderTop: '1px solid var(--border-light)', padding: '1.5rem 2rem', textAlign: 'center', color: '#64748b', fontSize: '0.82rem', marginTop: 'auto' }}>
        Context-Aware Software Change Impact Analysis Framework · Evaluated with Spring PetClinic REST, Shopizer, and Commons Lang.
      </footer>

    </div>
  );
}
