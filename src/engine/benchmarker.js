/**
 * Benchmarker — runs an algorithm under `performance.now()` BEFORE any
 * frame is queued, then collects every yielded frame for synchronized
 * playback.  This is the "decoupled metric engine" invariant: every
 * reported metric is captured with NO DOM work in flight, so playback
 * speed never alters the recorded numbers.
 *
 * Registered algorithms extend the existing Dijkstra/A* pair with three
 * advanced variants:
 *
 *   jps         Jump Point Search    (8-connected grids only)
 *   bidir       Bidirectional A*     (graphs, w=1 only)
 *   dstarlite   D* Lite (static)     (graphs, backward expand visualization)
 *
 * Each new algorithm accepts a topology (grid OR graph) and is wrapped
 * transparently into a GraphAdapter by `ensureAdapter(topology, opts)`.
 */

import { dijkstraSteps, dijkstraSolve } from '../algorithms/dijkstra.js';
import { aStarSteps,    aStarSolve }    from '../algorithms/aStar.js';
import { jpsSteps,      jpsSolve }      from '../algorithms/jps.js';
import { bidirSteps,    bidirSolve }    from '../algorithms/bidirAStar.js';
import { dStarLiteSteps, dStarLiteSolve } from '../algorithms/dStarLite.js';
import { HEURISTIC_NAMES, getHeuristic } from '../algorithms/heuristics.js';

/** @typedef {{steps:Function, solve:Function, kind:string}} AlgoPair */

/** Registered algorithm registry. */
const ALGOS = /** @type {Record<string, AlgoPair>} */ ({
  dijkstra: { steps: dijkstraSteps, solve: dijkstraSolve, kind: 'grid' },
  astar:    { steps: aStarSteps,    solve: aStarSolve,    kind: 'grid' },
  jps:      { steps: jpsSteps,      solve: jpsSolve,      kind: 'grid-jps' },
  bidir:    { steps: bidirSteps,    solve: bidirSolve,    kind: 'graph' },
  dstarlite:{ steps: dStarLiteSteps,solve: dStarLiteSolve,kind: 'graph-dstar' }
});

/**
 * Numerical solver for the effective branching factor.
 *
 *   N = 1 + b + b² + … + b^d = (b^(d+1) − 1) / (b − 1)
 */
export function effectiveBranchingFactor(N, d) {
  if (N == null || d == null) return null;
  if (d <= 0) return N;
  if (N <= d + 1) return 1;
  if (N === d + 1 + 1) return 1 + 1e-6;

  let b = Math.max(1.001, Math.pow(N + 1, 1 / (d + 1)));
  for (let i = 0; i < 80; i++) {
    const bp1 = Math.pow(b, d + 1);
    const bpM1 = Math.pow(b, d);
    const f = (bp1 - 1) / (b - 1) - N;
    const fp = ((d + 1) * bpM1 * (b - 1) - (bp1 - 1)) / Math.pow(b - 1, 2);
    if (!Number.isFinite(fp) || fp === 0) break;
    const delta = f / fp;
    b -= delta;
    if (b < 1) b = 1 + 1e-6;
    if (Math.abs(delta) < 1e-7) break;
  }
  return b;
}

/**
 * Map algorithm name to its display label for UI/metric panels.
 */
export const ALGO_LABELS = {
  dijkstra: 'Dijkstra',
  astar:    'A*',
  jps:      'JPS',
  bidir:    'Bidir A*',
  dstarlite:'D* Lite'
};

/**
 * Run a single benchmark trial.
 *
 * @param {string} algorithm
 * @param {Array<Array<{wall:boolean}>|{nodes:Array,edges:Array}} topology
 * @param {{row:number,col:number}|{id:any}} start
 * @param {{row:number,col:number}|{id:any}} goal
 * @param {{heuristic?:string,weight?:number,allowDiagonal?:boolean}} [opts]
 */
export function benchmark(algorithm, topology, start, goal, opts = {}) {
  const pair = ALGOS[algorithm];
  if (!pair) throw new Error(`Unknown algorithm: ${algorithm}`);

  // Validate heuristic gating per algorithm kind up front.
  if (algorithm === 'bidir' && (opts.weight ?? 1) > 1) {
    throw new Error('Bidirectional A* requires w=1 (consistent heuristic).');
  }
  if ((algorithm === 'astar' || algorithm === 'bidir') &&
       (opts.heuristic != null)) {
    const h = String(opts.heuristic).toLowerCase();
    if (h === 'weighted') {
      const base = String(opts.baseHeuristic || 'octile').toLowerCase();
      getHeuristic(base);
    } else if (h !== 'none' && h !== 'zero') {
      getHeuristic(h);
    }
  }
  if (algorithm === 'jps' && opts.allowDiagonal === false) {
    throw new Error('JPS requires 8-connected grid.');
  }
  if (algorithm === 'dstarlite' && (opts.heuristic == null)) {
    // Pure default heuristic (Euclidean) is fine, just no validation.
  }

  // Phase 1 — pure solver under performance.now().
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const solved = pair.solve(topology, start, goal, opts);
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const executionTimeMs = t1 - t0;

  // Phase 2 — collect every yielded frame (1 pass, no timing).
  const frames = [];
  for (const frame of pair.steps(topology, start, goal, opts)) frames.push(frame);

  const pathCost = solved.cost;
  const pathLength = solved.path ? solved.path.length : null;
  const ebf = effectiveBranchingFactor(solved.nodesExpanded, pathCost ?? 0);

  return {
    algorithm,
    heuristic: opts.heuristic != null ? String(opts.heuristic).toLowerCase() : '',
    weight: opts.weight ?? null,
    frames,
    metrics: {
      nodesExpanded: solved.nodesExpanded,
      pathCost,
      pathLength,
      executionTimeMs,
      executionTimeUs: executionTimeMs * 1000,
      effectiveBranchingFactor: ebf,
      completed: pathCost != null
    }
  };
}

export function frameToView(frame) {
  return {
    type: frame.type,
    openSet: frame.openSet || [],
    closedSet: frame.closedSet || [],
    current: frame.current || null,
    path: frame.path || [],
    cost: frame.cost ?? null,
    nodesExpanded: frame.nodesExpanded ?? 0,
    f: frame.f ?? null
  };
}

export function formatMetrics(m) {
  return `N=${m.nodesExpanded}  d=${m.pathCost == null ? '∞' : m.pathCost.toFixed(2)}  ` +
    `t=${m.executionTimeUs.toFixed(1)}µs  b*=${m.effectiveBranchingFactor == null
      ? '—'
      : m.effectiveBranchingFactor.toFixed(3)}`;
}

export const _registry = ALGOS;
export const _heuristicNames = HEURISTIC_NAMES;
