/**
 * Bidirectional A* — two simultaneous A* searches meeting in the middle.
 *
 * Standard anytime-termination invariant (Aiken & Kumar):
 *
 *   terminate when min(min_f_forward, min_f_backward) ≥ best_meeting_cost
 *
 * where `best_meeting_cost = g_f(m) + g_b(m)` for every node m that has
 * been expanded (or relaxed) on BOTH sides.  Once that inequality holds,
 * no shorter path can exist because any extension would have f ≥
 * best_meeting_cost and could only lengthen the path.
 *
 * Caveats:
 *   - Forward h is from `n → goal`, backward h is from `n → start`.
 *   - Heuristic must be CONSISTENT (not just admissible) for the
 *     termination invariant to hold. Standard Manhattan/Euclidean/Octile
 *     are consistent on uniform-cost graphs.
 *   - Weighted A* (w > 1) with bidirectional search is KNOWN to break
 *     the standard termination; we restrict Bidirectional A* to w=1
 *     here.  See threshold-bounded bidir variants if needed later.
 *
 * Frame shape matches the existing layout — prefixed keys
 * ('f:' / 'b:') distinguish the two frontiers/closed sets so the
 * renderer can color them independently.
 */

import { MinHeap } from './minHeap.js';
import { ensureAdapter } from './graphAdapter.js';
import { getHeuristic, weighted } from './heuristics.js';

function reconstructBidir(parentF, parentB, meetKey) {
  const fromStart = [];
  let cur = meetKey;
  let guard = 0;
  while (cur != null && guard++ < 1e6) {
    fromStart.push(cur);
    if (parentF.get(cur) == null) break;
    cur = parentF.get(cur);
  }
  fromStart.reverse();

  const fromGoal = [];
  cur = meetKey;
  guard = 0;
  while (cur != null && guard++ < 1e6) {
    if (parentB.get(cur) == null) {
      fromGoal.push(cur);
      break;
    }
    cur = parentB.get(cur);
    fromGoal.push(cur);
  }
  return [...fromStart, ...fromGoal];
}

/**
 * Bidirectional A* generator.
 *
 * Prefixed openSet/closedSet entries:
 *   'f:<key>'  → forward (start→goal) frontier/closed
 *   'b:<key>'  → backward (goal→start) frontier/closed
 */
export function* bidirSteps(topology, start, goal, opts = {}) {
  const adapter = ensureAdapter(topology, opts);
  const startKey = (typeof start === 'object' && start.row != null) ? adapter.encodeKey(start.row, start.col) : String(start.id ?? start);
  const goalKey  = (typeof goal  === 'object' && goal.row  != null) ? adapter.encodeKey(goal.row,  goal.col)  : String(goal.id  ?? goal);
  const w = Math.max(1, opts.weight ?? 1);
  if (w > 1) {
    throw new Error('Bidirectional A*: standard termination requires w=1 (admissible+consistent heuristic)');
  }
  const heuristic = getHeuristic(opts.heuristic || 'octile');

  const openF = new MinHeap();
  const openB = new MinHeap();
  const gF = new Map();
  const gB = new Map();
  const parentF = new Map();
  const parentB = new Map();
  const closedF = new Set();
  const closedB = new Set();
  const openFSet = new Set();
  const openBSet = new Set();
  const orderF = [];
  const orderB = [];

  gF.set(startKey, 0);
  gB.set(goalKey, 0);
  openF.push(heuristic(adapter.getNodeData(startKey), adapter.getNodeData(goalKey)), startKey);
  openB.push(heuristic(adapter.getNodeData(goalKey), adapter.getNodeData(startKey)), goalKey);
  openFSet.add(startKey); orderF.push(startKey);
  openBSet.add(goalKey);  orderB.push(goalKey);

  let bestMeeting = null;
  let bestMeetingCost = Infinity;
  let nodesExpanded = 0;

  yield {
    type: 'init',
    openSet:    orderF.map((k) => 'f:' + k).concat(orderB.map((k) => 'b:' + k)),
    closedSet:  [],
    current:    null,
    cost:       0,
    nodesExpanded: 0,
    path:       []
  };

  function expandOne(sideKey) {
    const isF = sideKey === 'F';
    const open = isF ? openF : openB;
    const gMap = isF ? gF : gB;
    const parentMap = isF ? parentF : parentB;
    const closed = isF ? closedF : closedB;
    const openSet = isF ? openFSet : openBSet;
    const order = isF ? orderF : orderB;
    const otherClosed = isF ? closedB : closedF;
    const otherG = isF ? gB : gF;
    const prefix = isF ? 'f:' : 'b:';

    const top = open.pop();
    if (!top) return false;
    const fromKey = top.value;
    if (closed.has(fromKey)) return true; // stale
    if (openSet.has(fromKey)) {
      openSet.delete(fromKey);
      const idx = order.indexOf(fromKey);
      if (idx >= 0) order.splice(idx, 1);
    }
    closed.add(fromKey);
    order.push(fromKey);

    nodesExpanded++;
    const from = adapter.getNodeData(fromKey);
    const g = gMap.get(fromKey);

    const targetKeyForH = isF ? goalKey : startKey;
    const neighbors = adapter.getNeighbors(fromKey);
    for (const { key: nKey, weight } of neighbors) {
      if (closed.has(nKey)) continue;
      const ng = g + weight;
      const known = gMap.get(nKey);
      if (known == null || ng < known) {
        gMap.set(nKey, ng);
        parentMap.set(nKey, fromKey);
        const nd = adapter.getNodeData(nKey);
        const f = ng + heuristic(nd, adapter.getNodeData(targetKeyForH));
        open.push(f, nKey);
        if (!openSet.has(nKey)) { openSet.add(nKey); order.push(nKey); }

        // Update meeting candidate if reachable from the other side as well.
        const oG = otherG.get(nKey);
        if (oG != null) {
          const cand = oG + ng;
          if (cand < bestMeetingCost) {
            bestMeetingCost = cand;
            bestMeeting = nKey;
          }
        }
      }
    }
    return true;
  }

  while (!openF.isEmpty() || !openB.isEmpty()) {
    // Pop smaller side first (standard "anytime" interleaving).
    const fTop = openF.peek();
    const bTop = openB.peek();
    const fMin = fTop ? fTop.key : Infinity;
    const bMin = bTop ? bTop.key : Infinity;
    if (fMin <= bMin) {
      if (!expandOne('F')) break;
    } else {
      if (!expandOne('B')) break;
    }

    // Termination check.
    if (bestMeetingCost < Infinity) {
      const minFuture = Math.min(
        fTop ? fTop.key : Infinity,
        bTop ? bTop.key : Infinity
      );
      if (minFuture >= bestMeetingCost) {
        break;
      }
    }

    yield {
      type: 'expand',
      openSet: orderF.filter((k) => !closedF.has(k) && openFSet.has(k))
                    .map((k) => 'f:' + k)
                    .concat(
                      orderB.filter((k) => !closedB.has(k) && openBSet.has(k))
                            .map((k) => 'b:' + k)
                    ),
      closedSet: [...closedF].map((k) => 'f:' + k)
                  .concat([...closedB].map((k) => 'b:' + k)),
      current: null,
      cost: bestMeeting < Infinity ? bestMeetingCost : null,
      nodesExpanded,
      path: []
    };
  }

  if (bestMeeting != null) {
    const path = reconstructBidir(parentF, parentB, bestMeeting);
    yield {
      type: 'complete',
      openSet: [],
      closedSet: [...closedF].map((k) => 'f:' + k).concat([...closedB].map((k) => 'b:' + k)),
      current: bestMeeting,
      cost: bestMeetingCost,
      nodesExpanded,
      path
    };
    return;
  }

  yield {
    type: 'noPath',
    openSet: [],
    closedSet: [...closedF].map((k) => 'f:' + k).concat([...closedB].map((k) => 'b:' + k)),
    current: null,
    cost: null,
    nodesExpanded,
    path: []
  };
}

export function bidirSolve(topology, start, goal, opts = {}) {
  const adapter = ensureAdapter(topology, opts);
  const startKey = (typeof start === 'object' && start.row != null) ? adapter.encodeKey(start.row, start.col) : String(start.id ?? start);
  const goalKey  = (typeof goal  === 'object' && goal.row  != null) ? adapter.encodeKey(goal.row,  goal.col)  : String(goal.id  ?? goal);
  const heuristic = getHeuristic(opts.heuristic || 'octile');
  const openF = new MinHeap();
  const openB = new MinHeap();
  const gF = new Map();
  const gB = new Map();
  const parentF = new Map();
  const parentB = new Map();
  const closedF = new Set();
  const closedB = new Set();
  gF.set(startKey, 0);
  gB.set(goalKey,  0);
  openF.push(heuristic(adapter.getNodeData(startKey), adapter.getNodeData(goalKey)), startKey);
  openB.push(heuristic(adapter.getNodeData(goalKey),  adapter.getNodeData(startKey)), goalKey);
  let bestMeeting = null;
  let bestMeetingCost = Infinity;
  let nodesExpanded = 0;

  function step(side) {
    const open = side === 'F' ? openF : openB;
    const gMap = side === 'F' ? gF : gB;
    const parentMap = side === 'F' ? parentF : parentB;
    const closed = side === 'F' ? closedF : closedB;
    const otherG = side === 'F' ? gB : gF;
    const targetKey = side === 'F' ? goalKey : startKey;
    const top = open.pop();
    if (!top) return false;
    const fromKey = top.value;
    if (closed.has(fromKey)) return true;
    closed.add(fromKey);
    nodesExpanded++;
    const g = gMap.get(fromKey);
    for (const { key: nKey, weight } of adapter.getNeighbors(fromKey)) {
      if (closed.has(nKey)) continue;
      const ng = g + weight;
      const known = gMap.get(nKey);
      if (known == null || ng < known) {
        gMap.set(nKey, ng);
        parentMap.set(nKey, fromKey);
        const nd = adapter.getNodeData(nKey);
        open.push(ng + heuristic(nd, adapter.getNodeData(targetKey)), nKey);
        const oG = otherG.get(nKey);
        if (oG != null) {
          const cand = oG + ng;
          if (cand < bestMeetingCost) {
            bestMeetingCost = cand;
            bestMeeting = nKey;
          }
        }
      }
    }
    return true;
  }

  while (!openF.isEmpty() || !openB.isEmpty()) {
    const fK = openF.peek(); const bK = openB.peek();
    const fMin = fK ? fK.key : Infinity;
    const bMin = bK ? bK.key : Infinity;
    if (fMin <= bMin) { if (!step('F')) break; } else { if (!step('B')) break; }
    if (bestMeetingCost < Infinity) {
      const minFuture = Math.min(openF.peek()?.key ?? Infinity, openB.peek()?.key ?? Infinity);
      if (minFuture >= bestMeetingCost) break;
    }
  }

  if (bestMeeting != null) {
    return { path: reconstructBidir(parentF, parentB, bestMeeting), cost: bestMeetingCost, nodesExpanded };
  }
  return { path: null, cost: null, nodesExpanded };
}
