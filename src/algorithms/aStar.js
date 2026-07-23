/**
 * A* on a uniform-cost 4/8-connected grid.
 *
 * f(n) = g(n) + w · h(n)
 *
 *   w = 1, h admissible          → optimal A*
 *   w = 1, h exact (octile)      → explores only optimal-path nodes on empty map
 *   w > 1                        → Weighted A* (suboptimal, faster)
 *
 * Same generator pattern as Dijkstra — yields frames and returns
 * final result via `return value` to the caller.  See `dijkstra.js`
 * for the full frame-shape spec; identical here.
 */

import { MinHeap } from './minHeap.js';
import { getHeuristic, weighted } from './heuristics.js';

const SQRT2 = Math.SQRT2;
const encode = (r, c) => `${r},${c}`;
const decode = (k) => {
  const i = k.indexOf(',');
  return { row: +k.slice(0, i), col: +k.slice(i + 1) };
};

function neighboursFor(grid, row, col, allowDiagonal) {
  const rows = grid.length;
  const cols = grid[0].length;
  const out = [];
  const dirs = allowDiagonal
    ? [
        [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
        [-1, -1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [1, 1, SQRT2]
      ]
    : [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1]];
  for (const [dr, dc, w] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
    if (grid[nr][nc].wall) continue;
    out.push({ key: encode(nr, nc), weight: w });
  }
  return out;
}

function reconstruct(prev, startKey, goalKey) {
  if (!prev.has(goalKey) && startKey !== goalKey) return [];
  const path = [];
  let cur = goalKey;
  let guard = 0;
  while (cur != null && guard++ < 1e6) {
    path.push(cur);
    if (cur === startKey) break;
    cur = prev.get(cur);
  }
  return path.reverse();
}

/**
 * A* generator.
 *
 * @param {Array<Array<{wall:boolean}>>} grid
 * @param {{row:number,col:number}} start
 * @param {{row:number,col:number}} goal
 * @param {{heuristic:string, weight?:number, allowDiagonal?:boolean}} opts
 */
export function* aStarSteps(grid, start, goal, opts = {}) {
  const allowDiagonal = opts.allowDiagonal !== false;
  const startKey = encode(start.row, start.col);
  const goalKey = encode(goal.row, goal.col);

  const baseName = opts.heuristic || 'manhattan';
  const isWeighted = String(baseName).toLowerCase() === 'weighted';
  const w = Math.max(1, opts.weight ?? 1);
  const inner = isWeighted
    ? weighted(opts.baseHeuristic || 'octile', w)
    : getHeuristic(baseName);

  const heap = new MinHeap();
  const gScore = new Map();
  const prev = new Map();
  const closed = [];
  const closedMembership = new Set();
  const openSet = new Set();

  gScore.set(startKey, 0);
  const hStart = inner(start, goal);
  heap.push(hStart, startKey);
  openSet.add(startKey);

  let nodesExpanded = 0;

  yield {
    type: 'init',
    openSet: [...openSet],
    closedSet: [],
    current: null,
    cost: 0,
    nodesExpanded: 0,
    path: [],
    f: hStart
  };

  while (!heap.isEmpty()) {
    const top = heap.pop();
    if (!top || closedMembership.has(top.value)) continue;
    const fromKey = top.value;
    const f = top.key;

    closed.push(fromKey);
    closedMembership.add(fromKey);
    openSet.delete(fromKey);
    nodesExpanded++;

    const g = gScore.get(fromKey);
    yield {
      type: 'expand',
      openSet: [...openSet],
      closedSet: [...closed],
      current: fromKey,
      cost: g,
      nodesExpanded,
      path: [],
      f
    };

    if (fromKey === goalKey) {
      const path = reconstruct(prev, startKey, goalKey);
      yield {
        type: 'complete',
        openSet: [],
        closedSet: [...closed],
        current: fromKey,
        cost: g,
        nodesExpanded,
        path,
        f
      };
      return;
    }

    const from = decode(fromKey);
    for (const { key: nk, weight } of neighboursFor(grid, from.row, from.col, allowDiagonal)) {
      const tentativeG = g + weight;
      const known = gScore.get(nk);
      if (known === undefined || tentativeG < known) {
        gScore.set(nk, tentativeG);
        prev.set(nk, fromKey);
        const nb = decode(nk);
        const fNew = tentativeG + inner(nb, goal);
        heap.push(fNew, nk);
        if (!openSet.has(nk)) openSet.add(nk);
        yield {
          type: 'inspect',
          openSet: [...openSet],
          closedSet: [...closed],
          current: fromKey,
          cost: g,
          nodesExpanded,
          path: [],
          candidate: { key: nk, g: tentativeG, f: fNew }
        };
      }
    }
  }

  yield {
    type: 'noPath',
    openSet: [],
    closedSet: [...closed],
    current: null,
    cost: null,
    nodesExpanded,
    path: []
  };
}

/**
 * Pure solver, used by the benchmarker.
 */
export function aStarSolve(grid, start, goal, opts = {}) {
  const allowDiagonal = opts.allowDiagonal !== false;
  const startKey = encode(start.row, start.col);
  const goalKey = encode(goal.row, goal.col);

  const baseName = opts.heuristic || 'manhattan';
  const isWeighted = String(baseName).toLowerCase() === 'weighted';
  const w = Math.max(1, opts.weight ?? 1);
  const inner = isWeighted
    ? weighted(opts.baseHeuristic || 'octile', w)
    : getHeuristic(baseName);

  const heap = new MinHeap();
  const gScore = new Map();
  const prev = new Map();
  const closed = new Set();
  gScore.set(startKey, 0);
  heap.push(inner(start, goal), startKey);
  let nodesExpanded = 0;

  while (!heap.isEmpty()) {
    const top = heap.pop();
    if (!top) break;
    const fromKey = top.value;
    if (closed.has(fromKey)) continue;
    closed.add(fromKey);
    nodesExpanded++;
    const g = gScore.get(fromKey);
    if (fromKey === goalKey) {
      return { path: reconstruct(prev, startKey, goalKey), cost: g, nodesExpanded };
    }
    const { row, col } = decode(fromKey);
    for (const { key: nk, weight } of neighboursFor(grid, row, col, allowDiagonal)) {
      const tentativeG = g + weight;
      const known = gScore.get(nk);
      if (known === undefined || tentativeG < known) {
        gScore.set(nk, tentativeG);
        prev.set(nk, fromKey);
        const nb = decode(nk);
        heap.push(tentativeG + inner(nb, goal), nk);
      }
    }
  }
  return { path: null, cost: null, nodesExpanded };
}

export const _internals = { encode, decode, reconstruct, neighboursFor };
