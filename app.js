import { WORDS } from './words.js';
import { generateFeasiblePuzzle, MIN_WORD_LEN } from './generator.js';

const DEV = true; // set false for production

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

function hideSettingsBtn() {
  settingsBtn?.classList.add('hidden');
}

function showSettingsBtn() {
  settingsBtn?.classList.remove('hidden');
}

function scheduleSettingsReturn(delay = 1200) {
  clearTimeout(settingsIdleTimer);
  settingsIdleTimer = setTimeout(showSettingsBtn, delay);
}

const settingsModal = document.getElementById('settingsModal');
const settingsClose = document.getElementById('settingsClose');

const confettiCanvas = document.getElementById('confetti');
const ctx = confettiCanvas?.getContext('2d');

/* ===== Audio: mobile-safe unlock + format fallback ===== */
function canPlay(type) {
  const a = document.createElement('audio');
  return !!a.canPlayType && a.canPlayType(type) !== '';
}
const winSound = new Audio(
  canPlay('audio/ogg; codecs="vorbis"')
    ? './sounds/win-fanfare.ogg'
    : './sounds/win-fanfare.mp3' // iOS Safari prefers MP3/M4A
);
winSound.preload = 'auto';

let audioReady = false;
function unlockAudio() {
  if (audioReady) return;
  audioReady = true;

  // Resume WebAudio context if needed (Safari)
  try {
    window.__audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (window.__audioCtx.state === 'suspended') {
      window.__audioCtx.resume();
    }
  } catch {}

  // Warm up HTMLAudio silently to satisfy autoplay policies
  winSound.muted = true;
  winSound.play()
    .then(() => {
      winSound.pause();
      winSound.currentTime = 0;
      winSound.muted = false;
    })
    .catch(() => {
      winSound.muted = false;
    });
}
// Use early, gesture-level events rather than 'click'
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

/* ===== Confetti ===== */
let confettiParticles = [];
let confettiRunning = false;
let confettiTicker = null; // animation handle for our fixed-step loop
let confettiOptionsGlobal = null;

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


const SIZE_PRESETS = {
  small:  { N: 8,  maxWordLen: 5,  wordCount: 7  },
  medium: { N: 11, maxWordLen: 8,  wordCount: 10 },
  large:  { N: 16, maxWordLen: 11, wordCount: 15 }
};

// Persisted selections
let sizeKey = localStorage.getItem('boardSize') || 'large';
let difficulty = (localStorage.getItem('puzzleDifficulty') || 'balanced');

// Board size target (dynamic)
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
let solutionLetters = new Map();
let N = TARGET_N;
let gridRef = [];
let totalFillable = 0;

let slotAssignment = null;
let slotEls = new Map();
let tokens = new Map();
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
/* ===== Settings modal ===== */
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

settingsModal?.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal?.classList.contains('open')) {
    closeSettings();
  }
});


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



/* ===== New puzzle: prefer offline pool, fallback to live generator ===== */
async function newPuzzle() {
  try {
    document.body.style.cursor = 'progress';

    const preset = SIZE_PRESETS[sizeKey] ?? SIZE_PRESETS.large;
    const minWordLen = MIN_WORD_LEN; // always 4
    const maxWordLen = preset.maxWordLen;
    const wordCount  = preset.wordCount;

    let out;
    if (pool && pool.puzzles.length) {
      const p = pool.puzzles[poolCursor];
      // advance cursor for next time
      poolCursor = (poolCursor + 1) % pool.puzzles.length;
      localStorage.setItem(poolCursorKey(), String(poolCursor));

      out = {
        grid: p.grid,
        letters: toMap(p.letters),
        words: p.words,
        slotAssignment: {
          byCell: toMap(p.slotAssignment.byCell),
          bySlot: toMap(p.slotAssignment.bySlot),
          slots: p.slotAssignment.slots
        }
      };
    } else {
      // Live generation fallback
      const DICT = buildDictionary(minWordLen, maxWordLen);
      const raw = generatePuzzleWithinSizeGuaranteed(
        DICT,
        preset.N,
        { difficulty, minWordLen, maxWordLen, wordCount }
      );

      // Center-pad if generator produced a smaller grid
      if (raw.grid.length < preset.N) {
        const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } =
          padGridToSize(raw.grid, raw.letters, preset.N);
        const shiftedAssignment = shiftSlotAssignmentKeys(raw.slotAssignment, padTop, padLeft);
        out = { grid: paddedGrid, letters: shiftedLetters, words: raw.words, slotAssignment: shiftedAssignment };
      } else {
        out = raw;
      }
    }

    solutionLetters = out.letters;
    gridRef = out.grid;
    N = preset.N;
    TARGET_N = preset.N;
    slotAssignment = out.slotAssignment;

    if (DEV) {
      console.log('Solution placement (cell -> letter):', Array.from(solutionLetters.entries()).sort());
      console.log('Outside slot assignment (slotId -> cell):', Array.from(slotAssignment.bySlot.entries()).sort());
    }

    renderFrame();
    renderBoard(out.grid);
    renderOutsideSlots(N);
    renderTokensFromAssignment(out.letters, out.slotAssignment);
    scheduleFitToViewport();
  } catch (e) {
    console.error(e);
  } finally {
    document.body.style.cursor = '';
  }
}

/** Generator guard: keeps trying until size fits */
function generatePuzzleWithinSizeGuaranteed(dictionary, targetN, options = {}) {
  for (;;) {
    const out = generateFeasiblePuzzle(dictionary, options);
    if (out.grid.length <= targetN) return out;
  }
}

/** Center-pad to targetN. Returns padTop/Left for assignment shifting. */
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

/** Shift slotAssignment indices/ids by pad offsets */
function shiftSlotAssignmentKeys(assignment, padTop, padLeft) {
  if (!assignment) return null;

  const slots = assignment.slots.map(s => {
    const add = (s.side === 'L' || s.side === 'R') ? padTop : padLeft;
    const index = s.index + add;
    return { id: `${s.side}:${index}`, side: s.side, index };
  });

  const byCell = new Map();
  const bySlot = new Map();

  for (const [key, info] of assignment.byCell.entries()) {
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

  return { byCell, bySlot, slots };
}

/* ===== Renderers ===== */
function renderFrame() {
  frameEl.style.setProperty('--n', N);
  document.documentElement.style.setProperty('--n', N);
}

/** Render board cells */
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

/** Build empty slots on all four borders */
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

/* ===== Visual guidance: highlight legal destination cells ===== */
const PATH_STEPS = 5; // classes path-0..path-4 for highlight cycling

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
      el.classList.add('allowed', `path-${seq % PATH_STEPS}`);
      seq++;
    }
  } else {
    const c = fixedIdx;
    for (let r = 0; r < N; r++) {
      if (gridRef[r][c] !== 1) continue;
      const el = boardEl.querySelector(`.cell[data-coord="${r},${c}"]`);
      if (!el) continue;
      el.classList.add('allowed', `path-${seq % PATH_STEPS}`);
      seq++;
    }
  }
}

/** Create tokens from slot assignment and place them into their slots */
function renderTokensFromAssignment(letters, assignment) {
  tokens.clear();
  selectedTokenId = null;

  for (const [cellKey, letter] of letters.entries()) {
    const info = assignment.byCell.get(cellKey);
    if (!info) continue;

    const tokenEl = document.createElement('div');
    tokenEl.className = 'token';
    tokenEl.textContent = letter;
    tokenEl.dataset.tokenId = cellKey;
    tokenEl.dataset.slotId = info.id;
    tokenEl.dataset.side = info.side;
    tokenEl.dataset.index = String(info.index);

    tokenEl.addEventListener('click', () => selectToken(cellKey));

    // Hover preview (only if not already placed/selected)
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
      // Occupied when a token is present
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

  // Clicking a filled cell returns its token to the slot
  if (existingTokenId) {
    const tok = tokens.get(existingTokenId);
    if (!tok) return;
    const charEl = cell.querySelector('.char');
    if (charEl) charEl.textContent = '';
    cell.removeAttribute('data-token-id');
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: empty`);
    const slotEl = slotEls.get(tok.slotId);
    if (slotEl) {
      // Slot becomes occupied again
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

  // Need a selected token
  if (!selectedTokenId) return;
  const tok = tokens.get(selectedTokenId);
  if (!tok || tok.placed) return;

  if (!isFillable) return;

  const side = tok.side;
  const idx = tok.index;
  const allowed =
    (side === 'L' || side === 'R') ? (r === idx) :
    (side === 'T' || side === 'B') ? (c === idx) : false;

  if (!allowed) return;

  const charEl = cell.querySelector('.char');
  if (charEl) {
    charEl.textContent = tok.letter;
    charEl.classList.remove('placed'); // restart animation if reusing the same cell
    // force reflow to retrigger animation
    // eslint-disable-next-line no-unused-expressions
    charEl.offsetWidth;
    charEl.classList.add('placed');

    cell.dataset.tokenId = tok.id;
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: ${tok.letter}`);
  }

  // Remove token from its slot; slot becomes empty
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

/* ===== Celebration: boosted confetti + UI color party ===== */
function validateCompletion() {
  for (const [cellKey, expected] of solutionLetters.entries()) {
    const cell = boardEl.querySelector(`.cell[data-coord="${cellKey}"] .char`);
    const actual = (cell?.textContent || '').toUpperCase();
    if (actual !== expected) {
      if (DEV) console.log('Mismatch at', cellKey, 'expected:', expected, 'got:', actual);
      return; // only celebrate on perfect completion
    }
  }
  showToast('Solved!');
  startCelebration();
}

/* Read theme palette (fall back if not defined) */
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

/* ===== Border chase animation (lights moving around slots) ===== */
let borderChaseRunning = false;
let borderChaseHandle = null;

function buildBorderSequence(n) {
  const seq = [];
  // top left -> top right
  for (let c = 0; c < n; c++) seq.push(`T:${c}`);
  // right top -> right bottom
  for (let r = 0; r < n; r++) seq.push(`R:${r}`);
  // bottom right -> bottom left
  for (let c = n - 1; c >= 0; c--) seq.push(`B:${c}`);
  // left bottom -> left top
  for (let r = n - 1; r >= 0; r--) seq.push(`L:${r}`);
  return seq;
}

/**
 * startBorderChase:
 * - speedMs: ms per step
 * - tail: tail length for gradient
 * - laps: number of laps to run (2 requested)
 * - returns a Promise that resolves when chase completes
 */
function startBorderChase({ speedMs = 90, tail = 6, laps = 2 } = {}) {
  if (borderChaseRunning) return Promise.resolve();
  borderChaseRunning = true;
  const seq = buildBorderSequence(N);
  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  // clear any previous class
  slotEls.forEach(el => el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3'));

  return new Promise((resolve) => {
    const step = () => {
      // clear previous lit classes (we'll add for current tail)
      slotEls.forEach(el => {
        el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3');
      });

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
        // leave final position lit briefly, then resolve & clear
        setTimeout(() => {
          borderChaseRunning = false;
          slotEls.forEach(el => el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3'));
          resolve();
        }, 220);
      }
    };

    // performance-based scheduler (reduce jitter) with accumulator
    let last = performance.now();
    let accumulator = 0;

    function tick(now) {
      if (!borderChaseRunning) return;
      const dt = now - last;
      last = now;
      accumulator += dt;
      while (accumulator >= speedMs) {
        step();
        accumulator -= speedMs;
      }
      borderChaseHandle = requestAnimationFrame(tick);
      // If we're finished, the promise resolution in step will cancel via borderChaseRunning=false
      if (!borderChaseRunning && borderChaseHandle) {
        cancelAnimationFrame(borderChaseHandle);
        borderChaseHandle = null;
      }
    }
    borderChaseHandle = requestAnimationFrame(tick);
  });
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
}

/* ===== Solution-chase: move a lit "pulse" around only solution slots, opposite direction ===== */
let solutionChaseRunning = false;
let solutionChaseHandle = null;

function buildSolutionSequence() {
  // Use slotAssignment.slots order (which is top->right->bottom->left like buildBorderSequence)
  // but only include those slots that actually have a solution mapping (i.e., tokens/letters)
  if (!slotAssignment || !slotAssignment.slots) return [];
  const seq = slotAssignment.slots.map(s => `${s.side}:${s.index}`).filter(id => slotEls.has(id) && slotAssignment.bySlot.has(id));
  return seq;
}

/**
 * startSolutionChase:
 * - runs in opposite direction to border (so we reverse sequence)
 * - speedMs, tail, laps same semantics
 * - returns a Promise that resolves when done
 */
function startSolutionChase({ speedMs = 90, tail = 4, laps = 2 } = {}) {
  if (solutionChaseRunning) return Promise.resolve();
  const seqRaw = buildSolutionSequence();
  if (!seqRaw.length) return Promise.resolve();
  const seq = seqRaw.slice().reverse(); // opposite direction
  solutionChaseRunning = true;
  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  // clear any previous class
  slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));

  return new Promise((resolve) => {
    const step = () => {
      // clear
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
          resolve();
        }, 220);
      }
    };

    // performance scheduler
    let last = performance.now();
    let accumulator = 0;

    function tick(now) {
      if (!solutionChaseRunning) return;
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
}

/* ===== Improved confetti engine (fixed-timestep physics, smoother rendering, staggered emission) ===== */

/*
  Key improvements to reduce the initial "pop" lag:
  - Spread particle creation across a few animation frames (batch emission)
  - Limit synchronous work per frame
  - Fixed timestep physics to avoid jitter
  - DPR scaling for crispness
*/

function launchConfetti({
  mode = 'burst',           // 'burst' | 'multiBurst'
  bursts = 3,               // number of bursts (multiBurst)
  countPerBurst = 220,      // particles per burst
  rainTailMs = 1200,        // spawn additional particles for this long
  duration = 4200,
  gravity = 0.45,
  spread = Math.PI * 1.1,
  drag = 0.995,
  palette = ['#68e3ff', '#a78bfa', '#f472b6', '#60a5fa', '#22d3ee'],
  mixShapes = true          // rect, circle, triangle
} = {}) {
  resizeConfetti();
  confettiParticles = [];
  confettiRunning = true;
  confettiOptionsGlobal = { gravity, drag, duration };

  // Canvas logical size (CSS pixels)
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

  // We'll spawn bursts but stagger particle creation in small batches per burst
  for (const [cx, cy] of centers) {
    spawnBurst({ cx, cy, count: countPerBurst, spread, palette, mixShapes, gravity });
  }

  // Optional rain tail (small additional emissions from top)
  const rainStart = performance.now();
  const rain = () => {
    const now = performance.now();
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
  if (rainTailMs > 0) rain();

  // Fixed timestep loop
  const FIXED_DT = 16.6667; // ms ~ 60fps
  let accumulator = 0;
  let lastTime = performance.now();

  function updatePhysics(dt) {
    const dtScale = dt / 16.6667;
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
      const p = confettiParticles[i];
      // Integrate velocity
      p.vy += (gravity * (Math.random() * 0.02 + 0.99)) * dtScale; // slight per-particle variance
      p.vx *= p.drag;
      p.vy *= p.drag;

      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      // rotation
      p.rot += p.vr * dtScale;

      // life
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 60) {
        confettiParticles.splice(i, 1);
      }
    }
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // draw in a single pass
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
        // rectangular confetti with slight corner rounding
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
    const dt = Math.min(40, now - lastTime); // clamp to avoid spiral of death
    lastTime = now;
    accumulator += dt;

    // Fixed steps for stable physics
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

  /**
   * spawnBurst now emits particles in small batches across several frames to avoid a heavy synchronous spike.
   * batchSize: how many particles per frame to create
   */
  function spawnBurst({
    cx,
    cy,
    count,
    spread,
    palette,
    mixShapes,
    downOnly = false,
    gravity: g
  }) {
    const baseSpeed = 10;
    const batchSize = Math.max(16, Math.floor(count / 6)); // create in ~6 frames
    let created = 0;

    function emitBatch() {
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

        // Safety cap
        if (confettiParticles.length > 4000) break;
      }

      created += toCreate;
      if (created < count) {
        // schedule next small batch next animation frame to avoid blocking
        requestAnimationFrame(emitBatch);
      }
    }

    // Start emitting across frames
    requestAnimationFrame(emitBatch);
  }

  // Helper for rounded rects
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

/* ===== Celebration orchestration ===== */
async function startCelebration() {
  // Play win sound at celebration start (now safely unlocked)
  winSound.currentTime = 0;
  winSound.play().catch(() => {});

  // Celebration UI class (CSS drives color changes/animations)
  document.documentElement.classList.add('celebrating');

  // Animate all letters subtly even if empty (only visible ones show effect)
  boardEl.querySelectorAll('.cell .char').forEach(ch => {
    ch.classList.add('celebrate-text');
  });

  // Start both chases: border and solution (opposite directions), 2 laps
  const speedMs = 80; // slightly faster for snappier motion
  const laps = 2;

  // Kick off both chases and wait for both to complete so they stop together
  const borderPromise = startBorderChase({ speedMs, tail: 6, laps });
  const solutionPromise = startSolutionChase({ speedMs, tail: 4, laps });

  // Big confetti: multi-burst + rain tail, theme-matched colors
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

  // Wait for both chases to finish and then end celebration shortly after
  await Promise.all([borderPromise, solutionPromise]);

  // Keep the celebrating visuals for just a short moment, then stop
  setTimeout(stopCelebration, 420);
}

function stopCelebration() {
  document.documentElement.classList.remove('celebrating');
  boardEl.querySelectorAll('.cell .char').forEach(ch => {
    ch.classList.remove('celebrate-text');
  });
  stopBorderChase();
  stopSolutionChase();
  // Confetti will self-clear when particles expire
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

/* ===== Sizing ===== */
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

function scheduleFitToViewport() {
  requestAnimationFrame(fitToViewportByCellSize);
}

window.addEventListener('resize', scheduleFitToViewport);

/* ===== Click outside to clear selection/highlights ===== */
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

/* ===== Startup ===== */
await loadPool(); // try to load precomputed puzzles first
newPuzzle();