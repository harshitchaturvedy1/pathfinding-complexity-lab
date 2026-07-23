/**
 * D* Lite (Koenig & Likhachev 2002) — incremental A* via rhs/g/key
 * bookkeeping.  The static one-shot variant (km = 0, no edge updates)
 * degenerates exactly into a backward A* search originating from the
 * goal; we keep the canonical key-aware heap semantics so an
 * incremental caller can plug in without re-architecting.
 *
 * Performance: per-predecessor rhs updates read from a pre-indexed
 * `Map<'u|v', weight>` so we never scan neighbours inside the search
 * loop.  The predecessor map itself is built once from goal via DFS
 * (sufficient for static searches because we never visit a node whose
 * predecessors we don't already know).
 */

import { ensureAdapter } from './graphAdapter.js';
import { getHeuristic } from './heuristics.js';

function keyLess(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}
function calcKey(g, rhs, hStart) {
  const m = Math.min(g ?? Infinity, rhs ?? Infinity);
  return [m + hStart, m];
}

class KeyHeap {
  constructor() { this.a = []; this._seq = 0; }
  get size() { return this.a.length; }
  isEmpty() { return this.a.length === 0; }
  pop() {
    if (this.a.length === 0) return undefined;
    const top = this.a[0]; const last = this.a.pop();
    if (this.a.length > 0) { this.a[0] = last; this._down(0); }
    return top;
  }
  push(key, value) {
    this.a.push({ key, value, seq: this._seq++ });
    this._up(this.a.length - 1);
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      const a = this.a[i], b = this.a[p];
      const less = keyLess(a.key, b.key);
      if (less < 0 || (less === 0 && a.seq < b.seq)) {
        const t = this.a[i]; this.a[i] = this.a[p]; this.a[p] = t;
        i = p;
      } else break;
    }
  }
  _down(i) {
    const n = this.a.length;
    while (true) {
      const l = (i << 1) + 1; const r = l + 1;
      let best = i;
      for (const k of [l, r]) {
        if (k >= n) continue;
        const a = this.a[k], b = this.a[best];
        const less = keyLess(a.key, b.key);
        if (less < 0 || (less === 0 && a.seq < b.seq)) best = k;
      }
      if (best === i) break;
      const t = this.a[i]; this.a[i] = this.a[best]; this.a[best] = t;
      i = best;
    }
  }
}

function buildPredecessorsFromGoal(adapter, goalKey) {
  const preds = new Map();
  const seen = new Set();
  const stack = [{ node: goalKey, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (seen.has(node) || depth > 1e6) continue;
    seen.add(node);
    for (const { key } of adapter.getNeighbors(node)) {
      if (!preds.has(key)) preds.set(key, []);
      preds.get(key).push(node);
      stack.push({ node: key, depth: depth + 1 });
    }
  }
  return preds;
}

function buildEdgeIndex(adapter, rootKey) {
  /** @type {Map<string, number>} */
  const m = new Map();
  const seen = new Set();
  const stack = [rootKey];
  while (stack.length) {
    const u = stack.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    for (const { key, weight } of adapter.getNeighbors(u)) {
      const k = u < key ? `${u}|${key}` : `${key}|${u}`;
      if (!m.has(k)) m.set(k, weight);
      if (!seen.has(key)) stack.push(key);
    }
  }
  return m;
}

function edgeOf(idx, a, b) {
  return idx.get(a < b ? `${a}|${b}` : `${b}|${a}`);
}

function reconstructReverse(parent, startKey, goalKey) {
  const path = [];
  let cur = goalKey;
  let guard = 0;
  while (cur != null && guard++ < 1e6) {
    path.push(cur);
    if (cur === startKey) break;
    cur = parent.get(cur);
  }
  return path.reverse();
}

function defaultH(adapter, fromKey, toKey) {
  const a = adapter.getNodeData(fromKey), b = adapter.getNodeData(toKey);
  const dr = (a.row ?? a.y) - (b.row ?? b.y);
  const dc = (a.col ?? a.x) - (b.col ?? b.x);
  return Math.sqrt(dr * dr + dc * dc);
}

/**
 * D* Lite static-search generator.
 *
 * Frame shape: { type, openSet, closedSet, current, cost, nodesExpanded, path }.
 */
export function* dStarLiteSteps(topology, start, goal, opts = {}) {
  const adapter = ensureAdapter(topology, opts);
  const startKey = (typeof start === 'object' && start.row != null)
    ? adapter.encodeKey(start.row, start.col) : String(start.id ?? start);
  const goalKey = (typeof goal === 'object' && goal.row != null)
    ? adapter.encodeKey(goal.row, goal.col) : String(goal.id ?? goal);

  const h = opts.heuristic == null
    ? (a, b) => defaultH(adapter, a, b)
    : typeof opts.heuristic === 'function'
    ? opts.heuristic
    : getHeuristic(opts.heuristic);

  const preds = buildPredecessorsFromGoal(adapter, goalKey);
  const edgeIdx = buildEdgeIndex(adapter, goalKey);

  const g = new Map();
  const rhs = new Map();
  const parent = new Map();
  const open = new KeyHeap();
  const openMembership = new Set();
  const closed = [];
  const closedSet = new Set();

  rhs.set(goalKey, 0);
  const k0 = calcKey(g, rhs, h(adapter.getNodeData(goalKey), adapter.getNodeData(startKey)));
  open.push(k0, goalKey);
  openMembership.add(goalKey);

  let nodesExpanded = 0;

  yield {
    type: 'init',
    openSet:    [...openMembership],
    closedSet:  [],
    current:    null,
    cost:       0,
    nodesExpanded: 0,
    path:       []
  };

  /**
   * rhs(s) = min over successors s' of g(s') + c(s, s').  Computed
   * from the open-set successors (those with a known g).  We use the
   * pre-indexed edge table for O(1) cost reads.
   */
  function recomputeRhs(s) {
    let best = Infinity;
    for (const sp of preds.get(s) || []) {
      const gs = g.get(sp);
      if (gs == null) continue;
      const w = edgeOf(edgeIdx, s, sp);
      if (w == null) continue;
      const cand = gs + w;
      if (cand < best) best = cand;
    }
    return best;
  }

  function updateVertex(u) {
    if (closedSet.has(u)) {
      // Continue holding an entry only when inconsistent.
      if (g.get(u) !== rhs.get(u)) {
        const kU = calcKey(g, rhs, h(adapter.getNodeData(u), adapter.getNodeData(startKey)));
        open.push(kU, u);
        openMembership.add(u);
      }
    } else if (g.get(u) !== rhs.get(u)) {
      const kU = calcKey(g, rhs, h(adapter.getNodeData(u), adapter.getNodeData(startKey)));
      open.push(kU, u);
      openMembership.add(u);
    }
  }

  while (!open.isEmpty()) {
    const top = open.pop();
    if (!top) break;
    const u = top.value;
    if (closedSet.has(u)) continue;

    openMembership.delete(u);
    closedSet.add(u);
    closed.push(u);
    nodesExpanded++;

    yield {
      type: 'expand',
      openSet:    [...openMembership],
      closedSet:  [...closed],
      current:    u,
      cost:       rhs.get(u) ?? g.get(u) ?? null,
      nodesExpanded,
      path:       []
    };

    const gS = g.get(startKey);
    const rhsS = rhs.get(startKey);
    const startConsistent = gS != null && rhsS != null && gS === rhsS;

    if (startConsistent) {
      const kStart = calcKey(g, rhs, h(adapter.getNodeData(startKey), adapter.getNodeData(startKey)));
      const next = open.peek();
      // Termination: top-of-open not less-than key(start).
      if (!next || keyLess(kStart, next.key) <= 0) {
        const path = reconstructReverse(parent, startKey, goalKey);
        yield {
          type: 'complete',
          openSet:    [],
          closedSet:  [...closed],
          current:    u,
          cost:       rhsS,
          nodesExpanded,
          path
        };
        return;
      }
    }

    const gU = g.get(u);
    const rhsU = rhs.get(u);
    if (gU == null || rhsU < gU) {
      // Overconsistent — lower g(u) to rhs(u).
      g.set(u, rhsU);
      for (const s of preds.get(u) || []) {
        if (closedSet.has(s)) continue;
        rhs.set(s, recomputeRhs(s));
        parent.set(s, u);
        updateVertex(s);
      }
    } else if (gU > rhsU) {
      // Underconsistent — raise g(u) to Infinity and propagate.
      g.set(u, Infinity);
      for (const s of preds.get(u) || []) {
        if (closedSet.has(s)) continue;
        rhs.set(s, Infinity);
        rhs.set(s, recomputeRhs(s));
        parent.set(s, u);
        updateVertex(s);
      }
    }
  }

  yield {
    type: 'noPath',
    openSet:    [],
    closedSet:  [...closed],
    current:    null,
    cost:       null,
    nodesExpanded,
    path:       []
  };
}

export function dStarLiteSolve(topology, start, goal, opts = {}) {
  let path = null, cost = null, nodesExpanded = 0;
  for (const f of dStarLiteSteps(topology, start, goal, opts)) {
    nodesExpanded = f.nodesExpanded ?? nodesExpanded;
    if (f.type === 'complete') { path = f.path; cost = f.cost; return { path, cost, nodesExpanded }; }
    if (f.type === 'noPath')   { return { path: null, cost: null, nodesExpanded }; }
  }
  return { path, cost, nodesExpanded };
}

/**
 * Future incremental API — surface area for dynamic replanning.
 * In the static benchmark we do NOT call this.  Provided so callers
 * can wire dynamic maps without re-architecting the search.
 */
export class DStarLiteRuntime {
  constructor(adapter, startKey, goalKey, opts = {}) {
    this.adapter = adapter;
    this.startKey = startKey;
    this.goalKey = goalKey;
    this.opts = opts;
  }
  changeEdgeCost(/* u, v, newCost */) {
    throw new Error('Not implemented in static build');
  }
}
