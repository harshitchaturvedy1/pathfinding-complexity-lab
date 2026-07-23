/**
 * Dijkstra on a uniform-cost 4/8-connected grid.
 *
 * The algorithm runs **as a JS Generator** so the playback layer can
 * advance frames one `yield` at a time without re-running the search.
 * At the same time we expose a non-generator `solve()` that returns
 * pure algorithmic metrics, used by the benchmarker to measure
 * execution time isolated from any DOM work.
 *
 * Encoding: cells are referenced by string keys `${row},${col}` —
 * V8 interns repeated shapes; <Map> lookups beat numeric arrays here.
 *
 * Yields frame shapes:
 *   { type: 'init',    openSet: string[], closedSet: string[], current: null, cost, nodesExpanded, path: [] }
 *   { type: 'expand',  openSet, closedSet, current: string | null, cost, nodesExpanded, path, frontierAdd?: string[] }
 *   { type: 'inspect', openSet, closedSet, current, cost, nodesExpanded, path, candidate: { key, newCost } }
 *   { type: 'complete',openSet, closedSet, current, cost, nodesExpanded, path: string[] }
 *   { type: 'noPath',  openSet, closedSet, current: null, cost: null, nodesExpanded, path: [] }
 */

import { MinHeap } from './minHeap.js';

const encode = (r, c) => `${r},${c}`;
const decode = (k) => {
  const i = k.indexOf(',');
  return { row: +k.slice(0, i), col: +k.slice(i + 1) };
};

/**
 * Build the 4-/8-neighbour adjacency list for a single cell.
 */
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

const SQRT2 = Math.SQRT2;

/**
 * Reconstruct the path from `prev` map.  Returns an array of encoded
 * keys in order from start → goal, or an empty array if unreachable.
 */
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
 * Dijkstra generator — yields one frame per algorithmic event.
 *
 * @param {Array<Array<{wall:boolean}>>} grid
 * @param {{row:number,col:number}} start
 * @param {{row:number,col:number}} goal
 * @param {{allowDiagonal?:boolean}} [opts]
 */
export function* dijkstraSteps(grid, start, goal, opts = {}) {
  const allowDiagonal = opts.allowDiagonal !== false;
  const startKey = encode(start.row, start.col);
  const goalKey = encode(goal.row, goal.col);

  const heap = new MinHeap();
  const dist = new Map();     // key -> best known g
  const prev = new Map();     // key -> predecessor key
  const closed = [];          // expansion order matters (for b*, renderer)
  const closedMembership = new Set();  // O(1) stale-pop filter
  const open = [];            // ordered: frontier keys
  const openSet = new Set();

  heap.push(0, startKey);
  openSet.add(startKey);
  open.push(startKey);
  dist.set(startKey, 0);

  let nodesExpanded = 0;

  yield {
    type: 'init',
    openSet: [...openSet],
    closedSet: [],
    current: null,
    cost: 0,
    nodesExpanded: 0,
    path: []
  };

  while (!heap.isEmpty()) {
    const top = heap.pop();
    if (!top || closedMembership.has(top.value)) {
      // Stale entry — already finalized at lower or equal cost.
      continue;
    }
    const fromKey = top.value;
    const g = top.key;

    closed.push(fromKey);
    closedMembership.add(fromKey);
    openSet.delete(fromKey);

    nodesExpanded++;
    const from = decode(fromKey);

    yield {
      type: 'expand',
      openSet: [...openSet],
      closedSet: [...closed],
      current: fromKey,
      cost: g,
      nodesExpanded,
      path: []
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
        path
      };
      return;
    }

    let frontierAdd = [];
    for (const { key: nk, weight } of neighboursFor(grid, from.row, from.col, allowDiagonal)) {
      const tentative = g + weight;
      const known = dist.get(nk);
      if (known === undefined || tentative < known) {
        dist.set(nk, tentative);
        prev.set(nk, fromKey);
        heap.push(tentative, nk);
        if (!openSet.has(nk)) {
          openSet.add(nk);
          open.push(nk);
          frontierAdd.push(nk);
        }
        yield {
          type: 'inspect',
          openSet: [...openSet],
          closedSet: [...closed],
          current: fromKey,
          cost: g,
          nodesExpanded,
          path: [],
          candidate: { key: nk, newCost: tentative }
        };
      }
    }

    if (frontierAdd.length) {
      yield {
        type: 'frontier',
        openSet: [...openSet],
        closedSet: [...closed],
        current: fromKey,
        cost: g,
        nodesExpanded,
        path: []
      };
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
 * Pure solver — runs to completion without yielding frames.
 * Used by the benchmarker for isolated µs measurements.
 *
 * @returns {{path:string[]|null, cost:number|null, nodesExpanded:number}}
 */
export function dijkstraSolve(grid, start, goal, opts = {}) {
  const allowDiagonal = opts.allowDiagonal !== false;
  const startKey = encode(start.row, start.col);
  const goalKey = encode(goal.row, goal.col);
  const heap = new MinHeap();
  const dist = new Map();
  const prev = new Map();
  const closed = new Set();
  heap.push(0, startKey);
  dist.set(startKey, 0);
  let nodesExpanded = 0;

  while (!heap.isEmpty()) {
    const top = heap.pop();
    if (!top) break;
    const fromKey = top.value;
    const g = top.key;
    if (closed.has(fromKey)) continue;
    closed.add(fromKey);
    nodesExpanded++;
    if (fromKey === goalKey) {
      return { path: reconstruct(prev, startKey, goalKey), cost: g, nodesExpanded };
    }
    const { row, col } = decode(fromKey);
    for (const { key: nk, weight } of neighboursFor(grid, row, col, allowDiagonal)) {
      const tentative = g + weight;
      const known = dist.get(nk);
      if (known === undefined || tentative < known) {
        dist.set(nk, tentative);
        prev.set(nk, fromKey);
        heap.push(tentative, nk);
      }
    }
  }
  return { path: null, cost: null, nodesExpanded };
}

export const _internals = { encode, decode, reconstruct, neighboursFor };
