// Token lifecycle: create tokens, select, place, return.
// Depends on DOM, State, Slots modules.

import * as DOM from './dom.js';
import * as State from './state.js';
import * as Slots from './slots.js';
import * as Anim from './animations.js';

// createTokenForCell(cellKey, info, letter)
// info: { side, index, id, wave? }
export function createTokenForCell(cellKey, info, letter) {
  // Remove an existing DOM element for same cellKey to avoid duplicates
  const prev = State.getToken(cellKey);
  if (prev && prev.el) {
    try { prev.el.remove(); } catch {}
    // clear dangling DOM reference so we don't try to reuse a removed node elsewhere
    prev.el = null;
  }

  const tokenEl = document.createElement('div');
  tokenEl.className = 'token';
  tokenEl.textContent = letter;
  tokenEl.dataset.tokenId = cellKey;
  tokenEl.dataset.slotId = info.id;
  tokenEl.dataset.side = info.side;
  tokenEl.dataset.index = String(info.index);

  const wave = Number(info.wave ?? 0);
  tokenEl.dataset.wave = String(wave);
  if (wave > 0) tokenEl.classList.add('wave');

  tokenEl.setAttribute('aria-label', `Outside token${wave > 0 ? ` (wave ${wave + 1})` : ''}: ${letter}`);
  tokenEl.setAttribute('role', 'button');
  tokenEl.setAttribute('tabindex', '0');

  tokenEl.addEventListener('click', () => selectToken(cellKey));
  tokenEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectToken(cellKey); } });

  tokenEl.addEventListener('mouseenter', () => {
    const tok = State.getToken(cellKey);
    if (tok && !tok.placed && State.getSelectedTokenId() !== cellKey) previewAllowedForToken(tok);
  });
  tokenEl.addEventListener('mouseleave', () => {
    const tok = State.getToken(cellKey);
    if (!tok || State.getSelectedTokenId() === cellKey) return;
    DOM.clearAllowedHighlights();
  });

  const slotEl = DOM.getSlotEl(info.id);
  if (slotEl) {
    slotEl.classList.remove('empty');
    slotEl.classList.add('occupied');
    slotEl.appendChild(tokenEl);
    State.setSlotActive(info.id, cellKey);
  }

  State.setToken(cellKey, {
    id: cellKey,
    letter,
    side: info.side,
    index: info.index,
    slotId: info.id,
    el: tokenEl,
    placed: false,
    currentCellKey: null,
    wave
  });

  return tokenEl;
}

/* previewAllowedForToken: highlight legal cells for a token */
export function previewAllowedForToken(token) {
  DOM.clearAllowedHighlights();
  if (!token || token.placed) return;

  const grid = State.getGridRef();
  const isRow = token.side === 'L' || token.side === 'R';
  const fixedIdx = token.index;
  let seq = 0;
  if (isRow) {
    const r = fixedIdx;
    for (let c = 0; c < State.getN(); c++) {
      if (grid[r][c] !== 1) continue;
      const el = DOM.getBoardEl().querySelector(`.cell[data-coord="${r},${c}"]`);
      if (!el) continue;
      el.classList.add('allowed', `path-${seq % 5}`);
      seq++;
    }
  } else {
    const c = fixedIdx;
    for (let r = 0; r < State.getN(); r++) {
      if (grid[r][c] !== 1) continue;
      const el = DOM.getBoardEl().querySelector(`.cell[data-coord="${r},${c}"]`);
      if (!el) continue;
      el.classList.add('allowed', `path-${seq % 5}`);
      seq++;
    }
  }
}

/* Token selection */
export function selectToken(tokenId) {
  // clear previous
  const prevSel = State.getSelectedTokenId();
  if (prevSel && State.getToken(prevSel)) {
    try { State.getToken(prevSel).el.classList.remove('selected'); } catch {}
  }
  State.setSelectedTokenId(tokenId);
  const t = State.getToken(tokenId);
  if (t && !t.placed) {
    // guard: t.el may be null in rare races; only add class if element exists
    try { t.el.classList.add('selected'); } catch {}
    previewAllowedForToken(t);
  } else {
    DOM.clearAllowedHighlights();
  }
}

/* Centralized routine to return a token to its slot */
export function returnTokenToSlot(tok) {
  const slotEl = DOM.getSlotEl(tok.slotId);
  if (!slotEl) return;

  if (State.getSlotQueues().size) {
    const activeId = State.getSlotActive(tok.slotId);
    if (activeId && activeId !== tok.id) {
      const activeTok = State.getToken(activeId);
      if (activeTok) {
        try { activeTok.el?.remove(); } catch {}
        activeTok.el = null;
        // Instead of blindly decrementing the cursor, try to set cursor to the index
        // of the removed active token in the slot queue so emitNextTokenIntoSlot can
        // re-emit that exact queued entry later. Fallback to earlier decrement behavior.
        const queue = State.getSlotQueue(tok.slotId) || [];
        const idx = queue.indexOf(activeTok.id);
        if (idx !== -1) {
          State.setSlotCursor(tok.slotId, idx);
        } else {
          const cur = State.getSlotCursor(tok.slotId) || 0;
          State.setSlotCursor(tok.slotId, Math.max(0, cur - 1));
        }
      }
    }
    State.setSlotActive(tok.slotId, tok.id);
  }

  slotEl.classList.remove('empty');
  slotEl.classList.add('occupied');

  // If the token has no DOM element (e.g. was removed on placement), recreate it so the user sees it back in the slot.
  if (!tok.el) {
    const info = { id: tok.slotId, side: tok.side, index: tok.index, wave: tok.wave };
    // createTokenForCell will append the new element into the slot and update state.
    createTokenForCell(tok.id, info, tok.letter);
    // refresh tok from state in case createTokenForCell replaced the record
    tok = State.getToken(tok.id) || tok;
  } else if (!slotEl.contains(tok.el)) {
    slotEl.appendChild(tok.el);
  }

  tok.placed = false;
  tok.currentCellKey = null;
  try { tok.el?.classList.remove('selected'); } catch {}
  State.setToken(tok.id, tok);
}

/* Handler when a board cell is clicked */
export function onBoardCellClick(e) {
  const cell = e.currentTarget;
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const coord = `${r},${c}`;
  const grid = State.getGridRef();
  const isFillable = grid[r][c] === 1;

  const existingTokenId = cell.dataset.tokenId || null;

  if (existingTokenId) {
    const tok = State.getToken(existingTokenId);
    if (!tok) return;
    const charEl = cell.querySelector('.char');
    if (charEl) charEl.textContent = '';
    cell.removeAttribute('data-token-id');
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: empty`);
    returnTokenToSlot(tok);
    State.clearSelectedTokenId();
    DOM.clearAllowedHighlights();
    return;
  }

  const selectedId = State.getSelectedTokenId();
  if (!selectedId) return;
  const tok = State.getToken(selectedId);
  if (!tok || tok.placed) return;
  if (!isFillable) return;

  const side = tok.side;
  const idx = tok.index;
  const allowed = (side === 'L' || side === 'R') ? (r === idx) : (side === 'T' || side === 'B') ? (c === idx) : false;
  if (!allowed) return;

  const charEl = cell.querySelector('.char');
  if (charEl) {
    charEl.textContent = tok.letter;
    charEl.classList.remove('placed');
    // force reflow to retrigger animation
    charEl.offsetWidth;
    charEl.classList.add('placed');

    cell.dataset.tokenId = tok.id;
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}: ${tok.letter}`);
  }

  if (tok.el && tok.el.parentElement) {
    // remove selected class if present before removing element
    try { tok.el.classList.remove('selected'); } catch {}
    tok.el.parentElement.classList.remove('occupied');
    tok.el.parentElement.classList.add('empty');
    try { tok.el.remove(); } catch {}
    // mark that the outside DOM element is gone (prevents dangling ref / duplicate creates)
    tok.el = null;
  }

  // IMPORTANT: clear slot active for this slot so emitNextTokenIntoSlot can repopulate properly
  State.deleteSlotActive(tok.slotId);

  tok.placed = true;
  tok.currentCellKey = coord;
  State.setToken(tok.id, tok);
  State.clearSelectedTokenId();

  DOM.clearAllowedHighlights();

  // Emit next for this slot
  Slots.emitNextTokenIntoSlot(tok.slotId);

  // After placing a token, check completion
  if (allTokensPlaced()) {
    try { Anim.validateCompletionSequence(); } catch {}
  }
}

/* Called by orchestrator when building tokens initially */
export function renderTokensFromAssignment(letters, assignment) {
  // clear existing tokens in state (but DOM will be re-rendered by dom.renderOutsideSlots)
  for (const [id] of State.tokensIterator()) State.deleteToken(id);
  State.clearSelectedTokenId();

  State.setSlotQueues(assignment?.slotQueues ?? new Map());

  const queues = State.getSlotQueues();
  if (queues && queues.size) {
    for (const [slotId, q] of queues.entries()) {
      if (!q.length) continue;
      const first = q[0];
      const info = assignment.byCell.get(first);
      const letter = letters.get(first);
      State.setSlotCursor(slotId, 1);
      createTokenForCell(first, info, letter);
    }
  } else {
    for (const [cellKey, letter] of letters.entries()) {
      const info = assignment.byCell.get(cellKey);
      if (!info) continue;
      createTokenForCell(cellKey, info, letter);
    }
  }
}

/* Helper: check all tokens are placed (used for completion) */
export function allTokensPlaced() {
  for (const [, tok] of State.tokensIterator()) {
    if (!tok.placed) return false;
  }
  return true;
}