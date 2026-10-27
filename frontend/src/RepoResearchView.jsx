import React, { useState, useEffect, useRef } from 'react';
import { BENCHMARK_MODELS } from './benchmarkData';
import RepoEvaluationNotice from './RepoEvaluationNotice';

const API_BASE = 'http://localhost:5000/api';

const REPO_METRICS = [
  { id: 'map', key: 'map', label: 'MAP', long: 'Mean Average Precision (MAP)' },
  { id: 'mrr', key: 'mrr', label: 'MRR', long: 'Mean Reciprocal Rank (MRR)' },
  { id: 'p5', key: 'pAt5', label: 'P@5', long: 'Precision@5 (Macro)' },
  { id: 'r5', key: 'rAt5', label: 'R@5', long: 'Recall@5 (Macro)' }
];

// Same model set and order as the published benchmark, scored on the analysed repository
const REPO_MODELS = BENCHMARK_MODELS.map(m => ({ id: m.id, name: m.name, description: m.description }));

const ABLATION_KEYS = [
  'egcp_v4_base',
  'egcp_v4_entropy_beta',
  'egcp_v4_hub_excl',
  'egcp_v4_gated_op',
  'egcp_v4_entropy_hub',
  'egcp_v4_combined'
];

const SIGNIFICANCE_ROWS = [
  { key: 'egcp_v4_vs_baseline', label: 'EGCP v4 Combined vs Canonical Baseline' },
  { key: 'egcp_v4_vs_csf', label: 'EGCP v4 Combined vs CSF Frozen' },
  { key: 'csf_vs_baseline', label: 'CSF Frozen vs Canonical Baseline' }
];

const fmt = v => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : '–');
const signed = v => (typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(4)}` : '–');
const relChange = (a, b) => (b > 0 ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : '–');

const card = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  boxShadow: 'var(--shadow-sm)'
};
const th = { padding: '0.75rem 0.75rem', textAlign: 'center' };
const td = { padding: '0.75rem 0.75rem', textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#334155' };

// Evaluation results of the analysed repository from /repo-evaluation/summary
export default function RepoResearchView({ repoPath, repoName }) {
  const [repoEval, setRepoEval] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selectedMetric, setSelectedMetric] = useState('map');
  const [showAblations, setShowAblations] = useState(false);
  // Ignores responses that belong to a previously analysed repository
  const requestRef = useRef(0);

  const loadSummary = async (requestId) => {
    try {
      const data = await fetch(`${API_BASE}/repo-evaluation/summary`).then(r => r.json());
      if (requestId !== requestRef.current) return;
      if (data.success) {
        setSummary(data);
        setRepoEval(prev => ({ ...prev, status: 'done', config: data.config, warnings: data.warnings }));
      } else {
        setRepoEval({ status: 'error', error: data.error });
      }
    } catch (err) {
      if (requestId === requestRef.current) setRepoEval({ status: 'error', error: `Unable to load results: ${err.message}` });
    }
  };

  const startEvaluation = async (force = false) => {
    const requestId = requestRef.current;
    try {
      const res = await fetch(`${API_BASE}/repo-evaluation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const status = await res.json();
      if (requestId !== requestRef.current) return;
      setRepoEval(status);
      if (status.status === 'done') await loadSummary(requestId);
    } catch (err) {
      if (requestId === requestRef.current) setRepoEval({ status: 'error', error: `Unable to reach the backend: ${err.message}` });
    }
  };

  useEffect(() => {
    requestRef.current += 1;
    setRepoEval(null);
    setSummary(null);
    startEvaluation();
  }, [repoPath]);

  // Poll while the evaluation runs or waits behind another repository
  useEffect(() => {
    if (!['running', 'queued'].includes(repoEval?.status)) return;
    const requestId = requestRef.current;
    let finished = false;
    const timer = setInterval(async () => {
      try {
        const status = await fetch(`${API_BASE}/repo-evaluation/status`).then(r => r.json());
        if (finished || requestId !== requestRef.current) return;
        setRepoEval(status);
        if (status.status === 'done') {
          finished = true;
          loadSummary(requestId);
        }
      } catch (err) {
        console.warn('Could not read evaluation status:', err.message);
      }
    }, 1500);
    return () => {
      finished = true;
      clearInterval(timer);
    };
  }, [repoEval?.status]);

  const macro = summary?.overallMacroCommits;
  const testMacro = summary?.testMacroCommits;
  const config = summary?.config;
  const metric = REPO_METRICS.find(m => m.id === selectedMetric);
  const valueOf = modelId => macro?.[modelId]?.[metric.key];

  const leader = macro ? [...REPO_MODELS].sort((a, b) => (macro[b.id]?.map ?? 0) - (macro[a.id]?.map ?? 0))[0] : null;
  const baselineMap = macro?.canonical_baseline?.map ?? 0;
  const csfMap = macro?.csf_frozen?.map ?? 0;
  const egcpMap = macro?.egcp_v4_combined?.map ?? 0;
  const maxVal = macro ? Math.max(...REPO_MODELS.map(m => valueOf(m.id) ?? 0)) : 0;
  const bestForMetric = REPO_MODELS.filter(m => maxVal > 0 && valueOf(m.id) === maxVal).map(m => m.id);
  const modelName = id => (summary?.models || []).find(m => m.key === id)?.name || id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* Repository Banner */}
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
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
              Repository: {repoName}
            </h3>
            <span className="badge-clean badge-clean-primary">Your Repository</span>
            {config && (
              <span className="badge-clean badge-clean-success">
                {config.eligibleCommits} Commits · {config.totalCases} Cases
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.86rem', color: '#475569', maxWidth: '780px', lineHeight: 1.45 }}>
            {macro && leader ? (
              <>
                Leave-one-out evaluation over this repository&apos;s own commit history.{' '}
                <strong>{leader.name}</strong> has the highest macro MAP here (<strong>{fmt(macro[leader.id]?.map)}</strong>).
                EGCP v4 Combined scores {fmt(egcpMap)} ({relChange(egcpMap, baselineMap)} vs Baseline, {relChange(egcpMap, csfMap)} vs CSF).
              </>
            ) : (
              <>Leave-one-out evaluation over this repository&apos;s own commit history, using the same models and metrics as the published benchmark.</>
            )}
          </p>
          {summary && (
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.35rem', fontFamily: 'var(--font-mono)' }}>
              HEAD {summary.headSha?.slice(0, 7)} · evaluated {new Date(summary.evaluatedAt).toLocaleString()}
            </div>
          )}
        </div>

        {macro && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'EGCP v4 MAP', value: egcpMap, color: '#0f48f2' },
              { label: 'CSF MAP', value: csfMap, color: '#64748b' },
              { label: 'Baseline MAP', value: baselineMap, color: '#64748b' }
            ].map(k => (
              <div key={k.label} style={{ ...card, borderRadius: '12px', padding: '0.75rem 1.25rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.04em' }}>
                  {k.label}
                </span>
                <div style={{ fontSize: '1.4rem', fontWeight: '800', color: k.color, fontFamily: 'var(--font-mono)' }}>
                  {fmt(k.value)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RepoEvaluationNotice repoEval={repoEval} repoName={repoName} onRetry={() => startEvaluation(true)} />

      {macro && (
        <>
          {/* Model Comparison Bars */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a' }}>
                  Cross-Model Evaluation on {repoName}
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  Commit-level macro averages over {config.eligibleCommits} commits. Every model ranks the same candidates using only data from before each commit.
                </p>
              </div>
              <div style={{ display: 'flex', background: '#e2e8f0', padding: '3px', borderRadius: '10px', gap: '2px' }}>
                {REPO_METRICS.map(m => (
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
                      boxShadow: selectedMetric === m.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none'
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...card, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#334155', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                Showing: <span style={{ color: '#0f48f2' }}>{metric.long}</span>
              </div>
              {REPO_MODELS.map(m => {
                const val = valueOf(m.id) ?? 0;
                const isBest = bestForMetric.includes(m.id);
                const percentage = maxVal > 0 ? Math.round((val / (maxVal * 1.15)) * 100) : 0;
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: isBest ? '700' : '600', color: isBest ? '#0f48f2' : '#1e293b' }}>{m.name}</span>
                        {isBest && (
                          <span className="badge-clean badge-clean-success" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem' }}>
                            Highest {metric.label}
                          </span>
                        )}
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: isBest ? '#0f48f2' : '#334155' }}>{fmt(val)}</span>
                    </div>
                    <div style={{ width: '100%', height: '14px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${percentage}%`,
                        height: '100%',
                        background: isBest ? 'linear-gradient(90deg, #0f48f2 0%, #38bdf8 100%)' : (m.id === 'csf_frozen' ? '#94a3b8' : '#cbd5e1'),
                        borderRadius: '999px',
                        transition: 'width 0.4s ease'
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Metrics Table */}
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem' }}>
              Metrics Table ({repoName})
            </h3>
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '600' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Model</th>
                      <th style={th}>Macro MAP</th>
                      <th style={th}>Macro MRR</th>
                      <th style={th}>P@5</th>
                      <th style={th}>R@5</th>
                      <th style={th}>Held-Out Test MAP</th>
                      <th style={th}>Case-Level MAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REPO_MODELS.map(m => {
                      const row = macro[m.id];
                      const isLeader = leader && m.id === leader.id;
                      return (
                        <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9', background: isLeader ? 'rgba(239, 246, 255, 0.45)' : '#ffffff' }}>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <span style={{ color: isLeader ? '#0f48f2' : '#0f172a', fontWeight: '700' }}>{m.name}</span>
                              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{m.description}</span>
                            </div>
                          </td>
                          <td style={{ ...td, fontWeight: '700', color: isLeader ? '#0f48f2' : '#1e293b' }}>{fmt(row?.map)}</td>
                          <td style={td}>{fmt(row?.mrr)}</td>
                          <td style={td}>{fmt(row?.pAt5)}</td>
                          <td style={td}>{fmt(row?.rAt5)}</td>
                          <td style={td}>{fmt(testMacro?.[m.id]?.map)}</td>
                          <td style={td}>{fmt(summary.overallMicroCases?.[m.id]?.map)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '0.65rem 1rem', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9' }}>
                {config.splitRule} Held-out test: {config.testCommits} commit{config.testCommits === 1 ? '' : 's'}{testMacro ? '' : ' (none, so that column is empty)'}.
              </div>
            </div>
          </div>

          {/* Statistical Significance */}
          {summary.statisticalTests && (
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem' }}>
                Statistical Significance (Paired, Case-Level MAP, N = {summary.statisticalTests.egcp_v4_vs_baseline?.n})
              </h3>
              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '600' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Comparison</th>
                        <th style={th}>Mean Diff</th>
                        <th style={th}>95% CI</th>
                        <th style={th}>t</th>
                        <th style={th}>p (approx.)</th>
                        <th style={th}>Wins / Ties / Losses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SIGNIFICANCE_ROWS.map(r => {
                        const s = summary.statisticalTests[r.key];
                        if (!s) return null;
                        const significant = config.reliable && s.pValueT < 0.05;
                        return (
                          <tr key={r.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#0f172a' }}>{r.label}</td>
                            <td style={{ ...td, color: s.meanDiff > 0 ? '#10b981' : (s.meanDiff < 0 ? '#ef4444' : '#334155') }}>{signed(s.meanDiff)}</td>
                            <td style={td}>[{fmt(s.ci95Lower)}, {fmt(s.ci95Upper)}]</td>
                            <td style={td}>{Number.isFinite(s.tStat) ? s.tStat.toFixed(3) : '–'}</td>
                            <td style={{ ...td, fontWeight: significant ? '700' : 'normal', color: significant ? '#10b981' : '#334155' }}>
                              {fmt(s.pValueT)}{significant ? ' *' : ''}
                            </td>
                            <td style={td}>{s.wins} / {s.ties} / {s.losses}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '0.65rem 1rem', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9' }}>
                  {config.reliable
                    ? '* p < 0.05. Cases from the same commit are not independent, so treat p-values as indicative.'
                    : 'Too few usable commits for reliable significance testing; p-values are shown for reference only.'}
                </div>
              </div>
            </div>
          )}

          {/* Ablations */}
          <div style={{ ...card, padding: '1.25rem 1.5rem' }}>
            <div
              onClick={() => setShowAblations(!showAblations)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '1rem' }}
            >
              <div>
                <h4 style={{ fontSize: '0.98rem', fontWeight: '700', color: '#0f172a' }}>
                  EGCP v4 Ablation Study on {repoName}
                </h4>
                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  How each EGCP v4 component contributes on this repository.
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
                      <th style={th}>Macro MAP</th>
                      <th style={th}>Macro MRR</th>
                      <th style={th}>P@5</th>
                      <th style={th}>R@5</th>
                      <th style={th}>Held-out Test MAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ABLATION_KEYS.map(key => {
                      const row = macro[key];
                      return (
                        <tr key={key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.65rem 0.85rem', color: '#0f172a' }}>{modelName(key)}</td>
                          <td style={{ ...td, fontWeight: '700' }}>{fmt(row?.map)}</td>
                          <td style={td}>{fmt(row?.mrr)}</td>
                          <td style={td}>{fmt(row?.pAt5)}</td>
                          <td style={td}>{fmt(row?.rAt5)}</td>
                          <td style={td}>{fmt(testMacro?.[key]?.map)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
            Ground truth is same-commit co-change: for each case one changed file is the seed, and the other files changed in that commit are the targets.
            This is a reproducible proxy for change coupling, not verified causal impact.
          </div>
        </>
      )}
    </div>
  );
}
