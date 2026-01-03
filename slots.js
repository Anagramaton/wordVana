// slots.js
// Slot queue management: emitNextTokenIntoSlot and init of slotQueues
// Uses State for canonical state and Tokens to create token DOM/state.

import * as State from './state.js';
import * as Tokens from './tokens.js';
import * as DOM from './dom.js';

export function initSlotQueues(assignment) {
  // Set the canonical slotQueues Map in state
  State.setSlotQueues(assignment?.slotQueues ?? new Map());

  // Initialize cursors for queues that will have their first element shown already.
  const queues = State.getSlotQueues();
  for (const [slotId, q] of queues.entries()) {
    if (!q || !q.length) continue;
    // next index to emit is 1 because index 0 is already shown
    State.setSlotCursor(slotId, 1);
  }
}

/**
 * Emit the next queued token into a slot (called after placement)
 * - slotId: string like "L:3"
 *
 * Behavior changes:
 * - Skips queue entries whose associated token is already placed (prevents re-emitting duplicates).
 * - Updates the cursor to reflect any skips so queue state remains consistent.
 */
export function emitNextTokenIntoSlot(slotId) {
  const queues = State.getSlotQueues();
  if (!queues || !queues.size) return; // non-wave fallback

  const queue = State.getSlotQueue(slotId) || [];
  let cursor = State.getSlotCursor(slotId) || 0;

  // Advance cursor past any already-placed tokens (these should not be re-emitted)
  while (cursor < queue.length) {
    const maybeKey = queue[cursor];
    const maybeTok = State.getToken(maybeKey);
    if (maybeTok && maybeTok.placed) {
      cursor++;
      continue;
    }
    break;
  }

  // Save the updated cursor (points at first candidate to emit)
  State.setSlotCursor(slotId, cursor);

  // Nothing left in the queue (or all remaining are already placed)
  if (cursor >= queue.length) {
    const slotEl = DOM.getSlotEl(slotId);
    if (slotEl) {
      slotEl.classList.add('empty');
      slotEl.classList.remove('occupied');
    }
    State.deleteSlotActive(slotId);
    return;
  }

  const cellKey = queue[cursor];
  const assignment = State.getSlotAssignment();
  const info = assignment?.byCell?.get(cellKey);
  const letter = State.getSolutionLetters().get(cellKey);

  // advance cursor so next emit uses the next element
  State.setSlotCursor(slotId, cursor + 1);

  if (info && letter) {
    Tokens.createTokenForCell(cellKey, info, letter);
    // createTokenForCell will set slotActive for this slot
  } else {
    // Defensive: if mapping unexpectedly missing, ensure slot is considered empty
    const slotEl = DOM.getSlotEl(slotId);
    if (slotEl) {
      slotEl.classList.add('empty');
      slotEl.classList.remove('occupied');
    }
    State.deleteSlotActive(slotId);
  }
}