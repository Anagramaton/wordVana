// ===============================
// CONFIG
// ===============================
export const MIN_WORD_LEN = 4;
export const MAX_WORD_LEN = 11;
export const WORD_COUNT = 11;

// ===============================
// DATA STRUCTURES
// ===============================
class Cell {
  constructor(r, c, letter) {
    this.r = r;
    this.c = c;
    this.letter = letter;
    this.words = new Set();
  }
}

class Placement {
  constructor(word, dir, cells) {
    this.word = word;
    this.dir = dir; // "H" | "V"
    this.cells = cells; // ordered cells making up this placement (includes overlaps)
  }
}

class Board {
  constructor() {
    this.cells = new Map(); // key "r,c" -> Cell
    this.placements = [];
  }
  key(r, c) { return `${r},${c}`; }
  get(r, c) { return this.cells.get(this.key(r, c)); }
  has(r, c) { return this.cells.has(this.key(r, c)); }
  addCell(cell) { this.cells.set(this.key(cell.r, cell.c), cell); }
}

// ===============================
// ENTRY POINTS (SINGLE-WAVE)
// ===============================

/**
 * Synchronous, guaranteed to return a puzzle.
 * Single-wave outside slot assignment: at most one letter per outside slot.
 *
 * Options:
 * - difficulty: 'easy' | 'balanced' | 'hard'
 * - minWordLen, maxWordLen, wordCount
 */
export function generateFeasiblePuzzle(
  dictionary,
  {
    difficulty = 'balanced',
    minWordLen = MIN_WORD_LEN,
    maxWordLen = MAX_WORD_LEN,
    wordCount = WORD_COUNT,
  } = {}
) {
  for (;;) {
    const words = pickConnectedWords(dictionary, {
      minWordLen, maxWordLen, wordCount
    });
    const overlaps = buildOverlapMap(words);
    const board = new Board();

    placeAnchor(board, words[0]);

    if (!solve(board, words.slice(1), overlaps)) {
      // Try again with a fresh selection
      continue;
    }

    const out = finalize(board); // { grid, letters, words }

    // Single-wave assignment (one letter per outside slot)
    const assignment = assignOutsideSlots(out.grid, out.letters, { difficulty });
    if (!assignment) {
      // Matching failed; fresh attempt (the next selection may match)
      continue;
    }

    out.slotAssignment = assignment;
    return out;
  }
}

/**
 * Async variant with periodic yielding to keep UI responsive.
 * Options mirror generateFeasiblePuzzle plus yieldEvery.
 */
export async function generateFeasiblePuzzleAsync(
  dictionary,
  {
    yieldEvery = 25,
    difficulty = 'balanced',
    minWordLen = MIN_WORD_LEN,
    maxWordLen = MAX_WORD_LEN,
    wordCount = WORD_COUNT,
  } = {}
) {
  let attempts = 0;

  for (;;) {
    attempts++;
    const out = generateFeasiblePuzzle(dictionary, {
      difficulty, minWordLen, maxWordLen, wordCount
    });
    if (out) return { ...out, attempts };
    if (attempts % yieldEvery === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

// ===============================
// OUTSIDE SLOT FEASIBILITY (SINGLE-WAVE)
// ===============================

/**
 * Single-wave perfect matching with difficulty bias.
 * Assigns at most one letter per outside slot.
 *
 * Returns:
 *  {
 *    byCell: Map(cellKey -> { side, index, id }),
 *    bySlot: Map(slotId -> cellKey),
 *    slots: Array<{ id, side, index }>
 *  }
 */
export function assignOutsideSlots(grid, letters, { difficulty = 'balanced' } = {}) {
  const N = grid.length;
  const cells = [...letters.keys()];
  const M = cells.length;

  const slots = [];
  for (let r = 0; r < N; r++) {
    slots.push({ id: `L:${r}`, side: 'L', index: r });
    slots.push({ id: `R:${r}`, side: 'R', index: r });
  }
  for (let c = 0; c < N; c++) {
    slots.push({ id: `T:${c}`, side: 'T', index: c });
    slots.push({ id: `B:${c}`, side: 'B', index: c });
  }
  const K = slots.length;
  if (M > K) return null;

  const slotIndex = new Map();
  slots.forEach((s, i) => slotIndex.set(s.id, i));

  const rowLen = new Array(N).fill(0);
  const colLen = new Array(N).fill(0);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] === 1) { rowLen[r]++; colLen[c]++; }
    }
  }

  function preferredFirstDimension(r, c, i) {
    const rl = rowLen[r], cl = colLen[c];
    if (difficulty === 'hard') return rl >= cl ? 'row' : 'col';
    if (difficulty === 'easy') return rl <= cl ? 'row' : 'col';
    return (i % 2 === 0) ? 'row' : 'col';
  }

  const adj = Array.from({ length: M }, () => []);
  for (let u = 0; u < M; u++) {
    const [rStr, cStr] = cells[u].split(',');
    const r = Number(rStr), c = Number(cStr);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) return null;

    const firstDim = preferredFirstDimension(r, c, u);
    const orderedIds = firstDim === 'row'
      ? [`L:${r}`, `R:${r}`, `T:${c}`, `B:${c}`]
      : [`T:${c}`, `B:${c}`, `L:${r}`, `R:${r}`];

    for (const id of orderedIds) {
      const vi = slotIndex.get(id);
      if (vi !== undefined) adj[u].push(vi);
    }
  }

  const pairU = new Array(M).fill(-1);
  const pairV = new Array(K).fill(-1);
  const dist = new Array(M).fill(0);
  const INF = 1e9;

  function bfs() {
    const q = [];
    for (let u = 0; u < M; u++) {
      if (pairU[u] === -1) { dist[u] = 0; q.push(u); }
      else dist[u] = INF;
    }
    let found = false;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      for (const v of adj[u]) {
        const u2 = pairV[v];
        if (u2 === -1) found = true;
        else if (dist[u2] === INF) { dist[u2] = dist[u] + 1; q.push(u2); }
      }
    }
    return found;
  }

  function dfs(u) {
    for (const v of adj[u]) {
      const u2 = pairV[v];
      if (u2 === -1 || (dist[u2] === dist[u] + 1 && dfs(u2))) {
        pairU[u] = v; pairV[v] = u; return true;
      }
    }
    dist[u] = INF;
    return false;
  }

  let matching = 0;
  while (bfs()) {
    for (let u = 0; u < M; u++) {
      if (pairU[u] === -1 && dfs(u)) matching++;
    }
  }
  if (matching !== M) return null;

  const byCell = new Map();
  const bySlot = new Map();
  for (let u = 0; u < M; u++) {
    const v = pairU[u];
    const slot = slots[v];
    const key = cells[u];
    byCell.set(key, { side: slot.side, index: slot.index, id: slot.id });
    bySlot.set(slot.id, key);
  }
  return { byCell, bySlot, slots };
}

// ===============================
// WORD SELECTION (CONNECTED GRAPH)
// ===============================
function pickConnectedWords(
  dict,
  {
    minWordLen = MIN_WORD_LEN,
    maxWordLen = MAX_WORD_LEN,
    wordCount = WORD_COUNT,
  } = {}
) {
  const pool = shuffle(dict).filter(w => w.length >= minWordLen && w.length <= maxWordLen);
  if (!pool.length) throw new Error('No words in dictionary range');

  const chosen = [pool.pop()];
  while (chosen.length < wordCount && pool.length) {
    const next = pool.find(w => chosen.some(c => sharesLetter(c, w)));
    if (!next) break;
    chosen.push(next);
    pool.splice(pool.indexOf(next), 1);
  }
  if (chosen.length < wordCount) throw new Error('Insufficient overlap');
  return chosen;
}

function sharesLetter(a, b) { return [...a].some(ch => b.includes(ch)); }

// ===============================
// OVERLAP MAP
// ===============================
function buildOverlapMap(words) {
  const map = new Map();
  for (const a of words) {
    map.set(a, new Map());
    for (const b of words) {
      if (a === b) continue;
      const pairs = [];
      for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
          if (a[i] === b[j]) pairs.push({ i, j });
        }
      }
      if (pairs.length) map.get(a).set(b, pairs);
    }
  }
  return map;
}

// ===============================
// INITIAL WORD
// ===============================
function placeAnchor(board, word) {
  const cells = [];
  for (let i = 0; i < word.length; i++) {
    const cell = new Cell(0, i, word[i]);
    cell.words.add(word);
    board.addCell(cell);
    cells.push(cell);
  }
  board.placements.push(new Placement(word, 'H', cells));
}

// ===============================
// BACKTRACKING SOLVER
// ===============================
function solve(board, remaining, overlaps) {
  if (!remaining.length) return true;

  remaining.sort((a, b) => overlapDegree(a, overlaps) - overlapDegree(b, overlaps));
  const word = remaining[0];

  for (const placed of board.placements) {
    const shared = overlaps.get(word)?.get(placed.word);
    if (!shared) continue;

    for (const { i, j } of shared) {
      const dir = placed.dir === 'H' ? 'V' : 'H';
      if (tryPlace(board, word, placed, i, j, dir)) {
        if (solve(board, remaining.slice(1), overlaps)) return true;
        undo(board, word);
      }
    }
  }
  return false;
}

function overlapDegree(word, overlaps) { return overlaps.get(word)?.size ?? 0; }

// ===============================
// PLACEMENT LOGIC
// ===============================
function tryPlace(board, word, base, i, j, dir) {
  const baseCell = base.cells[j];
  const newCells = [];
  for (let k = 0; k < word.length; k++) {
    const r = baseCell.r + (dir === 'V' ? k - i : 0);
    const c = baseCell.c + (dir === 'H' ? k - i : 0);
    const existing = board.get(r, c);

    if (existing) {
      if (existing.letter !== word[k]) return false;
      newCells.push(existing);
    } else {
      if (touchesInvalid(board, r, c, dir)) return false;
      newCells.push(new Cell(r, c, word[k]));
    }
  }

  const startR = dir === 'H' ? baseCell.r : baseCell.r - i;
  const startC = dir === 'H' ? baseCell.c - i : baseCell.c;
  const endR   = dir === 'H' ? baseCell.r : baseCell.r - i + word.length - 1;
  const endC   = dir === 'H' ? baseCell.c - i + word.length - 1 : baseCell.c;
  if (!endCapsClear(board, startR, startC, endR, endC, dir)) return false;

  for (const cell of newCells) {
    cell.words.add(word);
    board.addCell(cell);
  }
  board.placements.push(new Placement(word, dir, newCells));
  return true;
}

function endCapsClear(board, startR, startC, endR, endC, dir) {
  if (dir === 'H') {
    if (board.has(startR, startC - 1)) return false;
    if (board.has(endR, endC + 1)) return false;
  } else {
    if (board.has(startR - 1, startC)) return false;
    if (board.has(endR + 1, endC)) return false;
  }
  return true;
}

// ===============================
// SAFE UNDO (GENERATION-TIME)
// ===============================
function undo(board, word) {
  const placement = board.placements.pop();
  for (const cell of placement.cells) {
    cell.words.delete(word);
    if (cell.words.size === 0) {
      board.cells.delete(`${cell.r},${cell.c}`);
    }
  }
}

// ===============================
// ADJACENCY (DIRECTION-AWARE)
// ===============================
function touchesInvalid(board, r, c, dir) {
  const forbidden =
    dir === 'H'
      ? [[r - 1, c], [r + 1, c]]
      : [[r, c - 1], [r, c + 1]];
  return forbidden.some(([rr, cc]) => board.has(rr, cc));
}

// ===============================
// FINALIZE
// ===============================
function finalize(board) {
  const rs = [...board.cells.values()].map(c => c.r);
  const cs = [...board.cells.values()].map(c => c.c);

  const minR = Math.min(...rs), minC = Math.min(...cs);
  const size = Math.max(...rs) - minR + 1;
  const width = Math.max(...cs) - minC + 1;

  const N = Math.max(size, width);
  const grid = Array.from({ length: N }, () => Array(N).fill(0));
  const letters = new Map();

  for (const cell of board.cells.values()) {
    const r = cell.r - minR;
    const c = cell.c - minC;
    grid[r][c] = 1;
    letters.set(`${r},${c}`, cell.letter);
  }

  const words = [...new Set(board.placements.map(p => p.word))];
  return { grid, letters, words };
}

// ===============================
// UTILS
// ===============================
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }