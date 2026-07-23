import { describe, it, expect } from 'vitest';
import { MinHeap } from '../src/algorithms/minHeap.js';

describe('MinHeap', () => {
  it('returns undefined when empty', () => {
    const h = new MinHeap();
    expect(h.pop()).toBeUndefined();
    expect(h.peek()).toBeUndefined();
    expect(h.size).toBe(0);
    expect(h.isEmpty()).toBe(true);
  });

  it('pops in priority order', () => {
    const h = new MinHeap();
    [5, 1, 4, 2, 3].forEach((k) => h.push(k, k));
    const out = [];
    while (!h.isEmpty()) out.push(h.pop().key);
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('breaks ties FIFO', () => {
    const h = new MinHeap();
    h.push(3, 'a');
    h.push(3, 'b');
    h.push(3, 'c');
    expect([h.pop().value, h.pop().value, h.pop().value]).toEqual(['a', 'b', 'c']);
  });

  it('heapify produces correct ordering', () => {
    const h = MinHeap.heapify([
      { key: 7,  value: 'x' },
      { key: 1,  value: 'y' },
      { key: 5,  value: 'z' },
      { key: 3,  value: 'a' },
      { key: 9,  value: 'b' },
      { key: 0,  value: 'c' }
    ]);
    expect(h.toSortedArray()).toEqual([0, 1, 3, 5, 7, 9]);
  });

  it('sift correctness after 1000 random insertions', () => {
    const h = new MinHeap();
    const arr = [];
    for (let i = 0; i < 1000; i++) {
      const k = Math.floor(Math.random() * 100000);
      arr.push(k);
      h.push(k, i);
    }
    arr.sort((a, b) => a - b);
    const out = [];
    while (!h.isEmpty()) out.push(h.pop().key);
    expect(out.length).toBe(1000);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(arr[i]);
    }
  });

  it('peek does not remove', () => {
    const h = new MinHeap();
    h.push(8, 'eight');
    h.push(2, 'two');
    expect(h.peek().key).toBe(2);
    expect(h.size).toBe(2);
    expect(h.pop().key).toBe(2);
    expect(h.pop().key).toBe(8);
  });

  it('treats values as opaque payloads', () => {
    const h = new MinHeap();
    const payload = { x: 1 };
    h.push(10, payload);
    expect(h.pop().value).toBe(payload);
  });
});
