// dom.js — DOM references and helpers, plus settings button/modal control

/* DOM element references */
export const wrapper = document.getElementById('boardWrapper');
export const frameEl = document.getElementById('frame');
export const boardContainer = document.getElementById('board');
export const boardGridEl = document.querySelector('#board .grid');

export const topBorderEl = document.getElementById('topBorder');
export const bottomBorderEl = document.getElementById('bottomBorder');
export const leftBorderEl = document.getElementById('leftBorder');
export const rightBorderEl = document.getElementById('rightBorder');

export const toastEl = document.getElementById('toast');
export const themeSelect = document.getElementById('themeSelect');
export const difficultySelect = document.getElementById('difficultySelect');
export const sizeSelect = document.getElementById('sizeSelect');

/* NEW: daily toggle checkbox (for daily puzzles, uses UTC date) */
export const dailyToggle = document.getElementById('dailyToggle');

export const settingsBtn = document.getElementById('settingsBtn');
export const settingsModal = document.getElementById('settingsModal');
export const settingsClose = document.getElementById('settingsClose');
export const newGameBtn = document.getElementById('newGameBtn');

export const confettiCanvas = document.getElementById('confetti');
export const victoryOverlay = document.getElementById('victoryOverlay');
export const victoryNewGameBtn = document.getElementById('victoryNewGameBtn');

/* Internal slot element map (populated by renderOutsideSlots) */
let slotEls = new Map();
export function getSlotElsMap() { return slotEls; }
export function getSlotEl(id) { return slotEls.get(id); }
export function getBoardEl() { return boardContainer; }

/* ===== Settings button helpers (restore single-file behavior) ===== */
let settingsIdleTimer = null;

export function hideSettingsBtn() {
  settingsBtn?.classList.add('hidden');
}

export function showSettingsBtn() {
  settingsBtn?.classList.remove('hidden');
}

export function scheduleSettingsReturn(delay = 1200) {
  clearTimeout(settingsIdleTimer);
  settingsIdleTimer = setTimeout(showSettingsBtn, delay);
}

export function openSettings() {
  if (!settingsModal) return;
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  // ensure settings panel is visible and button hidden while interacting
  hideSettingsBtn();
}

export function closeSettings() {
  if (!settingsModal) return;
  settingsModal.classList.remove('open');
  settingsModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  scheduleSettingsReturn();
}

/* Modal backdrop click-to-close (click outside content) */
settingsModal?.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

/* Settings close button */
settingsClose?.addEventListener('click', closeSettings);

/* Keyboard: Escape closes settings */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal?.classList.contains('open')) {
    closeSettings();
  }
});

/* ===== Renderers ===== */

export function renderFrame(N) {
  frameEl.style.setProperty('--n', N);
  document.documentElement.style.setProperty('--n', N);
}

export function renderBoard(grid, onCellClick) {
  boardGridEl.innerHTML = '';
  boardGridEl.parentElement.style.setProperty('--n', grid.length);

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      const isCell = grid[r][c] === 1;
      const cell = document.createElement('div');
      cell.className = isCell ? 'cell fillable' : 'cell empty';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.dataset.coord = `${r},${c}`;
      cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}${isCell ? ': empty' : ': blocked'}`);

      if (isCell) {
        const char = document.createElement('div');
        char.className = 'char';
        char.textContent = '';
        cell.appendChild(char);
      }

      if (onCellClick && typeof onCellClick === 'function') {
        cell.addEventListener('click', onCellClick);
      }

      boardGridEl.appendChild(cell);
    }
  }
}

export function renderOutsideSlots(n) {
  topBorderEl.innerHTML = '';
  bottomBorderEl.innerHTML = '';
  leftBorderEl.innerHTML = '';
  rightBorderEl.innerHTML = '';
  slotEls = new Map();

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

/* Allowed highlight clearing helper */
export function clearAllowedHighlights() {
  boardGridEl.querySelectorAll('.cell.allowed').forEach(el => {
    el.classList.remove('allowed', 'path-0', 'path-1', 'path-2', 'path-3', 'path-4');
  });
}

/* Toast and victory overlay helpers */
export function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}
export function showVictoryOverlay() {
  if (!victoryOverlay) return;
  victoryOverlay.classList.remove('hidden');
  victoryOverlay.setAttribute('aria-hidden', 'false');
  victoryNewGameBtn?.focus();
}
export function hideVictoryOverlay() {
  if (!victoryOverlay) return;
  victoryOverlay.classList.add('hidden');
  victoryOverlay.setAttribute('aria-hidden', 'true');
}

/* Utility: returns solution cell elements in solve order based on a solutionLetters Map */
export function getSolutionCellElementsInSolveOrder(solutionLetters) {
  const arr = [];
  for (const [cellKey] of solutionLetters.entries()) {
    const el = boardGridEl.querySelector(`.cell[data-coord="${cellKey}"] .char`);
    if (el) arr.push(el);
  }
  return arr;
}