import { WORDS } from './words.js';
import { generateFeasiblePuzzle, MIN_WORD_LEN } from './generator.js';

const DEV = false;

/* ===== DOM ===== */
const wrapper = document.getElementById('boardWrapper');
const frameEl = document.getElementById('frame');
const boardEl = document.querySelector('#board .grid');

const topBorderEl = document.getElementById('topBorder');
const bottomBorderEl = document.getElementById('bottomBorder');
const leftBorderEl = document.getElementById('leftBorder');
const rightBorderEl = document.getElementById('rightBorder');

const toastEl = document.getElementById('toast');
const themeSelect = document.getElementById('themeSelect');
const difficultySelect = document.getElementById('difficultySelect');
const sizeSelect = document.getElementById('sizeSelect');

const settingsBtn = document.getElementById('settingsBtn');
let settingsIdleTimer = null;

function hideSettingsBtn() { settingsBtn?.classList.add('hidden'); }
function showSettingsBtn() { settingsBtn?.classList.remove('hidden'); }
function scheduleSettingsReturn(delay = 1200) {
  clearTimeout(settingsIdleTimer);
  settingsIdleTimer = setTimeout(showSettingsBtn, delay);
}

const settingsModal = document.getElementById('settingsModal');
const settingsClose = document.getElementById('settingsClose');
const newGameBtn = document.getElementById('newGameBtn');

const confettiCanvas = document.getElementById('confetti');
const ctx = confettiCanvas?.getContext('2d');

/* ===== Audio: mobile-safe unlock ===== */
function canPlay(type) {
  const a = document.createElement('audio');
  return !!a.canPlayType && a.canPlayType(type) !== '';
}
const winSound = new Audio(
  canPlay('audio/ogg; codecs="vorbis"')
    ? './sounds/win-fanfare.ogg'
    : './sounds/win-fanfare.mp3'
);
winSound.preload = 'auto';

let audioReady = false;
function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    window.__audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (window.__audioCtx.state === 'suspended') window.__audioCtx.resume();
  } catch {}
  winSound.muted = true;
  winSound.play().then(() => {
    winSound.pause();
    winSound.currentTime = 0;
    winSound.muted = false;
  }).catch(() => { winSound.muted = false; });
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

winSound.addEventListener('ended', () => {
  stopBorderChase();
  stopPlayableTileChase();
  stopSolutionChase();
  stopSolutionLetterChase();
  stopConfettiEmission();
  fadeOutConfetti(1800);
  document.documentElement.classList.remove('celebrating');
  boardEl.querySelectorAll('.cell .char').forEach(ch => ch.classList.remove('celebrate-text'));
  showVictoryOverlay();
});

/* ===== Confetti ===== */
let confettiParticles = [];
let confettiRunning = false;
let confettiTicker = null;
let confettiOptionsGlobal = null;
let confettiEmitEnabled = true;

function resizeConfetti() {
  if (!confettiCanvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  confettiCanvas.width = Math.floor(window.innerWidth * dpr);
  confettiCanvas.height = Math.floor(window.innerHeight * dpr);
  confettiCanvas.style.width = `${window.innerWidth}px`;
  confettiCanvas.style.height = `${window.innerHeight}px`;
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeConfetti);

function launchConfetti({
  mode = 'burst',
  bursts = 3,
  countPerBurst = 220,
  rainTailMs = 2600,
  duration = 7200,
  gravity = 0.36,
  spread = Math.PI * 1.1,
  drag = 0.997,
  palette = ['#68e3ff', '#a78bfa', '#f472b6', '#60a5fa', '#22d3ee'],
  mixShapes = true
} = {}) {
  confettiEmitEnabled = true;
  resizeConfetti();
  confettiParticles = [];
  confettiRunning = true;
  confettiOptionsGlobal = { gravity, drag, duration };

  const W = confettiCanvas.width / (window.devicePixelRatio || 1);
  const H = confettiCanvas.height / (window.devicePixelRatio || 1);

  const centers = mode === 'multiBurst'
    ? [
        [W * 0.18, H * 0.35],
        [W * 0.5, H * 0.35],
        [W * 0.82, H * 0.35],
        [W * 0.5, H * 0.18]
      ].slice(0, bursts)
    : [[W / 2, H * 0.4]];

  for (const [cx, cy] of centers) {
    if (!confettiEmitEnabled) break;
    spawnBurst({ cx, cy, count: countPerBurst, spread, palette, mixShapes, gravity });
  }

  const rainStart = performance.now();
  const rain = () => {
    const now = performance.now();
    if (!confettiEmitEnabled) return;
    if (now - rainStart > rainTailMs) return;
    spawnBurst({
      cx: Math.random() * W,
      cy: -8,
      count: Math.floor(countPerBurst * 0.18),
      spread: Math.PI * 0.5,
      palette,
      mixShapes,
      downOnly: true,
      gravity
    });
    setTimeout(rain, 140);
  };
  if (rainTailMs > 0 && confettiEmitEnabled) rain();

  const FIXED_DT = 16.6667;
  let accumulator = 0;
  let lastTime = performance.now();

  function updatePhysics(dt) {
    const dtScale = dt / 16.6667;
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
      const p = confettiParticles[i];
      p.vy += (gravity * (Math.random() * 0.02 + 0.99)) * dtScale;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;
      p.rot += p.vr * dtScale;
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 60) confettiParticles.splice(i, 1);
    }
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (const p of confettiParticles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(-p.w / 2, p.h / 2);
        ctx.lineTo(0, -p.h / 2);
        ctx.lineTo(p.w / 2, p.h / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        const rw = p.w;
        const rh = p.h;
        const r = Math.min(3, rw * 0.15);
        roundRect(ctx, -rw / 2, -rh / 2, rw, rh, r);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function tick(now) {
    const dt = Math.min(40, now - lastTime);
    lastTime = now;
    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      updatePhysics(FIXED_DT);
      accumulator -= FIXED_DT;
    }
    render();
    if (confettiParticles.length > 0) {
      confettiTicker = requestAnimationFrame(tick);
    } else {
      confettiRunning = false;
      if (confettiTicker) {
        cancelAnimationFrame(confettiTicker);
        confettiTicker = null;
      }
      if (ctx) ctx.clearRect(0, 0, W, H);
    }
  }

  confettiTicker = requestAnimationFrame(tick);

  function spawnBurst({ cx, cy, count, spread, palette, mixShapes, downOnly = false, gravity: g }) {
    if (!confettiEmitEnabled) return;
    const baseSpeed = 10;
    const batchSize = Math.max(16, Math.floor(count / 6));
    let created = 0;
    function emitBatch() {
      if (!confettiEmitEnabled) return;
      const toCreate = Math.min(batchSize, count - created);
      for (let i = 0; i < toCreate; i++) {
        const angle = downOnly
          ? (Math.random() * (Math.PI * 0.5)) + Math.PI / 2
          : (Math.random() * spread) - (spread / 2);
        const speed = baseSpeed * (0.6 + Math.random() * 1.4);
        const size = (Math.random() * 7) + 4;
        const w = size;
        const h = size * (0.7 + Math.random() * 1.4);
        const color = palette[Math.floor(Math.random() * palette.length)];
        const shapes = mixShapes ? ['rect', 'circle', 'triangle'] : ['rect'];
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        const sign = Math.random() > 0.5 ? 1 : -1;
        confettiParticles.push({
          x: cx + (Math.random() - 0.5) * 8,
          y: cy + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.2,
          vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 1.2,
          w,
          h,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.2 * sign,
          color,
          life: duration + (Math.random() * 800 - 200),
          maxLife: duration,
          shape,
          drag: drag * (0.985 + Math.random() * 0.02)
        });
        if (confettiParticles.length > 4000) break;
      }
      created += toCreate;
      if (created < count) requestAnimationFrame(emitBatch);
    }
    requestAnimationFrame(emitBatch);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = r || 0;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

function stopConfettiEmission() { confettiEmitEnabled = false; }
function fadeOutConfetti(fadeMs = 1500) {
  for (const p of confettiParticles) {
    p.life = Math.min(p.life, fadeMs);
    p.maxLife = Math.min(p.maxLife, fadeMs);
  }
}

/* ===== Presets ===== */
const SIZE_PRESETS = {
  small:  { N: 8,  maxWordLen: 5,  wordCount: 7  },
  medium: { N: 11, maxWordLen: 8,  wordCount: 10 },
  large:  { N: 16, maxWordLen: 11, wordCount: 20 }
};

/* ===== Persisted selections ===== */
let sizeKey = localStorage.getItem('boardSize') || 'large';
let difficulty = (localStorage.getItem('puzzleDifficulty') || 'balanced');
let TARGET_N = SIZE_PRESETS[sizeKey].N;

/* ===== Dictionary ===== */
function buildDictionary(minLen, maxLen) {
  return WORDS
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= minLen && w.length <= maxLen);
}

/* ===== State ===== */
let solutionLetters = new Map(); // Map<cellKey, letter>
let N = TARGET_N;
let gridRef = [];
let totalFillable = 0;

let slotAssignment = null; // { slots, byCell, bySlot }
let slotEls = new Map();   // Map<slotId, HTMLElement>
let tokens = new Map();    // Map<cellKey, Token>
let selectedTokenId = null;

/* ===== Offline pool state & loader ===== */
let pool = null; // { meta, puzzles }
function poolCursorKey() { return `poolCursor:${sizeKey}:${difficulty}`; }
let poolCursor = Number(localStorage.getItem(poolCursorKey())) || 0;

function toMap(entries) {
  const m = new Map();
  for (const [k, v] of entries) m.set(k, v);
  return m;
}

async function loadPool() {
  pool = null;
  poolCursor = Number(localStorage.getItem(poolCursorKey())) || 0;

  const url = `./puzzles/pool-${sizeKey}-${difficulty}.json`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.puzzles?.length) {
      pool = json;
      if (poolCursor >= pool.puzzles.length) {
        poolCursor = 0;
        localStorage.setItem(poolCursorKey(), String(poolCursor));
      }
      if (DEV) console.log('Loaded pool:', url, pool.meta);
    }
  } catch (e) {
    if (DEV) console.warn('Pool not available at', url, e);
    pool = null;
  }
}

/* ===== UI: Theme/Size/Difficulty ===== */
function openSettings() {
  if (!settingsModal) return;
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeSettings() {
  if (!settingsModal) return;
  settingsModal.classList.remove('open');
  settingsModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
settingsBtn?.addEventListener('click', openSettings);
settingsClose?.addEventListener('click', closeSettings);
settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && settingsModal?.classList.contains('open')) closeSettings(); });

themeSelect?.addEventListener('change', () => {
  document.documentElement.setAttribute('data-theme', themeSelect.value);
  scheduleFitToViewport();
});

if (sizeSelect) {
  sizeSelect.value = sizeKey;
  sizeSelect.addEventListener('change', async () => {
    sizeKey = sizeSelect.value;
    localStorage.setItem('boardSize', sizeKey);
    TARGET_N = SIZE_PRESETS[sizeKey].N;
    await loadPool();
    newPuzzle();
  });
}

if (difficultySelect) {
  difficultySelect.value = difficulty;
  difficultySelect.addEventListener('change', async () => {
    difficulty = difficultySelect.value;
    localStorage.setItem('puzzleDifficulty', difficulty);
    await loadPool();
    newPuzzle();
  });
}

newGameBtn?.addEventListener('click', async () => {
  closeSettings();
  await resetGame();
});

/* ===== New puzzle: prefer offline pool, fallback to live generator ===== */
async function newPuzzle() {
  try {
    document.body.style.cursor = 'progress';

    const preset = SIZE_PRESETS[sizeKey] ?? SIZE_PRESETS.large;
    const minWordLen = MIN_WORD_LEN;
    const maxWordLen = preset.maxWordLen;
    const wordCount  = preset.wordCount;

    let out;

    // Try offline pool
    if (pool && pool.puzzles.length) {
      const p = pool.puzzles[poolCursor];
      poolCursor = (poolCursor + 1) % pool.puzzles.length;
      localStorage.setItem(poolCursorKey(), String(poolCursor));
      out = deserializePoolPuzzleSingleWave(p, preset.N);
    }

    // Fallback: live generation
    if (!out) {
      const DICT = buildDictionary(minWordLen, maxWordLen);
      const raw = generatePuzzleWithinSizeGuaranteed(
        DICT,
        preset.N,
        {
          difficulty,
          minWordLen,
          maxWordLen,
          wordCount,
          maxWordCountCap: Math.max(wordCount + 32, 4 * preset.N)
        }
      );

      // Center-pad if smaller
      if (raw.grid.length < preset.N) {
        const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } =
          padGridToSize(raw.grid, raw.letters, preset.N);
        const shiftedAssignment = shiftSlotAssignmentKeysSingleWave(raw.slotAssignment, padTop, padLeft);
        out = { grid: paddedGrid, letters: filterToSinglePerSlot(shiftedLetters, shiftedAssignment), words: raw.words, slotAssignment: shiftedAssignment };
      } else {
        const singleAssignment = shiftSlotAssignmentKeysSingleWave(raw.slotAssignment, 0, 0);
        out = {
          grid: raw.grid,
          letters: filterToSinglePerSlot(raw.letters, singleAssignment),
          words: raw.words,
          slotAssignment: singleAssignment
        };
      }
    }

    solutionLetters = out.letters;
    gridRef = out.grid;
    N = preset.N;
    TARGET_N = preset.N;
    slotAssignment = out.slotAssignment;

    renderFrame();
    renderBoard(out.grid);
    renderOutsideSlots(N);
    renderTokensFromAssignment(solutionLetters, slotAssignment);
    scheduleFitToViewport();
  } catch (e) {
    console.error(e);
  } finally {
    document.body.style.cursor = '';
  }
}

/** Deserialize a pool puzzle and drop any backups: one letter per slot only */
function deserializePoolPuzzleSingleWave(p) {
  const assignment = {
    byCell: toMap(p.slotAssignment.byCell),
    bySlot: toMap(p.slotAssignment.bySlot),
    slots: p.slotAssignment.slots
  };
  const lettersMap = toMap(p.letters);
  return {
    grid: p.grid,
    letters: filterToSinglePerSlot(lettersMap, assignment),
    words: p.words,
    slotAssignment: assignment
  };
}

/** Generator guard: keeps trying until size fits */
function generatePuzzleWithinSizeGuaranteed(dictionary, targetN, options = {}) {
  for (;;) {
    const out = generateFeasiblePuzzle(dictionary, options);
    if (out.grid.length <= targetN) return out;
  }
}

/** Center-pad to targetN; shift letter coordinates */
function padGridToSize(grid, letters, targetN) {
  const n = grid.length;
  const newGrid = Array.from({ length: targetN }, () => Array(targetN).fill(0));
  const padTop = Math.floor((targetN - n) / 2);
  const padLeft = Math.floor((targetN - n) / 2);

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    newGrid[r + padTop][c + padLeft] = grid[r][c];

  const newLetters = new Map();
  for (const [key, ch] of letters.entries()) {
    const [rStr, cStr] = key.split(',');
    const r = Number(rStr) + padTop;
    const c = Number(cStr) + padLeft;
    newLetters.set(`${r},${c}`, ch);
  }
  return { grid: newGrid, letters: newLetters, padTop, padLeft };
}

/** Shift slotAssignment indices/ids by pad offsets; no queues */
function shiftSlotAssignmentKeysSingleWave(assignment, padTop, padLeft) {
  if (!assignment) return null;

  const slots = assignment.slots.map(s => {
    const add = (s.side === 'L' || s.side === 'R') ? padTop : padLeft;
    const index = s.index + add;
    return { id: `${s.side}:${index}`, side: s.side, index };
  });

  const byCell = new Map();
  const bySlot = new Map();

  for (const [key, info] of assignment.byCell.entries ? assignment.byCell.entries() : []) {
    const [rStr, cStr] = key.split(',');
    const nr = Number(rStr) + padTop;
    const nc = Number(cStr) + padLeft;
    const newKey = `${nr},${nc}`;

    const add = (info.side === 'L' || info.side === 'R') ? padTop : padLeft;
    const newIndex = info.index + add;
    const newId = `${info.side}:${newIndex}`;

    byCell.set(newKey, { side: info.side, index: newIndex, id: newId });
    bySlot.set(newId, newKey);
  }

  // If assignment.byCell is a Map already (runtime), return mapped version
  if (!assignment.byCell.entries) {
    // assignment.byCell may already be Map of shifted keys (when called with 0 offsets)
    return { byCell: assignment.byCell, bySlot: assignment.bySlot, slots };
  }

  return { byCell, bySlot, slots };
}

/** Reduce letters to one per slot */
function filterToSinglePerSlot(lettersMap, assignment) {
  const firstBySlot = new Map(); // slotId -> cellKey
  // If we have bySlot mapping, iterate slots and choose the first cell tied to each slot
  if (assignment?.bySlot instanceof Map) {
    for (const [slotId, cellKey] of assignment.bySlot.entries()) {
      if (!firstBySlot.has(slotId)) firstBySlot.set(slotId, cellKey);
    }
  } else if (assignment?.byCell instanceof Map) {
    const groups = new Map();
    for (const [cellKey, info] of assignment.byCell.entries()) {
      const arr = groups.get(info.id) || [];
      arr.push({ cellKey, wave: info.wave ?? 0 });
      groups.set(info.id, arr);
    }
    for (const [slotId, arr] of groups.entries()) {
      arr.sort((a, b) => a.wave - b.wave);
      firstBySlot.set(slotId, arr[0].cellKey);
    }
  }

  const filtered = new Map();
  for (const [slotId, cellKey] of firstBySlot.entries()) {
    if (lettersMap.has(cellKey)) filtered.set(cellKey, lettersMap.get(cellKey));
  }
  return filtered;
}

/* ===== Renderers ===== */
function renderFrame() {
  frameEl.style.setProperty('--n', N);
  document.documentElement.style.setProperty('--n', N);
}

function renderBoard(grid) {
  boardEl.innerHTML = '';
  boardEl.parentElement.style.setProperty('--n', N);
  totalFillable = 0;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const isCell = grid[r][c] === 1;
      const cell = document.createElement('div');
      cell.className = isCell ? 'cell fillable' : 'cell empty';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.dataset.coord = `${r},${c}`;
      cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}${isCell ? ': empty' : ': blocked'}`);

      if (isCell) {
        totalFillable++;
        const char = document.createElement('div');
        char.className = 'char';
        char.textContent = '';
        cell.appendChild(char);
      }

      cell.addEventListener('click', onBoardCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function renderOutsideSlots(n) {
  topBorderEl.innerHTML = '';
  bottomBorderEl.innerHTML = '';
  leftBorderEl.innerHTML = '';
  rightBorderEl.innerHTML = '';
  slotEls.clear();

  for (let c = 0; c < n; c++) {
    const t = document.createElement('div');
    t.className = 'slot empty';
    t.dataset.side = 'T';
    t.dataset.index = String(c);
    t.dataset.slotId = `T:${c}`;
    topBorderEl.appendChild(t);
    slotEls.set(`T:${c}`, t);

    const b = document.createElement('div');
    b.className = 'slot empty';
    b.dataset.side = 'B';
    b.dataset.index = String(c);
    b.dataset.slotId = `B:${c}`;
    bottomBorderEl.appendChild(b);
    slotEls.set(`B:${c}`, b);
  }

  for (let r = 0; r < n; r++) {
    const l = document.createElement('div');
    l.className = 'slot empty';
    l.dataset.side = 'L';
    l.dataset.index = String(r);
    l.dataset.slotId = `L:${r}`;
    leftBorderEl.appendChild(l);
    slotEls.set(`L:${r}`, l);

    const rr = document.createElement('div');
    rr.className = 'slot empty';
    rr.dataset.side = 'R';
    rr.dataset.index = String(r);
    rr.dataset.slotId = `R:${r}`;
    rightBorderEl.appendChild(rr);
    slotEls.set(`R:${r}`, rr);
  }
}

function clearAllowedHighlights() {
  if (!boardEl) return;
  boardEl.querySelectorAll('.cell.allowed').forEach(el => {
    el.classList.remove('allowed', 'path-0', 'path-1', 'path-2', 'path-3', 'path-4');
  });
}

function previewAllowedForToken(token) {
  clearAllowedHighlights();
  if (!token || token.placed) return;

  const isRow = token.side === 'L' || token.side === 'R';
  const fixedIdx = token.index;

  let seq = 0;
  if (isRow) {
    const r = fixedIdx;
    for (let c = 0; c < N; c++) {
      if (gridRef[r][c] !== 1) continue;
      const el = boardEl.querySelector(`.cell[data-coord="${r},${c}"]`);
      if (!el) continue;
      el.classList.add('allowed', `path-${seq % 5}`);
      seq++;
    }
  } else {
    const c = fixedIdx;
    for (let r = 0; r < N; r++) {
      if (gridRef[r][c] !== 1) continue;
      const el = boardEl.querySelector(`.cell[data-coord="${r},${c}"]`);
      if (!el) continue;
      el.classList.add('allowed', `path-${seq % 5}`);
      seq++;
    }
  }
}

/* ===== Tokens: single-letter per slot ===== */
function createTokenForCell(cellKey, info, letter) {
  const tokenEl = document.createElement('div');
  tokenEl.className = 'token';
  tokenEl.textContent = letter;
  tokenEl.dataset.tokenId = cellKey;
  tokenEl.dataset.slotId = info.id;
  tokenEl.dataset.side = info.side;
  tokenEl.dataset.index = String(info.index);
  tokenEl.setAttribute('aria-label', `Outside letter: ${letter}`);

  tokenEl.addEventListener('click', () => selectToken(cellKey));
  tokenEl.addEventListener('mouseenter', () => {
    const tok = tokens.get(cellKey);
    if (tok && !tok.placed && selectedTokenId !== cellKey) previewAllowedForToken(tok);
  });
  tokenEl.addEventListener('mouseleave', () => {
    const tok = tokens.get(cellKey);
    if (!tok || selectedTokenId === cellKey) return;
    clearAllowedHighlights();
  });

  const slotEl = slotEls.get(info.id);
  if (slotEl) {
    slotEl.classList.remove('empty');
    slotEl.classList.add('occupied');
    slotEl.appendChild(tokenEl);
  }

  tokens.set(cellKey, {
    id: cellKey,
    letter,
    side: info.side,
    index: info.index,
    slotId: info.id,
    el: tokenEl,
    placed: false,
    currentCellKey: null
  });

  return tokenEl;
}

function renderTokensFromAssignment(letters, assignment) {
  tokens.clear();
  selectedTokenId = null;

  // Use only one letter per slot (already filtered in solutionLetters)
  for (const [cellKey, letter] of letters.entries()) {
    const info = assignment.byCell.get(cellKey);
    if (!info) continue;
    createTokenForCell(cellKey, info, letter);
  }
}

function selectToken(tokenId) {
  hideSettingsBtn();
  scheduleSettingsReturn();
  if (selectedTokenId && tokens.has(selectedTokenId)) {
    tokens.get(selectedTokenId).el.classList.remove('selected');
  }
  selectedTokenId = tokenId;
  const t = tokens.get(tokenId);
  if (t && !t.placed) {
    t.el.classList.add('selected');
    previewAllowedForToken(t);
  } else {
    clearAllowedHighlights();
  }
}

function onBoardCellClick(e) {
  hideSettingsBtn();
  scheduleSettingsReturn();
  const cell = e.currentTarget;
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const coord = `${r},${c}`;
  const isFillable = gridRef[r][c] === 1;

  const existingTokenId = cell.dataset.tokenId || null;

  // Return token to its slot
  if (existingTokenId) {
    const tok = tokens.get(existingTokenId);
    if (!tok) return;
    const charEl = cell.querySelector('.char');
    if (charEl) charEl.textContent = '';
    cell.removeAttribute('data-token-id');
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: empty`);
    const slotEl = slotEls.get(tok.slotId);
    if (slotEl) {
      slotEl.classList.remove('empty');
      slotEl.classList.add('occupied');
      slotEl.appendChild(tok.el);
    }
    tok.placed = false;
    tok.currentCellKey = null;
    tok.el.classList.remove('selected');

    selectedTokenId = null;
    clearAllowedHighlights();
    return;
  }

  if (!selectedTokenId) return;
  const tok = tokens.get(selectedTokenId);
  if (!tok || tok.placed) return;
  if (!isFillable) return;

  const side = tok.side;
  const idx = tok.index;
  const allowed = (side === 'L' || side === 'R') ? (r === idx) : ((side === 'T' || side === 'B') ? (c === idx) : false);
  if (!allowed) return;

  const charEl = cell.querySelector('.char');
  if (charEl) {
    charEl.textContent = tok.letter;
    charEl.classList.remove('placed');
    // eslint-disable-next-line no-unused-expressions
    charEl.offsetWidth;
    charEl.classList.add('placed');

    cell.dataset.tokenId = tok.id;
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: ${tok.letter}`);
  }

  if (tok.el.parentElement) {
    tok.el.parentElement.classList.remove('occupied');
    tok.el.parentElement.classList.add('empty');
    tok.el.remove();
  }

  tok.placed = true;
  tok.currentCellKey = coord;
  tok.el.classList.remove('selected');
  selectedTokenId = null;
  clearAllowedHighlights();

  if (allTokensPlaced()) {
    validateCompletion();
  }
}

function allTokensPlaced() {
  for (const t of tokens.values()) {
    if (!t.placed) return false;
  }
  return true;
}

/* ===== Perimeter sequences and animations ===== */
function buildBorderSequence(n) {
  const seq = [];
  for (let c = 0; c < n; c++) seq.push(`T:${c}`);
  for (let r = 0; r < n; r++) seq.push(`R:${r}`);
  for (let c = n - 1; c >= 0; c--) seq.push(`B:${c}`);
  for (let r = n - 1; r >= 0; r--) seq.push(`L:${r}`);
  return seq;
}

function buildPlayablePerimeterSequence() {
  const seq = [];
  for (let c = 0; c < N; c++)
    if (gridRef[0][c] === 1) seq.push(`0,${c}`);
  for (let r = 1; r < N; r++)
    if (gridRef[r][N-1] === 1) seq.push(`${r},${N-1}`);
  for (let c = N-2; c >= 0; c--)
    if (gridRef[N-1][c] === 1) seq.push(`${N-1},${c}`);
  for (let r = N-2; r > 0; r--)
    if (gridRef[r][0] === 1) seq.push(`${r},0`);
  return seq;
}

/* Border chase */
let borderChaseRunning = false;
let borderChaseHandle = null;
let borderPromise = null;
let borderResolve = null;

function startBorderChase({ speedMs = 90, tail = 6, laps = 2 } = {}) {
  if (borderChaseRunning) return Promise.resolve();
  borderChaseRunning = true;

  const seq = buildBorderSequence(N);
  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  const styles = getComputedStyle(document.documentElement);
  const accentCycle = [];
  for (let i = 0; i < 5; i++) {
    const v = styles.getPropertyValue(`--path-${i}`).trim();
    if (v) accentCycle.push(v);
  }

  let accentIndex = 0;
  const root = document.documentElement;
  const prevAccent = styles.getPropertyValue('--accent');
  const prevAccent2 = styles.getPropertyValue('--accent-2');

  function applyAccentPair(i) {
    const c0 = accentCycle[i % accentCycle.length];
    const c1 = accentCycle[(i + 1) % accentCycle.length];
    root.style.setProperty('--accent', c0);
    root.style.setProperty('--accent-2', c1);
  }

  slotEls.forEach(el =>
    el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
  );

  borderPromise = new Promise((resolve) => {
    borderResolve = resolve;

    const step = () => {
      if (!borderChaseRunning) {
        root.style.setProperty('--accent', prevAccent);
        root.style.setProperty('--accent-2', prevAccent2);
        slotEls.forEach(el =>
          el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
        );
        if (borderResolve) {
          borderResolve();
          borderResolve = null;
          borderPromise = null;
        }
        return;
      }

      applyAccentPair(accentIndex++);
      slotEls.forEach(el =>
        el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
      );

      for (let t = 0; t < tail; t++) {
        const pos = (idx - t + total) % total;
        const id = seq[pos];
        const el = slotEls.get(id);
        if (!el) continue;

        el.classList.add('border-lit');
        if (t === 1) el.classList.add('border-lit-1');
        if (t === 2) el.classList.add('border-lit-2');
        if (t >= 3) el.classList.add('border-lit-3');
      }

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          root.style.setProperty('--accent', prevAccent);
          root.style.setProperty('--accent-2', prevAccent2);
          borderChaseRunning = false;
          slotEls.forEach(el =>
            el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
          );
          if (borderResolve) {
            borderResolve();
            borderResolve = null;
            borderPromise = null;
          }
        }, 240);
      }
    };

    let last = performance.now();
    let acc = 0;

    function tick(now) {
      if (!borderChaseRunning) {
        if (borderChaseHandle) {
          cancelAnimationFrame(borderChaseHandle);
          borderChaseHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;

      while (acc >= speedMs) {
        step();
        acc -= speedMs;
      }

      borderChaseHandle = requestAnimationFrame(tick);

      if (!borderChaseRunning && borderChaseHandle) {
        cancelAnimationFrame(borderChaseHandle);
        borderChaseHandle = null;
      }
    }

    borderChaseHandle = requestAnimationFrame(tick);
  });

  return borderPromise;
}

function stopBorderChase() {
  if (!borderChaseRunning) return;
  borderChaseRunning = false;
  if (borderChaseHandle) {
    cancelAnimationFrame(borderChaseHandle);
    borderChaseHandle = null;
  }
  slotEls.forEach(el => {
    el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3');
  });
  if (borderResolve) {
    borderResolve();
    borderResolve = null;
    borderPromise = null;
  }
}

/* Playable perimeter chase */
let tileChaseRunning = false;
let tileChaseHandle = null;
let tilePromise = null;
let tileResolve = null;

function startPlayableTileChase({ speedMs = 90, tail = 5, laps = 2 } = {}) {
  if (tileChaseRunning) return Promise.resolve();

  const seqRaw = buildPlayablePerimeterSequence();
  if (!seqRaw.length) return Promise.resolve();
  const seq = seqRaw.slice().reverse();

  tileChaseRunning = true;

  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  const clearAll = () => {
    boardEl.querySelectorAll('.tile-lit,.tile-lit-1,.tile-lit-2,.tile-lit-3')
      .forEach(el => el.classList.remove('tile-lit','tile-lit-1','tile-lit-2','tile-lit-3'));
  };

  clearAll();

  tilePromise = new Promise((resolve) => {
    tileResolve = resolve;

    const step = () => {
      if (!tileChaseRunning) {
        clearAll();
        if (tileResolve) {
          tileResolve();
          tileResolve = null;
          tilePromise = null;
        }
        return;
      }

      clearAll();

      for (let t = 0; t < tail; t++) {
        const pos = (idx - t + total) % total;
        const key = seq[pos];
        const cell = boardEl.querySelector(`.cell[data-coord="${key}"]`);
        if (!cell) continue;

        cell.classList.add('tile-lit');
        if (t === 1) cell.classList.add('tile-lit-1');
        if (t === 2) cell.classList.add('tile-lit-2');
        if (t >= 3) cell.classList.add('tile-lit-3');
      }

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          tileChaseRunning = false;
          clearAll();
          if (tileResolve) {
            tileResolve();
            tileResolve = null;
            tilePromise = null;
          }
        }, 200);
      }
    };

    let last = performance.now();
    let acc = 0;

    function tick(now) {
      if (!tileChaseRunning) {
        if (tileChaseHandle) {
          cancelAnimationFrame(tileChaseHandle);
          tileChaseHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;

      while (acc >= speedMs) {
        step();
        acc -= speedMs;
      }

      tileChaseHandle = requestAnimationFrame(tick);

      if (!tileChaseRunning && tileChaseHandle) {
        cancelAnimationFrame(tileChaseHandle);
        tileChaseHandle = null;
      }
    }

    tileChaseHandle = requestAnimationFrame(tick);
  });

  return tilePromise;
}

function stopPlayableTileChase() {
  if (!tileChaseRunning) return;
  tileChaseRunning = false;
  if (tileChaseHandle) {
    cancelAnimationFrame(tileChaseHandle);
    tileChaseHandle = null;
  }
  boardEl.querySelectorAll('.tile-lit,.tile-lit-1,.tile-lit-2,.tile-lit-3')
    .forEach(el => el.classList.remove('tile-lit','tile-lit-1','tile-lit-2','tile-lit-3'));
  if (tileResolve) {
    tileResolve();
    tileResolve = null;
    tilePromise = null;
  }
}

/* Solution chase */
let solutionChaseRunning = false;
let solutionChaseHandle = null;
let solutionPromise = null;
let solutionResolve = null;

function buildSolutionSequence() {
  if (!slotAssignment || !slotAssignment.slots) return [];
  const seq = slotAssignment.slots.map(s => `${s.side}:${s.index}`).filter(id => slotEls.has(id) && slotAssignment.bySlot.has(id));
  return seq;
}

function startSolutionChase({ speedMs = 90, tail = 4, laps = 2 } = {}) {
  if (solutionChaseRunning) return Promise.resolve();
  const seqRaw = buildSolutionSequence();
  if (!seqRaw.length) return Promise.resolve();
  const seq = seqRaw.slice().reverse();
  solutionChaseRunning = true;
  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));

  solutionPromise = new Promise((resolve) => {
    solutionResolve = resolve;

    const step = () => {
      if (!solutionChaseRunning) {
        slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));
        if (solutionResolve) {
          solutionResolve();
          solutionResolve = null;
          solutionPromise = null;
        }
        return;
      }

      slotEls.forEach(el => {
        el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2');
      });

      for (let t = 0; t < tail; t++) {
        const pos = (idx - t + total) % total;
        const id = seq[pos];
        const el = slotEls.get(id);
        if (!el) continue;
        el.classList.add('solution-lit');
        if (t === 1) el.classList.add('solution-lit-1');
        if (t === 2) el.classList.add('solution-lit-2');
      }

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          solutionChaseRunning = false;
          slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));
          if (solutionResolve) {
            solutionResolve();
            solutionResolve = null;
            solutionPromise = null;
          }
        }, 220);
      }
    };

    let last = performance.now();
    let accumulator = 0;

    function tick(now) {
      if (!solutionChaseRunning) {
        if (solutionChaseHandle) {
          cancelAnimationFrame(solutionChaseHandle);
          solutionChaseHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      accumulator += dt;
      while (accumulator >= speedMs) {
        step();
        accumulator -= speedMs;
      }
      solutionChaseHandle = requestAnimationFrame(tick);
      if (!solutionChaseRunning && solutionChaseHandle) {
        cancelAnimationFrame(solutionChaseHandle);
        solutionChaseHandle = null;
      }
    }
    solutionChaseHandle = requestAnimationFrame(tick);
  });

  return solutionPromise;
}

function stopSolutionChase() {
  if (!solutionChaseRunning) return;
  solutionChaseRunning = false;
  if (solutionChaseHandle) {
    cancelAnimationFrame(solutionChaseHandle);
    solutionChaseHandle = null;
  }
  slotEls.forEach(el => {
    el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2');
  });
  if (solutionResolve) {
    solutionResolve();
    solutionResolve = null;
    solutionPromise = null;
  }
}

/* Solution Letter Chase */
let solutionLetterRunning = false;
let solutionLetterHandle = null;
let solutionLetterPromise = null;
let solutionLetterResolve = null;

function getSolutionCellElementsInSolveOrder() {
  const arr = [];
  for (const [cellKey] of solutionLetters.entries()) {
    const el = boardEl.querySelector(`.cell[data-coord="${cellKey}"] .char`);
    if (el) arr.push(el);
  }
  return arr;
}

function startSolutionLetterChase({ speedMs = 110, laps = 2 } = {}) {
  if (solutionLetterRunning) return Promise.resolve();
  const els = getSolutionCellElementsInSolveOrder();
  if (!els.length) return Promise.resolve();

  solutionLetterRunning = true;
  let idx = 0;
  const total = els.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  els.forEach(el => el.classList.remove('solution-letter-chase'));

  solutionLetterPromise = new Promise((resolve) => {
    solutionLetterResolve = resolve;

    const step = () => {
      if (!solutionLetterRunning) {
        els.forEach(el => el.classList.remove('solution-letter-chase'));
        if (solutionLetterResolve) {
          solutionLetterResolve();
          solutionLetterResolve = null;
          solutionLetterPromise = null;
        }
        return;
      }

      els.forEach(el => el.classList.remove('solution-letter-chase'));
      const el = els[idx];
      if (el) el.classList.add('solution-letter-chase');

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          solutionLetterRunning = false;
          els.forEach(e => e.classList.remove('solution-letter-chase'));
          if (solutionLetterResolve) {
            solutionLetterResolve();
            solutionLetterResolve = null;
            solutionLetterPromise = null;
          }
        }, 120);
      }
    };

    let last = performance.now();
    let acc = 0;
    function tick(now) {
      if (!solutionLetterRunning) {
        if (solutionLetterHandle) {
          cancelAnimationFrame(solutionLetterHandle);
          solutionLetterHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;
      while (acc >= speedMs) {
        step();
        acc -= speedMs;
      }
      solutionLetterHandle = requestAnimationFrame(tick);
    }
    solutionLetterHandle = requestAnimationFrame(tick);
  });

  return solutionLetterPromise;
}

function stopSolutionLetterChase() {
  if (!solutionLetterRunning) return;
  solutionLetterRunning = false;
  if (solutionLetterHandle) {
    cancelAnimationFrame(solutionLetterHandle);
    solutionLetterHandle = null;
  }
  const els = getSolutionCellElementsInSolveOrder();
  els.forEach(el => el.classList.remove('solution-letter-chase'));
  if (solutionLetterResolve) {
    solutionLetterResolve();
    solutionLetterResolve = null;
    solutionLetterPromise = null;
  }
}

/* ===== Celebration ===== */
async function startCelebration() {
  winSound.currentTime = 0;
  winSound.play().catch(() => {});
  document.documentElement.classList.add('celebrating');
  boardEl.querySelectorAll('.cell .char').forEach(ch => ch.classList.add('celebrate-text'));

  launchConfetti({
    mode: 'multiBurst',
    bursts: 4,
    countPerBurst: 220,
    rainTailMs: 1600,
    duration: 5200,
    gravity: 0.38,
    spread: Math.PI * 1.35,
    drag: 0.985,
    palette: getThemePathPalette(),
    mixShapes: true
  });
}

function stopCelebration() {
  document.documentElement.classList.remove('celebrating');
  boardEl.querySelectorAll('.cell .char').forEach(ch => ch.classList.remove('celebrate-text'));
  stopBorderChase();
  stopSolutionChase();
  stopPlayableTileChase();
  stopSolutionLetterChase();
}

function stopAllAnimationsAndAudio() {
  stopCelebration();
  try {
    winSound.pause();
    winSound.currentTime = 0;
  } catch {}
}

async function validateCompletion() {
  for (const [cellKey, expected] of solutionLetters.entries()) {
    const cell = boardEl.querySelector(`.cell[data-coord="${cellKey}"] .char`);
    const actual = (cell?.textContent || '').toUpperCase();
    if (actual !== expected) return;
  }

  showToast('Solved!');

  startCelebration();

  setTimeout(() => {
    launchConfetti({
      mode: 'burst',
      bursts: 1,
      countPerBurst: 180,
      rainTailMs: 900,
      duration: 2600,
      gravity: 0.38,
      spread: Math.PI * 1.25,
      drag: 0.987,
      palette: getThemePathPalette(),
      mixShapes: true
    });
  }, 5000);

  try {
    const soundMs = await getWinSoundDurationSafe(4500);
    const targetMs = Math.max(1200, soundMs - 300);
    const segment = targetMs / 3;

    function timingForSegment(lenMs, baseSpeed = 90) {
      const speedMs = Math.max(50, baseSpeed);
      const approxSteps = Math.max(1, Math.floor(lenMs / speedMs));
      const laps = Math.max(1, Math.round(approxSteps / N));
      return { speedMs, laps };
    }

    const tBorder = timingForSegment(segment * 1.1, 90);
    const tPerim  = timingForSegment(segment * 0.9, 90);
    const tSolve  = timingForSegment(segment * 0.8, 80);

    await startBorderChase({ ...tBorder, tail: 6 });
    await startPlayableTileChase({ ...tPerim, tail: 5 });
    await startSolutionChase({ ...tSolve, tail: 4 });
    await startSolutionLetterChase({ speedMs: 110, laps: 2 });

    setTimeout(stopCelebration, 420);
  } catch (e) {
    if (DEV) console.warn('Celebration animation interrupted', e);
    stopCelebration();
  }
}

function getWinSoundDurationSafe(defaultMs = 4500) {
  if (!isNaN(winSound.duration) && winSound.duration > 0) {
    return Math.floor(winSound.duration * 1000);
  }
  try {
    return new Promise(resolve => {
      const onMeta = () => {
        winSound.removeEventListener('loadedmetadata', onMeta);
        resolve(Math.floor(winSound.duration * 1000));
      };
      winSound.addEventListener('loadedmetadata', onMeta, { once: true });
      setTimeout(() => resolve(defaultMs), 400);
    });
  } catch {
    return defaultMs;
  }
}

function getThemePathPalette() {
  const styles = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 0; i < 5; i++) {
    const v = styles.getPropertyValue(`--path-${i}`).trim();
    if (v) colors.push(v);
  }
  if (colors.length) return colors;
  return ['#68e3ff', '#a78bfa', '#f472b6', '#60a5fa', '#22d3ee'];
}

/* ===== Toast & sizing ===== */
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function fitToViewportByCellSize() {
  if (!wrapper) return;
  const rootStyles = getComputedStyle(document.documentElement);
  const gap = parseFloat(rootStyles.getPropertyValue('--gap')) || 0;

  const availW = wrapper.clientWidth;
  const availH = wrapper.clientHeight;

  const maxCellW = (availW - (N + 1) * gap) / (N + 2);
  const maxCellH = (availH - (N + 1) * gap) / (N + 2);
  const cellSize = Math.floor(Math.min(maxCellW, maxCellH));
  const safeCell = Math.max(1, cellSize);

  document.documentElement.style.setProperty('--cell-size', `${safeCell}px`);
}
function scheduleFitToViewport() { requestAnimationFrame(fitToViewportByCellSize); }
window.addEventListener('resize', scheduleFitToViewport);

/* ===== Click outside to clear selection ===== */
document.addEventListener('click', (evt) => {
  const withinToken = evt.target.closest?.('.token');
  const withinCell = evt.target.closest?.('.cell');
  if (!withinToken && !withinCell) {
    if (selectedTokenId && tokens.has(selectedTokenId)) {
      tokens.get(selectedTokenId).el.classList.remove('selected');
    }
    selectedTokenId = null;
    clearAllowedHighlights();
  }
});

/* ===== Victory overlay ===== */
const victoryOverlay = document.getElementById('victoryOverlay');
const victoryNewGameBtn = document.getElementById('victoryNewGameBtn');

function showVictoryOverlay() {
  if (!victoryOverlay) return;
  victoryOverlay.classList.remove('hidden');
  victoryOverlay.setAttribute('aria-hidden', 'false');
  victoryNewGameBtn?.focus();
}
function hideVictoryOverlay() {
  if (!victoryOverlay) return;
  victoryOverlay.classList.add('hidden');
  victoryOverlay.setAttribute('aria-hidden', 'true');
}
victoryNewGameBtn?.addEventListener('click', async () => {
  hideVictoryOverlay();
  stopConfettiEmission();
  fadeOutConfetti(800);
  stopAllAnimationsAndAudio();
  await resetGame();
});

/* ===== Reset ===== */
async function resetGame() {
  if (DEV) console.log('resetGame: stopping animations and loading new puzzle');
  stopAllAnimationsAndAudio();

  // Return placed tokens to their slots and clear board letters
  for (const [tokenId, tok] of tokens.entries()) {
    if (tok.placed && tok.currentCellKey) {
      const cell = boardEl.querySelector(`.cell[data-coord="${tok.currentCellKey}"]`);
      if (cell) {
        const charEl = cell.querySelector('.char');
        if (charEl) charEl.textContent = '';
        cell.removeAttribute('data-token-id');
        cell.setAttribute('aria-label', `Row ${cell.dataset.r}, Column ${cell.dataset.c}: empty`);
      }
      tok.placed = false;
      tok.currentCellKey = null;
    }
    const slotEl = slotEls.get(tok.slotId);
    if (slotEl) {
      if (!slotEl.contains(tok.el)) slotEl.appendChild(tok.el);
      slotEl.classList.remove('empty');
      slotEl.classList.add('occupied');
      tok.el.classList.remove('selected');
    }
  }

  selectedTokenId = null;
  clearAllowedHighlights();
  hideVictoryOverlay();

  await loadPool();
  await newPuzzle();
}

/* ===== Startup ===== */
await loadPool();
newPuzzle();