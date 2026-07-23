/**
 * Binary Min-Heap (Array-backed) — O(log n) push / pop.
 *
 * Items are arbitrary objects with a numeric `key`. Ties are broken
 * deterministically by insertion order (`seq`) so two identical-priority
 * entries are popped FIFO. Reference indices are NEVER relied upon by
 * callers (we don't expose decreaseKey) — this keeps the implementation
 * tiny, GC-friendly, and cache-hot for pathfinding workloads.
 *
 *   heap.push(key, value)  -> void
 *   heap.pop()             -> { key, value, seq } | undefined
 *   heap.peek()            -> { key, value, seq } | undefined
 *   heap.size              -> number
 *
 * The `seq` field also lets pair-comparisons rely on `key` only because
 * for any pair of distinct entries with the same priority, the one
 * pushed earlier sits nearer the root after a swap-and-sift cycle.
 */
export class MinHeap {
  constructor() {
    /** @type {{key:number,value:any,seq:number}[]} */
    this.data = [];
    // Monotonic counter; survives overflow thanks to BigInt-safe math
    // only below ~9e15 (no pathfinding run approaches that volume).
    this._seq = 0;
  }

  get size() {
    return this.data.length;
  }

  isEmpty() {
    return this.data.length === 0;
  }

  peek() {
    return this.data[0];
  }

  /**
   * Insert an entry.
   * @param {number} key  priority (lower = popped first)
   * @param {*}      value
   */
  push(key, value) {
    this.data.push({ key, value, seq: this._seq++ });
    this._siftUp(this.data.length - 1);
  }

  /**
   * Remove and return the minimum entry, or undefined if empty.
   */
  pop() {
    const n = this.data.length;
    if (n === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (n > 1) {
      this.data[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  /* ---------------- internal helpers ---------------- */

  _cmp(a, b) {
    // Primary: priority.  Secondary: insertion order (FIFO for ties).
    return a.key !== b.key ? a.key - b.key : a.seq - b.seq;
  }

  _siftUp(i) {
    const data = this.data;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._cmp(data[i], data[parent]) < 0) {
        const tmp = data[i];
        data[i] = data[parent];
        data[parent] = tmp;
        i = parent;
      } else break;
    }
  }

  _siftDown(i) {
    const data = this.data;
    const n = data.length;
    while (true) {
      const l = (i << 1) + 1;
      const r = l + 1;
      let best = i;
      if (l < n && this._cmp(data[l], data[best]) < 0) best = l;
      if (r < n && this._cmp(data[r], data[best]) < 0) best = r;
      if (best === i) break;
      const tmp = data[i];
      data[i] = data[best];
      data[best] = tmp;
      i = best;
    }
  }

  /**
   * Optional: heapify an iterable. O(n).
   * @param {Iterable<{key:number, value:any}>} entries
   */
  static heapify(entries) {
    const h = new MinHeap();
    for (const e of entries) h.push(e.key, e.value);
    return h;
  }

  /**
   * Snapshot the current key sequence, for debugging / tests.
   */
  toSortedArray() {
    return [...this.data].sort(this._cmp).map((e) => e.key);
  }
}
