import React from 'react';

const EVALUATION_PHASES = {
  starting: 'Starting evaluation',
  scanning: 'Scanning commits and building pre-change code graphs',
  indexing: 'Indexing change history for the path statistics',
  evaluating: 'Running the models on each commit'
};

// Status of the analysed repository's historical evaluation: progress, failures and data warnings
export default function RepoEvaluationNotice({ repoEval, repoName, onRetry }) {
  const box = (background, border, color) => ({
    background, border: `1px solid ${border}`, color, borderRadius: '12px', padding: '0.9rem 1rem', fontSize: '0.82rem'
  });

  if (!repoEval) {
    return <div style={box('#f8fafc', '#e2e8f0', '#475569')}>Checking the evaluation of {repoName}...</div>;
  }

  if (repoEval.status === 'running' || repoEval.status === 'queued') {
    const { done = 0, total = 0 } = repoEval.progress || {};
    const pct = total > 0 ? Math.round((done / total) * 100) : null;
    return (
      <div style={box('#eff6ff', '#bfdbfe', '#1e3a8a')}>
        <div style={{ fontWeight: '700', marginBottom: '0.4rem' }}>
          {repoEval.status === 'queued'
            ? `Waiting for the evaluation of ${repoEval.busyWith || 'another repository'} to finish...`
            : `Evaluating ${repoName}: ${EVALUATION_PHASES[repoEval.phase] || 'working'}${total > 0 ? ` (${done}/${total})` : ''}...`}
        </div>
        <div style={{ height: '6px', background: '#dbeafe', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ width: pct === null ? '35%' : `${pct}%`, height: '100%', background: '#0f48f2', transition: 'width 0.4s' }} />
        </div>
        <div style={{ marginTop: '0.4rem', color: '#475569', fontSize: '0.76rem' }}>
          The first run checks out past commits and can take several minutes on large repositories. Results are saved, so later visits load instantly.
        </div>
      </div>
    );
  }

  if (repoEval.status === 'error' || repoEval.status === 'no_repo' || repoEval.status === 'none') {
    return (
      <div style={{ ...box('#fef2f2', '#fecaca', '#991b1b'), display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span>{repoEval.error || 'The evaluation has not run yet.'}</span>
        {repoEval.status !== 'no_repo' && (
          <button onClick={onRetry} className="btn-secondary-clean" style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem' }}>
            Run evaluation
          </button>
        )}
      </div>
    );
  }

  const config = repoEval.config;
  const warnings = repoEval.warnings || [];
  return (
    <>
      {warnings.length > 0 && (
        <div style={box('#fffbeb', '#fde68a', '#92400e')}>
          {warnings.map(w => <div key={w}>{w}</div>)}
        </div>
      )}
      {config && config.totalCases > 0 && (
        <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
          {config.eligibleCommits} usable of {config.scannedCommits} scanned commits · {config.trainCommits} train / {config.testCommits} held-out test commits. {config.splitRule}
        </div>
      )}
    </>
  );
}
