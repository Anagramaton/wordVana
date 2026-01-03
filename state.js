// Single source of truth for in-memory game state.
// Other modules should use these getters/setters rather than keeping their own copies.

export let solutionLetters = new Map(); // Map cellKey -> letter
export let gridRef = [];                 // 2D array grid
export let N = 0;
export let slotAssignment = null;

// tokens Map: tokenId (cellKey) -> token record { id, letter, side, index, slotId, el, placed, currentCellKey, wave }
const tokens = new Map();

// Waves state
let slotQueues = new Map(); // slotId -> [cellKey,...]
let slotCursor = new Map(); // slotId -> next index to emit
let slotActive = new Map(); // slotId -> current active tokenId shown in slot (cellKey)

// Selection
export let selectedTokenId = null;

/* Solution letters */
export function setSolutionLetters(m) { solutionLetters = new Map(m); }
export function getSolutionLetters() { return solutionLetters; }

/* Grid */
export function setGridRef(g) { gridRef = g; }
export function getGridRef() { return gridRef; }

/* N */
export function setN(n) { N = n; }
export function getN() { return N; }

/* Slot assignment data (byCell / bySlot / slots) */
export function setSlotAssignment(a) { slotAssignment = a; }
export function getSlotAssignment() { return slotAssignment; }

/* Tokens API */
export function setToken(id, obj) { tokens.set(id, obj); }
export function getToken(id) { return tokens.get(id); }
export function deleteToken(id) { tokens.delete(id); }
export function tokensIterator() { return tokens.entries(); }
export function tokensValues() { return tokens.values(); }
export function clearTokens() { tokens.clear(); }

/* Slot queue API */
export function setSlotQueues(raw) {
  if (!raw) { slotQueues = new Map(); return; }
  if (raw instanceof Map) slotQueues = new Map(raw);
  else if (Array.isArray(raw)) slotQueues = new Map(raw);
  else {
    slotQueues = new Map();
    for (const k of Object.keys(raw)) slotQueues.set(k, Array.isArray(raw[k]) ? raw[k].slice() : []);
  }
}
export function getSlotQueues() { return slotQueues; }
export function getSlotQueue(slotId) { return slotQueues.get(slotId) || []; }

/* Cursor API */
export function setSlotCursor(slotId, v) { slotCursor.set(slotId, v); }
export function getSlotCursor(slotId) { return slotCursor.get(slotId) || 0; }

/* Active token API */
export function setSlotActive(slotId, tokenId) { slotActive.set(slotId, tokenId); }
export function getSlotActive(slotId) { return slotActive.get(slotId); }
export function deleteSlotActive(slotId) { slotActive.delete(slotId); }
export function getAllSlotActive() { return slotActive; }

/* Selection */
export function setSelectedTokenId(id) { selectedTokenId = id; }
export function clearSelectedTokenId() { selectedTokenId = null; }
export function getSelectedTokenId() { return selectedTokenId; }
export function clearSelection() { selectedTokenId = null; }

/* Helpers */
export function toMap(entries) {
  const m = new Map();
  for (const [k, v] of entries) m.set(k, v);
  return m;
}

export function normalizeSlotQueues(raw) {
  if (!raw) return new Map();
  if (raw instanceof Map) return new Map(raw);
  if (Array.isArray(raw)) return new Map(raw);
  const m = new Map();
  for (const k of Object.keys(raw)) m.set(k, Array.isArray(raw[k]) ? raw[k].slice() : []);
  return m;
}