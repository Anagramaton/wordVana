// Audio unlock + safe duration helpers (silent unlock; no audible priming)
//
// - Use enableAutoUnlock() at app init to attach a one-time gesture listener
//   that silently unlocks WebAudio and primes the HTMLAudio element muted.
// - unlockAudio() can also be called from a specific gesture handler.
// - playWinSound() will play the fanfare when you intentionally call it (end of game).
// - No unmuted play() attempts are made during unlock, so players won't hear anything
//   until playWinSound() is invoked.

let winSound = null;
let audioReady = false;

/**
 * Prepare the HTMLAudioElement (safe to call without a gesture).
 */
export function initAudio() {
  if (!winSound) {
    // prefer ogg in asset path selection elsewhere; here just create element
    winSound = new Audio('./sounds/win-fanfare.ogg');
    winSound.preload = 'auto';
  }
}

export function canPlay(type) {
  const a = document.createElement('audio');
  return !!a.canPlayType && a.canPlayType(type) !== '';
}

/**
 * Create or return the shared AudioContext stored on window.
 * Does NOT call resume() here — resume must be called inside a user gesture for browsers.
 */
function getOrCreateAudioContext() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!window.__audioCtx) {
      window.__audioCtx = new AC();
    }
    return window.__audioCtx;
  } catch {
    return null;
  }
}

/**
 * Perform the actual unlocking steps. Should be called from a user gesture handler.
 * This function intentionally avoids any unmuted element.play() attempts so nothing
 * audible will be produced as part of the unlock process.
 */
export function unlockAudio() {
  if (audioReady) return;
  audioReady = true;

  // Ensure HTMLAudio element exists
  if (!winSound) {
    const useOgg = canPlay('audio/ogg; codecs="vorbis"');
    winSound = new Audio(useOgg ? './sounds/win-fanfare.ogg' : './sounds/win-fanfare.mp3');
    winSound.preload = 'auto';
  }

  // 1) Create/resume WebAudio AudioContext and play a tiny silent buffer.
  //    This unlocks the audio graph on iOS and other browsers without sound.
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx) {
      // resume() must run in a gesture to be allowed
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {}); // ignore failure; the silent buffer below still helps on many platforms
      }

      try {
        // tiny silent buffer approach
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
        try { src.stop(ctx.currentTime + 0.01); } catch {}
      } catch {}
    }
  } catch {}

  // 2) Prime HTMLAudio element using a muted play() -> pause() only.
  //    We do NOT attempt an unmuted play here to avoid audible priming.
  try {
    winSound.muted = true;
    const p = winSound.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        try { winSound.pause(); winSound.currentTime = 0; } catch {}
        winSound.muted = false;
      }).catch(() => {
        // If muted play was rejected, we still remove the muted flag so subsequent explicit user gestures can play.
        try { winSound.muted = false; } catch {}
      });
    } else {
      try { winSound.pause(); winSound.currentTime = 0; } catch {}
      winSound.muted = false;
    }
  } catch {
    try { winSound.muted = false; } catch {}
  }
}

/**
 * Attach a one-time set of gesture listeners that call unlockAudio() on the first
 * user gesture (click, touchstart, keydown). Call this from app init so audio is
 * unlocked silently early without changing other code paths.
 *
 * Example: enableAutoUnlock();
 */
export function enableAutoUnlock() {
  const doUnlock = () => {
    try { unlockAudio(); } catch {}
    document.removeEventListener('click', doUnlock, true);
    document.removeEventListener('touchstart', doUnlock, true);
    document.removeEventListener('keydown', doUnlock, true);
  };
  document.addEventListener('click', doUnlock, { once: true, capture: true });
  document.addEventListener('touchstart', doUnlock, { once: true, capture: true });
  document.addEventListener('keydown', doUnlock, { once: true, capture: true });
}

/**
 * Play the win audio. Attempts to resume AudioContext if present.
 * This will produce audible output only when you intentionally call it (e.g. end of game).
 */
export async function playWinSound() {
  if (!winSound) initAudio();

  // Try to resume shared AudioContext if present (may only succeed inside gesture)
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
  } catch {}

  try {
    winSound.currentTime = 0;
    const p = winSound.play();
    if (p && typeof p.then === 'function') {
      // Resolve when playback starts (fulfillment) or swallow rejection but still resolve
      return p.then(() => {}).catch(() => {});
    }
  } catch (e) {
    // swallow; return resolved Promise so callers can await safely
  }
  return Promise.resolve();
}

export function stopWinSound() {
  try {
    if (winSound) {
      winSound.pause();
      try { winSound.currentTime = 0; } catch {}
    }
  } catch {}
}

// Compatibility aliases used by animations.stopAllAnimationsAndAudio()
export function stop() { stopWinSound(); }
export function stopAll() { stopWinSound(); }
export function stopAllSounds() { stopWinSound(); }
export function stopAllAudio() { stopWinSound(); }

export function getWinSoundDurationSafe(defaultMs = 4500) {
  if (!winSound) initAudio();
  if (winSound && !isNaN(winSound.duration) && winSound.duration > 0) {
    return Promise.resolve(Math.floor(winSound.duration * 1000));
  }
  return new Promise(resolve => {
    if (!winSound) return resolve(defaultMs);
    const onMeta = () => {
      try { winSound.removeEventListener('loadedmetadata', onMeta); } catch {}
      if (!isNaN(winSound.duration) && winSound.duration > 0) {
        resolve(Math.floor(winSound.duration * 1000));
      } else {
        resolve(defaultMs);
      }
    };
    try {
      winSound.addEventListener('loadedmetadata', onMeta, { once: true });
    } catch {
      winSound.addEventListener('loadedmetadata', onMeta);
    }
    setTimeout(() => resolve(defaultMs), 1200);
  });
}