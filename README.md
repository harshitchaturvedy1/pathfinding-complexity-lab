# Pathfinding Algorithm Visualizer & Complexity Benchmarking Engine

A web-based visualizer and execution engine that compares pathfinding algorithms side-by-side on identical maps while providing real-time visual playback and empirical complexity metrics.

> Most online visualizers are purely cosmetic — they use arbitrary animation timeouts or non-standard data structures (standard arrays instead of min-heaps), rendering their execution times and step counts inaccurate for true complexity analysis. This tool decouples **pure algorithm execution time** from **rendering speed**, giving you valid computer-science benchmarking numbers together with beautiful, synchronized animation.

---

## ✨ Features

- **Side-by-side synchronized canvases**: Dijkstra vs A\* on the same map at the same step.
- **Standardized priority queue**: a shared Binary Min-Heap class guarantees `O(log V)` operations for both algorithms.
- **Decoupled metric engine**: algorithms run instantly under `performance.now()` before yielding animation frames through JS **Generators**.
- **Heuristic selector**: Manhattan, Euclidean, Octile, or **Weighted A\*** with adjustable weight `w ≥ 1`.
- **Playback controls**: Play / Pause / step-forward / step-backward / variable speed slider (drives `requestAnimationFrame`).
- **Real-time metrics**: Nodes Expanded, Path Cost, Execution Time (µs), and **Effective Branching Factor (b\*)**.
- **Map generators**: Random obstacles, Random sparse, Maze (DFS), Bottleneck.
- **Metrics export**: download all trial metrics as CSV.
- **Pure JavaScript + Vite**, zero frameworks — chosen for raw performance.

---

## 🏁 Quick Start

```bash
npm install
npm run dev       # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview   # serves /dist
```

Run tests:

```bash
npm test          # vitest run
```

Lint:

```bash
npm run lint
```

---

## 🗂️ Project Layout

```
pathfinding-benchmarker/
├── .github/workflows/ci.yml
├── public/
│   ├── index.html                 # App shell
│   └── favicon.ico
├── src/
│   ├── algorithms/                # Core Pathfinding Engines
│   │   ├── minHeap.js             # Binary Min-Heap (O(log V))
│   │   ├── dijkstra.js            # Dijkstra implementation (Generator)
│   │   ├── aStar.js               # A* implementation with heuristics (Generator)
│   │   └── heuristics.js          # Manhattan, Euclidean, Octile functions
│   ├── engine/                    # Execution & Benchmarking Layer
│   │   ├── benchmarker.js         # Isolated performance.now() execution runner
│   │   └── playback.js            # Step Controller using requestAnimationFrame
│   ├── components/                # UI Components
│   │   ├── CanvasGrid.js          # Grid renderer (HTML5 Canvas)
│   │   ├── Controls.js            # Play/Pause/Speed/Heuristic selection
│   │   └── MetricsPanel.js        # Charts and real-time metric counters
│   ├── utils/                     # Map Generators & Exporters
│   │   ├── mapGenerators.js       # Random, Maze (DFS), Bottleneck
│   │   └── csvExporter.js         # Metrics to CSV downloader
│   ├── app.js                     # Main application entry point
│   └── styles.css                 # Layout and theme styles
├── tests/                         # Unit tests for algorithms & heap correctness
│   ├── minHeap.test.js
│   └── pathfinding.test.js
└── vite.config.js
```

---

## 📐 Complexity Write-Up

### Data structures

- **Graph**: 2-D uniform-cost grid (`rows × cols`) with 4- or 8-connected movement.
- **Priority queue**: Binary min-heap implemented in `src/algorithms/minHeap.js`.

| Operation  | Avg    | Worst  | Notes                                       |
|------------|--------|--------|---------------------------------------------|
| `push`     | O(1)   | O(log n) | amortized (swim to root)                  |
| `pop`      | O(log n) | O(log n) | replace root with last + sink          |
| `heapify`  | —      | O(n)   | build-heap                                  |

### Algorithms

Both algorithms are **state generators** — each `yield` describes a step the playback controller paints onto the canvas.

#### Dijkstra

```
T(V, E) = O((V + E) log V)   with binary heap
S(V)    = O(V)
```

Visits nodes in non-decreasing order of `g(n)`. Optimal on uniform and weighted-positive graphs.

#### A\*

```
T(V, E) = O(E log V)        with admissible heuristic
S(V)    = O(V)
```

Uses `f(n) = g(n) + w · h(n)`. With an **admissible** heuristic (`w = 1`) A\* is optimal; with `w > 1` (Weighted A\*) it trades optimality for speed.

### Heuristics (8-connected, cardinal cost 1, diagonal cost √2)

| Heuristic  | Formula                                             | Admissible (8-c)? | Tight            |
|------------|------------------------------------------------------|--------------------|------------------|
| Manhattan  |  `\|Δx\| + \|Δy\|`                                   | yes (loose)        | no               |
| Euclidean  |  `√(Δx² + Δy²)`                                      | yes (tight)        | closer than octile |
| Octile     |  `max(\|Δx\|,\|Δy\|) + (√2-1)·min(\|Δx\|,\|Δy\|)`    | yes (exact)        | yes              |

### Effective Branching Factor (b*)

Closed-form search-efficiency metric that solves:

```
N = 1 + b* + b*² + … + b*^d   ⟹   N · (b* − 1) = b*^(d+1) − 1
```

where `N` is the number of expanded nodes and `d` is the path depth (search effort). Newton/bracket iteration recovers `b*`, with `b* = 1` representing perfect pruning (only the path).

---

## ⚙️ Architecture

```
+-----------------------------------------------+
|                  UI Layer                    |
|  (Grid Canvas × 2, Controls, Metric Charts)  |
+----------------+------------------------------+
                 |  user events, playback time
                 v
+-----------------------------------------------+
|             Playback Controller              |
|     (Generators, requestAnimationFrame)       |
+----------------+------------------------------+
                 |  current step index (shared)
                 v
+-----------------------------------------------+
|              Algorithm Engine                |
|     - Binary Min-Heap Queue                   |
|     - Isolated performance.now() Benchmarker  |
|     - State Yielders (Open, Closed, Path)     |
+-----------------------------------------------+
```

**Decoupling invariant**: every recorded metric (`nodesExpanded`, `cost`, `executionTime`, `b*`) is captured *before* the first frame request, and the playback controller only modifies a step index — never re-runs algorithmic code.

---

## 🧪 Testing

- `tests/minHeap.test.js` — push / pop / heap-sort ordering, sift correctness after random inserts.
- `tests/pathfinding.test.js` — Dijkstra & A\* produce identical costs on weighted / unweighted grids, heuristics remain admissible, Weighted A\* trades cost for fewer expansions.

---

## 📦 KPIs Shipped per Trial

- **Nodes Expanded (N)** — number of unique nodes popped from the heap.
- **Path Cost (d)** — total step-weighted distance of the produced path.
- **Execution Time (µs)** — `performance.now()` delta, excluding any DOM work.
- **Effective Branching Factor (b\*)** — closed-form solve of the search-effort series.

---

## 🌐 Browser Support

Latest Chrome, Firefox, Safari, Edge. Requires support for `performance.now()`, JS Generators, and `requestAnimationFrame`.

---

## 🧩 Algorithms

| Name | Code | Topology | Optimality | Notes |
|---|---|---|---|---|
| Dijkstra | `dijkstra` | grid (4 / 8) | optimal | baseline benchmark |
| A* | `astar` | grid (4 / 8) | optimal | Manhattan, Euclidean, Octile, Weighted |
| Jump Point Search | `jps` | grid (8 only) | optimal | 5-10× fewer expansions on open maps |
| Bidirectional A* | `bidir` | grid + graph | optimal (w=1) | anytime termination; restricted to consistent heuristic |
| D* Lite (static) | `dstarlite` | grid + graph | optimal | canonical rhs/g/key heap; goal→start expansion |

## 🎨 Visualizations

| Mode | Renderer | Topology | Library |
|---|---|---|---|
| Grid (2D) | `CanvasGrid` | `rows × cols` walls | HTML5 Canvas |
| Graph (force layout) | `GraphCanvas` | `{nodes, edges}` graphs | HTML5 Canvas |
| 3D Mesh | `Mesh3D` | grid extruded as voxels | Three.js r169 (UMD CDN) |

Switch the visualization via the **Viz** dropdown in the deck.
Three graph generators are bundled in `src/utils/graphGenerators.js`:
random-geometric, Watts–Strogatz small-world, and road-network grids.

----

MIT © 2024 — Built for accurate CS benchmarking.
