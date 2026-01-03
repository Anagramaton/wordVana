// Full animations + confetti implementation (copied and adapted from the original single-file app.js).
// Exports celebration orchestration, confetti, and the four chase animations.
// Relies on DOM, State and Audio modules.

import * as DOM from './dom.js';
import * as State from './state.js';
import * as Audio from './audio.js';

let confettiParticles = [];
let confettiRunning = false;
let confettiTicker = null;
let confettiOptionsGlobal = null;
let confettiEmitEnabled = true;
const confettiCanvas = DOM.confettiCanvas;
const confettiCtx = confettiCanvas?.getContext('2d');

function resizeConfetti() {
  if (!confettiCanvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  confettiCanvas.width = Math.floor(window.innerWidth * dpr);
  confettiCanvas.height = Math.floor(window.innerHeight * dpr);
  confettiCanvas.style.width = `${window.innerWidth}px`;
  confettiCanvas.style.height = `${window.innerHeight}px`;
  if (confettiCtx) confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeConfetti);

/* ===== Theme palette helper ===== */
function getThemePathPalette() {
  const styles = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 0; i < 5; i++) {
    const v = styles.getPropertyValue(`--path-${i}`).trim();
    if (v) colors.push(v);
  }
  if (colors.length) return colors;
  return ['#68e3ff', '#a78bfa', '#f472b6', '#60a5fa', '#22d3ee'];
}

/* ===== Confetti system (full implementation) ===== */
function launchConfetti({
  mode = 'burst',
  bursts = 3,
  countPerBurst = 220,
  rainTailMs = 2600,
  duration = 7200,
  gravity = 0.36,
  spread = Math.PI * 1.1,
  drag = 0.997,
  palette = ['#68e3ff', '#a78bfa', '#f472b6', '#60a5fa', '#22d3ee'],
  mixShapes = true
} = {}) {
  confettiEmitEnabled = true;
  resizeConfetti();
  confettiParticles = [];
  confettiRunning = true;
  confettiOptionsGlobal = { gravity, drag, duration };

  const W = confettiCanvas.width / (window.devicePixelRatio || 1);
  const H = confettiCanvas.height / (window.devicePixelRatio || 1);

  const centers = mode === 'multiBurst'
    ? [
        [W * 0.18, H * 0.35],
        [W * 0.5, H * 0.35],
        [W * 0.82, H * 0.35],
        [W * 0.5, H * 0.18]
      ].slice(0, bursts)
    : [[W / 2, H * 0.4]];

  for (const [cx, cy] of centers) {
    if (!confettiEmitEnabled) break;
    spawnBurst({ cx, cy, count: countPerBurst, spread, palette, mixShapes, gravity });
  }

  const rainStart = performance.now();
  const rain = () => {
    const now = performance.now();
    if (!confettiEmitEnabled) return;
    if (now - rainStart > rainTailMs) return;
    spawnBurst({
      cx: Math.random() * W,
      cy: -8,
      count: Math.floor(countPerBurst * 0.18),
      spread: Math.PI * 0.5,
      palette,
      mixShapes,
      downOnly: true,
      gravity
    });
    setTimeout(rain, 140);
  };
  if (rainTailMs > 0 && confettiEmitEnabled) rain();

  const FIXED_DT = 16.6667;
  let accumulator = 0;
  let lastTime = performance.now();

  function updatePhysics(dt) {
    const dtScale = dt / FIXED_DT;
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
      const p = confettiParticles[i];
      p.vy += (gravity * (Math.random() * 0.02 + 0.99)) * dtScale;
      p.vx *= p.drag;
      p.vy *= p.drag;

      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      p.rot += p.vr * dtScale;

      p.life -= dt;
      if (p.life <= 0 || p.y > H + 60) {
        confettiParticles.splice(i, 1);
      }
    }
  }

  function render() {
    if (!confettiCtx) return;
    confettiCtx.clearRect(0, 0, W, H);

    for (const p of confettiParticles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      confettiCtx.save();
      confettiCtx.globalAlpha = alpha;
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rot);
      confettiCtx.fillStyle = p.color;

      if (p.shape === 'circle') {
        confettiCtx.beginPath();
        confettiCtx.arc(0, 0, p.w * 0.5, 0, Math.PI * 2);
        confettiCtx.fill();
      } else if (p.shape === 'triangle') {
        confettiCtx.beginPath();
        confettiCtx.moveTo(-p.w / 2, p.h / 2);
        confettiCtx.lineTo(0, -p.h / 2);
        confettiCtx.lineTo(p.w / 2, p.h / 2);
        confettiCtx.closePath();
        confettiCtx.fill();
      } else {
        const rw = p.w;
        const rh = p.h;
        const r = Math.min(3, rw * 0.15);
        roundRect(confettiCtx, -rw / 2, -rh / 2, rw, rh, r);
        confettiCtx.fill();
      }

      confettiCtx.restore();
    }
  }

  function tick(now) {
    const dt = Math.min(40, now - lastTime);
    lastTime = now;
    accumulator += dt;

    while (accumulator >= FIXED_DT) {
      updatePhysics(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    render();

    if (confettiParticles.length > 0) {
      confettiTicker = requestAnimationFrame(tick);
    } else {
      confettiRunning = false;
      if (confettiTicker) {
        cancelAnimationFrame(confettiTicker);
        confettiTicker = null;
      }
      if (confettiCtx) confettiCtx.clearRect(0, 0, W, H);
    }
  }

  confettiTicker = requestAnimationFrame(tick);

  function spawnBurst({
    cx,
    cy,
    count,
    spread,
    palette,
    mixShapes,
    downOnly = false,
    gravity: g
  }) {
    if (!confettiEmitEnabled) return;
    const baseSpeed = 10;
    const batchSize = Math.max(16, Math.floor(count / 6));
    let created = 0;

    function emitBatch() {
      if (!confettiEmitEnabled) return;
      const toCreate = Math.min(batchSize, count - created);
      for (let i = 0; i < toCreate; i++) {
        const angle = downOnly
          ? (Math.random() * (Math.PI * 0.5)) + Math.PI / 2
          : (Math.random() * spread) - (spread / 2);
        const speed = baseSpeed * (0.6 + Math.random() * 1.4);
        const size = (Math.random() * 7) + 4;
        const w = size;
        const h = size * (0.7 + Math.random() * 1.4);

        const color = palette[Math.floor(Math.random() * palette.length)];
        const shapes = mixShapes ? ['rect', 'circle', 'triangle'] : ['rect'];
        const shape = shapes[Math.floor(Math.random() * shapes.length)];

        const sign = Math.random() > 0.5 ? 1 : -1;
        confettiParticles.push({
          x: cx + (Math.random() - 0.5) * 8,
          y: cy + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.2,
          vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 1.2,
          w,
          h,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.2 * sign,
          color,
          life: duration + (Math.random() * 800 - 200),
          maxLife: duration,
          shape,
          drag: drag * (0.985 + Math.random() * 0.02)
        });

        if (confettiParticles.length > 4000) break;
      }

      created += toCreate;
      if (created < count) {
        requestAnimationFrame(emitBatch);
      }
    }

    requestAnimationFrame(emitBatch);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = r || 0;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

function stopConfettiEmission() {
  confettiEmitEnabled = false;
}

/* Gracefully shorten remaining life */
function fadeOutConfetti(fadeMs = 1500) {
  for (const p of confettiParticles) {
    p.life = Math.min(p.life, fadeMs);
    p.maxLife = Math.min(p.maxLife, fadeMs);
  }
}

/* ===== Border chase (slot border lights) ===== */
let borderChaseRunning = false;
let borderChaseHandle = null;
let borderPromise = null;
let borderResolve = null;

function buildBorderSequence(n) {
  const seq = [];
  for (let c = 0; c < n; c++) seq.push(`T:${c}`);
  for (let r = 0; r < n; r++) seq.push(`R:${r}`);
  for (let c = n - 1; c >= 0; c--) seq.push(`B:${c}`);
  for (let r = n - 1; r >= 0; r--) seq.push(`L:${r}`);
  return seq;
}

function startBorderChase({ speedMs = 90, tail = 6, laps = 2 } = {}) {
  if (borderChaseRunning) return Promise.resolve();
  borderChaseRunning = true;

  const slotEls = DOM.getSlotElsMap();
  const seq = buildBorderSequence(State.getN());
  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  const styles = getComputedStyle(document.documentElement);
  const accentCycle = [];
  for (let i = 0; i < 5; i++) {
    const v = styles.getPropertyValue(`--path-${i}`).trim();
    if (v) accentCycle.push(v);
  }

  let accentIndex = 0;
  const root = document.documentElement;
  const prevAccent = styles.getPropertyValue('--accent');
  const prevAccent2 = styles.getPropertyValue('--accent-2');

  slotEls.forEach(el =>
    el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
  );

  borderPromise = new Promise((resolve) => {
    borderResolve = resolve;

    function applyAccentPair(i) {
      if (!accentCycle.length) return;
      const c0 = accentCycle[i % accentCycle.length];
      const c1 = accentCycle[(i + 1) % accentCycle.length];
      root.style.setProperty('--accent', c0);
      root.style.setProperty('--accent-2', c1);
    }

    const step = () => {
      if (!borderChaseRunning) {
        root.style.setProperty('--accent', prevAccent);
        root.style.setProperty('--accent-2', prevAccent2);

        slotEls.forEach(el =>
          el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
        );
        if (borderResolve) {
          borderResolve();
          borderResolve = null;
          borderPromise = null;
        }
        return;
      }

      applyAccentPair(accentIndex++);
      slotEls.forEach(el =>
        el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
      );

      for (let t = 0; t < tail; t++) {
        const pos = (idx - t + total) % total;
        const id = seq[pos];
        const el = slotEls.get(id);
        if (!el) continue;
        el.classList.add('border-lit');
        if (t === 1) el.classList.add('border-lit-1');
        if (t === 2) el.classList.add('border-lit-2');
        if (t >= 3) el.classList.add('border-lit-3');
      }

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          root.style.setProperty('--accent', prevAccent);
          root.style.setProperty('--accent-2', prevAccent2);

          borderChaseRunning = false;
          slotEls.forEach(el =>
            el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3')
          );
          if (borderResolve) {
            borderResolve();
            borderResolve = null;
            borderPromise = null;
          }
        }, 240);
      }
    };

    let last = performance.now();
    let acc = 0;

    function tick(now) {
      if (!borderChaseRunning) {
        if (borderChaseHandle) {
          cancelAnimationFrame(borderChaseHandle);
          borderChaseHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;
      while (acc >= speedMs) {
        step();
        acc -= speedMs;
      }
      borderChaseHandle = requestAnimationFrame(tick);
      if (!borderChaseRunning && borderChaseHandle) {
        cancelAnimationFrame(borderChaseHandle);
        borderChaseHandle = null;
      }
    }
    borderChaseHandle = requestAnimationFrame(tick);
  });

  return borderPromise;
}

function stopBorderChase() {
  if (!borderChaseRunning) return;
  borderChaseRunning = false;
  if (borderChaseHandle) {
    cancelAnimationFrame(borderChaseHandle);
    borderChaseHandle = null;
  }
  const slotEls = DOM.getSlotElsMap();
  slotEls.forEach(el => {
    el.classList.remove('border-lit', 'border-lit-1', 'border-lit-2', 'border-lit-3');
  });
  if (borderResolve) {
    borderResolve();
    borderResolve = null;
    borderPromise = null;
  }
}

/* ===== Playable perimeter tile chase (cells lit around board edge) ===== */
let tileChaseRunning = false;
let tileChaseHandle = null;
let tilePromise = null;
let tileResolve = null;

function buildPlayablePerimeterSequence() {
  const seq = [];
  const grid = State.getGridRef();
  const N = State.getN();
  if (!grid || !N) return seq;

  // top row L -> R
  for (let c = 0; c < N; c++) if (grid[0][c] === 1) seq.push(`0,${c}`);
  // right col T -> B
  for (let r = 1; r < N; r++) if (grid[r][N - 1] === 1) seq.push(`${r},${N - 1}`);
  // bottom row R -> L
  for (let c = N - 2; c >= 0; c--) if (grid[N - 1][c] === 1) seq.push(`${N - 1},${c}`);
  // left col B -> T
  for (let r = N - 2; r > 0; r--) if (grid[r][0] === 1) seq.push(`${r},0`);
  return seq;
}

function startPlayableTileChase({ speedMs = 90, tail = 5, laps = 2 } = {}) {
  if (tileChaseRunning) return Promise.resolve();
  const seqRaw = buildPlayablePerimeterSequence();
  if (!seqRaw.length) return Promise.resolve();

  const seq = seqRaw.slice().reverse();
  tileChaseRunning = true;

  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  const clearAll = () => {
    DOM.getBoardEl().querySelectorAll('.tile-lit,.tile-lit-1,.tile-lit-2,.tile-lit-3')
      .forEach(el => el.classList.remove('tile-lit','tile-lit-1','tile-lit-2','tile-lit-3'));
  };

  clearAll();

  tilePromise = new Promise((resolve) => {
    tileResolve = resolve;

    const step = () => {
      if (!tileChaseRunning) {
        clearAll();
        if (tileResolve) {
          tileResolve();
          tileResolve = null;
          tilePromise = null;
        }
        return;
      }

      clearAll();

      for (let t = 0; t < tail; t++) {
        const pos = (idx - t + total) % total;
        const key = seq[pos];
        const cell = DOM.getBoardEl().querySelector(`.cell[data-coord="${key}"]`);
        if (!cell) continue;

        cell.classList.add('tile-lit');
        if (t === 1) cell.classList.add('tile-lit-1');
        if (t === 2) cell.classList.add('tile-lit-2');
        if (t >= 3) cell.classList.add('tile-lit-3');
      }

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          tileChaseRunning = false;
          clearAll();
          if (tileResolve) {
            tileResolve();
            tileResolve = null;
            tilePromise = null;
          }
        }, 200);
      }
    };

    let last = performance.now();
    let acc = 0;

    function tick(now) {
      if (!tileChaseRunning) {
        if (tileChaseHandle) {
          cancelAnimationFrame(tileChaseHandle);
          tileChaseHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;
      while (acc >= speedMs) {
        step();
        acc -= speedMs;
      }
      tileChaseHandle = requestAnimationFrame(tick);
      if (!tileChaseRunning && tileChaseHandle) {
        cancelAnimationFrame(tileChaseHandle);
        tileChaseHandle = null;
      }
    }

    tileChaseHandle = requestAnimationFrame(tick);
  });

  return tilePromise;
}

function stopPlayableTileChase() {
  if (!tileChaseRunning) return;
  tileChaseRunning = false;
  if (tileChaseHandle) {
    cancelAnimationFrame(tileChaseHandle);
    tileChaseHandle = null;
  }
  DOM.getBoardEl().querySelectorAll('.tile-lit,.tile-lit-1,.tile-lit-2,.tile-lit-3')
    .forEach(el => el.classList.remove('tile-lit','tile-lit-1','tile-lit-2','tile-lit-3'));
  if (tileResolve) {
    tileResolve();
    tileResolve = null;
    tilePromise = null;
  }
}

/* ===== Solution chase (slot-level) ===== */
let solutionChaseRunning = false;
let solutionChaseHandle = null;
let solutionPromise = null;
let solutionResolve = null;

function buildSolutionSequence() {
  const assignment = State.getSlotAssignment();
  if (!assignment || !assignment.slots) return [];
  const seq = assignment.slots.map(s => `${s.side}:${s.index}`).filter(id => {
    const slotEls = DOM.getSlotElsMap();
    return slotEls.has(id) && assignment.bySlot && assignment.bySlot.has(id);
  });
  return seq;
}

function startSolutionChase({ speedMs = 90, tail = 4, laps = 2 } = {}) {
  if (solutionChaseRunning) return Promise.resolve();
  const seqRaw = buildSolutionSequence();
  if (!seqRaw.length) return Promise.resolve();
  const seq = seqRaw.slice().reverse();
  solutionChaseRunning = true;
  let idx = 0;
  const total = seq.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  const slotEls = DOM.getSlotElsMap();
  slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));

  solutionPromise = new Promise((resolve) => {
    solutionResolve = resolve;

    const step = () => {
      if (!solutionChaseRunning) {
        slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));
        if (solutionResolve) {
          solutionResolve();
          solutionResolve = null;
          solutionPromise = null;
        }
        return;
      }

      slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));

      for (let t = 0; t < tail; t++) {
        const pos = (idx - t + total) % total;
        const id = seq[pos];
        const el = slotEls.get(id);
        if (!el) continue;
        el.classList.add('solution-lit');
        if (t === 1) el.classList.add('solution-lit-1');
        if (t === 2) el.classList.add('solution-lit-2');
      }

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          solutionChaseRunning = false;
          slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));
          if (solutionResolve) {
            solutionResolve();
            solutionResolve = null;
            solutionPromise = null;
          }
        }, 220);
      }
    };

    let last = performance.now();
    let accumulator = 0;

    function tick(now) {
      if (!solutionChaseRunning) {
        if (solutionChaseHandle) {
          cancelAnimationFrame(solutionChaseHandle);
          solutionChaseHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      accumulator += dt;
      while (accumulator >= speedMs) {
        step();
        accumulator -= speedMs;
      }
      solutionChaseHandle = requestAnimationFrame(tick);
      if (!solutionChaseRunning && solutionChaseHandle) {
        cancelAnimationFrame(solutionChaseHandle);
        solutionChaseHandle = null;
      }
    }
    solutionChaseHandle = requestAnimationFrame(tick);
  });

  return solutionPromise;
}

function stopSolutionChase() {
  if (!solutionChaseRunning) return;
  solutionChaseRunning = false;
  if (solutionChaseHandle) {
    cancelAnimationFrame(solutionChaseHandle);
    solutionChaseHandle = null;
  }
  const slotEls = DOM.getSlotElsMap();
  slotEls.forEach(el => el.classList.remove('solution-lit', 'solution-lit-1', 'solution-lit-2'));
  if (solutionResolve) {
    solutionResolve();
    solutionResolve = null;
    solutionPromise = null;
  }
}

/* ===== Solution letter chase (cell-level) ===== */
let solutionLetterRunning = false;
let solutionLetterHandle = null;
let solutionLetterPromise = null;
let solutionLetterResolve = null;

function getSolutionCellElementsInSolveOrder() {
  return DOM.getSolutionCellElementsInSolveOrder(State.getSolutionLetters());
}

function startSolutionLetterChase({ speedMs = 110, laps = 2 } = {}) {
  if (solutionLetterRunning) return Promise.resolve();
  const els = getSolutionCellElementsInSolveOrder();
  if (!els.length) return Promise.resolve();

  solutionLetterRunning = true;
  let idx = 0;
  const total = els.length;
  const totalSteps = total * laps;
  let stepsTaken = 0;

  els.forEach(el => el.classList.remove('solution-letter-chase'));

  solutionLetterPromise = new Promise((resolve) => {
    solutionLetterResolve = resolve;

    const step = () => {
      if (!solutionLetterRunning) {
        els.forEach(el => el.classList.remove('solution-letter-chase'));
        if (solutionLetterResolve) {
          solutionLetterResolve();
          solutionLetterResolve = null;
          solutionLetterPromise = null;
        }
        return;
      }

      els.forEach(el => el.classList.remove('solution-letter-chase'));
      const el = els[idx];
      if (el) el.classList.add('solution-letter-chase');

      idx = (idx + 1) % total;
      stepsTaken++;

      if (stepsTaken >= totalSteps) {
        setTimeout(() => {
          solutionLetterRunning = false;
          els.forEach(e => e.classList.remove('solution-letter-chase'));
          if (solutionLetterResolve) {
            solutionLetterResolve();
            solutionLetterResolve = null;
            solutionLetterPromise = null;
          }
        }, 120);
      }
    };

    let last = performance.now();
    let acc = 0;
    function tick(now) {
      if (!solutionLetterRunning) {
        if (solutionLetterHandle) {
          cancelAnimationFrame(solutionLetterHandle);
          solutionLetterHandle = null;
        }
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;
      while (acc >= speedMs) {
        step();
        acc -= speedMs;
      }
      solutionLetterHandle = requestAnimationFrame(tick);
    }
    solutionLetterHandle = requestAnimationFrame(tick);
  });

  return solutionLetterPromise;
}

function stopSolutionLetterChase() {
  if (!solutionLetterRunning) return;
  solutionLetterRunning = false;
  if (solutionLetterHandle) {
    cancelAnimationFrame(solutionLetterHandle);
    solutionLetterHandle = null;
  }
  const els = getSolutionCellElementsInSolveOrder();
  els.forEach(el => el.classList.remove('solution-letter-chase'));
  if (solutionLetterResolve) {
    solutionLetterResolve();
    solutionLetterResolve = null;
    solutionLetterPromise = null;
  }
}

/* ===== Celebration orchestration / validate completion sequence ===== */

/* startCelebration: plays sound (awaits real playback start) and launches initial confetti.
   Accepts optional confetti override options. */
async function startCelebration(confettiOpts = {}) {
  try { await Audio.playWinSound(); } catch {}
  document.documentElement.classList.add('celebrating');
  DOM.getBoardEl().querySelectorAll('.cell .char').forEach(ch => ch.classList.add('celebrate-text'));

  launchConfetti({
    mode: 'multiBurst',
    bursts: 4,
    countPerBurst: 220,
    rainTailMs: 1600,
    duration: 5200,
    gravity: 0.38,
    spread: Math.PI * 1.35,
    drag: 0.985,
    palette: getThemePathPalette(),
    mixShapes: true,
    ...confettiOpts
  });
}

/* stopCelebration: stops chase highlights and removes celebrate class (does NOT need to be called immediately
   when overlay appears; app.js already stops animations when the player confirms new game). */
function stopCelebration() {
  document.documentElement.classList.remove('celebrating');
  DOM.getBoardEl().querySelectorAll('.cell .char').forEach(ch => ch.classList.remove('celebrate-text'));
  stopBorderChase();
  stopSolutionChase();
  stopPlayableTileChase();
  stopSolutionLetterChase();
}

/* Helper to compute speed/laps to roughly span targetMs for `units` steps. */
function timingForTarget(units, targetMs, baseSpeed = 90) {
  const speedMs = Math.max(50, baseSpeed);
  const approxSteps = Math.max(1, Math.floor(targetMs / speedMs));
  const laps = Math.max(1, Math.round(approxSteps / Math.max(1, units)));
  return { speedMs, laps };
}

/* validateCompletionSequence: show confetti + start chases; show victory overlay when audio ends.
   Animations continue until the player clicks the new-game button. */
export async function validateCompletionSequence() {
  // get sound duration (or fallback) so we can time overlay and confetti
  const soundMs = await Audio.getWinSoundDurationSafe(4500);
  // ensure celebrations are reasonably long; adjust min if desired
  const targetMs = Math.max(3000, soundMs);

  // start celebration and pass confetti options to last approximately targetMs
const particleLifeMs = 5200;
await startCelebration({
  duration: particleLifeMs,
  // huge rainTail so setTimeout loop won't stop until stopConfettiEmission flips the flag
  rainTailMs: Number.POSITIVE_INFINITY,
  countPerBurst: 220,
  bursts: 4,
  mixShapes: true,
  palette: getThemePathPalette()
});

  // cinematic extra burst a bit into the audio (optional)
  setTimeout(() => {
    launchConfetti({
      mode: 'burst',
      bursts: 1,
      countPerBurst: 180,
      rainTailMs: Math.floor(targetMs * 0.25),
      duration: Math.min(4000, Math.floor(targetMs * 0.6)),
      gravity: 0.38,
      spread: Math.PI * 1.25,
      drag: 0.987,
      palette: getThemePathPalette(),
      mixShapes: true
    });
  }, 5000);

  try {
    // compute unit counts for chases and desired timing so they are lively
    const borderUnits = buildBorderSequence(State.getN()).length || (4 * State.getN());
    const perimUnits  = buildPlayablePerimeterSequence().length || Math.max(1, State.getN());
    const solveUnits   = buildSolutionSequence().length || 1;
    const letterUnits  = getSolutionCellElementsInSolveOrder().length || 1;

    const tBorder  = timingForTarget(borderUnits, targetMs, 90);
    const tPerim   = timingForTarget(perimUnits,  targetMs, 90);
    const tSolve   = timingForTarget(solveUnits,   targetMs, 80);
    const tLetters = timingForTarget(letterUnits,  targetMs, 110);

    // Start all chases concurrently and don't await them — they will continue until explicitly stopped.
    // Use very large laps to keep them running; stop functions will halt them when player clicks new game.
    startBorderChase({ ...tBorder, tail: 6, laps: Number.POSITIVE_INFINITY });
    startPlayableTileChase({ ...tPerim, tail: 5, laps: Number.POSITIVE_INFINITY });
    startSolutionChase({ ...tSolve, tail: 4, laps: Number.POSITIVE_INFINITY });
    startSolutionLetterChase({ speedMs: tLetters.speedMs, laps: Number.POSITIVE_INFINITY });

    // Show the victory overlay at the exact end of the audio, but do NOT stop visuals here.
    setTimeout(() => {
      if (typeof DOM.showVictoryOverlay === 'function') {
        DOM.showVictoryOverlay();
      } else if (DOM.victoryOverlay) {
        DOM.victoryOverlay.classList.remove('hidden');
        DOM.victoryOverlay.setAttribute('aria-hidden', 'false');
        DOM.victoryNewGameBtn?.focus();
      }
      // Animations continue until the user clicks the victoryNewGameBtn.
      // app.js already hides the overlay and calls stopConfettiEmission()/stopAllAnimationsAndAudio() when the player clicks.
    }, targetMs);

    // We intentionally do not await chases or auto-stop celebration here.
    return;
  } catch (e) {
    // fallback: show overlay and ensure celebration state reset if something fails
    if (typeof DOM.showVictoryOverlay === 'function') DOM.showVictoryOverlay();
    else if (DOM.victoryOverlay) {
      DOM.victoryOverlay.classList.remove('hidden');
      DOM.victoryOverlay.setAttribute('aria-hidden', 'false');
      DOM.victoryNewGameBtn?.focus();
    }
    // leave animations running — app.js will stop them on user action
    return;
  }
}

/* New: stop everything (animations + confetti + audio) — compatibility function expected by app.js */
export function stopAllAnimationsAndAudio() {
  // stop visual sequences and celebration state
  try { stopCelebration(); } catch (e) { /* ignore */ }

  // stop chases explicitly (stopCelebration already calls these, but call again defensively)
  try { stopBorderChase(); } catch (e) {}
  try { stopSolutionChase(); } catch (e) {}
  try { stopPlayableTileChase(); } catch (e) {}
  try { stopSolutionLetterChase(); } catch (e) {}

  // Halt confetti emission and quickly clear confetti
  try {
    confettiEmitEnabled = false;
    fadeOutConfetti(300);
    if (confettiTicker) {
      cancelAnimationFrame(confettiTicker);
      confettiTicker = null;
    }
    confettiParticles = [];
    confettiRunning = false;
    if (confettiCtx && confettiCanvas) {
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  } catch (e) { /* ignore */ }

  // Try stopping audio through known Audio module APIs (defensive)
  try {
    if (typeof Audio.stopAll === 'function') {
      Audio.stopAll();
    } else if (typeof Audio.stopAllSounds === 'function') {
      Audio.stopAllSounds();
    } else if (typeof Audio.stop === 'function') {
      Audio.stop();
    } else if (typeof Audio.stopAllAudio === 'function') {
      Audio.stopAllAudio();
    }
  } catch (e) {
    // ignore if Audio doesn't implement these
  }
}

/* Exports */
export {
  launchConfetti,
  stopConfettiEmission,
  fadeOutConfetti,
  startBorderChase,
  stopBorderChase,
  startPlayableTileChase,
  stopPlayableTileChase,
  startSolutionChase,
  stopSolutionChase,
  startSolutionLetterChase,
  stopSolutionLetterChase,
  startCelebration,
  stopCelebration,
  getThemePathPalette
};