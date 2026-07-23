/**
 * Jump Point Search (Harabor & Grastien 2011) — grid-only A* optimization.
 *
 * Instead of expanding every neighbor, JPS prunes symmetric paths by
 * "jumping" through straight lines until a forced neighbor or the goal
 * appears.  This produces the same optimal path as 8-connected A* with
 * typically 5-10x fewer expansions on open maps.
 *
 * IMPORTANT distance handling: when jump() reports a destination, the
 * WEIGHT of that edge is |deltaRow|+|deltaCol| decomposed into min diag
 * steps and the residual cardinal steps (cost = min * sqrt(2) +
 * (max - min) * 1).  This is the bug-fix that distinguishes canonical
 * JPS from a naive neighbour-pruning A*.
 *
 * Frame shape matches the existing A* layout exactly so the playback
 * layer is identical for all algorithms.
 */

import { MinHeap } from './minHeap.js';
import { ensureAdapter, GridGraphAdapter } from './graphAdapter.js';
import { getHeuristic } from './heuristics.js';

const SQRT2 = Math.SQRT2;

const DIAG_DIRS = [
  { dr: -1, dc: -1 }, { dr: -1, dc: 1 },
  { dr:  1, dc: -1 }, { dr:  1, dc: 1 }
];
const CARD_DIRS = [
  { dr: -1, dc:  0 }, { dr:  1, dc:  0 },
  { dr:  0, dc: -1 }, { dr:  0, dc:  1 }
];

function dirOf(dr, dc) {
  if (dr === 0 && dc === 0) return { dr: 0, dc: 0 };
  return { dr: Math.sign(dr), dc: Math.sign(dc) };
}

/**
 * Cost from (r0,c0) to (r1,c1) on a uniform 8-connected grid.
 * Decomposes into min(|dr|,|dc|) diagonal steps and the residual
 * cardinal steps.
 */
function stepDistance(r0, c0, r1, c1) {
  const dr = Math.abs(r1 - r0);
  const dc = Math.abs(c1 - c0);
  const m = Math.min(dr, dc);
  return m * SQRT2 + (dr > dc ? dr - m : dc - m) * 1;
}

/**
 * Recursive jump — walks in direction d until a forced neighbor exists,
 * the goal is reached, or an obstacle is hit.  Returns the destination
 * key or null.
 *
 * Cardinal d = (dr, 0) or (0, dc):
 *   forced: (nr, nc-1) or (nr, nc+1) when the adjacent cardinal cell
 *   blocks natural extension; canonical rule is two checks per direction.
 *
 * Diagonal d = (dr, dc):
 *   forced by a wall at (nr - dr, nc - dc) -> forced (nr, nc-dc) and
 *   (nr-dr, nc). Both keyed off the same corner wall (canonical).
 */
function jump(adapter, row, col, d, goalKey) {
  const nr = row + d.dr;
  const nc = col + d.dc;
  if (!adapter.passable(nr, nc)) return null;
  const nextKey = adapter.encodeKey(nr, nc);
  if (nextKey === goalKey) return nextKey;

  if (d.dc === 0) {
    // Cardinal vertical (col-1 / col+1 walls cause forced neighbours).
    if (!adapter.passable(nr - d.dr, nc - 1) && adapter.passable(nr, nc - 1)) return nextKey;
    if (!adapter.passable(nr - d.dr, nc + 1) && adapter.passable(nr, nc + 1)) return nextKey;
    return jump(adapter, nr, nc, d, goalKey);
  }
  if (d.dr === 0) {
    // Cardinal horizontal (row-1 / row+1 walls cause forced neighbours).
    if (!adapter.passable(nr - 1, nc - d.dc) && adapter.passable(nr - 1, nc)) return nextKey;
    if (!adapter.passable(nr + 1, nc - d.dc) && adapter.passable(nr + 1, nc)) return nextKey;
    return jump(adapter, nr, nc, d, goalKey);
  }

  // Diagonal: canonical forced-neighbour rule isTwo checks, both keyed
  // off a single corner wall at (nr - d.dr, nc - d.dc).
  if (!adapter.passable(nr - d.dr, nc - d.dc)) {
    if (adapter.passable(nr, nc - d.dc))      return nextKey;
    if (adapter.passable(nr - d.dr, nc))      return nextKey;
  }
  // Try cardinal sub-jumps; if either succeeds, this node IS a jump point.
  if (jump(adapter, nr, nc, { dr: d.dr, dc: 0 }, goalKey)) return nextKey;
  if (jump(adapter, nr, nc, { dr: 0, dc: d.dc }, goalKey)) return nextKey;
  return jump(adapter, nr, nc, d, goalKey);
}

/**
 * Identify jump-point successors for an expanded node n. For the start
 * node, parent === null so successors come from jumps in all 8 directions.
 */
function identifySuccessors(adapter, row, col, parentKey, goalKey) {
  const successors = [];
  if (parentKey == null) {
    for (const dir of [...CARD_DIRS, ...DIAG_DIRS]) {
      const jk = jump(adapter, row, col, dir, goalKey);
      if (!jk) continue;
      const { row: jr, col: jc } = adapter.decodeKey(jk);
      successors.push({ key: jk, weight: stepDistance(row, col, jr, jc) });
    }
    return successors;
  }

  const { row: pr, col: pc } = adapter.decodeKey(parentKey);
  const d = dirOf(row - pr, col - pc);

  // Continue along the line of approach.
  const jSame = jump(adapter, row, col, d, goalKey);
  if (jSame) {
    const { row: jr, col: jc } = adapter.decodeKey(jSame);
    successors.push({ key: jSame, weight: stepDistance(row, col, jr, jc) });
  }

  if (d.dr !== 0 && d.dc !== 0) {
    // Diagonal step — also try the two cardinal axes the diagonal lands on.
    if (adapter.passable(row - d.dr, col + d.dc)) {
      const j1 = jump(adapter, row, col, { dr: -d.dr, dc: d.dc }, goalKey);
      if (j1) {
        const { row: r1, col: c1 } = adapter.decodeKey(j1);
        successors.push({ key: j1, weight: stepDistance(row, col, r1, c1) });
      }
    }
    if (adapter.passable(row + d.dr, col - d.dc)) {
      const j2 = jump(adapter, row, col, { dr: d.dr, dc: -d.dc }, goalKey);
      if (j2) {
        const { row: r2, col: c2 } = adapter.decodeKey(j2);
        successors.push({ key: j2, weight: stepDistance(row, col, r2, c2) });
      }
    }
    if (adapter.passable(row, col - d.dc)) {
      const j3 = jump(adapter, row, col, { dr: 0, dc: -d.dc }, goalKey);
      if (j3) {
        const { row: r3, col: c3 } = adapter.decodeKey(j3);
        successors.push({ key: j3, weight: stepDistance(row, col, r3, c3) });
      }
    }
    if (adapter.passable(row - d.dr, col)) {
      const j4 = jump(adapter, row, col, { dr: -d.dr, dc: 0 }, goalKey);
      if (j4) {
        const { row: r4, col: c4 } = adapter.decodeKey(j4);
        successors.push({ key: j4, weight: stepDistance(row, col, r4, c4) });
      }
    }
  } else if (d.dr !== 0) {
    // Cardinal vertical: forced by side walls.
    if (!adapter.passable(row, col - 1) && adapter.passable(row + d.dr, col - 1)) {
      const j5 = jump(adapter, row, col, { dr: d.dr, dc: -1 }, goalKey);
      if (j5) {
        const { row: r5, col: c5 } = adapter.decodeKey(j5);
        successors.push({ key: j5, weight: stepDistance(row, col, r5, c5) });
      }
    }
    if (!adapter.passable(row, col + 1) && adapter.passable(row + d.dr, col + 1)) {
      const j6 = jump(adapter, row, col, { dr: d.dr, dc: 1 }, goalKey);
      if (j6) {
        const { row: r6, col: c6 } = adapter.decodeKey(j6);
        successors.push({ key: j6, weight: stepDistance(row, col, r6, c6) });
      }
    }
  } else {
    // Cardinal horizontal: forced by side walls.
    if (!adapter.passable(row - 1, col) && adapter.passable(row - 1, col + d.dc)) {
      const j7 = jump(adapter, row, col, { dr: -1, dc: d.dc }, goalKey);
      if (j7) {
        const { row: r7, col: c7 } = adapter.decodeKey(j7);
        successors.push({ key: j7, weight: stepDistance(row, col, r7, c7) });
      }
    }
    if (!adapter.passable(row + 1, col) && adapter.passable(row + 1, col + d.dc)) {
      const j8 = jump(adapter, row, col, { dr: 1, dc: d.dc }, goalKey);
      if (j8) {
        const { row: r8, col: c8 } = adapter.decodeKey(j8);
        successors.push({ key: j8, weight: stepDistance(row, col, r8, c8) });
      }
    }
  }
  return successors;
}

/**
 * Reconstruct the ancestor chain and EXPAND each jump gap into the
 * intermediate cells, so the final path covers every traversed cell.
 */
function reconstructPath(parent, startKey, goalKey, adapter) {
  const path = [];
  let cur = goalKey;
  const guard = 1e6;
  let cnt = 0;
  while (cur && cnt++ < guard) {
    const prev = parent.get(cur);
    if (prev == null) { path.push(cur); break; }
    const a = adapter.decodeKey(prev);
    const b = adapter.decodeKey(cur);
    const dr = Math.sign(b.row - a.row);
    const dc = Math.sign(b.col - a.col);
    let r = a.row, c = a.col;
    while (!(r === b.row && c === b.col)) {
      r += dr; c += dc;
      path.push(adapter.encodeKey(r, c));
    }
    cur = prev;
  }
  path.reverse();
  if (!path.includes(startKey)) path.unshift(startKey);
  return path;
}

export function* jpsSteps(topology, start, goal, opts = {}) {
  const adapter = (topology instanceof GridGraphAdapter) ? topology : ensureAdapter(topology, opts);
  if (!adapter.isGrid) throw new Error('Jump Point Search requires a grid topology');
  // JPS requires 8-connected grids.  Treat missing opts.allowDiagonal as true
  // (matches A* and Dijkstra defaults).
  if (opts.allowDiagonal === false) {
    throw new Error('Jump Point Search only supports 8-connected grids');
  }
  const startKey = adapter.encodeKey(start.row, start.col);
  const goalKey  = adapter.encodeKey(goal.row,  goal.col);
  const heuristic = getHeuristic(opts.heuristic || 'octile');

  const heap = new MinHeap();
  const gScore = new Map();
  const parent = new Map();
  const closed = [];
  const closedSet = new Set();

  gScore.set(startKey, 0);
  heap.push(heuristic(start, goal), startKey);
  let nodesExpanded = 0;

  yield {
    type: 'init',
    openSet: [], closedSet: [], current: null,
    cost: 0, nodesExpanded: 0, path: []
  };

  while (!heap.isEmpty()) {
    const top = heap.pop();
    if (!top || closedSet.has(top.value)) continue;
    const fromKey = top.value;
    closedSet.add(fromKey);
    closed.push(fromKey);
    nodesExpanded++;
    const from = adapter.getNodeData(fromKey);
    const g = gScore.get(fromKey);

    yield {
      type: 'expand',
      openSet: [], closedSet: [...closed],
      current: fromKey, cost: g, nodesExpanded, path: []
    };

    if (fromKey === goalKey) {
      const path = reconstructPath(parent, startKey, goalKey, adapter);
      yield {
        type: 'complete',
        openSet: [], closedSet: [...closed],
        current: fromKey, cost: g, nodesExpanded, path
      };
      return;
    }

    const successors = identifySuccessors(
      adapter, from.row, from.col, parent.get(fromKey) ?? null, goalKey
    );

    for (const { key: nKey, weight } of successors) {
      const ng = g + weight;
      const known = gScore.get(nKey);
      if (known == null || ng < known) {
        gScore.set(nKey, ng);
        parent.set(nKey, fromKey);
        const nd = adapter.getNodeData(nKey);
        const f = ng + heuristic(nd, goal);
        heap.push(f, nKey);
      }
    }
  }

  yield {
    type: 'noPath',
    openSet: [], closedSet: [...closed],
    current: null, cost: null, nodesExpanded, path: []
  };
}

export function jpsSolve(topology, start, goal, opts = {}) {
  const adapter = (topology instanceof GridGraphAdapter) ? topology : ensureAdapter(topology, opts);
  const startKey = adapter.encodeKey(start.row, start.col);
  const goalKey  = adapter.encodeKey(goal.row,  goal.col);
  const heuristic = getHeuristic(opts.heuristic || 'octile');
  const heap = new MinHeap();
  const gScore = new Map();
  const parent = new Map();
  const closedSet = new Set();
  gScore.set(startKey, 0);
  heap.push(heuristic(start, goal), startKey);
  let nodesExpanded = 0;

  while (!heap.isEmpty()) {
    const top = heap.pop();
    if (!top || closedSet.has(top.value)) continue;
    const fromKey = top.value;
    closedSet.add(fromKey);
    nodesExpanded++;
    const g = gScore.get(fromKey);
    if (fromKey === goalKey) {
      return { path: reconstructPath(parent, startKey, goalKey, adapter), cost: g, nodesExpanded };
    }
    const from = adapter.getNodeData(fromKey);
    const ps = identifySuccessors(adapter, from.row, from.col,
      parent.get(fromKey) ?? null, goalKey);
    for (const { key: nKey, weight } of ps) {
      const ng = g + weight;
      const known = gScore.get(nKey);
      if (known == null || ng < known) {
        gScore.set(nKey, ng);
        parent.set(nKey, fromKey);
        const nd = adapter.getNodeData(nKey);
        heap.push(ng + heuristic(nd, goal), nKey);
      }
    }
  }
  return { path: null, cost: null, nodesExpanded };
}
