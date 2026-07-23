/**
 * CSV Exporter — turns a list of trial metrics into a downloadable CSV.
 *
 *   - Headers are fixed for spreadsheet import compatibility.
 *   - Cell values are RFC-4180 escaped.
 *   - A Blob + Object URL is used to avoid base64 round-trips.
 */

const HEADER = [
  'Algorithm',
  'Heuristic',
  'Weight',
  'MapGenerator',
  'Rows',
  'Cols',
  'NodesExpanded',
  'PathCost',
  'PathLength',
  'ExecutionTimeUs',
  'ExecutionTimeMs',
  'EffectiveBranchingFactor',
  'Completed',
  'Timestamp'
];

function escapeCsv(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : '';
  }
  const s = String(v);
  if (/["\n,\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowFromTrial(t) {
  return [
    t.algorithm ?? '',
    t.heuristic ?? '',
    t.weight ?? '',
    t.mapGenerator ?? '',
    t.rows ?? '',
    t.cols ?? '',
    t.metrics?.nodesExpanded ?? '',
    t.metrics?.pathCost ?? '',
    t.metrics?.pathLength ?? '',
    t.metrics?.executionTimeUs ?? '',
    t.metrics?.executionTimeMs ?? '',
    t.metrics?.effectiveBranchingFactor ?? '',
    t.metrics?.completed ?? '',
    t.timestamp ? new Date(t.timestamp).toISOString() : ''
  ];
}

/**
 * @param {Array<object>} trials
 * @returns {string}
 */
export function trialsToCsv(trials) {
  const lines = [HEADER.map(escapeCsv).join(',')];
  for (const t of trials) lines.push(rowFromTrial(t).map(escapeCsv).join(','));
  return lines.join('\n');
}

/**
 * Download a string as `filename`.  Falls back to a data: URL when
 * `URL.createObjectURL` is not available (Node test environment).
 */
export function downloadString(text, filename, mime = 'text/csv') {
  if (typeof document === 'undefined') {
    // Test / SSR fallback: write to deterministic temp location would
    // be ideal, but tests can stub `trialsToCsv` without invoking this.
    return null;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = (typeof URL !== 'undefined' && URL.createObjectURL)
    ? URL.createObjectURL(blob)
    : `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url);
  }, 200);
  return filename;
}

export function exportMetrics(trials, prefix = 'pathfinding-metrics') {
  const csv = trialsToCsv(trials);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return downloadString(csv, `${prefix}-${ts}.csv`, 'text/csv');
}

export const _ = { HEADER, escapeCsv };
