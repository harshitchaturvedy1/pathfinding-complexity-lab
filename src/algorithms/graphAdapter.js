/**
 * GraphAdapter — uniform neighbors/edge-cost interface that lets any
 * algorithm work over BOTH a rectangular grid topology and an
 * arbitrary node-edge graph.  Algorithms hand back nodes by their
 * `key` string; the adapter resolves coordinates, neighbors, and edge
 * weights from those keys.
 *
 * Two concrete adapters:
 *   GridGraphAdapter        — wraps `{rows × cols}` uniform grid
 *   AdjacencyGraphAdapter   — wraps arbitrary graphs (random geometric,
 *                             small-world, road network, user-drawn)
 *
 * Algorithms register themselves with the benchmarker (`benchmarker.js`)
 * and read topology through `ensureAdapter(topology, opts)`.  This lets
 * the existing `dijkstra`/`astar` (grid-only) coexist with the new
 * `jps`, `bidirAStar`, `dStarLite` that require the richer interface.
 */

const CARD4 = [
  [-1,  0, 1], [1,  0, 1], [0, -1, 1], [0, 1, 1]
];
const CARD8 = CARD4.concat([
  [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2],
  [ 1, -1, Math.SQRT2], [ 1, 1, Math.SQRT2]
]);

export class GraphAdapter {
  constructor() { this.isGrid = false; }
  /** @returns {{key:string, weight:number}[]} */
  getNeighbors(/* nodeKey */) { throw new Error('abstract getNeighbors'); }
  /** @returns {{row?:number,col?:number,x?:number,y?:number}} */
  getNodeData(/* nodeKey */) { throw new Error('abstract getNodeData'); }
}

export class GridGraphAdapter extends GraphAdapter {
  constructor(grid, opts = {}) {
    super();
    this.grid = grid;
    this.rows = grid.length;
    this.cols = grid[0].length;
    this.allowDiagonal = opts.allowDiagonal !== false;
    this._dirs = this.allowDiagonal ? CARD8 : CARD4;
    this.isGrid = true;
  }
  decodeKey(k) {
    const i = k.indexOf(',');
    return { row: +k.slice(0, i), col: +k.slice(i + 1) };
  }
  encodeKey(row, col) { return row + ',' + col; }
  isWall(r, c) {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return true;
    return !!this.grid[r][c].wall;
  }
  /** @returns {boolean} true if in bounds and not a wall */
  passable(r, c) {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return false;
    return !this.grid[r][c].wall;
  }
  getNeighbors(key) {
    const { row, col } = this.decodeKey(key);
    if (this.grid[row][col].wall) return [];
    const out = [];
    for (const [dr, dc, w] of this._dirs) {
      const nr = row + dr, nc = col + dc;
      if (!this.passable(nr, nc)) continue;
      out.push({ key: this.encodeKey(nr, nc), weight: w });
    }
    return out;
  }
  getNodeData(key) {
    const { row, col } = this.decodeKey(key);
    return { row, col, x: col, y: row };
  }
}

export class AdjacencyGraphAdapter extends GraphAdapter {
  /**
   * @param {{nodes:Array<{id:any,x:number,y:number}>,
   *         edges:Array<{from:any,to:any,weight?:number}>}} graph
   */
  constructor(graph) {
    super();
    this.nodes = graph.nodes || [];
    this.adj = new Map();
    for (const n of this.nodes) this.adj.set(String(n.id), []);
    const seen = new Set();
    for (const e of graph.edges || []) {
      const a = String(e.from), b = String(e.to);
      if (!this.adj.has(a)) this.adj.set(a, []);
      if (!this.adj.has(b)) this.adj.set(b, []);
      const w = e.weight != null ? e.weight : 1;
      const k1 = `${a}|${b}`, k2 = `${b}|${a}`;
      if (seen.has(k1) || seen.has(k2)) continue;
      seen.add(k1);
      this.adj.get(a).push({ key: b, weight: w });
      this.adj.get(b).push({ key: a, weight: w });
    }
  }
  getNeighbors(key) { return this.adj.get(String(key)) || []; }
  getNodeData(key) {
    const n = this.nodes.find((nd) => String(nd.id) === String(key));
    return n ? { id: n.id, x: n.x, y: n.y } : { id: key };
  }
}

/**
 * Normalize whatever the caller hands us into an adapter.  Heuristic:
 *   - already an adapter → keep
 *   - has `.nodes` AND `.edges` → AdjacencyGraphAdapter
 *   - else → GridGraphAdapter (assume 2D grid)
 */
export function ensureAdapter(topology, opts = {}) {
  if (topology instanceof GraphAdapter) return topology;
  if (topology && Array.isArray(topology.nodes) && Array.isArray(topology.edges)) {
    return new AdjacencyGraphAdapter(topology);
  }
  return new GridGraphAdapter(topology, opts);
}

/**
 * Adapter-aware heuristic factory.  Picks the right distance function
 * per topology kind.  Always returns an ADMISSIBLE lower bound on the
 * shortest path cost; non-grid graphs degrade to Euclidean over x,y
 * which is admissible when edge weights are ≥ euclideanDistance.
 *
 * Supported `baseName` values:  'manhattan' | 'euclidean' | 'octile'
 * (for grids) and any-with-x,y (Euclidean fallback for graphs).
 */
export function heuristicFor(adapter, baseName = 'octile') {
  if (adapter.isGrid) {
    if (baseName === 'manhattan') return (a, b) => mDist(adapter.getNodeData(a), adapter.getNodeData(b));
    if (baseName === 'euclidean') return (a, b) => eDist(adapter.getNodeData(a), adapter.getNodeData(b));
    return (a, b) => oDist(adapter.getNodeData(a), adapter.getNodeData(b)); // default octile
  }
  return (a, b) => eDist(adapter.getNodeData(a), adapter.getNodeData(b));
}

const mDist = (a, b) => Math.abs((a.row ?? a.y) - (b.row ?? b.y)) + Math.abs((a.col ?? a.x) - (b.col ?? b.x));
const eDist = (a, b) => {
  const dr = (a.row ?? a.y) - (b.row ?? b.y);
  const dc = (a.col ?? a.x) - (b.col ?? b.x);
  return Math.sqrt(dr * dr + dc * dc);
};
const oDist = (a, b) => {
  const dr = Math.abs((a.row ?? a.y) - (b.row ?? b.y));
  const dc = Math.abs((a.col ?? a.x) - (b.col ?? b.x));
  return Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc);
};
