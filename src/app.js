/**
 * App — wired for 5 algorithms × 3 visualizations.
 *
 * State slots own one algorithm each (A and B) plus a shared viz mode.
 *   - viz = 'grid'    → 2D wall grid (CanvasGrid renderer)
 *   - viz = 'graph'   → {nodes, edges}    (GraphCanvas renderer)
 *   - viz = 'mesh3d'  → 2D grid as voxels  (Three.js Mesh3D)
 *
 * On viz-mode swap we destroy and recreate the two renderer cards so
 * each picks the right component.  Algorithm frames are passed
 * straight through; renderers only need a uniform `{openSet,closedSet,
 * path,current,start,goal}` view-shape.
 */

import { benchmark, ALGO_LABELS } from './engine/benchmarker.js';
import { dijkstraSolve } from './algorithms/dijkstra.js';
import { SynchronizedPlayback } from './engine/playback.js';
import { createCanvasGrid } from './components/CanvasGrid.js';
import { createGraphCanvas } from './components/GraphCanvas.js';
import { createMesh3D }     from './components/Mesh3D.js';
import { createControls }   from './components/Controls.js';
import { createMetricsPanel } from './components/MetricsPanel.js';
import {
  randomGrid, randomSparseGrid, mazeGrid, bottleneckGrid, emptyGrid, isReachable
} from './utils/mapGenerators.js';import { randomGeometricGraph } from './utils/graphGenerators.js';
import { exportMetrics, trialsToCsv } from './utils/csvExporter.js';

const $ = (sel, root) => (root || document).querySelector(sel);

const state = {
  rows: Number($('#ctl-rows')?.value) || 30,
  cols: Number($('#ctl-cols')?.value) || 50,
  mapGenerator: 'random',
  allowDiagonal: true,
  heuristic: 'octile',
  weight: 1.0,
  algorithmA: 'dijkstra',
  algorithmB: 'astar',
  vizMode: 'grid',                 // 'grid' | 'graph' | 'mesh3d'
  topology: null,                  // grid array OR {nodes, edges}
  topologyKind: 'grid',            // 'grid' | 'graph'
  start: { row: 0, col: 0 },
  goal:  { row: 1, col: 1 },
  graphStart: null,
  graphGoal:  null,
  placements: { mode: null },
  trials: [],
  speed: 30,
  playback: null,
  canvases: { left: null, right: null }
};

/* =====================================================================
 *  Topology generation
 * ===================================================================== */

function regenerateTopology(seed = Date.now()) {
  if (state.vizMode === 'graph') {
    let g = randomGeometricGraph(40, 0.18, seed);
    state.topology = g;
    state.topologyKind = 'graph';
    state.graphStart = g.nodes[0];
    state.graphGoal  = g.nodes[g.nodes.length - 1];
  } else {
    let g;
    switch (state.mapGenerator) {
      case 'random':         g = randomGrid(state.rows, state.cols, 0.30, seed); break;
      case 'random-sparse':  g = randomSparseGrid(state.rows, state.cols, 0.18, seed); break;
      case 'maze':           g = mazeGrid(state.rows, state.cols, seed); break;
      case 'bottleneck':     g = bottleneckGrid(state.rows, state.cols, 2, seed); break;
      case 'empty': {
        const grid = emptyGrid(state.rows, state.cols);
        g = { grid, start: { row: 0, col: 0 }, goal: { row: state.rows - 1, col: state.cols - 1 } };
        break;
      }
      default: g = randomGrid(state.rows, state.cols);
    }
    state.topology = g.grid;
    state.topologyKind = 'grid';
    state.start = g.start;
    state.goal  = g.goal;
  }
}

function currentStartGoal() {
  return state.topologyKind === 'graph'
    ? { start: state.graphStart, goal: state.graphGoal }
    : { start: state.start,       goal: state.goal };
}

/* =====================================================================
 *  Renderer lifecycle
 * ===================================================================== */

function rebuildRenderers() {
  for (const id of ['left', 'right']) {
    if (state.canvases[id] && state.canvases[id].destroy) state.canvases[id].destroy();
    const canvasEl = $('#canvas-' + (id === 'left' ? 'dijkstra' : 'astar'));
    const card = canvasEl.parentElement.parentElement;
    card.dataset.viz = state.vizMode;
    const sg = currentStartGoal();
    if (state.vizMode === 'grid') {
      state.canvases[id] = createCanvasGrid(canvasEl, {
        start: sg.start, goal: sg.goal,
        interactive: false
      });
      state.canvases[id].setGrid(state.topology);
      state.canvases[id].setStartGoal(sg.start, sg.goal);
    } else if (state.vizMode === 'graph') {
      state.canvases[id] = createGraphCanvas(canvasEl, {
        start: sg.start, goal: sg.goal,
        interactive: false
      });
      state.canvases[id].setGraph(state.topology);
      state.canvases[id].setStartGoal(sg.start, sg.goal);
    } else if (state.vizMode === 'mesh3d') {
      state.canvases[id] = createMesh3D(canvasEl, { grid: state.topology });
      state.canvases[id].setGrid(state.topology);
      state.canvases[id].setStartGoal(sg.start, sg.goal);
    }
  }
}

function updateCardLabels() {
  for (const [id, algo] of [['left', state.algorithmA], ['right', state.algorithmB]]) {
    const canvas = id === 'left' ? $('#canvas-dijkstra') : $('#canvas-astar');
    const card = canvas.parentElement.parentElement;
    const labelEl = card.querySelector('.algo-label');
    if (!labelEl) return;
    labelEl.innerHTML = '';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    labelEl.appendChild(swatch);
    labelEl.appendChild(document.createTextNode(' ' + (ALGO_LABELS[algo] || algo)));
  }
}

/* =====================================================================
 *  Benchmark + Playback orchestration
 * ===================================================================== */

function runBenchmark() {
  if (!state.topology) return;
  if (state.playback) state.playback.destroy();

  // Pre-flight un-timed probe to choose diagonal/orthogonal connectivity.
  let allowDiagonal = state.allowDiagonal;
  if (state.topologyKind === 'grid' && allowDiagonal) {
    const probe = dijkstraSolve(state.topology, state.start, state.goal, { allowDiagonal: true });
    if (probe.cost == null) allowDiagonal = false;
  }

  const sg = currentStartGoal();
  const optsA = computeOpts(state.algorithmA, allowDiagonal);
  const optsB = computeOpts(state.algorithmB, allowDiagonal);

  let trialA, trialB;
  try {
    trialA = runSingle(state.algorithmA, sg, optsA);
  } catch (err) {
    flashStatus(`${ALGO_LABELS[state.algorithmA]} failed: ${err.message}`, 'warn');
    return;
  }
  try {
    trialB = runSingle(state.algorithmB, sg, optsB);
  } catch (err) {
    flashStatus(`${ALGO_LABELS[state.algorithmB]} failed: ${err.message}`, 'warn');
    return;
  }

  const entry = {
    mapGenerator: state.mapGenerator,
    vizMode: state.vizMode,
    rows: state.rows, cols: state.cols,
    allowDiagonal,
    heuristic: state.heuristic, weight: state.weight,
    algorithmA: trialA.algorithm, algorithmB: trialB.algorithm,
    a: trialA, b: trialB,
    timestamp: Date.now()
  };
  state.trials.unshift(entry);
  state.trials = state.trials.slice(0, 8);

  const playback = new SynchronizedPlayback({
    left:  { frames: trialA.frames },
    right: { frames: trialB.frames }
  });
  state.playback = playback;
  playback.setSpeed(state.speed);

  const subCb = (idx) => {
    const aF = trialA.frames[idx] || trialA.frames[trialA.frames.length - 1];
    const bF = trialB.frames[idx] || trialB.frames[trialB.frames.length - 1];
    state.canvases.left?.setView(aF);
    state.canvases.right?.setView(bF);
    updateLiveMetrics(aF, bF, trialA.algorithm, trialB.algorithm);
  };
  playback.subscribe(subCb);

  metricsPanel.update([trialA, trialB]);
  flashStatus(
    `Benchmarked: ${ALGO_LABELS[trialA.algorithm]} ${trialA.metrics.nodesExpanded.toLocaleString()}N · ` +
    `${ALGO_LABELS[trialB.algorithm]} ${trialB.metrics.nodesExpanded.toLocaleString()}N`
  );
  playback.play();
  controls.setPlaying(true);
}

function runSingle(algorithm, sg, opts) {
  return benchmark(algorithm, state.topology, sg.start, sg.goal, opts);
}

function computeOpts(algorithm, allowDiagonal) {
  const opts = { allowDiagonal };
  if (algorithm === 'astar') {
    opts.heuristic = state.heuristic;
    opts.weight = state.weight;
    if (state.heuristic === 'weighted') opts.baseHeuristic = 'octile';
  } else if (algorithm === 'bidir') {
    opts.heuristic = state.heuristic;
    opts.weight = 1; // canonical termination requires w=1
  } else if (algorithm === 'jps') {
    opts.heuristic = state.heuristic === 'weighted' ? 'octile' : state.heuristic;
    opts.allowDiagonal = true; // JPS only meaningful on 8-connected grids
  } else if (algorithm === 'dstarlite') {
    opts.heuristic = state.heuristic === 'weighted' ? 'octile' : state.heuristic;
  }
  return opts;
}

function updateLiveMetrics(aF, bF, aName, bName) {
  const a = $('.mp-live-a'); const b = $('.mp-live-b');
  if (a) {
    a.textContent = (aF.nodesExpanded || 0).toLocaleString();
    a.dataset.algo = aName;
  }
  if (b) {
    b.textContent = (bF.nodesExpanded || 0).toLocaleString();
    b.dataset.algo = bName;
  }
}

/* =====================================================================
 *  Placement (wall painting) \u2014 only meaningful on grid viz mode
 * ===================================================================== */

function _unused_onCellClick(ev) {
  if (!state.placements.mode) return;
  applyPlacement(ev.row, ev.col, state.placements.mode, ev.button === 'right' ? 'erase' : 'place');
}
function _unused_onCellDrag(ev) {
  if (state.placements.mode !== 'wall') return;
  applyPlacement(ev.row, ev.col, 'wall', ev.button === 'right' ? 'erase' : 'place');
}
function applyPlacement(r, c, mode, dragOp) {
  if (state.topologyKind !== 'grid' || !state.topology) return;
  const cell = state.topology[r][c];
  switch (mode) {
    case 'wall': {
      if (state.start.row === r && state.start.col === c) return;
      if (state.goal.row === r && state.goal.col === c) return;
      cell.wall = dragOp === 'erase' ? false : !cell.wall;
      break;
    }
    case 'start': {
      if (cell.wall) cell.wall = false;
      state.start = { row: r, col: c }; ensureReachable(); break;
    }
    case 'goal': {
      if (cell.wall) cell.wall = false;
      state.goal = { row: r, col: c }; ensureReachable(); break;
    }
    default: return;
  }
  applyToCanvases();
}
function ensureReachable() {
  if (isReachable(state.topology, state.start, state.goal)) return;
  state.start = nearestOpen(state.start) || state.start;
  state.goal  = nearestOpen(state.goal)  || state.goal;
  flashStatus('Endpoints snapped \u2014 original cells were unwalkable.', 'warn');
}
function nearestOpen(p) {
  if (state.topologyKind !== 'grid') return p;
  if (!state.topology[p.row][p.col].wall) return p;
  const rows = state.topology.length, cols = state.topology[0].length;
  for (let d = 1; d < Math.max(rows, cols); d++) {
    for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      if (Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
      const r = p.row + dr, c = p.col + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      if (!state.topology[r][c].wall) return { row: r, col: c };
    }
  }
  return p;
}
function applyToCanvases() {
  for (const c of Object.values(state.canvases)) {
    if (!c) continue;
    if (state.topologyKind === 'grid') c.setGrid?.(state.topology);
    else c.setGraph?.(state.topology);
    const sg = currentStartGoal();
    c.setStartGoal?.(sg.start, sg.goal);
  }
}

/* =====================================================================
 *  Wiring
 * ===================================================================== */

let controls, metricsPanel;
function init() {
  controls = createControls($('.deck'), {
    onPlay: () => { if (!state.playback) { runBenchmark(); return; } state.playback.toggle(); controls.setPlaying(!state.playback.controller.playing); },
    onPause: () => state.playback && state.playback.pause(),
    onStepForward: () => state.playback && state.playback.stepForward(),
    onStepBack: () => state.playback && state.playback.stepBack(),
    onJumpStart: () => state.playback && state.playback.jumpToStart(),
    onJumpEnd: () => state.playback && state.playback.jumpToEnd(),
    onSpeed: (v) => { state.speed = v; state.playback && state.playback.setSpeed(v); controls.setSpeedLabel(v); },
    onHeuristic: (v) => { state.heuristic = v; },
    onWeight: (v) => { state.weight = +v; },
    onAllowDiagonal: (v) => { state.allowDiagonal = v; if (state.vizMode === 'grid') runBenchmark(); },
    onMapGenerator: (v) => { state.mapGenerator = v; regenerateTopology(); rebuildRenderers(); updateCardLabels(); },
    onMapSize: ({ rows, cols }) => { state.rows = rows; state.cols = cols; regenerateTopology(); rebuildRenderers(); },
    onMapRandomize: () => { regenerateTopology(); rebuildRenderers(); flashStatus('Topology randomized'); },
    onRun: () => runBenchmark(),
    onExport: () => exportTrialSet(),
    onPlacementUpdate: (m) => { state.placements = m; },
    onAlgorithmA: (v) => { state.algorithmA = v; updateCardLabels(); runBenchmark(); },
    onAlgorithmB: (v) => { state.algorithmB = v; updateCardLabels(); runBenchmark(); },
    onVizMode: (v) => { state.vizMode = v; regenerateTopology(); rebuildRenderers(); updateCardLabels(); }
  });
  controls.setSpeedLabel(30);
  controls.setHeuristic('octile');
  controls.setAlgorithmA('dijkstra');
  controls.setAlgorithmB('astar');
  controls.setVizMode('grid');

  metricsPanel = createMetricsPanel($('.metrics'));
  regenerateTopology();
  rebuildRenderers();
  updateCardLabels();

  bindKeyboard();
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    switch (e.key) {
      case ' ': e.preventDefault(); controls.buttonEls.btnPlayPause.click(); break;
      case 'ArrowLeft':  state.playback && state.playback.stepBack(); break;
      case 'ArrowRight': state.playback && state.playback.stepForward(); break;
      case 'r': case 'R': controls.buttonEls.btnRun.click(); break;
      case 'e': case 'E': controls.buttonEls.btnExport.click(); break;
    }
  });
}

function exportTrialSet() {
  if (state.trials.length === 0) { flashStatus('Run at least one benchmark before exporting.', 'warn'); return; }
  const flat = [];
  for (const t of state.trials) {
    flat.push({
      algorithm: t.algorithmA, heuristic: t.heuristic, weight: t.weight,
      mapGenerator: t.mapGenerator, rows: t.rows, cols: t.cols,
      metrics: t.a.metrics, timestamp: t.timestamp
    });
    flat.push({
      algorithm: t.algorithmB, heuristic: t.heuristic, weight: t.weight,
      mapGenerator: t.mapGenerator, rows: t.rows, cols: t.cols,
      metrics: t.b.metrics, timestamp: t.timestamp
    });
  }
  const filename = exportMetrics(flat);
  flashStatus(`Saved <code>${filename}</code>`);
  console.log('CSV preview:\n' + trialsToCsv(flat));
}

function flashStatus(msg, kind = 'info') {
  const bar = $('#status-bar');
  if (!bar) return;
  bar.innerHTML = msg;
  bar.dataset.kind = kind;
  bar.classList.add('flash');
  setTimeout(() => bar.classList.remove('flash'), 600);
}

document.addEventListener('DOMContentLoaded', init);
