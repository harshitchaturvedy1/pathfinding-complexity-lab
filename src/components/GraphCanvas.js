/**
 * GraphCanvas — 2D renderer for arbitrary node-edge graphs.
 *
 * Mirrors the API exposed by `CanvasGrid`: `setGraph(topology)`,
 * `setView({ openSet, closedSet, path, current })`, `setPlacement`,
 * `destroy`.  Coordinates come from node `x,y` payloads (typically in
 * pixel-space).  Edge weights are encoded in stroke alpha so heavier
 * roads visually pop.
 */

const PALETTE = {
  bg: '#0b1020',
  edge: 'rgba(154,163,184,0.45)',
  edgeVisited: 'rgba(52,80,122,0.85)',
  edgePath: 'rgba(74,222,128,0.95)',
  nodeWall: '#3a4570',
  nodeOpen: '#5cdcff',
  nodeClosed: '#34507a',
  nodePath: '#4ade80',
  nodeStart: '#fbbf24',
  nodeGoal: '#f87171',
  current: '#e879f9',
  text: '#e8ecf4'
};

export function createGraphCanvas(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let W = 0, H = 0;
  let graph = null;            // { nodes, edges }
  let adj = new Map();         // nodeKey -> [{key,weight}]
  let view = null;
  let maxEdge = 1;

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setGraph(topology) {
    graph = topology;
    adj = new Map();
    maxEdge = 1;
    if (!topology) return;
    for (const n of topology.nodes || []) adj.set(String(n.id), []);
    const seen = new Set();
    for (const e of topology.edges || []) {
      const a = String(e.from);
      const b = String(e.to);
      const k1 = `${a}|${b}`, k2 = `${b}|${a}`;
      const k = a < b ? k1 : k2;
      if (seen.has(k)) continue;
      seen.add(k);
      const w = e.weight != null ? e.weight : 1;
      if (w > maxEdge) maxEdge = w;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({ key: b, weight: w });
      adj.get(b).push({ key: a, weight: w });
    }
  }

  function setView(v) {
    view = v;
  }
  function setStartGoal(start, goal) {
    opts.start = start; opts.goal = goal;
  }
  function setPlacement() { /* no-op */ }

  function paint() {
    if (!graph) return;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, W, H);

    // Translate graph coordinates into canvas space (with min/max bounds).
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    const mnx = Math.min(...xs), mxx = Math.max(...xs);
    const mny = Math.min(...ys), mxy = Math.max(...ys);
    const pad = 36;
    const sx = (W - 2 * pad) / Math.max(1, mxx - mnx);
    const sy = (H - 2 * pad) / Math.max(1, mxy - mny);
    const s = Math.min(sx, sy);
    function toCanvas(p) {
      return {
        x: pad + (p.x - mnx) * s,
        y: pad + (p.y - mny) * s
      };
    }
    const byId = new Map();
    for (const n of graph.nodes) byId.set(String(n.id), toCanvas(n));

    const reached = new Set();
    const pathSet = new Set();
    if (view) {
      if (view.path) for (const k of view.path) reached.add(String(k).replace(/^[fb]:/, ''));
      if (view.path) for (const k of view.path) pathSet.add(String(k).replace(/^[fb]:/, ''));
    }

    // 1) Base edges.
    ctx.lineCap = 'round';
    ctx.strokeStyle = PALETTE.edge;
    ctx.lineWidth = 1.2;
    for (const e of graph.edges) {
      const a = byId.get(String(e.from));
      const b = byId.get(String(e.to));
      if (!a || !b) continue;
      const w = (e.weight || 1) / maxEdge;
      ctx.globalAlpha = 0.35 + 0.45 * (1 - w);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 2) Path edges, on top.
    if (view && view.path && view.path.length > 1) {
      ctx.strokeStyle = PALETTE.edgePath;
      ctx.lineWidth = 3.5;
      for (let i = 0; i < view.path.length - 1; i++) {
        const a = byId.get(String(view.path[i]).replace(/^[fb]:/, ''));
        const b = byId.get(String(view.path[i + 1]).replace(/^[fb]:/, ''));
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // 3) Visited nodes.
    const closedKeys = (view?.closedSet || []).map((k) => String(k).replace(/^[fb]:/, ''));
    const openKeys   = (view?.openSet   || []).map((k) => String(k).replace(/^[fb]:/, ''));
    const seen = new Set();
    const r = 4;
    for (const k of closedKeys) {
      const p = byId.get(k); if (!p || seen.has(k)) continue;
      seen.add(k);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pathSet.has(k) ? PALETTE.nodePath : PALETTE.nodeClosed;
      ctx.fill();
    }
    for (const k of openKeys) {
      const p = byId.get(k); if (!p || seen.has(k)) continue;
      seen.add(k);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pathSet.has(k) ? PALETTE.nodePath : PALETTE.nodeOpen;
      ctx.fill();
    }
    // 4) Path nodes (might overlap visited — render last for prominence).
    if (view && view.path) {
      for (const k of view.path) {
        const p = byId.get(String(k).replace(/^[fb]:/, '')); if (!p) continue;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.nodePath;
        ctx.fill();
      }
    }

    // 5) Start / Goal / Current big markers.
    drawMarker(PALETTE.nodeStart, opts.start && byId.get(String(opts.start.id)));
    drawMarker(PALETTE.nodeGoal,  opts.goal  && byId.get(String(opts.goal.id)));
    if (view?.current) {
      const p = byId.get(String(view.current).replace(/^[fb]:/, ''));
      drawMarker(PALETTE.current, p, true);
    }
  }

  function drawMarker(color, p, pulse = false) {
    if (!p) return;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = pulse ? 22 : 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function onPointerMove() { /* no drag-paint in graph mode */ }
  function onPointerDown() { /* none */ }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  // Drop the graph's start/goal into `opts`.
  if (graph && graph.nodes && graph.nodes.length) {
    opts.start ||= { id: graph.nodes[0].id };
    opts.goal   ||= { id: graph.nodes[graph.nodes.length - 1].id };
  }

  let raf;
  function loop() { paint(); raf = requestAnimationFrame(loop); }
  raf = requestAnimationFrame(loop);

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
  }

  return { setGraph, setView, setStartGoal, setPlacement, destroy };
}

export const _palette = PALETTE;
