/**
 * Mesh3D — Three.js voxel-grid renderer for the 3D viz mode.
 *
 * Expects `window.THREE` to be loaded via the UMD CDN script tag in
 * `public/index.html`.  Creates a lazy stub until THREE arrives so the
 * module bundle isn't forced to pull it on first paint.
 *
 * Design choices:
 *   - Voxel grid: 2D `rows × cols` extruded as 3 levels (`lvl ∈ {0,1,2}`)
 *     for depth.  Level 1 highlight = "ground level" working area.
 *   - InstancedMesh for cells (+ start/goal sphere markers + a path line).
 *   - Automatic camera orbit; can be paused by external input later.
 *
 * API (mirrors CanvasGrid / GraphCanvas):
 *   const m = createMesh3D(canvas, { rows, cols });
 *   m.setGrid(gridTopology);
 *   m.setView({ openSet, closedSet, path, current });
 *   m.setStartGoal(start, goal);
 *   m.destroy();
 */

const PALETTE = {
  bgClear:     0x0b1020,
  ambient:     0x4a5566,
  directional: 0xe8ecf4,
  voxel:       0x141a2e,
  wall:        0x3a4570,
  start:       0xfbbf24,
  goal:        0xf87171,
  frontier:    0x5cdcff,
  visited:     0x34507a,
  path:        0x4ade80,
  current:     0xe879f9
};

export function createMesh3D(canvas, opts = {}) {
  if (typeof window === 'undefined' || !window.THREE) {
    return createLazy(canvas, opts);
  }
  return createReal(canvas, opts, window.THREE);
}

function createLazy(canvas, opts) {
  const pending = { setGrid: null, setView: null, destroy: null, startGoal: null };
  const ret = {
    setGrid(g) { pending.setGrid = g; tryReady(); },
    setView(v) { pending.setView = v; tryReady(); },
    setStartGoal(s, g) { pending.startGoal = { start: s, goal: g }; },
    destroy() { if (pending.destroy) pending.destroy(); }
  };
  function tryReady() {
    if (!window.THREE) return;
    const real = createReal(canvas, opts, window.THREE);
    if (pending.startGoal) real.setStartGoal(pending.startGoal.start, pending.startGoal.goal);
    if (pending.setGrid)   real.setGrid(pending.setGrid);
    if (pending.setView)   real.setView(pending.setView);
    Object.assign(ret, real);
    pending.destroy = real.destroy;
  }
  const iv = setInterval(() => { if (window.THREE) { clearInterval(iv); tryReady(); } }, 80);
  ret._lazyInterval = iv;
  return ret;
}

function createReal(canvas, _opts, THREE) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(PALETTE.bgClear, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bgClear);
  scene.fog = new THREE.Fog(PALETTE.bgClear, 35, 220);

  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 1000);
  camera.position.set(28, 30, 38);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(PALETTE.ambient, 0.6));
  const dir = new THREE.DirectionalLight(PALETTE.directional, 0.7);
  dir.position.set(20, 30, 12);
  scene.add(dir);

  let instanced = null;
  let count = 0;
  let LAST_LAYOUT = null;
  let startMarker = null;
  let goalMarker = null;
  let pathLine = null;
  let pathGeo = new THREE.BufferGeometry();

  function ensureInstanced(rows, cols) {
    if (LAST_LAYOUT && LAST_LAYOUT.rows === rows && LAST_LAYOUT.cols === cols) return;
    if (instanced) { scene.remove(instanced); instanced.dispose(); }
    const geo = new THREE.BoxGeometry(0.86, 0.86, 0.86);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    instanced = new THREE.InstancedMesh(geo, mat, rows * cols * 3);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    count = rows * cols * 3;
    instanced.count = count;

    const dummy = new THREE.Object3D();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (let lvl = 0; lvl < 3; lvl++) {
          dummy.position.set(c - cols / 2, 0.5 - r + rows / 2, lvl * 1.2);
          dummy.updateMatrix();
          instanced.setMatrixAt(i++, dummy.matrix);
        }
      }
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.material.vertexColors = true;
    const color = new THREE.Color(PALETTE.voxel);
    for (let k = 0; k < count; k++) instanced.setColorAt(k, color);
    instanced.instanceColor.needsUpdate = true;

    LAST_LAYOUT = { rows, cols };
    scene.add(instanced);
  }

  function setGrid(grid) {
    if (!grid || !grid.length) return;
    const rows = grid.length;
    const cols = grid[0].length;
    ensureInstanced(rows, cols);
    const col = new THREE.Color();
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isWall = !!grid[r][c].wall;
        for (let lvl = 0; lvl < 3; lvl++) {
          col.setHex(isWall ? PALETTE.wall : PALETTE.voxel);
          instanced.setColorAt(idx++, col);
        }
      }
    }
    instanced.instanceColor.needsUpdate = true;
  }

  function setStartGoal(start, goal) {
    if (startMarker) { scene.remove(startMarker); startMarker.geometry.dispose(); startMarker.material.dispose(); }
    if (goalMarker)  { scene.remove(goalMarker);  goalMarker.geometry.dispose();  goalMarker.material.dispose(); }
    if (!LAST_LAYOUT) return;
    const cols = LAST_LAYOUT.cols;
    if (start) {
      const g = new THREE.SphereGeometry(0.45, 16, 12);
      const m = new THREE.MeshBasicMaterial({ color: PALETTE.start });
      startMarker = new THREE.Mesh(g, m);
      startMarker.position.set(start.col - cols / 2, 0.5, 1);
      scene.add(startMarker);
    }
    if (goal) {
      const g = new THREE.SphereGeometry(0.45, 16, 12);
      const m = new THREE.MeshBasicMaterial({ color: PALETTE.goal });
      goalMarker = new THREE.Mesh(g, m);
      goalMarker.position.set(goal.col - cols / 2, 0.5, 1);
      scene.add(goalMarker);
    }
    pathLine = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: PALETTE.path }));
    scene.add(pathLine);
  }

  function setView(view) {
    if (!view || !LAST_LAYOUT) return;
    const rows = LAST_LAYOUT.rows;
    const cols = LAST_LAYOUT.cols;
    const col = new THREE.Color();
    const pathSet = new Set((view.path || []).map((k) => String(k).replace(/^[fb]:/, '')));
    const closedSet = new Set((view.closedSet || []).map((k) => String(k).replace(/^[fb]:/, '')));
    const openSet   = new Set((view.openSet   || []).map((k) => String(k).replace(/^[fb]:/, '')));
    const current = view.current ? String(view.current).replace(/^[fb]:/, '') : null;
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${r},${c}`;
        let c2 = PALETTE.voxel;
        if (pathSet.has(key)) c2 = PALETTE.path;
        else if (key === current) c2 = PALETTE.current;
        else if (closedSet.has(key)) c2 = PALETTE.visited;
        else if (openSet.has(key))   c2 = PALETTE.frontier;
        for (let lvl = 0; lvl < 3; lvl++) {
          col.setHex(c2);
          instanced.setColorAt(idx++, col);
        }
      }
    }
    instanced.instanceColor.needsUpdate = true;

    // Rebuild path polyline.
    const positions = [];
    if (view.path && view.path.length) {
      for (const k of view.path) {
        const ks = String(k).replace(/^[fb]:/, '');
        const [r, c] = ks.split(',').map(Number);
        positions.push(c - cols / 2, -r + 8, 1);
      }
    }
    if (pathLine) scene.remove(pathLine);
    pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pathLine = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: PALETTE.path, linewidth: 4 }));
    scene.add(pathLine);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf;
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const a = t * 0.00018;
    camera.position.x = Math.cos(a) * 38 + Math.sin(a) * 6;
    camera.position.z = Math.sin(a) * 38 + Math.cos(a) * 6;
    camera.lookAt(0, 5, 1);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    if (instanced) instanced.geometry.dispose(), instanced.material.dispose();
    if (pathLine)  pathLine.geometry.dispose(),  pathLine.material.dispose();
    if (startMarker) startMarker.geometry.dispose(), startMarker.material.dispose();
    if (goalMarker)  goalMarker.geometry.dispose(),  goalMarker.material.dispose();
    renderer.dispose();
  }

  return { setGrid, setView, setStartGoal, destroy };
}

export const _palette = PALETTE;
