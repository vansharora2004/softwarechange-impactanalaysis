import React, { useState, useEffect } from 'react';
import { BENCHMARK_MODELS, PROJECT_BREAKDOWN, V4_ABLATIONS } from './benchmarkData';
import RepoResearchView from './RepoResearchView';

// Research page: the analysed repository's own evaluation, with the published 3-project benchmark behind a toggle
export default function BenchmarkDashboard({ activeRepoPath = '' }) {
  const [showPublished, setShowPublished] = useState(false);
  const repoName = activeRepoPath ? activeRepoPath.split(/[\\/]/).filter(Boolean).pop() : '';

  useEffect(() => {
    setShowPublished(false);
  }, [activeRepoPath]);

  if (!activeRepoPath) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1rem', fontSize: '0.84rem', color: '#475569' }}>
          No repository analysed yet. Showing the original published benchmark. Analyse a repository on the Run Analysis tab to see how the models perform on your own project.
        </div>
        <PublishedBenchmark />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <RepoResearchView repoPath={activeRepoPath} repoName={repoName} />

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.84rem', color: '#64748b' }}>
            The original published benchmark (PetClinic / Shopizer / Commons Lang) is separate from your repository's results.
          </span>
          <button className="btn-secondary-clean" style={{ fontSize: '0.8rem' }} onClick={() => setShowPublished(!showPublished)}>
            {showPublished ? 'Hide original published benchmark' : 'View original published benchmark'}
          </button>
        </div>
        {showPublished && <PublishedBenchmark />}
      </div>
    </div>
  );
}

// Original published 3-project benchmark (static figures from research_artifacts/egcp_v4_evaluation_20261021)
function PublishedBenchmark() {
  const [selectedMetric, setSelectedMetric] = useState('map'); // 'map' | 'mrr' | 'p5' | 'r5'
  const [showAblations, setShowAblations] = useState(false);

  const getMetricValue = (model, metric) => {
    switch (metric) {
      case 'map': return model.mapMacro;
      case 'mrr': return model.mrrMacro;
      case 'p5': return model.p5Macro;
      case 'r5': return model.r5Macro;
      default: return model.mapMacro;
    }
  };

  const getMetricLabel = (metric) => {
    switch (metric) {
      case 'map': return 'Mean Average Precision (MAP)';
      case 'mrr': return 'Mean Reciprocal Rank (MRR)';
      case 'p5': return 'Precision@5 (Macro)';
      case 'r5': return 'Recall@5 (Macro)';
      default: return 'MAP';
    }
  };

  // Find max value to normalize bar chart widths
  const maxVal = Math.max(...BENCHMARK_MODELS.map(m => getMetricValue(m, selectedMetric)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Overview Callout Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
        border: '1px solid #bfdbfe',
        borderRadius: '16px',
        padding: '1.5rem',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1.25rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #0f48f2 0%, #2563eb 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: '800',
            boxShadow: '0 4px 12px rgba(15, 72, 242, 0.25)'
          }}>
            #1
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
                Benchmark Finalist: EGCP v4 Combined
              </h3>
              <span className="badge-clean badge-clean-success">
                Rank #1 Overall
              </span>
              <span className="badge-clean badge-clean-primary">
                Frozen Research Artifact
              </span>
            </div>
            <p style={{ fontSize: '0.86rem', color: '#475569', maxWidth: '780px', lineHeight: 1.45 }}>
              In the controlled 25-commit, 170-case empirical benchmark across Spring PetClinic REST, Shopizer, and Commons Lang, 
              <strong> EGCP v4 Combined</strong> achieves the highest macro MAP (<strong>0.1642</strong>, +28.5% over CSF) 
              and held-out test MAP (<strong>0.0992</strong>, +215% over CSF) with zero temporal leakage.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '0.75rem 1.25rem',
            textAlign: 'center',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.04em' }}>
              EGCP v4 MAP
            </span>
            <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#0f48f2', fontFamily: 'var(--font-mono)' }}>
              0.1642
            </div>
          </div>
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '0.75rem 1.25rem',
            textAlign: 'center',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.04em' }}>
              CSF Baseline MAP
            </span>
            <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
              0.1278
            </div>
          </div>
        </div>
      </div>

      {/* Model Comparison Cards */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a' }}>
              Cross-Model Evaluation Summary
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Evaluated on identical chronological split, pre-commit co-change windows, and ground truth sets.
            </p>
          </div>

          {/* Metric Selector Buttons */}
          <div style={{ display: 'flex', background: '#e2e8f0', padding: '3px', borderRadius: '10px', gap: '2px' }}>
            {[
              { id: 'map', label: 'MAP' },
              { id: 'mrr', label: 'MRR' },
              { id: 'p5', label: 'P@5' },
              { id: 'r5', label: 'R@5' }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedMetric(m.id)}
                style={{
                  background: selectedMetric === m.id ? '#ffffff' : 'transparent',
                  color: selectedMetric === m.id ? '#0f48f2' : '#475569',
                  border: 'none',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '7px',
                  fontWeight: selectedMetric === m.id ? '700' : '500',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  boxShadow: selectedMetric === m.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Bar Comparison Chart */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '1.5rem',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem'
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#334155', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
            Showing: <span style={{ color: '#0f48f2' }}>{getMetricLabel(selectedMetric)}</span> across evaluated variants
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {BENCHMARK_MODELS.map(m => {
              const val = getMetricValue(m, selectedMetric);
              const percentage = Math.round((val / (maxVal * 1.15)) * 100);
              const isBest = m.isWinner;

              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: isBest ? '700' : '600', color: isBest ? '#0f48f2' : '#1e293b' }}>
                        {m.name}
                      </span>
                      {isBest && (
                        <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem' }}>
                          Best Candidate
                        </span>
                      )}
                      {m.id === 'canonical_baseline' && (
                        <span className="badge-clean badge-clean-primary" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem' }}>
                          Production Engine
                        </span>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: isBest ? '#0f48f2' : '#334155' }}>
                      {val.toFixed(4)}
                    </span>
                  </div>

                  {/* Visual Bar */}
                  <div style={{ width: '100%', height: '14px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${percentage}%`,
                      height: '100%',
                      background: isBest 
                        ? 'linear-gradient(90deg, #0f48f2 0%, #38bdf8 100%)' 
                        : (m.id === 'csf_frozen' ? '#94a3b8' : '#cbd5e1'),
                      borderRadius: '999px',
                      transition: 'width 0.4s ease'
                    }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Complete Metrics Table */}
      <div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem' }}>
          Official Master Metrics Table (Overall 25-Commit Benchmark)
        </h3>
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '600' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Model Architecture</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>Macro MAP</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>Macro MRR</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>P@5</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>R@5</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>Held-Out Test MAP</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Status & Notes</th>
                </tr>
              </thead>
              <tbody>
                {BENCHMARK_MODELS.map(m => {
                  const isWinner = m.isWinner;
                  return (
                    <tr 
                      key={m.id} 
                      style={{ 
                        borderBottom: '1px solid #f1f5f9',
                        background: isWinner ? 'rgba(239, 246, 255, 0.45)' : '#ffffff',
                        fontWeight: isWinner ? '600' : 'normal'
                      }}
                    >
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <span style={{ color: isWinner ? '#0f48f2' : '#0f172a', fontWeight: '700' }}>
                            {m.name}
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                            {m.description}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: '700', color: isWinner ? '#0f48f2' : '#1e293b' }}>
                        {m.mapMacro.toFixed(4)}
                      </td>
                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#334155' }}>
                        {m.mrrMacro.toFixed(4)}
                      </td>
                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#334155' }}>
                        {m.p5Macro.toFixed(4)}
                      </td>
                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#334155' }}>
                        {m.r5Macro.toFixed(4)}
                      </td>
                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: isWinner ? '700' : 'normal', color: isWinner ? '#10b981' : '#64748b' }}>
                        {m.testMap.toFixed(4)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {isWinner ? (
                          <span className="badge-clean badge-clean-success">
                            Winner (+28.5% over CSF)
                          </span>
                        ) : m.id === 'canonical_baseline' ? (
                          <span className="badge-clean badge-clean-primary">
                            Active Live Engine
                          </span>
                        ) : (
                          <span className="badge-clean" style={{ background: '#f1f5f9', color: '#64748b' }}>
                            Frozen Artifact
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Per-Project Performance Breakdown */}
      <div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem' }}>
          Repository Breakdown (Cross-Project Generalization)
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1rem'
        }}>
          {PROJECT_BREAKDOWN.filter(p => !p.isOverall).map(p => (
            <div 
              key={p.project}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '1.25rem',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.75rem'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                    {p.project}
                  </h4>
                  <span className="badge-clean badge-clean-primary">
                    {p.commits} Commits · {p.cases} Cases
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                  {p.note}
                </p>

                {/* Score comparison pill row */}
                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.82rem'
                }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '0.72rem', display: 'block' }}>CSF Baseline</span>
                    <strong style={{ fontFamily: 'var(--font-mono)', color: '#334155' }}>{p.csfMap.toFixed(4)}</strong>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ color: '#64748b', fontSize: '0.72rem', display: 'block' }}>EGCP v4 (Best)</span>
                    <strong style={{ fontFamily: 'var(--font-mono)', color: '#0f48f2' }}>{p.v4Map.toFixed(4)}</strong>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: '#64748b', fontSize: '0.72rem', display: 'block' }}>Delta vs CSF</span>
                    <strong style={{ color: p.v4DeltaVsCsf.startsWith('+') ? '#10b981' : '#f59e0b', fontSize: '0.85rem' }}>
                      {p.v4DeltaVsCsf}
                    </strong>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                Evaluated under strict temporal cutoffs with no future commit co-change leakage.
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Collapsible V4 Ablation Details */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '1.25rem 1.5rem',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div 
          onClick={() => setShowAblations(!showAblations)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <div>
            <h4 style={{ fontSize: '0.98rem', fontWeight: '700', color: '#0f172a' }}>
              EGCP v4 Architectural Ablation Study (Component Validation)
            </h4>
            <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
              How entropy-adaptive beta, progressive hub suppression, and gated operations contribute to ranking accuracy.
            </p>
          </div>
          <button className="btn-secondary-clean" style={{ fontSize: '0.8rem' }}>
            {showAblations ? 'Hide Ablations' : 'View Ablations'}
          </button>
        </div>

        {showAblations && (
          <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.65rem 0.85rem' }}>Ablation Configuration</th>
                  <th style={{ padding: '0.65rem', textAlign: 'center' }}>Macro MAP</th>
                  <th style={{ padding: '0.65rem', textAlign: 'center' }}>Macro MRR</th>
                  <th style={{ padding: '0.65rem', textAlign: 'center' }}>P@5</th>
                  <th style={{ padding: '0.65rem', textAlign: 'center' }}>R@5</th>
                  <th style={{ padding: '0.65rem', textAlign: 'center' }}>Held-out Test MAP</th>
                </tr>
              </thead>
              <tbody>
                {V4_ABLATIONS.map((ab, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: ab.isWinner ? '#eff6ff' : 'transparent' }}>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: ab.isWinner ? '700' : 'normal', color: ab.isWinner ? '#0f48f2' : '#0f172a' }}>
                      {ab.ablation} {ab.isWinner ? '(Best)' : ''}
                    </td>
                    <td style={{ padding: '0.65rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: '700' }}>{ab.map.toFixed(4)}</td>
                    <td style={{ padding: '0.65rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{ab.mrr.toFixed(4)}</td>
                    <td style={{ padding: '0.65rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{ab.p5.toFixed(4)}</td>
                    <td style={{ padding: '0.65rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{ab.r5.toFixed(4)}</td>
                    <td style={{ padding: '0.65rem', textAlign: 'center', fontFamily: 'var(--font-mono)', color: ab.isWinner ? '#10b981' : 'inherit' }}>{ab.testMap.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
