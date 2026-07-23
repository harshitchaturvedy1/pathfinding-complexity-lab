/**
 * Controls — the deck of buttons, sliders, and selectors.  Stateless
 * beyond tiny `DOM` state; emits events through `opts.on*` callbacks
 * so `app.js` can keep a single source of truth.
 *
 * Public API:
 *   const c = createControls(rootElement, {
 *     onPlay, onPause, onStepForward, onStepBack, onJumpStart, onJumpEnd,
 *     onSpeed, onHeuristic, onWeight, onAllowDiagonal,
 *     onMapGenerator, onMapSize, onRun, onExport,
 *     onPlacementUpdate,
 *   });
 *   c.setSpeedLabel('30 steps/sec');
 *   c.setHeuristic('weighted');
 *   c.setWeight(1.5);
 *   c.setAllowDiagonal(true);
 *   c.setMapGenerator('maze');
 *   c.setMapDimensions(40, 25);
 *   c.setPlacement({ mode: 'wall' });
 *   c.destroy();
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(path, attrs = {}) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', attrs.size || 16);
  el.setAttribute('height', attrs.size || 16);
  el.setAttribute('fill', attrs.fill || 'none');
  el.setAttribute('stroke', attrs.stroke || 'currentColor');
  el.setAttribute('stroke-width', attrs.sw || '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.innerHTML = path;
  return el;
}

const ICONS = {
  play:   '<polygon points="6 4 20 12 6 20 6 4"></polygon>',
  pause:  '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>',
  stepB:  '<polygon points="6 4 14 12 6 20"></polygon><rect x="16" y="4" width="3" height="16"></rect>',
  stepF:  '<polygon points="18 4 10 12 18 20"></polygon><rect x="5" y="4" width="3" height="16"></rect>',
  start:  '<polygon points="5 4 8 4 8 20 5 20"></polygon><rect x="9" y="11" width="11" height="2"></rect>',
  end:    '<rect x="4" y="11" width="11" height="2"></rect><polygon points="16 4 19 4 19 20 16 20"></polygon>',
  run:    '<polygon points="5 4 19 12 5 20"></polygon>',
  export: '<path d="M12 3v12"/><polygon points="6 11 12 17 18 11"></polygon><rect x="4" y="20" width="16" height="2"></rect>',
  random: '<path d="M3 6h18M3 12h12M3 18h18"/>',
  maze:   '<path d="M3 3h2v18H3zM19 3h2v18h-2zM5 6h14M5 12h14M5 18h14" stroke-width="1.4"/>',
  bot:    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  empty:  '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  drag:   '<circle cx="12" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18" r="2"/>'
};

function button(label, onClick, opts = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ctl-btn ${opts.class || ''}`.trim();
  b.dataset.action = opts.action || label.toLowerCase();
  b.title = opts.title || label;
  b.setAttribute('aria-label', opts.title || label);
  if (opts.icon) b.appendChild(svg(ICONS[opts.icon], opts.iconOpts || {}));
  if (label && !(opts.iconOnly)) {
    const span = document.createElement('span');
    span.textContent = label;
    b.appendChild(span);
  }
  b.addEventListener('click', onClick);
  return b;
}

function el(tag, cls, content) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content != null) e.innerHTML = content;
  return e;
}

function range(value, min, max, step, onInput, onChange) {
  const r = document.createElement('input');
  r.type = 'range';
  r.min = String(min); r.max = String(max); r.step = String(step);
  r.value = String(value);
  r.addEventListener('input', () => onInput && onInput(Number(r.value)));
  r.addEventListener('change', () => onChange && onChange(Number(r.value)));
  return r;
}

function select(items, value, onChange) {
  const s = document.createElement('select');
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.value;
    o.textContent = it.label;
    if (it.value === String(value)) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function createControls(root, opts) {
  /* ---------------- transport row ---------------- */

  const transport = el('div', 'ctl-row ctl-transport');
  const btnPlayPause = button('Play', opts.onPlay, { icon: 'play', action: 'play', title: 'Play / Pause (space)' });
  const btnStepBack  = button('', opts.onStepBack, { icon: 'stepB', action: 'step-back', title: 'Step backward (←)', iconOnly: true });
  const btnStepFwd   = button('', opts.onStepForward, { icon: 'stepF', action: 'step-fwd', title: 'Step forward (→)', iconOnly: true });
  const btnJumpStart = button('', opts.onJumpStart, { icon: 'start', action: 'jump-start', title: 'Jump to start', iconOnly: true });
  const btnJumpEnd   = button('', opts.onJumpEnd, { icon: 'end', action: 'jump-end', title: 'Jump to end', iconOnly: true });
  transport.append(btnJumpStart, btnStepBack, btnPlayPause, btnStepFwd, btnJumpEnd);

  const speedValue = el('span', 'ctl-speed-label', '30 /s');
  const speedSlider = range(30, 1, 240, 1,
    (v) => {
      speedValue.textContent = `${v} /s`;
      if (opts.onSpeed) opts.onSpeed(v);
    },
    (v) => { if (opts.onSpeed) opts.onSpeed(v); }
  );

  /* ---------------- algorithm / visualization row ---------------- */

  const algoASelect = select(
    [
      { value: 'dijkstra',  label: 'Dijkstra' },
      { value: 'astar',     label: 'A* (octile)' },
      { value: 'jps',       label: 'JPS (8-conn grids)' },
      { value: 'bidir',     label: 'Bidirectional A*' },
      { value: 'dstarlite', label: 'D* Lite (static)' }
    ],
    'dijkstra',
    (v) => { if (opts.onAlgorithmA) opts.onAlgorithmA(v); }
  );
  const algoBSelect = select(
    [
      { value: 'dijkstra',  label: 'Dijkstra' },
      { value: 'astar',     label: 'A* (octile)' },
      { value: 'jps',       label: 'JPS (8-conn grids)' },
      { value: 'bidir',     label: 'Bidirectional A*' },
      { value: 'dstarlite', label: 'D* Lite (static)' }
    ],
    'astar',
    (v) => { if (opts.onAlgorithmB) opts.onAlgorithmB(v); }
  );
  const vizSelect = select(
    [
      { value: 'grid',  label: 'Grid (2D)' },
      { value: 'graph', label: 'Graph (force layout)' },
      { value: 'mesh3d',label: '3D Mesh (Three.js)' }
    ],
    'grid',
    (v) => { if (opts.onVizMode) opts.onVizMode(v); }
  );
  const algoRow = el('div', 'ctl-row ctl-algo');
  algoRow.append(
    el('label', 'ctl-label', 'Left'),
    algoASelect,
    el('label', 'ctl-label right-pad', 'Right'),
    algoBSelect,
    el('label', 'ctl-label right-pad', 'Viz'),
    vizSelect
  );

  /* ---------------- heuristic row ---------------- */

  const heuristicSelect = select(
    [
      { value: 'manhattan', label: 'Manhattan' },
      { value: 'euclidean', label: 'Euclidean' },
      { value: 'octile',    label: 'Octile' },
      { value: 'weighted',  label: 'Weighted A* (octile base)' }
    ],
    'octile',
    (v) => { weightWrap.style.display = v === 'weighted' ? 'flex' : 'none'; if (opts.onHeuristic) opts.onHeuristic(v); }
  );
  const weightValue  = el('span', 'ctl-weight-label', 'w = 1.0');
  const weightSlider = range(1.0, 1.0, 5.0, 0.1,
    (v) => { weightValue.textContent = `w = ${v.toFixed(1)}`; if (opts.onWeight) opts.onWeight(v); }
  );
  const weightWrap = el('label', 'ctl-weight-wrap');
  weightWrap.append(
    el('span', 'ctl-label', 'Weight'),
    weightSlider,
    weightValue
  );
  weightWrap.style.display = 'none';

  const allowDiagLabel = el('label', 'ctl-check');
  const allowDiag = document.createElement('input');
  allowDiag.type = 'checkbox';
  allowDiag.checked = true;
  allowDiag.addEventListener('change', () => {
    if (opts.onAllowDiagonal) opts.onAllowDiagonal(allowDiag.checked);
  });
  allowDiagLabel.append(allowDiag, el('span', '', '8-connectivity'));

  const heuristicWrap = el('div', 'ctl-row ctl-heur');
  heuristicWrap.append(
    el('label', 'ctl-label', 'A* heuristic'),
    heuristicSelect,
    weightWrap,
    allowDiagLabel
  );

  /* ---------------- map row ---------------- */

  const mapSelect = select(
    [
      { value: 'random',       label: 'Random (dense)' },
      { value: 'random-sparse',label: 'Random (sparse)' },
      { value: 'maze',         label: 'Maze (DFS)' },
      { value: 'bottleneck',   label: 'Bottleneck' },
      { value: 'empty',        label: 'Open field' }
    ],
    'random',
    (v) => { if (opts.onMapGenerator) opts.onMapGenerator(v); }
  );
  const sizeRows = el('input'); sizeRows.type = 'number'; sizeRows.min = '5'; sizeRows.max = '120'; sizeRows.value = '30'; sizeRows.step = '1';
  const sizeCols = el('input'); sizeCols.type = 'number'; sizeCols.min = '5'; sizeCols.max = '120'; sizeCols.value = '50'; sizeCols.step = '1';
  const onSizeChange = () => {
    const r = clampInt(sizeRows.value, 5, 120, 30);
    const c = clampInt(sizeCols.value, 5, 120, 50);
    sizeRows.value = String(r);
    sizeCols.value = String(c);
    if (opts.onMapSize) opts.onMapSize({ rows: r, cols: c });
  };
  sizeRows.addEventListener('change', onSizeChange);
  sizeCols.addEventListener('change', onSizeChange);

  const mapWrap = el('div', 'ctl-row ctl-map');
  mapWrap.append(
    el('label', 'ctl-label', 'Map'),
    mapSelect,
    el('label', 'ctl-num', 'R'), sizeRows,
    el('label', 'ctl-num', 'C'), sizeCols
  );

  /* ---------------- action row ---------------- */

  const btnRun    = button('Run', opts.onRun,     { icon: 'run',    action: 'run',     class: 'ctl-primary' });
  const btnExport = button('Export CSV', opts.onExport, { icon: 'export', action: 'export', class: 'ctl-secondary' });
  const btnRandom = button('Randomize', opts.onMapRandomize, { icon: 'random', action: 'randomize' });

  const mapPresets = el('div', 'ctl-row ctl-maps-presets');
  const mapBtn1 = button('Maze', () => { mapSelect.value = 'maze'; mapSelect.dispatchEvent(new Event('change')); }, { icon: 'maze', action: 'preset-maze' });
  const mapBtn2 = button('Bottleneck', () => { mapSelect.value = 'bottleneck'; mapSelect.dispatchEvent(new Event('change')); }, { icon: 'bot', action: 'preset-bottle' });
  const mapBtn3 = button('Empty', () => { mapSelect.value = 'empty'; mapSelect.dispatchEvent(new Event('change')); }, { icon: 'empty', action: 'preset-empty' });
  mapPresets.append(mapBtn1, mapBtn2, mapBtn3);

  const placementWrap = el('div', 'ctl-row ctl-placement');
  const placeLabel = el('label', 'ctl-label', 'Place');
  const placeSelect = select(
    [
      { value: '',      label: 'None' },
      { value: 'wall',  label: 'Walls (drag)' },
      { value: 'start', label: 'Start' },
      { value: 'goal',  label: 'Goal' }
    ],
    '',
    (v) => { if (opts.onPlacementUpdate) opts.onPlacementUpdate({ mode: v || null }); }
  );
  placementWrap.append(placeLabel, placeSelect);

  /* ---------------- assemble ---------------- */

  root.innerHTML = '';
  const groupA = el('section', 'ctl-group ctl-transport-group');
  groupA.append(transport, algoRow, heuristicWrap);

  const groupB = el('section', 'ctl-group ctl-map-group');
  groupB.append(mapWrap, mapPresets);

  const groupC = el('section', 'ctl-group ctl-action-group');
  groupC.append(placementWrap, btnRun, btnExport, btnRandom);

  root.append(groupA, groupB, groupC);

  function setPlaying(playing) {
    btnPlayPause.innerHTML = '';
    btnPlayPause.appendChild(svg(ICONS[playing ? 'pause' : 'play'], { sw: '1.8' }));
    btnPlayPause.appendChild(el('span', '', playing ? 'Pause' : 'Play'));
    btnPlayPause.dataset.action = playing ? 'pause' : 'play';
  }

  function setSpeedLabel(s) {
    speedValue.textContent = `${s} /s`;
    speedSlider.value = String(s);
  }

  return {
    setPlaying,
    setSpeedLabel,
    setHeuristic(v) { heuristicSelect.value = v; weightWrap.style.display = v === 'weighted' ? 'flex' : 'none'; },
    setAllowDiagonal(v) { allowDiag.checked = !!v; },
    setMapGenerator(v) { mapSelect.value = v; },
    setWeight(v) { weightSlider.value = String(v); weightValue.textContent = `w = ${(+v).toFixed(1)}`; },
    setMapDimensions(r, c) { sizeRows.value = String(r); sizeCols.value = String(c); },
    setPlacement(m) { placeSelect.value = m && m.mode ? m.mode : ''; },
    setAlgorithmA(v) { algoASelect.value = v; },
    setAlgorithmB(v) { algoBSelect.value = v; },
    setVizMode(v) { vizSelect.value = v; },
    get buttonEls() {
      return { btnPlayPause, btnStepBack, btnStepFwd, btnJumpStart, btnJumpEnd, btnRun, btnExport };
    },
    destroy() { root.innerHTML = ''; }
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
