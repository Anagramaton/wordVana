import { WORDS } from './words.js';
import { generateFeasiblePuzzle, MIN_WORD_LEN } from './generator.js';

const DEV = true; // set false for production

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
const confettiCanvas = document.getElementById('confetti');
const ctx = confettiCanvas?.getContext('2d');

/* Help modal elements */
const helpBtn = document.getElementById('howToPlayBtn');
const howToModal = document.getElementById('howToPlayModal');
const howToClose = document.getElementById('howToPlayClose');

let confettiParticles = [];
let confettiRunning = false;

function resizeConfetti() {
  if (!confettiCanvas) return;
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfetti);

// Size presets: adjust counts here in code (no UI)
const SIZE_PRESETS = {
  small:  { N: 8,  maxWordLen: 5,  wordCount: 7  },
  medium: { N: 11, maxWordLen: 8, wordCount: 10 },
  large:  { N: 16, maxWordLen: 11, wordCount: 13 }
};

// Persisted size key
let sizeKey = localStorage.getItem('boardSize') || 'large';

// Persisted difficulty
let difficulty = (localStorage.getItem('puzzleDifficulty') || 'balanced');

// Board size target (dynamic)
let TARGET_N = SIZE_PRESETS[sizeKey].N;

// Build dictionary per min/max
function buildDictionary(minLen, maxLen) {
  return WORDS
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= minLen && w.length <= maxLen);
}

// State
let solutionLetters = new Map();
let N = TARGET_N;
let gridRef = [];
let totalFillable = 0;

let slotAssignment = null;
let slotEls = new Map();
let tokens = new Map();
let selectedTokenId = null;

/* UI: Theme and Difficulty (size already exists) */
themeSelect?.addEventListener('change', () => {
  document.documentElement.setAttribute('data-theme', themeSelect.value);
  scheduleFitToViewport();
});

if (sizeSelect) {
  sizeSelect.value = sizeKey;
  sizeSelect.addEventListener('change', () => {
    sizeKey = sizeSelect.value;
    localStorage.setItem('boardSize', sizeKey);
    TARGET_N = SIZE_PRESETS[sizeKey].N;
    newPuzzle();
  });
}

if (difficultySelect) {
  difficultySelect.value = difficulty;
  difficultySelect.addEventListener('change', () => {
    difficulty = difficultySelect.value;
    localStorage.setItem('puzzleDifficulty', difficulty);
    newPuzzle();
  });
}

/* Help modal logic */
function openHowToModal() {
  if (!howToModal) return;
  howToModal.classList.add('open');
  howToModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const title = howToModal.querySelector('#htpTitle');
  title?.focus();
  howToModal.addEventListener('click', backdropClose);
  document.addEventListener('keydown', escClose);
}

function closeHowToModal() {
  if (!howToModal) return;
  howToModal.classList.remove('open');
  howToModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  howToModal.removeEventListener('click', backdropClose);
  document.removeEventListener('keydown', escClose);
  helpBtn?.focus();
}

function backdropClose(e) {
  if (e.target === howToModal) closeHowToModal();
}
function escClose(e) {
  if (e.key === 'Escape') closeHowToModal();
}

helpBtn?.addEventListener('click', openHowToModal);
howToClose?.addEventListener('click', closeHowToModal);

// Build a new guaranteed-feasible puzzle
function newPuzzle() {
  try {
    const preset = SIZE_PRESETS[sizeKey] ?? SIZE_PRESETS.large;
    const minWordLen = MIN_WORD_LEN; // always 4
    const maxWordLen = preset.maxWordLen;
    const wordCount  = preset.wordCount;

    const DICT = buildDictionary(minWordLen, maxWordLen);

    const raw = generatePuzzleWithinSizeGuaranteed(
      DICT,
      preset.N,
      { difficulty, minWordLen, maxWordLen, wordCount }
    );
    const { grid, letters, slotAssignment: slots } = raw;

    const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } =
      padGridToSize(grid, letters, preset.N);

    const shiftedAssignment = shiftSlotAssignmentKeys(slots, padTop, padLeft);

    solutionLetters = shiftedLetters;
    gridRef = paddedGrid;
    N = preset.N;
    TARGET_N = preset.N;
    slotAssignment = shiftedAssignment;

    if (DEV) {
      console.log('Solution placement (cell -> letter):',
        Array.from(solutionLetters.entries()).sort());
      console.log('Outside slot assignment (slotId -> cell):',
        Array.from(slotAssignment.bySlot.entries()).sort());
    }

    renderFrame();
    renderBoard(paddedGrid);
    renderOutsideSlots(N);
    renderTokensFromAssignment(shiftedLetters, shiftedAssignment);

    scheduleFitToViewport();

    // Removed "new puzzle" toast per requirement: only show toast on full completion.
  } catch (e) {
    console.error(e);
    // Removed error toast per requirement.
  }
}

/** Guaranteed: keeps generating until raw grid size <= targetN and is feasible */
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

/**
 * Adjust slotAssignment indices/ids and byCell keys by the pad offsets,
 * and rebuild the slots list so token indices align with the padded board.
 */
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

/* Visual guidance: highlight legal destination cells for a token */
function clearAllowedHighlights() {
  if (!boardEl) return;
  boardEl.querySelectorAll('.cell.allowed').forEach(el => el.classList.remove('allowed'));
}

function previewAllowedForToken(token) {
  clearAllowedHighlights();
  if (!token || token.placed) return;

  const isRow = token.side === 'L' || token.side === 'R';
  const fixedIdx = token.index;

  if (isRow) {
    const r = fixedIdx;
    for (let c = 0; c < N; c++) {
      if (gridRef[r][c] !== 1) continue;
      const el = boardEl.querySelector(`.cell[data-coord="${r},${c}"]`);
      el?.classList.add('allowed');
    }
  } else {
    const c = fixedIdx;
    for (let r = 0; r < N; r++) {
      if (gridRef[r][c] !== 1) continue;
      const el = boardEl.querySelector(`.cell[data-coord="${r},${c}"]`);
      el?.classList.add('allowed');
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
      // Keep highlights if it's the currently selected token
      if (!tok || selectedTokenId === cellKey) return;
      clearAllowedHighlights();
    });

    const slotEl = slotEls.get(info.id);
    if (slotEl) {
      slotEl.classList.remove('occupied');
      slotEl.classList.add('empty');
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
  const cell = e.currentTarget;
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const coord = `${r},${c}`;
  const isFillable = gridRef[r][c] === 1;

  const existingTokenId = cell.dataset.tokenId || null;

  if (existingTokenId) {
    const tok = tokens.get(existingTokenId);
    if (!tok) return;
    const charEl = cell.querySelector('.char');
    if (charEl) charEl.textContent = '';
    cell.removeAttribute('data-token-id');
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: empty`);
    const slotEl = slotEls.get(tok.slotId);
    if (slotEl) {
      slotEl.classList.remove('occupied');
      slotEl.classList.add('empty');
      slotEl.appendChild(tok.el);
    }
    tok.placed = false;
    tok.currentCellKey = null;
    tok.el.classList.remove('selected');

    // If the user just freed a cell, reset selection and highlights
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

// Only feedback: toast on full completion (and confetti). No "incorrect" or other toasts.
function validateCompletion() {
  for (const [cellKey, expected] of solutionLetters.entries()) {
    const cell = boardEl.querySelector(`.cell[data-coord="${cellKey}"] .char`);
    const actual = (cell?.textContent || '').toUpperCase();
    if (actual !== expected) {
      if (DEV) console.log('Mismatch at', cellKey, 'expected:', expected, 'got:', actual);
      return; // no feedback until completely correct
    }
  }
  showToast('Solved!');
  launchConfetti();
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1500);
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

function launchConfetti({
  count = 260,
  duration = 2600,
  gravity = 0.35,
  spread = Math.PI * 1.1,
  drag = 0.985
} = {}) {
  resizeConfetti();
  confettiParticles = [];
  confettiRunning = true;

  const cx = confettiCanvas.width / 2;
  const cy = confettiCanvas.height * 0.4;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * spread - spread / 2;
    const speed = Math.random() * 10 + 8;
    const size = Math.random() * 6 + 4;

    confettiParticles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      w: size,
      h: size * (Math.random() > 0.5 ? 1.6 : 1),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      color: `hsl(${Math.random() * 360}, 90%, 60%)`,
      life: duration,
      maxLife: duration
    });
  }

  let lastTime = performance.now();

  requestAnimationFrame(function tick(t) {
    const delta = t - lastTime;
    lastTime = t;
    const step = delta / 16;

    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

    confettiParticles.forEach(p => {
      p.vy += gravity * step;
      p.vx *= drag;
      p.vy *= drag;

      p.x += p.vx * step;
      p.y += p.vy * step;
      p.rot += p.vr * step;

      p.life -= delta;
      const alpha = Math.max(0, p.life / p.maxLife);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    confettiParticles = confettiParticles.filter(p => p.life > 0);

    if (confettiParticles.length) {
      requestAnimationFrame(tick);
    } else {
      confettiRunning = false;
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  });
}

function scheduleFitToViewport() {
  requestAnimationFrame(fitToViewportByCellSize);
}

window.addEventListener('resize', scheduleFitToViewport);

/* Optional: click empty space to clear selection/highlights */
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

// Initial load
newPuzzle();