/**
 * Admissible heuristics for uniform-cost grid graphs.
 *
 * Coordinates are zero-indexed {row, col}.  All three heuristics are
 * admissible on 8-connected uniform grids (cardinal = 1, diagonal = √2).
 *
 *   Manhattan :  |Δr| + |Δc|                 — loose on 8-connected
 *   Euclidean :  √(Δr² + Δc²)                — tighter; smooth gradient
 *   Octile    :  max(|Δr|,|Δc|) + (√2-1)·min(|Δr|,|Δc|)  — exact on 8-connected
 *
 * For 4-connected grids only Manhattan stays admissible; the others
 * overestimate and would break optimality.
 */

export const SQRT2 = Math.SQRT2;
export const DIAG_WEIGHT = SQRT2 - 1; // ≈ 0.4142

/**
 * @param {{row:number,col:number}} a
 * @param {{row:number,col:number}} b
 */
function delta(a, b) {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return { dr, dc };
}

export function manhattan(a, b) {
  const { dr, dc } = delta(a, b);
  return dr + dc;
}

export function euclidean(a, b) {
  const { dr, dc } = delta(a, b);
  return Math.sqrt(dr * dr + dc * dc);
}

export function octile(a, b) {
  const { dr, dc } = delta(a, b);
  const m = Math.max(dr, dc);
  const n = Math.min(dr, dc);
  return m + DIAG_WEIGHT * n;
}

/**
 * Map a heuristic name (case-insensitive) to its function.
 * Returning null for an unknown name lets the engine fail loudly.
 */
export const HEURISTIC_NAMES = /** @type {const} */ ([
  'manhattan',
  'euclidean',
  'octile',
  'weighted'
]);

/**
 * @param {string} name
 * @returns {(a:any,b:any)=>number}
 */
export function getHeuristic(name) {
  switch (String(name).toLowerCase()) {
    case 'manhattan':
      return manhattan;
    case 'euclidean':
      return euclidean;
    case 'octile':
      return octile;
    default:
      throw new Error(`Unknown heuristic: ${name}`);
  }
}

/**
 * Build a Weighted A* heuristic: h_w(a,b) = w · h(a,b), w ≥ 1.
 *   w = 1 → classical A* (optimal with admissible h)
 *   w > 1 → suboptimal but explores fewer nodes (real-time search)
 */
export function weighted(baseName, weight) {
  const w = Math.max(1, Number(weight) || 1);
  const base = getHeuristic(baseName);
  return (a, b) => w * base(a, b);
}
