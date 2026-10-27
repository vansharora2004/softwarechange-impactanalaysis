import React, { useState, useEffect, useMemo } from 'react';

const API_BASE = 'http://localhost:5000/api';

export default function ThreeWayComparisonDashboard({ activeRepoPath = '' }) {
  // Mode selection: 'historical' | 'live'
  const [analysisMode, setAnalysisMode] = useState('historical');

  // Historical Case Selection State
  const [casesLoading, setCasesLoading] = useState(false);
  const [caseRunning, setCaseRunning] = useState(false);
  const [allCases, setAllCases] = useState([]);
  const [commitsList, setCommitsList] = useState([]);
  const [selectedProject, setSelectedProject] = useState('Spring PetClinic REST');
  const [selectedSplit, setSelectedSplit] = useState('all'); // 'all' | 'train' | 'test'
  const [selectedCommitHash, setSelectedCommitHash] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [historicalCaseResult, setHistoricalCaseResult] = useState(null);

  // Live Analysis State
  const [liveRepoPath, setLiveRepoPath] = useState(activeRepoPath);
  const [liveComponents, setLiveComponents] = useState([]);
  const [liveSeed, setLiveSeed] = useState('');
  const [liveOpType, setLiveOpType] = useState('UNKNOWN_OR_MIXED');
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState(null);
  const [gitDetecting, setGitDetecting] = useState(false);

  // Synchronize liveRepoPath when activeRepoPath changes
  useEffect(() => {
    if (activeRepoPath) {
      setLiveRepoPath(activeRepoPath);
      loadLiveComponents(activeRepoPath);
    }
  }, [activeRepoPath]);

  // Co-Change Evidence Panel State
  const [coChangeEvidence, setCoChangeEvidence] = useState(null);
  const [coChangeLoading, setCoChangeLoading] = useState(false);

  // View & Filter State
  const [viewMode, setViewMode] = useState('side_by_side'); // 'side_by_side' | 'matrix'
  const [topKFilter, setTopKFilter] = useState('top10'); // 'top5' | 'top10' | 'top20' | 'all'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'Controller' | 'Service' | 'Repository' | 'Test' | 'Entity/Model'
  const [selectedCandidateForExplanation, setSelectedCandidateForExplanation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Fetch Historical Cases on Mount
  useEffect(() => {
    loadHistoricalCases();
    loadLiveComponents(activeRepoPath);
  }, []);

  const loadHistoricalCases = async () => {
    setCasesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/evaluation/cases`);
      const data = await res.json();
      if (data.success && data.cases) {
        setAllCases(data.cases);
        setCommitsList(data.commits || []);
        
        // Select first PetClinic case by default
        const petCases = data.cases.filter(c => c.projectName.includes('PetClinic'));
        if (petCases.length > 0) {
          const first = petCases[0];
          setSelectedCommitHash(first.commitHash);
          setSelectedCaseId(first.caseId);
          runCase(first.caseId);
        }
      }
    } catch (err) {
      console.error('Failed to load historical cases:', err);
    } finally {
      setCasesLoading(false);
    }
  };

  const loadLiveComponents = async (targetRepo) => {
    const p = targetRepo || liveRepoPath || activeRepoPath;
    try {
      const url = p ? `${API_BASE}/components?repoPath=${encodeURIComponent(p)}` : `${API_BASE}/components`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.components) {
        setLiveComponents(data.components);
        if (data.components.length > 0) {
          setLiveSeed(data.components[0].id);
        }
      }
    } catch (err) {
      console.warn('Could not load live components:', err.message);
    }
  };

  // Run a selected historical case
  const runCase = async (caseIdToRun) => {
    if (!caseIdToRun) return;
    setCaseRunning(true);
    setSelectedCandidateForExplanation(null);
    try {
      const res = await fetch(`${API_BASE}/evaluation/run-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: caseIdToRun })
      });
      const data = await res.json();
      if (data.success) {
        setHistoricalCaseResult(data);
        // Also fetch co-change evidence for seed
        if (data.caseInfo?.inputComponent) {
          fetchCoChange(data.caseInfo.inputComponent);
        }
      } else {
        alert(`Failed to run case: ${data.error}`);
      }
    } catch (err) {
      alert(`API Error running evaluation case: ${err.message}`);
    } finally {
      setCaseRunning(false);
    }
  };

  // Run live 3-way analysis
  const handleRunLiveAnalysis = async () => {
    if (!liveSeed) {
      alert('Please select a changed seed component.');
      return;
    }
    setLiveRunning(true);
    setSelectedCandidateForExplanation(null);
    try {
      const res = await fetch(`${API_BASE}/analyse-impact-three-way`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changedComponents: [liveSeed],
          repoPath: liveRepoPath,
          editOperation: liveOpType,
          commitLimit: 100
        })
      });
      const data = await res.json();
      if (data.success) {
        setLiveResult(data);
        fetchCoChange(liveSeed);
      } else {
        alert(`Analysis failed: ${data.error}`);
      }
    } catch (err) {
      alert(`API Connection Error: ${err.message}`);
    } finally {
      setLiveRunning(false);
    }
  };

  // Detect Git Changes (Latest Commit / Working tree) for Live Mode
  const handleDetectGitChanges = async () => {
    setGitDetecting(true);
    try {
      const res = await fetch(`${API_BASE}/detect-git-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: liveRepoPath, mode: 'commit' })
      });
      const data = await res.json();
      if (data.success && data.mapped && data.mapped.length > 0) {
        const first = data.mapped[0];
        setLiveSeed(first.componentId);
        if (first.operationCategory) {
          setLiveOpType(first.operationCategory);
        }
      } else {
        alert(data.message || 'No changed Java components detected in latest commit.');
      }
    } catch (err) {
      alert(`Git change detection error: ${err.message}`);
    } finally {
      setGitDetecting(false);
    }
  };

  // Fetch Co-Change Evidence for Seed Component
  const fetchCoChange = async (compId) => {
    setCoChangeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/cochange-evidence/${encodeURIComponent(compId)}?repoPath=${encodeURIComponent(liveRepoPath)}`);
      const data = await res.json();
      if (data.success) {
        setCoChangeEvidence(data);
      }
    } catch (err) {
      console.warn('Could not load co-change evidence:', err);
    } finally {
      setCoChangeLoading(false);
    }
  };

  // Filter cases for the historical selector
  const filteredCasesForProject = useMemo(() => {
    return allCases.filter(c => {
      const matchProj = c.projectName === selectedProject;
      const matchSplit = selectedSplit === 'all' || c.split === selectedSplit;
      return matchProj && matchSplit;
    });
  }, [allCases, selectedProject, selectedSplit]);

  // Unique commits for current project/split
  const availableCommits = useMemo(() => {
    const map = new Map();
    filteredCasesForProject.forEach(c => {
      if (!map.has(c.commitHash)) {
        map.set(c.commitHash, {
          commitHash: c.commitHash,
          shortSha: c.commitShortSha,
          subject: c.commitSubject,
          author: c.commitAuthor,
          date: c.commitDate,
          casesCount: filteredCasesForProject.filter(x => x.commitHash === c.commitHash).length
        });
      }
    });
    return Array.from(map.values());
  }, [filteredCasesForProject]);

  // Cases belonging to currently selected commit
  const casesForCurrentCommit = useMemo(() => {
    return filteredCasesForProject.filter(c => c.commitHash === selectedCommitHash);
  }, [filteredCasesForProject, selectedCommitHash]);

  // Handle project change
  const handleProjectSelect = (proj) => {
    setSelectedProject(proj);
    const projCases = allCases.filter(c => c.projectName === proj);
    if (projCases.length > 0) {
      const first = projCases[0];
      setSelectedCommitHash(first.commitHash);
      setSelectedCaseId(first.caseId);
      runCase(first.caseId);
    }
  };

  // Handle commit change
  const handleCommitSelect = (hash) => {
    setSelectedCommitHash(hash);
    const commCases = filteredCasesForProject.filter(c => c.commitHash === hash);
    if (commCases.length > 0) {
      const first = commCases[0];
      setSelectedCaseId(first.caseId);
      runCase(first.caseId);
    }
  };

  // Active dataset depending on mode
  const activeData = analysisMode === 'historical' ? historicalCaseResult : liveResult;

  // Filter aligned candidates by top-K, component type, and search query
  const filteredAlignedCandidates = useMemo(() => {
    if (!activeData || !activeData.alignedCandidates) return [];
    let list = [...activeData.alignedCandidates];

    // Filter by type
    if (typeFilter !== 'all') {
      list = list.filter(c => {
        if (typeFilter === 'Entity/Model') return c.type === 'Entity' || c.type === 'Model' || c.type === 'Entity/Model';
        return c.type === typeFilter;
      });
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }

    // Filter by top-k (based on EGCP rank)
    if (topKFilter === 'top5') list = list.slice(0, 5);
    else if (topKFilter === 'top10') list = list.slice(0, 10);
    else if (topKFilter === 'top20') list = list.slice(0, 20);

    return list;
  }, [activeData, typeFilter, searchQuery, topKFilter]);

  // Filter individual model prediction lists
  const filterModelList = (list) => {
    if (!list) return [];
    let res = [...list];
    if (typeFilter !== 'all') {
      res = res.filter(c => {
        if (typeFilter === 'Entity/Model') return c.type === 'Entity' || c.type === 'Model' || c.type === 'Entity/Model';
        return c.type === typeFilter;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      res = res.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    if (topKFilter === 'top5') res = res.slice(0, 5);
    else if (topKFilter === 'top10') res = res.slice(0, 10);
    else if (topKFilter === 'top20') res = res.slice(0, 20);
    return res;
  };

  const filteredBaseline = useMemo(() => {
    return filterModelList(activeData?.predictions?.canonical_baseline || activeData?.baselineOutput);
  }, [activeData, typeFilter, searchQuery, topKFilter]);

  const filteredCsf = useMemo(() => {
    return filterModelList(activeData?.predictions?.csf_frozen || activeData?.csfOutput);
  }, [activeData, typeFilter, searchQuery, topKFilter]);

  const filteredEgcp = useMemo(() => {
    return filterModelList(activeData?.predictions?.egcp_v4 || activeData?.egcpOutput);
  }, [activeData, typeFilter, searchQuery, topKFilter]);

  const caseInfo = historicalCaseResult?.caseInfo;
  const verifiedMetrics = historicalCaseResult?.verifiedBenchmarkMetrics;
  const workedExample = historicalCaseResult?.workedExample;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', color: '#0f172a' }}>
      
      {/* ── TOP HEADER / MODE SWITCHER ── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '1.25rem 1.5rem',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
            <span style={{
              background: 'linear-gradient(135deg, #0f48f2 0%, #38bdf8 100%)',
              color: '#fff',
              fontSize: '0.72rem',
              fontWeight: '700',
              padding: '0.2rem 0.6rem',
              borderRadius: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}>
              3-Model Evaluation Suite
            </span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
              Change Impact Comparison Dashboard
            </h2>
          </div>
          <p style={{ fontSize: '0.84rem', color: '#64748b', margin: 0 }}>
            Compare <strong>Model A (Canonical Baseline)</strong>, <strong>Model B (CSF Frozen Baseline)</strong>, and <strong>Model C (EGCP v4 Combined)</strong> across identical candidate universes.
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '10px', gap: '4px' }}>
          <button
            onClick={() => setAnalysisMode('historical')}
            style={{
              background: analysisMode === 'historical' ? '#ffffff' : 'transparent',
              color: analysisMode === 'historical' ? '#0f48f2' : '#64748b',
              border: 'none',
              padding: '0.45rem 1rem',
              borderRadius: '7px',
              fontSize: '0.82rem',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: analysisMode === 'historical' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <span>Historical Benchmark Mode</span>
            <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.65rem' }}>
              25 Commits · 170 Cases
            </span>
          </button>
          <button
            onClick={() => setAnalysisMode('live')}
            style={{
              background: analysisMode === 'live' ? '#ffffff' : 'transparent',
              color: analysisMode === 'live' ? '#0f48f2' : '#64748b',
              border: 'none',
              padding: '0.45rem 1rem',
              borderRadius: '7px',
              fontSize: '0.82rem',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: analysisMode === 'live' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <span>Live Working Tree Mode</span>
            <span className="badge-clean badge-clean-success" style={{ fontSize: '0.65rem' }}>
              Git Diff
            </span>
          </button>
        </div>
      </div>

      {/* ── PANEL A: CHANGE SELECTION PANEL ── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Panel A: Change Selection & Context Configuration
            </h3>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              {analysisMode === 'historical'
                ? 'Select an empirical historical evaluation case from the 3 evaluated repositories.'
                : 'Inspect current workspace working tree or detect changes from latest Git commits.'}
            </span>
          </div>
          {analysisMode === 'historical' && (
            <span className="badge-clean badge-clean-primary" style={{ fontFamily: 'var(--font-mono)' }}>
              Split: {caseInfo?.split || 'Chronological Split'}
            </span>
          )}
        </div>

        {/* HISTORICAL SELECTION CONTROLS */}
        {analysisMode === 'historical' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              
              {/* 1. Project Dropdown */}
              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  1. Target Repository
                </label>
                <select
                  value={selectedProject}
                  onChange={(e) => handleProjectSelect(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    background: '#f8fafc',
                    fontWeight: '600'
                  }}
                >
                  <option value="Spring PetClinic REST">Spring PetClinic REST (8 commits, 57 cases)</option>
                  <option value="Shopizer">Shopizer (12 commits, 46 cases)</option>
                  <option value="Apache Commons Lang">Apache Commons Lang (5 commits, 67 cases)</option>
                </select>
              </div>

              {/* 2. Split Filter */}
              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  2. Dataset Split
                </label>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {['all', 'train', 'test'].map(s => (
                    <button
                      key={s}
                      onClick={() => setSelectedSplit(s)}
                      style={{
                        flex: 1,
                        padding: '0.55rem 0.4rem',
                        borderRadius: '8px',
                        border: selectedSplit === s ? '1px solid #0f48f2' : '1px solid #cbd5e1',
                        background: selectedSplit === s ? '#eff6ff' : '#f8fafc',
                        color: selectedSplit === s ? '#0f48f2' : '#475569',
                        fontSize: '0.76rem',
                        fontWeight: '700',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      {s === 'all' ? 'All Splits' : (s === 'train' ? 'Train (70%)' : 'Test (30%)')}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Git Commit Selector */}
              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  3. Git Commit ({availableCommits.length} Available)
                </label>
                <select
                  value={selectedCommitHash}
                  onChange={(e) => handleCommitSelect(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    fontFamily: 'var(--font-mono)',
                    background: '#f8fafc'
                  }}
                >
                  {availableCommits.map(c => (
                    <option key={c.commitHash} value={c.commitHash}>
                      [{c.shortSha}] {c.subject.slice(0, 42)}... ({c.casesCount} cases)
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Seed Component Case */}
              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  4. Leave-One-Out Seed File
                </label>
                <select
                  value={selectedCaseId}
                  onChange={(e) => {
                    setSelectedCaseId(e.target.value);
                    runCase(e.target.value);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    fontFamily: 'var(--font-mono)',
                    background: '#f8fafc',
                    fontWeight: '600',
                    color: '#0f48f2'
                  }}
                >
                  {casesForCurrentCommit.map(c => (
                    <option key={c.caseId} value={c.caseId}>
                      {c.inputComponentName} ({c.targetOraclesCount} target files)
                    </option>
                  ))}
                </select>
              </div>

            </div>

            {/* Detailed Metadata Banner for Selected Historical Case */}
            {caseInfo && (
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '1rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.75rem',
                fontSize: '0.8rem'
              }}>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: '700' }}>Commit SHA & Date</span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#0f172a', marginTop: '2px' }}>
                    {caseInfo.commitShortSha} · <span style={{ color: '#475569', fontWeight: '500' }}>{caseInfo.commitDate}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.74rem' }}>Author: {caseInfo.commitAuthor}</div>
                </div>

                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: '700' }}>Commit Message</span>
                  <div style={{ fontWeight: '600', color: '#0f172a', marginTop: '2px' }}>
                    "{caseInfo.commitSubject}"
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: '700' }}>Detected Operation Type</span>
                  <div style={{ marginTop: '2px', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <span className="badge-clean badge-clean-primary" style={{ fontFamily: 'var(--font-mono)' }}>
                      {caseInfo.primaryOp}
                    </span>
                    <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem' }}>
                      AST Parsed
                    </span>
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: '700' }}>Ground-Truth Target Files</span>
                  <div style={{ marginTop: '2px', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <strong style={{ color: '#0f48f2', fontSize: '0.95rem' }}>{caseInfo.targetOraclesCount}</strong>
                    <span style={{ color: '#475569', fontSize: '0.75rem' }}>files co-changed in commit (LOO proxy)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* LIVE WORKING TREE SELECTION CONTROLS */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  Workspace Repository Path
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={liveRepoPath}
                    onChange={(e) => setLiveRepoPath(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  <button
                    onClick={handleDetectGitChanges}
                    disabled={gitDetecting}
                    className="btn-secondary-clean"
                    style={{ padding: '0.5rem 0.85rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                  >
                    {gitDetecting ? 'Detecting...' : 'Detect Latest Commit'}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  Seed Component ({liveComponents.length} in graph)
                </label>
                <select
                  value={liveSeed}
                  onChange={(e) => setLiveSeed(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    fontFamily: 'var(--font-mono)',
                    background: '#f8fafc'
                  }}
                >
                  {liveComponents.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
                  Operation Category
                </label>
                <select
                  value={liveOpType}
                  onChange={(e) => setLiveOpType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    fontFamily: 'var(--font-mono)',
                    background: '#f8fafc'
                  }}
                >
                  <option value="STRUCTURAL_METHOD_CHANGE">STRUCTURAL_METHOD_CHANGE</option>
                  <option value="ADD_DELETE_OR_RENAME">ADD_DELETE_OR_RENAME</option>
                  <option value="FIELD_SIGNATURE_CHANGE">FIELD_SIGNATURE_CHANGE</option>
                  <option value="METHOD_SIGNATURE_CHANGE">METHOD_SIGNATURE_CHANGE</option>
                  <option value="UNKNOWN_OR_MIXED">UNKNOWN_OR_MIXED</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleRunLiveAnalysis}
                disabled={liveRunning || !liveSeed}
                className="btn-cobalt"
                style={{ padding: '0.65rem 1.5rem', fontSize: '0.88rem' }}
              >
                {liveRunning ? 'Executing 3 Models...' : 'Run 3-Model Impact Comparison'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── PANEL F: COMPARISON SUMMARY & BENCHMARK KPI BAR ── */}
      {activeData && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Panel F: Candidate Universe & Overlap Summary
            </h3>
            <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.72rem' }}>
              Candidate Universe: {activeData.candidateUniverseSize || activeData.comparisonSummary?.totalCandidates || 0} Components
            </span>
          </div>

          {/* Metric Cards Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>Shared All 3</span>
              <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                {activeData.comparisonSummary?.sharedAllThreeCount ?? 0}
              </div>
            </div>

            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.68rem', color: '#1e40af', textTransform: 'uppercase', fontWeight: '700' }}>Base ∩ CSF (Top 5)</span>
              <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#1e40af', fontFamily: 'var(--font-mono)' }}>
                {activeData.comparisonSummary?.pairwiseOverlap?.baseline_csf_top5 ?? 0} / 5
              </div>
            </div>

            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.68rem', color: '#166534', textTransform: 'uppercase', fontWeight: '700' }}>Base ∩ EGCP (Top 5)</span>
              <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#166534', fontFamily: 'var(--font-mono)' }}>
                {activeData.comparisonSummary?.pairwiseOverlap?.baseline_egcp_top5 ?? 0} / 5
              </div>
            </div>

            <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.68rem', color: '#6b21a8', textTransform: 'uppercase', fontWeight: '700' }}>CSF ∩ EGCP (Top 5)</span>
              <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#6b21a8', fontFamily: 'var(--font-mono)' }}>
                {activeData.comparisonSummary?.pairwiseOverlap?.csf_egcp_top5 ?? 0} / 5
              </div>
            </div>

            {analysisMode === 'historical' && verifiedMetrics && (
              <>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>Baseline AP</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#475569', fontFamily: 'var(--font-mono)' }}>
                    {Number(verifiedMetrics.canonical_baseline?.map || 0).toFixed(4)}
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>CSF Frozen AP</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#475569', fontFamily: 'var(--font-mono)' }}>
                    {Number(verifiedMetrics.csf_frozen?.map || 0).toFixed(4)}
                  </div>
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.68rem', color: '#15803d', textTransform: 'uppercase', fontWeight: '700' }}>EGCP v4 AP (Top)</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#15803d', fontFamily: 'var(--font-mono)' }}>
                    {Number(verifiedMetrics.egcp_v4_combined?.map || 0).toFixed(4)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CONTROLS & FILTER TOOLBAR ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '0.75rem 1.25rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          
          {/* View Mode Toggle */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '2px', borderRadius: '8px', gap: '2px' }}>
            <button
              onClick={() => setViewMode('side_by_side')}
              style={{
                background: viewMode === 'side_by_side' ? '#ffffff' : 'transparent',
                color: viewMode === 'side_by_side' ? '#0f48f2' : '#64748b',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.76rem',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              3 Columns Side-by-Side
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              style={{
                background: viewMode === 'matrix' ? '#ffffff' : 'transparent',
                color: viewMode === 'matrix' ? '#0f48f2' : '#64748b',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.76rem',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Unified Aligned Matrix
            </button>
          </div>

          {/* Top-K Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: '#475569' }}>
            <span style={{ fontWeight: '600' }}>Depth:</span>
            <select
              value={topKFilter}
              onChange={(e) => setTopKFilter(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.76rem', background: '#f8fafc' }}
            >
              <option value="top5">Top 5 Candidates</option>
              <option value="top10">Top 10 Candidates</option>
              <option value="top20">Top 20 Candidates</option>
              <option value="all">All Structural Candidates</option>
            </select>
          </div>

          {/* Component Type Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: '#475569' }}>
            <span style={{ fontWeight: '600' }}>Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.76rem', background: '#f8fafc' }}
            >
              <option value="all">All Types</option>
              <option value="Controller">Controllers Only</option>
              <option value="Service">Services Only</option>
              <option value="Repository">Repositories Only</option>
              <option value="Test">Tests Only</option>
              <option value="Entity/Model">Entities / Models Only</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div>
          <input
            type="text"
            placeholder="Search candidate name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.78rem',
              width: '200px'
            }}
          />
        </div>
      </div>

      {/* ── PANEL B: THREE-MODEL PREDICTION COMPARISON (3 COLUMNS VIEW) ── */}
      {viewMode === 'side_by_side' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
          
          {/* COLUMN 1: CANONICAL STRUCTURAL BASELINE */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '1.25rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.65rem' }}>
              <div>
                <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'inline-block' }}>
                  Model A · Production Engine
                </span>
                <h4 style={{ fontSize: '0.98rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                  Canonical Structural Baseline
                </h4>
                <p style={{ fontSize: '0.74rem', color: '#64748b', margin: '2px 0 0 0' }}>
                  Deterministic BFS 2-hop structural dependency reachability.
                </p>
              </div>
              <span style={{ fontSize: '0.82rem', fontWeight: '800', color: '#0f48f2', fontFamily: 'var(--font-mono)' }}>
                {filteredBaseline.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '550px', overflowY: 'auto', paddingRight: '4px' }}>
              {filteredBaseline.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.82rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                  No structural candidates match the current filters.
                </div>
              ) : (
                filteredBaseline.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    onClick={() => setSelectedCandidateForExplanation(item)}
                    style={{
                      background: selectedCandidateForExplanation?.id === item.id ? '#eff6ff' : '#f8fafc',
                      border: item.isHit ? '2px solid #10b981' : (selectedCandidateForExplanation?.id === item.id ? '1px solid #0f48f2' : '1px solid #e2e8f0'),
                      borderLeft: item.isHit ? '5px solid #10b981' : (item.impactLevel === 'High' ? '4px solid #ef4444' : '4px solid #0284c7'),
                      borderRadius: '8px',
                      padding: '0.65rem 0.85rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <strong style={{ color: '#0f172a' }}>#{item.rank || idx + 1} {item.name}</strong>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        {item.isHit && (
                          <span className="badge-clean badge-clean-success" style={{ fontSize: '0.65rem', fontWeight: '800' }}>
                            HIT ✓
                          </span>
                        )}
                        <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.65rem' }}>
                          {item.type} ({item.hopDistance || 1}H)
                        </span>
                      </div>
                    </div>
                    <div style={{ color: '#475569', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      {item.reason}
                    </div>
                    {item.reasoningPath && (
                      <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: '#0f48f2', background: '#ffffff', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                        {item.reasoningPath}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* COLUMN 2: CONTINUOUS SCORE FUSION (CSF FROZEN BASELINE) */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '1.25rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.65rem' }}>
              <div>
                <span className="badge-clean" style={{ background: '#f1f5f9', color: '#475569', fontSize: '0.65rem', marginBottom: '0.2rem', display: 'inline-block' }}>
                  Model B · Previous Research Baseline
                </span>
                <h4 style={{ fontSize: '0.98rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                  Continuous Score Fusion (CSF)
                </h4>
                <p style={{ fontSize: '0.74rem', color: '#64748b', margin: '2px 0 0 0' }}>
                  Frozen multi-channel weights (w_cond: 0.35, w_hist: 0.35, w_gen: 0.15, w_struct: 0.15).
                </p>
              </div>
              <span style={{ fontSize: '0.82rem', fontWeight: '800', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                {filteredCsf.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '550px', overflowY: 'auto', paddingRight: '4px' }}>
              {filteredCsf.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.82rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                  No candidates match the current filters.
                </div>
              ) : (
                filteredCsf.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    onClick={() => setSelectedCandidateForExplanation(item)}
                    style={{
                      background: selectedCandidateForExplanation?.id === item.id ? '#eff6ff' : '#f8fafc',
                      border: item.isHit ? '2px solid #10b981' : (selectedCandidateForExplanation?.id === item.id ? '1px solid #0f48f2' : '1px solid #e2e8f0'),
                      borderLeft: item.isHit ? '5px solid #10b981' : '4px solid #6366f1',
                      borderRadius: '8px',
                      padding: '0.65rem 0.85rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <strong style={{ color: '#0f172a' }}>#{item.rank || idx + 1} {item.name}</strong>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        {item.isHit && (
                          <span className="badge-clean badge-clean-success" style={{ fontSize: '0.65rem', fontWeight: '800' }}>
                            HIT ✓
                          </span>
                        )}
                        <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
                          Score: {Number(item.score || 0).toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.68rem', color: '#64748b', marginBottom: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                      <span>S_cond: {item.sCond != null ? Number(item.sCond).toFixed(3) : '0'}</span>
                      <span>·</span>
                      <span>S_hist: {item.sHist != null ? Number(item.sHist).toFixed(3) : '0'}</span>
                      <span>·</span>
                      <span>Co-Change: {item.coChangeCount || 0}</span>
                    </div>
                    <div style={{ color: '#475569', fontSize: '0.75rem' }}>
                      {item.reason}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* COLUMN 3: EGCP v4 COMBINED (WINNER) */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #bbf7d0',
            borderRadius: '14px',
            padding: '1.25rem',
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.65rem' }}>
              <div>
                <span className="badge-clean badge-clean-success" style={{ fontSize: '0.65rem', marginBottom: '0.2rem', display: 'inline-block' }}>
                  Model C · Research Benchmark Finalist
                </span>
                <h4 style={{ fontSize: '0.98rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                  EGCP v4 Combined
                </h4>
                <p style={{ fontSize: '0.74rem', color: '#64748b', margin: '2px 0 0 0' }}>
                  Entropy-Adaptive Beta + Hub Suppression + Gated-Op + Dampening.
                </p>
              </div>
              <span style={{ fontSize: '0.82rem', fontWeight: '800', color: '#166534', fontFamily: 'var(--font-mono)' }}>
                {filteredEgcp.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '550px', overflowY: 'auto', paddingRight: '4px' }}>
              {filteredEgcp.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.82rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                  No candidates match the current filters.
                </div>
              ) : (
                filteredEgcp.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    onClick={() => setSelectedCandidateForExplanation(item)}
                    style={{
                      background: selectedCandidateForExplanation?.id === item.id ? '#eff6ff' : '#f0fdf4',
                      border: item.isHit ? '2px solid #10b981' : (selectedCandidateForExplanation?.id === item.id ? '1px solid #0f48f2' : '1px solid #bbf7d0'),
                      borderLeft: item.isHit ? '5px solid #10b981' : '4px solid #10b981',
                      borderRadius: '8px',
                      padding: '0.65rem 0.85rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <strong style={{ color: '#0f172a' }}>#{item.rank || idx + 1} {item.name}</strong>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        {item.isHit && (
                          <span className="badge-clean badge-clean-success" style={{ fontSize: '0.65rem', fontWeight: '800' }}>
                            HIT ✓
                          </span>
                        )}
                        <span className="badge-clean badge-clean-success" style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
                          Score: {Number(item.score || 0).toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.68rem', color: '#166534', marginBottom: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                      <span>Struct: {Number(item.structuralScore || 0).toFixed(3)}</span>
                      <span>·</span>
                      <span>Evo: {Number(item.evolutionaryScore || 0).toFixed(3)}</span>
                      <span>·</span>
                      <span>β: {item.betaAdaptive != null ? Number(item.betaAdaptive).toFixed(3) : 'N/A'}</span>
                    </div>
                    <div style={{ color: '#475569', fontSize: '0.75rem' }}>
                      {item.reason}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── PANEL D: VISUAL PREDICTION-VERSUS-HISTORY MATRIX TABLE ── */}
      {viewMode === 'matrix' && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '1.25rem',
          boxShadow: 'var(--shadow-sm)',
          overflowX: 'auto'
        }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                Panel D: Unified Candidate Alignment & Rank Shift Matrix
              </h3>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '2px 0 0 0' }}>
                All models evaluated against the identical structural candidate universe. Positive rank shifts indicate promotion by EGCP v4.
              </p>
            </div>
            <span className="badge-clean badge-clean-primary">
              Showing {filteredAlignedCandidates.length} Components
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700' }}>Candidate Component</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700' }}>Type</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700', textAlign: 'center' }}>Baseline Rank</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700', textAlign: 'center' }}>CSF Rank</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700', textAlign: 'center' }}>EGCP v4 Rank</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700', textAlign: 'center' }}>EGCP Shift vs Base</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700' }}>Co-Change Frequency</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700', textAlign: 'center' }}>Ground Truth</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: '700', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlignedCandidates.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    No candidates match the current filter criteria.
                  </td>
                </tr>
              ) : (
                filteredAlignedCandidates.map((c, idx) => {
                  const shift = c.egcpVsBaselineShift || 0;
                  const shiftBadge = shift > 0 ? (
                    <span style={{ color: '#166534', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>+{shift} ↑</span>
                  ) : shift < 0 ? (
                    <span style={{ color: '#b45309', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>{shift} ↓</span>
                  ) : (
                    <span style={{ color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>= 0</span>
                  );

                  return (
                    <tr
                      key={c.id || idx}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: c.isHit ? '#f0fdf4' : (idx % 2 === 0 ? '#ffffff' : '#fcfdfe')
                      }}
                    >
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>{c.name}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{c.id}</div>
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem' }}>
                          {c.type}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: '700' }}>
                        #{c.baselineRank || '-'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#6366f1' }}>
                        #{c.csfRank || '-'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#0f48f2' }}>
                        #{c.egcpRank || '-'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                        {shiftBadge}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (c.normalizedCoChange || 0) * 100)}%`, height: '100%', background: '#0f48f2', borderRadius: '3px' }}></div>
                          </div>
                          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: '#475569', minWidth: '35px' }}>
                            {c.coChangeCount || 0}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                        {c.isHit ? (
                          <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', fontWeight: '800' }}>
                            HIT ✓
                          </span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                        <button
                          onClick={() => setSelectedCandidateForExplanation(c)}
                          className="btn-secondary-clean"
                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
                        >
                          Explain
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── PANEL E: CANDIDATE EXPLANATION DRAWER / CARD ── */}
      {selectedCandidateForExplanation && (
        <div style={{
          background: '#ffffff',
          border: '2px solid #0f48f2',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.65rem' }}>
            <div>
              <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem', marginBottom: '0.25rem', display: 'inline-block' }}>
                Panel E: Candidate Evidence & Explanation Breakdown
              </span>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                {selectedCandidateForExplanation.name}
              </h3>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#64748b' }}>
                {selectedCandidateForExplanation.id}
              </span>
            </div>
            <button
              onClick={() => setSelectedCandidateForExplanation(null)}
              className="btn-secondary-clean"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
            >
              Close Explanation ✕
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.82rem' }}>
            {/* 1. Structural Reachability */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <strong style={{ color: '#0f48f2', display: 'block', marginBottom: '0.4rem' }}>
                1. Structural Graph Reachability
              </strong>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                Hop Distance: <strong>{selectedCandidateForExplanation.hopDistance || 1}</strong>
              </div>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                Baseline Rank: <strong>#{selectedCandidateForExplanation.baselineRank || 'N/A'}</strong>
              </div>
              <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: '#0f48f2', background: '#fff', padding: '0.3rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                {selectedCandidateForExplanation.reasoningPath || `${selectedCandidateForExplanation.name} reachable via 2-hop structural traversal`}
              </div>
            </div>

            {/* 2. OCCP Evidence */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <strong style={{ color: '#6366f1', display: 'block', marginBottom: '0.4rem' }}>
                2. OCCP Path Evidence (Model B)
              </strong>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                CSF Score: <strong>{Number(selectedCandidateForExplanation.csfScore || selectedCandidateForExplanation.score || 0).toFixed(4)}</strong>
              </div>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                CSF Rank: <strong>#{selectedCandidateForExplanation.csfRank || selectedCandidateForExplanation.rank || 'N/A'}</strong>
              </div>
              <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
                Evaluates conditioned path signatures and generic fallback with Laplace smoothing.
              </div>
            </div>

            {/* 3. EGCP v4 Propagation Lift */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '0.85rem' }}>
              <strong style={{ color: '#166534', display: 'block', marginBottom: '0.4rem' }}>
                3. EGCP v4 Propagation Lift (Model C)
              </strong>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                EGCP Score: <strong>{Number(selectedCandidateForExplanation.egcpScore || selectedCandidateForExplanation.score || 0).toFixed(4)}</strong>
              </div>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                EGCP Rank: <strong>#{selectedCandidateForExplanation.egcpRank || selectedCandidateForExplanation.rank || 'N/A'}</strong>
              </div>
              <div style={{ color: '#166534', fontSize: '0.74rem' }}>
                {selectedCandidateForExplanation.reason || 'RWR lift over structural & evolutionary channels.'}
              </div>
            </div>

            {/* 4. Co-Change Evidence */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <strong style={{ color: '#0f172a', display: 'block', marginBottom: '0.4rem' }}>
                4. Historical Git Co-Change Evidence
              </strong>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                Co-Change Count: <strong>{selectedCandidateForExplanation.coChangeCount || 0} prior commits</strong>
              </div>
              <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
                {selectedCandidateForExplanation.coChangeCount > 0
                  ? `Observed together in Git commit history strictly prior to the current commit.`
                  : `Zero prior co-change detected in git log window; candidate ranked on structural signal.`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PANEL C: GIT-HISTORY EVIDENCE PANEL ── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '1.25rem 1.5rem',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
              Panel C: Historical Git Co-Change Evidence ({coChangeEvidence?.coChangedComponents?.length || 0} Coupled Files)
            </h3>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Files that changed alongside the seed component in prior chronological Git commits (strictly leak-free j &gt; c).
            </span>
          </div>
          <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem' }}>
            Commits Analyzed: {coChangeEvidence?.totalCommitsAnalyzed || 100}
          </span>
        </div>

        {/* Methodology Transparency Disclaimer Banner */}
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '10px',
          padding: '0.75rem 1rem',
          fontSize: '0.78rem',
          color: '#92400e',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <span style={{ fontSize: '1.1rem' }}>ℹ️</span>
          <div>
            <strong>Evaluation Methodology Note:</strong> Historical co-change measures commit co-occurrence frequency in version control.
            In this benchmark, same-commit co-change serves as a reproducible empirical <strong>Leave-One-Out (LOO) proxy</strong> for change coupling,
            which differs from human-verified causal dependency analysis.
          </div>
        </div>

        {/* Co-change list */}
        {coChangeLoading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
            Loading historical co-change associations...
          </div>
        ) : (!coChangeEvidence || coChangeEvidence.coChangedComponents?.length === 0) ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.85rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
            No prior historical co-change records found for this seed component in the analyzed commit window.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', maxHeight: '280px', overflowY: 'auto' }}>
            {coChangeEvidence.coChangedComponents.slice(0, 12).map((item, idx) => (
              <div
                key={item.id || idx}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.8rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <strong style={{ color: '#0f172a' }}>{item.name}</strong>
                  <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                    {item.count} commits
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: '#64748b' }}>
                  <span>Relative Frequency:</span>
                  <div style={{ flex: 1, height: '5px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${item.normalizedFrequency * 100}%`, height: '100%', background: '#0f48f2', borderRadius: '3px' }}></div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{item.normalizedFrequency * 100}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── STEP-BY-STEP WORKED MATHEMATICAL CALCULATION (FOR HISTORICAL MODE) ── */}
      {analysisMode === 'historical' && workedExample && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', marginBottom: '0.2rem', display: 'inline-block' }}>
                Mathematical Verification
              </span>
              <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                Step-by-Step Worked Numerical Example ({workedExample.model})
              </h3>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '2px 0 0 0' }}>
                Rank-by-rank precision accumulation for AP = (1 / |Targets|) * Σ P@k * rel(k).
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.35rem 0.65rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Average Precision</span>
                <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#0f48f2', fontFamily: 'var(--font-mono)' }}>
                  {Number(workedExample.summary.averagePrecision || 0).toFixed(4)}
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.35rem 0.65rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Reciprocal Rank</span>
                <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#166534', fontFamily: 'var(--font-mono)' }}>
                  {workedExample.summary.reciprocalRank ? Number(workedExample.summary.reciprocalRank).toFixed(4) : '0'}
                </div>
              </div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>Rank k</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Predicted Candidate</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>EGCP Score</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>Ground Truth Hit?</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>Cumulative Hits</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>Precision@k</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>AP Contribution</th>
              </tr>
            </thead>
            <tbody>
              {workedExample.steps.map((s, idx) => (
                <tr
                  key={s.rank || idx}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: s.isHit ? '#f0fdf4' : (idx % 2 === 0 ? '#ffffff' : '#fcfdfe')
                  }}
                >
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontWeight: '700' }}>
                    #{s.rank}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600', color: '#0f172a' }}>
                    {s.component}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                    {Number(s.score || 0).toFixed(4)}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                    {s.isHit ? (
                      <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', fontWeight: '800' }}>
                        YES (rel=1)
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>NO (rel=0)</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                    {s.cumulativeHits}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#0f48f2' }}>
                    {s.precisionAtK.toFixed(4)}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: '700', color: s.isHit ? '#166534' : '#94a3b8' }}>
                    {s.apContribution > 0 ? `+${s.apContribution.toFixed(4)}` : '0.0000'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
