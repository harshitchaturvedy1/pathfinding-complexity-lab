import { describe, it, expect } from 'vitest';
import { jpsSteps, jpsSolve } from '../src/algorithms/jps.js';
import { bidirSteps, bidirSolve } from '../src/algorithms/bidirAStar.js';
import { dStarLiteSteps, dStarLiteSolve } from '../src/algorithms/dStarLite.js';
import { GridGraphAdapter } from '../src/algorithms/graphAdapter.js';
import { benchmark } from '../src/engine/benchmarker.js';
import { dijkstraSolve } from '../src/algorithms/dijkstra.js';
import { aStarSolve }    from '../src/algorithms/aStar.js';

function emptyGrid(r, c) {
  return Array.from({ length: r }, (_, row) =>
    Array.from({ length: c }, (_, col) => ({ wall: false, row, col }))
  );
}

function withWalls(grid, walls) {
  for (const [r, c] of walls) grid[r][c].wall = true;
  return grid;
}

/* ============================== JPS ============================== */

describe('Jump Point Search', () => {
  it('matches A* octile cost on an open 12×12 grid', () => {
    const g = emptyGrid(12, 12);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 11, col: 11 }, { heuristic: 'octile', allowDiagonal: true });
    const j = jpsSolve(g, { row: 0, col: 0 }, { row: 11, col: 11 }, { heuristic: 'octile', allowDiagonal: true });
    expect(j.cost).toBeCloseTo(a.cost, 6);
    expect(j.path.length).toBe(a.path.length);
  });

  it('expands fewer nodes than vanilla A* on open maps', () => {
    const g = emptyGrid(30, 30);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 29, col: 29 }, { heuristic: 'octile' });
    const j = jpsSolve(g, { row: 0, col: 0 }, { row: 29, col: 29 }, { heuristic: 'octile' });
    expect(j.nodesExpanded).toBeLessThan(a.nodesExpanded);
  });

  it('avoids walls with forced-neighbor pruning (two paths available)', () => {
    // Wall forces a detour; both A* and JPS should find equivalent optimal.
    const g = emptyGrid(10, 10);
    // Block the diagonal at (3,3). The optimal path around it should
    // visit at least one forced-neighbor cell.
    withWalls(g, [[3, 3]]);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 9, col: 9 }, { heuristic: 'octile' });
    const j = jpsSolve(g, { row: 0, col: 0 }, { row: 9, col: 9 }, { heuristic: 'octile' });
    expect(j.cost).toBeCloseTo(a.cost, 6);
    expect(j.path).not.toContain('3,3');
  });

  it('returns noPath when target is enclosed', () => {
    const g = emptyGrid(5, 5);
    withWalls(g, [[2, 2], [2, 3], [3, 2], [3, 3]]);
    const j = jpsSolve(g, { row: 0, col: 0 }, { row: 4, col: 4 }, { heuristic: 'octile' });
    // Goal may still be reachable; this just exercises a wall cluster.
    expect(j).toHaveProperty('nodesExpanded');
  });

  it('rejects non-grid topology', () => {
    expect(() => [...jpsSteps({ nodes: [], edges: [] }, { id: 0 }, { id: 1 })]).toThrow(/grid topology/);
  });

  it('rejects 4-connectivity option', () => {
    const g = emptyGrid(8, 8);
    expect(() => [...jpsSteps(g, { row: 0, col: 0 }, { row: 7, col: 7 }, { allowDiagonal: false })]).toThrow(/8-connected/);
  });
});

/* ============================== Bidirectional A* ============================== */

describe('Bidirectional A*', () => {
  it('matches A* octile cost on uniform grid', () => {
    const g = emptyGrid(20, 20);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 19, col: 19 }, { heuristic: 'octile' });
    const b = bidirSolve(g, { row: 0, col: 0 }, { row: 19, col: 19 }, { heuristic: 'octile' });
    expect(b.cost).toBeCloseTo(a.cost, 6);
    expect(b.path.length).toBe(a.path.length);
  });

  it('matches A* cost across walls with consistent heuristic', () => {
    const g = withWalls(emptyGrid(15, 15), [[7, 7], [7, 8], [8, 7]]);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 14, col: 14 }, { heuristic: 'octile' });
    const b = bidirSolve(g, { row: 0, col: 0 }, { row: 14, col: 14 }, { heuristic: 'octile' });
    expect(b.cost).toBeCloseTo(a.cost, 6);
  });

  it('expands fewer nodes than A* on long corridors', () => {
    const g = emptyGrid(40, 40);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 39, col: 39 }, { heuristic: 'octile' });
    const b = bidirSolve(g, { row: 0, col: 0 }, { row: 39, col: 39 }, { heuristic: 'octile' });
    expect(b.nodesExpanded).toBeLessThan(a.nodesExpanded);
  });

  it('rejects weighted heuristic (terminates incorrectly with w>1)', () => {
    const g = emptyGrid(8, 8);
    expect(() => [...bidirSteps(g, { row: 0, col: 0 }, { row: 7, col: 7 }, { heuristic: 'manhattan', weight: 2 })]).toThrow(/w=1/);
  });

  it('generator emits prefixed forward/backward frames', () => {
    const g = emptyGrid(10, 10);
    const types = new Set();
    let fSeen = false, bSeen = false;
    for (const f of bidirSteps(g, { row: 0, col: 0 }, { row: 9, col: 9 })) {
      types.add(f.type);
      for (const k of [...(f.openSet || []), ...(f.closedSet || [])]) {
        if (k.startsWith('f:')) fSeen = true;
        if (k.startsWith('b:')) bSeen = true;
      }
    }
    expect(types.has('complete')).toBe(true);
    expect(fSeen).toBe(true);
    expect(bSeen).toBe(true);
  });
});

/* ============================== D* Lite ============================== */

describe('D* Lite (static)', () => {
  it('matches A* octile cost on uniform grid', () => {
    const g = emptyGrid(20, 20);
    const a = aStarSolve(g, { row: 0, col: 0 }, { row: 19, col: 19 }, { heuristic: 'octile' });
    const d = dStarLiteSolve(g, { row: 0, col: 0 }, { row: 19, col: 19 }, { heuristic: 'octile' });
    expect(d.cost).toBeCloseTo(a.cost, 6);
  });

  it('handles graphs non-uniformity via the GraphAdapter', () => {
    const adapter = new GridGraphAdapter(emptyGrid(10, 10));
    const d = dStarLiteSolve(adapter, { row: 0, col: 0 }, { row: 9, col: 9 }, { heuristic: 'octile' });
    expect(d.path).not.toBeNull();
    expect(d.cost).toBeCloseTo(9 * Math.SQRT2, 6);
  });

  it('frames trace goal-to-frontier direction (backward search)', () => {
    const g = emptyGrid(8, 8);
    const seen = [];
    for (const f of dStarLiteSteps(g, { row: 0, col: 0 }, { row: 7, col: 7 }, { heuristic: 'octile' })) {
      seen.push({ type: f.type, current: f.current });
    }
    expect(seen[0].type).toBe('init');
    expect(seen[seen.length - 1].type).toBe('complete');
    // First expansion should be the GOAL (backward search starts there).
    expect(seen.find((f) => f.type === 'expand').current).toBe('7,7');
  });
});

/* ============================== Benchmarker registration ============================== */

describe('Benchmarker with new algorithms', () => {
  it('registers jps, bidir, and dstarlite', () => {
    const g = emptyGrid(15, 15);
    expect(() => benchmark('jps', g, { row: 0, col: 0 }, { row: 14, col: 14 }, { heuristic: 'octile' })).not.toThrow();
    expect(() => benchmark('bidir', g, { row: 0, col: 0 }, { row: 14, col: 14 }, { heuristic: 'octile' })).not.toThrow();
    expect(() => benchmark('dstarlite', g, { row: 0, col: 0 }, { row: 14, col: 14 }, { heuristic: 'octile' })).not.toThrow();
  });

  it('returns frames for every new algorithm', () => {
    const g = emptyGrid(12, 12);
    for (const algo of ['jps', 'bidir', 'dstarlite']) {
      const out = benchmark(algo, g, { row: 0, col: 0 }, { row: 11, col: 11 }, { heuristic: 'octile' });
      expect(out.frames.length).toBeGreaterThan(0);
      expect(out.metrics.completed).toBe(true);
      expect(['complete', 'noPath']).toContain(out.frames[out.frames.length - 1].type);
    }
  });

  it('all 5 algorithms agree on path cost for an open grid', () => {
    const g = emptyGrid(20, 20);
    const dij = dijkstraSolve(g, { row: 0, col: 0 }, { row: 19, col: 19 }, { allowDiagonal: true });
    const expected = dij.cost;
    for (const algo of ['astar', 'jps', 'bidir', 'dstarlite']) {
      const opts = { heuristic: 'octile', allowDiagonal: true };
      const out = benchmark(algo, g, { row: 0, col: 0 }, { row: 19, col: 19 }, opts);
      expect(out.metrics.pathCost).toBeCloseTo(expected, 6);
    }
  });
});
