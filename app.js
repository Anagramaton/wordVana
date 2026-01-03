import { WORDS } from './words.js';
import { generateFeasiblePuzzle, MIN_WORD_LEN } from './generator.js';

import * as State from './state.js';
import * as DOM from './dom.js';
import * as Tokens from './tokens.js';
import * as Slots from './slots.js';
import * as Anim from './animations.js';
import * as Audio from './audio.js';
import * as Size from './sizing.js';

const DEV = false;

/* Optional base URL for server-hosted daily files (adjust if hosting elsewhere) */
const DAILY_BASE_URL = '/puzzles/daily';

async function loadPool() {
  // attempt to load offline pool (kept minimal here; your prior pool logic can be added)
  // For simplicity we keep the same pool loading approach from original app.js (if you had static JSON pools).
  // If no pool exists, generate via generator.
  // This is a thin wrapper that original app.js used — we keep generation in newPuzzle below.
  return null;
}

function buildDictionary(minLen, maxLen) {
  return WORDS
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= minLen && w.length <= maxLen);
}

const SIZE_PRESETS = {
  small:  { N: 8,  maxWordLen: 5,  wordCount: 7  },
  medium: { N: 11, maxWordLen: 8,  wordCount: 10 },
  large:  { N: 16, maxWordLen: 11, wordCount: 15 }
};

let sizeKey = localStorage.getItem('boardSize') || 'large';
let difficulty = localStorage.getItem('puzzleDifficulty') || 'balanced';

let pool = null;
function poolCursorKey() { return `poolCursor:${sizeKey}:${difficulty}`; }
let poolCursor = Number(localStorage.getItem(poolCursorKey())) || 0;

async function tryLoadPool() {
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

/* ===== UI wiring (settings) ===== */
DOM.settingsBtn?.addEventListener('click', DOM.openSettings);
DOM.settingsClose?.addEventListener('click', DOM.closeSettings);
DOM.settingsModal?.addEventListener('click', (e) => {
  if (e.target === DOM.settingsModal) DOM.closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && DOM.settingsModal?.classList.contains('open')) {
    DOM.closeSettings();
  }
});
DOM.themeSelect?.addEventListener('change', () => {
  document.documentElement.setAttribute('data-theme', DOM.themeSelect.value);
  Size.scheduleFitToViewport();
});
if (DOM.sizeSelect) {
  DOM.sizeSelect.value = sizeKey;
  DOM.sizeSelect.addEventListener('change', async () => {
    sizeKey = DOM.sizeSelect.value;
    localStorage.setItem('boardSize', sizeKey);
    await tryLoadPool();
    await resetGame();
  });
}
if (DOM.difficultySelect) {
  DOM.difficultySelect.value = difficulty;
  DOM.difficultySelect.addEventListener('change', async () => {
    difficulty = DOM.difficultySelect.value;
    localStorage.setItem('puzzleDifficulty', difficulty);
    await tryLoadPool();
    await resetGame();
  });
}
DOM.newGameBtn?.addEventListener('click', async () => {
  DOM.closeSettings();
  await resetGame();
});
DOM.victoryNewGameBtn?.addEventListener('click', async () => {
  DOM.hideVictoryOverlay();
  Anim.stopConfettiEmission();
  Anim.fadeOutConfetti(800);
  Anim.stopAllAnimationsAndAudio();
  await resetGame();
});

/* DAILY MODE: persisted in localStorage and wired to the settings checkbox (UTC) */
const DAILY_PREF_KEY = 'dailyModeEnabled';
if (DOM.dailyToggle) {
  try {
    const stored = localStorage.getItem(DAILY_PREF_KEY);
    DOM.dailyToggle.checked = stored === 'true';
  } catch {}
  DOM.dailyToggle.addEventListener('change', async () => {
    try { localStorage.setItem(DAILY_PREF_KEY, String(DOM.dailyToggle.checked)); } catch {}
    // Re-generate puzzle under the new mode
    await tryLoadPool();
    await resetGame();
  });
}

/* ========= WebAudio preloading + optional playback shim =========
   We fetch the win-fanfare file early (arrayBuffer) but do NOT create or resume an AudioContext
   until a user gesture. Creating/resuming an AudioContext before a gesture triggers browser warnings
   and in some browsers will also fail — so we defer the creation/decoding step to the first gesture.

   Flow:
    - startFetchWinAudioData() fetches the audio bytes and stores them in __audioFetchBuffer.
    - Audio.enableAutoUnlock() registers a one-time silent unlock on first gesture.
    - initWebAudioAndDecode() will be called once on the first gesture to create the AudioContext and decode
      the previously-fetched arrayBuffer (or fetch+decode if fetch didn't finish).
*/

const audioFileBase = './sounds/win-fanfare';
const preferOgg = (() => {
  try {
    const a = document.createElement('audio');
    return !!a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"') !== '';
  } catch {
    return false;
  }
})();

let __audioCtx = null;
let __winAudioBuffer = null;
let __lastWinSource = null;
let __audioFetchBuffer = null;

async function startFetchWinAudioData() {
  try {
    const ext = preferOgg ? '.ogg' : '.mp3';
    const url = `${audioFileBase}${ext}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Audio fetch ${resp.status}`);
    __audioFetchBuffer = await resp.arrayBuffer();
    if (DEV) console.log('Fetched win audio bytes:', __audioFetchBuffer?.byteLength);
  } catch (e) {
    if (DEV) console.warn('Failed to fetch win audio early:', e);
    __audioFetchBuffer = null;
  }
}

async function initWebAudioAndDecode() {
  // If we've already decoded/initialized, no-op
  if (__winAudioBuffer) return;

  try {
    // Create/resume AudioContext now (inside user gesture handler). Creation here avoids the
    // "AudioContext not allowed to start" console warning that happens if created at load.
    __audioCtx = window.__audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    window.__audioCtx = __audioCtx;

    // Use pre-fetched buffer if available, otherwise fetch now.
    let ab = __audioFetchBuffer;
    if (!ab) {
      const ext = preferOgg ? '.ogg' : '.mp3';
      const url = `${audioFileBase}${ext}`;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Audio fetch ${resp.status}`);
      ab = await resp.arrayBuffer();
    }

    // Resume if suspended (must be in user gesture for mobile)
    if (__audioCtx.state === 'suspended') {
      try { await __audioCtx.resume(); } catch {}
    }

    // Decode audio bytes into a WebAudio buffer
    __winAudioBuffer = await new Promise((resolve, reject) => {
      try {
        const p = __audioCtx.decodeAudioData(ab);
        if (p && typeof p.then === 'function') {
          p.then(resolve).catch(reject);
        } else {
          __audioCtx.decodeAudioData(ab, resolve, reject);
        }
      } catch (err) {
        // Fallback to callback version if promise-version throws
        try { __audioCtx.decodeAudioData(ab, resolve, reject); } catch (e) { reject(e); }
      }
    });

    if (DEV) console.log('Decoded WebAudio win buffer, duration ms:', Math.floor(__winAudioBuffer.duration * 1000));

    // Monkey-patch Audio helpers to prefer WebAudio when available (keeps previous behavior)
    if (__winAudioBuffer) {
      const originalPlay = Audio.playWinSound?.bind?.(Audio);
      Audio.playWinSound = async function playViaWebAudio() {
        try {
          if (__audioCtx.state === 'suspended') {
            try { await __audioCtx.resume(); } catch {}
          }
          if (__lastWinSource) {
            try { __lastWinSource.stop(); } catch {}
            __lastWinSource.disconnect?.();
            __lastWinSource = null;
          }
          const src = __audioCtx.createBufferSource();
          src.buffer = __winAudioBuffer;
          src.connect(__audioCtx.destination);
          src.start(0);
          __lastWinSource = src;
          return Promise.resolve();
        } catch (e) {
          if (originalPlay) {
            try { return originalPlay(); } catch { return Promise.resolve(); }
          }
          return Promise.resolve();
        }
      };

      const originalGetDuration = Audio.getWinSoundDurationSafe?.bind?.(Audio);
      Audio.getWinSoundDurationSafe = function getWebAudioDuration(defaultMs = 4500) {
        if (__winAudioBuffer && !isNaN(__winAudioBuffer.duration)) {
          return Promise.resolve(Math.floor(__winAudioBuffer.duration * 1000));
        }
        if (originalGetDuration) return originalGetDuration(defaultMs);
        return Promise.resolve(defaultMs);
      };

      const originalStopAll = Audio.stopAll?.bind?.(Audio) || Audio.stopWinSound?.bind?.(Audio);
      Audio.stopAll = Audio.stopAll || function stopWebAudio() {
        try {
          if (__lastWinSource) {
            __lastWinSource.stop();
            __lastWinSource.disconnect?.();
            __lastWinSource = null;
          }
        } catch {}
        if (originalStopAll) try { originalStopAll(); } catch {}
      };
      Audio.stop = Audio.stop || Audio.stopAll;
      Audio.stopAllSounds = Audio.stopAllSounds || Audio.stopAll;
      Audio.stopAllAudio = Audio.stopAllAudio || Audio.stopAll;
    }
  } catch (e) {
    if (DEV) console.warn('WebAudio preload/decoding failed: ', e);
    // fall back to the audio.js element-based playback (no-op here)
  }
}

/* ===== Audio initialization/unlock notes =====
   - initAudio() primes the <audio> element and requests preload (may download file).
   - unlockAudio() must be called from a user gesture to resume AudioContext on mobile and allow play().
*/
Audio.initAudio();
// Start fetching audio bytes in background (no AudioContext creation yet)
startFetchWinAudioData();

// Register a one-time silent unlock (Audio.enableAutoUnlock will attach gesture listeners)
Audio.enableAutoUnlock();

// Decode into WebAudio buffer only after the first user gesture to avoid the browser warning.
// Use capture+once to ensure it runs early and only once.
document.addEventListener('click', initWebAudioAndDecode, { once: true, capture: true });
document.addEventListener('touchstart', initWebAudioAndDecode, { once: true, capture: true });
document.addEventListener('keydown', initWebAudioAndDecode, { once: true, capture: true });

/* ---------- Daily puzzle helper (UTC daily mode) ---------- */

/* Return YYYY-MM-DD in UTC to use a canonical "day" worldwide */
function utcDateString(date = new Date()) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/* Simple string -> 32-bit hash (deterministic) */
function hashStringToUint32(str) {
  // FNV-1a-ish simple hash (fast & deterministic)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/* Mulberry32 PRNG (returns function that yields 0..1) */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* Serialize slotAssignment and letters (Maps) to plain object for storage */
function serializePuzzleForStorage(out) {
  return {
    grid: out.grid,
    letters: Array.from(out.letters.entries()),
    words: out.words,
    slotAssignment: {
      byCell: Array.from(out.slotAssignment.byCell.entries()),
      bySlot: Array.from(out.slotAssignment.bySlot.entries()),
      slots: out.slotAssignment.slots,
      slotQueues: out.slotAssignment.slotQueues ? Array.from(out.slotAssignment.slotQueues.entries()) : undefined
    }
  };
}

/* Rehydrate stored puzzle into the same structure newPuzzle expects */
function rehydrateStoredPuzzle(serial) {
  return {
    grid: serial.grid,
    letters: new Map(serial.letters),
    words: serial.words,
    slotAssignment: {
      byCell: new Map(serial.slotAssignment.byCell),
      bySlot: new Map(serial.slotAssignment.bySlot),
      slots: serial.slotAssignment.slots,
      slotQueues: serial.slotAssignment.slotQueues ? new Map(serial.slotAssignment.slotQueues) : undefined
    }
  };
}

/* Try to fetch a server-provided daily puzzle JSON and rehydrate to client format.
   Tries baseUrl/default path (set DAILY_BASE_URL constant). */
async function fetchDailyFromServer({ dateStr, sizeKey, difficulty, baseUrl = DAILY_BASE_URL } = {}) {
  const fileName = `${sizeKey}-${difficulty}.json`;
  const url = `${baseUrl}/${dateStr}/${fileName}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (!json?.puzzle) throw new Error('Invalid puzzle payload');
    return rehydrateStoredPuzzle(json.puzzle);
  } catch (err) {
    throw err;
  }
}

/* Generate (or fetch from cache) deterministic daily puzzle (UTC) */
async function generateOrGetDailyPuzzle({ dateStr = utcDateString(), sizeKey, difficulty }) {
  const cacheKey = `dailyPuzzle:${dateStr}:${sizeKey}:${difficulty}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return rehydrateStoredPuzzle(parsed);
      } catch (e) {
        // fall through and regenerate if parse fails
      }
    }
  } catch {}

  // Build a seed string and numeric seed
  const seedStr = `${dateStr}:${sizeKey}:${difficulty}`;
  const seedNum = hashStringToUint32(seedStr);

  // Create seeded RNG and temporarily override Math.random
  const rng = mulberry32(seedNum);
  const originalRandom = Math.random;
  Math.random = rng;

  try {
    const preset = SIZE_PRESETS[sizeKey] ?? SIZE_PRESETS.large;
    const minWordLen = MIN_WORD_LEN;
    const maxWordLen = preset.maxWordLen;
    const wordCount  = preset.wordCount;

    const DICT = buildDictionary(minWordLen, maxWordLen);
    const raw = generatePuzzleWithinSizeGuaranteed(DICT, preset.N, { difficulty, minWordLen, maxWordLen, wordCount });

    let out;
    if (raw.grid.length < preset.N) {
      const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } = padGridToSize(raw.grid, raw.letters, preset.N);
      const shiftedAssignment = shiftSlotAssignmentKeys(raw.slotAssignment, padTop, padLeft);
      out = { grid: paddedGrid, letters: shiftedLetters, words: raw.words, slotAssignment: shiftedAssignment };
    } else {
      out = raw;
    }

    // Save serialized form to localStorage for quick reloads
    try {
      const serial = serializePuzzleForStorage(out);
      localStorage.setItem(cacheKey, JSON.stringify(serial));
    } catch (e) {
      if (DEV) console.warn('Failed storing daily cache', e);
    }

    return out;
  } finally {
    // Restore original Math.random to avoid affecting other code
    Math.random = originalRandom;
  }
}

/* New puzzle orchestration */
async function newPuzzle() {
  try {
    document.body.style.cursor = 'progress';
    const preset = SIZE_PRESETS[sizeKey] ?? SIZE_PRESETS.large;
    const minWordLen = MIN_WORD_LEN;
    const maxWordLen = preset.maxWordLen;
    const wordCount  = preset.wordCount;

    let out;
    const dailyEnabled = DOM.dailyToggle?.checked || false;

    if (dailyEnabled) {
      // Use UTC date string for canonical daily puzzles
      const dateStr = utcDateString();
      // Try server first; fallback to local deterministic generation
      try {
        out = await fetchDailyFromServer({ dateStr, sizeKey, difficulty, baseUrl: DAILY_BASE_URL });
        if (DEV) console.log('Loaded daily puzzle from server:', dateStr, sizeKey, difficulty);
      } catch (err) {
        if (DEV) console.warn('Server daily fetch failed, falling back to local generation:', err);
        out = await generateOrGetDailyPuzzle({ dateStr, sizeKey, difficulty });
      }
    } else if (pool && pool.puzzles?.length) {
      const p = pool.puzzles[poolCursor];
      poolCursor = (poolCursor + 1) % pool.puzzles.length;
      localStorage.setItem(poolCursorKey(), String(poolCursor));
      out = {
        grid: p.grid,
        letters: new Map(p.letters),
        words: p.words,
        slotAssignment: {
          byCell: new Map(p.slotAssignment.byCell),
          bySlot: new Map(p.slotAssignment.bySlot),
          slots: p.slotAssignment.slots,
          slotQueues: p.slotAssignment.slotQueues ? new Map(p.slotAssignment.slotQueues) : undefined
        }
      };
    } else {
      const DICT = buildDictionary(minWordLen, maxWordLen);
      const raw = generatePuzzleWithinSizeGuaranteed(DICT, preset.N, { difficulty, minWordLen, maxWordLen, wordCount });
      if (raw.grid.length < preset.N) {
        // padGridToSize and shiftSlotAssignmentKeys from prior app.js
        const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } = padGridToSize(raw.grid, raw.letters, preset.N);
        const shiftedAssignment = shiftSlotAssignmentKeys(raw.slotAssignment, padTop, padLeft);
        out = { grid: paddedGrid, letters: shiftedLetters, words: raw.words, slotAssignment: shiftedAssignment };
      } else {
        out = raw;
      }
    }

    // set canonical state
    State.setSolutionLetters(out.letters);
    State.setGridRef(out.grid);
    State.setN(preset.N);
    State.setSlotAssignment(out.slotAssignment);

    if (DEV) {
      console.log('Solution placement (cell -> letter):', Array.from(out.letters.entries()).sort());
      console.log('Outside slot assignment (slotId -> cell or queue):', out.slotAssignment);
    }

    DOM.renderFrame(preset.N);
    DOM.renderBoard(out.grid, Tokens.onBoardCellClick);
    DOM.renderOutsideSlots(preset.N);
    Slots.initSlotQueues(out.slotAssignment);
    Tokens.renderTokensFromAssignment(out.letters, out.slotAssignment);
    Size.scheduleFitToViewport();
  } catch (e) {
    console.error('newPuzzle error', e);
  } finally {
    document.body.style.cursor = '';
  }
}

function generatePuzzleWithinSizeGuaranteed(dictionary, targetN, options = {}) {
  for (;;) {
    const out = generateFeasiblePuzzle(dictionary, options);
    if (out.grid.length <= targetN) return out;
  }
}

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

function shiftSlotAssignmentKeys(assignment, padTop, padLeft) {
  if (!assignment) return null;
  const slots = assignment.slots.map(s => {
    const add = (s.side === 'L' || s.side === 'R') ? padTop : padLeft;
    const index = s.index + add;
    return { id: `${s.side}:${index}`, side: s.side, index };
  });

  const byCell = new Map();
  const bySlot = new Map();
  const slotQueues = assignment.slotQueues ? new Map() : undefined;

  for (const [key, info] of assignment.byCell.entries()) {
    const [rStr, cStr] = key.split(',');
    const nr = Number(rStr) + padTop;
    const nc = Number(cStr) + padLeft;
    const newKey = `${nr},${nc}`;

    const add = (info.side === 'L' || info.side === 'R') ? padTop : padLeft;
    const newIndex = info.index + add;
    const newId = `${info.side}:${newIndex}`;

    byCell.set(newKey, { side: info.side, index: newIndex, id: newId, wave: info.wave ?? 0 });
    bySlot.set(newId, newKey);

    if (slotQueues) {
      const qOrig = assignment.slotQueues.get(info.id);
      if (qOrig) {
        const qNew = slotQueues.get(newId) || [];
        qNew.push(newKey);
        slotQueues.set(newId, qNew);
      }
    }
  }
  return { byCell, bySlot, slots, slotQueues };
}

/* Reset game: return tokens and clear board then load new puzzle */
async function resetGame() {
  Anim.stopAllAnimationsAndAudio();

  // Return placed tokens to slots & clear board letters
  for (const [tokenId, tok] of State.tokensIterator()) {
    if (tok.placed && tok.currentCellKey) {
      const cell = DOM.getBoardEl().querySelector(`.cell[data-coord="${tok.currentCellKey}"]`);
      if (cell) {
        const charEl = cell.querySelector('.char');
        if (charEl) charEl.textContent = '';
        cell.removeAttribute('data-token-id');
        cell.setAttribute('aria-label', `Row ${cell.dataset.r}, Column ${cell.dataset.c}: empty`);
      }
      tok.placed = false;
      tok.currentCellKey = null;
    }

    const slotEl = DOM.getSlotEl(tok.slotId);
    if (!slotEl) continue;

    // If no DOM element currently exists for this token, recreate it via Tokens.createTokenForCell
    if (!tok.el) {
      try {
        const info = { id: tok.slotId, side: tok.side, index: tok.index, wave: tok.wave };
        Tokens.createTokenForCell(tok.id, info, tok.letter);
        // createTokenForCell appends the element into the slot and updates State.setToken,
        // so no extra append is needed here.
      } catch (e) {
        if (DEV) console.warn('Failed to recreate token element for', tok.id, e);
      }
      continue;
    }

    // If tok.el exists but isn't a DOM Node (defensive), recreate it.
    if (!(tok.el instanceof Node)) {
      try {
        const info = { id: tok.slotId, side: tok.side, index: tok.index, wave: tok.wave };
        Tokens.createTokenForCell(tok.id, info, tok.letter);
      } catch (e) {
        if (DEV) console.warn('Failed to recreate non-node token.el for', tok.id, e);
      }
      continue;
    }

    // At this point tok.el is a Node. Append only if not already contained in the slot.
    try {
      if (!slotEl.contains(tok.el)) slotEl.appendChild(tok.el);
      try { tok.el.classList.remove('selected'); } catch {}
      slotEl.classList.remove('empty');
      slotEl.classList.add('occupied');
    } catch (e) {
      if (DEV) console.warn('Error appending token element', tok.id, e);
      // attempt a safe recreate as last resort
      try {
        const info = { id: tok.slotId, side: tok.side, index: tok.index, wave: tok.wave };
        Tokens.createTokenForCell(tok.id, info, tok.letter);
      } catch {}
    }
  }

  State.clearSelection();
  DOM.hideVictoryOverlay();

  await tryLoadPool();
  await newPuzzle();
}

/* Startup: try pool then generate */
(async function startup() {
  await tryLoadPool();
  await newPuzzle();
})();