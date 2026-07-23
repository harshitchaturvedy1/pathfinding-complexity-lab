/**
 * CanvasGrid — HTML5 Canvas renderer for an (rows × cols) grid plus
 * playback state.  Each instance manages its own canvas, is device-pixel-
 * ratio aware, and supports a "placement" mode for interactive editing.
 *
 * Public API:
 *   const grid = createCanvasGrid(canvasEl, { onCellClick });
 *   grid.setGrid(gridCells);                       // grid topology change
 *   grid.setView({ openSet, closedSet, path, current, start, goal });
 *   grid.setPlacement({ mode: 'wall'|'start'|'goal'|null });
 *   grid.markDirty();                              // invalidate prior cache
 *   grid.destroy();
 */

const PALETTE = {
  bg:        '#0b1020',
  cell:      '#141a2e',
  cellAlt:   '#10162a',
  gridLine:  'rgba(255,255,255,0.04)',
  wall:      '#2a3350',
  wallEdge:  '#3a4570',
  start:     '#fbbf24',
  goal:      '#f87171',
  frontier:  'rgba(92,220,255,0.55)',
  frontierEdge: '#5cdcff',
  visited:   '#34507a',
  visitedEdge: '#4f6bb0',
  path:      '#4ade80',
  pathEdge:  '#86efac',
  current:   '#e879f9',
  text:      '#e8ecf4',
  textDim:   '#9aa3b8'
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function decode(k) {
  const i = k.indexOf(',');
  return { row: +k.slice(0, i), col: +k.slice(i + 1) };
}

export function createCanvasGrid(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let widthCss = 0, heightCss = 0;
  let cells = null;
  let view = null;
  let cellSize = 0;
  let interactive = opts.interactive !== false;
  let hover = null;

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    widthCss = Math.max(1, rect.width);
    heightCss = Math.max(1, rect.height);
    canvas.width = Math.round(widthCss * dpr);
    canvas.height = Math.round(heightCss * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cellSize = computeCellSize();
    markDirty();
  }

  function computeCellSize() {
    if (!cells) return 1;
    const cols = cells.length ? cells[0].length : 1;
    const rows = cells.length;
    const sx = widthCss / cols;
    const sy = heightCss / rows;
    return Math.max(1, Math.min(sx, sy));
  }

  function setGrid(next) {
    cells = next;
    cellSize = computeCellSize();
    markDirty();
  }

  function setStartGoal(start, goal) {
    opts.start = start; opts.goal = goal;
    markDirty();
  }

  function setView(next) {
    view = next;
    markDirty();
  }

  function setPlacement(p) {
    canvas.style.cursor = p && p.mode ? 'crosshair' : 'default';
  }

  function markDirty() { /* full repaint on next requestAnimationFrame */ }

  /* ---------------- rendering ---------------- */

  function paint() {
    if (!cells) return;
    const cols = cells[0].length;
    const rows = cells.length;
    const offsetX = (widthCss - cellSize * cols) / 2;
    const offsetY = (heightCss - cellSize * rows) / 2;

    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, widthCss, heightCss);

    drawCells(offsetX, offsetY);
    drawSearchState(offsetX, offsetY);
    drawStartGoal(offsetX, offsetY);
    drawHover(offsetX, offsetY);
    drawHoverIndicator(offsetX, offsetY);
    drawCrosshairAtCurrent(offsetX, offsetY);
  }

  function drawCells(offsetX, offsetY) {
    if (!cells) return;
    for (let r = 0; r < cells.length; r++) {
      const row = cells[r];
      for (let c = 0; c < row.length; c++) {
        const x = offsetX + c * cellSize;
        const y = offsetY + r * cellSize;
        const wall = row[c].wall;
        ctx.fillStyle = wall ? PALETTE.wall : ((r + c) % 2 === 0 ? PALETTE.cell : PALETTE.cellAlt);
        ctx.fillRect(x, y, cellSize, cellSize);
        if (wall) {
          ctx.strokeStyle = PALETTE.wallEdge;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }
    // Subtle grid lines for low cell-size renders.
    if (cellSize >= 6) {
      ctx.strokeStyle = PALETTE.gridLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= cells[0].length; c++) {
        const x = offsetX + c * cellSize;
        ctx.moveTo(x + 0.5, offsetY);
        ctx.lineTo(x + 0.5, offsetY + cells.length * cellSize);
      }
      for (let r = 0; r <= cells.length; r++) {
        const y = offsetY + r * cellSize;
        ctx.moveTo(offsetX, y + 0.5);
        ctx.lineTo(offsetX + cells[0].length * cellSize, y + 0.5);
      }
      ctx.stroke();
    }
  }

  function drawSearchState(offsetX, offsetY) {
    if (!view) return;
    drawPlainSet(offsetX, offsetY, view.closedSet, PALETTE.visited, PALETTE.visitedEdge);
    drawPlainSet(offsetX, offsetY, view.openSet, PALETTE.frontier, PALETTE.frontierEdge);
    if (view.path && view.path.length) {
      drawPlainSet(offsetX, offsetY, view.path, PALETTE.path, PALETTE.pathEdge);
    }
  }

  function drawPlainSet(offsetX, offsetY, keys, fillColor, edgeColor) {
    if (!keys || !keys.length) return;
    const fill = hexToRgba(fillColor, 0.85);
    const pad = Math.max(1, Math.floor(cellSize * 0.06));
    ctx.fillStyle = fill;
    for (const k of keys) {
      const { row, col } = decode(k);
      const x = offsetX + col * cellSize + pad;
      const y = offsetY + row * cellSize + pad;
      const s = cellSize - pad * 2;
      ctx.fillRect(x, y, s, s);
    }
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1;
    for (const k of keys) {
      const { row, col } = decode(k);
      const x = offsetX + col * cellSize + pad + 0.5;
      const y = offsetY + row * cellSize + pad + 0.5;
      ctx.strokeRect(x, y, cellSize - pad * 2 - 1, cellSize - pad * 2 - 1);
    }
  }

  function drawStartGoal(offsetX, offsetY) {
    drawMarker(PALETTE.start, opts.start, offsetX, offsetY, 'S');
    drawMarker(PALETTE.goal,  opts.goal,  offsetX, offsetY, 'G');
  }

  function drawMarker(color, coord, offsetX, offsetY, glyph) {
    if (!coord) return;
    const x = offsetX + coord.col * cellSize;
    const y = offsetY + coord.row * cellSize;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize * 0.4, 0, Math.PI * 2);
    ctx.fill();
    if (cellSize >= 14) {
      ctx.fillStyle = PALETTE.bg;
      ctx.font = `600 ${Math.floor(cellSize * 0.45)}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, x + cellSize / 2, y + cellSize / 2 + 1);
    }
  }

  function drawCrosshairAtCurrent(offsetX, offsetY) {
    if (!view || !view.current) return;
    const { row, col } = decode(view.current);
    const cx = offsetX + col * cellSize + cellSize / 2;
    const cy = offsetY + row * cellSize + cellSize / 2;
    const r = cellSize * 0.45;

    ctx.save();
    ctx.shadowColor = PALETTE.current;
    ctx.shadowBlur = cellSize * 0.7;
    ctx.strokeStyle = PALETTE.current;
    ctx.lineWidth = Math.max(1.5, cellSize * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawHover(offsetX, offsetY) {
    if (!hover || !interactive) return;
    const x = offsetX + hover.col * cellSize;
    const y = offsetY + hover.row * cellSize;
    ctx.strokeStyle = hexToRgba(PALETTE.frontierEdge, 0.6);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
  }

  function drawHoverIndicator() {
    // intentionally no-op (overlay text lives in DOM via tooltips)
  }

  /* ---------------- interaction ---------------- */

  function pickCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!cells) return null;
    const cols = cells[0].length;
    const rows = cells.length;
    const offsetX = (widthCss - cellSize * cols) / 2;
    const offsetY = (heightCss - cellSize * rows) / 2;
    const col = Math.floor((x - offsetX) / cellSize);
    const row = Math.floor((y - offsetY) / cellSize);
    if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
    return { row, col };
  }

  let pointerDown = false;
  let lastDragKey = '';

  function onPointerMove(e) {
    if (!interactive) return;
    const c = pickCell(e.clientX, e.clientY);
    if (!c) {
      if (hover) { hover = null; markDirty(); }
      return;
    }
    if (!hover || hover.row !== c.row || hover.col !== c.col) {
      hover = c;
      markDirty();
    }
    if (pointerDown && opts.onCellDrag) {
      const key = `${c.row},${c.col}`;
      if (key !== lastDragKey) {
        lastDragKey = key;
        opts.onCellDrag({
          row: c.row,
          col: c.col,
          button: e.button === 2 ? 'right' : 'left'
        });
      }
    }
  }
  function onPointerLeave() {
    if (hover) { hover = null; markDirty(); }
    // Clear drag state so re-entering the canvas mid-drag doesn't fire on
    // a stale `lastDragKey` value.
    pointerDown = false;
    lastDragKey = '';
  }
  function onPointerDown(e) {
    if (!interactive) return;
    pointerDown = true;
    lastDragKey = '';
    try { canvas.setPointerCapture(e.pointerId); } catch (_err) { /* older Safari */ }
    const c = pickCell(e.clientX, e.clientY);
    if (!c || !opts.onCellClick) return;
    if (e.button === 2) opts.onCellClick({ ...c, button: 'right' });
    else opts.onCellClick({ ...c, button: 'left' });
  }
  function onPointerUp(e) {
    pointerDown = false;
    if (e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    lastDragKey = '';
  }

  if (interactive) {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);

  resize();

  /* ---------------- main loop ---------------- */

  let raf;
  function loop() {
    paint();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    if (interactive) {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    }
  }

  return {
    setGrid,
    setView,
    setStartGoal,
    setPlacement,
    markDirty,
    get cellSize() { return cellSize; },
    destroy
  };
}

export const _palette = PALETTE;
