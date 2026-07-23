/**
 * Graph generators — produce `AdjacencyGraphAdapter`-compatible topologies
 * (nodes + weighted edges) for the graph + 3D-mesh visualizers.
 *
 * Three families:
 *   - randomGeometricGraph(N, distance)   — points in a [0,1]² plane,
 *                                            connect if Euclidean ≤ d.
 *                                            Yields planar-ish sparse graphs.
 *   - smallWorldGraph(N, k, rewire)        — ring lattice with each node
 *                                            connected to k/2 neighbors on
 *                                            each side, then randomly
 *                                            rewire a fraction of edges.
 *                                            Watts–Strogatz style.
 *   - roadNetwork(rows, cols, density)    — Manhattan grid with extra
 *                                            cross-street edges; useful for
 *                                            city-scale road benchmarks.
 *
 * Each returns `{ nodes: [{id, x, y}], edges: [{from, to, weight}] }`.
 */

import { mulberry32 } from './mapGenerators.js';

const DEFAULT_X_MAX = 800;
const DEFAULT_Y_MAX = 600;

function makeRNG(seed) {
  return typeof seed === 'number' ? mulberry32(seed) : Math.random;
}

/**
 * Random geometric graph.
 * @param {number} N
 * @param {number} distanceThreshold  max Euclidean distance to connect
 * @param {number} seed
 */
export function randomGeometricGraph(N = 40, distanceThreshold = 0.16, seed = null) {
  const rand = makeRNG(seed);
  const nodes = [];
  for (let i = 0; i < N; i++) {
    nodes.push({ id: i, x: rand() * DEFAULT_X_MAX, y: rand() * DEFAULT_Y_MAX });
  }
  const edges = [];
  const seen = new Set();
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= distanceThreshold * Math.max(DEFAULT_X_MAX, DEFAULT_Y_MAX)) {
        const key = i < j ? `${i}|${j}` : `${j}|${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Weight = Euclidean distance + small congestion penalty for visual contrast.
        const congestion = 1 + 0.4 * rand();
        edges.push({ from: i, to: j, weight: d * congestion });
      }
    }
  }
  return { nodes, edges };
}

/**
 * Watts-Strogatz small-world.
 * @param {number} N
 * @param {number} k   even; each node connects to k/2 nearest in each direction
 * @param {number} rewire  0..1 fraction of edges to rewire
 */
export function smallWorldGraph(N = 30, k = 4, rewire = 0.18, seed = null) {
  const rand = makeRNG(seed);
  const nodes = [];
  for (let i = 0; i < N; i++) {
    nodes.push({ id: i, x: DEFAULT_X_MAX / 2 + Math.cos(2 * Math.PI * i / N) * 260, y: DEFAULT_Y_MAX / 2 + Math.sin(2 * Math.PI * i / N) * 200 });
  }
  const ringEdges = new Map();
  for (let i = 0; i < N; i++) {
    for (let j = 1; j <= k / 2; j++) {
      const t = (i + j) % N;
      const key = i < t ? `${i}|${t}` : `${t}|${i}`;
      ringEdges.set(key, { from: i, to: t, weight: euclid(nodes[i], nodes[t]) });
    }
  }
  // Rewire a fraction of them.
  const finalEdges = [];
  for (const [key, edge] of ringEdges) {
    if (rand() < rewire && N > 3) {
      // Pick a different random target.
      let target = (rand() * N) | 0;
      while (target === edge.from) target = (rand() * N) | 0;
      const rekey = edge.from < target ? `${edge.from}|${target}` : `${target}|${edge.from}`;
      if (rekey === key) { finalEdges.push(edge); continue; }
      if (ringEdges.has(rekey) || finalEdges.some((e) => (e.from === edge.from && e.to === target) || (e.from === target && e.to === edge.from))) {
        finalEdges.push(edge);
      } else {
        finalEdges.push({ from: edge.from, to: target, weight: euclid(nodes[edge.from], nodes[target]) });
      }
    } else {
      finalEdges.push(edge);
    }
  }
  // Make sure the graph is connected: link any isolated node to its ring neighbour.
  const degree = new Map();
  for (const e of finalEdges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to,  (degree.get(e.to)  || 0) + 1);
  }
  for (let i = 0; i < N; i++) {
    if ((degree.get(i) || 0) === 0) {
      const t = (i + 1) % N;
      finalEdges.push({ from: i, to: t, weight: euclid(nodes[i], nodes[t]) });
    }
  }
  return { nodes, edges: finalEdges };
}

/**
 * Road-network grid: orthogonal streets with random cross-streets and
 * weighted corners.  Yields a graph with N×M nodes (one per intersection)
 * and ~3-4 edges per node.
 */
export function roadNetworkGrid(rows, cols, extras = 0.25, seed = null) {
  const rand = makeRNG(seed);
  const nodes = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      nodes.push({ id: i * cols + j, x: 30 + j * 90, y: 30 + i * 80 });
    }
  }
  const edges = [];
  const edgeKey = new Set();
  function addEdge(a, b, wMult = 1) {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    const dx = nodes[a].x - nodes[b].x;
    const dy = nodes[a].y - nodes[b].y;
    const d = Math.sqrt(dx * dx + dy * dy);
    edges.push({ from: a, to: b, weight: d * wMult });
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * cols + j;
      if (j < cols - 1) addEdge(a, a + 1, 1 + rand() * 0.4);
      if (i < rows - 1) addEdge(a, a + cols, 1 + rand() * 0.4);
      if (rand() < extras && i < rows - 2 && j < cols - 2) {
        addEdge(a, (i + 2) * cols + (j + 2), 1 + rand() * 0.6 + 0.6);  // longer diagonal expressway
      }
    }
  }
  return { nodes, edges };
}

function euclid(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export const graphGenerators = {
  randomGeometricGraph,
  smallWorldGraph,
  roadNetworkGrid
};
