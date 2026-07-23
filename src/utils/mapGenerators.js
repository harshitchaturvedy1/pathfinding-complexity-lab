/**
 * Map generators — produce a fresh grid + suggested start/goal coordinates.
 *
 * A grid is `Array<Array<{wall:boolean, row:number, col:number}>>` whose
 * dimensions are mutable per trial.  Every cell carries its (row, col)
 * for convenient lookups inside rendering loops.
 */

const DIAG_WEIGHT = Math.SQRT2;

/** Make an empty `rows × cols` grid of non-wall cells. */
export function emptyGrid(rows, cols) {
  const grid = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = { wall: false, row: r, col: c };
    grid[r] = row;
  }
  return grid;
}

/** Make an empty corridor with an explicit wall seed. */
function makeGrid(rows, cols) { return emptyGrid(rows, cols); }

function setWall(grid, r, c, v = true) {
  if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) return;
  grid[r][c].wall = v;
}

function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Random uniform obstacles.
 * @param {number} density 0..1  fraction of walls
 */
export function randomGrid(rows, cols, density = 0.3, seed = null) {
  const grid = makeGrid(rows, cols);
  const rand = typeof seed === 'number' ? mulberry32(seed) : Math.random;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c].wall = rand() < density;
    }
  }
  return pickEndpoints(grid);
}

/** Conway-like scattered obstacle pattern: a few disconnected clusters. */
export function randomSparseGrid(rows, cols, density = 0.18, seed = null) {
  return randomGrid(rows, cols, density, seed);
}

/**
 * Deterministic depth-first-search maze (recursive backtracker carves
 * corridors through a wall-filled grid).  Start/goal sit at opposite
 * corners of the dungeon.
 */
export function mazeGrid(rows, cols, seed = null) {
  const rand = typeof seed === 'number' ? mulberry32(seed) : Math.random;
  // Need odd dimensions for the standard cell/wall layout.
  const R = rows % 2 === 0 ? rows - 1 : rows;
  const C = cols % 2 === 0 ? cols - 1 : cols;
  const grid = new Array(R);
  for (let r = 0; r < R; r++) {
    const row = new Array(C);
    for (let c = 0; c < C; c++) row[c] = { wall: true, row: r, col: c };
    grid[r] = row;
  }

  const stack = [];
  const start = { row: 1, col: 1 };
  grid[start.row][start.col].wall = false;
  stack.push(start);

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const dirs = shuffleInPlace([[-2, 0], [2, 0], [0, -2], [0, 2]], rand);
    let advanced = false;
    for (const [dr, dc] of dirs) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (nr <= 0 || nc <= 0 || nr >= R - 1 || nc >= C - 1) continue;
      if (!grid[nr][nc].wall) continue;
      // Knock down the wall between current and target.
      grid[cur.row + dr / 2][cur.col + dc / 2].wall = false;
      grid[nr][nc].wall = false;
      stack.push({ row: nr, col: nc });
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }

  return { grid, start: { row: 1, col: 1 }, goal: { row: R - 2, col: C - 2 } };
}

/**
 * Bottleneck grid: two clear rooms separated by a thin wall that has
 * only 1-cell-wide openings.  Perfect for demonstrating how A* prunes
 * the wasted exploration Dijkstra does on the unrestricted side.
 */
export function bottleneckGrid(rows, cols, gapSize = 2) {
  const grid = makeGrid(rows, cols);
  const wallCol = Math.floor(cols / 2);
  const midStart = Math.floor((rows - gapSize) / 2);
  for (let r = 0; r < rows; r++) {
    const inGap = r >= midStart && r < midStart + gapSize;
    setWall(grid, r, wallCol, !inGap);
    // Slightly thicker walls feel cleaner: peg-out cells diagonally adjacent
    // to the wall column to prevent casual diagonal slips.
    if (!inGap) {
      setWall(grid, r, wallCol - 1);
      setWall(grid, r, wallCol + 1);
    }
  }
  return pickEndpoints(grid);
}

/**
 * Pick open start (top-left quadrant) and goal (bottom-right quadrant)
 * coordinates deterministically.
 */
function pickEndpoints(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const start = { row: 0, col: 0 };
  const goal = { row: rows - 1, col: cols - 1 };
  // BFS to first open cell in each quadrant.
  outer: for (let r = 0; r < Math.floor(rows / 2); r++) {
    for (let c = 0; c < Math.floor(cols / 2); c++) {
      if (!grid[r][c].wall) { start.row = r; start.col = c; break outer; }
    }
  }
  outer: for (let r = rows - 1; r >= Math.ceil(rows / 2); r--) {
    for (let c = cols - 1; c >= Math.ceil(cols / 2); c--) {
      if (!grid[r][c].wall) { goal.row = r; goal.col = c; break outer; }
    }
  }
  if (grid[start.row][start.col].wall) grid[start.row][start.col].wall = false;
  if (grid[goal.row][goal.col].wall) grid[goal.row][goal.col].wall = false;
  return { grid, start, goal };
}

/** Tiny seedable PRNG (Mulberry32) for reproducible maps. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Validate that a (start,goal) pair is reachable on the current map. */
export function isReachable(grid, start, goal) {
  const rows = grid.length;
  const cols = grid[0].length;
  if (grid[start.row][start.col].wall) return false;
  if (grid[goal.row][goal.col].wall) return false;
  const seen = new Array(rows);
  for (let r = 0; r < rows; r++) seen[r] = new Array(cols).fill(false);
  const stack = [start];
  seen[start.row][start.col] = true;
  while (stack.length) {
    const { row, col } = stack.pop();
    if (row === goal.row && col === goal.col) return true;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      if (seen[nr][nc] || grid[nr][nc].wall) continue;
      seen[nr][nc] = true;
      stack.push({ row: nr, col: nc });
    }
  }
  return false;
}

export const generators = {
  empty: emptyGrid,
  random: randomGrid,
  randomSparse: randomSparseGrid,
  maze: mazeGrid,
  bottleneck: bottleneckGrid
};

export const _internal = { DIAG_WEIGHT };
