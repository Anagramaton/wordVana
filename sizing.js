import * as DOM from './dom.js';
import * as State from './state.js';

export function fitToViewportByCellSize() {
  const wrapper = DOM.wrapper;
  if (!wrapper) return;
  const rootStyles = getComputedStyle(document.documentElement);
  const gap = parseFloat(rootStyles.getPropertyValue('--gap')) || 0;

  const N = State.getN();
  const availW = wrapper.clientWidth;
  const availH = wrapper.clientHeight;

  const maxCellW = (availW - (N + 1) * gap) / (N + 2);
  const maxCellH = (availH - (N + 1) * gap) / (N + 2);
  const cellSize = Math.floor(Math.min(maxCellW, maxCellH));
  const safeCell = Math.max(1, cellSize);

  document.documentElement.style.setProperty('--cell-size', `${safeCell}px`);
}

export function scheduleFitToViewport() {
  requestAnimationFrame(fitToViewportByCellSize);
}