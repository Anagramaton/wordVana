// Offline puzzle generator: saves pools under ./puzzles/pool-<size>-<difficulty>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORDS } from '../words.js';
import { generateFeasiblePuzzle, MIN_WORD_LEN } from '../generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Match your app presets
const SIZE_PRESETS = {
  small:  { N: 8,  maxWordLen: 5,  wordCount: 7  },
  medium: { N: 11, maxWordLen: 8, wordCount: 10 },
  large:  { N: 16, maxWordLen: 11, wordCount: 13 }
};

// CLI args
const args = new Map(
  process.argv.slice(2).map((v) => {
    const [k, val] = v.startsWith('--') ? [v, true] : [null, v];
    return [k ?? val, true];
  })
);

function getArgValue(flag, fallback = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const all = args.has('--all');
const sizeKey = getArgValue('--size', 'large'); // small|medium|large
const difficulty = getArgValue('--difficulty', 'balanced'); // easy|balanced|hard
const count = Number(getArgValue('--count', '50')) || 50;

// Build dictionary per min/max
function buildDictionary(minLen, maxLen) {
  return WORDS
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= minLen && w.length <= maxLen);
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

function serializeMap(map) {
  return Array.from(map.entries());
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function savePool(sizeKey, difficulty, preset, puzzles) {
  const dir = path.resolve(__dirname, '../puzzles');
  ensureDir(dir);

  const file = path.join(dir, `pool-${sizeKey}-${difficulty}.json`);

  let existing = [];
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(prev.puzzles)) {
        existing = prev.puzzles;
      }
    } catch {}
  }

  const merged = existing.concat(puzzles);

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sizeKey,
      difficulty,
      N: preset.N,
      count: merged.length
    },
    puzzles: merged
  };

  fs.writeFileSync(file, JSON.stringify(payload));
  console.log(`Saved ${puzzles.length} new puzzles (${merged.length} total) to ${path.relative(process.cwd(), file)}`);
}


function generateBatch(sizeKey, difficulty, count) {
  const preset = SIZE_PRESETS[sizeKey];
  if (!preset) throw new Error(`Unknown size: ${sizeKey}`);

  const minWordLen = MIN_WORD_LEN;
  const maxWordLen = preset.maxWordLen;
  const wordCount  = preset.wordCount;
  const DICT = buildDictionary(minWordLen, maxWordLen);

  const out = [];
  for (let i = 0; i < count; i++) {
    const raw = generatePuzzleWithinSizeGuaranteed(DICT, preset.N, { difficulty, minWordLen, maxWordLen, wordCount });
    const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } =
      padGridToSize(raw.grid, raw.letters, preset.N);
    const shiftedAssignment = shiftSlotAssignmentKeys(raw.slotAssignment, padTop, padLeft);

    out.push({
      N: preset.N,
      grid: paddedGrid,
      letters: serializeMap(shiftedLetters),
      slotAssignment: {
        byCell: serializeMap(shiftedAssignment.byCell),
        bySlot: serializeMap(shiftedAssignment.bySlot),
        slots: shiftedAssignment.slots
      },
      words: raw.words
    });
    if ((i + 1) % 5 === 0) {
      console.log(`[${sizeKey}/${difficulty}] ${i + 1}/${count} generated`);
    }
  }

  savePool(sizeKey, difficulty, preset, out);
}

(async function main() {
  if (all) {
    for (const size of Object.keys(SIZE_PRESETS)) {
      for (const diff of ['easy', 'balanced', 'hard']) {
        generateBatch(size, diff, count);
      }
    }
  } else {
    generateBatch(sizeKey, difficulty, count);
  }
})();