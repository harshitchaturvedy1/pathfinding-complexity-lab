/**
 * MetricsPanel — live counters and comparison bar chart.
 *
 * Public API:
 *   const m = createMetricsPanel(rootEl);
 *   m.update(trials);                 // one or two most recent trials
 *   m.clear();
 *   m.destroy();
 *
 * The chart is a small canvas rendered each `update()` call.  We
 * render at DPR for sharp output on hi-DPI screens.
 */

const COLOR_A = '#5cdcff';
const COLOR_B = '#e879f9';

function fmt(n, digits = 2) {
  if (n == null) return '—';
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 10 && digits > 0) return n.toFixed(digits);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

function fmtMs(us) {
  if (us == null || !Number.isFinite(us)) return '—';
  if (us < 1) return `${us.toFixed(2)} µs`;
  if (us < 1000) return `${us.toFixed(2)} µs`;
  return `${(us / 1000).toFixed(2)} ms`;
}

function diff(label, a, b, lowerIsBetter = true) {
  // returns a string ("Dijkstra expanded 2.3× fewer nodes")
  if (a == null || b == null || a === 0) return null;
  const ratio = b / a;
  const txt = ratio >= 1
    ? `${ratio.toFixed(2)}× ${lowerIsBetter ? 'higher' : 'lower'}`
    : `${(1 / ratio).toFixed(2)}× ${lowerIsBetter ? 'higher' : 'lower'}`;
  return `${label}: A ${txt} than B`;
}

export function createMetricsPanel(root) {
  let lastTrials = [];

  function render() {
    root.innerHTML = '';

    if (!lastTrials.length) {
      root.appendChild(emptyState());
      return;
    }

    const [a, b] = lastTrials;
    const cards = el('div', 'mp-cards');
    cards.appendChild(metricCard(a, 'Algorithm A', COLOR_A));
    if (b) cards.appendChild(metricCard(b, 'Algorithm B', COLOR_B));
    root.appendChild(cards);

    const chart = comparisonChart(a, b);
    root.appendChild(chart);

    const insight = insights(a, b);
    if (insight) {
      const note = el('div', 'mp-insight', insight);
      root.appendChild(note);
    }
  }

  function update(trials) {
    lastTrials = Array.isArray(trials) ? trials : [trials];
    render();
  }

  function clear() {
    lastTrials = [];
    render();
  }

  render();

  return { update, clear, destroy: () => { root.innerHTML = ''; } };
}

function emptyState() {
  const wrap = el('div', 'mp-empty');
  wrap.innerHTML = `
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12h4l3-9 4 18 3-9h4"/>
    </svg>
    <h3>Run a benchmark to see metrics</h3>
    <p>Pick a map → press <strong>Run</strong>. The benchmarker will execute both algorithms with <code>performance.now()</code> before the animation begins.</p>
  `;
  return wrap;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function metricCard(trial, label, accent) {
  const card = el('article', 'mp-card');
  card.style.borderColor = hex(accent, 0.4);

  const title = el('header', 'mp-card-title');
  const titleSwatch = el('span', 'mp-swatch');
  titleSwatch.style.background = accent;
  title.append(titleSwatch, document.createTextNode(`${label} — ${prettyAlgo(trial)}`));
  card.appendChild(title);

  const grid = el('dl', 'mp-grid');
  const rows = [
    ['Nodes Expanded',      fmt(trial.metrics?.nodesExpanded, 0)],
    ['Path Cost',           trial.metrics?.pathCost == null ? '—' : fmt(trial.metrics.pathCost, 2)],
    ['Path Length',         trial.metrics?.pathLength == null ? '—' : String(trial.metrics.pathLength)],
    ['Execution Time',      fmtMs(trial.metrics?.executionTimeUs)],
    ['Effective b*',        trial.metrics?.effectiveBranchingFactor == null ? '—' : fmt(trial.metrics.effectiveBranchingFactor, 3)],
    ['Completed',           trial.metrics?.completed ? '✓ yes' : '✗ no path']
  ];
  for (const [k, v] of rows) {
    const dt = el('dt', '', k);
    const dd = el('dd', '', v);
    grid.append(dt, dd);
  }
  card.appendChild(grid);
  return card;
}

function prettyAlgo(trial) {
  if (!trial) return '';
  const algo = trial.algorithm === 'dijkstra' ? 'Dijkstra' : 'A*';
  if (trial.algorithm === 'astar') {
    const h = trial.heuristic || 'manhattan';
    if (h === 'weighted') return `A* (Weighted, w=${Number(trial.weight || 1).toFixed(2)})`;
    return `A* (${h[0].toUpperCase()}${h.slice(1)})`;
  }
  return algo;
}

function insights(a, b) {
  if (!b) return null;
  const lines = [];
  const nRatio = diff('Nodes Expanded', a.metrics.nodesExpanded, b.metrics.nodesExpanded, true);
  if (nRatio) lines.push(nRatio);
  const tRatio = diff('Execution Time', a.metrics.executionTimeUs, b.metrics.executionTimeUs, true);
  if (tRatio) lines.push(tRatio);
  const costRatio = diff('Path Cost', a.metrics.pathCost ?? 0, b.metrics.pathCost ?? 0, true);
  if (costRatio) lines.push(costRatio);
  const bA = a.metrics.effectiveBranchingFactor;
  const bB = b.metrics.effectiveBranchingFactor;
  if (bA != null && bB != null) {
    const better = bA < bB ? 'A' : 'B';
    lines.push(`Effective b*: trial ${better} is more focused (${fmt(Math.min(bA, bB), 3)} vs ${fmt(Math.max(bA, bB), 3)}).`);
  }
  return lines.length ? lines.join(' · ') : null;
}

function comparisonChart(a, b) {
  const wrap = el('figure', 'mp-chart');
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  wrap.appendChild(el('figcaption', '', 'Lower is better for every metric'));
  drawChart(canvas, a, b);
  return wrap;
}

function drawChart(canvas, a, b) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const cssW = canvas.parentElement.clientWidth || 360;
  const cssH = 200;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const metrics = [
    { label: 'Nodes',     a: a.metrics?.nodesExpanded ?? 0, b: b?.metrics?.nodesExpanded ?? 0, fmt: (n) => n, log: true },
    { label: 'Cost',      a: a.metrics?.pathCost ?? 0,      b: b?.metrics?.pathCost ?? 0,      fmt: (n) => n, log: false },
    { label: 'Time µs',   a: a.metrics?.executionTimeUs ?? 0, b: b?.metrics?.executionTimeUs ?? 0, fmt: (n) => n, log: true },
    { label: 'b*',        a: a.metrics?.effectiveBranchingFactor ?? 1, b: b?.metrics?.effectiveBranchingFactor ?? 1, fmt: (n) => +n, log: false }
  ];

  const pad = { top: 12, right: 12, bottom: 28, left: 56 };
  const innerW = cssW - pad.left - pad.right;
  const innerH = cssH - pad.top - pad.bottom;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (innerH * i / 4);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + innerW, y);
  }
  ctx.stroke();

  const slotW = innerW / metrics.length;
  const barW = (slotW - 18) / 2;

  metrics.forEach((m, i) => {
    const baseX = pad.left + slotW * i + 6;
    const aRaw = m.a > 0 ? m.a : 0.0001;
    const bRaw = m.b > 0 ? m.b : 0.0001;
    const aH = m.log ? (Math.log10(aRaw + 1) / Math.log10(1e6 + 1)) * innerH : (aRaw / Math.max(aRaw + bRaw, 1)) * innerH;
    const bH = m.log ? (Math.log10(bRaw + 1) / Math.log10(1e6 + 1)) * innerH : (bRaw / Math.max(aRaw + bRaw, 1)) * innerH;

    drawBar(ctx, baseX, pad.top + innerH - Math.max(2, aH), barW, Math.max(2, aH), COLOR_A);
    drawBar(ctx, baseX + barW + 4, pad.top + innerH - Math.max(2, bH), barW, Math.max(2, bH), COLOR_B);

    ctx.fillStyle = 'rgba(232,236,244,0.7)';
    ctx.font = '600 11px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(m.label, baseX + barW + 2, pad.top + innerH + 8);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(154,163,184,0.9)';
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillText(fmt(m.a, 1), baseX + barW / 2,     pad.top + innerH - Math.max(2, aH) - 14);
    ctx.fillText(fmt(m.b, 1), baseX + barW * 1.5 + 4, pad.top + innerH - Math.max(2, bH) - 14);
  });

  // Legend
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  drawLegend(ctx, pad.left, 4, COLOR_A, 'A');
  drawLegend(ctx, pad.left + 80, 4, COLOR_B, 'B');
}

function drawBar(ctx, x, y, w, h, color) {
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, hex(color, 0.95));
  grad.addColorStop(1, hex(color, 0.55));
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawLegend(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 5, 10, 10);
  ctx.fillStyle = 'rgba(232,236,244,0.8)';
  ctx.fillText(label, x + 16, y);
}

function hex(c, alpha = 1) {
  if (c.startsWith('rgba') || c.startsWith('rgb')) return c;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
