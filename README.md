# pathfinding-complexity-lab

> **An execution-accurate pathfinding visualizer and benchmarking suite that decouples pure O(V log V) algorithm performance from UI rendering delays.**

[![CI Pipeline](https://img.shields.io/github/actions/workflow/status/harshitchaturvedy1/pathfinding-complexity-lab/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/harshitchaturvedy1/pathfinding-complexity-lab)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)

Most online visualizers are purely cosmetic. They use arbitrary `setTimeout` delays or native JavaScript arrays (`Array.prototype.sort()`) instead of binary heaps, corrupting step counts and execution timings.

**pathfinding-complexity-lab** runs pure algorithmic passes synchronously using `performance.now()` before queuing state snapshots into ES6 Generators. This guarantees benchmark-accurate complexity metrics (microseconds, nodes expanded, effective branching factor) regardless of animation speed or canvas frame rates.

---

## Key Features

- **Decoupled Engine:** Execution benchmarking is strictly isolated from visual playback. Frame rates and play/pause controls never alter performance telemetry.
- **Side-by-Side Canvas Visualizer:** Run Dijkstra, A*, and variant algorithms on identical maps concurrently to observe search space pruning in real time.
- **Shared Binary Min-Heap:** Guarantees true O(log V) priority queue operations across all baseline algorithms.
- **Comprehensive Heuristics:** Supports Manhattan, Euclidean, Octile, and Weighted A* (w >= 1.0) with configurable directional topology (4-way vs. 8-way).
- **Real-Time Telemetry and CSV Export:** Displays nodes expanded (N), path cost (d), execution time (microseconds), and effective branching factor (b*). Export trial metrics with a single click.
- **Map and Topology Generators:** Includes Random Obstacles, Maze (DFS), Bottlenecks, Watts-Strogatz Small-World graphs, and Road Networks.
- **Multi-Mode Rendering:** Supports standard 2D Grid Canvas, Force-Directed Graph Layouts, and 3D Voxel Meshes (Three.js).

---

## Quick Start

```bash
# Clone the repository
git clone [https://github.com/harshitchaturvedy1/pathfinding-complexity-lab.git](https://github.com/harshitchaturvedy1/pathfinding-complexity-lab.git)
cd pathfinding-complexity-lab

# Install dependencies
npm install

# Start local dev server (Vite)
npm run dev

# Run test suite (Vitest)
npm run test

System Architecture
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                            │
│    (2D Grid Canvas, Force Graph, 3D Mesh, Metric Charts)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ User Interaction / Frame Timing
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Playback Controller                      │
│        (ES6 Generators, requestAnimationFrame Loop)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ State Yielders (Open, Closed, Path)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Algorithm Engine                        │
│   * Binary Min-Heap Priority Queue [O(log V)]              │
│   * Isolated performance.now() Execution Profiler          │
└──────────────────────────────┴──────────────────────────────┘

The Decoupling Invariant: Every algorithmic metric (nodesExpanded, cost, executionTime, b*) is computed and locked before the visualizer requests its first animation frame.
Complexity and Theoretical Framework
1. Priority Queue Operations
All search algorithms share a zero-dependency Binary Min-Heap (src/algorithms/minHeap.js):
Operation	Average	Worst Case	Mechanics
push	O(1)	O(log V)	Amortized insertion with upward heapification
pop	O(log V)	O(log V)	Root extraction with downward heapification
heapify	O(V)	O(V)	Bottom-up array construction
2. Algorithmic Bounds
On a standard 4-connected grid, E <= 4V. Worst-case time complexity simplifies to O(V log V).
Algorithm	Time Complexity	Space Complexity	Guaranteed Optimal?	Key Characteristic
Dijkstra	O((V + E) log V)	O(V)	Yes	Baseline uniform-cost search (h(n) = 0)
A*	O(E log V)	O(V)	Yes	Prunes search space using admissible h(n)
Weighted A*	O(E log V)	O(V)	No (w > 1)	Trades path optimality for exponential expansion speed
Jump Point Search (JPS)	Fast Grid Pruning	O(V)	Yes	Eliminates symmetric grid paths (8-way only)
Bidirectional A*	Search Space Splitting	O(V)	Yes	Meets in the middle from start and goal
3. Heuristic Formulations
For 8-connected movement with cardinal cost 1 and diagonal cost sqrt(2):
• Manhattan Distance:  $$h(n) = \vert{}\Delta x\vert{} + \vert{}\Delta y\vert{}$$
• Euclidean Distance:  $$h(n) = \sqrt{\Delta x^2 + \Delta y^2}$$
• Octile Distance (Exact for 8-way grid):  $$h(n) = \max(\vert{}\Delta x\vert{}, \vert{}\Delta y\vert{}) + (\sqrt{2} - 1) \cdot \min(\vert{}\Delta x\vert{}, \vert{}\Delta y\vert{})$$
4. Effective Branching Factor (b*)
To quantify heuristic pruning efficiency independently of graph layout, we solve for the effective branching factor b* using the node expansion series:
$$N + 1 = 1 + b^* + (b^*)^2 + \dots + (b^*)^d = \frac{(b^*)^{d+1} - 1}{b^* - 1}$$
Where N is total expanded nodes and d is path length. A value of b* approaching 1.0 represents a near-perfect heuristic that explores only the optimal path.
Project Structure
pathfinding-complexity-lab/
├── .github/workflows/          # CI pipeline configs
├── src/
│   ├── algorithms/             # Heap, Dijkstra, A*, JPS, Heuristics
│   ├── engine/                 # performance.now() profiler & generator driver
│   ├── components/             # Canvas 2D, Graph, 3D Mesh, Controls
│   ├── utils/                  # Maze/Graph generators & CSV Exporter
│   ├── app.js                  # Application entry point
│   └── styles.css              # Styling & layout rules
├── tests/                      # Unit tests for queue correctness & path costs
├── vite.config.js              # Bundler configuration
└── package.json

Testing Suite
Unit tests ensure priority queue correctness and path optimality verification:
# Run all vitest unit tests
npm test

• Heap Invariants: Asserts push/pop ordering and sift operations under randomized inputs.
• Cost Equivalence: Verifies that Dijkstra and admissible A* find identical path costs on unweighted and weighted topologies.
• Sub-optimality Bounds: Ensures Weighted A* path costs stay within w * Cost_optimal.
License
Distributed under the MIT License. See LICENSE for details.
