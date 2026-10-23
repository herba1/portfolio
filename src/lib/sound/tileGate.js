// Sound belongs to the tile it came from. On the experiments index every
// audio context's output, and every client of the shared bus, passes through
// a gain that follows its tile on screen: full while the tile is in view,
// easing down as it scrolls out, silent once it is gone or the page is
// hidden, and easing back up when it returns. A piece is never told; its
// graph keeps running under the gate.
//
// The tile is the one the visitor last pointed at or typed into when the
// sound began: a context starts running inside a gesture, and the shared
// bus's clients claim their tile on their first unlock or sound.

const TILE = ".xl-tile";
const FADE = 0.12;
// A tile at least this much on screen (of itself, or of the viewport when it
// is taller) plays at full level.
const FULL_AT = 0.5;
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

let installed = false;
let lastTarget = null;
let observer = null;
const watched = new Map();
const gates = new WeakMap();
const shared = new WeakSet();
// Tiles playing their idle demo (TileDemos): heard only once a visitor plays.
const muted = new WeakSet();

const visibleShare = (entry) => {
  if (!entry.isIntersecting) return 0;
  const tall = Math.min(entry.boundingClientRect.height, window.innerHeight) || 1;
  return Math.min(1, entry.intersectionRect.height / tall / FULL_AT);
};

const apply = (state) => {
  const level = document.hidden || muted.has(state.tile) ? 0 : state.level;
  for (const { gain, ctx } of state.gains) {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(level, ctx.currentTime, FADE);
  }
};

const ensureObserver = () => {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const state = watched.get(entry.target);
        if (!state) continue;
        state.level = visibleShare(entry);
        apply(state);
      }
    },
    { threshold: STEPS },
  );
  return observer;
};

export function ownerTile() {
  return lastTarget instanceof Element ? lastTarget.closest(TILE) : null;
}

// Hold `gain` (a GainNode on `ctx`) to `tile`'s place on screen.
export function gateToTile(tile, gain, ctx) {
  if (!tile || !installed) return;
  let state = watched.get(tile);
  if (!state) {
    state = { tile, level: 1, gains: new Set() };
    watched.set(tile, state);
    ensureObserver().observe(tile);
  }
  state.gains.add({ gain, ctx });
  apply(state);
}

export function muteTile(tile, on) {
  if (on) muted.add(tile);
  else muted.delete(tile);
  const state = watched.get(tile);
  if (state) apply(state);
}

// The shared bus routes its own clients; its context's output stays open.
export function markShared(ctx) {
  shared.add(ctx);
}

const onPointer = (event) => {
  lastTarget = event.target;
};
const onVisibility = () => {
  for (const state of watched.values()) apply(state);
};

export function installTileGate() {
  if (installed || typeof window === "undefined") return () => {};
  const Base = window.BaseAudioContext || window.AudioContext;
  const desc = Base && Object.getOwnPropertyDescriptor(Base.prototype, "destination");
  if (!desc?.get) return () => {};
  installed = true;
  const Offline = window.OfflineAudioContext;
  Object.defineProperty(Base.prototype, "destination", {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      const real = desc.get.call(this);
      if (shared.has(this) || (Offline && this instanceof Offline)) return real;
      let gate = gates.get(this);
      if (gate) return gate;
      gate = this.createGain();
      gate.connect(real);
      gates.set(this, gate);
      const claim = () => {
        if (this.state !== "running") return;
        this.removeEventListener("statechange", claim);
        gateToTile(ownerTile(), gate, this);
      };
      this.addEventListener("statechange", claim);
      claim();
      return gate;
    },
  });
  window.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
  window.addEventListener("pointermove", onPointer, { capture: true, passive: true });
  window.addEventListener("keydown", onPointer, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    Object.defineProperty(Base.prototype, "destination", desc);
    installed = false;
    window.removeEventListener("pointerdown", onPointer, { capture: true });
    window.removeEventListener("pointermove", onPointer, { capture: true });
    window.removeEventListener("keydown", onPointer, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
    observer = null;
    watched.clear();
  };
}
