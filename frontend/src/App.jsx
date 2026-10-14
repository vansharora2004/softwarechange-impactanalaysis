import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:5000/api';

export default function App() {
  // Workflow state
  const [repoPath, setRepoPath] = useState('c:/yashika/STUDY/clg_project/spring-petclinic-rest');
  const [repoAnalyzed, setRepoAnalyzed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzingImpact, setAnalyzingImpact] = useState(false);
  const [neo4jStatus, setNeo4jStatus] = useState('offline');

  // Core data states
  const [components, setComponents] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [selectedChanged, setSelectedChanged] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [baselineReport, setBaselineReport] = useState([]);
  const [contextAwareReport, setContextAwareReport] = useState([]);
  const [impactViewTab, setImpactViewTab] = useState('comparison'); // 'baseline' | 'context' | 'comparison'
  const [expandedPaths, setExpandedPaths] = useState({});
  const [gitDetectedChanges, setGitDetectedChanges] = useState(null);
  const [isDetectingGit, setIsDetectingGit] = useState(false);

  const togglePathExpand = (id) => {
    setExpandedPaths(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Graph filters
  const [filterTypes, setFilterTypes] = useState(['Controller', 'Service', 'Repository', 'Test']);
  const [filterRels, setFilterRels] = useState(['DEPENDS_ON', 'USES', 'TESTS']); // CO_CHANGED_WITH unchecked by default
  const [focusSelectedNeighbor, setFocusSelectedNeighbor] = useState(false);
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
    
    // Compute purely in-memory from the historyData already fetched!
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
        
        // Append historical edges to the graph state
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
  const ticksRef = useRef(0);
  const simulationRef = useRef({
    nodes: [],
    links: [],
    dragNode: null,
    transform: { x: 0, y: 0, scale: 1 },
    isPanning: false,
    panStart: { x: 0, y: 0 },
    hoveredNode: null
  });

  // 1. Scan Repository API
  const handleAnalyzeRepo = async () => {
    setLoading(true);
    setBaselineReport([]);
    setContextAwareReport([]);
    setSelectedChanged([]);
    setSelectedGraphNode(null);
    try {
      const res = await fetch(`${API_BASE}/analyse-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath })
      });
      const data = await res.json();
      if (data.success) {
        setComponents(data.components);
        setRelationships(data.relationships);
        setRepoAnalyzed(true);
        //setNeo4jStatus(data.neo4jStatus === 'synchronized' ? 'online' : 'offline');
      } else {
        alert(`Analysis failed: ${data.error}`);
      }
    } catch (err) {
      alert(`API Connection Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Reset landing state to scan another repository
  const handleResetRepo = () => {
    setRepoAnalyzed(false);
    setComponents([]);
    setRelationships([]);
    setSelectedChanged([]);
    setBaselineReport([]);
    setContextAwareReport([]);
    setSelectedGraphNode(null);
  };

  // 2. Analyze Change Impact API (Runs both Baseline and Context-Aware models)
  const handleAnalyzeImpact = async () => {
    if (selectedChanged.length === 0) return;
    
    setAnalyzingImpact(true);
    try {
      const res = await fetch(`${API_BASE}/analyze-context-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedComponents: selectedChanged })
      });
      const data = await res.json();
      if (data.success) {
        setBaselineReport(data.baselineOutput || []);
        setContextAwareReport(data.contextAwareOutput || []);
      } else {
        alert(`Impact analysis failed: ${data.error}`);
      }
    } catch (err) {
      alert(`API Connection Error: ${err.message}`);
    } finally {
      setAnalyzingImpact(false);
    }
  };

  const handleDetectGit = async (mode) => {
    setIsDetectingGit(true);
    setGitDetectedChanges(null);
    try {
      const res = await fetch('http://localhost:5000/api/detect-git-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, mode })
      });
      const data = await res.json();
      if (data.success) {
        if (data.changedFiles.length === 0) {
          alert('No uncommitted changes detected.');
          setGitDetectedChanges([]);
        } else {
          const detected = data.changedFiles.map(filePath => {
            // Find component with exact path match after normalizing just in case
            const normalizedTarget = filePath.replace(/\\/g, '/').toLowerCase();
            const matchedComp = components.find(c => c.filePath.toLowerCase() === normalizedTarget);
            return {
              filePath,
              componentId: matchedComp ? matchedComp.id : null,
              matched: !!matchedComp
            };
          }).filter(c => c.matched); // Only keep mapped files (like .java components)
          setGitDetectedChanges(detected);
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

  useEffect(() => {
    setBaselineReport([]);
    setContextAwareReport([]);
    setExpandedPaths({});
  }, [selectedChanged]);

  const comparisonData = React.useMemo(() => {
    const allNames = Array.from(new Set([
      ...baselineReport.map(b => b.name),
      ...contextAwareReport.map(c => c.component)
    ]));

    return allNames.map(name => {
      const bItem = baselineReport.find(b => b.name === name);
      const cItem = contextAwareReport.find(c => c.component === name);
      const bIndex = bItem ? baselineReport.indexOf(bItem) + 1 : null;
      const cIndex = cItem ? contextAwareReport.indexOf(cItem) + 1 : null;
      
      return {
        name,
        type: cItem?.impactedType || bItem?.type || 'Other',
        baseline: bItem ? {
          rank: bIndex,
          severity: bItem.impactLevel,
          reason: bItem.reason,
          path: bItem.reasoningPath
        } : null,
        proposed: cItem ? {
          rank: cIndex,
          severity: cItem.severity,
          score: cItem.influenceScore,
          category: cItem.category,
          hopDistance: cItem.hopDistance,
          relEvidence: cItem.relationshipEvidence,
          artifactContext: cItem.artifactContext,
          historyEvidence: cItem.historicalEvidence,
          path: cItem.primaryReasoningPath
        } : null
      };
    }).sort((a, b) => {
      const aRank = a.proposed?.rank ?? (a.baseline?.rank ? a.baseline.rank + 100 : 999);
      const bRank = b.proposed?.rank ?? (b.baseline?.rank ? b.baseline.rank + 100 : 999);
      return aRank - bRank;
    });
  }, [baselineReport, contextAwareReport]);

  const clearSelection = () => {
    setSelectedChanged([]);
  };

  const toggleTypeFilter = (type) => {
    setFilterTypes(prev =>
      prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
    );
  };

  const toggleRelFilter = (type) => {
    setFilterRels(prev =>
      prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
    );
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'Controller': return '#6366f1'; // Indigo
      case 'Service': return '#06b6d4';    // Cyan
      case 'Repository': return '#f59e0b'; // Amber
      case 'Entity/Model': return '#10b981';// Emerald
      case 'Test': return '#a855f7';       // Purple
      default: return '#9ca3af';           // Gray
    }
  };

  // Clean uppercase letters instead of emojis for nodes
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

  const activeRels = React.useMemo(() => {
    return relationships.filter(r => 
      filterRels.includes(r.type) &&
      components.some(c => c.id === r.source && filterTypes.includes(c.type)) &&
      components.some(c => c.id === r.target && filterTypes.includes(c.type))
    );
  }, [relationships, filterRels, filterTypes, components]);

  // --- FOCUSED NEIGHBORHOOD COMPUTATION ---
  const focusedNeighborhood = React.useMemo(() => {
    if (!focusSelectedNeighbor) return null;
    
    let seeds = [];
    if (selectedGraphNode) {
      seeds = [selectedGraphNode];
    } else if (selectedChanged.length > 0) {
      seeds = [...selectedChanged];
    } else {
      return null;
    }

    const set = new Set(seeds);
    activeRels.forEach(r => {
      if (seeds.includes(r.source)) set.add(r.target);
      if (seeds.includes(r.target)) set.add(r.source);
    });
    return set;
  }, [focusSelectedNeighbor, selectedGraphNode, selectedChanged, activeRels]);

  // --- FILTERED GRAPH INITIALIZATION ---
  useEffect(() => {
    if (!repoAnalyzed || components.length === 0) return;

    // 1. Identify which components match the type filters
    let activeComponents = components.filter(c => filterTypes.includes(c.type));

    // 4. Initialize Simulation nodes & links
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const width = canvas.width;
    const height = canvas.height;

    const oldNodeMap = new Map(simulationRef.current.nodes.map(n => [n.id, n]));

    const nodes = activeComponents.map((n, i) => {
      const oldNode = oldNodeMap.get(n.id);
      if (oldNode) {
        return { ...oldNode, type: n.type, filePath: n.filePath };
      }
      const angle = (i / activeComponents.length) * Math.PI * 2;
      const radius = 130 + Math.random() * 90;
      return {
        ...n,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        r: 14
      };
    });

    const links = activeRels.map(l => {
      const sourceNode = nodes.find(n => n.id === l.source);
      const targetNode = nodes.find(n => n.id === l.target);
      return {
        ...l,
        sourceNode,
        targetNode
      };
    }).filter(l => l.sourceNode && l.targetNode);

    simulationRef.current.nodes = nodes;
    simulationRef.current.links = links;
    
    ticksRef.current = 0;

  }, [repoAnalyzed, components, relationships, filterTypes, filterRels, layoutResetTrigger]);

  // --- PHYSICS ENGINE LOOP (CAPPED TICK SIMULATION) ---
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
      
      if (ticksRef.current > 140) {
        return; 
      }
      ticksRef.current++;

      const width = canvas.width;
      const height = canvas.height;
      const center = { x: width / 2, y: height / 2 };

      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy) || 1;
          
          if (dist < 260) {
            const force = (260 - dist) * 0.08;
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
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.hypot(dx, dy) || 1;
        
        const targetDist = 110;
        const force = (dist - targetDist) * 0.03;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        
        n1.vx += fx;
        n1.vy += fy;
        n2.vx -= fx;
        n2.vy -= fy;
      }

      for (const n of nodes) {
        n.vx += (center.x - n.x) * 0.006;
        n.vy += (center.y - n.y) * 0.006;
      }

      for (const n of nodes) {
        if (n === sim.dragNode) continue;
        n.vx *= 0.76;
        n.vy *= 0.76;
        n.x += n.vx;
        n.y += n.vy;
      }
    };

    const render = () => {
      updatePhysics();
      
      const sim = simulationRef.current;
      const { x, y, scale } = sim.transform;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      const visibleLinks = focusedNeighborhood 
        ? sim.links.filter(l => focusedNeighborhood.has(l.sourceNode.id) && focusedNeighborhood.has(l.targetNode.id))
        : sim.links;
        
      const visibleNodes = focusedNeighborhood
        ? sim.nodes.filter(n => focusedNeighborhood.has(n.id))
        : sim.nodes;

      // --- Draw links ---
      visibleLinks.forEach(link => {
        const from = link.sourceNode;
        const to = link.targetNode;

        const isChangedRel = selectedChanged.includes(from.id) || selectedChanged.includes(to.id);
        const isImpactedRel = baselineReport.some(i => i.name === from.id || i.name === to.id);
        const isFocusedRel = selectedGraphNode === from.id || selectedGraphNode === to.id;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);

        if (link.type === 'CO_CHANGED_WITH') {
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(217, 70, 239, 0.6)'; // Soft Fuchsia
          ctx.lineWidth = 1.5;
        } else {
          ctx.setLineDash([]);
          if (isChangedRel && isImpactedRel) {
            ctx.strokeStyle = '#fda4af'; 
            ctx.lineWidth = 2.5;
          } else if (selectedGraphNode && isFocusedRel) {
            ctx.strokeStyle = '#22d3ee'; 
            ctx.lineWidth = 2;
          } else if (isImpactedRel) {
            ctx.strokeStyle = '#60a5fa'; 
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = 'rgba(75, 85, 99, 0.2)';
            ctx.lineWidth = 1;
          }
        }
        
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash for arrow heads and other elements

        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(-6, -4);
        ctx.lineTo(2, 0);
        ctx.lineTo(-6, 4);
        ctx.fillStyle = (isChangedRel && isImpactedRel) ? '#fda4af' : ((selectedGraphNode && isFocusedRel) ? '#22d3ee' : (isImpactedRel ? '#60a5fa' : 'rgba(75, 85, 99, 0.35)'));
        ctx.fill();
        ctx.restore();
      });

      // --- Draw nodes ---
      visibleNodes.forEach(node => {
        const isChanged = selectedChanged.includes(node.id);
        const isFocused = selectedGraphNode === node.id;
        const impacted = baselineReport.find(i => i.name === node.id);

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);

        const baseColor = getTypeColor(node.type);
        ctx.fillStyle = isChanged ? '#f43f5e' : baseColor;
        ctx.strokeStyle = isFocused ? '#22d3ee' : (isChanged ? '#fff' : 'rgba(255,255,255,0.15)');
        ctx.lineWidth = isFocused ? 3.5 : (isChanged ? 2.5 : 2);
        
        ctx.shadowBlur = 0;
        if (isFocused) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 18;
        } else if (isChanged) {
          ctx.shadowColor = '#f43f5e';
          ctx.shadowBlur = 15;
        } else if (impacted) {
          const glowColor = impacted.impactLevel === 'High' ? '#f43f5e' : (impacted.impactLevel === 'Medium' ? '#fbbf24' : '#60a5fa');
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 12;
        } else if (sim.hoveredNode === node) {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 8;
        }

        ctx.fill();
        ctx.shadowBlur = 0; 
        ctx.stroke();

        ctx.fillStyle = '#f3f4f6';
        ctx.font = isFocused ? '600 11px Outfit' : '500 10.5px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(node.name, node.x, node.y - node.r - 6);

        ctx.fillStyle = '#9ca3af';
        ctx.font = '8px Outfit';
        ctx.fillText(node.type.toUpperCase(), node.x, node.y + node.r + 11);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9.5px JetBrains Mono';
        ctx.fillText(getTypeLetter(node.type), node.x, node.y + 3.5);
      });

      ctx.restore();
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [repoAnalyzed, selectedChanged, baselineReport, selectedGraphNode, focusedNeighborhood]);

  // Canvas Mouse handlers
  const getMousePos = (e) => {
    const canvas = canvasRef.current;
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

    const visibleNodes = focusedNeighborhood ? sim.nodes.filter(n => focusedNeighborhood.has(n.id)) : sim.nodes;
    const clickedNode = visibleNodes.find(n => Math.hypot(n.x - worldX, n.y - worldY) < n.r + 15);

    sim.clickStart = { x: pos.x, y: pos.y };

    if (clickedNode) {
      sim.dragNode = clickedNode;
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
    } else if (sim.isPanning) {
      sim.transform.x = pos.x - sim.panStart.x;
      sim.transform.y = pos.y - sim.panStart.y;
    } else {
      const visibleNodes = focusedNeighborhood ? sim.nodes.filter(n => focusedNeighborhood.has(n.id)) : sim.nodes;
      const hover = visibleNodes.find(n => Math.hypot(n.x - worldX, n.y - worldY) < n.r + 15);
      sim.hoveredNode = hover || null;
    }
  };

  const handleMouseUp = (e) => {
    const sim = simulationRef.current;
    const pos = getMousePos(e);

    if (sim.clickStart) {
      const dx = pos.x - sim.clickStart.x;
      const dy = pos.y - sim.clickStart.y;
      if (Math.hypot(dx, dy) < 5) {
        if (sim.dragNode) {
          setSelectedGraphNode(sim.dragNode.id);
        } else if (sim.isPanning) {
          setSelectedGraphNode(null);
        }
      }
    }
    
    sim.dragNode = null;
    sim.isPanning = false;
    sim.clickStart = null;
  };

  const handleZoom = (direction) => {
    const sim = simulationRef.current;
    const factor = direction === 'in' ? 1.15 : 0.85;
    sim.transform.scale = Math.min(Math.max(sim.transform.scale * factor, 0.2), 3);
  };

  const handleResetLayout = () => {
    simulationRef.current.nodes = [];
    simulationRef.current.transform = { x: 0, y: 0, scale: 0.85 };
    ticksRef.current = 0;
    setLayoutResetTrigger(prev => prev + 1);
  };

  // Filtering lists
  const filteredComponents = components.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const typeCounts = components.reduce((acc, c) => {
    acc[c.type] = (acc[c.type] || 0) + 1;
    return acc;
  }, {});

  // --- LANDING SCREEN ---
  if (!repoAnalyzed) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '90vh' }}>
        <div className="glass-panel" style={{ maxWidth: '640px', width: '100%', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '2.1rem', fontWeight: '500', marginBottom: '0.5rem', background: 'linear-gradient(135deg, #fff 40%, var(--color-secondary) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Software Change Impact Intelligence
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Structural dependency scanning, layered software knowledge graphs, and rule-based change propagation.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ fontWeight: 500, fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--color-secondary)', letterSpacing: '0.05em' }}>
              Local Repository Path
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
              <input 
                type="text" 
                className="repo-input"
                style={{ width: '100%', padding: '0.8rem 1.1rem', fontSize: '0.95rem' }}
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="e.g. C:/my-projects/spring-boot-app"
              />
              <button 
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.8rem', justifyContent: 'center', fontSize: '0.95rem' }}
                onClick={handleAnalyzeRepo}
                disabled={loading}
              >
                {loading ? 'Analyzing Repository Contents...' : 'Analyze Repository'}
              </button>
            </div>
          </div>

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
              <div className="spinner-dot"></div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Scanning directories, extracting components, and parsing relationships...</p>
            </div>
          )}

          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
            <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Overview</h4>
            <ul style={{ color: 'var(--text-muted)', fontSize: '0.82rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <li>Point to any local Java directory containing Spring Boot components.</li>
              <li>Processes constructor injections, field injections, and context-specific reference semantics.</li>
              <li>Graph database sync operates automatically if Neo4j is online, with seamless local fallback.</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN DASHBOARD SCREEN ---
  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header glass-panel glow-primary">
        <div className="logo-section">
          <h1>Software Change Impact Intelligence Framework</h1>
          <p>Path: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--color-secondary)' }}>{repoPath}</span></p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.82rem' }} onClick={handleResetRepo}>
            Scan New Project
          </button>
        </div>
      </header>

      {/* Metrics Row */}
      <section className="metrics-grid">
        <div className="metric-card">
          <span className="metric-dot" style={{backgroundColor: getTypeColor('Controller')}}></span>
          <div className="metric-info">
            <h4>Controllers</h4>
            <p>{typeCounts['Controller'] || 0}</p>
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-dot" style={{backgroundColor: getTypeColor('Service')}}></span>
          <div className="metric-info">
            <h4>Services</h4>
            <p>{typeCounts['Service'] || 0}</p>
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-dot" style={{backgroundColor: getTypeColor('Repository')}}></span>
          <div className="metric-info">
            <h4>Repositories</h4>
            <p>{typeCounts['Repository'] || 0}</p>
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-dot" style={{backgroundColor: getTypeColor('Entity/Model')}}></span>
          <div className="metric-info">
            <h4>Entities</h4>
            <p>{typeCounts['Entity/Model'] || 0}</p>
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-dot" style={{backgroundColor: getTypeColor('Test')}}></span>
          <div className="metric-info">
            <h4>Tests</h4>
            <p>{typeCounts['Test'] || 0}</p>
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-dot" style={{backgroundColor: '#9ca3af'}}></span>
          <div className="metric-info">
            <h4>Relationships</h4>
            <p>{relationships.length}</p>
          </div>
        </div>
      </section>

      {/* Main Grid: Visualizer + Sidebar Selector & Impact report */}
      <div className="dashboard-grid">
        
        {/* Left Column: Visualizer & Custom Filters */}
        <section className="visualizer-container">
          <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            
            {/* Toolbar / Filters Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.2rem' }}>Knowledge Graph</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Graph is static. Drag nodes to adjust; click to focus neighborhood.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--color-secondary)', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={focusSelectedNeighbor} 
                    onChange={(e) => setFocusSelectedNeighbor(e.target.checked)}
                  />
                  Focus Direct Neighborhood
                </label>
              </div>
            </div>

            {/* Checkbox Group Filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                <strong style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Node Types</strong>
                {['Controller', 'Service', 'Repository', 'Test', 'Entity/Model', 'Other'].map(type => (
                  <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={filterTypes.includes(type)}
                      onChange={() => toggleTypeFilter(type)}
                    />
                    {type}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '0.4rem' }}>
                <strong style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Relationships</strong>
                {['DEPENDS_ON', 'USES', 'TESTS', 'EXTENDS', 'ASSOCIATED_WITH', 'REFERENCES'].map(rel => (
                  <label key={rel} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={filterRels.includes(rel)}
                      onChange={() => toggleRelFilter(rel)}
                    />
                    {rel}
                  </label>
                ))}
              </div>
            </div>

            {/* Visualizer Canvas */}
            <div className="canvas-wrapper">
              <div className="canvas-controls">
                <button className="canvas-control-btn" title="Zoom In" onClick={() => handleZoom('in')}>+</button>
                <button className="canvas-control-btn" title="Zoom Out" onClick={() => handleZoom('out')}>-</button>
                <button className="canvas-control-btn" title="Re-stabilize Layout" onClick={handleResetLayout}>Reset</button>
              </div>
              <canvas 
                ref={canvasRef} 
                width={800} 
                height={520}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ width: '100%', height: '100%', cursor: 'grab' }}
              />
            </div>
            
            {/* Visual focus details */}
            {selectedGraphNode && (
              <div style={{ background: 'rgba(34, 211, 238, 0.03)', border: '1px solid rgba(34, 211, 238, 0.25)', borderRadius: '8px', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem' }}>
                  Focused Node: <strong style={{ color: '#22d3ee' }}>{selectedGraphNode}</strong> 
                  &nbsp;({components.find(c => c.id === selectedGraphNode)?.type})
                </span>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'rgba(34, 211, 238, 0.08)', borderColor: 'rgba(34, 211, 238, 0.25)' }}
                  onClick={() => toggleComponentSelected(selectedGraphNode)}
                >
                  {selectedChanged.includes(selectedGraphNode) ? 'Remove from Changed' : 'Mark as Changed'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Sidebar Selector & Impact Report */}
        <section className="impact-report-container">

          {/* Git Change Detection Box */}
          <div className="glass-panel selection-card" style={{ marginBottom: '1rem', minHeight: 'unset' }}>
            <div className="component-selector-header" style={{ marginBottom: '0.8rem' }}>
              <h3>Git Change Detection</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem' }} onClick={() => handleDetectGit('local')} disabled={isDetectingGit}>
                {isDetectingGit ? 'Detecting...' : 'Detect Local Changes'}
              </button>
              <button className="btn btn-secondary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem' }} onClick={() => handleDetectGit('commit')} disabled={isDetectingGit}>
                {isDetectingGit ? 'Detecting...' : 'Analyze Latest Commit'}
              </button>
            </div>

            {gitDetectedChanges && gitDetectedChanges.length > 0 && (
              <div style={{ marginTop: '0.8rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Detected Changed Files</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '150px', overflowY: 'auto', paddingRight: '4px' }}>
                  {gitDetectedChanges.map((change, idx) => {
                    const isChecked = change.matched && selectedChanged.includes(change.componentId);
                    return (
                      <div 
                        key={idx} 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', cursor: 'pointer' }}
                        onClick={() => change.matched && toggleComponentSelected(change.componentId)}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-color)', wordBreak: 'break-all', paddingRight: '0.5rem', pointerEvents: 'none' }}>{change.filePath}</span>
                        {change.matched ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                            <span style={{ color: 'var(--color-secondary)' }}>{change.componentId}</span>
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              readOnly
                              style={{ margin: 0, pointerEvents: 'none' }}
                            />
                          </div>
                        ) : (
                          <span style={{ color: '#ef4444', fontStyle: 'italic', whiteSpace: 'nowrap' }}>Unmapped File</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          
          {/* Changed Selection Box */}
          <div className="glass-panel selection-card">
            <div className="component-selector-header">
              <h3>Changed Selection</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {selectedChanged.length > 0 && (
                  <>
                    <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }} onClick={clearSelection}>Clear All</button>
                    <button className="btn btn-primary" style={{ padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem' }} onClick={handleAnalyzeImpact} disabled={analyzingImpact}>
                      {analyzingImpact ? 'Analyzing...' : 'Analyze Impact'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {selectedChanged.length > 0 ? (
              <div className="active-changed-chips">
                {selectedChanged.map(id => {
                  const comp = components.find(c => c.id === id);
                  return (
                    <div key={id} className="chip" style={{ color: '#ffffff', backgroundColor: 'rgba(244, 63, 94, 0.12)', border: '1px solid rgba(244, 63, 94, 0.25)' }}>
                      <span>{id}</span>
                      <span className="chip-remove" onClick={() => toggleComponentSelected(id)}>×</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '0.5rem' }}>
                No changed components selected. Select nodes in the graph or check items in the search list.
              </div>
            )}

            {/* Component Search List */}
            <div>
              <input 
                type="text" 
                className="search-box" 
                placeholder="Filter components by name..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="component-scroll-list">
                {filteredComponents.map(comp => {
                  const isChecked = selectedChanged.includes(comp.id);
                  return (
                    <div 
                      key={comp.id} 
                      className={`component-item ${isChecked ? 'selected' : ''}`}
                      onClick={() => toggleComponentSelected(comp.id)}
                    >
                      <div className="component-item-name">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          readOnly
                          style={{ marginRight: '0.3rem', pointerEvents: 'none' }}
                        />
                        <span>{comp.name}</span>
                      </div>
                      <span className={`badge badge-${comp.type.toLowerCase().replace('/', '')}`}>
                        {comp.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Change Impact Report */}
          <div className="glass-panel" style={{ flex: 1, minHeight: '380px' }}>
            <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Potential Impact Report</h3>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {baselineReport.length > 0 || contextAwareReport.length > 0
                    ? `${baselineReport.length} baseline / ${contextAwareReport.length} proposed candidates`
                    : 'Select changed components to calculate potential impact propagation.'}
                </span>
              </div>

              {(baselineReport.length > 0 || contextAwareReport.length > 0) && (
                <div style={{ display: 'flex', gap: '0.35rem', background: 'rgba(0,0,0,0.35)', padding: '0.2rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <button 
                    className={`btn ${impactViewTab === 'baseline' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.74rem', borderRadius: '4px' }}
                    onClick={() => setImpactViewTab('baseline')}
                  >
                    Baseline ({baselineReport.length})
                  </button>
                  <button 
                    className={`btn ${impactViewTab === 'context' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.74rem', borderRadius: '4px' }}
                    onClick={() => setImpactViewTab('context')}
                  >
                    Context-Aware (Proposed) ({contextAwareReport.length})
                  </button>
                  <button 
                    className={`btn ${impactViewTab === 'comparison' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.74rem', borderRadius: '4px' }}
                    onClick={() => setImpactViewTab('comparison')}
                  >
                    Comparison ({comparisonData.length})
                  </button>
                </div>
              )}
            </div>

            {analyzingImpact ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                Calculating change propagation paths across both baseline and proposed models...
              </div>
            ) : selectedChanged.length === 0 ? (
              <div className="no-impacts-placeholder">
                <div>Select changed components to calculate potential impact propagation.</div>
              </div>
            ) : (baselineReport.length === 0 && contextAwareReport.length === 0) ? (
              <div className="no-impacts-placeholder">
                <div>No potentially impacted components found within 2 hops of selection.</div>
              </div>
            ) : impactViewTab === 'baseline' ? (
              /* VIEW 1: BASELINE MODEL */
              <div className="impact-list">
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <strong>Baseline Structural Model:</strong> Identifies reachable components within 2 hops using graph reachability across dependency and test relationships. Discrete impact categories (High/Medium/Low) based purely on graph distance and relationship type.
                </div>
                {baselineReport.map((item, index) => (
                  <div key={item.name} className={`impact-card ${item.impactLevel.toLowerCase()}-impact`}>
                    <div className="impact-card-title-row">
                      <div className="impact-card-title">
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginRight: '0.2rem' }}>#{index + 1}</span>
                        <span>{item.name}</span>
                        {item.type && (
                          <span className={`badge badge-${item.type.toLowerCase().replace('/', '')}`} style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>
                            {item.type}
                          </span>
                        )}
                      </div>
                      <span className={`badge badge-impact-${item.impactLevel.toLowerCase()}`}>
                        {item.impactLevel} Impact
                      </span>
                    </div>
                    
                    <div className="impact-reason">
                      {item.reason}
                    </div>
                    
                    <div className="impact-path">
                      {item.reasoningPath}
                    </div>
                  </div>
                ))}
              </div>
            ) : impactViewTab === 'context' ? (
              /* VIEW 2: CONTEXT-AWARE MODEL (PROPOSED) */
              <div className="impact-list">
                <div style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.75rem', fontSize: '0.76rem', color: '#c7d2fe', lineHeight: 1.4 }}>
                  <strong>Experimental Proposed Model:</strong> Combines structural distance with relationship semantics, architectural layer context, and historical Git co-change frequency. Scores reflect relative evidence weight, not breakage probabilities.
                </div>

                {/* Non-Regression Impacted Components */}
                {contextAwareReport.filter(r => r.category !== 'Regression Tests').map((item, index) => (
                  <div key={item.component} className={`impact-card ${item.severity.toLowerCase()}-impact`}>
                    <div className="impact-card-title-row">
                      <div className="impact-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>#{index + 1}</span>
                        <span>{item.component}</span>
                        {item.impactedType && (
                          <span className={`badge badge-${item.impactedType.toLowerCase().replace('/', '')}`} style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>
                            {item.impactedType}
                          </span>
                        )}
                        <span style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {item.category}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                          Score: {item.influenceScore.toFixed(2)}
                        </span>
                        <span className={`badge badge-impact-${item.severity.toLowerCase()}`}>
                          {item.severity} Severity
                        </span>
                      </div>
                    </div>

                    {/* Multi-factor Evidence Badges */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.72rem', margin: '0.1rem 0' }}>
                      <span style={{ background: 'rgba(255,255,255,0.03)', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        📏 Distance: <strong>{item.hopDistance}-hop</strong>
                      </span>
                      <span style={{ background: 'rgba(255,255,255,0.03)', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        🔗 Semantics: <strong>{item.relationshipEvidence ? item.relationshipEvidence.join(', ') : 'N/A'}</strong>
                      </span>
                      {item.artifactContext && (
                        <span style={{ background: 'rgba(255,255,255,0.03)', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
                          🏛️ Artifact Flow: <strong>{item.artifactContext}</strong>
                        </span>
                      )}
                      <span style={{ background: 'rgba(255,255,255,0.03)', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        📜 History: <strong style={{ color: item.historicalEvidence > 0 ? '#fbbf24' : 'inherit' }}>
                          {item.historicalEvidence > 0 ? `${item.historicalEvidence} co-change(s)` : '0 (Neutral)'}
                        </strong>
                      </span>
                    </div>

                    <div className="impact-path" style={{ fontSize: '0.78rem' }}>
                      <span style={{ color: 'var(--text-muted)', marginRight: '0.3rem' }}>Primary Path:</span>
                      {item.primaryReasoningPath}
                    </div>

                    {/* Supporting Paths Toggle */}
                    {item.allSupportingPaths && item.allSupportingPaths.length > 1 && (
                      <div style={{ marginTop: '0.2rem' }}>
                        <button 
                          style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', fontSize: '0.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                          onClick={() => togglePathExpand(item.component)}
                        >
                          {expandedPaths[item.component] 
                            ? `▾ Hide ${item.allSupportingPaths.length - 1} supporting path(s)` 
                            : `▸ View ${item.allSupportingPaths.length - 1} alternative path(s)`}
                        </button>
                        
                        {expandedPaths[item.component] && (
                          <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                            {item.allSupportingPaths.map((p, pIdx) => (
                              <div key={pIdx} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.25)', padding: '0.3rem 0.5rem', borderRadius: '4px' }}>
                                <div>{p.reasoningString}</div>
                                <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                                  Base: {p.evidence?.baseInfluence} · Context: {p.evidence?.contextInfluence} · Path Score: {p.score?.toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Dedicated Regression Tests Section */}
                {contextAwareReport.filter(r => r.category === 'Regression Tests').length > 0 && (
                  <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <h4 style={{ fontSize: '0.85rem', color: '#c084fc', margin: 0 }}>
                        🧪 Recommended Regression Tests
                      </h4>
                      <span className="badge badge-test" style={{ fontSize: '0.7rem' }}>
                        {contextAwareReport.filter(r => r.category === 'Regression Tests').length} Tests
                      </span>
                    </div>
                    <div className="impact-list">
                      {contextAwareReport.filter(r => r.category === 'Regression Tests').map(t => (
                        <div key={t.component} className="impact-card" style={{ borderLeft: '4px solid #a855f7', padding: '0.75rem' }}>
                          <div className="impact-card-title-row">
                            <div className="impact-card-title" style={{ fontSize: '0.9rem' }}>
                              <span style={{ color: '#c084fc' }}>🧪 {t.component}</span>
                            </div>
                            <span className="badge badge-test">Recommended Test</span>
                          </div>
                          <div className="impact-path" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }}>
                            {t.primaryReasoningPath}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* VIEW 3: SIDE-BY-SIDE COMPARISON VIEW */
              <div className="impact-list">
                <div style={{ background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.25)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.75rem', fontSize: '0.76rem', color: '#a5f3fc', lineHeight: 1.4 }}>
                  <strong>Side-by-Side Model Comparison (Experimental):</strong> Evaluates the baseline (purely structural reachability) against the experimental proposed model (multi-factor influence score) on the exact same changed component(s). Note: The baseline does not compute a continuous score; it assigns discrete categories based on structural dependency types.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {comparisonData.map(row => (
                    <div key={row.name} style={{ background: 'rgba(20, 26, 40, 0.55)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>{row.name}</strong>
                          <span className={`badge badge-${row.type.toLowerCase().replace('/', '')}`} style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>
                            {row.type}
                          </span>
                          {row.proposed?.category === 'Regression Tests' && (
                            <span className="badge badge-test" style={{ fontSize: '0.68rem' }}>Regression Test</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {row.baseline && row.proposed ? (
                            <span style={{ color: '#10b981' }}>✓ Identified by Both Models</span>
                          ) : row.baseline ? (
                            <span style={{ color: '#f59e0b' }}>Baseline Only</span>
                          ) : (
                            <span style={{ color: '#6366f1' }}>Proposed Only</span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        {/* Baseline Column */}
                        <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', padding: '0.6rem', fontSize: '0.74rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <strong style={{ color: 'var(--text-muted)' }}>Baseline Engine</strong>
                            {row.baseline ? (
                              <span className={`badge badge-impact-${row.baseline.severity.toLowerCase()}`}>
                                {row.baseline.severity} Impact
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not Detected</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                            Rank: <strong>{row.baseline?.rank ? `#${row.baseline.rank}` : '—'}</strong> · Score: <em>N/A (Structural Only)</em>
                          </div>
                          {row.baseline?.path && (
                            <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', padding: '0.25rem 0.4rem', borderRadius: '4px', marginTop: '0.3rem', wordBreak: 'break-all' }}>
                              {row.baseline.path}
                            </div>
                          )}
                        </div>

                        {/* Proposed Column */}
                        <div style={{ background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.15)', borderRadius: '6px', padding: '0.6rem', fontSize: '0.74rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <strong style={{ color: '#a5b4fc' }}>Proposed Model</strong>
                            {row.proposed ? (
                              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#38bdf8', fontSize: '0.75rem' }}>
                                  Score: {row.proposed.score.toFixed(2)}
                                </span>
                                <span className={`badge badge-impact-${row.proposed.severity.toLowerCase()}`}>
                                  {row.proposed.severity}
                                </span>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not Detected</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                            Rank: <strong>{row.proposed?.rank ? `#${row.proposed.rank}` : '—'}</strong> · Context: {row.proposed ? `${row.proposed.artifactContext || 'None'} (${row.proposed.historyEvidence} co-changes)` : '—'}
                          </div>
                          {row.proposed?.path && (
                            <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#a5b4fc', background: 'rgba(0,0,0,0.3)', padding: '0.25rem 0.4rem', borderRadius: '4px', marginTop: '0.3rem', wordBreak: 'break-all' }}>
                              {row.proposed.path}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Historical Context Report */}
          <div className="glass-panel" style={{ flex: 1, minHeight: '340px', marginTop: '1rem' }}>
            <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Historical Context</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Commits:</span>
                <input 
                  type="number" 
                  min="1" 
                  max="1000" 
                  value={commitLimit} 
                  onChange={(e) => setCommitLimit(e.target.value)} 
                  style={{ width: '60px', padding: '0.2rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', fontSize: '0.75rem' }} 
                />
                <button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={handleAnalyzeHistory} disabled={historyLoading}>
                  {historyLoading ? 'Analyzing...' : 'Analyze Git History'}
                </button>
              </div>
            </div>

            {historyData ? (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>Commits Analysed: <strong style={{ color: 'white' }}>{historyData.commitsAnalysed}</strong></div>
                  <div>Components w/ History: <strong style={{ color: 'white' }}>{historyData.uniqueComponents}</strong></div>
                  <div>Historical Relationships: <strong style={{ color: 'white' }}>{historyData.totalRelationships}</strong></div>
                </div>
                
                {componentHistory && componentHistory.data.length > 0 ? (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.75rem', color: 'var(--color-secondary)', marginBottom: '0.5rem' }}>
                      Historical Context for {componentHistory.componentId}
                    </h4>
                    <table style={{ width: '100%', fontSize: '0.75rem', textAlign: 'left', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ padding: '0.5rem', fontWeight: 600 }}>Historically Co-changed Component</th>
                          <th style={{ padding: '0.5rem', fontWeight: 600, textAlign: 'center' }}>Co-change Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {componentHistory.data.map((pair, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                            <td style={{ padding: '0.5rem', color: 'var(--color-secondary)' }}>{pair.target}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'center', color: '#fbbf24', fontWeight: 'bold' }}>{pair.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : historyData.topPairs && historyData.topPairs.length > 0 ? (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Top Repository-Wide Pairs</h4>
                    <table style={{ width: '100%', fontSize: '0.75rem', textAlign: 'left', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ padding: '0.5rem', fontWeight: 600 }}>Component A</th>
                          <th style={{ padding: '0.5rem', fontWeight: 600 }}>Component B</th>
                          <th style={{ padding: '0.5rem', fontWeight: 600, textAlign: 'center' }}>Co-change Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyData.topPairs.map((pair, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                            <td style={{ padding: '0.5rem', color: 'var(--color-secondary)' }}>{pair.source}</td>
                            <td style={{ padding: '0.5rem', color: 'var(--color-secondary)' }}>{pair.target}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'center', color: '#fbbf24', fontWeight: 'bold' }}>{pair.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic', padding: '1rem' }}>
                    No significant co-change history found.
                  </div>
                )}
              </div>
            ) : (
              <div className="no-impacts-placeholder">
                <div>Run Git History analysis to discover historically co-changing components.</div>
              </div>
            )}
          </div>

        </section>

      </div>
    </div>
  );
}
