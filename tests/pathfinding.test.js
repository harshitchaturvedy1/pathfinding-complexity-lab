import { describe, it, expect } from 'vitest';
import {
  manhattan, euclidean, octile, getHeuristic, weighted, HEURISTIC_NAMES
} from '../src/algorithms/heuristics.js';
import { dijkstraSteps, dijkstraSolve } from '../src/algorithms/dijkstra.js';
import { aStarSteps, aStarSolve } from '../src/algorithms/aStar.js';
import { benchmark, effectiveBranchingFactor } from '../src/engine/benchmarker.js';

function emptyGrid(r, c) {
  return Array.from({ length: r }, (_, row) =>
    Array.from({ length: c }, (_, col) => ({ wall: false, row, col }))
  );
}

/* ============================== Heuristics ============================== */

describe('Heuristics', () => {
  it('Manhattan = |dr| + |dc|', () => {
    expect(manhattan({ row: 0, col: 0 }, { row: 3, col: 4 })).toBe(7);
    expect(manhattan({ row: 5, col: 5 }, { row: 5, col: 5 })).toBe(0);
  });

  it('Euclidean = sqrt(dr² + dc²)', () => {
    expect(euclidean({ row: 0, col: 0 }, { row: 3, col: 4 })).toBeCloseTo(5, 6);
  });

  it('Octile = max + (sqrt2-1)·min on (3,4)', () => {
    // |dr|=3, |dc|=4 → max=4, min=3 → 4 + (√2-1)·3 ≈ 5.2426
    expect(octile({ row: 0, col: 0 }, { row: 3, col: 4 })).toBeCloseTo(
      4 + (Math.SQRT2 - 1) * 3,
      6
    );
  });

  it('Octile matches true 4·√2 distance on (4,4)', () => {
    // max=min=4 → 4 + (√2-1)·4 = 4·√2 exactly (exact heuristic on diagonal path).
    expect(octile({ row: 0, col: 0 }, { row: 4, col: 4 })).toBeCloseTo(4 * Math.SQRT2, 6);
  });

  it('getHeuristic throws on unknown', () => {
    expect(() => getHeuristic('pearson')).toThrow(/Unknown heuristic/);
  });

  it('weighted wrapper multiplies by clamp(w,1,∞)', () => {
    const h = weighted('manhattan', 0.5);              // clamps to 1
    expect(h({ row: 0, col: 0 }, { row: 3, col: 4 })).toBe(7);
    const h25 = weighted('octile', 2.5);
    const oct = octile({ row: 0, col: 0 }, { row: 3, col: 4 });
    expect(h25({ row: 0, col: 0 }, { row: 3, col: 4 })).toBeCloseTo(2.5 * oct, 6);
  });

  it('exposes canonical heuristic names', () => {
    expect(HEURISTIC_NAMES).toContain('manhattan');
    expect(HEURISTIC_NAMES).toContain('euclidean');
    expect(HEURISTIC_NAMES).toContain('octile');
    expect(HEURISTIC_NAMES).toContain('weighted');
  });
});

/* ============================== Dijkstra ============================== */

describe('Dijkstra', () => {
  it('finds optimal diagonal path on empty 5x5 grid', () => {
    const g = emptyGrid(5, 5);
    const r = dijkstraSolve(g, { row: 0, col: 0 }, { row: 4, col: 4 });
    expect(r.cost).toBeCloseTo(4 * Math.SQRT2, 6);
    expect(r.path.length).toBe(5);
    expect(r.nodesExpanded).toBe(25);
  });

  it('avoids walls and returns a longer path', () => {
    const g = emptyGrid(3, 3);
    g[1][1].wall = true;
    const r = dijkstraSolve(g, { row: 0, col: 0 }, { row: 2, col: 2 });
    expect(r.cost).toBeGreaterThan(2 * Math.SQRT2); // longer than straight diagonal
    expect(r.path).not.toContain('1,1');
  });

  it('returns noPath when target unreachable', () => {
    const g = emptyGrid(3, 3);
    g[1][0].wall = true; g[1][1].wall = true; g[1][2].wall = true; // vertical wall middle row
    const r = dijkstraSolve(g, { row: 0, col: 0 }, { row: 2, col: 2 });
    expect(r.cost).toBeNull();
    expect(r.path).toBeNull();
  });

  it('generator yields frames in causal order', () => {
    const g = emptyGrid(5, 5);
    const frames = [];
    for (const f of dijkstraSteps(g, { row: 0, col: 0 }, { row: 4, col: 4 })) frames.push(f);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].type).toBe('init');
    const last = frames[frames.length - 1];
    expect(['complete', 'noPath']).toContain(last.type);
    // Nodes expanded is monotonic across frames
    let prev = 0;
    for (const f of frames) {
      expect(f.nodesExpanded).toBeGreaterThanOrEqual(prev);
      prev = f.nodesExpanded;
    }
  });
});

/* ============================== A* ============================== */

describe('A*', () => {
  it('matches Dijkstra optimal cost across admissible heuristics', () => {
    const g = emptyGrid(20, 20);
    const start = { row: 0, col: 0 };
    const goal = { row: 19, col: 19 };
    const dij = dijkstraSolve(g, start, goal);
    for (const h of ['manhattan', 'euclidean', 'octile']) {
      const r = aStarSolve(g, start, goal, { heuristic: h, allowDiagonal: true });
      expect(r.cost).toBeCloseTo(dij.cost, 6);
    }
  });

  it('octile expands only optimal-path nodes on an open grid', () => {
    const g = emptyGrid(20, 20);
    const r = aStarSolve(g, { row: 0, col: 0 }, { row: 19, col: 19 },
      { heuristic: 'octile' });
    // Path is 19 diagonals ⇒ 20 cells; with exact heuristic A* never opens siblings
    expect(r.path.length).toBe(20);
    expect(r.nodesExpanded).toBe(20);
  });

  it('Weighted A* trades optimality for fewer expansions', () => {
    const g = emptyGrid(30, 30);
    const opt = aStarSolve(g, { row: 0, col: 0 }, { row: 29, col: 29 },
      { heuristic: 'octile' });
    const sub = aStarSolve(g, { row: 0, col: 0 }, { row: 29, col: 29 },
      { heuristic: 'weighted', baseHeuristic: 'octile', weight: 2.5 });
    expect(sub.nodesExpanded).toBeLessThanOrEqual(opt.nodesExpanded);
    // On an open grid the cost is unique regardless of heuristic admissibility,
    // so optimal cost must equal weighted cost when both are admissible paths.
    expect(sub.cost).toBeCloseTo(opt.cost, 6);
  });

  it('throws when an unknown heuristic is requested', () => {
    const g = emptyGrid(5, 5);
    expect(() =>
      [...aStarSteps(g, { row: 0, col: 0 }, { row: 1, col: 1 }, { heuristic: 'banana' })]
    ).toThrow(/Unknown heuristic/);
  });
});

/* ============================== Benchmarker / Metrics ============================== */

describe('Benchmarker / Metrics', () => {
  it('captures iteration count, path, and frames for Dijkstra', () => {
    const g = emptyGrid(10, 10);
    const out = benchmark('dijkstra', g, { row: 0, col: 0 }, { row: 9, col: 9 },
      { allowDiagonal: true });
    expect(out.frames.length).toBeGreaterThan(0);
    expect(out.metrics.pathCost).toBeCloseTo(9 * Math.SQRT2, 6);
    expect(out.metrics.completed).toBe(true);
    expect(out.metrics.effectiveBranchingFactor).toBeGreaterThan(1);
  });

  it('captures EBF and execution timing for A*', () => {
    const g = emptyGrid(20, 20);
    const out = benchmark('astar', g, { row: 0, col: 0 }, { row: 19, col: 19 },
      { heuristic: 'octile', allowDiagonal: true });
    expect(out.metrics.executionTimeUs).toBeGreaterThanOrEqual(0);
    expect(out.metrics.executionTimeMs).toBeCloseTo(out.metrics.executionTimeUs / 1000, 6);
    expect(out.metrics.effectiveBranchingFactor).toBeCloseTo(1, 1);
  });

  it('EBF solver returns 1 for perfect pruning and reflects N', () => {
    expect(effectiveBranchingFactor(5, 5.66)).toBe(1);    // N ≤ d + 1
    expect(effectiveBranchingFactor(1, 0)).toBe(1);         // single-node expansion
    // For N=100, d=10 the closed form has b* ≈ 1.402 (geometric means
    // ~10 children per frontier layer for a moderately-branching search).
    const b100 = effectiveBranchingFactor(100, 10);
    expect(b100).toBeGreaterThan(1.35);
    expect(b100).toBeLessThan(1.45);
    expect(effectiveBranchingFactor(0, 0)).toBe(0);         // untouched
    expect(effectiveBranchingFactor(null, 5)).toBeNull();  // missing data
  });
});

/* ============================== Edge / Performance ============================== */

describe('Performance invariant (100x100 grid under 50ms requirement)', () => {
  it('executes under 50ms for Dijkstra on 100x100 grid', () => {
    const g = emptyGrid(100, 100);
    const t0 = performance.now();
    const r = dijkstraSolve(g, { row: 0, col: 0 }, { row: 99, col: 99 });
    const dt = performance.now() - t0;
    expect(r.cost).toBeCloseTo(99 * Math.SQRT2, 6);
    expect(dt).toBeLessThan(50);
  });

  it('executes under 50ms for A* with octile on 100x100 grid', () => {
    const g = emptyGrid(100, 100);
    const t0 = performance.now();
    const r = aStarSolve(g, { row: 0, col: 0 }, { row: 99, col: 99 },
      { heuristic: 'octile' });
    const dt = performance.now() - t0;
    expect(r.path.length).toBe(100);
    expect(dt).toBeLessThan(50);
  });

  it('EBF Newton converges on larger workloads without overflowing', () => {
    // Simulates a 100×100 grid path: d ≈ 99·√2 ≈ 140 with N close to d+1 (octile perfect)
    const b1 = effectiveBranchingFactor(141, 140);
    expect(b1).toBeCloseTo(1, 1);
    // And a heavier expansion factor for a dense maze-like path.
    const b2 = effectiveBranchingFactor(800, 99);
    expect(b2).toBeGreaterThan(1);
    expect(b2).toBeLessThan(2);
  });
});
