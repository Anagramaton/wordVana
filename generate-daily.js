#!/usr/bin/env node
/**
 * generate-daily.js
 *
 * Usage:
 *  node generate-daily.js                 # generate today's UTC daily files (one date)
 *  node generate-daily.js --date 2026-01-03
 *  node generate-daily.js --date 2026-01-03 --out ./puzzles/daily
 *  node generate-daily.js --days 7        # generate for today + next 6 days
 *
 * Output:
 *  ./puzzles/daily/YYYY-MM-DD/<size>-<difficulty>.json
 *
 * Notes:
 *  - This script imports ./generator.js and ./words.js and temporarily overrides Math.random
 *    with the same mulberry32 seeded RNG used by the client, so the output will match
 *    client-side deterministic generation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFeasiblePuzzle, MIN_WORD_LEN } from './generator.js';
import { WORDS } from './words.js';

// ------------ Configs (kept in sync with client) ----------------
const SIZE_PRESETS = {
  small:  { N: 8,  maxWordLen: 5,  wordCount: 7  },
  medium: { N: 11, maxWordLen: 8,  wordCount: 10 },
  large:  { N: 16, maxWordLen: 11, wordCount: 15 }
};
const DIFFICULTIES = ['easy', 'balanced', 'hard'];
// -----------------------------------------------------------------

// Helpers
function utcDateString(date = new Date()) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function hashStringToUint32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function ensureDirSync(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function buildDictionary(minLen, maxLen) {
  return WORDS
    .map(w => String(w).trim())
    .filter(Boolean)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= minLen && w.length <= maxLen);
}

// Pad grid to size and shift letter coordinates (identical logic to client app.js)
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

// Serialize Maps into arrays for JSON
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

// generatePuzzleWithinSizeGuaranteed (same logic as client)
function generatePuzzleWithinSizeGuaranteed(dictionary, targetN, options = {}) {
  for (;;) {
    const out = generateFeasiblePuzzle(dictionary, options);
    if (out.grid.length <= targetN) return out;
  }
}

// CLI parsing (very small, no deps)
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    date: null,   // YYYY-MM-DD
    days: 1,
    outDir: './puzzles/daily'
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--date' && args[i+1]) { out.date = args[++i]; }
    else if (a === '--days' && args[i+1]) { out.days = Number(args[++i]) || 1; }
    else if (a === '--out' && args[i+1]) { out.outDir = args[++i]; }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node generate-daily.js [--date YYYY-MM-DD] [--days N] [--out ./puzzles/daily]');
      process.exit(0);
    }
  }
  return out;
}

// Main
(async function main() {
  const { date, days, outDir } = parseArgs();
  const startDateStr = date || utcDateString();
  const startDate = new Date(startDateStr + 'T00:00:00Z');
  if (Number.isNaN(startDate.getTime())) {
    console.error('Invalid --date value. Use YYYY-MM-DD (UTC).');
    process.exit(2);
  }

  const rootDir = path.resolve(process.cwd(), outDir);
  ensureDirSync(rootDir);

  // For each requested day
  for (let d = 0; d < Math.max(1, days); d++) {
    const cur = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
    const dateStr = utcDateString(cur);
    const dateDir = path.join(rootDir, dateStr);
    ensureDirSync(dateDir);

    console.log(`Generating puzzles for ${dateStr} -> ${dateDir}`);

    for (const sizeKey of Object.keys(SIZE_PRESETS)) {
      const preset = SIZE_PRESETS[sizeKey];
      for (const difficulty of DIFFICULTIES) {
        const seedStr = `${dateStr}:${sizeKey}:${difficulty}`;
        const seedNum = hashStringToUint32(seedStr);

        // Override Math.random temporarily
        const originalRandom = Math.random;
        Math.random = mulberry32(seedNum);

        try {
          const DICT = buildDictionary(MIN_WORD_LEN, preset.maxWordLen);
          const raw = generatePuzzleWithinSizeGuaranteed(DICT, preset.N, { difficulty, minWordLen: MIN_WORD_LEN, maxWordLen: preset.maxWordLen, wordCount: preset.wordCount });

          let out;
          if (raw.grid.length < preset.N) {
            const { grid: paddedGrid, letters: shiftedLetters, padTop, padLeft } = padGridToSize(raw.grid, raw.letters, preset.N);
            const shiftedAssignment = shiftSlotAssignmentKeys(raw.slotAssignment, padTop, padLeft);
            out = { grid: paddedGrid, letters: shiftedLetters, words: raw.words, slotAssignment: shiftedAssignment };
          } else {
            out = raw;
          }

          const serial = serializePuzzleForStorage(out);
          const fileName = `${sizeKey}-${difficulty}.json`;
          const filePath = path.join(dateDir, fileName);

          const payload = {
            meta: {
              date: dateStr,
              sizeKey,
              difficulty,
              seedStr,
              seedNum,
              generatedAt: new Date().toISOString()
            },
            puzzle: serial
          };

          fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
          console.log(`  ✔ ${fileName} (seed=${seedNum})`);
        } catch (err) {
          console.error(`  ✖ Error generating ${sizeKey}-${difficulty} for ${dateStr}:`, err);
        } finally {
          Math.random = originalRandom;
        }
      }
    }
  }

  console.log('Done.');
})();