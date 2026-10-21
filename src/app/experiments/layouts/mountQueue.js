"use client";

// Mounting a piece is the one expensive moment on the index: a chunk is
// parsed, a component tree commits, a WebGL context comes up and a shader
// compiles. Tearing one down is nearly as dear — losing a context is a
// synchronous round trip to the GPU process. Two of either in one frame is a
// dropped frame, so every mount and every eviction waits its turn here: one
// per idle slot, never while the page is moving, the tile nearest the middle
// of the screen first.
//
// Pieces that have mounted stay mounted (each pauses itself offscreen) until
// more than BUDGET are alive; then the farthest one that is not near the
// viewport is evicted. Scrolling back over a tile you just saw costs nothing,
// and a phone never holds more GPU contexts than it can keep.

const SCROLL_QUIET_MS = 140;

const jobs = new Set();
const alive = new Set();
let scheduled = false;
let lastScroll = -Infinity;

const isBrowser = typeof window !== "undefined";

const idle =
  isBrowser && "requestIdleCallback" in window
    ? (fn) => window.requestIdleCallback(fn, { timeout: 400 })
    : (fn) => setTimeout(fn, 16);

if (isBrowser) {
  window.addEventListener(
    "scroll",
    () => {
      lastScroll = performance.now();
    },
    { passive: true, capture: true },
  );
}

function budget() {
  // Coarse pointers are phones and tablets: smaller GPU, a stricter context
  // cap, and a stacked layout where few tiles share the screen.
  return window.matchMedia("(pointer: coarse)").matches ? 5 : 10;
}

function distance(element) {
  const rect = element.getBoundingClientRect();
  const mid = window.innerHeight / 2;
  if (rect.bottom > 0 && rect.top < window.innerHeight) return Math.abs((rect.top + rect.bottom) / 2 - mid) - 1e6;
  return Math.min(Math.abs(rect.top - mid), Math.abs(rect.bottom - mid));
}

function nextEviction() {
  if (alive.size <= budget()) return null;
  let worst = null;
  let worstDistance = -Infinity;
  for (const entry of alive) {
    if (entry.near()) continue;
    const d = distance(entry.element);
    if (d > worstDistance) {
      worst = entry;
      worstDistance = d;
    }
  }
  return worst;
}

function nextMount() {
  let best = null;
  let bestDistance = Infinity;
  for (const job of jobs) {
    if (!job.ready) continue;
    const d = distance(job.element);
    if (d < bestDistance) {
      best = job;
      bestDistance = d;
    }
  }
  return best;
}

function pending() {
  return nextEviction() || [...jobs].some((job) => job.ready);
}

function pump(deadline) {
  scheduled = false;
  const quietFor = performance.now() - lastScroll;
  if (quietFor < SCROLL_QUIET_MS) {
    scheduled = true;
    setTimeout(() => requestAnimationFrame(() => idle(pump)), SCROLL_QUIET_MS - quietFor);
    return;
  }
  // A frame that already has little idle time left gets nothing heavy.
  if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 8) {
    schedule();
    return;
  }
  const evict = nextEviction();
  if (evict) {
    alive.delete(evict);
    evict.evict();
  } else {
    const job = nextMount();
    if (job) {
      jobs.delete(job);
      job.run();
    }
  }
  if (pending()) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => idle(pump));
}

// Queue a mount: `load` fetches the chunk, `run` mounts once it has arrived
// and it is this tile's turn. Returns a cancel for a tile that leaves before
// its turn comes — a flick past twenty tiles mounts none of them.
export function enqueueMount(element, load, run) {
  const job = { element, ready: false, run };
  jobs.add(job);
  Promise.resolve(load()).finally(() => {
    if (!jobs.has(job)) return;
    job.ready = true;
    schedule();
  });
  return () => jobs.delete(job);
}

// Register a mounted piece. `near` says whether it must stay, `evict`
// unmounts it. Returns a release for when the tile itself goes away.
export function retain(element, near, evict) {
  const entry = { element, near, evict };
  alive.add(entry);
  if (alive.size > budget()) schedule();
  return () => alive.delete(entry);
}
